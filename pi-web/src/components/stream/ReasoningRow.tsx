import { Lightbulb } from "lucide-react";
import { memo, useState } from "react";
import type { ThinkingBlock } from "../../state/types";
import { DisclosureRow, RowSummary } from "./rows";
import { t } from "../../i18n";

function firstLine(text: string): string {
	const newline = text.indexOf("\n");
	return newline === -1 ? text : text.slice(0, newline);
}

function latestLine(text: string): string {
	const visible = text.trimEnd();
	const newline = visible.lastIndexOf("\n");
	return newline === -1 ? visible : visible.slice(newline + 1);
}

/**
 * Reasoning disclosure: one compact line while the rest is one click away.
 *
 * The collapsed line follows the stream: while the model is still thinking it shows the newest
 * line, right-anchored so the tail stays readable as it grows; once the block settles it shows
 * the first line, which is the summary the model itself opened with.
 */
export const ReasoningRow = memo(function ReasoningRow({ block }: { block: ThinkingBlock }) {
	const [open, setOpen] = useState(false);
	const running = block.state === "streaming";
	const summary = (running ? latestLine(block.text) : firstLine(block.text)).replaceAll("**", "");
	return (
		<DisclosureRow
			expandable
			icon={<Lightbulb size={14} strokeWidth={1.7} />}
			onToggle={() => setOpen((value) => !value)}
			open={open}
			state={running ? "running" : "ok"}
			summary={
				running ? (
					<span className="flex min-w-0 flex-1 justify-end overflow-hidden">
						<span className="w-max min-w-full whitespace-nowrap text-left text-[13px] leading-6 text-ink-subtle">
							{summary}
						</span>
					</span>
				) : (
					<RowSummary text={summary} />
				)
			}
			title={t("思考")}
		>
			<div className="whitespace-pre-wrap break-words py-1 pl-[22px] text-[13px] leading-5 text-ink-subtle">
				{block.text}
			</div>
		</DisclosureRow>
	);
});
