import { describe, expect, it } from "vitest";
import type { ToolCallBlock } from "../../state/types";
import {
	deriveToolPresentation,
	diffRowsFromPatch,
	displayPath,
	parseShellResult,
	promptLabel,
} from "./presentation";

function call(toolName: string, args: unknown, output = "", overrides: Partial<ToolCallBlock> = {}): ToolCallBlock {
	return {
		args,
		output,
		state: "complete",
		toolCallId: "call-1",
		toolName,
		type: "toolCall",
		...overrides,
	};
}

describe("shell results", () => {
	it("splits the exit-code trailer off the output", () => {
		expect(parseShellResult("boom\nline 2\n\nCommand exited with code 1")).toEqual({
			exitCode: 1,
			stdout: "boom\nline 2",
		});
	});

	it("reads an aborted command as stopped, not as a failure code", () => {
		expect(parseShellResult("partial\n\nCommand aborted")).toEqual({ failure: "已停止", stdout: "partial" });
	});

	it("leaves a clean result untouched", () => {
		expect(parseShellResult("ok\n")).toEqual({ stdout: "ok\n" });
	});
});

describe("tool presentation", () => {
	it("summarises a bash call by its first command line", () => {
		const view = deriveToolPresentation(call("bash", { command: "npm run check\nnpm test" }));
		expect(view).toMatchObject({ icon: "terminal", state: "ok", summary: "npm run check", title: "Bash" });
		expect(view.body).toMatchObject({ command: "npm run check\nnpm test", kind: "terminal", running: false });
	});

	it("marks a failed command red and shows the failure's first line", () => {
		const view = deriveToolPresentation(
			call("bash", { command: "tsc" }, "src/a.ts(3,5): error TS2322\nmore\n\nCommand exited with code 2", {
				state: "error",
			}),
		);
		expect(view.state).toBe("error");
		expect(view.errorSummary).toBe("src/a.ts(3,5): error TS2322");
		expect(view.body).toMatchObject({ exitCode: 2, kind: "terminal" });
	});

	it("treats an aborted command as stopped", () => {
		const view = deriveToolPresentation(call("bash", { command: "sleep 10" }, "x\n\nCommand aborted", { state: "error" }));
		expect(view.state).toBe("stopped");
	});

	it("relativizes a read path and numbers its window", () => {
		const view = deriveToolPresentation(
			call("read", { limit: 3, offset: 41, path: "D:\\work\\src\\a.ts" }, "one\ntwo\nthree\n\n[7 more lines in file. Use offset=44 to continue.]"),
			"D:/work",
		);
		expect(view).toMatchObject({ icon: "browse", summary: "src/a.ts", title: "读取" });
		expect(view.body).toMatchObject({ kind: "read", lines: ["one", "two", "three"], startLine: 41, totalLines: 50 });
	});

	it("counts an edit's diff and keeps only the changed lines", () => {
		const patch = [
			"--- D:/work/a.ts",
			"+++ D:/work/a.ts",
			"@@ -1,3 +1,4 @@",
			" keep",
			"-old",
			"+new",
			"+extra",
			"@@ -20,2 +21,1 @@",
			"-gone",
		].join("\n");
		const view = deriveToolPresentation(call("edit", { path: "D:/work/a.ts" }, "ok", { details: { patch } }), "D:/work");
		expect(view.summary).toBe("a.ts");
		expect(view.suffix).toBe("+2 -2");
		expect(view.body).toMatchObject({ files: 1, kind: "diff" });
		const rows = view.body.kind === "diff" ? view.body.rows : [];
		expect(rows.map((row) => row.kind)).toEqual(["path", "del", "add", "add", "gap", "del"]);
	});

	it("derives a whole-file diff for a write", () => {
		const view = deriveToolPresentation(call("write", { content: "a\nb\n", path: "D:/work/new.ts" }), "D:/work");
		expect(view).toMatchObject({ icon: "write", suffix: "+2 -0", summary: "new.ts", title: "写入" });
		expect(view.body.kind === "diff" && view.body.rows.map((row) => row.kind)).toEqual(["path", "add", "add"]);
	});

	it("groups grep matches under their files", () => {
		const output = "src/a.ts:12: const x = 1\nsrc/a.ts:40: const y = 2\nsrc/b.ts:3: const z = 3";
		const view = deriveToolPresentation(call("grep", { pattern: "const" }, output));
		expect(view).toMatchObject({ icon: "search", summary: "const", title: "Grep" });
		expect(view.body).toMatchObject({ files: 2, kind: "search", matches: 3 });
	});

	it("lists find results as paths", () => {
		const view = deriveToolPresentation(call("find", { pattern: "*.ts" }, "src/a.ts\nsrc/b.ts"));
		expect(view).toMatchObject({ icon: "search", summary: "*.ts", title: "Glob" });
		expect(view.body).toMatchObject({ kind: "paths", paths: ["src/a.ts", "src/b.ts"] });
	});

	it("renders a web search as an answer plus sources", () => {
		const details = {
			curatedQueries: [{ sources: [{ title: "Docs", url: "https://example.com/a" }] }],
			summary: { text: "## 结论" },
		};
		const view = deriveToolPresentation(call("web_search", { queries: ["deepseek v4", "kimi k3"] }, "## 结论", { details }));
		expect(view).toMatchObject({ icon: "globe", summary: "deepseek v4, kimi k3", title: "网页搜索" });
		expect(view.body).toMatchObject({
			answer: "## 结论",
			kind: "web",
			sources: [{ title: "Docs", url: "https://example.com/a" }],
		});
	});

	it("shows a fetch's meta beside its content", () => {
		const details = { status: 200, totalChars: 1200, truncated: true, urls: ["https://example.com"] };
		const view = deriveToolPresentation(call("fetch_content", { mode: "readable", url: "https://example.com" }, "body", { details }));
		expect(view).toMatchObject({ icon: "browse", summary: "https://example.com", title: "网页获取" });
		expect(view.body).toMatchObject({ kind: "fetch", meta: ["HTTP 200", "1200 字符", "内容已截断"] });
	});

	it("summarises a todo list by its progress", () => {
		const details = { todos: [{ status: "done", text: "one" }, { text: "two" }] };
		const view = deriveToolPresentation(call("todo_write", {}, "ok", { details }));
		expect(view).toMatchObject({ icon: "checklist", summary: "1/2 已完成", title: "更新任务清单" });
		expect(view.body).toMatchObject({ kind: "todos", todos: [{ done: true, text: "one" }, { done: false, text: "two" }] });
	});

	it("falls back to an input/output card for an unknown tool", () => {
		const view = deriveToolPresentation(call("mystery_tool", { q: "hi" }, "done"));
		expect(view).toMatchObject({ icon: "sparkle", summary: "hi", title: "工具调用" });
		expect(view.body.kind).toBe("io");
	});

	it("names an unknown tool when its arguments carry no string", () => {
		const view = deriveToolPresentation(call("mystery_tool", { n: 3 }));
		expect(view.summary).toBe("mystery_tool");
	});

	it("keeps a running row without an argument summary readable", () => {
		const view = deriveToolPresentation(call("bash", {}, "", { state: "running" }));
		expect(view.state).toBe("running");
		expect(view.summary).toBe("运行中");
	});
});

describe("path display", () => {
	it("relativizes a path under the session cwd", () => {
		expect(displayPath("D:\\work\\src\\a.ts", "D:/work")).toBe("src/a.ts");
	});

	it("leaves a path outside the cwd alone", () => {
		expect(displayPath("C:\\other\\a.ts", "D:/work")).toBe("C:/other/a.ts");
	});

	it("labels the shell prompt with the cwd's last segment", () => {
		expect(promptLabel("D:\\chenzefeng\\Develop\\pi")).toBe("pi");
		expect(promptLabel(undefined)).toBeUndefined();
	});
});

describe("diff patch rows", () => {
	it("drops context lines and marks a second hunk with a gap", () => {
		const rows = diffRowsFromPatch(
			["+++ a.ts", "@@ -1 +1 @@", " ctx", "+add", "@@ -9 +9 @@", "-del"].join("\n"),
		);
		expect(rows).toEqual([
			{ kind: "path", text: "a.ts" },
			{ kind: "add", text: "add" },
			{ kind: "gap", text: "⋯" },
			{ kind: "del", text: "del" },
		]);
	});
});
