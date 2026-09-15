import { useMemo } from "react";
import { create } from "zustand";
import { useSessionPoolSettings } from "./session-pool";
import type {
	AppStatus,
	BackgroundSession,
	BlockState,
	ChatMessage,
	ExtensionUiNotification,
	ExtensionUiRequest,
	FileAttachment,
	ForkMessage,
	ImageAttachment,
	MessageBlock,
	MessageUsage,
	ModelInfo,
	PackageSources,
	PiState,
	QueueState,
	SessionEntryRecord,
	SessionStats,
	SessionInfo,
	SessionTreeNode,
	SlashCommand,
} from "./types";
import { t } from "../i18n";

let messageCounter = 0;

/**
 * Streaming assistant message id per session scope. Several sessions can stream at the same
 * time, so a single module-level id would let one session's message_update extend another
 * session's assistant message. The scope is the pi session handle, or "" for the single
 * session an unpatched runtime has.
 */
const assistantMessageIds = new Map<string, string>();

/**
 * When the current turn of each session scope began, in epoch ms.
 *
 * pi reports usage and a message timestamp but never how long a turn took, so the renderer keeps
 * that clock itself: taken when the prompt's turn starts, spent when every assistant message of
 * that turn is stamped with the elapsed time. A restored session therefore has no duration.
 */
const turnStartedAt = new Map<string, number>();
let fileLoadGeneration = 0;
let commandLoadGeneration = 0;
let statsLoadGeneration = 0;
let forkLoadGeneration = 0;
let refreshGeneration = 0;

function nextMessageId(): string {
	messageCounter += 1;
	return `msg-${messageCounter}`;
}

/** Scope of a session event: the handle id it carries, empty for untagged (single) sessions. */
function eventScope(event: Record<string, unknown>): string {
	return typeof event.sessionId === "string" ? event.sessionId : "";
}

/** Session file paths are map keys, so strip separator differences between pi and Electron. */
export function sessionMapKey(sessionPath: string): string {
	return sessionPath.replace(/\\/g, "/");
}

/**
 * True while the visible session is still the untouched state a 新对话 starts in: no transcript
 * and nothing listed for it yet. That is exactly where Codex shows the project picker and no
 * session header; from the first turn on the chat belongs to a fixed project and both flip.
 */
export function useBlankSession(): boolean {
	const messageCount = usePiStore((state) => state.messageCount);
	const messages = usePiStore((state) => state.messages);
	const sessionId = usePiStore((state) => state.sessionId);
	const sessionLoading = usePiStore((state) => state.sessionLoading);
	const sessionName = usePiStore((state) => state.sessionName);
	const sessions = usePiStore((state) => state.sessions);
	return useMemo(() => {
		// A session being loaded is not a new one: it already has a transcript on disk.
		if (sessionLoading || sessionName) return false;
		if (messageCount > 0 || messages.length > 0) return false;
		return !sessions.find((session) => session.id === sessionId)?.firstMessage;
	}, [messageCount, messages, sessionId, sessionLoading, sessionName, sessions]);
}

function isUnboundNewSession(
	state: Pick<
		PiState,
		| "messageCount"
		| "messages"
		| "sessionId"
		| "sessionLoading"
		| "sessionName"
		| "sessionProject"
		| "sessions"
	>,
): boolean {
	if (state.sessionLoading || state.sessionProject || state.sessionName) return false;
	if (state.messageCount > 0 || state.messages.length > 0) return false;
	return !state.sessions.find((session) => session.id === state.sessionId)?.firstMessage;
}

export function hasWorkspaceForPrompt(state: PiState): boolean {
	return !isUnboundNewSession(state) && Boolean(state.sessionCwd || state.sessionProject);
}

/**
 * Working directory of the session on screen.
 *
 * The store knows it for handles the renderer opened itself — including a session so new that pi
 * has not written it to disk yet. A handle that was already open when the renderer started only
 * carries its slice, so the listed session's folder is the fallback.
 */
export function useSessionCwd(): string | undefined {
	const sessionCwd = usePiStore((state) => state.sessionCwd);
	const sessionFile = usePiStore((state) => state.sessionFile);
	const sessions = usePiStore((state) => state.sessions);
	return useMemo(() => {
		if (sessionCwd) return sessionCwd;
		if (!sessionFile) return undefined;
		const key = sessionMapKey(sessionFile);
		return sessions.find((session) => sessionMapKey(session.path) === key)?.cwd;
	}, [sessionCwd, sessionFile, sessions]);
}

/**
 * Commands that address the process rather than one session: they are the only ones that must
 * not carry a `sessionId`.
 */
const PROCESS_COMMANDS = new Set(["close_session", "get_capabilities", "get_open_sessions", "open_session"]);

/**
 * Address session-scoped commands at the handle the UI shows. Multi-session runtimes route a
 * command without `sessionId` to their "active" handle, but the renderer must not depend on
 * that heuristic; unpatched runtimes take the command untouched and land on their only session.
 */
function withVisibleHandle(command: Record<string, unknown>): Record<string, unknown> {
	if (command.sessionId !== undefined) return command;
	if (PROCESS_COMMANDS.has(String(command.type))) return command;
	const state = usePiStore.getState();
	if (!state.multiSession || !state.activeHandleId) return command;
	return { ...command, sessionId: state.activeHandleId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface RpcEnvelope<T> {
	data?: T;
	error?: string;
	success?: boolean;
}

async function rpc<T>(command: Record<string, unknown>): Promise<T> {
	const response = (await window.pi.command(withVisibleHandle(command))) as RpcEnvelope<T> | undefined;
	if (response?.success === false) {
		throw new Error(response.error || `pi RPC command failed: ${String(command.type)}`);
	}
	return response?.data as T;
}

function toImageContent(images?: ImageAttachment[]): Array<{ data: string; mimeType: string; type: "image" }> | undefined {
	if (!images || images.length === 0) return undefined;
	return images.map((image) => ({ data: image.data, mimeType: image.mimeType, type: "image" }));
}

interface SessionSnapshot {
	autoCompactionEnabled?: boolean;
	cwd?: string;
	isCompacting?: boolean;
	messageCount?: number;
	model?: { id?: string };
	pendingMessageCount?: number;
	sessionFile?: string;
	sessionId?: string;
	sessionName?: string;
	steeringMode?: "all" | "one-at-a-time";
	thinkingLevel?: string;
	followUpMode?: "all" | "one-at-a-time";
	isStreaming?: boolean;
}

/** One live session runtime inside the RPC process, as `open_session` / `get_open_sessions` report it. */
interface OpenSessionData {
	active?: boolean;
	cwd?: string;
	isStreaming?: boolean;
	messageCount?: number;
	piSessionId?: string;
	sessionFile?: string;
	sessionName?: string;
	/** Handle id, stable for the life of the handle even when it switches session file. */
	sessionId?: string;
}

interface OpenSessionsSnapshot {
	activeSessionId?: string;
	sessions?: OpenSessionData[];
}

interface RpcCapabilities {
	multiSession?: boolean;
	protocolVersion?: number;
}

/** Notification id is fixed so the fallback warning appears exactly once per app run. */
const MISSING_PATCH_NOTIFICATION_ID = "multi-session-missing";

const MISSING_PATCH_MESSAGE =
	t("pi 运行时缺少多会话补丁，切换会话会中断当前任务。请按 docs/pi-runtime-patch.md 重新同步运行时。");

/** Set by the first handshake that reports no multi-session support; keeps the warning to one. */
let missingPatchWarned = false;

/** Events that only stream deltas into a message already being built. */
const DELTA_EVENTS = new Set(["message_update", "tool_execution_update"]);

/**
 * Output throughput meter of the visible session.
 *
 * pi resends the assistant message's cumulative usage on every `message_update`, so real generated
 * tokens over real streaming time need no extra polling. Only the visible session feeds it:
 * background events are routed away before they reach this path.
 */
const outputMeter = { startedAt: 0 };

/**
 * Epoch ms of the first streamed token of the step now being written, so time-to-first-token can
 * be taken from real deltas instead of from the message shell pi opens before calling the API.
 */
const firstTokenAt = { at: 0 };

/** True when this update carried an actual token: deltas count, block boundaries do not. */
function hasDelta(update: Record<string, unknown>): boolean {
	if (typeof update.delta === "string" && update.delta.length > 0) return true;
	return typeof update.thinking === "string" && update.thinking.length > 0;
}

/** The assistant's own part of a `message_update`, which is where the streamed text lives. */
function eventAssistantUpdate(event: Record<string, unknown>): Record<string, unknown> {
	return isRecord(event.assistantMessageEvent) ? event.assistantMessageEvent : {};
}

/** A rate needs a little history: three tokens in 200ms is noise, not a speed. */
const RATE_MIN_SECONDS = 1;
const RATE_MIN_TOKENS = 20;

function eventUsage(event: Record<string, unknown>): Record<string, unknown> | undefined {
	const direct = isRecord(event.usage) ? event.usage : undefined;
	if (direct) return direct;
	const message = isRecord(event.message) ? event.message : undefined;
	return isRecord(message?.usage) ? message.usage : undefined;
}

function noteAssistantStart(event: Record<string, unknown>): void {
	const message = isRecord(event.message) ? event.message : undefined;
	if (message?.role === "assistant") {
		outputMeter.startedAt = Date.now();
		firstTokenAt.at = 0;
	}
}

/** Token rate for the assistant message that is streaming, or nothing while it is too young. */
function outputTokensPerSecond(event: Record<string, unknown>): Partial<PiState> {
	const output = eventUsage(event)?.output;
	if (typeof output !== "number" || outputMeter.startedAt === 0) return {};
	const seconds = (Date.now() - outputMeter.startedAt) / 1000;
	if (seconds < RATE_MIN_SECONDS || output < RATE_MIN_TOKENS) return {};
	return { outputTokensPerSecond: output / seconds };
}

function usageOf(value: unknown): MessageUsage | undefined {
	if (!isRecord(value)) return undefined;
	const input = typeof value.input === "number" ? value.input : 0;
	const output = typeof value.output === "number" ? value.output : 0;
	const cacheRead = typeof value.cacheRead === "number" ? value.cacheRead : 0;
	const cacheWrite = typeof value.cacheWrite === "number" ? value.cacheWrite : 0;
	const total = typeof value.totalTokens === "number" ? value.totalTokens : input + output + cacheRead + cacheWrite;
	if (total <= 0) return undefined;
	// Keyed by what the transcript shows, not by pi's field names, so a reordered wire shape
	// cannot silently swap the columns.
	return { cacheRead, cacheWrite, input, output, total };
}

/**
 * The token bill of the turn starting at `message`, up to the step the message belongs to.
 *
 * Usage is per provider call, which pi restarts at every step of a tool-using turn, so the cost
 * of one answer is the sum of its steps: the count runs from the last user message up to `id`.
 * Only messages with `usage` were sent to a provider, which is what keeps restored rows out.
 */
function turnUsage(messages: ChatMessage[], id: string): MessageUsage | undefined {
	const end = messages.findIndex((message) => message.id === id);
	if (end < 0) return undefined;
	let start = 0;
	for (let index = end; index >= 0; index -= 1) {
		if (messages[index].role === "user") {
			start = index;
			break;
		}
	}
	const found = messages
		.slice(start, end + 1)
		.map((message) => message.usage)
		.filter((usage): usage is MessageUsage => usage !== undefined);
	if (found.length === 0) return undefined;
	return {
		cacheRead: found.reduce((sum, usage) => sum + usage.cacheRead, 0),
		cacheWrite: found.reduce((sum, usage) => sum + usage.cacheWrite, 0),
		input: found.reduce((sum, usage) => sum + usage.input, 0),
		output: found.reduce((sum, usage) => sum + usage.output, 0),
		total: found.reduce((sum, usage) => sum + usage.total, 0),
	};
}

/** Put a notice in the same list extension notifications land in; the sidebar bell shows them. */
function pushNotification(message: string, type: "error" | "info" | "warning" = "info"): void {
	usePiStore.setState((state) => ({
		extensionUiNotifications: [
			...state.extensionUiNotifications,
			{ at: Date.now(), id: nextMessageId(), message, type },
		],
	}));
}

/** Which of pi's two queues a message sits in; they deliver at different points of a turn. */
type QueueKind = keyof QueueState;

/** Position of the `occurrence`-th `text` in `list`, or -1 when it is not there any more. */
function occurrenceIndex(list: string[], text: string, occurrence: number): number {
	let seen = -1;
	for (let index = 0; index < list.length; index += 1) {
		if (list[index] !== text) continue;
		seen += 1;
		if (seen === occurrence) return index;
	}
	return -1;
}

/** Put both queues back in the order they should be delivered. */
async function requeueQueue(steering: string[], followUp: string[]): Promise<void> {
	const ordered = [
		...steering.map((message) => ({ message, type: "steer" as const })),
		...followUp.map((message) => ({ message, type: "follow_up" as const })),
	];
	for (let index = 0; index < ordered.length; index += 1) {
		try {
			await rpc({ message: ordered[index].message, type: ordered[index].type });
		} catch (error) {
			// Everything from here on never reached pi's queue, which was already cleared. Hand the
			// text back to the composer instead of dropping what the user wrote: it is appended to
			// whatever is in the box, because composerText is a staging channel, not a mirror of it.
			const unsent = ordered.slice(index).map((item) => item.message);
			usePiStore.setState((state) => ({
				composerAppend: true,
				composerText: unsent.join("\n\n"),
				recallId: state.recallId + 1,
			}));
			throw error;
		}
	}
}

/**
 * Apply one change to the queue the user sees, then put the queue back.
 *
 * pi's RPC can only clear the whole queue, so a per-row edit is "clear, change one entry,
 * re-queue the rest". The lists pi hands back after the clear are the authoritative ones: a
 * message the running turn already picked up is simply absent, which makes a second click on a
 * stale row a no-op instead of a duplicate. `steer` additionally moves the entry to the front of
 * the steering queue, so the running turn picks it up at its next step instead of at the end.
 */
async function mutateQueue(
	kind: QueueKind,
	index: number,
	change: (text: string) => string | undefined,
	steer = false,
): Promise<boolean> {
	const { queue } = usePiStore.getState();
	const text = queue[kind][index];
	if (text === undefined) return false;
	const occurrence = queue[kind].slice(0, index).filter((value) => value === text).length;
	const cleared = await rpc<QueueState>({ type: "clear_queue" });
	if (!cleared) return false;
	const lists: QueueState = { followUp: [...(cleared.followUp ?? [])], steering: [...(cleared.steering ?? [])] };
	const at = occurrenceIndex(lists[kind], text, occurrence);
	if (at < 0) {
		try { await requeueQueue(lists.steering, lists.followUp); } catch {}
		return false;
	}
	const replacement = change(text);
	// A requeue that fails halfway drops whatever was not sent yet: pi's queue is already
	// cleared, so the only honest outcome is to say that messages were lost, not to pretend
	// the edit landed.
	const requeue = async (steering: string[], followUp: string[]): Promise<boolean> => {
		try {
			await requeueQueue(steering, followUp);
			return true;
		} catch (error) {
			pushNotification(
				t("重建消息队列失败：{arg}", { "arg": error instanceof Error ? error.message : String(error) }),
				"error",
			);
			return false;
		}
	};
	if (steer) {
		// Steering moves the message to the front of the steering queue rather than leaving it
		// where it was, so it has to leave its own queue here — keeping it there would queue it
		// twice, once as a steer and once as the follow-up it used to be.
		lists[kind].splice(at, 1);
		return requeue([replacement ?? text, ...lists.steering], lists.followUp);
	}
	if (replacement === undefined) lists[kind].splice(at, 1);
	else lists[kind][at] = replacement;
	return requeue(lists.steering, lists.followUp);
}

function toQueue(event: Record<string, unknown>): QueueState {
	return {
		followUp: Array.isArray(event.followUp) ? event.followUp.map(String) : [],
		steering: Array.isArray(event.steering) ? event.steering.map(String) : [],
	};
}

/** Flat fields a `get_state` snapshot maps to; the transcript is read separately. */
function snapshotFields(snapshot: SessionSnapshot | undefined): Partial<PiState> {
	return {
		autoCompactionEnabled: snapshot?.autoCompactionEnabled,
		connectionError: undefined,
		followUpMode: snapshot?.followUpMode ?? "one-at-a-time",
		isCompacting: snapshot?.isCompacting ?? false,
		messageCount: snapshot?.messageCount ?? 0,
		model: snapshot?.model?.id,
		// A snapshot without a cwd (partial data) must not erase the folder the session
		// was opened with — that folder is what lets the composer send at all.
		...(snapshot?.cwd !== undefined ? { sessionCwd: snapshot.cwd } : {}),
		sessionFile: snapshot?.sessionFile,
		sessionId: snapshot?.sessionId,
		sessionLoading: false,
		sessionName: snapshot?.sessionName,
		// Whether the session is running is pi's answer to give, and this is where the app reads it.
		// The transcript carries its own per-message `streaming` marks, and after the window missed
		// the end of a turn those marks are the only thing still claiming the session is busy: the
		// composer (which reads `status`) is idle while the flow keeps showing 正在思考….
		status: snapshot?.isStreaming ? "streaming" : "idle",
		steeringMode: snapshot?.steeringMode ?? "one-at-a-time",
		thinkingLevel: snapshot?.thinkingLevel,
	};
}

/** Connect an `open_session` answer to the path map so the next click reuses the handle. */
function registerHandle(handles: Record<string, string>, opened: OpenSessionData): Record<string, string> {
	if (!opened.sessionId || !opened.sessionFile) return handles;
	return { ...handles, [sessionMapKey(opened.sessionFile)]: opened.sessionId };
}

/**
 * Re-point the path map after a handle replaced its session (`new_session`, clone, fork,
 * switch_session): the handle id survives, the file it holds does not.
 */
function rekeyHandles(
	handles: Record<string, string>,
	handleId: string,
	sessionFile?: string,
): Record<string, string> {
	const next: Record<string, string> = {};
	for (const [path, id] of Object.entries(handles)) {
		if (id === handleId) continue;
		next[path] = id;
	}
	if (sessionFile) next[sessionMapKey(sessionFile)] = handleId;
	return next;
}

function emptyBackgroundSession(): BackgroundSession {
	return {
		loaded: false,
		messageCount: 0,
		messages: [],
		queue: { followUp: [], steering: [] },
		status: "starting",
		streaming: false,
		unread: false,
	};
}

/** Copy the visible session's flat fields into the shape kept for background sessions. */
function stashVisible(state: PiStore): BackgroundSession {
	return {
		// A visible session that is still loading has no transcript to keep: remembering the
		// placeholder would make the session look empty the next time it is opened.
		loaded: !state.sessionLoading,
		messageCount: state.messageCount,
		messages: state.messages,
		piSessionId: state.sessionId,
		queue: state.queue,
		sessionCwd: state.sessionCwd,
		sessionFile: state.sessionFile,
		sessionName: state.sessionName,
		status: state.status,
		streaming: state.status === "streaming",
		unread: false,
	};
}

/**
 * Move the visible session onto `handleId` without talking to pi: the outgoing flat fields are
 * stashed into their slice, the incoming slice is projected back onto the same flat fields.
 */
function projectHandle(state: PiStore, handleId: string): Partial<PiStore> {
	if (state.activeHandleId === handleId) {
		// Already visible: its slice is an older copy (it is re-stashed when the user leaves),
		// so projecting it back would rewind the live transcript. Only clear the unread mark.
		const current = state.backgroundSessions[handleId];
		if (!current?.unread) return {};
		return { backgroundSessions: { ...state.backgroundSessions, [handleId]: { ...current, unread: false } } };
	}
	const backgroundSessions = { ...state.backgroundSessions };
	if (state.activeHandleId) backgroundSessions[state.activeHandleId] = stashVisible(state);
	// The rate belongs to the session that was streaming, not to the one arriving.
	outputMeter.startedAt = 0;
	const slice = backgroundSessions[handleId];
	if (!slice) {
		// No renderer copy of this handle's transcript yet (e.g. the session pi opened for
		// itself at startup): blank the visible fields and let the refresh that follows fill in.
		return {
			activeHandleId: handleId,
			backgroundSessions,
			error: undefined,
			messageCount: 0,
			messages: [],
			outputTokensPerSecond: undefined,
			queue: { followUp: [], steering: [] },
			sessionLoading: true,
			sessionStats: undefined,
			sessionCwd: undefined,
			sessionProject: undefined,
			status: "starting",
			files: [],
			filesRoot: undefined,
		};
	}
	backgroundSessions[handleId] = { ...slice, unread: false };
	return {
		activeHandleId: handleId,
		backgroundSessions,
		connectionError: undefined,
		error: undefined,
		messageCount: slice.messageCount,
		messages: slice.messages,
		outputTokensPerSecond: undefined,
		queue: slice.queue,
		sessionCwd: slice.sessionCwd,
		sessionFile: slice.sessionFile,
		sessionId: slice.piSessionId,
		// The pick belongs to the session that was on screen, not to the one arriving.
		sessionProject: undefined,
		sessionLoading: false,
		sessionName: slice.sessionName,
		files: [],
		filesRoot: undefined,
		// The previous session's stats describe another context window; the switch re-reads them.
		sessionStats: undefined,
		status: slice.streaming ? "streaming" : slice.status,
	};
}

/** Name used in dialog titles for a background session; falls back to the handle id. */
function sessionLabel(state: PiStore, handleId: string, slice: BackgroundSession): string {
	const file = slice.sessionFile ? sessionMapKey(slice.sessionFile) : undefined;
	const listed = state.sessions.find(
		(session) => (file !== undefined && sessionMapKey(session.path) === file) || session.id === slice.piSessionId,
	);
	return slice.sessionName ?? listed?.name ?? listed?.firstMessage ?? handleId;
}

/** Dialog-shaped extension request, or undefined for the non-dialog extension UI methods. */
function toExtensionRequest(raw: Record<string, unknown>): ExtensionUiRequest | undefined {
	const method = typeof raw.method === "string" ? raw.method : "";
	if (method !== "select" && method !== "confirm" && method !== "input" && method !== "editor") return undefined;
	return {
		id: typeof raw.id === "string" ? raw.id : nextMessageId(),
		message: typeof raw.message === "string" ? raw.message : undefined,
		method,
		options: Array.isArray(raw.options) ? raw.options.map(String) : undefined,
		placeholder: typeof raw.placeholder === "string" ? raw.placeholder : undefined,
		prefill: typeof raw.prefill === "string" ? raw.prefill : undefined,
		sessionId: typeof raw.sessionId === "string" ? raw.sessionId : undefined,
		timeout: typeof raw.timeout === "number" ? raw.timeout : undefined,
		title: typeof raw.title === "string" ? raw.title : undefined,
	};
}

/** `notify` extension request as a toast, or undefined for the other methods. */
function toNotification(raw: Record<string, unknown>): ExtensionUiNotification | undefined {
	if (raw.method !== "notify") return undefined;
	return {
		id: typeof raw.id === "string" ? raw.id : nextMessageId(),
		message: typeof raw.message === "string" ? raw.message : "",
		type: raw.notifyType === "warning" || raw.notifyType === "error" ? raw.notifyType : "info",
	};
}

/**
 * Apply one event from a session the user is not looking at.
 *
 * Kept deliberately cheap: the slice only holds what showing that session again needs
 * (transcript, status, queue, counts), while visible-only state such as widgets, statuses, the
 * composer text and the window title is left alone. Extension dialogs and notifications do
 * surface, because a background session blocked on an answer would otherwise look stuck.
 */
function applyBackgroundEvent(handleId: string, event: Record<string, unknown>): void {
	const type = typeof event.type === "string" ? event.type : "";
	usePiStore.setState((state) => {
		const slice = state.backgroundSessions[handleId];
		// Events can outlive a handle that was closed or dropped: without a slice and without an
		// entry in the path map the renderer knows nothing about it, and must not resurrect it.
		if (!slice && !Object.values(state.handles).includes(handleId)) return {};
		const next: BackgroundSession = { ...(slice ?? emptyBackgroundSession()) };
		// The message reducers only read `messages`, so a slice can reuse them by standing in
		// for the visible session for the length of one event.
		const view: MessageView = { messages: next.messages, status: next.status };
		if (type === "agent_start" || type === "turn_start") next.status = "streaming";
		else if (type === "agent_settled") next.status = "idle";
		else if (type === "queue_update") next.queue = toQueue(event);
		else if (type === "session_info_changed") {
			next.sessionName = typeof event.name === "string" ? event.name : undefined;
		} else if (type === "message_start") {
			const partial = applyMessageStart(view, event, handleId);
			next.messages = partial.messages ?? next.messages;
			next.messageCount += 1;
		} else if (type === "message_update") {
			next.messages = applyMessageUpdate(view, event, handleId).messages ?? next.messages;
		} else if (type === "message_end") {
			next.messages = applyMessageEnd(view, event, handleId).messages ?? next.messages;
		} else if (type === "tool_execution_start" || type === "tool_execution_update" || type === "tool_execution_end") {
			const kind = type === "tool_execution_start" ? "start" : type === "tool_execution_update" ? "update" : "end";
			next.messages = applyToolEvent(view, event, kind, handleId).messages ?? next.messages;
		}
		next.streaming = next.status === "streaming";
		if (!DELTA_EVENTS.has(type)) next.unread = true;
		const backgroundSessions = { ...state.backgroundSessions, [handleId]: next };
		if (type !== "extension_ui_request") return { backgroundSessions };
		const request = toExtensionRequest(event);
		if (request) {
			// Still ask: the dialog is the only way that session can make progress. The session
			// label is what tells the user which session is asking.
			return {
				backgroundSessions,
				extensionUiRequests: [
					...state.extensionUiRequests,
					{ ...request, sessionLabel: sessionLabel(state, handleId, next) },
				],
			};
		}
		const notification = toNotification(event);
		if (notification) {
			return { backgroundSessions, extensionUiNotifications: [...state.extensionUiNotifications, notification] };
		}
		// setStatus / setWidget / setTitle / set_editor_text address the visible session only.
		return { backgroundSessions };
	});
}

/**
 * Put a restarted process back on the session the user was looking at: it comes up on a fresh
 * session, so the old one has to be opened again. A file that no longer opens (archived, moved)
 * leaves whatever pi started with on screen instead of failing the reconnect.
 */
async function restoreVisibleSession(get: () => PiStore, sessionFile?: string): Promise<void> {
	if (sessionFile && get().multiSession) {
		try {
			await get().showSession(sessionFile);
			return;
		} catch {}
	}
	await get().refreshSession();
}

/** The part of the state the message reducers read; every session keeps its own list. */
interface MessageView {
	messages: ChatMessage[];
	/**
	 * The session status the app currently believes: `"streaming"` while pi runs a turn. The
	 * transcript's per-message marks are renderer state, and a mark left behind by an abort or a
	 * reload has to be corrected against it.
	 */
	status?: AppStatus;
}

/**
 * Close messages that only the renderer still believes are streaming.
 *
 * The session's status is what pi reports and the per-message marks are what the app keeps, so the
 * two are reconciled here: whenever the session is known not to be running, a mark that outlived
 * its turn is closed. A live turn is never touched, and this runs where a new turn starts or a
 * session is read back — the moments a stale mark could otherwise survive forever.
 */
function settleDanglingStreams(messages: ChatMessage[], status: AppStatus | undefined): ChatMessage[] {
	if (status === "streaming") return messages;
	return messages.map((message) =>
		message.state === "streaming"
			? {
					...message,
					blocks: message.blocks.map((block) => {
						if (block.type === "image") return block;
						if (block.type === "toolCall") {
							return block.state === "running" ? { ...block, state: "complete" as const } : block;
						}
						return block.state === "streaming" ? { ...block, state: "complete" as const } : block;
					}),
					state: "complete" as const,
				}
			: message,
	);
}

function ensureAssistantMessage(
	scope: string,
	messages: ChatMessage[],
): { message: ChatMessage; messages: ChatMessage[] } {
	const currentId = assistantMessageIds.get(scope);
	if (currentId) {
		const existing = messages.find((message) => message.id === currentId);
		if (existing) return { message: existing, messages };
	}
	const message: ChatMessage = {
		blocks: [],
		id: nextMessageId(),
		role: "assistant",
		state: "streaming",
	};
	assistantMessageIds.set(scope, message.id);
	return { message, messages: [...messages, message] };
}

function updateAssistant(
	scope: string,
	messages: ChatMessage[],
	updater: (message: ChatMessage) => ChatMessage,
): ChatMessage[] {
	const { message, messages: next } = ensureAssistantMessage(scope, messages);
	return next.map((candidate) => (candidate.id === message.id ? updater(candidate) : candidate));
}

function setBlockAt(
	blocks: MessageBlock[],
	index: number,
	create: () => MessageBlock,
	update: (block: MessageBlock) => MessageBlock,
): MessageBlock[] {
	const next = [...blocks];
	const existing = next[index];
	next[index] = existing ? update(existing) : create();
	return next;
}

function appendDelta(
	block: MessageBlock,
	delta: string,
	expectedType: "text" | "thinking",
): MessageBlock {
	if (block.type !== expectedType) return block;
	return { ...block, state: "streaming", text: block.text + delta };
}

function toBlocks(content: unknown): MessageBlock[] {
	if (!Array.isArray(content)) return [];
	const blocks: MessageBlock[] = [];
	for (const part of content) {
		if (!isRecord(part)) continue;
		if (part.type === "text" && typeof part.text === "string") {
			blocks.push({ state: "complete", text: part.text, type: "text" });
		} else if (part.type === "image" && typeof part.data === "string") {
			blocks.push({
				data: part.data,
				mimeType: typeof part.mimeType === "string" ? part.mimeType : "image/png",
				type: "image",
			});
		} else if (part.type === "thinking" && typeof part.thinking === "string") {
			blocks.push({ state: "complete", text: part.thinking, type: "thinking" });
		} else if (part.type === "toolCall") {
			blocks.push({
				args: part.arguments ?? part.input,
				details: part.details,
				output: "",
				state: "complete",
				toolCallId: typeof part.id === "string" ? part.id : nextMessageId(),
				toolName: typeof part.name === "string" ? part.name : "tool",
				type: "toolCall",
			});
		}
	}
	return blocks;
}

	function applyMessageStart(
	state: MessageView,
	event: Record<string, unknown>,
	scope: string,
): Partial<PiState> {
	const message = isRecord(event.message) ? event.message : undefined;
	if (!message) return {};
	const role = message.role === "user" ? "user" : "assistant";
	if (role === "user") {
		// The clock the usage footer reports starts at the prompt, not at the first token: the
		// provider's queueing and the tool rounds in between are part of what the turn cost. A
		// clock left behind by an aborted turn is replaced here rather than reused.
		const startedAt = Date.now();
		turnStartedAt.set(scope, startedAt);
		return {
			messages: [
				// A prompt pi accepted while it reports no run means the previous turn is over and its
				// end never arrived here; otherwise its rows would keep the flow looking busy.
				...settleDanglingStreams(state.messages, state.status),
				{
					blocks: toBlocks(message.content),
					createdAt: startedAt,
					id: nextMessageId(),
					role: "user",
					state: "complete",
				},
			],
		};
	}
	assistantMessageIds.delete(scope);
	// Same reconciliation for a step pi starts on an idle session: an assistant message that never
	// closed would otherwise sit above this one showing 正在思考… with no turn behind it.
	const base = settleDanglingStreams(state.messages, state.status);
	const { messages } = ensureAssistantMessage(scope, base);
	return { messages };
}

function applyMessageUpdate(
	state: MessageView,
	event: Record<string, unknown>,
	scope: string,
): Partial<PiState> {
	const update = isRecord(event.assistantMessageEvent) ? event.assistantMessageEvent : undefined;
	if (!update) return {};
	const type = typeof update.type === "string" ? update.type : "";
	const contentIndex = typeof update.contentIndex === "number" ? update.contentIndex : 0;
	const delta = typeof update.delta === "string" ? update.delta : "";
	return {
		messages: updateAssistant(scope, state.messages, (message) => {
			if (type === "thinking_start") {
				return {
					...message,
					blocks: setBlockAt(
						message.blocks,
						contentIndex,
						() => ({ state: "streaming", text: "", type: "thinking" }),
						(block) => block,
					),
				};
			}
			if (type === "thinking_delta") {
				return {
					...message,
					blocks: setBlockAt(
						message.blocks,
						contentIndex,
						() => ({ state: "streaming", text: delta, type: "thinking" }),
						(block) => appendDelta(block, delta, "thinking"),
					),
				};
			}
			if (type === "thinking_end") {
				return {
					...message,
					blocks: setBlockAt(
						message.blocks,
						contentIndex,
						() => ({ state: "complete", text: "", type: "thinking" }),
						(block) => ({ ...block, state: "complete" }),
					),
				};
			}
			if (type === "text_start") {
				return {
					...message,
					blocks: setBlockAt(
						message.blocks,
						contentIndex,
						() => ({ state: "streaming", text: "", type: "text" }),
						(block) => block,
					),
				};
			}
			if (type === "text_delta") {
				return {
					...message,
					blocks: setBlockAt(
						message.blocks,
						contentIndex,
						() => ({ state: "streaming", text: delta, type: "text" }),
						(block) => appendDelta(block, delta, "text"),
					),
				};
			}
			if (type === "text_end") {
				return {
					...message,
					blocks: setBlockAt(
						message.blocks,
						contentIndex,
						() => ({ state: "complete", text: "", type: "text" }),
						(block) => ({ ...block, state: "complete" }),
					),
				};
			}
			if (type === "toolcall_start") {
				const partial = isRecord(update.partial) ? update.partial : undefined;
				const content = Array.isArray(partial?.content) ? partial.content : [];
				const part = isRecord(content[contentIndex]) ? content[contentIndex] : undefined;
				const toolCallId = typeof part?.id === "string" ? part.id : nextMessageId();
				const toolName = typeof part?.name === "string" ? part.name : "tool";
				return {
					...message,
					blocks: setBlockAt(
						message.blocks,
						contentIndex,
						() => ({ args: undefined, output: "", state: "running", toolCallId, toolName, type: "toolCall" }),
						(block) => block,
					),
				};
			}
			return message;
		}),
	};
}

function applyMessageEnd(
	state: MessageView,
	event: Record<string, unknown>,
	scope: string,
): Partial<PiState> {
	const message = isRecord(event.message) ? event.message : undefined;
	if (!message) return {};
	if (message.role === "toolResult" && typeof message.toolCallId === "string") {
		const output = Array.isArray(message.content)
			? message.content
					.map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
					.join("")
			: "";
		return {
			messages: state.messages.map((chat) => ({
				...chat,
				blocks: chat.blocks.map((block) =>
					block.type === "toolCall" && block.toolCallId === message.toolCallId
						? {
								...block,
								details: message.details ?? block.details,
								output: output || block.output,
								state: message.isError === true ? ("error" as const) : ("complete" as const),
							}
						: block,
				),
			})),
		};
	}
	if (message.role !== "assistant") return {};
	const finalBlocks = toBlocks(message.content);
	const stopReason = typeof message.stopReason === "string" ? message.stopReason : "stop";
	const stateValue: BlockState =
		stopReason === "error" ? "error" : stopReason === "aborted" ? "aborted" : "complete";
	// A step that asked for tools is not the turn's answer, so the turn's clock keeps running until
	// the step with none settles: that is where the whole prompt-to-answer time lands.
	const lastStep = !finalBlocks.some((block) => block.type === "toolCall");
	const startedAt = turnStartedAt.get(scope);
	const settledAt = Date.now();
	let next = updateAssistant(scope, state.messages, (current) => {
		const usage = usageOf(message.usage);
		const ttftMs =
			current.ttftMs ??
			(firstTokenAt.at > 0 && startedAt !== undefined ? Math.max(0, firstTokenAt.at - startedAt) : undefined);
		return {
			...current,
			blocks: mergeToolCalls(current.blocks, finalBlocks),
			// Only the step that reported usage writes the timestamp: an empty aborted step must not
			// move the completion time away from the answer the user is reading.
			completedAt: usage ? settledAt : current.completedAt,
			createdAt: current.createdAt ?? startedAt,
			model: typeof message.model === "string" ? message.model : current.model,
			provider: typeof message.provider === "string" ? message.provider : current.provider,
			state: stateValue,
			ttftMs,
			usage: usage ?? current.usage,
		};
	});
	if (lastStep && startedAt !== undefined) {
		// The turn is over, so its elapsed time can be frozen onto every step it took. Only this
		// turn's messages are in range: an earlier answer's footer must keep its own time.
		const from = turnStartIndex(next);
		next = next.map((chat, index) =>
			index >= from && chat.role === "assistant" ? { ...chat, durationMs: settledAt - startedAt } : chat,
		);
		turnStartedAt.delete(scope);
	}
	return { messages: next };
}

/** Index of the prompt the last assistant message answers; 0 when no user message precedes it. */
function turnStartIndex(messages: ChatMessage[]): number {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		if (messages[index].role === "user") return index;
	}
	return 0;
}

/**
 * Keep the streamed blocks and take pi's final ones.
 *
 * A finished tool call arrives twice — once as it streamed, then in the message that closed the
 * step — and only the streamed copy has the result, so the final call keeps what the streaming
 * side already collected.
 */
function mergeToolCalls(current: MessageBlock[], finalBlocks: MessageBlock[]): MessageBlock[] {
	const merged = finalBlocks.map((block) => {
		if (block.type !== "toolCall") return block;
		const previous = current.find(
			(candidate) => candidate.type === "toolCall" && candidate.toolCallId === block.toolCallId,
		);
		if (!previous || previous.type !== "toolCall") return block;
		return {
			...block,
			details: block.details ?? previous.details,
			output: block.output || previous.output,
			state:
				previous.state === "complete" || previous.state === "error" ? previous.state : block.state,
		};
	});
	return merged.length > 0 ? merged : current;
}

function applyToolEvent(
	state: MessageView,
	event: Record<string, unknown>,
	kind: "start" | "update" | "end",
	scope: string,
): Partial<PiState> {
	const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : nextMessageId();
	const toolName = typeof event.toolName === "string" ? event.toolName : "tool";
	return {
		messages: updateAssistant(scope, state.messages, (message) => {
			const index = message.blocks.findIndex(
				(block) => block.type === "toolCall" && block.toolCallId === toolCallId,
			);
			const existing = index >= 0 ? (message.blocks[index] as Extract<MessageBlock, { type: "toolCall" }>) : undefined;
			const details =
				kind === "end"
					? (isRecord(event.result) ? event.result.details : event.result) ?? existing?.details
					: kind === "update"
						? (isRecord(event.partialResult) ? event.partialResult.details : event.partialResult) ??
							existing?.details
						: existing?.details;
			const nextBlock = {
				args: event.args ?? existing?.args,
				details,
				output:
					kind === "end"
						? existing?.output ?? ""
						: kind === "update"
							? `${existing?.output ?? ""}${formatPartial(event.partialResult)}`
							: existing?.output ?? "",
				state: kind === "start" ? ("running" as const) : kind === "end" ? (event.isError ? ("error" as const) : ("complete" as const)) : ("running" as const),
				toolCallId,
				toolName,
				type: "toolCall" as const,
			};
			if (index >= 0) {
				const blocks = [...message.blocks];
				blocks[index] = nextBlock;
				return { ...message, blocks };
			}
			return { ...message, blocks: [...message.blocks, nextBlock] };
		}),
	};
}

function formatPartial(value: unknown): string {
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

export interface PiStore extends PiState {
	/** Stop the running turn; `sessionId` targets a background handle, the default the visible one. */
	abort: (sessionId?: string) => Promise<void>;
	abortBash: () => Promise<void>;
	abortRetry: () => Promise<void>;
	applyEvent: (event: unknown) => void;
	clearQueue: () => Promise<void>;
	/** Replace the text of one queued message, keeping its place in the queue. */
	editQueuedMessage: (kind: QueueKind, index: number, text: string) => Promise<boolean>;
	/** Take one message out of the queue. */
	removeQueuedMessage: (kind: QueueKind, index: number) => Promise<boolean>;
	/** Pull one queued message back into the composer so it can be edited before it goes out. */
	recallQueuedMessage: (kind: QueueKind, index: number) => Promise<boolean>;
	/** Move one queued message to the front of the steering queue, for the running turn to pick up. */
	steerQueuedMessage: (kind: QueueKind, index: number) => Promise<boolean>;
	/** Deliver every queued message now, in FIFO order, as steering. */
	steerAllQueued: () => Promise<void>;
	closeHandle: (handleId: string) => Promise<void>;
	cloneSession: () => Promise<void>;
	compact: (customInstructions?: string) => Promise<void>;
	cycleModel: () => Promise<void>;
	cycleThinkingLevel: () => Promise<void>;
	dismissNotification: (id: string) => void;
	clearNotificationHistory: () => void;
	exportHtml: (outputPath?: string) => Promise<string | undefined>;
	fork: (entryId: string) => Promise<void>;
	/**
	 * Replace an already-sent prompt: pi rewinds the session to just before it, then the edited
	 * text is sent as the next prompt, so the conversation continues from that point again.
	 * Resolves false when the rewind did not happen, in which case nothing was sent.
	 */
	editAndResend: (entryId: string, text: string) => Promise<boolean>;
	/** Tell pi's permission-gate extension which mode this session runs under. */
	applyPermissionMode: (mode: "full" | "read-only" | "workspace-write") => Promise<boolean>;
	followUp: (text: string, images?: ImageAttachment[]) => Promise<void>;
	initialize: () => Promise<void>;
	loadCommands: () => Promise<void>;
	loadEntries: () => Promise<void>;
	loadFiles: () => Promise<void>;
	loadForkMessages: () => Promise<void>;
	/** Re-read the model catalog; run after a restart or a model-config write, not just at boot. */
	loadModels: () => Promise<void>;
	loadPackages: () => Promise<void>;
	loadLastAssistantText: () => Promise<void>;
	loadSessions: () => Promise<void>;
	loadMessages: (messages: unknown[]) => void;
	loadSessionStats: () => Promise<void>;
	loadTree: () => Promise<void>;
	newSession: (parentSession?: string) => Promise<void>;
	/** Start a new session in a project folder; without one it lands in the current workspace. */
	newSessionIn: (cwd?: string) => Promise<void>;
	negotiateCapabilities: () => Promise<void>;
	beginSessionSwitch: (session: SessionInfo) => void;
	reconnect: (options?: { keepSession?: boolean }) => Promise<void>;
	refreshSession: () => Promise<void>;
	/** Make the session at `sessionPath` the visible one; multi-session runtimes keep the rest alive. */
	showSession: (sessionPath: string) => Promise<void>;
	/** Close idle handles beyond the configured cap, newest-used first. */
	enforceSessionPool: () => void;
	/** Re-read the visible session's metadata without touching its transcript. */
	syncVisibleSession: () => Promise<void>;
	syncSessionList: () => Promise<void>;
	reset: () => void;
	respondExtensionUi: (response: Record<string, unknown>) => Promise<void>;
	runBash: (command: string, excludeFromContext?: boolean) => Promise<void>;
	installPackage: (source: string, local: boolean) => Promise<string>;
	removePackage: (source: string, local: boolean) => Promise<string>;
	updatePackages: () => Promise<string>;
	/**
	 * Send a prompt. `sessionId` targets a specific handle (used by scheduled tasks so a user
	 * switching sessions mid-run cannot redirect the prompt to whatever is on screen).
	 * `started` in the result is pi's word on whether a fresh agent run follows the
	 * acknowledgement: queued and extension-handled prompts report false.
	 */
	send: (
		text: string,
		streamingBehavior?: "followUp" | "steer",
		images?: ImageAttachment[],
		sessionId?: string,
	) => Promise<{ started?: boolean }>;
	setAutoCompaction: (enabled: boolean) => Promise<void>;
	setAutoRetry: (enabled: boolean) => Promise<void>;
	setFollowUpMode: (mode: "all" | "one-at-a-time") => Promise<void>;
	setSessionName: (name: string) => Promise<void>;
	setModel: (provider: string, modelId: string, sessionId?: string) => Promise<void>;
	setSteeringMode: (mode: "all" | "one-at-a-time") => Promise<void>;
	setThinkingLevel: (level: string, sessionId?: string) => Promise<void>;
	setStderr: (text: string) => void;
	steer: (text: string, images?: ImageAttachment[]) => Promise<void>;
	switchSession: (sessionPath: string) => Promise<void>;
}

const initialState: PiState = {
	abortGeneration: 0,
	activeHandleId: undefined,
	autoCompactionEnabled: undefined,
	autoRetryEnabled: undefined,
	availableThinkingLevels: [],
	backgroundSessions: {},
	bashRunning: false,
	commands: [],
	compactionStatus: "idle",
	extensionUiNotifications: [],
	extensionUiRequests: [],
	extensionUiStatuses: {},
	extensionUiWidgets: {},
	forkMessages: [],
	files: [],
	handleOrder: [],
	handles: {},
	isCompacting: false,
	messageCount: 0,
	messages: [],
	models: [],
	modelsLoaded: false,
	multiSession: false,
	notificationHistory: [],
	outputTokensPerSecond: undefined,
	packages: { global: [], project: [] },
	queue: { followUp: [], steering: [] },
	recallId: 0,
	sessionEntries: [],
	sessions: [],
	sessionTree: [],
	sessionLoading: false,
	steeringMode: "one-at-a-time",
	followUpMode: "one-at-a-time",
	status: "starting",
};

export const usePiStore = create<PiStore>((set, get) => ({
	...initialState,
	abort: async (sessionId) => {
		// Advance the cancellation generation before anything else. Scheduled tasks use this
		// marker to stop their supervisor even when the child process is already closing and the
		// abort command cannot be delivered.
		set((state) => ({ abortGeneration: state.abortGeneration + 1 }));
		const targetBackground =
			sessionId !== undefined && get().multiSession && sessionId !== get().activeHandleId;
		if (targetBackground) {
			// The slice settles itself from pi's closing events; the visible transcript is untouched.
			try {
				await rpc({ sessionId, type: "abort" });
			} catch {
				// The run may already be gone; aborting a background session is best-effort.
			}
			return;
		}
		// Stopping is the user's decision, so the transcript must not keep looking busy while pi
		// closes the run: whatever is still mid-block is settled here as aborted. If pi's own
		// closing events arrive afterwards they set the same state.
		set((state) => ({
			messages: state.messages.map((message) =>
				message.state === "streaming"
					? {
							...message,
							blocks: message.blocks.map((block) => {
								// A tool call interrupted by the stop did not finish, which is what its own
								// error state means; a text or thinking block was cut off mid-stream.
								if (block.type === "toolCall") {
									return block.state === "running" ? { ...block, state: "error" as const } : block;
								}
								if (block.type === "image") return block;
								return block.state === "streaming" ? { ...block, state: "aborted" as const } : block;
							}),
							state: "aborted" as const,
						}
					: message,
			),
			status: "idle",
		}));
		try {
			await rpc({ type: "abort" });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			set({ error: message });
			throw error;
		}
	},
	abortBash: async () => {
		await rpc({ type: "abort_bash" });
		set({ bashRunning: false });
	},
	abortRetry: async () => {
		await rpc({ type: "abort_retry" });
	},
	// Single-session fallback only: the optimistic move keeps the previous session off screen
	// while pi aborts the running turn and switches. Multi-session switches use showSession.
	beginSessionSwitch: (session) => {
		const oldHandleId = get().activeHandleId;
		assistantMessageIds.delete(oldHandleId ?? "");
		turnStartedAt.delete(oldHandleId ?? "");
		set({
			connectionError: undefined,
			error: undefined,
			extensionUiRequests: oldHandleId
				? get().extensionUiRequests.filter((request) => request.sessionId !== oldHandleId)
				: [],
			messages: [],
			sessionFile: session.path,
			sessionId: session.id,
			sessionLoading: true,
			sessionName: session.name,
			status: "starting",
		});
	},
	// Drop a handle the renderer must not address anymore and forget everything about it. The
	// visible handle is never closed here: only a process restart takes that one away.
	closeHandle: async (handleId) => {
		if (!get().multiSession || handleId === get().activeHandleId) return;
		try {
			// Errors are expected (last handle, handle already gone) and not worth reporting:
			// the renderer maps below are the part that has to stay truthful.
			await rpc({ sessionId: handleId, type: "close_session" });
		} catch {}
		set((state) => {
			const backgroundSessions = { ...state.backgroundSessions };
			delete backgroundSessions[handleId];
			const handles: Record<string, string> = {};
			for (const [path, id] of Object.entries(state.handles)) {
				if (id !== handleId) handles[path] = id;
			}
			return {
				backgroundSessions,
				extensionUiRequests: state.extensionUiRequests.filter((request) => request.sessionId !== handleId),
				handleOrder: state.handleOrder.filter((id) => id !== handleId),
				handles,
			};
		});
	},
	// Each handle costs a services set (model client, resource loader, tools, one extension
	// instance per extension) plus its transcript, so idle ones are closed once the configured
	// cap is reached. The visible session and anything still working are never evicted: closing a
	// handle aborts whatever it is running. Evicted sessions keep their history on disk, and
	// showSession re-opens and re-reads them on the next click.
	enforceSessionPool: () => {
		if (!get().multiSession) return;
		const { activeHandleId, backgroundSessions, handleOrder, handles } = get();
		const limit = useSessionPoolSettings.getState().maxOpenSessions;
		const openIds = Object.values(handles);
		if (openIds.length <= limit) return;

		const keep = new Set<string>();
		if (activeHandleId) keep.add(activeHandleId);
		for (const id of openIds) {
			const slice = backgroundSessions[id];
			const queued = (slice?.queue.followUp.length ?? 0) + (slice?.queue.steering.length ?? 0);
			if (slice?.streaming === true || queued > 0) keep.add(id);
		}
		// Most-recently-used first, so the tail goes. Handles the renderer never ordered (the
		// session pi opened for itself at startup) are placed last and evicted first.
		const ordered = [...handleOrder, ...openIds.filter((id) => !handleOrder.includes(id))];
		for (const id of ordered) {
			if (!openIds.includes(id) || keep.has(id)) continue;
			if (keep.size >= limit) {
				void get().closeHandle(id);
				continue;
			}
			keep.add(id);
		}
	},
	dismissNotification: (id) =>
		set((state) => {
			const notification = state.extensionUiNotifications.find((item) => item.id === id);
			return {
				// Toasts fade away, so keep a short history for the bell to show.
				notificationHistory: notification
					? [{ ...notification, at: Date.now() }, ...state.notificationHistory].slice(0, 50)
					: state.notificationHistory,
				extensionUiNotifications: state.extensionUiNotifications.filter((item) => item.id !== id),
			};
		}),
	clearNotificationHistory: () => set({ notificationHistory: [] }),
	loadSessions: async () => {
		const sessions = await window.pi.listSessions();
		set({ sessions: Array.isArray(sessions) ? (sessions as SessionInfo[]) : [] });
	},
	loadMessages: (messages) => {
		const loaded: ChatMessage[] = [];
		for (const raw of messages) {
			if (!isRecord(raw)) continue;
			if (raw.role === "user") {
				loaded.push({
					blocks: toBlocks(raw.content),
					id: nextMessageId(),
					role: "user",
					state: "complete",
				});
				continue;
			}
			if (raw.role === "assistant") {
				// Usage, the model that served it and the completion time survive a reload; the
				// elapsed time does not, because only the live event stream saw the prompt go out.
				loaded.push({
					blocks: toBlocks(raw.content),
					completedAt: typeof raw.timestamp === "number" ? raw.timestamp : undefined,
					id: nextMessageId(),
					model: typeof raw.model === "string" ? raw.model : undefined,
					provider: typeof raw.provider === "string" ? raw.provider : undefined,
					role: "assistant",
					state: "complete",
					usage: usageOf(raw.usage),
				});
				continue;
			}
			if (raw.role === "toolResult" && typeof raw.toolCallId === "string") {
				for (let index = loaded.length - 1; index >= 0; index -= 1) {
					const message = loaded[index];
					const block = message.blocks.find(
						(candidate) => candidate.type === "toolCall" && candidate.toolCallId === raw.toolCallId,
					);
					if (block && block.type === "toolCall") {
						block.output = Array.isArray(raw.content)
							? raw.content
									.map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
									.join("")
							: "";
						block.details = raw.details ?? block.details;
						block.state = raw.isError === true ? "error" : "complete";
						break;
					}
				}
			}
		}
		set({ messages: settleDanglingStreams(loaded, get().status) });
	},
	applyEvent: (raw) => {
		if (!isRecord(raw)) return;
		const type = typeof raw.type === "string" ? raw.type : "";
		const visible = get();
		const handleId = typeof raw.sessionId === "string" ? raw.sessionId : undefined;
		// Multi-session runtimes tag every event with the handle it came from. Events for a
		// handle other than the visible one update that handle's slice only; the visible
		// transcript and everything the composer shows stay untouched.
		if (visible.multiSession && handleId && handleId !== visible.activeHandleId) {
			applyBackgroundEvent(handleId, raw);
			return;
		}
		const scope = eventScope(raw);
		set((state) => {
			if (type === "agent_start" || type === "turn_start") {
				// Fallback clock: a turn pi starts on its own (a scheduled task, an extension
				// prompt) has no user message to take the time from.
				if (!turnStartedAt.has(scope)) turnStartedAt.set(scope, Date.now());
				return { status: "streaming" as const };
			}
			// A settled turn cannot collect any more usage, so whatever clock is still open for this
			// session is stale — an aborted or replaced turn must not time the next one.
			if (type === "agent_settled") {
				turnStartedAt.delete(scope);
				return { status: "idle" as const };
			}
			if (type === "queue_update") {
				return { queue: toQueue(raw) };
			}
			if (type === "compaction_start") {
				return {
					compactionError: undefined,
					compactionStatus: "running" as const,
					isCompacting: true,
					status: "streaming" as const,
				};
			}
			if (type === "compaction_end") {
				const errorMessage = typeof raw.errorMessage === "string" ? raw.errorMessage : undefined;
				return {
					compactionError: errorMessage,
					compactionStatus: errorMessage ? ("error" as const) : ("complete" as const),
					isCompacting: false,
				};
			}
			if (type === "session_info_changed") {
				return { sessionName: typeof raw.name === "string" ? raw.name : undefined };
			}
			if (type === "auto_retry_start") {
				return {
					error: `Retrying after error (${String(raw.attempt)}/${String(raw.maxAttempts)})`,
					status: "streaming" as const,
				};
			}
			if (type === "auto_retry_end" && raw.success === true) {
				return { error: undefined };
			}
			if (type === "auto_retry_end" && typeof raw.finalError === "string") {
				return { error: raw.finalError };
			}
			if (type === "bash_execution_update" && typeof raw.delta === "string") {
				return {
					bashOutput: `${state.bashOutput ?? ""}${raw.delta}`,
					bashRunning: true,
				};
			}
			if (type === "message_start") {
				noteAssistantStart(raw);
				return applyMessageStart({ messages: state.messages, status: state.status }, raw, scope);
			}
			if (type === "message_update") {
				if (firstTokenAt.at === 0 && hasDelta(eventAssistantUpdate(raw))) firstTokenAt.at = Date.now();
				return { ...applyMessageUpdate(state, raw, scope), ...outputTokensPerSecond(raw) };
			}
			if (type === "message_end") {
				return { ...applyMessageEnd(state, raw, scope), ...outputTokensPerSecond(raw) };
			}
			if (type === "tool_execution_start") return applyToolEvent(state, raw, "start", scope);
			if (type === "tool_execution_update") return applyToolEvent(state, raw, "update", scope);
			if (type === "tool_execution_end") return applyToolEvent(state, raw, "end", scope);
			if (type === "thinking_level_changed" && typeof raw.level === "string") {
				return { thinkingLevel: raw.level };
			}
			if (type === "extension_error") {
				return { error: typeof raw.error === "string" ? raw.error : "extension error", status: "error" as const };
			}
			if (type === "extension_ui_request") {
				const request = toExtensionRequest(raw);
				if (request) return { extensionUiRequests: [...state.extensionUiRequests, request] };
				const notification = toNotification(raw);
				if (notification) {
					return { extensionUiNotifications: [...state.extensionUiNotifications, notification] };
				}
				const method = typeof raw.method === "string" ? raw.method : "";
				if (method === "setStatus") {
					const key = typeof raw.statusKey === "string" ? raw.statusKey : "status";
					const next = { ...state.extensionUiStatuses };
					if (typeof raw.statusText === "string") next[key] = raw.statusText;
					else delete next[key];
					return {
						extensionUiStatuses: next,
					};
				}
				if (method === "setWidget") {
					const key = typeof raw.widgetKey === "string" ? raw.widgetKey : "widget";
					const next = { ...state.extensionUiWidgets };
					if (Array.isArray(raw.widgetLines)) {
						next[key] = {
							lines: raw.widgetLines.map(String),
							placement: raw.widgetPlacement === "belowEditor" ? "belowEditor" : "aboveEditor",
						};
					}
					else delete next[key];
					return {
						extensionUiWidgets: next,
					};
				}
				if (method === "setTitle" && typeof raw.title === "string") {
					if (typeof document !== "undefined") document.title = raw.title;
					return {};
				}
				if (method === "set_editor_text" && typeof raw.text === "string") {
					return { composerAppend: false, composerText: raw.text };
				}
				return {};
			}
			return {};
		});
	},
	clearQueue: async () => {
		await rpc({ type: "clear_queue" });
		set({ queue: { followUp: [], steering: [] } });
	},
	removeQueuedMessage: async (kind, index) => {
		return await mutateQueue(kind, index, () => undefined);
	},
	editQueuedMessage: async (kind, index, text) => {
		const trimmed = text.trim();
		if (!trimmed) return false;
		return await mutateQueue(kind, index, () => trimmed);
	},
	/**
	 * Take one queued message back out of the queue and stage it in the composer.
	 *
	 * This is the only way to *edit* a queued message: pi delivers a queued message verbatim, and
	 * rewriting it in place would send text the user never got to read. The queue is changed first
	 * and the text is only staged once it really left the queue — a row the running turn already
	 * picked up must not also appear in the composer. A message already in the composer is kept and
	 * the recalled one is appended, so recalling two rows cannot silently drop the first; the
	 * counter is what makes a second recall of the same text take effect.
	 */
	recallQueuedMessage: async (kind, index) => {
		const { queue } = get();
		const text = queue[kind][index];
		if (text === undefined) return false;
		if (!(await mutateQueue(kind, index, () => undefined))) return false;
		// Appended into the box, not swapped in for it: composerText only knows the last staged
		// text, so replacing here would erase whatever the user typed since then.
		set((state) => ({ composerAppend: true, composerText: text, recallId: state.recallId + 1 }));
		return true;
	},
	steerQueuedMessage: async (kind, index) => {
		return await mutateQueue(kind, index, (text) => text, true);
	},
	steerAllQueued: async () => {
		const cleared = await rpc<QueueState>({ type: "clear_queue" });
		if (!cleared) return;
		// FIFO: steering messages were queued for the running turn first, follow-ups after it.
		// A mid-requeue failure already staged what was left into the composer; still say so.
		try {
			await requeueQueue([...(cleared.steering ?? []), ...(cleared.followUp ?? [])], []);
		} catch (error) {
			pushNotification(
				t("插话失败：{arg}（未送达的消息已放回输入框）", { "arg": error instanceof Error ? error.message : String(error) }),
				"error",
			);
		}
	},
	cloneSession: async () => {
		await rpc({ type: "clone" });
		await get().refreshSession();
		await get().loadSessions();
		await get().loadForkMessages();
		// The copy carries the same transcript and the same derived title, so the only sign that
		// anything happened is this notice: the session list now holds two identical rows.
		pushNotification(t("已复制到新会话，原会话仍在列表中"));
	},
	compact: async (customInstructions) => {
		set({ compactionError: undefined, compactionStatus: "running", status: "streaming" });
		try {
			await rpc({ customInstructions, type: "compact" });
			set({ compactionStatus: "complete", status: "idle" });
			await get().loadSessionStats();
		} catch (error) {
			set({
				compactionError: error instanceof Error ? error.message : String(error),
				compactionStatus: "error",
				status: "idle",
			});
		}
	},
	cycleModel: async () => {
		const result = await rpc<{ model?: { id?: string }; thinkingLevel?: string } | null>({ type: "cycle_model" });
		if (!result?.model?.id) return;
		set({ model: result.model.id, thinkingLevel: result.thinkingLevel });
	},
	cycleThinkingLevel: async () => {
		const result = await rpc<{ level?: string } | null>({ type: "cycle_thinking_level" });
		if (result?.level) set({ thinkingLevel: result.level });
	},
	exportHtml: async (outputPath) => {
		const result = await rpc<{ path?: string }>({ outputPath, type: "export_html" });
		return result?.path;
	},
	applyPermissionMode: async (mode) => {
		if (!hasWorkspaceForPrompt(get())) {
			pushNotification(t("请先选择工作区，再开始会话。"), "warning");
			return false;
		}
		// Extensions load with pi, so the renderer's cached command list can predate a runtime
		// restart; re-reading it is what makes this check tell the truth.
		await get().loadCommands();
		// pi has no sandbox of its own; the `permission-gate` extension decides what a tool call may
		// do, and it is the only thing that can, so say so instead of pretending the chip switched
		// something on its own.
		if (!get().commands.some((command) => command.name === "permission")) {
			pushNotification(t("权限模式需要 pi 的 permission-gate 扩展，重启运行时后可用。"), "warning");
			return false;
		}
		await rpc({ message: `/permission ${mode}`, type: "prompt" });
		return true;
	},
	fork: async (entryId) => {
		await rpc({ entryId, type: "fork" });
		await get().refreshSession();
		await get().loadSessions();
		await get().loadForkMessages();
	},
	editAndResend: async (entryId, text) => {
		// Without the extension, pi would take `/session-edit` for a normal prompt and ask the
		// model about it; better to say why nothing happened.
		if (!get().commands.some((command) => command.name === "session-edit")) {
			pushNotification(t("编辑需要 pi 的 session-edit 扩展，重启 π7 后可用。"), "warning");
			return false;
		}
		// pi can only move the branch while nothing is streaming, and a rewind that silently did
		// not happen would stack the edit on top of the old branch instead of replacing it.
		if (get().status === "streaming") {
			pushNotification(t("正在回答中，等这一轮结束后再编辑这条消息。"), "warning");
			return false;
		}
		// The renderer's own count only moves when a snapshot is read, so a session used in this
		// run carries a stale one; the comparison below has to start from what pi reports now.
		const before = await rpc<SessionSnapshot>({ type: "get_state" })
			.then((snapshot) => snapshot?.messageCount)
			.catch(() => undefined);
		// pi exposes no RPC command for tree navigation; the `session-edit` extension does the move
		// with ctx.navigateTree. The command is awaited to completion before this resolves, so the
		// re-read below sees the rewound branch.
		await rpc({ message: `/session-edit ${entryId}`, type: "prompt" });
		await get().refreshSession();
		if (typeof before !== "number" || get().messageCount >= before) {
			pushNotification(t("没能回到这条消息，未发送。"), "error");
			// The branch may still have moved, so the edit goes back to the composer instead of
			// disappearing with the row the user typed it in.
			set({ composerAppend: false, composerText: text });
			return false;
		}
		// The extension drops the old prompt into the composer; this flow keeps the edit inline,
		// so the composer must not keep a second copy of the text that was just resent.
		set({ composerAppend: false, composerText: "" });
		try {
			await get().send(text);
		} catch {
			// `send` already reported why; hand the edit back rather than dropping it.
			set({ composerAppend: false, composerText: text });
			return false;
		}
		return true;
	},
	followUp: async (text, images) => {
		await rpc({ images: toImageContent(images), message: text, type: "follow_up" });
	},
	initialize: async () => {
		set({ connectionError: undefined, status: "starting" });
		await window.pi.start();
		await get().negotiateCapabilities();
		await get().refreshSession();
		// The sidebar readout and the context ring both read these; a freshly loaded page has
		// nothing to show until they are fetched once.
		await Promise.all([
			get().loadSessionStats().catch(() => {}),
			// Fork points are the entry ids behind the transcript's copy/edit actions.
			get().loadForkMessages().catch(() => {}),
		]);
		// Single-session runtimes report their one working directory here rather than per handle.
		if (!get().sessionCwd) {
			const info = (await window.pi.getRuntimeInfo().catch(() => undefined)) as { cwd?: string } | undefined;
			if (info?.cwd) set({ sessionCwd: info.cwd });
		}
		// Single-session cwd is only known after the runtime info call above; load project-scoped
		// data afterwards so a stale/undefined cwd cannot select the wrong listing.
		await get().loadFiles().catch(() => {});
		await get().loadModels();
		const levels = await rpc<{ levels?: string[] }>({ type: "get_available_thinking_levels" });
		if (Array.isArray(levels?.levels)) set({ availableThinkingLevels: levels.levels });
		await Promise.all([get().loadSessions(), get().loadCommands(), get().loadFiles(), get().loadPackages()]);
	},
	// Capability handshake. Everything multi-session stays inert unless the runtime answers
	// that it can hold several sessions, so an unpatched pi keeps today's single-session flow.
	negotiateCapabilities: async () => {
		let capabilities: RpcCapabilities | undefined;
		try {
			capabilities = await rpc<RpcCapabilities>({ type: "get_capabilities" });
		} catch {
			// Runtimes without the patch answer `get_capabilities` with an unknown-command error.
			capabilities = undefined;
		}
		if (capabilities?.multiSession !== true) {
			// A reconnect can ask again, but the warning is about the runtime, not the attempt.
			const warn = !missingPatchWarned;
			missingPatchWarned = true;
			set((state) => ({
				activeHandleId: undefined,
				backgroundSessions: {},
				extensionUiNotifications: warn
					? [
							...state.extensionUiNotifications,
							{ id: MISSING_PATCH_NOTIFICATION_ID, message: MISSING_PATCH_MESSAGE, type: "warning" },
						]
					: state.extensionUiNotifications,
				handles: {},
				extensionUiRequests: [],
				extensionUiStatuses: {},
				extensionUiWidgets: {},
				multiSession: false,
			}));
			return;
		}
		const open = await rpc<OpenSessionsSnapshot>({ type: "get_open_sessions" });
		const sessions = open?.sessions ?? [];
		const handles: Record<string, string> = {};
		for (const session of sessions) {
			if (session.sessionId && session.sessionFile) handles[sessionMapKey(session.sessionFile)] = session.sessionId;
		}
		// The handle pi opened for itself has no slice yet: it is the visible session, so the
		// flat fields are the ones that describe it.
		set({
			activeHandleId: open?.activeSessionId ?? sessions[0]?.sessionId,
			backgroundSessions: {},
			handles,
			multiSession: true,
			// The visible handle's own folder: the process cwd means nothing to a session switch.
			sessionCwd: sessions.find((session) => session.sessionId === (open?.activeSessionId ?? sessions[0]?.sessionId))
				?.cwd,
		});
	},
	loadModels: async () => {
		const models = await rpc<{ models?: ModelInfo[] }>({ type: "get_available_models" }).catch(() => undefined);
		// modelsLoaded matters separately from the list itself: the onboarding banner and the
		// composer's no-model gate only apply once "empty" is known to mean "nothing configured".
		set({ modelsLoaded: true });
		if (Array.isArray(models?.models)) set({ models: models.models });
	},
	loadCommands: async () => {
		const generation = ++commandLoadGeneration;
		const handleId = get().activeHandleId;
		let commands: SlashCommand[] = [];
		for (let attempt = 0; attempt < 4; attempt += 1) {
			const response = await rpc<{ commands?: SlashCommand[] }>({ type: "get_commands" });
			commands = Array.isArray(response?.commands) ? response.commands : [];
			if (commands.length > 0) break;
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
		if (generation === commandLoadGeneration && get().activeHandleId === handleId) set({ commands });
	},
	loadFiles: async () => {
		// The panel lists the folder the visible session works in; the main process reports which
		// root it actually walked so previews resolve against the very same one.
		const generation = ++fileLoadGeneration;
		const current = get();
		const handleId = current.activeHandleId;
		const cwd = current.sessionCwd;
		if (!cwd || isUnboundNewSession(current)) {
			set({ files: [], filesRoot: undefined });
			return;
		}
		const result = (await window.pi.listFiles(cwd)) as
			| { files?: unknown[]; root?: string }
			| undefined;
		if (generation !== fileLoadGeneration || get().activeHandleId !== handleId || get().sessionCwd !== cwd) return;
		set({
			files: Array.isArray(result?.files) ? result.files.map(String) : [],
			filesRoot: result?.root,
		});
	},
	loadEntries: async () => {
		const entries = await rpc<{ entries?: SessionEntryRecord[] }>({ type: "get_entries" });
		set({ sessionEntries: Array.isArray(entries?.entries) ? entries.entries : [] });
	},
	loadForkMessages: async () => {
		const generation = ++forkLoadGeneration;
		const handleId = get().activeHandleId;
		const messages = await rpc<{ messages?: ForkMessage[] }>({ type: "get_fork_messages" });
		if (generation === forkLoadGeneration && get().activeHandleId === handleId) {
			set({ forkMessages: Array.isArray(messages?.messages) ? messages.messages : [] });
		}
	},
	loadLastAssistantText: async () => {
		const result = await rpc<{ text?: string | null }>({ type: "get_last_assistant_text" });
		set({ lastAssistantText: result?.text ?? undefined });
	},
	loadPackages: async () => {
		const packages = (await window.pi.listPackages()) as PackageSources | undefined;
		set({
			packages: {
				global: Array.isArray(packages?.global) ? packages.global : [],
				project: Array.isArray(packages?.project) ? packages.project : [],
			},
		});
	},
	loadSessionStats: async () => {
		const generation = ++statsLoadGeneration;
		const handleId = get().activeHandleId;
		const stats = await rpc<SessionStats>({ type: "get_session_stats" });
		if (generation === statsLoadGeneration && get().activeHandleId === handleId) set({ sessionStats: stats });
	},
	loadTree: async () => {
		const tree = await rpc<{ tree?: SessionTreeNode[] }>({ type: "get_tree" });
		set({ sessionTree: Array.isArray(tree?.tree) ? tree.tree : [] });
	},
	newSession: async (parentSession) => {
		// A new chat on the same handle keeps running in the folder the visible session used, so the
		// project chip stays bound. Only a session with a transcript proves the folder was chosen:
		// the untouched first session of a run still shows 选择项目 until the user picks one.
		const inheritedProject = get().sessionProject ?? (get().messageCount > 0 ? get().sessionCwd : undefined);
		const result = await rpc<{ cancelled?: boolean }>({ parentSession, type: "new_session" });
		if (result?.cancelled) return;
		// The handle survives with a new pi session behind it; refreshSession re-keys the path map
		// from the get_state it already runs.
		await get().refreshSession();
		await get().loadSessions();
		// refreshSession clears the pick while it adopts the empty session, so the carry-over lands
		// after it rather than before.
		outputMeter.startedAt = 0;
		set({ outputTokensPerSecond: undefined });
		if (inheritedProject) set({ sessionProject: inheritedProject });
	},
	// A project is a folder, not a flag: pi runs the session's tools in the cwd its runtime was
	// opened with, so a session in another project is a second handle rather than a rename.
	newSessionIn: async (cwd) => {
		if (!cwd || !get().multiSession) {
			// Without the patch there is one runtime, so the project has to become the process
			// workspace first — a restart — and the new session is created in that process.
			if (cwd) {
				const info = (await window.pi.getRuntimeInfo()) as { cwd?: string } | undefined;
				if (info?.cwd !== cwd) {
					await window.pi.setWorkspaceCwd(cwd);
					await get().reconnect({ keepSession: true });
				}
			}
			await get().newSession();
			return;
		}
		// The handle on screen already runs in this project, so the new session belongs behind it:
		// reusing that handle is what stops a run of 新对话 clicks from stacking up empty handles.
		const activeHandleId = get().activeHandleId;
		const open = await rpc<OpenSessionsSnapshot>({ type: "get_open_sessions" });
		const activeCwd = open?.sessions?.find((session) => session.sessionId === activeHandleId)?.cwd;
		if (activeCwd !== undefined && sessionMapKey(activeCwd) === sessionMapKey(cwd)) {
			await get().newSession();
			return;
		}
		const previousStatus = get().status;
		set({ sessionLoading: true, status: "starting" });
		let opened: OpenSessionData | undefined;
		try {
			opened = await rpc<OpenSessionData>({ type: "open_session", activate: true, cwd });
		} catch (error) {
			set({ sessionLoading: false, status: previousStatus });
			throw error;
		}
		if (!opened?.sessionId) {
			set({ sessionLoading: false, status: previousStatus });
			return;
		}
		const handleId = opened.sessionId;
		set((state) => ({
			...projectHandle(state, handleId),
			handleOrder: [handleId, ...state.handleOrder.filter((id) => id !== handleId)],
			sessionCwd: opened?.cwd ?? state.sessionCwd,
			// An explicit folder choice for a session that has not started yet.
			sessionProject: cwd,
		}));
		await get().refreshSession();
		await get().loadSessionStats().catch(() => {});
		await get().loadSessions();
		get().enforceSessionPool();
	},
	reconnect: async (options) => {
		// Remembered before the restart: a restarted process comes up on a fresh session, and in
		// multi-session mode the one the user was looking at can be opened again right away.
		const previousSessionFile = get().sessionFile;
		set({ connectionError: undefined, error: undefined, status: "starting" });
		try {
			await window.pi.restart();
			// Every handle died with the old process: drop the maps rather than leave the
			// renderer addressing handles that no longer exist.
			set({
				activeHandleId: undefined,
				backgroundSessions: {},
				extensionUiRequests: [],
				extensionUiStatuses: {},
				extensionUiWidgets: {},
				handles: {},
				sessionLoading: true,
			});
			if (get().multiSession) await get().negotiateCapabilities();
			// keepSession: the caller switches to a session itself right after (workspace switch).
			if (!options?.keepSession) await restoreVisibleSession(get, previousSessionFile);
			await Promise.all([get().loadSessions(), get().loadCommands(), get().loadFiles(), get().loadPackages()]);
			// A restart re-reads models.json, so the catalog can change here (e.g. the first provider
			// was just added in settings); without this the no-model state would linger.
			await get().loadModels();
		} catch (error) {
			set({
				connectionError: error instanceof Error ? error.message : String(error),
				sessionLoading: false,
				status: "error",
			});
		}
	},
	refreshSession: async () => {
		const generation = ++refreshGeneration;
		const handleId = get().activeHandleId;
		assistantMessageIds.delete(handleId ?? "");
		turnStartedAt.delete(handleId ?? "");
		const state = await rpc<SessionSnapshot>({ type: "get_state" });
		const messages = await rpc<{ messages?: unknown[] }>({ type: "get_messages" });
		// The user may have switched sessions while these reads were in flight; a stale answer
		// must not be pasted over the session now on screen.
		if (generation !== refreshGeneration || get().activeHandleId !== handleId) return;
		// pi's answer about the run is the authority the transcript's own marks are corrected
		// against. The marks are renderer state and outlive a turn whose end this window missed, so
		// an idle session must not keep a row that says it is still streaming.
		const fields = snapshotFields(state);
		set((current) => ({
			...fields,
			messages: settleDanglingStreams(current.messages, fields.status),
		}));
		if (handleId) set((current) => ({ handles: rekeyHandles(current.handles, handleId, state?.sessionFile) }));
		if (Array.isArray(messages?.messages)) get().loadMessages(messages.messages);
		// The command list is extension-derived and every session loads its own extensions, so a
		// session swap can change it. Fire-and-forget: it retries briefly while pi warms up.
		void get().loadCommands().catch(() => {});
	},
	// Re-read only the session-scoped metadata. A visible session that came from a slice already
	// has a current transcript, so reading its messages again would only race the live stream.
	syncVisibleSession: async () => {
		const handleId = get().activeHandleId;
		if (!get().multiSession) return;
		const [state, stats, forks] = await Promise.all([
			rpc<SessionSnapshot>({ type: "get_state" }),
			// Stats feed the context readout and auto-compaction, so they have to belong to the
			// session now on screen. A failure here must not break the switch itself.
			rpc<SessionStats>({ type: "get_session_stats" }).catch(() => undefined),
			// Fork points are what turn a transcript row into an editable branch, so they follow
			// the session just like its stats do.
			rpc<{ messages?: ForkMessage[] }>({ type: "get_fork_messages" }).catch(() => undefined),
		]);
		if (get().activeHandleId !== handleId) return;
		const fields = snapshotFields(state);
		set((current) => ({
			...fields,
			...(forks?.messages ? { forkMessages: forks.messages } : {}),
			// Coming back to a session is exactly when a turn can have ended unwatched, so the marks
			// on the rows are corrected against what pi says about the run now.
			messages: settleDanglingStreams(current.messages, fields.status),
			sessionStats: stats,
		}));
		// The task list follows the project, and a switch can land in another one. The file panel's
		// listing does too, and so does the slash-command list: it is built from the session's
		// own extensions.
		await Promise.all([get().loadFiles().catch(() => {}), get().loadCommands().catch(() => {})]);
	},
	// A session created moments ago is missing from the sidebar until the list is re-read, and
	// multi-session switches no longer run the session listing that used to refresh it. Only
	// lists when the visible session is genuinely absent, so a settled turn costs nothing.
	syncSessionList: async () => {
		const { loadSessions, sessionId, sessions } = get();
		if (sessionId && sessions.some((session) => session.id === sessionId)) return;
		await loadSessions();
	},
	// Show the session at `sessionPath`, opening a handle for it when none exists yet. pi runs
	// tools in the session's own cwd, so a plain session switch never restarts the process: the
	// outgoing session keeps its handle and keeps streaming while the user looks elsewhere.
	showSession: async (sessionPath) => {
		if (typeof sessionPath !== "string" || !sessionPath) {
			throw new Error("showSession requires a session path");
		}
		const previousHandleId = get().activeHandleId;
		let handleId = get().handles[sessionMapKey(sessionPath)];
		let openedCwd: string | undefined;
		if (!handleId) {
			const previousStatus = get().status;
			set({ sessionLoading: true, status: "starting" });
			let opened: OpenSessionData | undefined;
			try {
				// activate: the visible session is also pi's active handle, which keeps untagged
				// commands and extension-driven session switches pointing at what the user sees.
				opened = await rpc<OpenSessionData>({ type: "open_session", activate: true, sessionPath });
			} catch (error) {
				// Nothing was switched, so put the visible session back the way it was.
				set({ sessionLoading: false, status: previousStatus });
				throw error;
			}
			if (!opened?.sessionId) {
				set({ sessionLoading: false, status: previousStatus });
				return;
			}
			handleId = opened.sessionId;
			openedCwd = opened.cwd;
			set((state) => ({
				handles: registerHandle(state.handles, opened),
			}));
		}
		// Take the slice as it is now: projectHandle below overwrites it with the stashed state.
		const slice = get().backgroundSessions[handleId];
		set((state) => ({
			...projectHandle(state, handleId),
			// Most-recently-used first: the pool cap evicts from the other end.
			handleOrder: [handleId, ...state.handleOrder.filter((id) => id !== handleId)],
			// projectHandle clears sessionCwd for a handle it has no slice for; the open reply
			// names the session's folder and must land after the spread or it is lost.
			...(openedCwd !== undefined ? { sessionCwd: openedCwd } : {}),
		}));
		// A newer click can take over while open_session is in flight; that one owns the screen.
		if (get().activeHandleId !== handleId) return;
		const sameHandle = handleId === previousHandleId;
		// A slice that received that handle's events all along is current. Everything else is a
		// session that still has to be read: just opened, or a click on the session already on
		// screen while its own transcript was still loading.
		const current = sameHandle ? !get().sessionLoading : slice?.loaded === true;
		if (current) await get().syncVisibleSession();
		else {
			await get().refreshSession();
			await Promise.all([
				get().loadSessionStats().catch(() => {}),
				get().loadForkMessages().catch(() => {}),
				// A switch can land in another project, which has its own file tree.
				get().loadFiles().catch(() => {}),
			]);
		}
		get().enforceSessionPool();
	},
	reset: () => {
		assistantMessageIds.clear();
		turnStartedAt.clear();
		fileLoadGeneration += 1;
		commandLoadGeneration += 1;
		statsLoadGeneration += 1;
		forkLoadGeneration += 1;
		refreshGeneration += 1;
		set({ ...initialState, status: "idle" });
	},
	respondExtensionUi: async (response) => {
		await window.pi.extensionUiResponse(response);
		const id = typeof response.id === "string" ? response.id : undefined;
		if (!id) return;
		set((state) => ({
			extensionUiRequests: state.extensionUiRequests.filter((request) => request.id !== id),
		}));
	},
	runBash: async (command, excludeFromContext) => {
		const trimmed = command.trim();
		if (!trimmed) return;
		set({ bashOutput: "", bashRunning: true, error: undefined });
		try {
			const result = await rpc<{ cancelled?: boolean; exitCode?: number; output?: string; truncated?: boolean }>({
				command: trimmed,
				excludeFromContext,
				type: "bash",
			});
			set({ bashOutput: result?.output ?? "", bashRunning: false });
		} catch (error) {
			set({
				bashOutput: error instanceof Error ? error.message : String(error),
				bashRunning: false,
			});
		}
	},
	installPackage: async (source, local) => {
		const result = (await window.pi.installPackage(source, local)) as { code?: number; stderr?: string; stdout?: string };
		await get().loadPackages();
		if (result?.code !== 0) throw new Error(result?.stderr || result?.stdout || `Install failed (${result?.code})`);
		return result?.stdout ?? "";
	},
	removePackage: async (source, local) => {
		const result = (await window.pi.removePackage(source, local)) as { code?: number; stderr?: string; stdout?: string };
		await get().loadPackages();
		if (result?.code !== 0) throw new Error(result?.stderr || result?.stdout || `Remove failed (${result?.code})`);
		return result?.stdout ?? "";
	},
	updatePackages: async () => {
		const result = (await window.pi.updatePackages()) as { code?: number; stderr?: string; stdout?: string };
		await get().loadPackages();
		if (result?.code !== 0) throw new Error(result?.stderr || result?.stdout || `Update failed (${result?.code})`);
		return result?.stdout ?? "";
	},
	send: async (text, streamingBehavior, images, sessionId) => {
		const trimmed = text.trim();
		if (!trimmed && (!images || images.length === 0)) return { started: false };
		const targetBackground =
			sessionId !== undefined && get().multiSession && sessionId !== get().activeHandleId;
		// The workspace check guards the visible session; a background handle already has its own cwd.
		if (!targetBackground && !hasWorkspaceForPrompt(get())) {
			const message = t("请先选择工作区，再开始会话。");
			set({ error: message, status: "idle" });
			pushNotification(message, "warning");
			throw new Error(message);
		}
		if (!targetBackground) set({ error: undefined, status: "streaming" });
		let started: boolean | undefined;
		try {
			const result = await rpc<{ started?: boolean }>({
				images: toImageContent(images),
				message: trimmed,
				streamingBehavior: streamingBehavior ?? "followUp",
				type: "prompt",
				...(sessionId !== undefined ? { sessionId } : {}),
			});
			started = result?.started;
		} catch (error) {
			// A prompt pi refuses never starts a turn: leaving the status at "streaming" would keep
			// the composer in stop mode for good, and the caller needs to know the send failed.
			const message = error instanceof Error ? error.message : String(error);
			if (!targetBackground) set({ error: message, status: "idle" });
			pushNotification(t("发送失败：{message}", { "message": message }), "error");
			throw error;
		}
		// Extension slash commands handle the prompt without starting an agent turn, so an
		// optimistic "streaming" status can be wrong for one. A normal prompt is never reconciled:
		// right after pi accepts it the run has not started yet, and `get_state` would report
		// isStreaming false exactly then, clearing the status while the turn is on its way.
		// A background send never gets the optimistic mark, so there is nothing to reconcile.
		if (targetBackground || !trimmed.startsWith("/")) return { started };
		try {
			await new Promise((resolve) => setTimeout(resolve, 400));
			const state = await rpc<{ isStreaming?: boolean }>({ type: "get_state" });
			if (state?.isStreaming === false) set({ status: "idle" });
		} catch {}
		return { started };
	},
	setAutoCompaction: async (enabled) => {
		await rpc({ enabled, type: "set_auto_compaction" });
		set({ autoCompactionEnabled: enabled });
	},
	setAutoRetry: async (enabled) => {
		await rpc({ enabled, type: "set_auto_retry" });
		set({ autoRetryEnabled: enabled });
	},
	setFollowUpMode: async (mode) => {
		await rpc({ mode, type: "set_follow_up_mode" });
		set({ followUpMode: mode });
	},
	setSessionName: async (name) => {
		const trimmed = name.trim();
		if (!trimmed) return;
		await rpc({ name: trimmed, type: "set_session_name" });
		set({ sessionName: trimmed });
		await get().loadSessions();
	},
	setModel: async (provider, modelId, sessionId) => {
		await rpc({ modelId, provider, sessionId, type: "set_model" });
		// Thinking levels are per model; pi clamps the level and emits thinking_level_changed.
		const levels = await rpc<{ levels?: string[] }>({ sessionId, type: "get_available_thinking_levels" });
		// A call scoped to a background session must not relabel the session on screen.
		if (sessionId !== undefined && sessionId !== get().activeHandleId) return;
		set({ model: modelId });
		if (Array.isArray(levels?.levels)) set({ availableThinkingLevels: levels.levels });
	},
	setSteeringMode: async (mode) => {
		await rpc({ mode, type: "set_steering_mode" });
		set({ steeringMode: mode });
	},
	setThinkingLevel: async (level, sessionId) => {
		await rpc({ level, sessionId, type: "set_thinking_level" });
		if (sessionId !== undefined && sessionId !== get().activeHandleId) return;
		set({ thinkingLevel: level });
	},
	setStderr: (text) => set({ lastStderr: text }),
	steer: async (text, images) => {
		await rpc({ images: toImageContent(images), message: text, type: "steer" });
	},
	switchSession: async (sessionPath) => {
		let result: { cancelled?: boolean } | undefined;
		try {
			result = await rpc<{ cancelled?: boolean }>({ sessionPath, type: "switch_session" });
		} catch (error) {
			await Promise.all([
				get().loadFiles().catch(() => {}),
				get().loadSessionStats().catch(() => {}),
				get().loadForkMessages().catch(() => {}),
			]);
			throw error;
		}
		if (result?.cancelled) {
			// The optimistic switch did not happen, so put the real session back on screen.
			await get().refreshSession();
			await Promise.all([
				get().loadFiles().catch(() => {}),
				get().loadSessionStats().catch(() => {}),
				get().loadForkMessages().catch(() => {}),
			]);
			return;
		}
		await get().refreshSession();
		await Promise.all([
			get().loadSessions(),
			get().loadFiles().catch(() => {}),
			get().loadSessionStats().catch(() => {}),
			get().loadForkMessages().catch(() => {}),
		]);
	},
}));
