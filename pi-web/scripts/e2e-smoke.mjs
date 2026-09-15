import http from "node:http";
import WebSocket from "ws";

const CDP_ENDPOINT = process.env.PI_WEB_CDP_ENDPOINT ?? "http://127.0.0.1:9222/json";
const RENDERER_MATCH = process.env.PI_WEB_RENDERER_MATCH ?? "127.0.0.1:5173";
const PROMPT = process.env.PI_WEB_PROMPT ?? "Say exactly: ok";
const EXPECTED = process.env.PI_WEB_EXPECTED ?? "ok";

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
					reject(new Error(`invalid json from ${url}: ${String(error)}\n${body.slice(0, 500)}`));
				}
			});
		});
		request.on("error", reject);
		request.setTimeout(5000, () => {
			request.destroy(new Error(`timeout fetching ${url}`));
		});
	});
}

async function waitForTarget() {
	const deadline = Date.now() + 30000;
	let lastError;
	while (Date.now() < deadline) {
		try {
			const targets = await getJson(CDP_ENDPOINT);
			const page = targets.find(
				(target) => target.type === "page" && typeof target.url === "string" && target.url.includes(RENDERER_MATCH),
			);
			if (page?.webSocketDebuggerUrl) return page;
		} catch (error) {
			lastError = error;
		}
		await sleep(500);
	}
	throw new Error(`renderer target not found at ${CDP_ENDPOINT}: ${String(lastError ?? "")}`);
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
		if (result?.exceptionDetails) {
			throw new Error(`renderer evaluation failed: ${JSON.stringify(result.exceptionDetails)}`);
		}
		return result?.result?.value;
	};
	return { evaluate, send, socket };
}

async function main() {
	const target = await waitForTarget();
	const { evaluate, send, socket } = await connect(target);
	await send("Runtime.enable", {});

	const readyDeadline = Date.now() + 30000;
	let ready = false;
	while (Date.now() < readyDeadline) {
		ready =
			(await evaluate(
				`typeof window.pi === "object" && document.querySelector("#root")?.children.length > 0`,
			)) === true;
		if (ready) break;
		await sleep(500);
	}
	if (!ready) throw new Error("renderer did not expose window.pi");

	const state = await evaluate(`window.pi.getState()`);
	await evaluate(`window.pi.prompt(${JSON.stringify(PROMPT)})`);

	const resultDeadline = Date.now() + 120000;
	let assistantText = null;
	while (Date.now() < resultDeadline) {
		const texts = await evaluate(
			`Array.from(document.querySelectorAll('[data-role="assistant"][data-block="text"]')).map((element) => element.innerText.trim())`,
		);
		assistantText = Array.isArray(texts)
			? (texts.find((text) => text === EXPECTED) ?? texts.at(-1) ?? null)
			: null;
		if (assistantText === EXPECTED) break;
		await sleep(500);
	}

	const bodyText = await evaluate(`document.body.innerText`);
	socket.close();
	const ok = assistantText === EXPECTED;
	console.log(
		JSON.stringify(
			{
				assistantText,
				bodyContainsExpected: typeof bodyText === "string" && bodyText.includes(EXPECTED),
				expected: EXPECTED,
				ok,
				state,
				target: { title: target.title, url: target.url },
			},
			null,
			2,
		),
	);
	process.exit(ok ? 0 : 1);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.stack : String(error));
	process.exit(1);
});
