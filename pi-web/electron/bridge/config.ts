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
				"cli.win7.js",
			),
			cwd: env.PI_WORKSPACE_CWD ?? process.cwd(),
			nodePath: path.join(root, "node", "node.exe"),
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
