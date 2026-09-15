import { FilePlus2, FileText, Globe, ListChecks, PencilLine, Search, Sparkles, Terminal } from "lucide-react";
import { memo, useState } from "react";
import type { ToolCallBlock } from "../../state/types";
import {
	DiffCard,
	FetchCard,
	IoCard,
	PathsCard,
	ReadCard,
	SearchCard,
	SubagentCard,
	TerminalCard,
	TodoCard,
	WebCard,
} from "./blocks";
import { deriveToolPresentation, promptLabel, type ToolBody } from "./presentation";
import { DisclosureRow, RowSummary, RowSuffix, type RowState } from "./rows";

const ICONS = {
	browse: FileText,
	checklist: ListChecks,
	edit: PencilLine,
	globe: Globe,
	search: Search,
	sparkle: Sparkles,
	terminal: Terminal,
	write: FilePlus2,
} as const;

function Body({ body, cwd, state }: { body: ToolBody; cwd?: string; state: RowState }) {
	switch (body.kind) {
		case "terminal":
			return (
				<TerminalCard
					command={body.command}
					cwdLabel={promptLabel(cwd)}
					exitCode={body.exitCode}
					failure={body.failure}
					output={body.output}
					running={body.running}
				/>
			);
		case "diff":
			return <DiffCard files={body.files} rows={body.rows} />;
		case "read":
			return <ReadCard label={body.label} lines={body.lines} startLine={body.startLine} totalLines={body.totalLines} />;
		case "paths":
			return <PathsCard paths={body.paths} />;
		case "search":
			return <SearchCard files={body.files} groups={body.groups} matches={body.matches} />;
		case "web":
			return <WebCard answer={body.answer} sources={body.sources} />;
		case "fetch":
			return <FetchCard content={body.content} meta={body.meta} url={body.url} />;
		case "todos":
			return <TodoCard todos={body.todos} />;
		case "subagent":
			return (
				<SubagentCard
					model={body.model}
					resultText={body.resultText}
					status={body.status}
					task={body.task}
					toolCalls={body.toolCalls}
				/>
			);
		case "io":
			return <IoCard error={state === "error"} input={body.input} output={body.output} />;
		default:
			return null;
	}
}

/**
 * One tool call as a compact flow row.
 *
 * The row is a single 24px line: icon, title, then the call's salient argument. Everything else —
 * command output, file diff, file window, search hits, sources — is one click away in a card that
 * mirrors the tool's own shape instead of dumping raw JSON.
 */
export const ToolRow = memo(function ToolRow({ block, cwd }: { block: ToolCallBlock; cwd?: string }) {
	const [open, setOpen] = useState(false);
	const view = deriveToolPresentation(block, cwd);
	const Icon = ICONS[view.icon];
	const expandable = view.body.kind !== "none";
	const summary =
		view.state === "error" && view.errorSummary !== undefined ? (
			<RowSummary error text={view.errorSummary} />
		) : (
			<RowSummary text={view.summary} />
		);
	return (
		<DisclosureRow
			expandable={expandable}
			icon={<Icon size={14} strokeWidth={1.7} />}
			onToggle={() => setOpen((value) => !value)}
			open={expandable && open}
			state={view.state}
			suffix={view.suffix === undefined ? undefined : <RowSuffix text={view.suffix} />}
			summary={summary}
			title={view.title}
		>
			<Body body={view.body} cwd={cwd} state={view.state} />
		</DisclosureRow>
	);
});
