import { beforeEach, describe, expect, it, vi } from "vitest";
import { pauseScheduledTask, runScheduledTask, taskRunsOnVisibleSession, useScheduledTaskStore } from "./scheduled-tasks";
import { usePiStore } from "./store";
import type { BackgroundSession, ChatMessage } from "./types";

/** Minimal `window.pi` so the store actions can be driven without Electron. */
function stubPi(handler: (command: Record<string, unknown>) => unknown): Array<Record<string, unknown>> {
	const calls: Array<Record<string, unknown>> = [];
	(globalThis as unknown as { window: { pi: Record<string, unknown> } }).window = {
		pi: {
			command: async (command: unknown) => {
				const record = command as Record<string, unknown>;
				calls.push(record);
				return handler(record);
			},
			listSessions: async () => [],
		},
	};
	return calls;
}

function userMessage(id: string, text: string): ChatMessage {
	return { blocks: [{ state: "complete", text, type: "text" }], id, role: "user", state: "complete" };
}

function assistantMessage(id: string, text: string, state: ChatMessage["state"]): ChatMessage {
	return { blocks: [{ state, text, type: "text" }], id, role: "assistant", state };
}

function slice(overrides: Partial<BackgroundSession>): BackgroundSession {
	return {
		loaded: true,
		messageCount: 0,
		messages: [],
		queue: { followUp: [], steering: [] },
		status: "idle",
		streaming: false,
		unread: false,
		...overrides,
	};
}

/** A bound, idle workspace session on handle s-task. */
function boundSessionState(): void {
	usePiStore.setState({
		activeHandleId: "s-task",
		backgroundSessions: {},
		handles: { "d:/proj/a.jsonl": "s-task" },
		messageCount: 1,
		messages: [userMessage("u1", "earlier")],
		multiSession: true,
		sessionCwd: "D:/proj",
		sessionFile: "D:/proj/a.jsonl",
		sessionLoading: false,
		sessionProject: "D:/proj",
		status: "idle",
	});
}

/** The user opened another session while the task's run continues on its own handle. */
function moveTaskToBackground(status: BackgroundSession["status"]): void {
	usePiStore.setState((state) => ({
		activeHandleId: "s-other",
		backgroundSessions: {
			...state.backgroundSessions,
			"s-task": slice({ messages: state.messages, status, streaming: status === "streaming" }),
			"s-other": slice({}),
		},
		handles: { "d:/proj/a.jsonl": "s-task", "d:/proj/b.jsonl": "s-other" },
		messages: [],
		status: "idle",
	}));
}

/** The background run ends: the slice settles with whatever messages it collected. */
async function settleTask(messages: ChatMessage[]): Promise<void> {
	// Let one watcher poll observe the streaming mark first; a settle before that is only
	// trusted after the run-start grace window, which would slow the test by seconds.
	await new Promise((resolve) => setTimeout(resolve, 400));
	usePiStore.setState((state) => ({
		backgroundSessions: {
			...state.backgroundSessions,
			"s-task": { ...state.backgroundSessions["s-task"], messages, status: "idle", streaming: false },
		},
	}));
}

function taskStatus(id: string): string | undefined {
	return useScheduledTaskStore.getState().tasks.find((task) => task.id === id)?.status;
}

describe("scheduled tasks", () => {
	beforeEach(() => {
		usePiStore.getState().reset();
		useScheduledTaskStore.setState({ tasks: [] });
	});

	it("marks a model turn that ended in error as a failed task, not a completed one", async () => {
		const calls = stubPi((command) =>
			command.type === "prompt" ? { data: { sessionId: "s-task", started: true }, success: true } : { data: {} },
		);
		boundSessionState();
		useScheduledTaskStore.getState().addTask("summarize the repo", { repeat: "once", runTarget: "current" });
		const task = useScheduledTaskStore.getState().tasks[0];

		const running = runScheduledTask(task.id);
		await vi.waitFor(() => expect(calls.some((call) => call.type === "prompt")).toBe(true));
		expect(calls.find((call) => call.type === "prompt")).toMatchObject({ sessionId: "s-task" });

		// The run fails after the user has already switched to another session.
		moveTaskToBackground("streaming");
		await settleTask([
			userMessage("u1", "earlier"),
			userMessage("u2", "summarize the repo"),
			assistantMessage("a1", "", "error"),
		]);
		await running;
		expect(taskStatus(task.id)).toBe("error");
	});

	it("completes when the run settles with a finished assistant message", async () => {
		stubPi((command) =>
			command.type === "prompt" ? { data: { sessionId: "s-task", started: true }, success: true } : { data: {} },
		);
		boundSessionState();
		useScheduledTaskStore.getState().addTask("summarize the repo", { repeat: "once", runTarget: "current" });
		const task = useScheduledTaskStore.getState().tasks[0];

		const running = runScheduledTask(task.id);
		await vi.waitFor(() => expect(usePiStore.getState().status).toBe("streaming"));
		moveTaskToBackground("streaming");
		await settleTask([
			userMessage("u1", "earlier"),
			userMessage("u2", "summarize the repo"),
			assistantMessage("a1", "done", "complete"),
		]);
		await running;
		expect(taskStatus(task.id)).toBe("completed");
	});

	it("runs a new-session task on its own handle without touching the visible session", async () => {
		const calls = stubPi((command) => {
			if (command.type === "open_session") {
				return {
					data: { cwd: "D:/proj", sessionFile: "D:/proj/task.jsonl", sessionId: "s-task2" },
					success: true,
				};
			}
			if (command.type === "prompt") {
				return { data: { sessionId: "s-task2", started: true }, success: true };
			}
			return { data: {} };
		});
		boundSessionState();
		useScheduledTaskStore.getState().addTask("nightly report", { repeat: "once", runTarget: "new" });
		const task = useScheduledTaskStore.getState().tasks[0];

		const running = runScheduledTask(task.id);
		await vi.waitFor(() => expect(calls.some((call) => call.type === "prompt")).toBe(true));

		// The task session opens next to the visible one, not over it.
		expect(calls.find((call) => call.type === "open_session")).toMatchObject({
			activate: false,
			cwd: "D:/proj",
		});
		expect(usePiStore.getState().activeHandleId).toBe("s-task");
		expect(calls.find((call) => call.type === "prompt")).toMatchObject({ sessionId: "s-task2" });

		usePiStore.setState((state) => ({
			backgroundSessions: {
				...state.backgroundSessions,
				"s-task2": slice({ status: "streaming", streaming: true }),
			},
		}));
		await new Promise((resolve) => setTimeout(resolve, 400));
		usePiStore.setState((state) => ({
			backgroundSessions: {
				...state.backgroundSessions,
				"s-task2": {
					...state.backgroundSessions["s-task2"],
					messages: [userMessage("u1", "nightly report"), assistantMessage("a1", "done", "complete")],
					status: "idle",
					streaming: false,
				},
			},
		}));
		await running;
		expect(taskStatus(task.id)).toBe("completed");
	});

	it("only tasks bound to the visible session wait for it to go idle", () => {
		boundSessionState();
		useScheduledTaskStore.getState().addTask("in this session", { runTarget: "current" });
		useScheduledTaskStore.getState().addTask("own session", { runTarget: "new" });
		useScheduledTaskStore.getState().addTask("other project", { project: "D:/other", runTarget: "current" });
		useScheduledTaskStore.getState().addTask("same project", { project: "D:/proj", runTarget: "current" });
		const [inThis, own, otherProject, sameProject] = useScheduledTaskStore.getState().tasks;

		expect(taskRunsOnVisibleSession(inThis)).toBe(true);
		expect(taskRunsOnVisibleSession(own)).toBe(false);
		expect(taskRunsOnVisibleSession(otherProject)).toBe(false);
		expect(taskRunsOnVisibleSession(sameProject)).toBe(true);

		// A single-session runtime has no other handle: every task shares the screen.
		usePiStore.setState({ multiSession: false });
		expect(taskRunsOnVisibleSession(own)).toBe(true);
	});

	it("pauses by aborting the task's own handle, not the session on screen", async () => {
		const calls = stubPi((command) =>
			command.type === "prompt" ? { data: { sessionId: "s-task", started: true }, success: true } : { data: {} },
		);
		boundSessionState();
		useScheduledTaskStore.getState().addTask("long running work", { repeat: "once", runTarget: "current" });
		const task = useScheduledTaskStore.getState().tasks[0];

		const running = runScheduledTask(task.id);
		await vi.waitFor(() => expect(usePiStore.getState().status).toBe("streaming"));
		moveTaskToBackground("streaming");

		pauseScheduledTask(task.id);
		await running;

		expect(taskStatus(task.id)).toBe("paused");
		const aborts = calls.filter((call) => call.type === "abort");
		expect(aborts).toEqual([expect.objectContaining({ sessionId: "s-task", type: "abort" })]);
		// The session on screen was not the one stopped.
		expect(usePiStore.getState().status).toBe("idle");
		expect(usePiStore.getState().messages).toEqual([]);
	});
});
