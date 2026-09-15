import { useEffect, useState } from "react";
import { useScheduledTaskStore, type ScheduledTaskRepeat } from "../state/scheduled-tasks";
import { Modal } from "./Modal";
import { t } from "../i18n";

const WEEKDAY_LABELS = [t("周日"), t("周一"), t("周二"), t("周三"), t("周四"), t("周五"), t("周六")];

const REPEAT_OPTIONS: Array<{ label: string; value: ScheduledTaskRepeat }> = [
	{ label: t("一次"), value: "once" },
	{ label: t("每天"), value: "daily" },
	{ label: t("每周"), value: "weekly" },
];

const FIELD_CLASS =
	"h-9 rounded-xl border border-black/[0.1] bg-white px-2.5 text-[13px] text-[#1f2937] outline-none focus:border-[#2f7df6]";

function today(): string {
	const now = new Date();
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	return `${now.getFullYear()}-${month}-${day}`;
}

/** Create-task dialog of the schedule view: a modal on top of the list instead of an inline panel. */
export function ScheduleCreateDialog({ onClose, open }: { onClose: () => void; open: boolean }) {
	const addTask = useScheduledTaskStore((state) => state.addTask);
	const [prompt, setPrompt] = useState("");
	const [repeat, setRepeat] = useState<ScheduledTaskRepeat>("once");
	const [weekday, setWeekday] = useState(5);
	const [time, setTime] = useState("09:00");
	const [date, setDate] = useState(today);

	// A closed dialog drops the draft, so reopening it does not resume a half-typed task.
	useEffect(() => {
		if (open) return;
		setPrompt("");
		setRepeat("once");
		setWeekday(5);
		setTime("09:00");
		setDate(today());
	}, [open]);

	const submit = () => {
		const text = prompt.trim();
		if (!text) return;
		if (repeat === "once") {
			const at = new Date(`${date}T${time}`);
			if (Number.isNaN(at.getTime())) return;
			addTask(text, { repeat: "once", scheduledAt: at.toISOString(), time });
		} else {
			addTask(text, { repeat, time, weekday });
		}
		onClose();
	};

	return (
		<Modal
			className="w-full max-w-[520px] rounded-[24px] border border-black/[0.06] bg-white p-6 shadow-[0_24px_70px_rgba(15,23,42,0.2)]"
			onClose={onClose}
			open={open}
		>
			<div className="text-[16px] font-medium text-[#111827]">{t("新建定时任务")}</div>
			<div className="mt-1 text-[12px] text-[#98a2b3]">{t("任务仅在 π7 运行期间执行。")}</div>
			<textarea
				className="mt-4 h-24 w-full resize-none rounded-xl border border-black/[0.1] bg-white px-3 py-2 text-[13px] text-[#1f2937] outline-none focus:border-[#2f7df6]"
				onChange={(event) => setPrompt(event.target.value)}
				placeholder={t("输入要定时执行的内容")}
				value={prompt}
			/>
			<div className="mt-3 flex flex-wrap items-center gap-2">
				<div className="flex items-center gap-0.5 rounded-xl bg-[#f2f4f7] p-0.5">
					{REPEAT_OPTIONS.map((option) => (
						<button
							aria-pressed={repeat === option.value}
							className={`rounded-[10px] px-3 py-1.5 text-[13px] transition-colors ${
								repeat === option.value
									? "bg-white font-medium text-[#111827] shadow-[0_1px_3px_rgba(15,23,42,0.1)]"
									: "text-[#667085] hover:text-[#1f2937]"
							}`}
							key={option.value}
							onClick={() => setRepeat(option.value)}
							type="button"
						>
							{option.label}
						</button>
					))}
				</div>
				{repeat === "weekly" ? (
					<select
						className={FIELD_CLASS}
						onChange={(event) => setWeekday(Number(event.target.value))}
						value={weekday}
					>
						{WEEKDAY_LABELS.map((label, index) => (
							<option key={label} value={index}>
								{label}
							</option>
						))}
					</select>
				) : null}
				{repeat === "once" ? (
					<input
						className={FIELD_CLASS}
						onChange={(event) => setDate(event.target.value)}
						type="date"
						value={date}
					/>
				) : null}
				<input
					className={FIELD_CLASS}
					onChange={(event) => setTime(event.target.value)}
					type="time"
					value={time}
				/>
			</div>
			<div className="mt-6 flex items-center justify-end gap-2">
				<button
					className="rounded-full px-3.5 py-1.5 text-[13px] text-[#667085] hover:bg-black/[0.05]"
					onClick={onClose}
					type="button"
				>
					{t("取消")}</button>
				<button
					className="rounded-full bg-[#1f2937] px-4 py-1.5 text-[13px] font-medium text-white hover:bg-[#111827] disabled:bg-[#cbd5e1]"
					disabled={!prompt.trim()}
					onClick={submit}
					type="button"
				>
					{t("添加任务")}</button>
			</div>
		</Modal>
	);
}
