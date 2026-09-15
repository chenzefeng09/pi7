import {
	ArrowLeft,
	Bell,
	CalendarDays,
	CirclePause,
	CirclePlay,
	ClipboardCheck,
	Info,
	MoreHorizontal,
	Plus,
	Search,
	X,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
	nextOccurrence,
	pauseScheduledTask,
	runScheduledTask,
	useScheduledTaskStore,
	type ScheduledTask,
	type ScheduledTaskRepeat,
} from "../state/scheduled-tasks";
import { usePiStore } from "../state/store";
import { useUiStore } from "../state/ui";
import { MENU_PANEL_CLASS } from "./Menu";
import { popoverOverlayClass, popoverPanelClass, Presence } from "./Presence";
import { ScheduleCreateDialog } from "./ScheduleCreateDialog";
import { t } from "../i18n";

type ScheduleTab = "all" | "active" | "paused" | "completed";

const TABS: Array<{ id: ScheduleTab; label: string }> = [
	{ id: "all", label: t("全部") },
	{ id: "active", label: t("已开启") },
	{ id: "paused", label: t("已暂停") },
	{ id: "completed", label: t("已完成") },
];

const WEEKDAY_LABELS = [t("周日"), t("周一"), t("周二"), t("周三"), t("周四"), t("周五"), t("周六")];

const SUGGESTIONS = [
	{
		icon: Bell,
		iconClass: "text-[#2f7df6]",
		prompt: t("整理最近的会话记录和工作进展，生成今日简报，并列出今天的优先事项。"),
		repeat: "daily" as ScheduledTaskRepeat,
		schedule: t("工作日 8:00"),
		time: "08:00",
		title: t("每日简报"),
	},
	{
		icon: CalendarDays,
		iconClass: "text-[#8b5cf6]",
		prompt: t("回顾本周我完成的工作，整理成简明的状态更新，并列出下周的计划。"),
		repeat: "weekly" as ScheduledTaskRepeat,
		schedule: t("星期五（时间：16:00）"),
		time: "16:00",
		title: t("每周回顾"),
		weekday: 5,
	},
	{
		icon: ClipboardCheck,
		iconClass: "text-[#16a34a]",
		prompt: t("检查进行中的任务和未完成的跟进事项，标记需要关注的内容并给出下一步建议。"),
		repeat: "daily" as ScheduledTaskRepeat,
		schedule: t("工作日 9:00"),
		time: "09:00",
		title: t("跟进监控"),
	},
];

function thinkingLevelLabel(value: string): string {
	const labels: Record<string, string> = {
		off: t("关闭"),
		minimal: t("最低"),
		low: t("低"),
		medium: t("中"),
		high: t("高"),
		xhigh: t("极高"),
		max: t("最高"),
	};
	return labels[value] ?? value;
}

function taskTitle(task: ScheduledTask): string {
	const firstLine = task.prompt.split("\n")[0].trim();
	return firstLine.length > 40 ? `${firstLine.slice(0, 40)}…` : firstLine;
}

function relativeRun(value: string): string {
	const diff = new Date(value).getTime() - Date.now();
	if (Number.isNaN(diff)) return "";
	if (diff <= 0) return t("即将运行");
	const minutes = Math.round(diff / 60000);
	if (minutes < 60) return t("{minutes} 分钟后", { "minutes": minutes });
	const hours = Math.round(minutes / 60);
	if (hours < 24) return t("{hours} 小时后", { "hours": hours });
	return t("{arg} 天后", { "arg": Math.round(hours / 24) });
}

function scheduleSummary(task: ScheduledTask): string {
	if (task.repeat === "weekly") {
		const weekday = typeof task.weekday === "number" ? WEEKDAY_LABELS[task.weekday] : t("周五");
		return t("每{weekday} {time} · 下次运行 {arg}", { "weekday": weekday, "time": task.time, "arg": relativeRun(task.scheduledAt) });
	}
	if (task.repeat === "daily") {
		return t("每天 {time} · 下次运行 {arg}", { "time": task.time, "arg": relativeRun(task.scheduledAt) });
	}
	const date = new Date(task.scheduledAt);
	const text = Number.isNaN(date.getTime())
		? task.scheduledAt
		: date.toLocaleString("zh-CN", { day: "numeric", hour: "2-digit", minute: "2-digit", month: "numeric" });
	return t("一次性 · {text}", { "text": text });
}

function statusLabel(task: ScheduledTask): string {
	if (task.status === "paused") return t("已暂停");
	if (task.status === "completed") return t("已完成");
	if (task.status === "error") return t("失败");
	return t("活跃");
}

function matchesTab(task: ScheduledTask, tab: ScheduleTab): boolean {
	if (tab === "active") return task.status === "pending" || task.status === "running";
	if (tab === "paused") return task.status === "paused";
	if (tab === "completed") return task.status === "completed" || task.status === "error";
	return true;
}

export function ScheduleView() {
	const addTask = useScheduledTaskStore((state) => state.addTask);
	const removeTask = useScheduledTaskStore((state) => state.removeTask);
	const tasks = useScheduledTaskStore((state) => state.tasks);
	const updateTask = useScheduledTaskStore((state) => state.updateTask);
	const availableThinkingLevels = usePiStore((state) => state.availableThinkingLevels);
	const models = usePiStore((state) => state.models);
	const sessions = usePiStore((state) => state.sessions);
	const [tab, setTab] = useState<ScheduleTab>("all");
	const [search, setSearch] = useState("");
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [createOpen, setCreateOpen] = useState(false);
	const [menuOpen, setMenuOpen] = useState(false);
	const setView = useUiStore((state) => state.setView);

	const filtered = useMemo(() => {
		const query = search.trim().toLowerCase();
		return [...tasks]
			.filter((task) => matchesTab(task, tab))
			.filter((task) => !query || task.prompt.toLowerCase().includes(query))
			.sort((left, right) => new Date(left.scheduledAt).getTime() - new Date(right.scheduledAt).getTime());
	}, [search, tab, tasks]);
	const selected = selectedId ? tasks.find((task) => task.id === selectedId) : undefined;
	const projectOptions = useMemo(() => {
		const names = new Map<string, string>();
		for (const session of sessions) {
			if (session.cwd) {
				const normalized = session.cwd.replace(/\\/g, "/").replace(/\/$/, "");
				names.set(normalized, normalized.split("/").at(-1) || normalized);
			}
		}
		return Array.from(names.entries());
	}, [sessions]);

	const applySuggestion = (suggestion: (typeof SUGGESTIONS)[number]) => {
		addTask(suggestion.prompt, {
			repeat: suggestion.repeat,
			time: suggestion.time,
			weekday: suggestion.weekday,
		});
	};

	const patchSchedule = (task: ScheduledTask, patch: Partial<ScheduledTask>) => {
		const next = { ...task, ...patch };
		const scheduledAt =
			next.repeat === "once"
				? (() => {
						const current = new Date(next.scheduledAt);
						if (Number.isNaN(current.getTime())) return next.scheduledAt;
						const [hours, minutes] = next.time.split(":").map(Number);
						current.setHours(hours, minutes, 0, 0);
						return current.toISOString();
					})()
				: nextOccurrence(next.repeat, next.weekday, next.time, new Date()).toISOString();
		updateTask(task.id, { ...patch, scheduledAt });
	};

	return (
		<div className="flex min-h-0 flex-1 bg-white">
			<div className="scrollbar-subtle min-w-0 flex-1 overflow-y-auto">
				<div className="mx-auto w-full max-w-[720px] px-8 py-5">
					<div className="flex items-center justify-between gap-4">
						<div className="flex min-w-0 items-center gap-2">
							<button
								className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#667085] hover:bg-black/[0.05]"
								onClick={() => setView("chat")}
								title={t("返回对话")}
								type="button"
							>
								<ArrowLeft size={16} />
							</button>
							<div className="flex items-center gap-1">
							{TABS.map((item) => (
								<button
									className={`rounded-lg px-3 py-1.5 text-[14px] transition-colors ${
										tab === item.id
											? "bg-black/[0.07] font-medium text-[#111827]"
											: "text-[#667085] hover:bg-black/[0.04]"
									}`}
									key={item.id}
									onClick={() => setTab(item.id)}
									type="button"
								>
									{item.label}
								</button>
							))}
							</div>
						</div>
						<button
							className="flex items-center gap-1 rounded-full bg-[#1f2937] px-3.5 py-1.5 text-[13px] font-medium text-white hover:bg-[#111827]"
							onClick={() => setCreateOpen(true)}
							type="button"
						>
							<Plus size={14} />
							{t("创建")}</button>
					</div>

					<div className="mt-4 flex h-10 items-center gap-2 rounded-full border border-black/[0.1] px-4">
						<Search className="shrink-0 text-[#98a2b3]" size={15} />
						<input
							className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-[#98a2b3]"
							onChange={(event) => setSearch(event.target.value)}
							placeholder={t("搜索已安排任务")}
							value={search}
						/>
					</div>

					<div className="mt-4 divide-y divide-black/[0.05]">
						{filtered.map((task) => {
							const isSelected = task.id === selectedId;
							return (
								<button
									className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors ${
										isSelected ? "bg-black/[0.05]" : "hover:bg-black/[0.03]"
									}`}
									key={task.id}
									onClick={() => setSelectedId(isSelected ? null : task.id)}
									type="button"
								>
									<span
										className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
											isSelected ? "border-[#2f7df6] bg-[#2f7df6]" : "border-black/[0.2]"
										}`}
									>
										{isSelected ? <span className="h-1.5 w-1.5 rounded-full bg-white" /> : null}
									</span>
									<span className="min-w-0 flex-1">
										<span className="block truncate text-[15px] font-medium text-[#1f2937]">
											{taskTitle(task)}
										</span>
										<span className="mt-0.5 block truncate text-[13px] text-[#98a2b3]">
											{scheduleSummary(task)}
											{task.status === "paused" ? t(" · 已暂停") : null}
											{task.status === "running" ? t(" · 运行中") : null}
											{task.status === "error" ? ` · ${task.error ?? t("失败")}` : null}
										</span>
									</span>
								</button>
							);
						})}
						{filtered.length === 0 ? (
							<div className="py-10 text-center text-[13px] text-[#98a2b3]">{t("暂无定时任务")}</div>
						) : null}
					</div>

					<div className="mt-6">
						<div className="text-[15px] font-medium text-[#1f2937]">{t("建议")}</div>
						<div className="mt-2 divide-y divide-black/[0.05]">
							{SUGGESTIONS.map((suggestion) => (
								<button
									className="flex w-full items-start gap-3 rounded-xl px-3 py-3.5 text-left transition-colors hover:bg-black/[0.03]"
									key={suggestion.title}
									onClick={() => applySuggestion(suggestion)}
									type="button"
								>
									<suggestion.icon className={`mt-0.5 shrink-0 ${suggestion.iconClass}`} size={18} />
									<span className="min-w-0 flex-1">
										<span className="flex flex-wrap items-baseline gap-x-2">
											<span className="text-[15px] font-medium text-[#1f2937]">{suggestion.title}</span>
											<span className="text-[13px] text-[#667085]">{suggestion.schedule}</span>
										</span>
										<span className="mt-0.5 block truncate text-[13px] text-[#98a2b3]">{suggestion.prompt}</span>
									</span>
								</button>
							))}
						</div>
					</div>
				</div>
			</div>

			{selected ? (
				<div className="scrollbar-subtle w-[400px] shrink-0 overflow-y-auto border-l border-black/[0.06]">
					<div className="px-6 py-5">
						<div className="flex items-center justify-between">
							<span className={`text-[14px] font-medium ${selected.status === "error" ? "text-[#f04438]" : "text-[#2f7df6]"}`}>
								{statusLabel(selected)}
							</span>
							<div className="flex items-center gap-0.5">
								<div className="relative">
									<button
										className="flex h-8 w-8 items-center justify-center rounded-lg text-[#6b7280] hover:bg-black/[0.05]"
										onClick={() => setMenuOpen((value) => !value)}
										title={t("更多")}
										type="button"
									>
										<MoreHorizontal size={17} />
									</button>
									<Presence open={menuOpen}>
										{({ phase }) => (
											<>
												<div
													className={popoverOverlayClass(phase)}
													onClick={() => setMenuOpen(false)}
													role="presentation"
												/>
												<div
													className={`${MENU_PANEL_CLASS} ${popoverPanelClass(phase)} right-0 top-9 !w-44`}
												>
													{selected.status === "pending" || selected.status === "paused" ? (
														<button
															className="block w-full rounded-xl px-3 py-2.5 text-left text-[14px] text-[#374151] hover:bg-black/[0.04]"
															onClick={() => {
																setMenuOpen(false);
																if (selected.status === "paused") {
																	updateTask(selected.id, { status: "pending" });
																}
																void runScheduledTask(selected.id);
															}}
															type="button"
														>
															{t("立即运行")}</button>
													) : null}
													<button
														className="block w-full rounded-xl px-3 py-2.5 text-left text-[14px] text-[#f04438] hover:bg-black/[0.04]"
														onClick={() => {
															setMenuOpen(false);
															setSelectedId(null);
															removeTask(selected.id);
														}}
														type="button"
													>
														{t("删除任务")}</button>
												</div>
											</>
										)}
									</Presence>
								</div>
								<button
									className="flex h-8 w-8 items-center justify-center rounded-lg text-[#6b7280] hover:bg-black/[0.05]"
									disabled={selected.status === "completed" || selected.status === "error"}
									onClick={() => {
									if (selected.status === "running") {
										pauseScheduledTask(selected.id);
										return;
									}
									updateTask(selected.id, {
										status: selected.status === "paused" ? "pending" : "paused",
									});
								}}
									title={selected.status === "paused" ? t("恢复") : t("暂停")}
									type="button"
								>
									{selected.status === "paused" ? <CirclePlay size={17} /> : <CirclePause size={17} />}
								</button>
								<button
									className="flex h-8 w-8 items-center justify-center rounded-lg text-[#6b7280] hover:bg-black/[0.05]"
									onClick={() => setSelectedId(null)}
									title={t("关闭")}
									type="button"
								>
									<X size={17} />
								</button>
							</div>
						</div>

						<div className="mt-3 text-[20px] font-semibold text-[#111827]">{taskTitle(selected)}</div>
						<div className="mt-3 whitespace-pre-wrap rounded-2xl border border-black/[0.08] px-4 py-3 text-[14px] leading-6 text-[#374151]">
							{selected.prompt}
						</div>
						{selected.error ? (
							<div className="mt-2 rounded-xl bg-[#fef3f2] px-3 py-2 text-[12px] text-[#f04438]">{selected.error}</div>
						) : null}

						<div className="mt-6 flex items-center justify-between">
							<span className="text-[14px] font-medium text-[#1f2937]">{t("详情")}</span>
							<Info className="text-[#98a2b3]" size={15} />
						</div>
						<div className="mt-2 divide-y divide-black/[0.05] rounded-2xl border border-black/[0.08]">
							<DetailRow
								label={t("运行于")}
								onChange={(value) => updateTask(selected.id, { runTarget: value === "new" ? "new" : "current" })}
								options={[
									["new", t("每次运行时新建聊天")],
									["current", t("在当前聊天中运行")],
								]}
								value={selected.runTarget}
							/>
							<DetailRow
								label={t("项目")}
								onChange={(value) => updateTask(selected.id, { project: value || undefined })}
				options={[["", t("无")], ...projectOptions.map(([cwd, name]) => [cwd, name] as [string, string])]}
								value={selected.project ?? ""}
							/>
							<DetailRow
								label={t("模型")}
								onChange={(value) => {
									if (!value) {
										updateTask(selected.id, { model: undefined, provider: undefined });
										return;
									}
									const target = models.find((item) => item.id === value);
									updateTask(selected.id, { model: value, provider: target?.provider });
								}}
								options={[["", t("跟随当前")], ...models.map((item) => [item.id, item.name ?? item.id] as [string, string])]}
								value={selected.model ?? ""}
							/>
							<DetailRow
								label={t("推理")}
								onChange={(value) => updateTask(selected.id, { thinking: value || undefined })}
								options={[
									["", t("跟随当前")],
									...availableThinkingLevels.map(
										(level) => [level, thinkingLevelLabel(level)] as [string, string],
									),
								]}
								value={selected.thinking ?? ""}
							/>
						</div>

						<div className="mt-6 text-[14px] font-medium text-[#1f2937]">{t("频率")}</div>
						<div className="mt-2 divide-y divide-black/[0.05] rounded-2xl border border-black/[0.08]">
							<DetailRow
								label={t("重复")}
								onChange={(value) => patchSchedule(selected, { repeat: value as ScheduledTaskRepeat })}
								options={[
									["once", t("一次")],
									["daily", t("每天")],
									["weekly", t("每周")],
								]}
								value={selected.repeat}
							/>
							{selected.repeat === "weekly" ? (
								<DetailRow
									label={t("开启")}
									onChange={(value) => patchSchedule(selected, { weekday: Number(value) })}
									options={WEEKDAY_LABELS.map((label, index) => [String(index), label] as [string, string])}
									value={String(selected.weekday ?? 5)}
								/>
							) : null}
							<div className="flex items-center justify-between gap-3 px-4 py-3">
								<span className="text-[14px] text-[#374151]">{t("时间")}</span>
								<input
									className="rounded-lg border border-transparent bg-transparent px-2 py-1 text-right text-[14px] text-[#1f2937] outline-none hover:border-black/[0.1] focus:border-[#2f7df6]"
									onChange={(event) => {
										if (/^\d{2}:\d{2}$/.test(event.target.value)) {
											patchSchedule(selected, { time: event.target.value });
										}
									}}
									type="time"
									value={selected.time}
								/>
							</div>
							<DetailRow
								label={t("通知")}
								onChange={(value) => updateTask(selected.id, { notify: value === "errors" ? "errors" : "all" })}
								options={[
									["all", t("所有运行")],
									["errors", t("仅失败时")],
								]}
								value={selected.notify}
							/>
						</div>
						<div className="mt-3 text-[12px] text-[#98a2b3]">
							{scheduleSummary(selected)}
							{selected.completedAt
								? t(" · 上次完成 {arg}", { "arg": new Date(selected.completedAt).toLocaleString("zh-CN", { hour12: false }) })
								: ""}
						</div>
					</div>
				</div>
			) : null}

			<ScheduleCreateDialog onClose={() => setCreateOpen(false)} open={createOpen} />
		</div>
	);
}

function DetailRow({
	label,
	onChange,
	options,
	value,
}: {
	label: string;
	onChange: (value: string) => void;
	options: Array<[string, string]>;
	value: string;
}) {
	return (
		<div className="flex items-center justify-between gap-3 px-4 py-3">
			<span className="shrink-0 text-[14px] text-[#374151]">{label}</span>
			<select
				className="max-w-[220px] truncate rounded-lg border border-transparent bg-transparent px-2 py-1 text-right text-[14px] text-[#1f2937] outline-none hover:border-black/[0.1] focus:border-[#2f7df6]"
				onChange={(event) => onChange(event.target.value)}
				value={value}
			>
				{options.map(([optionValue, optionLabel]) => (
					<option key={optionValue || "empty"} value={optionValue}>
						{optionLabel}
					</option>
				))}
			</select>
		</div>
	);
}
