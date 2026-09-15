import http from "node:http";
import WebSocket from "ws";

function getJson(url) {
	return new Promise((resolve, reject) => {
		const request = http.get(url, (response) => {
			let body = "";
			response.setEncoding("utf8");
			response.on("data", (chunk) => {
				body += chunk;
			});
			response.on("end", () => resolve(JSON.parse(body)));
		});
		request.on("error", reject);
	});
}

const targets = await getJson("http://127.0.0.1:9222/json");
console.log("TARGETS", JSON.stringify(targets.map((t) => ({ title: t.title, type: t.type, url: t.url })), null, 2));
const page = targets.find((target) => target.type === "page");
if (!page) process.exit(1);

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
	socket.once("open", resolve);
	socket.once("error", reject);
});
let nextId = 1;
const pending = new Map();
const logs = [];
socket.on("message", (data) => {
	const message = JSON.parse(String(data));
	if (message.method === "Runtime.consoleAPICalled") {
		logs.push({ args: message.params.args?.map((a) => a.value ?? a.description), type: message.params.type });
	}
	if (message.method === "Log.entryAdded") logs.push({ entry: message.params.entry });
	const entry = pending.get(message.id);
	if (!entry) return;
	pending.delete(message.id);
	if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
	else entry.resolve(message.result);
});
const send = (method, params) =>
	new Promise((resolve, reject) => {
		const id = nextId++;
		pending.set(id, { resolve, reject });
		socket.send(JSON.stringify({ id, method, params }));
	});
const evaluate = async (expression) => {
	const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
	return result?.result?.value;
};

await send("Runtime.enable", {});
await send("Log.enable", {});
await new Promise((resolve) => setTimeout(resolve, 2000));
console.log(
	"STATE",
	JSON.stringify(
		await evaluate(`({
			href: location.href,
			hasPi: typeof window.pi,
			body: document.body.innerText.slice(0, 500),
			commands: window.__piStore?.getState?.().commands?.map((command) => command.name) ?? [],
			connectionError: window.__piStore?.getState?.().connectionError ?? null,
			lastStderr: window.__piStore?.getState?.().lastStderr ?? null,
			ready: document.readyState
		})`),
		null,
		2,
	),
);
console.log("RUNTIME", JSON.stringify(await evaluate(`window.pi.getRuntimeInfo()`), null, 2));
console.log(
	"DIRECT COMMANDS",
	JSON.stringify(await evaluate(`window.pi.command({ type: "get_commands" })`), null, 2),
);
console.log(
	"STORE LOAD COMMANDS",
	JSON.stringify(
		await evaluate(`(async () => {
			try {
				await window.__piStore.getState().loadCommands();
				return { commands: window.__piStore.getState().commands.map((command) => command.name), ok: true };
			} catch (error) {
				return { error: String(error), ok: false };
			}
		})()`),
		null,
		2,
	),
);
console.log(
	"LOAD COMMANDS SOURCE",
	await evaluate(`window.__piStore.getState().loadCommands.toString()`),
);
console.log("LOGS", JSON.stringify(logs.slice(0, 30), null, 2));
socket.close();
