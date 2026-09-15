import { memo, type ReactNode, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CopyButton, FoldToggle, RowCard } from "./rows";
import { t } from "../../i18n";

/** Rows hidden by a capped card body before the user expands it (dsh CHAT_*_MAX_LINES = 8). */
export const CARD_MAX_LINES = 8;

/**
 * Head/tail window around an elided middle, the dsh `headTailCap` arithmetic: half the budget on
 * each side so a diff or a file keeps both its opening and its closing context.
 */
export function capRows<T>(
	rows: T[],
	expanded: boolean,
	maxLines = CARD_MAX_LINES,
): { head: T[]; hidden: number; tail: T[] } {
	if (expanded || rows.length <= maxLines) return { head: rows, hidden: 0, tail: [] };
	const headCount = Math.ceil(maxLines / 2);
	return {
		head: rows.slice(0, headCount),
		hidden: rows.length - maxLines,
		tail: rows.slice(rows.length - (maxLines - headCount)),
	};
}

function CardHeader({ children, trailing }: { children: ReactNode; trailing?: ReactNode }) {
	return (
		<div className="flex items-center justify-between gap-3 border-b-[0.5px] border-black/[0.06] px-3.5 py-2">
			{children}
			{trailing}
		</div>
	);
}

export interface TerminalCardProps {
	command: string;
	/** Prompt label: the working directory, shortened to its last segment. */
	cwdLabel?: string;
	exitCode?: number;
	/** Non-numeric failure trailer (`aborted`, `timed out after 30 seconds`). */
	failure?: string;
	output: string;
	running: boolean;
}

/**
 * Bash/Pwsh card: the prompt line above the mono output. The output is the only scroll surface,
 * so the command stays pinned; a red pill appears in the banner only when the command failed.
 */
export const TerminalCard = memo(function TerminalCard({
	command,
	cwdLabel,
	exitCode,
	failure,
	output,
	running,
}: TerminalCardProps) {
	const commandLines = command.split("\n");
	const trimmed = output.replace(/\n+$/, "");
	const outputLines = trimmed === "" ? [] : trimmed.split("\n");
	const failed = exitCode !== undefined && exitCode !== 0;
	return (
		<RowCard>
			<div className="flex items-start gap-3 px-3.5 py-2">
				<div className="flex min-w-0 flex-1 flex-col">
					{commandLines.map((line, index) => (
						<div className="flex items-baseline gap-2" key={`${index}-${line}`}>
							<span className="flex-none text-ink-subtle">{index === 0 ? (cwdLabel ?? "$") : "$"}</span>
							<span className="truncate whitespace-pre">{line}</span>
						</div>
					))}
				</div>
				{failed ? <span className="flex-none text-danger">{t("退出码")}{exitCode}</span> : null}
				{failure ? <span className="flex-none text-danger">{failure}</span> : null}
				{running ? null : <CopyButton text={output} />}
			</div>
			<div className="border-t-[0.5px] border-black/10">
				{outputLines.length === 0 ? (
					<div className="px-3.5 py-3 text-ink-subtle">{t("无输出")}</div>
				) : (
					<div className="max-h-[224px] overflow-auto py-3">
						<div className="w-max min-w-full px-3.5 font-mono">
							{outputLines.map((line, index) => (
								<div className="min-h-[18px] whitespace-pre" key={`${index}-${line}`}>
									{line}
								</div>
							))}
						</div>
					</div>
				)}
			</div>
		</RowCard>
	);
});

export type DiffRow = { kind: "add" | "del" | "gap" | "path"; text: string };

/** Unified diff body: path header, `- `/`+ ` lines, `⋯` between hunks, `└ +N -M` footer. */
export const DiffCard = memo(function DiffCard({ files, rows }: { files: number; rows: DiffRow[] }) {
	const [expanded, setExpanded] = useState(false);
	const added = rows.filter((row) => row.kind === "add").length;
	const removed = rows.filter((row) => row.kind === "del").length;
	const { head, hidden, tail } = capRows(rows, expanded);
	const copyText = rows
		.map((row) => (row.kind === "add" ? `+ ${row.text}` : row.kind === "del" ? `- ${row.text}` : row.text))
		.join("\n");
	return (
		<RowCard className="relative">
			<div className="absolute right-3.5 top-2 z-10 bg-code">
				<CopyButton text={copyText} />
			</div>
			<div className="overflow-x-auto py-3 pl-3.5 pr-3.5 font-mono">
				{head.map((row, index) => (
					<DiffLine key={`h-${index}-${row.text}`} row={row} />
				))}
				<FoldToggle expanded={expanded} hidden={hidden} onToggle={() => setExpanded((value) => !value)} />
				{tail.map((row, index) => (
					<DiffLine key={`t-${index}-${row.text}`} row={row} />
				))}
				<div className="mt-1 whitespace-pre text-ink-subtle">
					{t("└ +{added} -{removed} · {files} 个文件", { "added": added, "removed": removed, "files": files })}
				</div>
			</div>
		</RowCard>
	);
});

function DiffLine({ row }: { row: DiffRow }) {
	if (row.kind === "path") {
		return <div className="min-h-[18px] whitespace-pre pr-14 font-semibold text-ink">{row.text}</div>;
	}
	if (row.kind === "gap") return <div className="min-h-[18px] whitespace-pre text-ink-subtle">⋯</div>;
	return (
		<div className={`min-h-[18px] whitespace-pre ${row.kind === "add" ? "text-success" : "text-danger"}`}>
			{`${row.kind === "add" ? "+" : "-"} ${row.text}`}
		</div>
	);
}

/** File-content body: a fixed line-number gutter plus one mono line per file line. */
export const ReadCard = memo(function ReadCard({
	label,
	lines,
	startLine,
	totalLines,
}: {
	label: string;
	lines: string[];
	startLine: number;
	totalLines?: number;
}) {
	const [expanded, setExpanded] = useState(false);
	const { head, hidden, tail } = capRows(lines, expanded);
	const lastShown = startLine + lines.length - 1;
	const note = totalLines !== undefined && totalLines > lastShown ? t("显示 {length} / {totalLines} 行", { "length": lines.length, "totalLines": totalLines }) : undefined;
	return (
		<RowCard>
			<CardHeader trailing={<CopyButton text={lines.join("\n")} />}>
				<span className="truncate font-mono text-ink">{label}</span>
				{note ? <span className="ml-auto flex-none text-[13px] leading-5 text-ink-subtle">{note}</span> : null}
			</CardHeader>
			<div className="overflow-x-auto py-3 font-mono">
				{head.map((line, index) => (
					<ReadLine key={`h-${index}-${line}`} number={startLine + index} text={line} />
				))}
				<FoldToggle
					expanded={expanded}
					hidden={hidden}
					indent={48}
					onToggle={() => setExpanded((value) => !value)}
				/>
				{tail.map((line, index) => (
					<ReadLine key={`t-${index}-${line}`} number={startLine + lines.length - tail.length + index} text={line} />
				))}
			</div>
		</RowCard>
	);
});

function ReadLine({ number, text }: { number: number; text: string }) {
	return (
		<div className="flex min-h-[18px] whitespace-pre">
			<span className="w-12 flex-none select-none pr-3.5 text-right text-ink-subtle">{number}</span>
			<span className="text-ink">{text}</span>
		</div>
	);
}

/** Grep body: matches grouped under their file, with the match and file counts in the header. */
export const SearchCard = memo(function SearchCard({
	files,
	groups,
	matches,
}: {
	files: number;
	groups: { matches: { line: number; text: string }[]; path: string }[];
	matches: number;
}) {
	const rows = groups.flatMap((group) => [
		{ kind: "file" as const, line: 0, path: group.path, text: "" },
		...group.matches.map((match) => ({ kind: "match" as const, line: match.line, path: group.path, text: match.text })),
	]);
	const [expanded, setExpanded] = useState(false);
	const { head, hidden, tail } = capRows(rows, expanded, 16);
	const copyText = groups
		.map((group) => `${group.path}\n${group.matches.map((match) => `${match.line}: ${match.text}`).join("\n")}`)
		.join("\n\n");
	return (
		<RowCard>
			<CardHeader trailing={<CopyButton text={copyText} />}>
				<span className="truncate text-[13px] leading-5 text-ink-muted">
					{t("{matches} 处匹配 · {files} 个文件", { "matches": matches, "files": files })}
				</span>
			</CardHeader>
			<div className="overflow-x-auto py-3 pl-3.5 pr-3.5 font-mono">
				{head.map((row, index) => (
					<SearchLine key={`h-${index}-${row.path}-${row.line}`} row={row} />
				))}
				<FoldToggle expanded={expanded} hidden={hidden} onToggle={() => setExpanded((value) => !value)} />
				{tail.map((row, index) => (
					<SearchLine key={`t-${index}-${row.path}-${row.line}`} row={row} />
				))}
			</div>
		</RowCard>
	);
});

function SearchLine({ row }: { row: { kind: "file" | "match"; line: number; path: string; text: string } }) {
	if (row.kind === "file") {
		return <div className="min-h-[18px] whitespace-pre font-semibold text-ink">{row.path}</div>;
	}
	return (
		<div className="min-h-[18px] whitespace-pre pl-3.5 text-ink">
			<span className="text-ink-subtle">{`${row.line}: `}</span>
			{row.text}
		</div>
	);
}

/** Glob/ls body: one path per line, with the path count in the header. */
export const PathsCard = memo(function PathsCard({ paths }: { paths: string[] }) {
	const [expanded, setExpanded] = useState(false);
	const { head, hidden, tail } = capRows(paths, expanded, 16);
	return (
		<RowCard>
			<CardHeader trailing={<CopyButton text={paths.join("\n")} />}>
				<span className="text-[13px] leading-5 text-ink-muted">{t("{length} 个路径", { "length": paths.length })}</span>
			</CardHeader>
			<div className="overflow-x-auto py-3 pl-3.5 pr-3.5 font-mono">
				{head.map((path, index) => (
					<div className="min-h-[18px] whitespace-pre text-ink" key={`h-${index}-${path}`}>
						{path}
					</div>
				))}
				<FoldToggle expanded={expanded} hidden={hidden} onToggle={() => setExpanded((value) => !value)} />
				{tail.map((path, index) => (
					<div className="min-h-[18px] whitespace-pre text-ink" key={`t-${index}-${path}`}>
						{path}
					</div>
				))}
			</div>
		</RowCard>
	);
});

/** Web search body: the provider answer, then the numbered sources. */
export const WebCard = memo(function WebCard({
	answer,
	sources,
}: {
	answer?: string;
	sources: { snippet?: string; title: string; url: string }[];
}) {
	if (!answer && sources.length === 0) {
		return (
			<RowCard>
				<div className="px-3.5 py-3 text-[13px] text-ink-muted">{t("未找到结果")}</div>
			</RowCard>
		);
	}
	return (
		<RowCard>
			<div className="px-3.5 py-3">
				{answer ? (
					<div className="prose-pi text-[13px] leading-5 [&_p:last-child]:mb-0">
						<ReactMarkdown remarkPlugins={[remarkGfm]}>{answer}</ReactMarkdown>
					</div>
				) : null}
				{sources.length > 0 ? (
					<ol className="m-0 flex max-h-[320px] list-decimal flex-col gap-2.5 overflow-y-auto pl-8">
						{sources.map((source, index) => (
							<li className="min-w-0" key={`${index}-${source.url}`}>
								<a
									className="text-[14px] font-medium leading-5 text-accent hover:underline"
									href={source.url}
									rel="noreferrer"
									target="_blank"
								>
									{source.title || source.url}
								</a>
								{source.snippet ? (
									<div className="mt-0.5 text-[13px] leading-[19px] text-ink-muted">{source.snippet}</div>
								) : null}
							</li>
						))}
					</ol>
				) : null}
			</div>
		</RowCard>
	);
});

/** Page fetch body: the url, its response meta, then the extracted text. */
export const FetchCard = memo(function FetchCard({
	content,
	meta,
	url,
}: {
	content: string;
	meta: string[];
	url: string;
}) {
	return (
		<RowCard>
			<div className="flex flex-col gap-1.5 px-3.5 py-3">
				<a
					className="break-all font-mono text-[13px] font-medium leading-[19px] text-accent hover:underline"
					href={url}
					rel="noreferrer"
					target="_blank"
				>
					{url}
				</a>
				{meta.length > 0 ? (
					<div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[13px] leading-5 text-ink-muted">
						{meta.map((item) => (
							<span key={item}>{item}</span>
						))}
					</div>
				) : null}
				{content ? (
					<div className="mt-1 max-h-[320px] overflow-auto whitespace-pre-wrap break-words text-[12px] leading-[18px] text-ink">
						{content}
					</div>
				) : null}
			</div>
		</RowCard>
	);
});

/** Fallback body: raw arguments and the flattened result, each capped and scrolling alone. */
export const IoCard = memo(function IoCard({
	error,
	input,
	output,
}: {
	error?: boolean;
	input?: string;
	output?: string;
}) {
	if (!input && !output) return null;
	return (
		<RowCard>
			{input ? (
				<div className="grid max-h-[150px] grid-cols-[max-content_1fr] items-baseline gap-x-3.5 overflow-y-auto px-4 py-3 font-mono">
					<span className="sticky top-0 self-start text-ink-caption">{t("输入")}</span>
					<span className="min-w-0 whitespace-pre-wrap break-words text-ink-muted">{input}</span>
				</div>
			) : null}
			{input && output ? <div className="h-[0.5px] bg-black/10" /> : null}
			{output ? (
				<div className="grid max-h-[150px] grid-cols-[max-content_1fr] items-baseline gap-x-3.5 overflow-y-auto px-4 py-3 font-mono">
					<span className="sticky top-0 self-start text-ink-caption">{t("输出")}</span>
					<span
						className={`min-w-0 whitespace-pre-wrap break-words ${error ? "text-danger" : "text-ink-muted"}`}
					>
						{output}
					</span>
				</div>
			) : null}
		</RowCard>
	);
});

/** Todo-list body: `✓`/`○` per item, done items struck through. */
export const TodoCard = memo(function TodoCard({ todos }: { todos: { done: boolean; text: string }[] }) {
	if (todos.length === 0) return null;
	return (
		<RowCard>
			<div className="flex flex-col gap-1 px-4 py-3">
				{todos.map((todo, index) => (
					<div className="flex items-start gap-2 text-[13px] leading-5" key={`${index}-${todo.text}`}>
						<span className={todo.done ? "text-success" : "text-ink-caption"}>{todo.done ? "✓" : "○"}</span>
						<span className={todo.done ? "text-ink-subtle line-through" : "text-ink"}>{todo.text}</span>
					</div>
				))}
			</div>
		</RowCard>
	);
});

/** Subagent body: model, status and the agent's partial output. */
export const SubagentCard = memo(function SubagentCard({
	model,
	resultText,
	status,
	task,
	toolCalls,
}: {
	model?: string;
	resultText?: string;
	status: string;
	task?: string;
	toolCalls: number;
}) {
	return (
		<RowCard>
			<div className="flex flex-col gap-1 px-4 py-3 text-[13px] leading-5">
				{task ? <div className="text-ink">{task}</div> : null}
				<div className="flex flex-wrap gap-x-3 gap-y-1 text-ink-muted">
					{model ? <span>{t("模型")}{model}</span> : null}
					<span>{t("状态")}{status}</span>
					{toolCalls > 0 ? <span>{t("工具")}{toolCalls}</span> : null}
				</div>
				{resultText ? (
					<div className="mt-1 max-h-[320px] overflow-auto whitespace-pre-wrap break-words text-ink-muted">
						{resultText}
					</div>
				) : null}
			</div>
		</RowCard>
	);
});
