/**
 * Render public/pi-icon.svg into build/icon.png (1024x1024) for electron-builder and the
 * runtime window icon. electron-builder picks build/icon.png up automatically for the
 * Windows installer/exe and the Linux package; the macOS icns is generated from it as well.
 *
 * Usage:
 *   node_modules\electron\dist\electron.exe scripts\render-icon.cjs
 */
const { app, BrowserWindow } = require("electron");
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const root = join(__dirname, "..");
const svgPath = join(root, "public", "pi-icon.svg");
const outDir = join(root, "build");
const outPath = join(outDir, "icon.png");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
	mkdirSync(outDir, { recursive: true });
	// Small content size keeps the window under the screen-height cap; the display's 2x
	// device scale factor then yields a 1024px capture from 512 CSS pixels.
	const window = new BrowserWindow({
		frame: false,
		height: 512,
		show: false,
		transparent: true,
		useContentSize: true,
		webPreferences: { offscreen: true },
		width: 512,
	});
	window.webContents.setBackgroundThrottling(false);

	const svg = readFileSync(svgPath, "utf8").replace("viewBox=", 'width="512" height="512" viewBox=');
	const html = `<!doctype html><html><body style="margin:0;overflow:hidden">${svg}</body></html>`;
	await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
	await wait(1200);

	// The capture follows the display's device scale factor; resize normalizes to exactly 1024.
	const image = await window.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
	const png = image.getSize().width === 1024 ? image : image.resize({ quality: "best", width: 1024 });
	writeFileSync(outPath, png.toPNG());
	console.log("icon:", outPath, png.getSize());
	app.quit();
});
