/**
 * Verify that the bundled pi runtime supports multiple sessions in one process.
 *
 * Run this after every pi runtime upgrade: the app depends on the locally patched RPC mode
 * (see docs/pi-runtime-patch.md) and a fresh upstream build silently removes it.
 *
 * Usage: node scripts/pi-multi-session-smoke.mjs [--cli <cli.win7.js>] [--node <node.exe>]
 *
 * Exits non-zero when a check fails, printing the report either way.
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
		join(piWebRoot, "resources", "pi-win7", "app", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.win7.js"),
);
const nodePath = resolve(argValue("--node") ?? process.env.PI_WIN7_NODE ?? join(piWebRoot, "resources", "pi-win7", "node", "node.exe"));

const root = mkdtempSync(join(tmpdir(), "pi-multi-session-"));
const agentDir = join(root, "agent");
const projectDir = join(root, "proj");
const sessionDir = join(agentDir, "sessions", "--proj--");
mkdirSync(sessionDir, { recursive: true });
mkdirSync(projectDir, { recursive: true });

// A second session file to open as a background session, plus a working shell for the
// concurrency check (the smoke test runs on machines where WSL bash may shadow Git Bash).
const seedId = "11111111-2222-3333-4444-555555555555";
const seedFile = join(sessionDir, `seed_${seedId}.jsonl`);
const raceSeedId = "99999999-8888-7777-6666-555555555555";
const raceSeedFile = join(sessionDir, `seed_${raceSeedId}.jsonl`);
const now = new Date().toISOString();
const seedLines = (id) => [
	JSON.stringify({ type: "session", version: 3, id, timestamp: now, cwd: projectDir }),
	JSON.stringify({
		type: "message",
		id: `${id}-1`,
		parentId: null,
		timestamp: now,
		message: { role: "user", content: [{ type: "text", text: "seed session" }] },
	}),
	"",
];
writeFileSync(seedFile, seedLines(seedId).join("\n"), "utf8");
writeFileSync(raceSeedFile, seedLines(raceSeedId).join("\n"), "utf8");
const settingsPath = join(agentDir, "settings.json");
writeFileSync(settingsPath, JSON.stringify({ shellPath: process.env.PI_SMOKE_SHELL ?? "bash" }, null, "\t"), "utf8");

const child = spawn(nodePath, [cli, "--mode", "rpc"], {
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
function send(command, timeoutMs = 120000) {
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
	await sleep(2500);

	const capabilities = await send({ type: "get_capabilities" });
	check("get_capabilities reports multiSession", capabilities.data?.multiSession === true, capabilities.data);
	check("protocol version is 2", capabilities.data?.protocolVersion === 2, capabilities.data?.protocolVersion);

	const initial = await send({ type: "get_open_sessions" });
	check("starts with one open session", initial.data?.sessions?.length === 1, initial.data?.sessions?.length);

	const dedupe = await send({ type: "open_session", sessionPath: initial.data.sessions[0].sessionFile });
	check(
		"opening the active session again returns its handle",
		dedupe.data?.sessionId === initial.data.sessions[0].sessionId,
		dedupe.data?.sessionId,
	);

	const opened = await send({ type: "open_session", sessionPath: seedFile, activate: false });
	check("open_session loads a second session", opened.data?.sessionId === "s2", opened.data);
	check("opening without activate keeps the active session", (await send({ type: "get_open_sessions" })).data?.activeSessionId === "s1", null);

	const started = Date.now();
	const [, second] = await Promise.all([
		send({ type: "bash", command: "echo a-start && sleep 2 && echo a-end", sessionId: "s1" }, 90000),
		send({ type: "bash", command: "echo b-start && sleep 2 && echo b-end", sessionId: opened.data.sessionId }, 90000),
	]);
	const elapsed = Date.now() - started;
	check("two sessions run commands concurrently", elapsed < 3600, `${elapsed}ms (serial would be ~4200ms)`);
	check("background session command succeeded", second.data?.exitCode === 0, second.data?.exitCode);

	const eventLines = lines.filter((line) => line.type !== "response");
	const eventSessionIds = [...new Set(eventLines.map((line) => line.sessionId))];
	check("events were emitted at all", eventLines.length > 0, eventLines.length);
	check("every event carries a sessionId", eventLines.every((line) => line.sessionId), eventSessionIds);
	check("both sessions emitted events", eventSessionIds.includes("s1") && eventSessionIds.includes("s2"), eventSessionIds);

	const clash = await send({ type: "switch_session", sessionPath: seedFile });
	check("switching to an already open session file is refused", clash.success === false, clash.error);

	// Closing a handle that is in the middle of a command must abort it cleanly and leave the
	// process healthy - the app archives sessions the user may be running.
	const busy = send({ type: "bash", command: "echo start && sleep 8 && echo end", sessionId: opened.data.sessionId }, 90000);
	await sleep(1200);
	const closed = await send({ type: "close_session", sessionId: opened.data.sessionId });
	check("close_session drops the handle", closed.data?.closed === true, closed.data);
	check("active session falls back after close", closed.data?.activeSessionId === "s1", closed.data?.activeSessionId);
	const busyResult = await busy;
	check(
		"a command running in the closed handle is aborted",
		!(busyResult.data?.output ?? "").includes("end"),
		(busyResult.data?.output ?? "").trim(),
	);
	check(
		"the remaining session still runs commands",
		((await send({ type: "bash", command: "echo alive", sessionId: "s1" })).data?.output ?? "").trim() === "alive",
		null,
	);

	// Two opens of one file racing (double click) must land on a single runtime: pi appends to
	// the JSONL without locking, so a second runtime would corrupt the transcript.
	const [raceA, raceB] = await Promise.all([
		send({ type: "open_session", sessionPath: raceSeedFile, activate: false }),
		send({ type: "open_session", sessionPath: raceSeedFile, activate: false }),
	]);
	check(
		"concurrent opens of one session file share a handle",
		raceA.data?.sessionId !== undefined && raceA.data?.sessionId === raceB.data?.sessionId,
		[raceA.data?.sessionId, raceB.data?.sessionId],
	);
	// State of a background handle must be readable while another session is visible: this is
	// what the app does when it projects a background session back onto the screen.
	const backgroundHandle = raceA.data?.sessionId;
	const backgroundState = await send({ type: "get_state", sessionId: backgroundHandle });
	check(
		"get_state reads a background handle",
		backgroundState.success === true && backgroundState.data?.sessionId === raceSeedId,
		backgroundState.data?.sessionId ?? backgroundState.error,
	);
	const backgroundMessages = await send({ type: "get_messages", sessionId: backgroundHandle });
	check(
		"get_messages reads a background handle",
		Array.isArray(backgroundMessages.data?.messages) && backgroundMessages.data.messages.length === 1,
		backgroundMessages.data?.messages?.length ?? backgroundMessages.error,
	);
	check(
		"reading a background handle does not change the active one",
		(await send({ type: "get_open_sessions" })).data?.activeSessionId === "s1",
		null,
	);
	if (backgroundHandle) await send({ type: "close_session", sessionId: backgroundHandle });

	const lastClose = await send({ type: "close_session", sessionId: "s1" });
	check("the last session cannot be closed", typeof lastClose.error === "string", lastClose.error);

	const unknown = await send({ type: "get_state", sessionId: "nope" });
	check("unknown sessionId is rejected", typeof unknown.error === "string", unknown.error);
} catch (error) {
	check("smoke test completed", false, error instanceof Error ? error.message : String(error));
} finally {
	child.kill();
}

const failed = checks.filter((item) => !item.ok);
for (const item of checks) {
	console.log(`${item.ok ? "ok  " : "FAIL"} ${item.name}${item.detail === undefined || item.detail === null ? "" : ` (${JSON.stringify(item.detail)})`}`);
}
if (failed.length > 0) {
	console.log(`\n${failed.length} check(s) failed - the bundled pi runtime is missing the multi-session patch.`);
	console.log("Rebuild and re-sync it: see docs/pi-runtime-patch.md");
	if (stderr.trim()) console.log(`\npi stderr:\n${stderr.trim().split("\n").slice(-8).join("\n")}`);
	process.exit(1);
}
console.log(`\nall ${checks.length} checks passed`);
