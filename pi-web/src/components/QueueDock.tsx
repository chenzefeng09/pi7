import { ArrowUp, ListOrdered, RotateCcw, Trash2 } from "lucide-react";
import { usePiStore } from "../state/store";
import type { QueueState } from "../state/types";
import { t } from "../i18n";

/** One row of the dock: which queue the message sits in, where, and what it says. */
interface QueuedRow {
	index: number;
	kind: keyof QueueState;
	text: string;
}

/**
 * Queued messages, in the order they will be delivered.
 *
 * Steering messages are meant to reach the running turn first, so they are listed before the
 * follow-ups; within one queue pi keeps insertion order.
 */
function queuedRows(queue: QueueState): QueuedRow[] {
	const rows: QueuedRow[] = [];
	for (const kind of ["steering", "followUp"] as const) {
		queue[kind].forEach((text, index) => rows.push({ index, kind, text }));
	}
	return rows;
}

function RowAction({
	icon: Icon,
	label,
	onClick,
}: {
	icon: typeof RotateCcw;
	label: string;
	onClick: () => void;
}) {
	return (
		<button
			className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[#8a938c] transition-colors hover:bg-black/[0.06] hover:text-[#4b5563]"
			onClick={onClick}
			title={label}
			type="button"
		>
			<Icon size={14} />
		</button>
	);
}

/**
 * Queue dock above the composer, the harness pattern: every message waiting for the running turn
 * as one row.
 *
 * There are exactly two things worth doing with a queued message, and they are different enough to
 * need different affordances:
 *
 * - **Take it back** (the row itself, or 取回): the message leaves the queue and its text lands in
 *   the composer, where it can be rewritten before it goes out. This is the only way to edit one —
 *   pi delivers a queued message verbatim, and an inline editor would send text the user never got
 *   to read.
 * - **插话** (↑, only while a turn is running): the message is handed to the turn in flight right
 *   now instead of waiting for the boundary. The button is absent when nothing is running, because
 *   a disabled control that silently does nothing is what made this row confusing in the first
 *   place; on an idle session the text is simply sent normally.
 */
export function QueueDock() {
	const queue = usePiStore((state) => state.queue);
	const status = usePiStore((state) => state.status);
	const recallQueuedMessage = usePiStore((state) => state.recallQueuedMessage);
	const removeQueuedMessage = usePiStore((state) => state.removeQueuedMessage);
	const steerQueuedMessage = usePiStore((state) => state.steerQueuedMessage);
	const rows = queuedRows(queue);
	if (rows.length === 0) return null;
	const running = status === "streaming";

	return (
		<div className="mx-auto w-full max-w-[1010px] px-3.5">
			<ul className="scrollbar-subtle max-h-[180px] overflow-y-auto rounded-t-xl bg-[#f4f4f5] py-0.5">
				{rows.map((row, position) => (
					<li
						className={`group flex h-9 items-center gap-2.5 rounded-lg px-3 ${position > 0 ? "shadow-[inset_0_1px_0_rgba(0,0,0,0.05)]" : ""}`}
						key={`${row.kind}:${row.index}:${row.text}`}
					>
						{position === 0 ? (
							<ListOrdered className="shrink-0 text-[#b6bcc4]" size={14} />
						) : null}
						<button
							className="min-w-0 flex-1 truncate text-left text-[13px] text-[#667085] transition-colors hover:text-[#1f2937]"
							onClick={() => void recallQueuedMessage(row.kind, row.index)}
							title={t("取回到输入框编辑")}
							type="button"
						>
							{row.text}
						</button>
						<div className="flex shrink-0 items-center gap-1">
							<RowAction
								icon={RotateCcw}
								label={t("取回到输入框编辑")}
								onClick={() => void recallQueuedMessage(row.kind, row.index)}
							/>
							<RowAction
								icon={Trash2}
								label={t("移出队列")}
								onClick={() => void removeQueuedMessage(row.kind, row.index)}
							/>
							{running ? (
								<RowAction
									icon={ArrowUp}
									label={t("插话：立刻交给正在运行的一轮")}
									onClick={() => void steerQueuedMessage(row.kind, row.index)}
								/>
							) : null}
						</div>
					</li>
				))}
			</ul>
		</div>
	);
}
