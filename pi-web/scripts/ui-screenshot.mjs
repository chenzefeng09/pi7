import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import WebSocket from "ws";

const CDP_ENDPOINT = "http://127.0.0.1:9222/json";
const OUT_DIR = process.env.PI_WEB_SHOT_DIR ?? path.resolve("artifacts");

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
	const deadline = Date.now() + 60000;
	while (Date.now() < deadline) {
		try {
			const targets = await getJson(CDP_ENDPOINT);
			const page = targets.find((t) => t.type === "page" && typeof t.url === "string" && t.url.includes("5173"));
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

async function evaluate(expression) {
	const result = await send("Runtime.evaluate", { expression, returnByValue: true });
	return result?.result?.value;
}

async function shot(name) {
	const result = await send("Page.captureScreenshot", { format: "png" });
	fs.writeFileSync(path.join(OUT_DIR, name), Buffer.from(result.data, "base64"));
	console.log("saved", name);
}

async function clickButton(text) {
	const expr = `[...document.querySelectorAll('button')].find(b => b.textContent.replace(/\\s+/g,' ').trim().includes(${JSON.stringify(text)}))?.click()`;
	await evaluate(expr);
}

await send("Page.enable");
await send("Runtime.enable");
fs.mkdirSync(OUT_DIR, { recursive: true });
await sleep(4500);
await shot("01-chat.png");
await evaluate(`(async () => {
	const canvas = document.createElement("canvas");
	canvas.width = 320; canvas.height = 200;
	const ctx = canvas.getContext("2d");
	ctx.fillStyle = "#e8f3fe"; ctx.fillRect(0, 0, 320, 200);
	ctx.fillStyle = "#2f7df6"; ctx.font = "20px sans-serif"; ctx.fillText("paste preview", 20, 100);
	const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
	const file = new File([blob], "screenshot.png", { type: "image/png" });
	const dt = new DataTransfer();
	dt.items.add(file);
	const card = document.querySelector("textarea").closest('div[class*="rounded-[24px]"]');
	card.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
})()`);
await sleep(600);
await shot("01b-paste.png");
await evaluate(`document.querySelector('button[title="移除"]')?.click()`);
await sleep(300);
await evaluate(`document.querySelector('button[title="添加"]')?.click()`);
await sleep(400);
await shot("02-addmenu.png");
await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
await sleep(200);
await evaluate(`document.querySelector('button[title="选择模型和强度"]')?.click()`);
await sleep(400);
await shot("03-level.png");
await evaluate(`document.querySelector('button[title="选择模型"]')?.click()`);
await sleep(400);
await shot("03b-model.png");
await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
await sleep(200);
await clickButton("定时安排");
await sleep(500);
await shot("04-schedule.png");
await clickButton("每日简报");
await sleep(300);
await shot("05-schedule-added.png");
const clicked = await evaluate(`(() => { const row = [...document.querySelectorAll('button')].find(b => b.textContent.includes('下次运行')); if (row) { row.click(); return true; } return false; })()`);
console.log("row clicked:", clicked);
await sleep(400);
await shot("06-schedule-detail.png");
socket.close();
process.exit(0);
