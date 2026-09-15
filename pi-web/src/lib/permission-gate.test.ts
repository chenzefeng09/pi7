import { describe, expect, it } from "vitest";
import { decide, insideWorkspace, outsidePaths } from "../../extensions/permission-gate";

const ROOT = "D:\\work\\project";

describe("insideWorkspace", () => {
	it("accepts the root itself and paths under it", () => {
		expect(insideWorkspace(ROOT, ".")).toBe(true);
		expect(insideWorkspace(ROOT, "src/app.ts")).toBe(true);
		expect(insideWorkspace(ROOT, "D:\\work\\project\\nested\\deep\\file.md")).toBe(true);
		expect(insideWorkspace(ROOT, "D:/work/project/other.ts")).toBe(true);
		expect(insideWorkspace(ROOT, "D:\\WORK\\PROJECT\\Case.ts")).toBe(true);
	});

	it("rejects siblings, parents and other drives", () => {
		expect(insideWorkspace(ROOT, "..")).toBe(false);
		expect(insideWorkspace(ROOT, "../sibling/file.ts")).toBe(false);
		expect(insideWorkspace(ROOT, "D:\\work\\other\\file.ts")).toBe(false);
		expect(insideWorkspace(ROOT, "C:\\Users\\me\\.ssh\\id_rsa")).toBe(false);
		expect(insideWorkspace(ROOT, "/etc/passwd")).toBe(false);
	});
});

describe("outsidePaths", () => {
	it("finds escapes and ignores commands that stay inside", () => {
		expect(outsidePaths("npm run build", ROOT)).toEqual([]);
		expect(outsidePaths("node scripts/build.mjs --out dist", ROOT)).toEqual([]);
		expect(outsidePaths("cat src/app.ts", ROOT)).toEqual([]);
		expect(outsidePaths("rm -rf ../other", ROOT)).toEqual(["../other"]);
		expect(outsidePaths("cat /etc/passwd", ROOT)).toEqual(["/etc/passwd"]);
		expect(outsidePaths("echo hi > C:\\Windows\\Temp\\x.txt", ROOT)).toEqual(["C:\\Windows\\Temp\\x.txt"]);
		expect(outsidePaths("cd .. && rm -rf project", ROOT)).toEqual([".."]);
	});

	it("does not mistake urls or flags for paths", () => {
		expect(outsidePaths("curl https://example.com/data.json", ROOT)).toEqual([]);
		expect(outsidePaths("git log --format=%H", ROOT)).toEqual([]);
		expect(outsidePaths("npm exec --prefix ./tools run lint", ROOT)).toEqual([]);
	});
});

describe("decide", () => {
	it("lets everything through in full mode", () => {
		expect(decide("full", "bash", { command: "rm -rf /" }, ROOT).allow).toBe(true);
		expect(decide("full", "write", { path: "C:\\Windows\\x" }, ROOT).allow).toBe(true);
	});

	it("blocks every mutating tool in read-only mode", () => {
		for (const tool of ["bash", "edit", "powershell", "write"]) {
			expect(decide("read-only", tool, { path: "src/a.ts", command: "ls" }, ROOT).allow).toBe(false);
		}
		expect(decide("read-only", "read", { path: "C:\\anywhere" }, ROOT).allow).toBe(true);
		expect(decide("read-only", "grep", { pattern: "x" }, ROOT).allow).toBe(true);
	});

	it("keeps file tools inside the workspace in workspace-write mode", () => {
		expect(decide("workspace-write", "write", { path: "src/new.ts" }, ROOT).allow).toBe(true);
		expect(decide("workspace-write", "edit", { path: "D:\\work\\project\\a.ts" }, ROOT).allow).toBe(true);
		const outside = decide("workspace-write", "write", { path: "D:\\other\\a.ts" }, ROOT);
		expect(outside.allow).toBe(false);
		expect(outside.reason).toContain("工作区之外");
	});

	it("refuses shell commands that name paths outside, and allows the rest", () => {
		expect(decide("workspace-write", "bash", { command: "npm test" }, ROOT).allow).toBe(true);
		expect(decide("workspace-write", "bash", { command: "git status" }, ROOT).allow).toBe(true);
		const escape = decide("workspace-write", "bash", { command: "cp secret.txt C:\\Users\\me\\Desktop\\" }, ROOT);
		expect(escape.allow).toBe(false);
		expect(escape.reason).toContain("工作区外的路径");
	});

	it("leaves tools it does not police alone", () => {
		expect(decide("workspace-write", "todo", {}, ROOT).allow).toBe(true);
		expect(decide("read-only", "todo", {}, ROOT).allow).toBe(true);
	});
});
