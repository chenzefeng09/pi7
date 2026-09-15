import fs from "node:fs";
import http from "node:http";
import WebSocket from "ws";

const CDP_ENDPOINT = process.env.PI_WEB_CDP_ENDPOINT ?? "http://127.0.0.1:9222/json";
const RENDERER_MATCH = process.env.PI_WEB_RENDERER_MATCH ?? "5173";
const arg = process.argv[2];
const expression = arg?.startsWith("@") ? fs.readFileSync(arg.slice(1), "utf8") : arg;
if (!expression) { console.error("usage: node cdp-eval.mjs <expression|@file>"); process.exit(1); }

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function getJson(url) {
	return new Promise((resolve, reject) => {
		const req = http.get(url, (res) => {
			let body = "";
			res.setEncoding("utf8");
			res.on("data", (c) => { body += c; });
			res.on("end", () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
		});
		req.on("error", reject);
		req.setTimeout(5000, () => req.destroy(new Error("timeout")));
	});
}
async function waitForTarget() {
	const deadline = Date.now() + 30000;
	while (Date.now() < deadline) {
		try {
			const targets = await getJson(CDP_ENDPOINT);
			const page = targets.find((t) => t.type === "page" && typeof t.url === "string" && t.url.includes(RENDERER_MATCH));
			if (page?.webSocketDebuggerUrl) return page;
		} catch {}
		await sleep(500);
	}
	throw new Error("renderer not found");
}
const target = await waitForTarget();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
let nextId = 1;
const pending = new Map();
socket.on("message", (data) => {
	let msg;
	try { msg = JSON.parse(String(data)); } catch { return; }
	const entry = pending.get(msg.id);
	if (!entry) return;
	pending.delete(msg.id);
	if (msg.error) entry.reject(new Error(JSON.stringify(msg.error)));
	else entry.resolve(msg.result);
});
function send(method, params = {}) {
	return new Promise((resolve, reject) => {
		const id = nextId++;
		pending.set(id, { resolve, reject });
		socket.send(JSON.stringify({ id, method, params }));
	});
}
const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
if (result.exceptionDetails) {
	console.error(JSON.stringify(result.exceptionDetails, null, 2));
	process.exit(1);
}
console.log(JSON.stringify(result.result.value, null, 2));
socket.close();
process.exit(0);
