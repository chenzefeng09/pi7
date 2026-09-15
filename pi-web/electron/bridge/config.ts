import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface PiWin7Config {
	agentDir: string;
	agentDirSource: "bundled" | "env" | "home" | "portable";
	args: string[];
	cliPath: string;
	cwd: string;
	nodePath: string;
	portableAgentDir: string;
}

export interface ResolvePiWin7ConfigOptions {
	appRoot?: string;
	env?: NodeJS.ProcessEnv;
	isPackaged: boolean;
	resourcesPath: string;
}

function hasAuth(dir: string): boolean {
	return fs.existsSync(path.join(dir, "auth.json"));
}

/** Config that travels with the app folder: <app root>/data/agent. */
export function resolvePortableAgentDir(options: ResolvePiWin7ConfigOptions): string {
	const env = options.env ?? process.env;
	const root = options.appRoot ?? env.PI_WEB_APP_ROOT ?? process.cwd();
	return path.join(root, "data", "agent");
}

/** Agent state that is never seeded from the bundle into a user-writable dir. */
const SEED_SKIP_ENTRIES = new Set([
	"archive",
	"auth.json",
	"logs",
	"models-store.json",
	"secrets.json",
	"sessions",
	"trust.json",
]);

function readPackageVersion(dir: string): string | undefined {
	try {
		const manifest = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as {
			version?: unknown;
		};
		return typeof manifest.version === "string" ? manifest.version : undefined;
	} catch {
		return undefined;
	}
}

function filesEqual(a: string, b: string): boolean {
	try {
		return fs.readFileSync(a).equals(fs.readFileSync(b));
	} catch {
		return false;
	}
}

/**
 * Refresh bundled extensions inside the user-writable extensions dir.
 *
 * Bundled entries are app-managed: missing entries are copied, package dirs are replaced
 * when the shipped version differs, and bundled files are refreshed when their content
 * changed. Entries the user added themselves are left alone.
 */
function syncBundledExtensionsDir(bundledDir: string, targetDir: string): void {
	fs.mkdirSync(targetDir, { recursive: true });
	for (const entry of fs.readdirSync(bundledDir, { withFileTypes: true })) {
		const from = path.join(bundledDir, entry.name);
		const to = path.join(targetDir, entry.name);
		const targetIsDir = fs.existsSync(to) && fs.statSync(to).isDirectory();
		if (entry.isDirectory()) {
			if (!targetIsDir) {
				fs.rmSync(to, { force: true, recursive: true });
				fs.cpSync(from, to, { recursive: true });
				continue;
			}
			const bundledVersion = readPackageVersion(from);
			if (bundledVersion !== undefined && bundledVersion !== readPackageVersion(to)) {
				fs.rmSync(to, { force: true, recursive: true });
				fs.cpSync(from, to, { recursive: true });
			}
			continue;
		}
		if (targetIsDir || !filesEqual(from, to)) {
			fs.rmSync(to, { force: true, recursive: true });
			fs.copyFileSync(from, to);
		}
	}
}

/**
 * Sync the bundled agent template into a user-writable agent dir.
 *
 * Top-level entries (settings.json, models.json, skills/, ...) are filled in only when
 * missing, so user edits survive app upgrades. extensions/ is app-managed and refreshed
 * per entry, so shipped plugins always match the app version.
 */
export function syncBundledAgentDir(bundledAgentDir: string, agentDir: string): void {
	if (!fs.existsSync(bundledAgentDir)) return;
	if (path.resolve(bundledAgentDir) === path.resolve(agentDir)) return;
	for (const entry of fs.readdirSync(bundledAgentDir, { withFileTypes: true })) {
		if (SEED_SKIP_ENTRIES.has(entry.name)) continue;
		const from = path.join(bundledAgentDir, entry.name);
		const to = path.join(agentDir, entry.name);
		if (entry.isDirectory() && entry.name === "extensions") {
			syncBundledExtensionsDir(from, to);
			continue;
		}
		if (!fs.existsSync(to)) {
			fs.cpSync(from, to, { recursive: true });
		}
	}
}

const DEV_NODE = "C:\\Users\\27581\\AppData\\Local\\nvm\\v16.20.2\\node.exe";
const DEV_CLI =
	"C:\\Users\\27581\\AppData\\Local\\Temp\\pi-win7-app-20260910000203\\node_modules\\@earendil-works\\pi-coding-agent\\dist\\cli.win7.js";

export function resolvePiWin7Config(options: ResolvePiWin7ConfigOptions): PiWin7Config {
	const env = options.env ?? process.env;
	const args = env.PI_WEB_NO_SESSION === "1" ? ["--mode", "rpc", "--no-session"] : ["--mode", "rpc"];
	const portableAgentDir = resolvePortableAgentDir(options);
	const homeAgentDir = path.join(os.homedir(), ".pi", "agent");
	const fromEnv = typeof env.PI_CODING_AGENT_DIR === "string" && env.PI_CODING_AGENT_DIR.length > 0;
	// Portable config wins over the bundled copy and the home directory: put auth.json in
	// <app root>/data/agent and everything (skills, models, sessions) travels with the app.
	const pick = (): { dir: string; source: PiWin7Config["agentDirSource"] } => {
		if (fromEnv) return { dir: env.PI_CODING_AGENT_DIR as string, source: "env" };
		if (hasAuth(portableAgentDir)) return { dir: portableAgentDir, source: "portable" };
		if (hasAuth(homeAgentDir)) return { dir: homeAgentDir, source: "home" };
		return { dir: portableAgentDir, source: "portable" };
	};
	const { dir: agentDir, source: agentDirSource } = pick();
	if (options.isPackaged) {
		const root = path.join(options.resourcesPath, "pi-win7");
		// The bundled runtime ships a platform Node binary and two CLI entries: cli.win7.js
		// targets the Node 16 bundled for Windows 7, cli.js is the normal entry the
		// modern bundled Node runs on macOS and Linux.
		const isWin = process.platform === "win32";
		return {
			agentDir,
			agentDirSource,
			args,
			cliPath: path.join(
				root,
				"app",
				"node_modules",
				"@earendil-works",
				"pi-coding-agent",
				"dist",
				isWin ? "cli.win7.js" : "cli.js",
			),
			cwd: env.PI_WORKSPACE_CWD ?? process.cwd(),
			nodePath: path.join(root, "node", isWin ? "node.exe" : "node"),
			portableAgentDir,
		};
	}
	return {
		agentDir,
		agentDirSource,
		args,
		cliPath: env.PI_WIN7_CLI ?? DEV_CLI,
		cwd: env.PI_WORKSPACE_CWD ?? process.cwd(),
		nodePath: env.PI_WIN7_NODE ?? DEV_NODE,
		portableAgentDir,
	};
}
