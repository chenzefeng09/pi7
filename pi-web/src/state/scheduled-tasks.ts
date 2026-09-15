import { create } from "zustand";
import { hasWorkspaceForPrompt, usePiStore } from "./store";
import { t } from "../i18n";

export type ScheduledTaskStatus = "pending" | "running" | "paused" | "completed" | "error";
export type ScheduledTaskRepeat = "once" | "daily" | "weekly";
export type ScheduledTaskNotify = "all" | "errors";
export type ScheduledTaskRunTarget = "current" | "new";

export interface ScheduledTask {
	completedAt?: string;
	createdAt: string;
	error?: string;
	id: string;
	model?: string;
	notify: ScheduledTaskNotify;
	project?: string;
	prompt: string;
	provider?: string;
	repeat: ScheduledTaskRepeat;
	runTarget: ScheduledTaskRunTarget;
	scheduledAt: string;
	status: ScheduledTaskStatus;
	thinking?: string;
	time: string;
	weekday?: number;
}

export interface ScheduledTaskDraft {
	model?: string;
	scheduledAt?: string;
	notify?: ScheduledTaskNotify;
	project?: string;
	provider?: string;
	repeat?: ScheduledTaskRepeat;
	runTarget?: ScheduledTaskRunTarget;
	thinking?: string;
	time?: string;
	weekday?: number;
}

interface ScheduledTaskStore {
	addTask: (prompt: string, draft?: ScheduledTaskDraft) => void;
	removeTask: (id: string) => void;
	tasks: ScheduledTask[];
	updateTask: (id: string, patch: Partial<Omit<ScheduledTask, "id">>) => void;
}

const STORAGE_KEY = "pi7.scheduled-tasks";
const runningTasks = new Set<string>();
const taskRunGenerations = new Map<string, number>();
/** The RPC handle a task's in-flight run belongs to, so its status/messages/abort stay scoped. */
const taskHandles = new Map<string, string>();

function invalidateTaskRun(id: string): void {
	taskRunGenerations.set(id, (taskRunGenerations.get(id) ?? 0) + 1);
}

const REPEATS: ScheduledTaskRepeat[] = ["once", "daily", "weekly"];
const STATUSES: ScheduledTaskStatus[] = ["pending", "running", "paused", "completed", "error"];

function asRepeat(value: unknown): ScheduledTaskRepeat {
	return REPEATS.includes(value as ScheduledTaskRepeat) ? (value as ScheduledTaskRepeat) : "once";
}

function asStatus(value: unknown): ScheduledTaskStatus {
	return STATUSES.includes(value as ScheduledTaskStatus) ? (value as ScheduledTaskStatus) : "pending";
}

function asTime(value: unknown): string {
	return typeof value === "string" && /^\d{2}:\d{2}$/.test(value) ? value : "09:00";
}

export function nextOccurrence(repeat: ScheduledTaskRepeat, weekday: number | undefined, time: string, from: Date): Date {
	const [hours, minutes] = asTime(time).split(":").map(Number);
	const candidate = new Date(from);
	candidate.setHours(hours, minutes, 0, 0);
	if (repeat === "daily") {
		if (candidate.getTime() <= from.getTime()) candidate.setDate(candidate.getDate() + 1);
		return candidate;
	}
	if (repeat === "weekly") {
		const target = typeof weekday === "number" && weekday >= 0 && weekday <= 6 ? weekday : 5;
		for (let offset = 0; offset < 8; offset += 1) {
			const day = new Date(candidate);
			day.setDate(candidate.getDate() + offset);
			if (day.getDay() === target && day.getTime() > from.getTime()) return day;
		}
		return candidate;
	}
	return candidate;
}

function readTasks(): ScheduledTask[] {
	if (typeof localStorage === "undefined") return [];
	try {
		const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
		if (!Array.isArray(parsed)) return [];
		const tasks: ScheduledTask[] = [];
		for (const item of parsed) {
			if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
			const record = item as Record<string, unknown>;
			if (typeof record.id !== "string" || typeof record.prompt !== "string" || typeof record.scheduledAt !== "string") {
				continue;
			}
			const weekday =
				typeof record.weekday === "number" && record.weekday >= 0 && record.weekday <= 6
					? record.weekday
					: undefined;
			const persistedStatus = asStatus(record.status);
			tasks.push({
				completedAt: typeof record.completedAt === "string" ? record.completedAt : undefined,
				createdAt: typeof record.createdAt === "string" ? record.createdAt : new Date().toISOString(),
				error: typeof record.error === "string" ? record.error : undefined,
				id: record.id,
				model: typeof record.model === "string" ? record.model : undefined,
				notify: record.notify === "errors" ? "errors" : "all",
				project: typeof record.project === "string" ? record.project : undefined,
				prompt: record.prompt,
				provider: typeof record.provider === "string" ? record.provider : undefined,
				repeat: asRepeat(record.repeat),
				runTarget: record.runTarget === "current" ? "current" : "new",
				scheduledAt: record.scheduledAt,
				// A page reload cannot keep an in-memory run alive. Retry a task that was persisted as
				// running instead of leaving it permanently invisible to the scheduler.
				status: persistedStatus === "running" ? "pending" : persistedStatus,
				thinking: typeof record.thinking === "string" ? record.thinking : undefined,
				time: asTime(record.time),
				weekday,
			});
		}
		return tasks;
	} catch {
		return [];
	}
}

function writeTasks(tasks: ScheduledTask[]): void {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
	} catch {}
}

function nextTaskId(): string {
	return `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useScheduledTaskStore = create<ScheduledTaskStore>((set) => ({
	addTask: (prompt, draft = {}) =>
		set((state) => {
			const repeat = draft.repeat ?? "once";
			const time = asTime(draft.time);
			const scheduledAt =
				repeat === "once" && typeof draft.scheduledAt === "string"
					? draft.scheduledAt
					: nextOccurrence(repeat, draft.weekday, time, new Date()).toISOString();
			const tasks: ScheduledTask[] = [
				...state.tasks,
				{
					createdAt: new Date().toISOString(),
					id: nextTaskId(),
					model: draft.model,
					notify: draft.notify ?? "all",
					project: draft.project,
					prompt,
					provider: draft.provider,
					repeat,
					runTarget: draft.runTarget ?? "new",
					scheduledAt,
					status: "pending",
					thinking: draft.thinking,
					time,
					weekday: draft.weekday,
				},
			];
			writeTasks(tasks);
			return { tasks };
		}),
	removeTask: (id) =>
		set((state) => {
			const current = state.tasks.find((task) => task.id === id);
			invalidateTaskRun(id);
			if (current?.status === "running") void usePiStore.getState().abort(taskHandles.get(id)).catch(() => {});
			const tasks = state.tasks.filter((task) => task.id !== id);
			writeTasks(tasks);
			return { tasks };
		}),
	tasks: readTasks(),
	updateTask: (id, patch) =>
		set((state) => {
			const current = state.tasks.find((task) => task.id === id);
			if (current?.status === "running" && (patch.status === "paused" || patch.status === "completed")) {
				invalidateTaskRun(id);
			}
			const tasks = state.tasks.map((task) => (task.id === id ? { ...task, ...patch } : task));
			writeTasks(tasks);
			return { tasks };
		}),
}));

function pushNotification(message: string, type: "info" | "error"): void {
	usePiStore.setState((state) => ({
		extensionUiNotifications: [
			...state.extensionUiNotifications,
			{ id: `sched-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, message, type },
		],
	}));
}

function samePath(left: string | undefined, right: string | undefined): boolean {
	if (!left || !right) return false;
	const normalize = (value: string) => value.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
	return normalize(left) === normalize(right);
}

interface TaskSessionView {
	error?: string;
	/** The handle is gone entirely: closed or lost with a process exit. */
	gone: boolean;
	messages: { id: string; role: string; state: string; blocks: { type: string; text?: string }[] }[];
	status: "idle" | "starting" | "streaming" | "error";
}

/**
 * Read the session a task run belongs to, wherever it currently lives. The user may switch to
 * another session mid-run: the flat store fields then describe that other session, and only the
 * task handle's background slice still tells the truth about the run.
 */
function taskSessionView(handleId: string | undefined): TaskSessionView {
	const state = usePiStore.getState();
	if (!state.multiSession || handleId === undefined || state.activeHandleId === handleId) {
		return {
			error: state.error,
			gone: false,
			messages: state.messages,
			status: state.status,
		};
	}
	const slice = state.backgroundSessions[handleId];
	const known = slice !== undefined || Object.values(state.handles).includes(handleId);
	return { gone: !known, messages: slice?.messages ?? [], status: slice?.status ?? "idle" };
}

function lastAssistantText(view: TaskSessionView): string | undefined {
	const last = [...view.messages].reverse().find((message) => message.role === "assistant");
	const text = last?.blocks.filter((block) => block.type === "text").map((block) => block.text).join("\n");
	return text || undefined;
}

export async function runScheduledTask(id: string): Promise<void> {
	if (runningTasks.has(id)) return;
	const task = useScheduledTaskStore.getState().tasks.find((item) => item.id === id);
	if (!task || task.status !== "pending") return;
	if (!task.project && !hasWorkspaceForPrompt(usePiStore.getState())) {
		useScheduledTaskStore.getState().updateTask(id, { status: "paused", error: t("请先选择工作区") });
		pushNotification(t("定时任务「{arg}」已暂停：请先选择工作区", { "arg": task.prompt.split("\n")[0].slice(0, 40) }), "error");
		return;
	}
	runningTasks.add(id);
	const runGeneration = (taskRunGenerations.get(id) ?? 0) + 1;
	taskRunGenerations.set(id, runGeneration);
	const abortGeneration = usePiStore.getState().abortGeneration;
	useScheduledTaskStore.getState().updateTask(id, { error: undefined, status: "running" });
	const title = task.prompt.split("\n")[0].slice(0, 40);
	try {
		const pi = usePiStore.getState();
		if (task.project) {
			const currentCwd = usePiStore.getState().sessionCwd;
			if (!samePath(currentCwd, task.project) || task.runTarget === "new") await pi.newSessionIn(task.project);
		}
		if (taskRunGenerations.get(id) !== runGeneration) return;
		if (task.runTarget === "new" && !task.project) await pi.newSession();
		if (taskRunGenerations.get(id) !== runGeneration) return;
		// The prompt and the whole wait below stay pinned to this handle: the user is free to
		// switch sessions while the task runs, and none of that may redirect the run or fool
		// the watcher into reading another session's status.
		const taskHandle = usePiStore.getState().activeHandleId;
		if (taskHandle) taskHandles.set(id, taskHandle);
		// Model and thinking changes are scoped to the task's handle too: an untagged command
		// resolves to whatever session is active when it lands, so a mid-setup session switch
		// would otherwise apply the task's model to the session the user just opened.
		if (task.provider && task.model) await pi.setModel(task.provider, task.model, taskHandle);
		if (taskRunGenerations.get(id) !== runGeneration) return;
		if (task.thinking) await pi.setThinkingLevel(task.thinking, taskHandle);
		if (taskRunGenerations.get(id) !== runGeneration) return;
		// Read the task session before the send lands: the prompt is only worth waiting on when
		// it starts a run or joins one that was already in flight.
		const before = taskSessionView(taskHandle);
		const lastAssistantBefore = [...before.messages]
			.reverse()
			.find((message) => message.role === "assistant")?.id;
		const { started } = await pi.send(task.prompt, undefined, undefined, taskHandle);
		// A run that fails before the first 250ms poll never shows "streaming" to the watcher,
		// so a settle is only trusted after streaming was seen — or once the run has had a
		// generous window to appear. A prompt that was queued or handled without starting a run
		// (started === false) waits only when a run was already in flight to consume it.
		const deadline = Date.now() + 30 * 60 * 1000;
		const startDeadline = Date.now() + 5000;
		const expectRun = started !== false || before.status === "streaming";
		let sawStreaming = false;
		while (Date.now() < deadline) {
			if (taskRunGenerations.get(id) !== runGeneration) return;
			const view = taskSessionView(taskHandle);
			if (view.gone) throw new Error(t("任务会话已关闭"));
			// A dead process never sends agent_settled, so the run would look busy forever.
			if (usePiStore.getState().connectionError) throw new Error(usePiStore.getState().connectionError);
			if (view.status === "streaming") sawStreaming = true;
			else if (sawStreaming) break;
			else if (!expectRun || Date.now() >= startDeadline) break;
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
		if (taskRunGenerations.get(id) !== runGeneration) return;
		const settled = taskSessionView(taskHandle);
		if (Date.now() >= deadline) throw new Error(t("任务执行超时"));
		// The run's outcome lives on the last assistant message, not on the session status:
		// agent_settled lands as "idle" even when the turn ended in an error, and the visible
		// status may belong to another session entirely.
		const lastAssistant = [...settled.messages].reverse().find((message) => message.role === "assistant");
		const produced = lastAssistant !== undefined && lastAssistant.id !== lastAssistantBefore;
		if (settled.status === "error" || (produced && lastAssistant.state === "error")) {
			throw new Error(settled.error ?? lastAssistantText(settled) ?? t("任务执行失败"));
		}
		if (produced && lastAssistant.state === "aborted") {
			useScheduledTaskStore.getState().updateTask(id, { status: "paused", error: t("已手动停止") });
			return;
		}
		if (usePiStore.getState().abortGeneration !== abortGeneration) {
			useScheduledTaskStore.getState().updateTask(id, { status: "paused", error: t("已手动停止") });
			return;
		}
		const completedAt = new Date().toISOString();
		if (task.repeat === "once") {
			useScheduledTaskStore.getState().updateTask(id, { completedAt, status: "completed" });
		} else {
			const next = nextOccurrence(task.repeat, task.weekday, task.time, new Date());
			useScheduledTaskStore.getState().updateTask(id, {
				completedAt,
				scheduledAt: next.toISOString(),
				status: "pending",
			});
		}
		if (task.notify === "all") pushNotification(t("定时任务「{title}」已完成", { "title": title }), "info");
	} catch (error) {
		if (taskRunGenerations.get(id) !== runGeneration) return;
		if (usePiStore.getState().abortGeneration !== abortGeneration) {
			useScheduledTaskStore.getState().updateTask(id, { status: "paused", error: t("已手动停止") });
			return;
		}
		const message = error instanceof Error ? error.message : String(error);
		useScheduledTaskStore.getState().updateTask(id, { error: message, status: "error" });
		pushNotification(t("定时任务「{title}」失败：{message}", { "title": title, "message": message }), "error");
	} finally {
		runningTasks.delete(id);
		taskHandles.delete(id);
		if (taskRunGenerations.get(id) === runGeneration) taskRunGenerations.delete(id);
	}
}

/** Pause a running task and stop the agent turn it owns. */
export function pauseScheduledTask(id: string): void {
	const task = useScheduledTaskStore.getState().tasks.find((item) => item.id === id);
	if (!task || task.status !== "running") return;
	invalidateTaskRun(id);
	useScheduledTaskStore.getState().updateTask(id, { status: "paused", error: t("已手动暂停") });
	// The task's own handle is aborted, not whatever happens to be on screen.
	void usePiStore.getState().abort(taskHandles.get(id)).catch(() => {});
}

