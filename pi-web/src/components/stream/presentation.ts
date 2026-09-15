import type { ToolCallBlock } from "../../state/types";
import type { DiffRow } from "./blocks";
import type { RowState } from "./rows";

/** Icon keys the row layer maps to lucide components, so the derivation stays testable. */
export type ToolIconName = "browse" | "checklist" | "edit" | "globe" | "search" | "sparkle" | "terminal" | "write";

export type ToolBody =
	| { kind: "none" }
	| { kind: "terminal"; command: string; exitCode?: number; failure?: string; output: string; running: boolean }
	| { kind: "diff"; files: number; rows: DiffRow[] }
	| { kind: "read"; label: string; lines: string[]; startLine: number; totalLines?: number }
	| { kind: "paths"; paths: string[] }
	| {
			kind: "search";
			files: number;
			groups: { matches: { line: number; text: string }[]; path: string }[];
			matches: number;
	  }
	| { kind: "web"; answer?: string; sources: { snippet?: string; title: string; url: string }[] }
	| { kind: "fetch"; content: string; meta: string[]; url: string }
	| { kind: "todos"; todos: { done: boolean; text: string }[] }
	| { kind: "subagent"; model?: string; resultText?: string; status: string; task?: string; toolCalls: number }
	| { kind: "io"; input?: string; output?: string };

export interface ToolPresentation {
	body: ToolBody;
	/** First line of a failure, shown instead of the normal summary on an error row. */
	errorSummary?: string;
	icon: ToolIconName;
	state: RowState;
	suffix?: string;
	summary: string;
	title: string;
}

/** Expanded-body line budget for a file mutation or a read, matching dsh's chat card cap. */
const MAX_IO_INPUT_CHARS = 4000;

const TOOL_META: Record<string, { icon: ToolIconName; title: string }> = {
	bash: { icon: "terminal", title: "Bash" },
	edit: { icon: "edit", title: "编辑" },
	fetch_content: { icon: "browse", title: "网页获取" },
	find: { icon: "search", title: "Glob" },
	get_search_content: { icon: "browse", title: "读取网页" },
	grep: { icon: "search", title: "Grep" },
	ls: { icon: "browse", title: "列出目录" },
	powershell: { icon: "terminal", title: "Pwsh" },
	read: { icon: "browse", title: "读取" },
	skill: { icon: "sparkle", title: "技能" },
	subagent: { icon: "sparkle", title: "子代理" },
	task: { icon: "sparkle", title: "子代理" },
	todo: { icon: "checklist", title: "更新任务清单" },
	todo_write: { icon: "checklist", title: "更新任务清单" },
	todos: { icon: "checklist", title: "更新任务清单" },
	web_fetch: { icon: "browse", title: "网页获取" },
	web_search: { icon: "globe", title: "网页搜索" },
	write: { icon: "write", title: "写入" },
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function firstLine(text: string): string {
	const newline = text.indexOf("\n");
	return (newline === -1 ? text : text.slice(0, newline)).trim();
}

function pickString(record: Record<string, unknown> | undefined, keys: string[]): string | undefined {
	for (const key of keys) {
		const value = record?.[key];
		if (typeof value === "string" && value !== "") return value;
	}
	return undefined;
}

/** First non-empty string any of the arguments carries; the generic row summary. */
function firstStringArg(args: Record<string, unknown> | undefined): string | undefined {
	for (const value of Object.values(args ?? {})) {
		if (typeof value === "string" && value.trim() !== "") return value;
	}
	return undefined;
}

/** Drop a leading `[`/`{` or `[notice]` trailer line so rows show content, not envelopes. */
function visibleLines(text: string): string[] {
	return text
		.replace(/\r/g, "")
		.split("\n")
		.filter((line) => !/^\[[^\]]*\]$/.test(line.trim()) || line.trim().startsWith("[Showing"));
}

/**
 * Path as the row shows it: relative to the session working directory, otherwise unchanged.
 * dsh relativizes the same way so a row reads as a workspace path, not a disk path.
 */
export function displayPath(path: string, cwd?: string): string {
	const clean = path.replace(/\\/g, "/").replace(/\/+$/, "");
	const base = cwd?.replace(/\\/g, "/").replace(/\/+$/, "");
	if (base && clean.toLowerCase().startsWith(`${base.toLowerCase()}/`)) return clean.slice(base.length + 1);
	return clean;
}

/** Last segment of the session working directory, the shell card's prompt label. */
export function promptLabel(cwd?: string): string | undefined {
	if (!cwd) return undefined;
	const segments = cwd.replace(/\\/g, "/").replace(/\/+$/, "").split("/");
	return segments[segments.length - 1] || cwd;
}

const SHELL_TRAILER = /\n*\s*Command (?:exited with code (\d+)|aborted|timed out after ([^\n]+))\s*$/;

/** Split pi's shell result into output plus the failure trailer it appends on a non-zero exit. */
export function parseShellResult(output: string): { exitCode?: number; failure?: string; stdout: string } {
	const match = SHELL_TRAILER.exec(output);
	if (!match) return { stdout: output };
	const trailer = output.slice(match.index).trim();
	if (match[1] !== undefined) return { exitCode: Number(match[1]), stdout: output.slice(0, match.index) };
	if (trailer === "Command aborted") return { failure: "已停止", stdout: output.slice(0, match.index) };
	return { failure: `超时 ${match[2]}`, stdout: output.slice(0, match.index) };
}

/** True when the row's failure is an interruption rather than a tool error. */
function isInterruption(output: string): boolean {
	return /(?:Command aborted|Aborted|aborted by user)\s*$/.test(output.trim());
}

/**
 * Unified diff rows from pi's `patch` detail: a path header per file, `- `/`+ ` lines, and `⋯`
 * where one file continues in a later hunk. Context lines are dropped: the dsh diff card shows
 * changes only, with the sign and the colour carrying the meaning.
 */
export function diffRowsFromPatch(patch: string): DiffRow[] {
	const rows: DiffRow[] = [];
	let currentPath: string | undefined;
	let hunks = 0;
	for (const raw of patch.split("\n")) {
		const line = raw.replace(/\r$/, "");
		if (line.startsWith("+++ ")) {
			currentPath = line.slice(4).trim();
			hunks = 0;
			continue;
		}
		if (line.startsWith("--- ") || line.startsWith("Index: ") || line.startsWith("====")) continue;
		if (line.startsWith("@@")) {
			if (currentPath === undefined) continue;
			rows.push(hunks === 0 ? { kind: "path", text: currentPath } : { kind: "gap", text: "⋯" });
			hunks += 1;
			continue;
		}
		if (line.startsWith("+")) rows.push({ kind: "add", text: line.slice(1) });
		else if (line.startsWith("-")) rows.push({ kind: "del", text: line.slice(1) });
	}
	return rows;
}

/** Diff rows from pi's line-numbered `diff` detail, the fallback when no patch is present. */
export function diffRowsFromNumbered(diff: string, path?: string): DiffRow[] {
	const rows: DiffRow[] = [];
	for (const raw of diff.split("\n")) {
		const marker = raw[0];
		const match = /^\s*(\d+)\s(.*)$/.exec(raw.slice(1));
		if (!match) continue;
		if (marker === "+") rows.push({ kind: "add", text: match[2] });
		else if (marker === "-") rows.push({ kind: "del", text: match[2] });
		else if (match[2].trim() === "...") rows.push({ kind: "gap", text: "⋯" });
	}
	if (rows.length > 0 && path) rows.unshift({ kind: "path", text: path });
	return rows;
}

function diffFiles(rows: DiffRow[]): number {
	return new Set(rows.filter((row) => row.kind === "path").map((row) => row.text)).size;
}

/** `+N -M` for the collapsed row: the same totals the expanded footer prints. */
function diffStat(rows: DiffRow[]): string {
	const added = rows.filter((row) => row.kind === "add").length;
	const removed = rows.filter((row) => row.kind === "del").length;
	return `+${added} -${removed}`;
}

/** Read card material: the file window plus the total line count when the read was bounded. */
function readBody(path: string, args: Record<string, unknown> | undefined, output: string): ToolBody {
	const offset = Number(args?.offset);
	const startLine = Number.isFinite(offset) && offset >= 1 ? Math.floor(offset) : 1;
	const remaining = /\[(\d+) more lines in file/.exec(output);
	const body = output.replace(/\n*\[\d+ more lines in file[^\]]*\]\s*$/, "").replace(/\n+$/, "");
	const lines = body === "" ? [] : body.split("\n");
	const totalLines = remaining ? startLine + lines.length - 1 + Number(remaining[1]) : undefined;
	return { kind: "read", label: path, lines, startLine, totalLines };
}

/** Grep result groups: `path:line: text` matches (and `path-line- text` context) by file. */
function parseGrep(output: string): { files: number; groups: { matches: { line: number; text: string }[]; path: string }[]; matches: number } {
	const groups: { matches: { line: number; text: string }[]; path: string }[] = [];
	const index = new Map<string, number>();
	for (const line of visibleLines(output)) {
		const match = /^(.+?):(\d+): (.*)$/.exec(line) ?? /^(.+?)-(\d+)- (.*)$/.exec(line);
		if (!match) continue;
		const path = match[1];
		let at = index.get(path);
		if (at === undefined) {
			at = groups.length;
			index.set(path, at);
			groups.push({ matches: [], path });
		}
		groups[at].matches.push({ line: Number(match[2]), text: match[3] });
	}
	return {
		files: groups.length,
		groups,
		matches: groups.reduce((total, group) => total + group.matches.length, 0),
	};
}

function webSources(details: Record<string, unknown> | undefined): { snippet?: string; title: string; url: string }[] {
	const queries = Array.isArray(details?.curatedQueries) ? details.curatedQueries : [];
	const sources: { snippet?: string; title: string; url: string }[] = [];
	for (const entry of queries) {
		const record = asRecord(entry);
		const list = Array.isArray(record?.sources) ? record.sources : [];
		for (const item of list) {
			const source = asRecord(item);
			const url = typeof source?.url === "string" ? source.url : undefined;
			if (!url) continue;
			sources.push({
				snippet: typeof source?.snippet === "string" ? source.snippet : undefined,
				title: typeof source?.title === "string" ? source.title : url,
				url,
			});
		}
	}
	return sources;
}

function webAnswer(details: Record<string, unknown> | undefined, output: string): string | undefined {
	const summary = asRecord(details?.summary);
	if (typeof summary?.text === "string" && summary.text.trim() !== "") return summary.text;
	const first = Array.isArray(details?.curatedQueries) ? asRecord(details.curatedQueries[0]) : undefined;
	if (typeof first?.answer === "string" && first.answer.trim() !== "") return first.answer;
	return output.trim() === "" ? undefined : output;
}

function todoItems(details: Record<string, unknown> | undefined): { done: boolean; text: string }[] {
	const result = asRecord(details?.result) ?? details;
	const list = Array.isArray(result?.todos) ? result.todos : Array.isArray(result?.items) ? result.items : [];
	return list.flatMap((entry) => {
		const record = asRecord(entry);
		if (!record) return [];
		const text = typeof record.text === "string" ? record.text : typeof record.content === "string" ? record.content : undefined;
		if (!text) return [];
		return [{ done: record.done === true || record.status === "done" || record.status === "completed", text }];
	});
}

function subagentBody(details: Record<string, unknown> | undefined, output: string): ToolBody {
	const record = asRecord(details?.result) ?? details;
	const result = asRecord(record?.result) ?? record ?? {};
	const errorMessage = typeof result.errorMessage === "string" ? result.errorMessage : undefined;
	const stopReason = typeof result.stopReason === "string" ? result.stopReason : undefined;
	const status = errorMessage ? "错误" : stopReason === "stop" || stopReason === undefined ? "完成" : stopReason;
	const toolActivity = Array.isArray(result.toolActivity) ? result.toolActivity : [];
	return {
		kind: "subagent",
		model: typeof result.model === "string" ? result.model : typeof record?.agent === "string" ? record.agent : undefined,
		resultText:
			(typeof result.partialText === "string" ? result.partialText : undefined) ??
			(errorMessage ? errorMessage : output.trim() === "" ? undefined : output),
		status,
		task: typeof result.task === "string" ? result.task : undefined,
		toolCalls: toolActivity.length,
	};
}

function ioBody(args: Record<string, unknown> | undefined, output: string): ToolBody {
	const input = args === undefined ? undefined : JSON.stringify(args, null, 2)?.slice(0, MAX_IO_INPUT_CHARS);
	const text = output.trim() === "" ? undefined : output;
	if (!input && !text) return { kind: "none" };
	return { input, kind: "io", output: text };
}

/**
 * Everything one tool call contributes to its compact row and its expanded body.
 *
 * The row is derived from the call alone (name, arguments, streamed result, details) so the same
 * call renders identically while it runs and after it settles; only `state` and the accumulated
 * output change.
 */
export function deriveToolPresentation(block: ToolCallBlock, cwd?: string): ToolPresentation {
	const args = asRecord(block.args);
	const details = asRecord(block.details);
	const meta = TOOL_META[block.toolName] ?? { icon: "sparkle" as const, title: "工具调用" };
	const path = pickString(args, ["path", "file_path", "filePath"]);
	const shell = block.toolName === "bash" || block.toolName === "powershell";
	const parsed = shell ? parseShellResult(block.output) : undefined;

	let body: ToolBody = { kind: "none" };
	let summary = "";
	let suffix: string | undefined;

	if (shell) {
		summary = firstLine(pickString(args, ["description", "command"]) ?? firstStringArg(args) ?? "");
		body = {
			kind: "terminal",
			command: pickString(args, ["command"]) ?? "",
			exitCode: parsed?.exitCode,
			failure: parsed?.failure,
			output: parsed?.stdout ?? block.output,
			running: block.state === "running",
		};
	} else if (block.toolName === "read" && path) {
		summary = displayPath(path, cwd);
		body = readBody(summary, args, block.output);
	} else if ((block.toolName === "edit" || block.toolName === "write") && path) {
		summary = displayPath(path, cwd);
		const patch = typeof details?.patch === "string" ? details.patch : undefined;
		const numbered = typeof details?.diff === "string" ? details.diff : undefined;
		const content = typeof args?.content === "string" ? args.content : undefined;
		const rows = patch
			? diffRowsFromPatch(patch)
			: numbered
				? diffRowsFromNumbered(numbered, displayPath(path, cwd))
				: content !== undefined
					? [
							{ kind: "path" as const, text: displayPath(path, cwd) },
							...content.replace(/\n$/, "").split("\n").map((line) => ({ kind: "add" as const, text: line })),
						]
					: [];
		if (rows.length > 0) {
			suffix = diffStat(rows);
			body = { files: diffFiles(rows), kind: "diff", rows };
		} else {
			body = ioBody(args, block.output);
		}
	} else if (block.toolName === "grep") {
		summary = firstLine(pickString(args, ["pattern", "query"]) ?? "");
		const parsedGrep = parseGrep(block.output);
		body = parsedGrep.matches === 0 ? ioBody(args, block.output) : { kind: "search", ...parsedGrep };
	} else if (block.toolName === "find" || block.toolName === "ls") {
		summary = firstLine(pickString(args, ["pattern", "path"]) ?? "");
		const paths = visibleLines(block.output)
			.map((line) => line.trim())
			.filter((line) => line !== "");
		body = paths.length === 0 ? ioBody(args, block.output) : { kind: "paths", paths };
	} else if (block.toolName === "web_search") {
		const queries = Array.isArray(args?.queries) ? args.queries : undefined;
		summary =
			queries?.filter((query): query is string => typeof query === "string").map(firstLine).join(", ") ||
			firstLine(pickString(args, ["query", "pattern"]) ?? "");
		body = { answer: webAnswer(details, block.output), kind: "web", sources: webSources(details) };
	} else if (block.toolName === "fetch_content" || block.toolName === "web_fetch" || block.toolName === "get_search_content") {
		const urls = Array.isArray(args?.urls) ? args.urls : undefined;
		const url =
			pickString(args, ["url"]) ?? (typeof urls?.[0] === "string" ? urls[0] : undefined) ?? pickString(details, ["url"]) ?? "";
		summary = firstLine(url);
		const meta: string[] = [];
		const status = details?.status;
		if (typeof status === "number") meta.push(`HTTP ${status}`);
		const chars = details?.totalChars ?? details?.returnedChars ?? details?.contentLength;
		if (typeof chars === "number") meta.push(`${chars} 字符`);
		if (details?.truncated === true) meta.push("内容已截断");
		body = { content: block.output, kind: "fetch", meta, url };
	} else {
		const todos = todoItems(details);
		const isSubagent = block.toolName === "subagent" || block.toolName === "task";
		if (todos.length > 0) {
			const done = todos.filter((todo) => todo.done).length;
			summary = `${done}/${todos.length} 已完成`;
			body = { kind: "todos", todos };
		} else if (isSubagent) {
			summary = firstLine(firstStringArg(args) ?? "");
			body = subagentBody(details, block.output);
		} else {
			summary = firstLine(firstStringArg(args) ?? "");
			body = ioBody(args, block.output);
		}
	}

	if (summary === "" && path) summary = displayPath(path, cwd);
	if (summary === "" && !shell && block.toolName !== "web_search" && !TOOL_META[block.toolName]) {
		summary = block.toolName;
	}
	if (block.state === "running" && summary === "") summary = "运行中";

	const state: RowState =
		block.state === "running"
			? "running"
			: block.state === "error"
				? isInterruption(block.output)
					? "stopped"
					: "error"
				: "ok";
	const errorSummary =
		state === "error"
			? firstLine(
					visibleLines(parsed?.stdout ?? block.output)
						.filter((line) => line.trim() !== "")
						.join("\n") || "失败",
				)
			: undefined;

	return {
		body,
		errorSummary,
		icon: meta.icon,
		state,
		suffix: state === "error" ? undefined : suffix,
		summary,
		title: meta.title,
	};
}
