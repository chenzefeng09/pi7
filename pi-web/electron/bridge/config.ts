import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractAll } from "@electron/asar";

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
 * per entry, so shipped plugins always match the app version. `npm.asar` packs the
 * vendored npm plugins as one archive — the Windows release zip pays per-file I/O
 * latency, so ~5k loose files there turned a 2-minute step into a 30-minute stall —
 * and is unpacked to <agent>/npm with the same seed-once semantics.
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
		if (entry.name.endsWith(".asar")) {
			const target = path.join(agentDir, entry.name.slice(0, -".asar".length));
			// Guard on a completion marker, not dir existence: an archive that throws
			// mid-extract leaves a partial tree that must be retried, not skipped forever.
			const marker = path.join(target, ".asar-extracted");
			if (!fs.existsSync(marker)) {
				try {
					extractAll(from, target);
					fs.writeFileSync(marker, "");
				} catch (error) {
					// A missing plugin set must not kill startup; the next launch retries.
					console.error(`failed to unpack ${entry.name}:`, error);
				}
			}
			continue;
		}
		if (!fs.existsSync(to)) {
			fs.cpSync(from, to, { recursive: true });
		}
	}
}

const RUNTIME_CLI_RELATIVE = ["app", "node_modules", "@earendil-works", "pi-coding-agent", "dist"];

/**
 * Where an unpackaged (dev) app finds pi when PI_WIN7_CLI / PI_WIN7_NODE are not set.
 *
 * First choice is the synced runtime under `<pi-web>/resources/pi-win7` — the same layout the
 * packaged app ships, which is what `npm run build:runtime` produces. Failing that, the monorepo
 * build output `packages/coding-agent/dist/cli.js` run by whatever `node` is on PATH.
 */
function resolveDevRuntime(appRoot: string): { cliPath: string; nodePath: string } {
	const isWin = process.platform === "win32";
	const runtimeRoot = path.join(appRoot, "resources", "pi-win7");
	const runtimeCli = path.join(runtimeRoot, ...RUNTIME_CLI_RELATIVE, isWin ? "cli.win7.js" : "cli.js");
	const runtimeNode = path.join(runtimeRoot, "node", isWin ? "node.exe" : "node");
	if (fs.existsSync(runtimeCli)) {
		return { cliPath: runtimeCli, nodePath: fs.existsSync(runtimeNode) ? runtimeNode : "node" };
	}
	return {
		cliPath: path.join(appRoot, "..", "packages", "coding-agent", "dist", "cli.js"),
		nodePath: fs.existsSync(runtimeNode) ? runtimeNode : "node",
	};
}

export function resolvePiWin7Config(options: ResolvePiWin7ConfigOptions): PiWin7Config {
	const env = options.env ?? process.env;
	const args = env.PI_WEB_NO_SESSION === "1" ? ["--mode", "rpc", "--no-session"] : ["--mode", "rpc"];
	const appRoot = options.appRoot ?? env.PI_WEB_APP_ROOT ?? process.cwd();
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
			cliPath: path.join(root, ...RUNTIME_CLI_RELATIVE, isWin ? "cli.win7.js" : "cli.js"),
			cwd: env.PI_WORKSPACE_CWD ?? process.cwd(),
			nodePath: path.join(root, "node", isWin ? "node.exe" : "node"),
			portableAgentDir,
		};
	}
	const dev = resolveDevRuntime(appRoot);
	return {
		agentDir,
		agentDirSource,
		args,
		cliPath: env.PI_WIN7_CLI ?? dev.cliPath,
		cwd: env.PI_WORKSPACE_CWD ?? process.cwd(),
		nodePath: env.PI_WIN7_NODE ?? dev.nodePath,
		portableAgentDir,
	};
}
