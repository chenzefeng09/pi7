import { ChevronDown, CircleDashed, CircleCheck, Loader2, ListTodo, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useBlankSession, usePiStore } from "../state/store";
import type { TodoItem } from "../state/types";

/** Status mark of one row, the harness todo list's vocabulary. */
function StatusMark({ status }: { status: TodoItem["status"] }) {
	if (status === "in-progress") {
		return <Loader2 className="mt-[3px] shrink-0 animate-spin text-[#2f7df6]" size={14} />;
	}
	if (status === "done") return <CircleCheck className="mt-[2px] shrink-0 text-[#22c55e]" size={15} />;
	if (status === "blocked") return <TriangleAlert className="mt-[2px] shrink-0 text-[#f79009]" size={15} />;
	return <CircleDashed className="mt-[2px] shrink-0 text-[#b6bcc4]" size={15} />;
}

function summaryOf(items: TodoItem[]): string {
	const count = (status: TodoItem["status"]) => items.filter((item) => item.status === status).length;
	const parts = [
		[count("in-progress"), "进行中"],
		[count("pending"), "待处理"],
		[count("blocked"), "受阻"],
		[count("done"), "已完成"],
	] as const;
	return parts
		.filter(([value]) => value > 0)
		.map(([value, label]) => `${value} ${label}`)
		.join(" · ");
}

/**
 * The visible project's task list, above the composer.
 *
 * The list lives in the project (`.pi/todo.json`, written by the todo tool), so it survives
 * sessions and belongs to the folder rather than to one conversation. The header carries the
 * counts the harness shows; the rows are its status marks — spinning ring while a task is being
 * worked on, dashed circle while it waits, check when it is done.
 */
export function TodoPanel() {
	const [open, setOpen] = useState(true);
	const todos = usePiStore((state) => state.todos);
	const todosCwd = usePiStore((state) => state.todosCwd);
	const sessionCwd = usePiStore((state) => state.sessionCwd);
	const blank = useBlankSession();
	if (blank || !sessionCwd || todosCwd !== sessionCwd || todos.length === 0) return null;
	const summary = summaryOf(todos);

	return (
		<div className="mx-auto mb-1.5 w-full max-w-[1010px] px-3.5">
			<div className="overflow-hidden rounded-xl border border-black/[0.06] bg-[#f7f7f8]">
				<button
					className="flex h-9 w-full items-center gap-2.5 px-3 text-left"
					onClick={() => setOpen((value) => !value)}
					title={open ? "收起任务列表" : "展开任务列表"}
					type="button"
				>
					<ListTodo className="shrink-0 text-[#8a938c]" size={15} />
					<span className="shrink-0 text-[13px] font-medium text-[#1f2937]">任务</span>
					<span className="min-w-0 flex-1 truncate text-[12px] text-[#8a938c]">{summary}</span>
					<ChevronDown
						className={`shrink-0 text-[#8a938c] transition-transform ${open ? "" : "-rotate-90"}`}
						size={15}
					/>
				</button>
				{open ? (
					<ul className="scrollbar-subtle max-h-[220px] overflow-y-auto px-1.5 pb-1.5">
						{todos.map((item) => (
							<li className="flex items-start gap-2.5 rounded-lg px-2 py-1.5" key={item.id}>
								<StatusMark status={item.status} />
								<span
									className={`min-w-0 flex-1 text-[13px] leading-5 ${
										item.status === "done" ? "text-[#b6bcc4] line-through" : "text-[#374151]"
									}`}
								>
									{item.text}
									{item.priority === "high" || item.priority === "critical" ? (
										<span
											className={`ml-1.5 text-[11px] ${
												item.priority === "critical" ? "text-[#f04438]" : "text-[#f79009]"
											}`}
										>
											{item.priority === "critical" ? "紧急" : "重要"}
										</span>
									) : null}
									{item.assignee ? (
										<span className="ml-1.5 text-[11px] text-[#b6bcc4]">· {item.assignee}</span>
									) : null}
									{item.blockedBy ? (
										<span className="ml-1.5 text-[11px] text-[#f04438]">受阻于 {item.blockedBy}</span>
									) : null}
								</span>
								<span className="shrink-0 pt-0.5 font-mono text-[11px] text-[#c0c6cd]">{item.id}</span>
							</li>
						))}
					</ul>
				) : null}
			</div>
		</div>
	);
}
