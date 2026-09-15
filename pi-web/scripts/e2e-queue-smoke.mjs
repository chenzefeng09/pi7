import http from "node:http";
import WebSocket from "ws";

const CDP_ENDPOINT = process.env.PI_WEB_CDP_ENDPOINT ?? "http://127.0.0.1:9222/json";
const RENDERER_MATCH = process.env.PI_WEB_RENDERER_MATCH ?? "127.0.0.1:5173";
const PROMPT = process.env.PI_WEB_QUEUE_PROMPT ?? "Count from 1 to 120, one number per line. Do not use tools.";
const FOLLOW_UP = process.env.PI_WEB_QUEUE_FOLLOW_UP ?? "Say exactly: queued done";

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

	await evaluate(`window.pi.prompt(${JSON.stringify(PROMPT)})`);
	let streamingSeen = false;
	const streamDeadline = Date.now() + 60000;
	while (Date.now() < streamDeadline) {
		streamingSeen = await evaluate(`window.__piStore?.getState?.().status === "streaming"`);
		if (streamingSeen === true) break;
		await sleep(100);
	}
	if (!streamingSeen) throw new Error("agent did not enter streaming state");

	const submitted = await evaluate(`(() => {
		const textarea = document.querySelector("textarea");
		if (!textarea) return false;
		const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
		setter.call(textarea, ${JSON.stringify(FOLLOW_UP)});
		textarea.dispatchEvent(new Event("input", { bubbles: true }));
		return true;
	})()`);
	await sleep(200);
	const clicked = await evaluate(`(() => {
		const button = Array.from(document.querySelectorAll("button")).find((candidate) => candidate.title === "Send");
		if (!button) return false;
		button.click();
		return true;
	})()`);

	let queueSeen = false;
	const queueDeadline = Date.now() + 30000;
	while (Date.now() < queueDeadline) {
		queueSeen = await evaluate(
			`(window.__piStore?.getState?.().queue?.followUp?.length ?? 0) + (window.__piStore?.getState?.().queue?.steering?.length ?? 0) > 0`,
		);
		if (queueSeen === true) break;
		await sleep(100);
	}

	let followUpDone = false;
	const resultDeadline = Date.now() + 180000;
	while (Date.now() < resultDeadline) {
		const assistantTexts = await evaluate(
			`Array.from(document.querySelectorAll('[data-role="assistant"][data-block="text"]')).map((element) => element.innerText.trim())`,
		);
		followUpDone =
			Array.isArray(assistantTexts) && assistantTexts.some((text) => text.toLowerCase().includes("queued done"));
		if (followUpDone) break;
		await sleep(500);
	}

	const ok = streamingSeen && submitted && clicked && queueSeen && followUpDone;
	socket.close();
	console.log(JSON.stringify({ clicked, followUpDone, ok, queueSeen, streamingSeen, submitted }, null, 2));
	process.exit(ok ? 0 : 1);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.stack : String(error));
	process.exit(1);
});
