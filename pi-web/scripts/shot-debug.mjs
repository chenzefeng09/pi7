import fs from "node:fs";
import http from "node:http";
import WebSocket from "ws";

const log = (msg) => fs.appendFileSync(process.env.TEMP + "/shot-debug.log", `${new Date().toISOString()} ${msg}\n`);
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
const targets = await getJson("http://127.0.0.1:9222/json");
const page = targets.find((t) => t.type === "page" && t.url.includes("5173"));
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
let nextId = 1;
const pending = new Map();
socket.on("message", (data) => {
	let msg;
	try { msg = JSON.parse(String(data)); } catch { return; }
	const entry = pending.get(msg.id);
	if (!entry) return;
	pending.delete(msg.id);
	entry(msg.error ? Promise.reject(new Error(JSON.stringify(msg.error))) : msg.result);
});
function send(method, params = {}) {
	return new Promise((resolve) => {
		const id = nextId++;
		pending.set(id, resolve);
		socket.send(JSON.stringify({ id, method, params }));
	});
}
await send("Page.bringToFront");
log("brought to front");
await new Promise((r) => setTimeout(r, 1500));
const result = await send("Page.captureScreenshot", { format: "png" });
log(`capture done, bytes: ${result?.data?.length ?? 0}`);
if (result?.data) fs.writeFileSync("artifacts/debug-shot.png", Buffer.from(result.data, "base64"));
socket.close();
process.exit(0);
