import { execFileSync } from "node:child_process";
import http from "node:http";
import WebSocket from "ws";

const CDP_ENDPOINT = process.env.PI_WEB_CDP_ENDPOINT ?? "http://127.0.0.1:9222/json";
const RENDERER_MATCH = process.env.PI_WEB_RENDERER_MATCH ?? "127.0.0.1:5173";

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function getJson(url) {
	return new Promise((resolve, reject) => {
		const request = http.get(url, (response) => {
			let body = "";
			response.setEncoding("utf8");
			response.on("data", (chunk) => {
				body += chunk;
			});
			response.on("end", () => {
				try {
					resolve(JSON.parse(body));
				} catch (error) {
					reject(new Error(`invalid json from ${url}: ${String(error)}`));
				}
			});
		});
		request.on("error", reject);
		request.setTimeout(5000, () => request.destroy(new Error(`timeout fetching ${url}`)));
	});
}

async function waitForTarget() {
	const deadline = Date.now() + 30000;
	while (Date.now() < deadline) {
		try {
			const targets = await getJson(CDP_ENDPOINT);
			const page = targets.find(
				(target) => target.type === "page" && typeof target.url === "string" && target.url.includes(RENDERER_MATCH),
			);
			if (page?.webSocketDebuggerUrl) return page;
		} catch {}
		await sleep(500);
	}
	throw new Error("renderer target not found");
}

async function connect(target) {
	const socket = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		socket.once("open", resolve);
		socket.once("error", reject);
	});
	let nextId = 1;
	const pending = new Map();
	socket.on("message", (data) => {
		let message;
		try {
			message = JSON.parse(String(data));
		} catch {
			return;
		}
		const entry = pending.get(message.id);
		if (!entry) return;
		pending.delete(message.id);
		if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
		else entry.resolve(message.result);
	});
	const send = (method, params) =>
		new Promise((resolve, reject) => {
			const id = nextId++;
			pending.set(id, { reject, resolve });
			socket.send(JSON.stringify({ id, method, params }));
		});
	const evaluate = async (expression) => {
		const result = await send("Runtime.evaluate", {
			awaitPromise: true,
			expression,
			returnByValue: true,
		});
		if (result?.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
		return result?.result?.value;
	};
	return { evaluate, send, socket };
}

/**
 * Kill the pi rpc child the app spawned. The command line always contains the coding-agent
 * cli and `--mode rpc`; that pair does not appear in the Electron, test-runner, or shell
 * processes, so it is a safe discriminator. Runs from the same machine as the app.
 */
function killPiRpcProcess() {
	const matcher =
		process.platform === "win32"
			? `$_.CommandLine -match 'coding-agent' -and $_.CommandLine -match '--mode.*rpc'`
			: "coding-agent.*--mode.*rpc";
	let output;
	if (process.platform === "win32") {
		output = execFileSync(
			"powershell",
			[
				"-NoProfile",
				"-Command",
				`Get-CimInstance Win32_Process | Where-Object { ${matcher} } | ForEach-Object { $_.ProcessId }`,
			],
			{ encoding: "utf8" },
		);
	} else {
		try {
			output = execFileSync("pgrep", ["-f", matcher], { encoding: "utf8" });
		} catch {
			output = "";
		}
	}
	const pids = output.split(/\s+/).filter(Boolean).map(Number).filter((pid) => pid !== process.pid);
	for (const pid of pids) {
		try {
			process.kill(pid);
		} catch {}
	}
	return pids;
}

async function main() {
	const target = await waitForTarget();
	const { evaluate, send, socket } = await connect(target);
	await send("Runtime.enable", {});

	const readyDeadline = Date.now() + 30000;
	while (Date.now() < readyDeadline) {
		const ready = await evaluate(
			`typeof window.pi === "object" && document.querySelector("#root")?.children.length > 0`,
		);
		if (ready === true) break;
		await sleep(500);
	}

	let sessionIdBefore = null;
	const sessionDeadline = Date.now() + 30000;
	while (Date.now() < sessionDeadline) {
		const state = await evaluate(`window.pi.getState()`);
		sessionIdBefore = state?.data?.sessionId ?? null;
		if (typeof sessionIdBefore === "string") break;
		await sleep(500);
	}
	// A real crash, not `window.pi.stop()`: a graceful stop is reported with `stopped: true`
	// and the app intentionally shows no reconnect banner for it. Only an exit the app did
	// not ask for exercises the banner → Reconnect button path.
	killPiRpcProcess();

	// The banner text is localized ("Reconnect"/"重新连接"); match both shipped locales.
	const bannerExpr = `document.body.innerText.includes("Reconnect") || document.body.innerText.includes("重新连接")`;
	let bannerSeen = false;
	const bannerDeadline = Date.now() + 30000;
	while (Date.now() < bannerDeadline) {
		bannerSeen = await evaluate(bannerExpr);
		if (bannerSeen === true) break;
		await sleep(250);
	}

	const clicked = await evaluate(`(() => {
		const button = Array.from(document.querySelectorAll("button")).find((candidate) => ["Reconnect", "重新连接"].includes(candidate.innerText.trim()));
		if (!button) return false;
		button.click();
		return true;
	})()`);

	let recovered = false;
	let sessionIdAfter = null;
	const recoverDeadline = Date.now() + 60000;
	while (Date.now() < recoverDeadline) {
		const state = await evaluate(`window.pi.getState()`);
		sessionIdAfter = state?.data?.sessionId ?? null;
		const reconnectVisible = await evaluate(bannerExpr);
		recovered = typeof sessionIdAfter === "string" && reconnectVisible === false;
		if (recovered) break;
		await sleep(500);
	}

	const ok = typeof sessionIdBefore === "string" && bannerSeen && clicked && recovered;
	socket.close();
	console.log(JSON.stringify({ bannerSeen, clicked, ok, recovered, sessionIdAfter, sessionIdBefore }, null, 2));
	process.exit(ok ? 0 : 1);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.stack : String(error));
	process.exit(1);
});
