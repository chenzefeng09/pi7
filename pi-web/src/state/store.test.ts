import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_OPEN_SESSIONS, MIN_OPEN_SESSIONS, useSessionPoolSettings } from "./session-pool";
import { usePiStore } from "./store";
import type { BackgroundSession, ChatMessage } from "./types";

/** Minimal `window.pi` so store actions can be driven without Electron. */
function stubPi(handler: (command: Record<string, unknown>) => unknown): Array<Record<string, unknown>> {
	const calls: Array<Record<string, unknown>> = [];
	(globalThis as unknown as { window: { pi: Record<string, unknown> } }).window = {
		pi: {
			command: async (command: unknown) => {
				const record = command as Record<string, unknown>;
				calls.push(record);
				// Session switches re-read the command list; answering non-empty on the first try
				// keeps loadCommands' warm-up retries from leaking calls into the next test.
				if (record.type === "get_commands") {
					return { data: { commands: [{ name: "stub-command", source: "extension" }] }, success: true };
				}
				return handler(record);
			},
			listSessions: async () => [],
		},
	};
	return calls;
}

function textMessage(id: string, text: string): ChatMessage {
	return { blocks: [{ state: "complete", text, type: "text" }], id, role: "user", state: "complete" };
}

function backgroundSlice(overrides: Partial<BackgroundSession>): BackgroundSession {
	return {
		// Test slices stand for a session the renderer has already read unless stated otherwise.
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

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolver) => {
		resolve = resolver;
	});
	return { promise, resolve };
}

describe("pi store event reducer", () => {
	beforeEach(() => {
		usePiStore.getState().reset();
	});

	it("adds a user message", () => {
		usePiStore.getState().applyEvent({
			message: { content: [{ text: "hi", type: "text" }], role: "user" },
			type: "message_start",
		});
		const messages = usePiStore.getState().messages;
		expect(messages).toHaveLength(1);
		expect(messages[0]).toMatchObject({ role: "user", state: "complete" });
		expect(messages[0].blocks[0]).toMatchObject({ text: "hi", type: "text" });
	});

	it("measures output speed from cumulative usage while a message streams", () => {
		vi.useFakeTimers();
		try {
			usePiStore.getState().applyEvent({
				message: { content: [], role: "assistant" },
				type: "message_start",
			});
			vi.advanceTimersByTime(2000);
			usePiStore.getState().applyEvent({ type: "message_update", usage: { output: 400 } });
			expect(usePiStore.getState().outputTokensPerSecond).toBeCloseTo(200, 0);
		} finally {
			vi.useRealTimers();
		}
	});

	it("leaves the output speed alone while a message is too young to rate", () => {
		vi.useFakeTimers();
		try {
			usePiStore.getState().applyEvent({
				message: { content: [], role: "assistant" },
				type: "message_start",
			});
			vi.advanceTimersByTime(300);
			usePiStore.getState().applyEvent({ type: "message_update", usage: { output: 5 } });
			expect(usePiStore.getState().outputTokensPerSecond).toBeUndefined();
		} finally {
			vi.useRealTimers();
		}
	});

	it("renders user image content", () => {
		usePiStore.getState().applyEvent({
			message: {
				content: [
					{ text: "look", type: "text" },
					{ data: "aGVsbG8=", mimeType: "image/png", type: "image" },
				],
				role: "user",
			},
			type: "message_start",
		});
		expect(usePiStore.getState().messages[0].blocks).toEqual([
			{ state: "complete", text: "look", type: "text" },
			{ data: "aGVsbG8=", mimeType: "image/png", type: "image" },
		]);
	});

	it("streams assistant text and finalizes from message_end", () => {
		usePiStore.getState().applyEvent({ message: { content: [], role: "assistant" }, type: "message_start" });
		usePiStore.getState().applyEvent({
			assistantMessageEvent: { contentIndex: 0, type: "text_start" },
			type: "message_update",
		});
		usePiStore.getState().applyEvent({
			assistantMessageEvent: { contentIndex: 0, delta: "o", type: "text_delta" },
			type: "message_update",
		});
		usePiStore.getState().applyEvent({
			assistantMessageEvent: { contentIndex: 0, delta: "k", type: "text_delta" },
			type: "message_update",
		});
		usePiStore.getState().applyEvent({
			message: { content: [{ text: "ok", type: "text" }], role: "assistant", stopReason: "stop" },
			type: "message_end",
		});
		usePiStore.getState().applyEvent({ type: "agent_settled" });
		const message = usePiStore.getState().messages.at(-1);
		expect(message?.state).toBe("complete");
		expect(message?.blocks[0]).toMatchObject({ state: "complete", text: "ok", type: "text" });
		expect(usePiStore.getState().status).toBe("idle");
	});

	it("streams thinking blocks", () => {
		usePiStore.getState().applyEvent({ message: { content: [], role: "assistant" }, type: "message_start" });
		usePiStore.getState().applyEvent({
			assistantMessageEvent: { contentIndex: 0, type: "thinking_start" },
			type: "message_update",
		});
		usePiStore.getState().applyEvent({
			assistantMessageEvent: { contentIndex: 0, delta: "plan", type: "thinking_delta" },
			type: "message_update",
		});
		usePiStore.getState().applyEvent({
			assistantMessageEvent: { contentIndex: 0, type: "thinking_end" },
			type: "message_update",
		});
		const block = usePiStore.getState().messages.at(-1)?.blocks[0];
		expect(block).toMatchObject({ state: "complete", text: "plan", type: "thinking" });
	});

	it("renders tool execution start, update and end", () => {
		usePiStore.getState().applyEvent({ message: { content: [], role: "assistant" }, type: "message_start" });
		usePiStore.getState().applyEvent({
			args: { command: "ls" },
			toolCallId: "tool-1",
			toolName: "bash",
			type: "tool_execution_start",
		});
		usePiStore.getState().applyEvent({
			partialResult: "file-a\n",
			toolCallId: "tool-1",
			toolName: "bash",
			type: "tool_execution_update",
		});
		usePiStore.getState().applyEvent({
			isError: false,
			result: {},
			toolCallId: "tool-1",
			toolName: "bash",
			type: "tool_execution_end",
		});
		const block = usePiStore
			.getState()
			.messages.at(-1)
			?.blocks.find((candidate) => candidate.type === "toolCall");
		expect(block).toMatchObject({
			output: "file-a\n",
			state: "complete",
			toolCallId: "tool-1",
			toolName: "bash",
			type: "toolCall",
		});
	});

	it("preserves tool details across assistant message_end and toolResult", () => {
		usePiStore.getState().applyEvent({ message: { content: [], role: "assistant" }, type: "message_start" });
		usePiStore.getState().applyEvent({
			args: {},
			toolCallId: "tool-details",
			toolName: "todo",
			type: "tool_execution_start",
		});
		usePiStore.getState().applyEvent({
			result: { details: { todos: [{ done: false, id: 1, text: "write tests" }] } },
			toolCallId: "tool-details",
			toolName: "todo",
			type: "tool_execution_end",
		});
		usePiStore.getState().applyEvent({
			message: {
				content: [{ arguments: {}, id: "tool-details", name: "todo", type: "toolCall" }],
				role: "assistant",
				stopReason: "toolUse",
			},
			type: "message_end",
		});
		usePiStore.getState().applyEvent({
			message: {
				content: [{ text: "todo updated", type: "text" }],
				details: { todos: [{ done: false, id: 1, text: "write tests" }] },
				isError: false,
				role: "toolResult",
				toolCallId: "tool-details",
				toolName: "todo",
			},
			type: "message_end",
		});
		const block = usePiStore
			.getState()
			.messages.at(-1)
			?.blocks.find((candidate) => candidate.type === "toolCall");
		expect(block).toMatchObject({
			details: { todos: [{ done: false, id: 1, text: "write tests" }] },
			state: "complete",
			toolCallId: "tool-details",
			toolName: "todo",
		});
	});

	it("collects extension ui dialog requests", () => {
		usePiStore.getState().applyEvent({
			id: "ui-1",
			method: "input",
			placeholder: "Type your answer...",
			title: "What is 2+2?",
			type: "extension_ui_request",
		});
		expect(usePiStore.getState().extensionUiRequests).toEqual([
			expect.objectContaining({ id: "ui-1", method: "input", title: "What is 2+2?" }),
		]);
	});

	it("collects extension status and widget updates", () => {
		usePiStore.getState().applyEvent({
			method: "setStatus",
			statusKey: "plan",
			statusText: "1/3",
			type: "extension_ui_request",
		});
		usePiStore.getState().applyEvent({
			method: "setWidget",
			type: "extension_ui_request",
			widgetKey: "todo",
			widgetLines: ["a", "b"],
		});
		expect(usePiStore.getState().extensionUiStatuses.plan).toBe("1/3");
		expect(usePiStore.getState().extensionUiWidgets.todo).toEqual({
			lines: ["a", "b"],
			placement: "aboveEditor",
		});
	});

	it("marks the agent settled", () => {
		usePiStore.setState({ status: "streaming" });
		usePiStore.getState().applyEvent({ type: "agent_settled" });
		expect(usePiStore.getState().status).toBe("idle");
	});

	it("tracks steering and follow-up queues", () => {
		usePiStore.getState().applyEvent({
			followUp: ["later"],
			steering: ["stop that"],
			type: "queue_update",
		});
		expect(usePiStore.getState().queue).toEqual({
			followUp: ["later"],
			steering: ["stop that"],
		});
	});

	it("tracks compaction and session name events", () => {
		usePiStore.getState().applyEvent({ reason: "manual", type: "compaction_start" });
		expect(usePiStore.getState().compactionStatus).toBe("running");
		usePiStore.getState().applyEvent({ errorMessage: "summary failed", type: "compaction_end" });
		expect(usePiStore.getState().compactionStatus).toBe("error");
		expect(usePiStore.getState().compactionError).toBe("summary failed");
		usePiStore.getState().applyEvent({ name: "renamed", type: "session_info_changed" });
		expect(usePiStore.getState().sessionName).toBe("renamed");
	});

	it("streams direct bash output", () => {
		usePiStore.getState().applyEvent({ delta: "one\n", type: "bash_execution_update" });
		usePiStore.getState().applyEvent({ delta: "two\n", type: "bash_execution_update" });
		expect(usePiStore.getState().bashOutput).toBe("one\ntwo\n");
		expect(usePiStore.getState().bashRunning).toBe(true);
	});
});

describe("pi store workspace and project-scoped data", () => {
	beforeEach(() => {
		usePiStore.getState().reset();
	});

	it("refuses to start an unbound blank session", async () => {
		const calls = stubPi(() => ({ data: {} }));
		usePiStore.setState({
			activeHandleId: "s1",
			messageCount: 0,
			messages: [],
			sessionCwd: "D:/runtime-default",
			sessionId: "new-session",
			sessionLoading: false,
			sessionName: undefined,
			sessionProject: undefined,
			sessions: [],
			status: "idle",
		});

		await expect(usePiStore.getState().send("hello")).rejects.toThrow("请先选择工作区");
		expect(calls).toHaveLength(0);
	});

	it("surfaces an RPC error instead of treating an unsuccessful response as empty data", async () => {
		const calls = stubPi(() => ({ error: "runtime rejected prompt", success: false }));
		usePiStore.setState({
			messageCount: 1,
			messages: [textMessage("m1", "existing")],
			sessionCwd: "D:/project",
			sessionLoading: false,
			sessionProject: undefined,
			status: "idle",
		});

		await expect(usePiStore.getState().send("hello")).rejects.toThrow("runtime rejected prompt");
		expect(calls).toHaveLength(1);
		expect(usePiStore.getState().status).toBe("idle");
	});

	it("addresses a prompt to a background handle without marking the visible session busy", async () => {
		const calls = stubPi((command) =>
			command.type === "prompt" ? { data: { sessionId: "s-bg", started: true }, success: true } : { data: {} },
		);
		usePiStore.setState({
			activeHandleId: "s-visible",
			handles: { "d:/a.jsonl": "s-visible", "d:/b.jsonl": "s-bg" },
			messageCount: 1,
			messages: [textMessage("m1", "existing")],
			multiSession: true,
			sessionCwd: "D:/project",
			sessionLoading: false,
			sessionProject: "D:/project",
			status: "idle",
		});

		const result = await usePiStore.getState().send("task prompt", undefined, undefined, "s-bg");

		expect(result.started).toBe(true);
		expect(calls[0]).toMatchObject({ message: "task prompt", sessionId: "s-bg", type: "prompt" });
		// The visible session is a different handle: its status must not pretend to stream.
		expect(usePiStore.getState().status).toBe("idle");
	});

	it("aborts a background handle without mutating the visible transcript", async () => {
		const calls = stubPi(() => ({ data: {} }));
		usePiStore.setState({
			abortGeneration: 0,
			activeHandleId: "s-visible",
			messages: [textMessage("m1", "existing")],
			multiSession: true,
			sessionLoading: false,
			status: "idle",
		});

		await usePiStore.getState().abort("s-bg");

		expect(calls).toEqual([expect.objectContaining({ sessionId: "s-bg", type: "abort" })]);
		expect(usePiStore.getState().abortGeneration).toBe(1);
		expect(usePiStore.getState().messages[0].state).toBe("complete");
		expect(usePiStore.getState().status).toBe("idle");
	});

});

describe("pi store turn usage footer", () => {
	beforeEach(() => {
		usePiStore.getState().reset();
	});

	/** What pi puts on an assistant message_end: the turn's usage and why the step stopped. */
	const usage = (input: number, output: number, cacheRead: number) => ({
		cacheRead,
		cacheWrite: 0,
		input,
		output,
		totalTokens: input + output + cacheRead,
	});

	it("stamps usage from the answer that ended the turn", () => {
		vi.useFakeTimers();
		try {
			usePiStore.getState().applyEvent({
				message: { content: [{ text: "问", type: "text" }], role: "user" },
				type: "message_start",
			});
			vi.advanceTimersByTime(12_000);
			usePiStore.getState().applyEvent({
				message: { content: [{ text: "答", type: "text" }], role: "assistant" },
				type: "message_start",
			});
			usePiStore.getState().applyEvent({
				message: {
					content: [{ text: "答", type: "text" }],
					role: "assistant",
					stopReason: "stop",
					usage: usage(100, 40, 900),
				},
				type: "message_end",
			});

			const answer = usePiStore.getState().messages.at(-1);
			expect(answer?.usage).toMatchObject({ cacheRead: 900, input: 100, output: 40, total: 1040 });
			expect(answer?.durationMs).toBe(12_000);
			expect(answer?.completedAt).toBe(Date.now());
		} finally {
			vi.useRealTimers();
		}
	});

	it("keeps the turn clock running across a tool round and bills every step once", () => {
		vi.useFakeTimers();
		try {
			usePiStore.getState().applyEvent({
				message: { content: [{ text: "查一下", type: "text" }], role: "user" },
				type: "message_start",
			});
			usePiStore.getState().applyEvent({
				message: { content: [], role: "assistant" },
				type: "message_start",
			});
			// Step one asks for a tool, so it is not the answer: no duration lands yet.
			usePiStore.getState().applyEvent({
				message: {
					content: [{ arguments: {}, id: "t1", name: "bash", type: "toolCall" }],
					role: "assistant",
					stopReason: "toolUse",
					usage: usage(200, 30, 0),
				},
				type: "message_end",
			});
			expect(usePiStore.getState().messages.at(-1)?.durationMs).toBeUndefined();
			vi.advanceTimersByTime(30_000);
			usePiStore.getState().applyEvent({
				message: { content: [{ text: "好了", type: "text" }], role: "assistant" },
				type: "message_start",
			});
			usePiStore.getState().applyEvent({
				message: {
					content: [{ text: "好了", type: "text" }],
					role: "assistant",
					stopReason: "stop",
					usage: usage(300, 50, 1000),
				},
				type: "message_end",
			});

			const messages = usePiStore.getState().messages.filter((message) => message.role === "assistant");
			expect(messages).toHaveLength(2);
			// Both steps carry the whole turn's elapsed time, so the footer shows one number.
			expect(messages[0].durationMs).toBe(30_000);
			expect(messages[1].durationMs).toBe(30_000);
			expect(messages[1].usage?.total).toBe(1350);
		} finally {
			vi.useRealTimers();
		}
	});

	it("gives the next prompt a fresh clock", () => {
		vi.useFakeTimers();
		try {
			for (const text of ["第一问", "第二问"]) {
				usePiStore.getState().applyEvent({
					message: { content: [{ text, type: "text" }], role: "user" },
					type: "message_start",
				});
				usePiStore.getState().applyEvent({
					message: { content: [], role: "assistant" },
					type: "message_start",
				});
				vi.advanceTimersByTime(5_000);
				usePiStore.getState().applyEvent({
					message: {
						content: [{ text: "答", type: "text" }],
						role: "assistant",
						stopReason: "stop",
						usage: usage(10, 10, 0),
					},
					type: "message_end",
				});
				usePiStore.getState().applyEvent({ type: "agent_settled" });
			}

			const durations = usePiStore
				.getState()
				.messages.filter((message) => message.role === "assistant")
				.map((message) => message.durationMs);
			expect(durations).toEqual([5_000, 5_000]);
		} finally {
			vi.useRealTimers();
		}
	});

	it("leaves the earlier answer's footer alone when a later turn ends", () => {
		vi.useFakeTimers();
		try {
			usePiStore.getState().applyEvent({
				message: { content: [{ text: "第一问", type: "text" }], role: "user" },
				type: "message_start",
			});
			usePiStore.getState().applyEvent({ message: { content: [], role: "assistant" }, type: "message_start" });
			vi.advanceTimersByTime(4_000);
			usePiStore.getState().applyEvent({
				message: {
					content: [{ text: "第一答", type: "text" }],
					role: "assistant",
					stopReason: "stop",
					usage: usage(10, 10, 0),
				},
				type: "message_end",
			});
			usePiStore.getState().applyEvent({ type: "agent_settled" });

			usePiStore.getState().applyEvent({
				message: { content: [{ text: "第二问", type: "text" }], role: "user" },
				type: "message_start",
			});
			usePiStore.getState().applyEvent({ message: { content: [], role: "assistant" }, type: "message_start" });
			vi.advanceTimersByTime(90_000);
			usePiStore.getState().applyEvent({
				message: {
					content: [{ text: "第二答", type: "text" }],
					role: "assistant",
					stopReason: "stop",
					usage: usage(20, 20, 0),
				},
				type: "message_end",
			});

			const answers = usePiStore.getState().messages.filter((message) => message.role === "assistant");
			expect(answers.map((message) => message.durationMs)).toEqual([4_000, 90_000]);
			expect(answers.map((message) => message.usage?.total)).toEqual([20, 40]);
		} finally {
			vi.useRealTimers();
		}
	});

	it("times the first token from the prompt, not from the message shell pi opens first", () => {
		vi.useFakeTimers();
		try {
			usePiStore.getState().applyEvent({
				message: { content: [{ text: "问", type: "text" }], role: "user" },
				type: "message_start",
			});
			vi.advanceTimersByTime(2_000);
			// pi opens the assistant shell before the provider answers; that gap is queueing.
			usePiStore.getState().applyEvent({
				message: { content: [], role: "assistant" },
				type: "message_start",
			});
			vi.advanceTimersByTime(1_000);
			usePiStore.getState().applyEvent({
				assistantMessageEvent: { contentIndex: 0, type: "text_start" },
				type: "message_update",
			});
			vi.advanceTimersByTime(400);
			usePiStore.getState().applyEvent({
				assistantMessageEvent: { contentIndex: 0, delta: "答", type: "text_delta" },
				type: "message_update",
			});
			vi.advanceTimersByTime(600);
			usePiStore.getState().applyEvent({
				message: {
					content: [{ text: "答", type: "text" }],
					role: "assistant",
					stopReason: "stop",
					usage: usage(10, 10, 0),
				},
				type: "message_end",
			});

			// A block boundary carries no token, so the clock starts at the first real delta: 3.4s.
			expect(usePiStore.getState().messages.at(-1)?.ttftMs).toBe(3_400);
		} finally {
			vi.useRealTimers();
		}
	});

	it("restores usage and the completion time, but not a duration", () => {
		stubPi(() => ({ data: {} }));
		usePiStore.getState().loadMessages([
			{
				content: [{ text: "答", type: "text" }],
				role: "assistant",
				timestamp: 1_700_000_000_000,
				usage: usage(5, 5, 0),
			},
		]);

		const answer = usePiStore.getState().messages.at(-1);
		expect(answer?.usage?.total).toBe(10);
		expect(answer?.completedAt).toBe(1_700_000_000_000);
		expect(answer?.durationMs).toBeUndefined();
	});
});

describe("pi store session streaming reconciliation", () => {
	beforeEach(() => {
		usePiStore.getState().reset();
	});

	/** A turn left mid-stream: the renderer holds the mark, and its end never reached this window. */
	function startStreamingTurn(): void {
		usePiStore.getState().applyEvent({ type: "agent_start" });
		usePiStore.getState().applyEvent({
			message: { content: [{ text: "问", type: "text" }], role: "user" },
			type: "message_start",
		});
		usePiStore.getState().applyEvent({ message: { content: [], role: "assistant" }, type: "message_start" });
		usePiStore.getState().applyEvent({
			assistantMessageEvent: { contentIndex: 0, delta: "半句", type: "text_delta" },
			type: "message_update",
		});
	}

	/** pi's answer to get_state, which is what refreshSession reads after a reload or a switch. */
	function stubSnapshot(isStreaming: boolean): Array<Record<string, unknown>> {
		return stubPi((command) =>
			command.type === "get_state"
				? { data: { isStreaming, messageCount: 2, sessionFile: "C:/sessions/a.jsonl", sessionId: "pi-a" } }
				: { data: {} },
		);
	}

	it("clears a turn that pi reports as finished, so the flow stops saying 正在思考…", async () => {
		startStreamingTurn();
		expect(usePiStore.getState().messages.at(-1)?.state).toBe("streaming");

		stubSnapshot(false);
		await usePiStore.getState().refreshSession();

		const answer = usePiStore.getState().messages.at(-1);
		expect(usePiStore.getState().status).toBe("idle");
		expect(answer?.state).toBe("complete");
		expect(answer?.blocks[0]).toMatchObject({ state: "complete", text: "半句" });
	});

	it("leaves a live turn alone when pi still reports it running", async () => {
		startStreamingTurn();

		stubSnapshot(true);
		await usePiStore.getState().refreshSession();

		expect(usePiStore.getState().status).toBe("streaming");
		expect(usePiStore.getState().messages.at(-1)?.state).toBe("streaming");
	});

	it("settles the leftover when the next prompt arrives on an idle session", () => {
		startStreamingTurn();
		// agent_settled is what pi emits when the run ends; the transcript's own mark outlives it
		// whenever the window missed the message_end.
		usePiStore.getState().applyEvent({ type: "agent_settled" });

		usePiStore.getState().applyEvent({
			message: { content: [{ text: "新问题", type: "text" }], role: "user" },
			type: "message_start",
		});

		const messages = usePiStore.getState().messages;
		const abandoned = messages.find((message) => message.role === "assistant");
		expect(abandoned?.state).toBe("complete");
		expect(messages.at(-1)).toMatchObject({ role: "user" });
	});

	it("does not touch a second step of the same live turn", () => {
		startStreamingTurn();
		// A tool round starts the next assistant message while the run is still going.
		usePiStore.getState().applyEvent({ message: { content: [], role: "assistant" }, type: "message_start" });

		const messages = usePiStore.getState().messages;
		expect(messages[1].state).toBe("streaming");
		expect(messages[2]).toMatchObject({ role: "assistant", state: "streaming" });
	});
});

describe("pi store multi-session slices", () => {
	beforeEach(() => {
		usePiStore.getState().reset();
	});

	const backgroundState = {
		activeHandleId: "s1",
		handles: { "C:/sessions/a.jsonl": "s1", "C:/sessions/b.jsonl": "s2" },
		multiSession: true,
	};

	it("keeps the single-session flow and warns once when the runtime has no patch", async () => {
		const calls = stubPi(() => {
			throw new Error("Unknown command: get_capabilities");
		});
		await usePiStore.getState().negotiateCapabilities();
		await usePiStore.getState().negotiateCapabilities();
		const state = usePiStore.getState();
		expect(state.multiSession).toBe(false);
		expect(state.activeHandleId).toBeUndefined();
		// The handshake itself is never tagged with a session.
		expect(calls[0]).toEqual({ type: "get_capabilities" });
		expect(state.extensionUiNotifications).toEqual([
			expect.objectContaining({ id: "multi-session-missing", type: "warning" }),
		]);
		expect(state.extensionUiNotifications[0].message).toContain("多会话补丁");
		// Untagged events are the only kind this runtime sends, and they reach the visible session.
		usePiStore.getState().applyEvent({
			message: { content: [{ text: "hi", type: "text" }], role: "user" },
			type: "message_start",
		});
		expect(usePiStore.getState().messages).toHaveLength(1);
	});

	it("routes events of a background handle into its slice", () => {
		usePiStore.setState({
			...backgroundState,
			backgroundSessions: {
				s2: backgroundSlice({
					messageCount: 1,
					piSessionId: "pi-b",
					sessionFile: "C:/sessions/b.jsonl",
					sessionName: "后台会话",
				}),
			},
			messages: [textMessage("msg-visible", "from a")],
			status: "idle",
		});
		usePiStore.getState().applyEvent({
			message: { content: [{ text: "from b", type: "text" }], role: "user" },
			sessionId: "s2",
			type: "message_start",
		});
		usePiStore.getState().applyEvent({ sessionId: "s2", type: "agent_start" });
		usePiStore.getState().applyEvent({ sessionId: "s2", type: "agent_settled" });
		// A handle the renderer never opened must not be resurrected by a late event.
		usePiStore.getState().applyEvent({
			message: { content: [{ text: "stray", type: "text" }], role: "user" },
			sessionId: "s9",
			type: "message_start",
		});

		const state = usePiStore.getState();
		expect(state.messages.map((message) => message.id)).toEqual(["msg-visible"]);
		expect(state.status).toBe("idle");
		const slice = state.backgroundSessions.s2;
		expect(slice.messages).toHaveLength(1);
		expect(slice.messages[0].blocks[0]).toMatchObject({ text: "from b" });
		expect(slice.messageCount).toBe(2);
		expect(slice.streaming).toBe(false);
		expect(slice.unread).toBe(true);
		expect(state.backgroundSessions.s9).toBeUndefined();
	});

	it("projects a background slice when its session is shown", async () => {
		const calls = stubPi((command) => {
			if (command.type === "get_session_stats") {
				return {
					data: {
						cost: 0,
						sessionId: "pi-b",
						tokens: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
						toolCalls: 0,
						totalMessages: 4,
						userMessages: 1,
					},
				};
			}
			return {
				data: {
					isStreaming: true,
					messageCount: 4,
					model: { id: "m2" },
					sessionFile: "C:/sessions/b.jsonl",
					sessionId: "pi-b",
					sessionName: "后台会话",
				},
			};
		});
		usePiStore.setState({
			...backgroundState,
			backgroundSessions: {
				s2: backgroundSlice({
					messageCount: 3,
					messages: [textMessage("msg-b", "from b")],
					piSessionId: "pi-b",
					sessionFile: "C:\\sessions\\b.jsonl",
					sessionName: "后台会话",
					status: "streaming",
					streaming: true,
					unread: true,
				}),
			},
			messages: [textMessage("msg-a", "from a")],
			sessionFile: "C:\\sessions\\a.jsonl",
			sessionId: "pi-a",
			status: "streaming",
		});
		await usePiStore.getState().showSession("C:\\sessions\\b.jsonl");

		const state = usePiStore.getState();
		expect(state.activeHandleId).toBe("s2");
		expect(state.messages.map((message) => message.id)).toEqual(["msg-b"]);
		expect(state.sessionName).toBe("后台会话");
		expect(state.sessionId).toBe("pi-b");
		expect(state.messageCount).toBe(4);
		expect(state.model).toBe("m2");
		// The session that was on screen is kept, not switched away from inside pi.
		expect(state.backgroundSessions.s1.messages.map((message) => message.id)).toEqual(["msg-a"]);
		expect(state.backgroundSessions.s1.unread).toBe(false);
		expect(state.backgroundSessions.s2.unread).toBe(false);
		expect(state.sessionStats?.sessionId).toBe("pi-b");
		// Only metadata is re-read, and every command names the handle it belongs to.
		expect(calls).toEqual([
			expect.objectContaining({ sessionId: "s2", type: "get_state" }),
			expect.objectContaining({ sessionId: "s2", type: "get_session_stats" }),
			// Fork points ride along: the transcript's edit action needs them for this session.
			expect.objectContaining({ sessionId: "s2", type: "get_fork_messages" }),
			// Slash commands are built from the session's own extensions, so they are re-read too.
			expect.objectContaining({ sessionId: "s2", type: "get_commands" }),
		]);
	});

	it("opens a handle for a session that has none and reads its transcript once", async () => {
		const calls = stubPi((command) => {
			if (command.type === "open_session") {
				return {
					data: {
						isStreaming: false,
						messageCount: 1,
						piSessionId: "pi-b",
						sessionFile: "C:/sessions/b.jsonl",
						sessionId: "s2",
					},
				};
			}
			if (command.type === "get_messages") {
				return { data: { messages: [{ content: [{ text: "loaded", type: "text" }], role: "user" }] } };
			}
			return {
				data: { isStreaming: false, messageCount: 1, sessionFile: "C:/sessions/b.jsonl", sessionId: "pi-b" },
			};
		});
		usePiStore.setState({
			activeHandleId: "s1",
			handles: { "C:/sessions/a.jsonl": "s1" },
			messages: [textMessage("msg-a", "from a")],
			multiSession: true,
			status: "streaming",
		});
		await usePiStore.getState().showSession("C:/sessions/b.jsonl");

		const state = usePiStore.getState();
		expect(calls[0]).toEqual({ activate: true, sessionPath: "C:/sessions/b.jsonl", type: "open_session" });
		expect(state.handles["C:/sessions/b.jsonl"]).toBe("s2");
		expect(state.activeHandleId).toBe("s2");
		expect(state.messages[0].blocks[0]).toMatchObject({ text: "loaded" });
		expect(calls.filter((call) => call.type === "get_messages")).toEqual([
			expect.objectContaining({ sessionId: "s2" }),
		]);
	});

	it("keeps the opened session's cwd after projecting the fresh handle", async () => {
		stubPi((command) => {
			if (command.type === "open_session") {
				return {
					data: {
						cwd: "D:\\other",
						isStreaming: false,
						messageCount: 1,
						piSessionId: "pi-b",
						sessionFile: "C:/sessions/b.jsonl",
						sessionId: "s2",
					},
				};
			}
			if (command.type === "get_messages") return { data: { messages: [] } };
			return {
				data: {
					cwd: "D:\\other",
					isStreaming: false,
					messageCount: 1,
					sessionFile: "C:/sessions/b.jsonl",
					sessionId: "pi-b",
				},
			};
		});
		usePiStore.setState({
			activeHandleId: "s1",
			handles: { "C:/sessions/a.jsonl": "s1" },
			multiSession: true,
			sessionCwd: "D:/work",
			sessionFile: "C:/sessions/a.jsonl",
		});
		await usePiStore.getState().showSession("C:/sessions/b.jsonl");

		// projectHandle has no slice for s2 and used to blank this, after which send()
		// refused with 请先选择工作区 on a session the user explicitly opened.
		expect(usePiStore.getState().sessionCwd).toBe("D:\\other");
	});

	it("adopts the cwd get_state reports when open_session did not name one", async () => {
		stubPi((command) => {
			if (command.type === "open_session") {
				return {
					data: {
						isStreaming: false,
						messageCount: 0,
						piSessionId: "pi-b",
						sessionFile: "C:/sessions/b.jsonl",
						sessionId: "s2",
					},
				};
			}
			if (command.type === "get_messages") return { data: { messages: [] } };
			if (command.type === "get_state") {
				return {
					data: {
						cwd: "D:\\other",
						isStreaming: false,
						messageCount: 0,
						sessionFile: "C:/sessions/b.jsonl",
						sessionId: "pi-b",
					},
				};
			}
			return { data: {} };
		});
		usePiStore.setState({
			activeHandleId: "s1",
			handles: { "C:/sessions/a.jsonl": "s1" },
			multiSession: true,
			sessionCwd: "D:/work",
			sessionFile: "C:/sessions/a.jsonl",
		});
		await usePiStore.getState().showSession("C:/sessions/b.jsonl");

		expect(usePiStore.getState().sessionCwd).toBe("D:\\other");
	});

	it("re-reads a session whose slice never held a transcript", async () => {
		const calls = stubPi((command) => {
			if (command.type === "get_messages") {
				return { data: { messages: [{ content: [{ text: "from pi", type: "text" }], role: "user" }] } };
			}
			return {
				data: { isStreaming: false, messageCount: 1, sessionFile: "C:/sessions/b.jsonl", sessionId: "pi-b" },
			};
		});
		usePiStore.setState({
			...backgroundState,
			// A placeholder slice: the session was opened but its transcript was never read.
			backgroundSessions: { s2: backgroundSlice({ loaded: false, sessionFile: "C:/sessions/b.jsonl" }) },
		});
		await usePiStore.getState().showSession("C:/sessions/b.jsonl");

		expect(usePiStore.getState().messages[0].blocks[0]).toMatchObject({ text: "from pi" });
		expect(calls.map((call) => call.type)).toEqual([
			"get_state",
			"get_messages",
			"get_commands",
			"get_session_stats",
			"get_fork_messages",
		]);
	});

	it("re-keys the path map when the visible handle moves to a new session", async () => {
		const calls = stubPi((command) => {
			if (command.type === "get_messages") return { data: { messages: [] } };
			if (command.type === "new_session") return { data: {} };
			return {
				data: {
					isStreaming: false,
					messageCount: 0,
					sessionFile: "C:/sessions/fresh.jsonl",
					sessionId: "pi-fresh",
				},
			};
		});
		usePiStore.setState({
			activeHandleId: "s1",
			handles: { "C:/sessions/a.jsonl": "s1" },
			multiSession: true,
			sessionFile: "C:/sessions/a.jsonl",
		});
		await usePiStore.getState().newSession();

		const state = usePiStore.getState();
		expect(state.handles).toEqual({ "C:/sessions/fresh.jsonl": "s1" });
		expect(state.sessionFile).toBe("C:/sessions/fresh.jsonl");
		expect(state.sessionId).toBe("pi-fresh");
		expect(calls.find((call) => call.type === "new_session")).toEqual(
			expect.objectContaining({ sessionId: "s1" }),
		);
	});

	it("keeps the visible session's project for a new chat on the same handle", async () => {
		stubPi((command) => {
			if (command.type === "get_messages") return { data: { messages: [] } };
			if (command.type === "new_session") return { data: {} };
			return {
				data: { isStreaming: false, messageCount: 0, sessionFile: "C:/sessions/fresh.jsonl", sessionId: "pi-fresh" },
			};
		});
		usePiStore.setState({
			activeHandleId: "s1",
			handles: { "C:/sessions/a.jsonl": "s1" },
			messageCount: 4,
			multiSession: true,
			sessionCwd: "D:/work",
			sessionFile: "C:/sessions/a.jsonl",
			sessionProject: undefined,
		});
		await usePiStore.getState().newSession();

		// The runtime never left D:/work, so the chip must not fall back to 选择项目.
		expect(usePiStore.getState().sessionProject).toBe("D:/work");
	});

	it("leaves the first, unused session unbound", async () => {
		stubPi((command) => {
			if (command.type === "get_messages") return { data: { messages: [] } };
			if (command.type === "new_session") return { data: {} };
			return {
				data: { isStreaming: false, messageCount: 0, sessionFile: "C:/sessions/fresh.jsonl", sessionId: "pi-fresh" },
			};
		});
		usePiStore.setState({
			activeHandleId: "s1",
			handles: { "C:/sessions/a.jsonl": "s1" },
			messageCount: 0,
			multiSession: true,
			sessionCwd: "D:/work",
			sessionFile: "C:/sessions/a.jsonl",
			sessionProject: undefined,
		});
		await usePiStore.getState().newSession();

		expect(usePiStore.getState().sessionProject).toBeUndefined();
	});

	it("reuses the handle when the project already is the visible session's folder", async () => {
		const calls = stubPi((command) => {
			if (command.type === "get_open_sessions") {
				return { data: { activeSessionId: "s1", sessions: [{ cwd: "D:\\work", sessionId: "s1" }] } };
			}
			if (command.type === "get_messages") return { data: { messages: [] } };
			return { data: { isStreaming: false, messageCount: 0, sessionFile: "C:/sessions/fresh.jsonl", sessionId: "pi-fresh" } };
		});
		usePiStore.setState({
			activeHandleId: "s1",
			backgroundSessions: { s1: backgroundSlice({ sessionFile: "C:/sessions/a.jsonl" }) },
			handles: { "C:/sessions/a.jsonl": "s1" },
			multiSession: true,
		});
		await usePiStore.getState().newSessionIn("D:/work");

		expect(calls.map((call) => call.type)).toEqual([
			"get_open_sessions",
			"new_session",
			"get_state",
			"get_messages",
			"get_commands",
		]);
		expect(usePiStore.getState().activeHandleId).toBe("s1");
	});

	it("opens a second handle for a session in another project", async () => {
		const calls = stubPi((command) => {
			if (command.type === "get_open_sessions") {
				return { data: { activeSessionId: "s1", sessions: [{ cwd: "D:\\work", sessionId: "s1" }] } };
			}
			if (command.type === "open_session") {
				return {
					data: {
						cwd: "D:\\other",
						isStreaming: false,
						messageCount: 0,
						piSessionId: "pi-b",
						sessionFile: "C:/sessions/b.jsonl",
						sessionId: "s2",
					},
				};
			}
			if (command.type === "get_messages") return { data: { messages: [] } };
			return { data: { isStreaming: false, messageCount: 0, sessionFile: "C:/sessions/b.jsonl", sessionId: "pi-b" } };
		});
		usePiStore.setState({
			activeHandleId: "s1",
			backgroundSessions: { s1: backgroundSlice({ sessionFile: "C:/sessions/a.jsonl" }) },
			handles: { "C:/sessions/a.jsonl": "s1" },
			multiSession: true,
		});
		await usePiStore.getState().newSessionIn("D:/other");

		expect(calls[1]).toEqual({ activate: true, cwd: "D:/other", type: "open_session" });
		const state = usePiStore.getState();
		expect(state.activeHandleId).toBe("s2");
		expect(state.handles["C:/sessions/b.jsonl"]).toBe("s2");
		// The session left behind keeps its handle: it is still running in the background.
		expect(state.backgroundSessions.s1).toBeDefined();
	});

	it("closes a background handle and forgets it", async () => {
		const calls = stubPi(() => ({ data: { activeSessionId: "s1", closed: true } }));
		usePiStore.setState({
			...backgroundState,
			backgroundSessions: { s2: backgroundSlice({ sessionName: "后台会话" }) },
		});
		await usePiStore.getState().closeHandle("s2");

		const state = usePiStore.getState();
		expect(calls).toEqual([expect.objectContaining({ sessionId: "s2", type: "close_session" })]);
		expect(state.backgroundSessions.s2).toBeUndefined();
		expect(state.handles).toEqual({ "C:/sessions/a.jsonl": "s1" });
		// The handle on screen is never closed from the renderer.
		await usePiStore.getState().closeHandle("s1");
		expect(calls).toHaveLength(1);
	});

	it("surfaces dialogs of a background session with its name", () => {
		usePiStore.setState({
			...backgroundState,
			backgroundSessions: {
				s2: backgroundSlice({ sessionFile: "C:/sessions/b.jsonl", sessionName: "后台会话" }),
			},
		});
		usePiStore.getState().applyEvent({
			id: "ui-bg",
			message: "继续？",
			method: "confirm",
			sessionId: "s2",
			title: "需要确认",
			type: "extension_ui_request",
		});
		expect(usePiStore.getState().extensionUiRequests).toEqual([
			expect.objectContaining({ id: "ui-bg", sessionLabel: "后台会话", title: "需要确认" }),
		]);
		// Widgets, statuses and the composer belong to the visible session only.
		usePiStore.getState().applyEvent({
			id: "ui-widget",
			method: "setWidget",
			sessionId: "s2",
			type: "extension_ui_request",
			widgetKey: "todo",
			widgetLines: ["a"],
		});
		expect(usePiStore.getState().extensionUiWidgets).toEqual({});
	});

	it("evicts idle handles beyond the configured pool cap, least recently used first", async () => {
		const calls = stubPi(() => ({ data: { activeSessionId: "s1", closed: true } }));
		useSessionPoolSettings.getState().setMaxOpenSessions(2);
		usePiStore.setState({
			...backgroundState,
			handleOrder: ["s3", "s2", "s1"],
			handles: { "C:/sessions/a.jsonl": "s1", "C:/sessions/b.jsonl": "s2", "C:/sessions/c.jsonl": "s3" },
		});

		usePiStore.getState().enforceSessionPool();
		// Eviction is fire-and-forget: the UI never waits for close_session to come back.
		await new Promise((resolve) => setTimeout(resolve, 0));

		// s1 is on screen, s3 was used most recently, so s2 goes.
		expect(calls).toEqual([expect.objectContaining({ sessionId: "s2", type: "close_session" })]);
		expect(usePiStore.getState().handles).toEqual({
			"C:/sessions/a.jsonl": "s1",
			"C:/sessions/c.jsonl": "s3",
		});
	});

	it("never evicts a session that is still working", () => {
		const calls = stubPi(() => ({ data: { activeSessionId: "s1", closed: true } }));
		useSessionPoolSettings.getState().setMaxOpenSessions(1);
		usePiStore.setState({
			...backgroundState,
			backgroundSessions: {
				s2: backgroundSlice({ streaming: true }),
				s3: backgroundSlice({ queue: { followUp: ["next"], steering: [] } }),
			},
			handleOrder: ["s1", "s2", "s3"],
			handles: { "C:/sessions/a.jsonl": "s1", "C:/sessions/b.jsonl": "s2", "C:/sessions/c.jsonl": "s3" },
		});

		usePiStore.getState().enforceSessionPool();

		// The cap is 1 but both protected handles outrank it, so nothing is closed.
		expect(calls).toEqual([]);
		expect(Object.keys(usePiStore.getState().handles)).toHaveLength(3);
	});

	it("clamps the pool cap to the supported range", () => {
		useSessionPoolSettings.getState().setMaxOpenSessions(0);
		expect(useSessionPoolSettings.getState().maxOpenSessions).toBe(MIN_OPEN_SESSIONS);
		useSessionPoolSettings.getState().setMaxOpenSessions(99);
		expect(useSessionPoolSettings.getState().maxOpenSessions).toBe(MAX_OPEN_SESSIONS);
		useSessionPoolSettings.getState().setMaxOpenSessions(3);
	});
});

describe("queued message actions", () => {
	beforeEach(() => {
		usePiStore.getState().reset();
	});

	// pi's RPC can only clear the whole queue, so every per-row action is a clear plus a re-queue
	// of what should stay; these assertions read the exact command sequence that produces.
	const calls = (list: Array<Record<string, unknown>>) =>
		list.map((call) => (call.type === "clear_queue" ? "clear_queue" : `${String(call.type)}:${String(call.message)}`));

	it("removes one queued message by clearing and re-queuing the rest", async () => {
		const list = stubPi((command) =>
			command.type === "clear_queue"
				? { data: { followUp: ["third"], steering: ["first", "second"] } }
				: { data: {} },
		);
		usePiStore.setState({ queue: { followUp: ["third"], steering: ["first", "second"] } });

		const removed = await usePiStore.getState().removeQueuedMessage("steering", 0);

		expect(removed).toBe(true);
	expect(calls(list)).toEqual(["clear_queue", "steer:second", "follow_up:third"]);
	});

	it("edits one queued message in place", async () => {
		const list = stubPi(() => ({ data: { followUp: [], steering: ["first", "second"] } }));
		usePiStore.setState({ queue: { followUp: [], steering: ["first", "second"] } });

		await usePiStore.getState().editQueuedMessage("steering", 1, "  rewritten  ");

		expect(calls(list)).toEqual(["clear_queue", "steer:first", "steer:rewritten"]);
	});

	it("steers one queued message to the front of the steering queue", async () => {
		const list = stubPi(() => ({ data: { followUp: ["later"], steering: ["first"] } }));
		usePiStore.setState({ queue: { followUp: ["later"], steering: ["first"] } });

		await usePiStore.getState().steerQueuedMessage("followUp", 0);

		expect(calls(list)).toEqual(["clear_queue", "steer:later", "steer:first"]);
	});

	it("does nothing when the turn already took that message", async () => {
		const list = stubPi(() => ({ data: { followUp: [], steering: [] } }));
		usePiStore.setState({ queue: { followUp: [], steering: ["gone"] } });

		const removed = await usePiStore.getState().removeQueuedMessage("steering", 0);

		expect(removed).toBe(false);
		expect(calls(list)).toEqual(["clear_queue"]);
	});

	it("matches repeated texts by occurrence, not by the first hit", async () => {
		const list = stubPi(() => ({ data: { followUp: [], steering: ["same", "same"] } }));
		usePiStore.setState({ queue: { followUp: [], steering: ["same", "same"] } });

		await usePiStore.getState().removeQueuedMessage("steering", 1);

		expect(calls(list)).toEqual(["clear_queue", "steer:same"]);
	});

	it("steers the whole queue in FIFO order", async () => {
		const list = stubPi(() => ({ data: { followUp: ["follow"], steering: ["steer"] } }));
		usePiStore.setState({ queue: { followUp: ["follow"], steering: ["steer"] } });

		await usePiStore.getState().steerAllQueued();

		expect(calls(list)).toEqual(["clear_queue", "steer:steer", "steer:follow"]);
	});

	it("recalls a queued message into the composer and drops it from the queue", async () => {
		const list = stubPi((command) =>
			command.type === "clear_queue"
				? { data: { followUp: [], steering: ["first", "second"] } }
				: { data: {} },
		);
		usePiStore.setState({ composerText: "", queue: { followUp: [], steering: ["first", "second"] } });

		const recalled = await usePiStore.getState().recallQueuedMessage("steering", 0);

		expect(recalled).toBe(true);
		// The text is staged and the message is gone from pi's queue in the same action.
		expect(usePiStore.getState().composerText).toBe("first");
		expect(usePiStore.getState().recallId).toBe(1);
		expect(calls(list)).toEqual(["clear_queue", "steer:second"]);
	});

	it("appends a second recall instead of dropping what was already in the box", async () => {
		stubPi((command) =>
			command.type === "clear_queue"
				? { data: { followUp: ["second"], steering: [] } }
				: { data: {} },
		);
		usePiStore.setState({ composerText: "已经写了一半", queue: { followUp: ["second"], steering: [] } });

		await usePiStore.getState().recallQueuedMessage("followUp", 0);

		// The staged field carries only the recalled row; the composer merges it into the live
		// text because composerText is a staging channel, not a mirror of the box.
		expect(usePiStore.getState().composerAppend).toBe(true);
		expect(usePiStore.getState().composerText).toBe("second");
	});

	it("bumps the recall counter even when the same text comes back twice", async () => {
		stubPi((command) =>
			command.type === "clear_queue" ? { data: { followUp: [], steering: ["again"] } } : { data: {} },
		);
		usePiStore.setState({ composerText: "", queue: { followUp: [], steering: ["again"] }, recallId: 4 });

		await usePiStore.getState().recallQueuedMessage("steering", 0);
		expect(usePiStore.getState().composerText).toBe("again");
		expect(usePiStore.getState().recallId).toBe(5);

		// The same message queued again and recalled once more leaves the text identical, so the
		// counter is the only signal the composer has that the box has to be re-filled.
		usePiStore.setState({ queue: { followUp: [], steering: ["again"] } });
		await usePiStore.getState().recallQueuedMessage("steering", 0);

		// The same words staged again arrive appended to the live box; the counter is the signal.
		expect(usePiStore.getState().composerAppend).toBe(true);
		expect(usePiStore.getState().composerText).toBe("again");
		expect(usePiStore.getState().recallId).toBe(6);
	});

	it("does not stage text for a row the running turn already took", async () => {
		stubPi(() => ({ data: { followUp: [], steering: [] } }));
		usePiStore.setState({ composerText: "", queue: { followUp: [], steering: ["gone"] } });

		const recalled = await usePiStore.getState().recallQueuedMessage("steering", 0);

		expect(recalled).toBe(false);
		expect(usePiStore.getState().composerText).toBe("");
	});
});

describe("editing a sent prompt", () => {
	beforeEach(() => {
		usePiStore.getState().reset();
	});

	/** Counts what pi reports: the old branch first, the rewound one after the command ran. */
	function stubRewind(counts: number[]): Array<Record<string, unknown>> {
		let reads = 0;
		return stubPi((command) => {
			if (command.type === "get_state") {
				const messageCount = counts[Math.min(reads, counts.length - 1)];
				reads += 1;
				return { data: { isStreaming: false, messageCount, sessionId: "pi-a" } };
			}
			if (command.type === "get_messages") return { data: { messages: [] } };
			return { data: {} };
		});
	}

	const commands = [
		{ name: "session-edit", source: "extension" as const },
		{ name: "plan", source: "extension" as const },
	];

	it("rewinds and resends the edited text", async () => {
		const list = stubRewind([4, 1]);
		// The renderer's copy is stale — a session used in this run never reads a snapshot back.
		usePiStore.setState({ commands, messageCount: 1, status: "idle" });

		const sent = await usePiStore.getState().editAndResend("e1", "改过的提示");

		expect(sent).toBe(true);
		const types = list.map((call) => call.type);
		expect(types[0]).toBe("get_state");
		expect(list[1]).toEqual(expect.objectContaining({ message: "/session-edit e1", type: "prompt" }));
		expect(list.some((call) => call.type === "prompt" && call.message === "改过的提示")).toBe(true);
		// The extension prefilled the composer with the old prompt; the inline edit owns the text.
		expect(usePiStore.getState().composerText).toBe("");
	});

	it("keeps the edit in the composer when the branch did not move", async () => {
		const list = stubRewind([4, 4]);
		usePiStore.setState({ commands, status: "idle" });

		const sent = await usePiStore.getState().editAndResend("e1", "改过的提示");

		expect(sent).toBe(false);
		expect(list.some((call) => call.type === "prompt" && call.message === "改过的提示")).toBe(false);
		expect(usePiStore.getState().composerText).toBe("改过的提示");
	});

	it("says so instead of prompting the model when the extension is missing", async () => {
		const list = stubPi(() => ({ data: {} }));
		usePiStore.setState({ commands: [{ name: "plan", source: "extension" }], status: "idle" });

		const sent = await usePiStore.getState().editAndResend("e1", "改过的提示");

		expect(sent).toBe(false);
		expect(list).toEqual([]);
		expect(usePiStore.getState().extensionUiNotifications.at(-1)?.message).toContain("session-edit");
	});
});
