import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolvePiWin7Config, syncBundledAgentDir } from "./config";

let bundled = "";
let target = "";

function write(dir: string, rel: string, content: string): void {
	const file = join(dir, rel);
	mkdirSync(join(file, ".."), { recursive: true });
	writeFileSync(file, content);
}

function seedBundle(): void {
	write(bundled, "settings.json", `{"theme":"dark"}`);
	write(bundled, "models.json", `{"providers":[]}`);
	write(bundled, "auth.json", `{"secret":true}`);
	write(bundled, "extensions/ask-user.ts", "export default () => {}");
	write(bundled, "extensions/pi-todo/package.json", `{"name":"pi-todo","version":"1.0.0"}`);
	write(bundled, "extensions/pi-todo/src/index.ts", "export default () => {}");
}

beforeEach(() => {
	bundled = mkdtempSync(join(tmpdir(), "pi-web-bundle-"));
	target = mkdtempSync(join(tmpdir(), "pi-web-agent-"));
	seedBundle();
});

afterEach(() => {
	rmSync(bundled, { force: true, recursive: true });
	rmSync(target, { force: true, recursive: true });
});

describe("syncBundledAgentDir", () => {
	it("seeds a fresh agent dir without state files", () => {
		syncBundledAgentDir(bundled, target);
		expect(readFileSync(join(target, "settings.json"), "utf8")).toContain("dark");
		expect(readFileSync(join(target, "models.json"), "utf8")).toContain("providers");
		expect(existsSync(join(target, "auth.json"))).toBe(false);
		expect(existsSync(join(target, "extensions/ask-user.ts"))).toBe(true);
		expect(existsSync(join(target, "extensions/pi-todo/package.json"))).toBe(true);
	});

	it("keeps user-edited top-level files", () => {
		write(target, "settings.json", `{"theme":"light"}`);
		syncBundledAgentDir(bundled, target);
		expect(readFileSync(join(target, "settings.json"), "utf8")).toContain("light");
	});

	it("refreshes bundled files and keeps user-added entries", () => {
		write(target, "extensions/ask-user.ts", "// stale");
		write(target, "extensions/mine.ts", "// user file");
		syncBundledAgentDir(bundled, target);
		expect(readFileSync(join(target, "extensions/ask-user.ts"), "utf8")).not.toContain("stale");
		expect(readFileSync(join(target, "extensions/mine.ts"), "utf8")).toContain("user file");
	});

	it("replaces a vendored package dir when the shipped version differs", () => {
		cpSync(join(bundled, "extensions/pi-todo"), join(target, "extensions/pi-todo"), { recursive: true });
		write(target, "extensions/pi-todo/package.json", `{"name":"pi-todo","version":"0.9.0"}`);
		write(target, "extensions/pi-todo/src/old.ts", "// leftover from old version");
		syncBundledAgentDir(bundled, target);
		expect(readFileSync(join(target, "extensions/pi-todo/package.json"), "utf8")).toContain("1.0.0");
		expect(existsSync(join(target, "extensions/pi-todo/src/old.ts"))).toBe(false);
	});

	it("keeps a vendored package dir whose version matches", () => {
		cpSync(join(bundled, "extensions/pi-todo"), join(target, "extensions/pi-todo"), { recursive: true });
		write(target, "extensions/pi-todo/src/user-note.ts", "// user file inside package");
		syncBundledAgentDir(bundled, target);
		expect(existsSync(join(target, "extensions/pi-todo/src/user-note.ts"))).toBe(true);
	});
});

describe("resolvePiWin7Config (unpackaged)", () => {
	const env = { PI_CODING_AGENT_DIR: "" };

	it("prefers the synced runtime under resources/pi-win7", () => {
		const cli = process.platform === "win32" ? "cli.win7.js" : "cli.js";
		write(target, `resources/pi-win7/app/node_modules/@earendil-works/pi-coding-agent/dist/${cli}`, "");
		const config = resolvePiWin7Config({ appRoot: target, env, isPackaged: false, resourcesPath: "" });
		expect(config.cliPath).toBe(
			join(target, "resources", "pi-win7", "app", "node_modules", "@earendil-works", "pi-coding-agent", "dist", cli),
		);
		// No bundled node next to it: whatever `node` is on PATH runs the CLI.
		expect(config.nodePath).toBe("node");
	});

	it("falls back to the monorepo build output", () => {
		const config = resolvePiWin7Config({ appRoot: target, env, isPackaged: false, resourcesPath: "" });
		expect(config.cliPath).toBe(join(target, "..", "packages", "coding-agent", "dist", "cli.js"));
	});

	it("lets PI_WIN7_CLI / PI_WIN7_NODE override both", () => {
		const config = resolvePiWin7Config({
			appRoot: target,
			env: { ...env, PI_WIN7_CLI: "/x/cli.js", PI_WIN7_NODE: "/x/node" },
			isPackaged: false,
			resourcesPath: "",
		});
		expect(config.cliPath).toBe("/x/cli.js");
		expect(config.nodePath).toBe("/x/node");
	});
});
