import http from "node:http";
import WebSocket from "ws";

const CDP_ENDPOINT = process.env.PI_WEB_CDP_ENDPOINT ?? "http://127.0.0.1:9222/json";
const RENDERER_MATCH = process.env.PI_WEB_RENDERER_MATCH ?? "127.0.0.1:5173";
const PROMPT =
	process.env.PI_WEB_REAL_PROMPT ??
	"Call the todo tool with action 'add' and text 'real todo'. Then call the ask_user tool with question 'What is 2+2?'. Then say exactly: real done.";

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

	const deadline = Date.now() + 180000;
	let toolTexts = [];
	let assistantTexts = [];
	let todoOk = false;
	let dialogSeen = false;
	let assistantOk = false;
	while (Date.now() < deadline) {
		toolTexts = await evaluate(
			`Array.from(document.querySelectorAll('[data-block="toolCall"]')).map((element) => element.innerText)`,
		);
		assistantTexts = await evaluate(
			`Array.from(document.querySelectorAll('[data-role="assistant"][data-block="text"]')).map((element) => element.innerText.trim())`,
		);
		todoOk = Array.isArray(toolTexts) && toolTexts.some((text) => text.includes("real todo"));
		dialogSeen =
			(await evaluate(`!!document.querySelector('input[placeholder="Type your answer..."]')`)) === true;
		assistantOk =
			Array.isArray(assistantTexts) &&
			assistantTexts.some((text) => text.toLowerCase().includes("real done"));
		if (todoOk && dialogSeen && !assistantOk) {
			await evaluate(`(() => {
				const input = document.querySelector('input[placeholder="Type your answer..."]');
				if (!input) return false;
				const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
				setter.call(input, "4");
				input.dispatchEvent(new Event("input", { bubbles: true }));
				const submit = Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Submit");
				submit?.click();
				return true;
			})()`);
		}
		if (todoOk && assistantOk) break;
		await sleep(500);
	}

	const ok = todoOk && assistantOk;
	socket.close();
	console.log(JSON.stringify({ assistantOk, assistantTexts, dialogSeen, ok, todoOk, toolTexts }, null, 2));
	process.exit(ok ? 0 : 1);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.stack : String(error));
	process.exit(1);
});
