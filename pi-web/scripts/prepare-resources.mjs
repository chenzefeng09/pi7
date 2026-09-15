import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const runtimeRoot = path.join(root, "resources", "pi-win7");
const runtimeAgent = path.join(runtimeRoot, "config", "agent");
const defaultAgent = path.join(root, "config", "agent-default");
const sourceExtensions = path.join(root, "extensions");
const targetExtensions = path.join(runtimeAgent, "extensions");

// Base plugins that ship inside the installer. Each is vendored as a self-contained
// directory under config/agent/extensions/ so pi's extension discovery loads it without
// any settings entry, on a fresh portable agent dir as well as a seeded one.
const BUNDLED_EXTENSION_PACKAGES = [
	"@eggmasonvalue/pi-subagent@2.0.1",
	"pi-goal-x@0.31.2",
	"pi-plan-extension@0.1.0",
	"pi-sub2api-provider@0.6.0",
	"pi-todo@1.2.0",
	"pi-web-access@0.25.0",
];

const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

function run(cmd, argv, options = {}) {
	const result = spawnSync(cmd, argv, { stdio: "inherit", shell: true, ...options });
	if (result.status !== 0) {
		throw new Error(`command failed (${result.status}): ${cmd} ${argv.join(" ")}`);
	}
}

/** "@scope/name@1.2.3" -> "@scope/name", "name@1.2.3" -> "name". */
function specToPackageName(spec) {
	const at = spec.indexOf("@", spec.startsWith("@") ? 1 : 0);
	return at === -1 ? spec : spec.slice(0, at);
}

if (!fs.existsSync(runtimeAgent)) {
	throw new Error(`pi-win7 runtime is missing: ${runtimeAgent}`);
}

// The app runs a locally patched pi RPC mode (docs/pi-runtime-patch.md). Shipping a runtime
// without it silently downgrades session switching to "interrupt + restart", so refuse to
// package one unless the override is explicit.
const runtimeRpcMode = path.join(
	runtimeRoot,
	"app",
	"node_modules",
	"@earendil-works",
	"pi-coding-agent",
	"dist",
	"modes",
	"rpc",
	"rpc-mode.js",
);
const patched = fs.existsSync(runtimeRpcMode) && fs.readFileSync(runtimeRpcMode, "utf8").includes("multiSession");
if (!patched) {
	const message = [
		`pi-win7 runtime at ${runtimeRoot} is missing the local multi-session patch.`,
		"After upgrading pi: apply patches/pi-multi-session.patch, rebuild packages/coding-agent,",
		"then run `node scripts/sync-pi-runtime.mjs`. See docs/pi-runtime-patch.md.",
		"Set PI_WEB_ALLOW_UNPATCHED_RUNTIME=1 to package anyway (the app falls back to single-session mode).",
	].join("\n");
	if (process.env.PI_WEB_ALLOW_UNPATCHED_RUNTIME === "1") {
		console.warn(`warning: ${message}`);
	} else {
		throw new Error(message);
	}
}

fs.mkdirSync(targetExtensions, { recursive: true });
for (const file of ["settings.json", "models.json"]) {
	fs.copyFileSync(path.join(defaultAgent, file), path.join(runtimeAgent, file));
}
// web-search.ts is intentionally not shipped: pi-web-access provides web_search and the
// two would collide on the tool name.
const FILE_EXTENSIONS = ["ask-user.ts", "permission-gate.ts", "session-edit.ts"];
for (const entry of fs.readdirSync(targetExtensions)) {
	if (entry.endsWith(".ts")) {
		fs.rmSync(path.join(targetExtensions, entry), { force: true });
	}
}
for (const file of FILE_EXTENSIONS) {
	fs.copyFileSync(path.join(sourceExtensions, file), path.join(targetExtensions, file));
}

// Install the bundled packages with the default hoisted strategy into config/agent/npm,
// the same prefix layout `pi install npm:<pkg>` produces (settings.json packages entries
// resolve npm: sources against <agent>/npm/node_modules). Hoisting keeps the dependency
// tree flat; nested node_modules chains exceed Win7's 260-char MAX_PATH and silently fail
// to install. Peers are not installed (--legacy-peer-deps): the extension loader resolves
// pi APIs and typebox through its own aliases.
const npmPrefix = path.join(runtimeAgent, "npm");
fs.rmSync(npmPrefix, { force: true, recursive: true });
fs.mkdirSync(npmPrefix, { recursive: true });
const npmDependencies = {};
for (const spec of BUNDLED_EXTENSION_PACKAGES) {
	const at = spec.indexOf("@", spec.startsWith("@") ? 1 : 0);
	npmDependencies[specToPackageName(spec)] = spec.slice(at + 1);
}
fs.writeFileSync(
	path.join(npmPrefix, "package.json"),
	`${JSON.stringify({ name: "pi-extensions", private: true, dependencies: npmDependencies }, null, 2)}\n`,
);
run(NPM, [
	"install",
	"--prefix",
	npmPrefix,
	"--legacy-peer-deps",
	"--omit=dev",
	"--ignore-scripts",
	"--no-audit",
	"--no-fund",
]);
// Prune test/doc/example directories inside vendored dependencies: they ship no runtime
// value and their deep paths approach Win7's 260-char MAX_PATH under a nested install dir.
const PRUNE_DIRS = new Set(["test", "tests", "__tests__", "docs", "example", "examples"]);
function pruneNestedDirs(dir) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const full = path.join(dir, entry.name);
		if (PRUNE_DIRS.has(entry.name)) {
			fs.rmSync(full, { force: true, recursive: true });
			continue;
		}
		pruneNestedDirs(full);
	}
}
pruneNestedDirs(path.join(npmPrefix, "node_modules"));

// Drop any stale vendored package dirs from earlier builds; file extensions stay.
for (const entry of fs.readdirSync(targetExtensions, { withFileTypes: true })) {
	if (entry.isDirectory()) {
		fs.rmSync(path.join(targetExtensions, entry.name), { force: true, recursive: true });
	}
}
console.log(`installed ${BUNDLED_EXTENSION_PACKAGES.length} packages -> config/agent/npm`);

for (const entry of fs.readdirSync(targetExtensions)) {
	if (entry.endsWith("-test.ts")) {
		fs.rmSync(path.join(targetExtensions, entry), { force: true });
	}
}

for (const file of ["auth.json", "models-store.json"]) {
	fs.rmSync(path.join(runtimeAgent, file), { force: true });
}
fs.rmSync(path.join(runtimeAgent, "sessions"), { force: true, recursive: true });
fs.rmSync(path.join(runtimeAgent, "logs"), { force: true, recursive: true });

console.log(`Prepared bundled agent config at ${runtimeAgent}`);
