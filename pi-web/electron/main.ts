import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, shell } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { resolvePiWin7Config, syncBundledAgentDir } from "./bridge/config";
import { discoverModels, type DiscoveryRequest } from "./bridge/model-discovery";
import {
	exportModelConfig,
	importModelConfig,
	type ModelConfigPatch,
	readModelConfig,
	readProviderKey,
	writeModelConfig,
} from "./bridge/model-config";
import { PiRpcClient } from "./bridge/pi-rpc-client";
import type { PiRpcCommand, PiRuntimeInfo } from "./bridge/types";
import { localeFromTag, setLocale, t } from "../src/i18n";

let client: PiRpcClient | undefined;
let mainWindow: BrowserWindow | undefined;

interface SessionListItem {
	cwd?: string;
	firstMessage?: string;
	id: string;
	name?: string;
	path: string;
	updatedAt: string;
}

/**
 * Session list entries by file path, keyed on the file's mtime and size. A listing is asked for
 * after every new session, rename, fork and settled turn; without this every one of them re-read
 * and re-parsed the 50 newest transcripts, which can be tens of MB each once images are involved.
 */
const sessionListCache = new Map<string, { item: SessionListItem; mtimeMs: number; size: number }>();

/** Only these entry types feed the list; every other line (tool output, images) is skipped unparsed. */
const SESSION_LIST_LINE = /"type":"(?:session|session_info|message)"/;

async function readSessionListItem(file: { mtime: number; path: string; size: number }): Promise<SessionListItem> {
	const cached = sessionListCache.get(file.path);
	if (cached && cached.mtimeMs === file.mtime && cached.size === file.size) return cached.item;
	let cwd: string | undefined;
	let firstMessage: string | undefined;
	let id = path.basename(file.path, ".jsonl");
	let name: string | undefined;
	try {
		for (const line of (await fs.promises.readFile(file.path, "utf8")).split("\n")) {
			if (!SESSION_LIST_LINE.test(line)) continue;
			let entry: Record<string, unknown>;
			try {
				entry = JSON.parse(line) as Record<string, unknown>;
			} catch {
				continue;
			}
			if (entry.type === "session") {
				if (typeof entry.id === "string") id = entry.id;
				if (typeof entry.cwd === "string") cwd = entry.cwd;
			}
			if (entry.type === "session_info" && typeof entry.name === "string") {
				name = entry.name;
			}
			if (!firstMessage && entry.type === "message") {
				const message = entry.message as Record<string, unknown> | undefined;
				if (message?.role === "user") {
					const content = message.content;
					const text =
						typeof content === "string"
							? content
							: Array.isArray(content)
								? content
										.map((part) =>
											typeof part === "object" && part !== null && typeof (part as { text?: unknown }).text === "string"
												? (part as { text: string }).text
												: "",
										)
										.join("")
								: "";
					if (text.trim()) firstMessage = text.trim().slice(0, 120);
				}
			}
		}
	} catch {}
	const item: SessionListItem = {
		cwd,
		firstMessage,
		id,
		name,
		path: file.path,
		updatedAt: new Date(file.mtime).toISOString(),
	};
	sessionListCache.set(file.path, { item, mtimeMs: file.mtime, size: file.size });
	return item;
}

async function listSessionFiles(agentDir: string): Promise<SessionListItem[]> {
	const sessionsDir = path.join(agentDir, "sessions");
	if (!fs.existsSync(sessionsDir)) return [];
	const files: { mtime: number; path: string; size: number }[] = [];
	const walk = async (dir: string): Promise<void> => {
		let entries: fs.Dirent[];
		try {
			entries = await fs.promises.readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				await walk(fullPath);
			} else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
				try {
					const stat = await fs.promises.stat(fullPath);
					files.push({ mtime: stat.mtimeMs, path: fullPath, size: stat.size });
				} catch {
					// A session can be rotated or archived while the sidebar is reading it.
				}
			}
		}
	};
	await walk(sessionsDir);
	files.sort((left, right) => right.mtime - left.mtime);
	const newest = files.slice(0, 50);
	// Entries for files that fell out of the newest 50 (or were archived) are not worth keeping.
	const keep = new Set(newest.map((file) => file.path));
	for (const key of sessionListCache.keys()) if (!keep.has(key)) sessionListCache.delete(key);
	return Promise.all(newest.map((file) => readSessionListItem(file)));
}

const IGNORED_FILE_DIRS = new Set([
	".git",
	".next",
	".test-agent",
	"artifacts",
	"coverage",
	"dist",
	"node_modules",
	"release",
	"resources",
]);
const MAX_FILE_READ_BYTES = 64 * 1024 * 1024;

// Async: a 5000-file walk of a large checkout on a slow disk must not stall the main process,
// which is also what relays every pi event to the window.
async function listWorkspaceFiles(root: string, limit = 5000): Promise<string[]> {
	const files: string[] = [];
	const walk = async (dir: string): Promise<void> => {
		if (files.length >= limit) return;
		let entries: fs.Dirent[];
		try {
			entries = await fs.promises.readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		entries.sort((left, right) => left.name.localeCompare(right.name));
		for (const entry of entries) {
			if (files.length >= limit) return;
			if (entry.isDirectory()) {
				if (!IGNORED_FILE_DIRS.has(entry.name)) await walk(path.join(dir, entry.name));
				continue;
			}
			if (!entry.isFile()) continue;
			files.push(path.relative(root, path.join(dir, entry.name)).replace(/\\/g, "/"));
		}
	};
	await walk(root);
	return files;
}

function imageMimeType(filePath: string): string | undefined {
	const extension = path.extname(filePath).toLowerCase();
	if (extension === ".png") return "image/png";
	if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
	if (extension === ".gif") return "image/gif";
	if (extension === ".webp") return "image/webp";
	if (extension === ".bmp") return "image/bmp";
	return undefined;
}

// Async on purpose: these run on the main process, and a sync read of a multi-MB file would
// block every other IPC reply plus window chrome while the disk answers.
async function readFilePrefix(
	filePath: string,
	maxBytes: number,
): Promise<{ buffer: Buffer; size: number; truncated: boolean }> {
	const stat = await fs.promises.stat(filePath);
	const handle = await fs.promises.open(filePath, "r");
	try {
		const length = Math.min(stat.size, maxBytes);
		const buffer = Buffer.alloc(length);
		if (length > 0) await handle.read(buffer, 0, length, 0);
		return { buffer, size: stat.size, truncated: stat.size > maxBytes };
	} finally {
		await handle.close();
	}
}

function debugLog(kind: string, payload: unknown): void {
	const target = process.env.PI_WEB_DEBUG_LOG;
	if (!target) return;
	try {
		fs.appendFileSync(target, `${new Date().toISOString()} ${kind} ${JSON.stringify(payload)}\n`);
	} catch {}
}

interface PiCliResult {
	code: number | null;
	stderr: string;
	stdout: string;
}

function runPiCli(args: string[]): Promise<PiCliResult> {
	const config = resolvePiWin7Config({
		isPackaged: app.isPackaged,
		resourcesPath: process.resourcesPath,
	});
	return new Promise((resolve, reject) => {
		const child = spawn(config.nodePath, [config.cliPath, ...args], {
			cwd: config.cwd,
			env: {
			...process.env,
			NODE_SKIP_PLATFORM_CHECK: "1",
			PI_CODING_AGENT_DIR: config.agentDir,
		},
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk: string) => {
			stderr += chunk;
		});
		child.on("error", reject);
		child.on("exit", (code) => resolve({ code, stderr, stdout }));
	});
}

function readPackageSources(agentDir: string, cwd: string): { global: unknown[]; project: unknown[] } {
	const read = (filePath: string): unknown[] => {
		try {
			const settings = JSON.parse(fs.readFileSync(filePath, "utf8")) as { packages?: unknown[] };
			return Array.isArray(settings.packages) ? settings.packages : [];
		} catch {
			return [];
		}
	};
	return {
		global: read(path.join(agentDir, "settings.json")),
		project: read(path.join(cwd, ".pi", "settings.json")),
	};
}

function broadcast(channel: string, payload: unknown): void {
	if (!mainWindow || mainWindow.isDestroyed()) return;
	mainWindow.webContents.send(channel, payload);
}

function ensureClient(): PiRpcClient {
	if (client?.running) return client;
	if (client) {
		// A process can reach exitCode before its exit event is delivered. Detach the old client's
		// broadcasts before replacing it so that a late exit/error cannot mark the newly started
		// client as disconnected.
		client.removeAllListeners();
		void client.stop();
	}
	const config = resolvePiWin7Config({
		isPackaged: app.isPackaged,
		resourcesPath: process.resourcesPath,
	});
	client = new PiRpcClient({
		args: config.args,
		cliPath: config.cliPath,
		cwd: config.cwd,
		env: {
			NODE_SKIP_PLATFORM_CHECK: "1",
			PI_CODING_AGENT_DIR: config.agentDir,
		},
		nodePath: config.nodePath,
	});
	client.on("event", (event) => {
		debugLog("event", event);
		broadcast("pi:event", event);
	});
	client.on("response", (response) => debugLog("response", response));
	client.on("stderr", (text) => {
		debugLog("stderr", text);
		broadcast("pi:stderr", text);
	});
	client.on("error", (error) => broadcast("pi:error", error instanceof Error ? error.message : String(error)));
	client.on("exit", (info) => broadcast("pi:exit", info));
	client.start();
	return client;
}

function sendMenuCommand(command: string): void {
	mainWindow?.webContents.send("pi:menu-command", command);
}

function attachAccelerators(window: BrowserWindow): void {
	window.webContents.on("before-input-event", (event, input) => {
		if (input.type !== "keyDown") return;
		const key = input.key.toLowerCase();
		const primary = input.control || input.meta;
		if (primary && !input.shift && !input.alt && key === "n") {
			event.preventDefault();
			sendMenuCommand("new-session");
		}
	});
}

function createWindow(): void {
	// Window/taskbar icon for dev and Linux: packaged Windows builds take it from the exe.
	const iconPath = path.join(app.getAppPath(), "build", "icon.png");
	const window = new BrowserWindow({
		backgroundColor: "#edf4ef",
		frame: false,
		height: 900,
		...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
		minHeight: 640,
		minWidth: 960,
		show: false,
		title: "π7",
		width: 1440,
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			// Chromium's built-in viewer is what renders a PDF preview in the file panel.
			plugins: true,
			preload: path.join(__dirname, "preload.cjs"),
		},
	});
	mainWindow = window;
	attachAccelerators(window);
	window.on("maximize", () => window.webContents.send("window:maximized", true));
	window.on("unmaximize", () => window.webContents.send("window:maximized", false));
	window.once("ready-to-show", () => window.show());
	if (app.isPackaged) {
		void window.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
	} else {
		void window.loadURL("http://127.0.0.1:5173");
	}
	window.on("closed", () => {
		if (mainWindow === window) mainWindow = undefined;
	});
}

/**
 * Forward one command to pi and hand the renderer pi's own response envelope.
 *
 * `PiRpcClient.send` rejects on `success: false`; letting that rejection cross `ipcMain.handle`
 * turns it into `Error invoking remote method 'pi:command': Error: <message>`, which is what the
 * user would then read in a notification. The renderer's `rpc()` checks `success === false`
 * instead, so a failed command is returned as data rather than thrown.
 */
async function forwardCommand(command: PiRpcCommand): Promise<unknown> {
	try {
		return await ensureClient().send(command);
	} catch (error) {
		return {
			command: command.type,
			error: error instanceof Error ? error.message : String(error),
			id: command.id,
			success: false,
			type: "response",
		};
	}
}

async function stopClient(): Promise<void> {
	const current = client;
	client = undefined;
	if (current) await current.stop();
}

ipcMain.handle("pi:start", () => {
	ensureClient();
	return { ok: true };
});

ipcMain.handle("pi:stop", async () => {
	await stopClient();
	return { ok: true };
});

ipcMain.handle("pi:prompt", (_event, text: string) => forwardCommand({ message: text, type: "prompt" }));

ipcMain.handle("pi:command", (_event, command: PiRpcCommand) => forwardCommand(command));

ipcMain.handle("pi:abort", () => forwardCommand({ type: "abort" }));

ipcMain.handle("pi:get-state", () => forwardCommand({ type: "get_state" }));

ipcMain.handle("pi:get-messages", () => forwardCommand({ type: "get_messages" }));

ipcMain.handle("pi:new-session", () => forwardCommand({ type: "new_session" }));

ipcMain.handle("pi:list-sessions", () => {
	const config = resolvePiWin7Config({
		isPackaged: app.isPackaged,
		resourcesPath: process.resourcesPath,
	});
	return listSessionFiles(config.agentDir);
});

ipcMain.handle("pi:switch-session", (_event, sessionPath: string) =>
	forwardCommand({ sessionPath, type: "switch_session" }),
);

ipcMain.handle("pi:get-available-models", () => forwardCommand({ type: "get_available_models" }));

ipcMain.handle("pi:get-available-thinking-levels", () =>
	forwardCommand({ type: "get_available_thinking_levels" }),
);

ipcMain.handle("pi:set-model", (_event, provider: string, modelId: string) =>
	forwardCommand({ modelId, provider, type: "set_model" }),
);

ipcMain.handle("pi:set-thinking-level", (_event, level: string) =>
	forwardCommand({ level, type: "set_thinking_level" }),
);

ipcMain.handle("pi:extension-ui-response", (_event, response: unknown) => {
	debugLog("extension-ui-response", response);
	ensureClient().sendNotification(response as { type: string; [key: string]: unknown });
	return { ok: true };
});

ipcMain.handle("pi:restart", async () => {
	await stopClient();
	ensureClient();
	return { ok: true };
});

ipcMain.handle("pi:set-workspace-cwd", async (_event, cwd: string) => {
	if (typeof cwd !== "string" || !cwd.trim()) return { cwd: process.env.PI_WORKSPACE_CWD };
	process.env.PI_WORKSPACE_CWD = cwd;
	await stopClient();
	ensureClient();
	return { cwd };
});

function sessionsRoot(): string {
	const config = resolvePiWin7Config({
		isPackaged: app.isPackaged,
		resourcesPath: process.resourcesPath,
	});
	return path.join(config.agentDir, "sessions");
}

function resolveSessionFile(sessionPath: string): string {
	const root = path.resolve(sessionsRoot());
	const resolved = path.resolve(sessionPath);
	const relative = path.relative(root, resolved);
	if (
		!relative ||
		relative.startsWith(`..${path.sep}`) ||
		path.isAbsolute(relative) ||
		path.extname(resolved) !== ".jsonl"
	) {
		throw new Error(t("非法会话路径: {sessionPath}", { "sessionPath": sessionPath }));
	}
	return resolved;
}

ipcMain.handle("pi:rename-session", (_event, sessionPath: string, name: string) => {
	const file = resolveSessionFile(sessionPath);
	const sanitized = String(name).replace(/[\r\n]+/g, " ").trim();
	if (!sanitized) throw new Error(t("会话名称不能为空"));
	let parentId: string | null = null;
	try {
		const lines = fs.readFileSync(file, "utf8").split("\n").filter((line) => line.trim());
		const last = lines.at(-1);
		if (last) {
			const parsed = JSON.parse(last) as { id?: unknown };
			if (typeof parsed.id === "string") parentId = parsed.id;
		}
	} catch {}
	// Same entry shape pi writes for session names; the latest one wins.
	const entry = {
		id: `name-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
		name: sanitized,
		parentId,
		timestamp: new Date().toISOString(),
		type: "session_info",
	};
	fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, "utf8");
	return { name: sanitized };
});

ipcMain.handle("pi:archive-session", (_event, sessionPath: string) => {
	const file = resolveSessionFile(sessionPath);
	const config = resolvePiWin7Config({
		isPackaged: app.isPackaged,
		resourcesPath: process.resourcesPath,
	});
	const archiveDir = path.join(config.agentDir, "archive");
	fs.mkdirSync(archiveDir, { recursive: true });
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const target = path.join(archiveDir, `${stamp}_${path.basename(file)}`);
	// Move instead of unlink: an archived session stays recoverable by hand.
	fs.renameSync(file, target);
	return { archived: target };
});

ipcMain.handle("pi:choose-directory", async () => {
	const result = await dialog.showOpenDialog({
		properties: ["openDirectory"],
		title: t("选择文件夹"),
	});
	if (result.canceled || result.filePaths.length === 0) return undefined;
	return result.filePaths[0];
});

ipcMain.handle("window:control", (_event, action: string) => {
	const window = mainWindow;
	if (!window) return false;
	if (action === "minimize") {
		window.minimize();
		return window.isMaximized();
	}
	if (action === "close") {
		window.close();
		return window.isMaximized();
	}
	if (action === "toggle-maximize") {
		if (window.isMaximized()) window.unmaximize();
		else window.maximize();
		return window.isMaximized();
	}
	return window.isMaximized();
});

ipcMain.handle("window:is-maximized", () => mainWindow?.isMaximized() ?? false);

ipcMain.handle("desktop:action", (_event, action: string) => {
	const window = mainWindow;
	if (!window) return { ok: false };
	const contents = window.webContents;
	switch (action) {
		case "edit-undo":
			contents.undo();
			break;
		case "edit-redo":
			contents.redo();
			break;
		case "edit-cut":
			contents.cut();
			break;
		case "edit-copy":
			contents.copy();
			break;
		case "edit-paste":
			contents.paste();
			break;
		case "edit-delete":
			contents.delete();
			break;
		case "edit-select-all":
			contents.selectAll();
			break;
		case "view-reload":
			contents.reload();
			break;
		case "view-force-reload":
			contents.reloadIgnoringCache();
			break;
		case "view-zoom-reset":
			contents.setZoomLevel(0);
			break;
		case "view-zoom-in":
			contents.setZoomLevel(contents.getZoomLevel() + 0.5);
			break;
		case "view-zoom-out":
			contents.setZoomLevel(contents.getZoomLevel() - 0.5);
			break;
		case "view-fullscreen":
			window.setFullScreen(!window.isFullScreen());
			break;
		case "app-quit":
			app.quit();
			break;
		default:
			return { ok: false };
	}
	return { ok: true };
});

ipcMain.handle("pi:enable-portable-config", () => {
	const config = resolvePiWin7Config({
		isPackaged: app.isPackaged,
		resourcesPath: process.resourcesPath,
	});
	const target = config.portableAgentDir;
	const source = config.agentDir;
	if (path.resolve(source) === path.resolve(target)) {
		return { copied: [], source, target };
	}
	fs.mkdirSync(target, { recursive: true });
	const files = ["auth.json", "settings.json", "models.json", "models-store.json", "trust.json"];
	const dirs = ["skills", "extensions", "sessions"];
	const copied: string[] = [];
	for (const name of files) {
		const from = path.join(source, name);
		if (!fs.existsSync(from)) continue;
		fs.copyFileSync(from, path.join(target, name));
		copied.push(name);
	}
	for (const name of dirs) {
		const from = path.join(source, name);
		if (!fs.existsSync(from)) continue;
		fs.cpSync(from, path.join(target, name), { force: true, recursive: true });
		copied.push(`${name}/`);
	}
	return { copied, source, target };
});

ipcMain.handle("pi:get-runtime-info", (): PiRuntimeInfo => {
	const config = resolvePiWin7Config({
		isPackaged: app.isPackaged,
		resourcesPath: process.resourcesPath,
	});
	return {
		agentDir: config.agentDir,
		agentDirSource: config.agentDirSource,
		appVersion: app.getVersion(),
		chrome: process.versions.chrome ?? "unknown",
		cliPath: config.cliPath,
		cwd: config.cwd,
		electron: process.versions.electron ?? "unknown",
		isPackaged: app.isPackaged,
		nodePath: config.nodePath,
	};
});

ipcMain.handle("pi:list-files", async (_event, root?: string) => {
	const config = resolvePiWin7Config({
		isPackaged: app.isPackaged,
		resourcesPath: process.resourcesPath,
	});
	// A session runs in its own folder, so the panel lists that one when it is known: the process
	// workspace is only the fallback for a session that has not reported a cwd yet.
	const requested = typeof root === "string" && root.length > 0 ? path.resolve(root) : undefined;
	const target = requested && fs.existsSync(requested) ? requested : config.cwd;
	// The root travels back with the listing: the panel resolves preview paths against it, and a
	// session whose handle folder differs from its own recorded cwd must not guess.
	return { files: await listWorkspaceFiles(target), root: target };
});

ipcMain.handle("pi:read-file", async (_event, filePath: string) => {
	const resolved = path.resolve(filePath);
	const mimeType = imageMimeType(resolved);
	const prefix = await readFilePrefix(resolved, 24 * 1024 * 1024);
	const buffer = prefix.buffer;
	if (mimeType) {
		return {
			data: buffer.toString("base64"),
			mimeType,
			path: resolved,
			truncated: prefix.truncated,
			type: "image" as const,
		};
	}
	return {
		path: resolved,
		text: buffer.toString("utf8").replace(/^\uFEFF/, ""),
		truncated: prefix.truncated,
		type: "text" as const,
	};
});

ipcMain.handle("pi:read-model-config", () => {
	const config = resolvePiWin7Config({
		isPackaged: app.isPackaged,
		resourcesPath: process.resourcesPath,
	});
	return readModelConfig(config.agentDir);
});

ipcMain.handle("pi:write-model-config", (_event, patch: ModelConfigPatch) => {
	const config = resolvePiWin7Config({
		isPackaged: app.isPackaged,
		resourcesPath: process.resourcesPath,
	});
	return writeModelConfig(config.agentDir, patch ?? {});
});

ipcMain.handle("pi:read-bytes", async (_event, filePath: string, maxBytes?: number) => {
	const resolved = path.resolve(filePath);
	const limit = typeof maxBytes === "number" && Number.isFinite(maxBytes) && maxBytes > 0
		? Math.min(Math.floor(maxBytes), MAX_FILE_READ_BYTES)
		: 24 * 1024 * 1024;
	const size = (await fs.promises.stat(resolved)).size;
	const handle = await fs.promises.open(resolved, "r");
	let bytes: Buffer;
	try {
		bytes = Buffer.alloc(Math.min(size, limit));
		if (bytes.length > 0) await handle.read(bytes, 0, bytes.length, 0);
	} finally {
		await handle.close();
	}
	return {
		// A preview never needs the whole file: the cap keeps a huge binary out of the renderer.
		base64: bytes.toString("base64"),
		path: resolved,
		size,
		truncated: size > limit,
	};
});

ipcMain.handle("pi:open-path", async (_event, filePath: string) => {
	const error = await shell.openPath(path.resolve(filePath));
	return { error: error || undefined };
});

/** Characters Windows rejects in a filename, plus the ones that make a title unreadable. */
function safeFileName(value: string): string {
	return (
		value
			.replace(/[\\/:*?"<>|]/g, " ")
			.replace(/\s+/g, " ")
			.trim()
			.slice(0, 60)
			.replace(/[. ]+$/, "") || t("会话")
	);
}

ipcMain.handle("pi:pick-session-export-path", async (_event, suggestedName?: string) => {
	// pi writes whatever path it is handed and never asks, so a path is only ever exported after
	// the user has chosen it here. Naming the file after the conversation is what makes a folder
	// of exports usable; the session's own file name is a timestamp and a uuid.
	const picked = await dialog.showSaveDialog({
		defaultPath: path.join(
			app.getPath("documents"),
			t("π7-会话-{arg}.html", { "arg": safeFileName(typeof suggestedName === "string" && suggestedName ? suggestedName : t("新对话")) }),
		),
		filters: [{ extensions: ["html"], name: t("HTML 会话导出") }],
		title: t("导出会话 HTML"),
	});
	if (picked.canceled || !picked.filePath) return { canceled: true };
	return { path: picked.filePath };
});

ipcMain.handle("pi:reveal-path", (_event, filePath: string) => {
	shell.showItemInFolder(path.resolve(filePath));
	return { ok: true };
});

ipcMain.handle("pi:copy-image", (_event, dataUrl: string) => {
	// The renderer's own clipboard API needs a secure context, which a packaged app loaded over
	// file:// is not; Electron's clipboard works either way.
	const image = nativeImage.createFromDataURL(dataUrl);
	if (image.isEmpty()) return { copied: false };
	clipboard.writeImage(image);
	return { copied: true };
});

ipcMain.handle("pi:discover-models", async (_event, request: DiscoveryRequest) => {
	const config = resolvePiWin7Config({
		isPackaged: app.isPackaged,
		resourcesPath: process.resourcesPath,
	});
	// A key typed into the form wins; otherwise the provider's own stored key is used, resolving
	// `$ENV` against the app's environment (a `!command` key is left alone: the app does not run
	// shell commands on a config file's behalf).
	const stored = readModelConfig(config.agentDir).providers.find((provider) => provider.id === request?.providerId);
	const literal =
		stored?.credential === "literal"
			? undefined
			: stored?.credential === "env" && stored.credentialHint
				? process.env[stored.credentialHint.replace(/^\$\{?|\}?$/g, "")]
				: undefined;
	const storedKey =
		stored?.credential === "literal" ? readProviderKey(config.agentDir, stored.id) : literal;
	return discoverModels(request ?? {}, storedKey);
});

ipcMain.handle("pi:export-model-config", async (_event, filePath?: string) => {
	const config = resolvePiWin7Config({
		isPackaged: app.isPackaged,
		resourcesPath: process.resourcesPath,
	});
	// A caller that names a path (a script, a test) skips the picker; the app never does.
	let target = typeof filePath === "string" && filePath.length > 0 ? path.resolve(filePath) : undefined;
	if (!target) {
		const picked = await dialog.showSaveDialog({
			defaultPath: path.join(app.getPath("documents"), `pi-models-${new Date().toISOString().slice(0, 10)}.json`),
			filters: [{ extensions: ["json"], name: t("π7 模型配置") }],
			title: t("导出模型配置"),
		});
		if (picked.canceled || !picked.filePath) return { canceled: true };
		target = picked.filePath;
	}
	const bundle = exportModelConfig(config.agentDir);
	fs.writeFileSync(target, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
	return {
		path: target,
		providers: Object.keys(bundle.providers).length,
		redactedKeys: bundle.redactedKeys,
	};
});

ipcMain.handle("pi:import-model-config", async (_event, filePath?: string) => {
	const config = resolvePiWin7Config({
		isPackaged: app.isPackaged,
		resourcesPath: process.resourcesPath,
	});
	let source = typeof filePath === "string" && filePath.length > 0 ? path.resolve(filePath) : undefined;
	if (!source) {
		const picked = await dialog.showOpenDialog({
			filters: [{ extensions: ["json"], name: t("π7 模型配置") }],
			properties: ["openFile"],
			title: t("导入模型配置"),
		});
		if (picked.canceled || picked.filePaths.length === 0) return { canceled: true };
		source = picked.filePaths[0];
	}
	try {
		const document = JSON.parse(fs.readFileSync(source, "utf8")) as unknown;
		return { ...importModelConfig(config.agentDir, document), path: source };
	} catch (error) {
		return { error: error instanceof Error ? error.message : String(error), path: source };
	}
});

ipcMain.handle("pi:list-packages", () => {
	const config = resolvePiWin7Config({
		isPackaged: app.isPackaged,
		resourcesPath: process.resourcesPath,
	});
	return readPackageSources(config.agentDir, config.cwd);
});

ipcMain.handle("pi:install-package", async (_event, source: string, local: boolean) => {
	const args = ["install", source, ...(local ? ["-l", "-a"] : [])];
	return runPiCli(args);
});

ipcMain.handle("pi:remove-package", async (_event, source: string, local: boolean) => {
	const args = ["remove", source, ...(local ? ["-l", "-a"] : [])];
	return runPiCli(args);
});

ipcMain.handle("pi:update-packages", async () => {
	return runPiCli(["update", "--extensions"]);
});

void app.whenReady().then(() => {
	// The renderer detects its own locale from navigator; the main process needs the OS one.
	setLocale(localeFromTag(app.getLocale()));
	// Portable layout: <app root>/data/agent travels with the app folder.
	process.env.PI_WEB_APP_ROOT =
		process.env.PI_WEB_APP_ROOT ?? (app.isPackaged ? path.dirname(app.getPath("exe")) : app.getAppPath());
	// The portable agent dir is the only one the installer owns: seed it from the bundled
	// config/agent (settings, models, shipped extensions) before the first pi process starts.
	const startupConfig = resolvePiWin7Config({
		isPackaged: app.isPackaged,
		resourcesPath: process.resourcesPath,
	});
	if (startupConfig.agentDirSource === "portable") {
		syncBundledAgentDir(
			path.join(process.resourcesPath, "pi-win7", "config", "agent"),
			startupConfig.agentDir,
		);
	}
	Menu.setApplicationMenu(null);
	createWindow();
	ensureClient();
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});

let quitting = false;
app.on("before-quit", (event) => {
	// Hold the quit once so pi can run its shutdown hooks (bounded by STOP_GRACE_MS in the
	// client); the second pass, after the stop settled, lets the app go.
	if (quitting || !client) return;
	quitting = true;
	event.preventDefault();
	void stopClient().finally(() => app.quit());
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});
