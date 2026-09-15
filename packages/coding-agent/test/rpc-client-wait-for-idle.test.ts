import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { RpcClient } from "../src/modes/rpc/rpc-client.ts";

const tempDirs: string[] = [];

function writeChildScript(contents: string): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-rpc-client-idle-"));
	tempDirs.push(dir);
	const path = join(dir, "child.mjs");
	writeFileSync(path, contents);
	return path;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("RpcClient waitForIdle", () => {
	// Regression: the prompt response is emitted at preflight acceptance, before agent_start.
	// A waitForIdle that only watches events resolved in the gap between the two, letting a
	// caller proceed while the run was just starting.
	test("stays pending after an accepted prompt until agent_settled arrives", async () => {
		const client = new RpcClient({
			cliPath: writeChildScript(`
let buffer = "";
process.stdin.on("data", (chunk) => {
	buffer += chunk;
	let index;
	while ((index = buffer.indexOf("\\n")) >= 0) {
		const line = buffer.slice(0, index);
		buffer = buffer.slice(index + 1);
		if (!line.trim()) continue;
		const command = JSON.parse(line);
		if (command.type === "prompt") {
			process.stdout.write(JSON.stringify({ id: command.id, type: "response", command: "prompt", success: true, data: { started: true, sessionId: "s1" } }) + "\\n");
			process.stdout.write(JSON.stringify({ type: "agent_start", sessionId: "s1" }) + "\\n");
		} else if (command.type === "get_state") {
			process.stdout.write(JSON.stringify({ type: "agent_settled", sessionId: "s1" }) + "\\n");
			process.stdout.write(JSON.stringify({ id: command.id, type: "response", command: "get_state", success: true, data: {} }) + "\\n");
		}
	}
});
process.stdin.resume();
`),
		});

		await client.start();
		try {
			await client.prompt("hi");
			let idle = false;
			const waiting = client.waitForIdle(5000).then(() => {
				idle = true;
			});
			await new Promise((resolve) => setTimeout(resolve, 250));
			expect(idle).toBe(false);
			// The fake agent settles its run when the next command arrives.
			await client.getState();
			await waiting;
			expect(idle).toBe(true);
		} finally {
			await client.stop();
		}
	});
});
