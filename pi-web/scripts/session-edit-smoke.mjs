/**
 * Verify that the `session-edit` extension rewinds a session in place.
 *
 * Runs the same win7 runtime the app spawns, over RPC, against a scratch agent dir that holds a
 * copy of extensions/session-edit.ts. A seeded session with two prompts is rewound to the first
 * one; the checks are that the transcript shrinks to what came before that prompt and that the
 * prompt itself comes back through the editor bridge.
 *
 * Usage: node scripts/session-edit-smoke.mjs [--cli <cli.win7.js>] [--node <node.exe>]
 */
import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const piWebRoot = resolve(here, "..");
const args = process.argv.slice(2);
const argValue = (name) => {
	const index = args.indexOf(name);
	return index >= 0 ? args[index + 1] : undefined;
};

const cli = resolve(
	argValue("--cli") ??
		process.env.PI_WIN7_CLI ??
		join(
			piWebRoot,
			"resources",
			"pi-win7",
			"app",
			"node_modules",
			"@earendil-works",
			"pi-coding-agent",
			"dist",
			"cli.win7.js",
		),
);
const nodePath = resolve(
	argValue("--node") ?? process.env.PI_WIN7_NODE ?? join(piWebRoot, "resources", "pi-win7", "node", "node.exe"),
);

const root = mkdtempSync(join(tmpdir(), "pi-session-edit-"));
const agentDir = join(root, "agent");
const projectDir = join(root, "proj");
const extensionsDir = join(agentDir, "extensions");
const sessionDir = join(agentDir, "sessions", "--proj--");
mkdirSync(extensionsDir, { recursive: true });
mkdirSync(sessionDir, { recursive: true });
mkdirSync(projectDir, { recursive: true });
copyFileSync(join(piWebRoot, "extensions", "session-edit.ts"), join(extensionsDir, "session-edit.ts"));
writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ shellPath: "bash" }, null, "\t"), "utf8");

const sessionId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const sessionFile = join(sessionDir, `seed_${sessionId}.jsonl`);
const now = new Date().toISOString();
const entry = (id, parentId, role, text) => ({
	type: "message",
	id,
	parentId,
	timestamp: now,
	message: { role, content: [{ type: "text", text }] },
});
writeFileSync(
	sessionFile,
	[
		JSON.stringify({ type: "session", version: 3, id: sessionId, timestamp: now, cwd: projectDir }),
		JSON.stringify(entry("e1", null, "user", "第一个问题")),
		JSON.stringify(entry("e2", "e1", "assistant", "第一个回答")),
		JSON.stringify(entry("e3", "e2", "user", "第二个问题")),
		JSON.stringify(entry("e4", "e3", "assistant", "第二个回答")),
		"",
	].join("\n"),
	"utf8",
);

const child = spawn(nodePath, [cli, "--mode", "rpc", "--session", sessionFile], {
	cwd: projectDir,
	env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1" },
	stdio: ["pipe", "pipe", "pipe"],
});

const lines = [];
const pending = new Map();
let buffer = "";
let stderr = "";
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
	buffer += chunk;
	let index = buffer.indexOf("\n");
	while (index >= 0) {
		const line = buffer.slice(0, index);
		buffer = buffer.slice(index + 1);
		index = buffer.indexOf("\n");
		if (!line.trim()) continue;
		let parsed;
		try {
			parsed = JSON.parse(line);
		} catch {
			continue;
		}
		lines.push(parsed);
		if (parsed.type === "response" && parsed.id && pending.has(parsed.id)) {
			pending.get(parsed.id)(parsed);
			pending.delete(parsed.id);
		}
	}
});
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
	stderr += chunk;
});

let nextId = 1;
function send(command, timeoutMs = 60000) {
	const id = `c${nextId++}`;
	return new Promise((resolvePromise, reject) => {
		const timer = setTimeout(() => {
			pending.delete(id);
			reject(new Error(`timeout for ${command.type}`));
		}, timeoutMs);
		pending.set(id, (response) => {
			clearTimeout(timer);
			resolvePromise(response);
		});
		child.stdin.write(`${JSON.stringify({ ...command, id })}\n`);
	});
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const checks = [];
const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail });

try {
	await sleep(3000);

	const commands = await send({ type: "get_commands" });
	const names = (commands.data?.commands ?? []).map((command) => command.name);
	check("extension command is loaded", names.includes("session-edit"), names.slice(0, 8));

	const before = await send({ type: "get_messages" });
	const beforeTexts = (before.data?.messages ?? []).map((message) => message.content?.[0]?.text);
	check("seeded transcript is complete", beforeTexts.length === 4, beforeTexts);

	// Rewind to the first prompt: it, and everything after it, must leave the active branch.
	await send({ type: "prompt", message: "/session-edit e1" });
	await sleep(1200);

	const after = await send({ type: "get_messages" });
	const afterTexts = (after.data?.messages ?? []).map((message) => message.content?.[0]?.text);
	check("transcript rewinds to before the edited prompt", afterTexts.length === 0, afterTexts);

	const editorRequest = lines.find(
		(line) => line.type === "extension_ui_request" && line.method === "set_editor_text",
	);
	check("prompt text comes back through the editor bridge", editorRequest?.text === "第一个问题", editorRequest);

	// The rewound session must accept a new prompt at that point, continuing the same file.
	const state = await send({ type: "get_state" });
	check("session file is unchanged", state.data?.sessionFile === sessionFile, state.data?.sessionFile);

	const second = await send({ type: "prompt", message: "/session-edit e3" });
	check("rewinding to the second prompt is accepted again", second.success === true, second.error);
} catch (error) {
	check("run completed", false, error instanceof Error ? error.message : String(error));
} finally {
	child.kill();
}

for (const result of checks) {
	console.log(`${result.ok ? "ok  " : "FAIL"} ${result.name}${result.ok ? "" : ` -> ${JSON.stringify(result.detail)}`}`);
}
const uiRequests = lines.filter((line) => line.type === "extension_ui_request");
if (uiRequests.length > 0) {
	console.log(`--- extension ui requests ---\n${uiRequests.map((line) => JSON.stringify(line)).join("\n")}`);
}
if (stderr.trim()) console.log(`--- stderr ---\n${stderr.trim().slice(0, 2000)}`);
process.exit(checks.every((result) => result.ok) ? 0 : 1);
