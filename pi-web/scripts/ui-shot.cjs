/**
 * Offscreen UI shots: renders the dev server against the stub bridge in `ui-shot-preload.cjs` and
 * writes PNGs, so a layout change can be reviewed (by a human or an agent) without opening the app
 * and without a pi process.
 *
 * Usage, with `npm run dev` already serving http://127.0.0.1:5173:
 *   node_modules\electron\dist\electron.exe scripts\ui-shot.cjs [scenario]
 *
 * Scenarios: `chat` (default) and `project-picker`. Wrap a scenario through `SHOT_URL` to point at
 * another server, and `SHOT_DIR` to write somewhere else. Shots land in `%TEMP%\piweb-shot`.
 */
const { app, BrowserWindow } = require("electron");
const { mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const OUT = process.env.SHOT_DIR || join(process.env.TEMP || ".", "piweb-shot");
const URL = process.env.SHOT_URL || "http://127.0.0.1:5173/";
const SCENARIO = process.argv[2] || "chat";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.disableHardwareAcceleration();

/** Click the composer's project chip and save the open picker. */
const PICKER_SCENARIO = [
	{ name: "10-chat" },
	{
		evaluate: `(() => {
			const chip = [...document.querySelectorAll("button")].find((node) => (node.title || "").startsWith("当前项目") || node.title === "选择项目来运行聊天");
			if (!chip) return "chip not found";
			chip.dispatchEvent(new MouseEvent("click", { bubbles: true }));
			return chip.textContent;
		})()`,
		name: "11-project-picker",
	},
	{
		evaluate: `(() => {
			const input = [...document.querySelectorAll("input")].find((el) => el.placeholder === "搜索项目");
			if (!input) return "search not found";
			const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
			setter.call(input, "dif");
			input.dispatchEvent(new Event("input", { bubbles: true }));
			return "typed";
		})()`,
		name: "12-project-search",
	},
];

const SCENARIOS = {
	chat: [{ name: "01-chat" }],
	empty: [{ name: "20-empty" }],
	"project-picker": PICKER_SCENARIO,
};

app.whenReady().then(async () => {
	mkdirSync(OUT, { recursive: true });
	if (SCENARIO === "empty") process.env.SHOT_EMPTY = "1";
	const window = new BrowserWindow({
		height: 820,
		show: false,
		webPreferences: { offscreen: true, preload: join(__dirname, "ui-shot-preload.cjs") },
		width: 1280,
	});
	window.webContents.setBackgroundThrottling(false);
	window.webContents.setFrameRate(20);

	let latest = null;
	window.webContents.on("paint", (_event, _dirty, image) => {
		latest = image;
	});
	async function shoot(name) {
		// Let the last DOM change paint before capturing: invalidate() otherwise hands back the
		// frame that was already queued, which reads as "the shot is one step behind".
		await wait(500);
		latest = null;
		window.webContents.invalidate();
		for (let attempt = 0; attempt < 40 && !latest; attempt += 1) await wait(100);
		if (!latest) {
			console.log("no frame for", name);
			return;
		}
		writeFileSync(join(OUT, `${name}.png`), latest.toPNG());
		console.log("shot:", join(OUT, `${name}.png`), latest.getSize());
	}

	await window.loadURL(URL);
	await wait(6000);
	for (const step of SCENARIOS[SCENARIO] ?? SCENARIOS.chat) {
		if (step.evaluate) {
			const result = await window.webContents.executeJavaScript(step.evaluate);
			console.log("step:", result);
			await wait(900);
		}
		await shoot(step.name);
	}
	app.quit();
});
