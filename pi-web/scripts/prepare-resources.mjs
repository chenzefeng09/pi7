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
for (const file of ["ask-user.ts", "permission-gate.ts", "session-edit.ts", "web-search.ts"]) {
	fs.copyFileSync(path.join(sourceExtensions, file), path.join(targetExtensions, file));
}

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
