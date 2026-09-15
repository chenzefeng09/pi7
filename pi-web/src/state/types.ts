export type MessageRole = "user" | "assistant";

export type BlockState = "streaming" | "complete" | "error" | "aborted";

export interface TextBlock {
	state: BlockState;
	text: string;
	type: "text";
}

export interface ThinkingBlock {
	state: BlockState;
	text: string;
	type: "thinking";
}

export interface ImageBlock {
	data: string;
	mimeType: string;
	type: "image";
}

export interface ToolCallBlock {
	args?: unknown;
	details?: unknown;
	output: string;
	state: "running" | "complete" | "error";
	toolCallId: string;
	toolName: string;
	type: "toolCall";
}

export type MessageBlock = ImageBlock | TextBlock | ThinkingBlock | ToolCallBlock;

export interface ImageAttachment {
	data: string;
	mimeType: string;
	name: string;
}

export interface FileAttachment {
	name: string;
	path: string;
	/**
	 * The file-panel root `path` is relative to, captured when the file was picked. Without it
	 * an attachment left in the composer across a project switch would resolve against the new
	 * session's root and silently send a different file.
	 */
	root?: string;
}

export interface PackageSources {
	global: unknown[];
	project: unknown[];
}

/**
 * Token spend of one provider call, as pi reports it on the assistant message.
 *
 * `total` is the call's whole bill: the prompt it sent (fresh input plus both cache columns) and
 * the tokens it generated. A turn that calls tools several times sums these.
 */
export interface MessageUsage {
	cacheRead: number;
	cacheWrite: number;
	input: number;
	output: number;
	total: number;
}

export interface ChatMessage {
	blocks: MessageBlock[];
	/** Epoch ms the turn settled; a message that answers in several steps keeps the turn's end. */
	completedAt?: number;
	/** Epoch ms the turn this message belongs to began, measured from the prompt. */
	createdAt?: number;
	/** Wall-clock time of the whole turn, known only from the renderer's own event stream. */
	durationMs?: number;
	id: string;
	/** Model that served this step, with its provider, as pi reports them on the message. */
	model?: string;
	provider?: string;
	role: MessageRole;
	state: BlockState;
	/**
	 * Time to first token of the turn in ms: prompt out to the model's first streamed character.
	 * Only the renderer's own clock knows this, so a restored turn has none.
	 */
	ttftMs?: number;
	/** Usage of this one call; absent on restored turns pi no longer reports usage for. */
	usage?: MessageUsage;
}

export interface ExtensionUiRequest {
	id: string;
	message?: string;
	method: string;
	options?: string[];
	placeholder?: string;
	prefill?: string;
	/** Only set for requests from a background session: names it in the dialog title. */
	sessionLabel?: string;
	/** RPC handle that owns the request; used to drop dialogs when that handle closes. */
	sessionId?: string;
	timeout?: number;
	title?: string;
}

export interface ExtensionUiNotification {
	at?: number;
	id: string;
	message: string;
	type?: "info" | "warning" | "error";
}

export interface ExtensionUiWidget {
	lines: string[];
	placement: "aboveEditor" | "belowEditor";
}

export interface ModelInfo {
	id: string;
	name?: string;
	provider: string;
	/** True when the model can think at all; a non-reasoning model only offers `off`. */
	reasoning?: boolean;
	/**
	 * Which thinking levels the model takes, in pi's own terms: a level mapped to `null` is
	 * unsupported, and `xhigh`/`max` count only when the model names them.
	 */
	thinkingLevelMap?: Partial<Record<string, string | null>>;
}

export interface SlashCommand {
	description?: string;
	name: string;
	source: "extension" | "prompt" | "skill";
	sourceInfo?: unknown;
}

export interface QueueState {
	followUp: string[];
	steering: string[];
}

export interface SessionStats {
	contextUsage?: {
		contextWindow: number;
		percent: number | null;
		tokens: number | null;
	};
	cost: number;
	sessionFile?: string;
	sessionId: string;
	tokens: {
		cacheRead: number;
		cacheWrite: number;
		input: number;
		output: number;
		total: number;
	};
	toolCalls: number;
	totalMessages: number;
	userMessages: number;
}

export interface SessionTreeEntry {
	[key: string]: unknown;
	id: string;
	parentId: string | null;
	timestamp: string;
	type: string;
}

export type SessionEntryRecord = Record<string, unknown>;

export interface SessionTreeNode {
	children: SessionTreeNode[];
	entry: SessionTreeEntry;
	label?: string;
	labelTimestamp?: string;
}

export interface ForkMessage {
	entryId: string;
	text: string;
}

export interface SessionInfo {
	cwd?: string;
	firstMessage?: string;
	id: string;
	name?: string;
	path: string;
	updatedAt: string;
}

/** One task of a project's todo list, as the pi-todo extension stores it in `.pi/todo.json`. */
export interface TodoItem {
	assignee?: string | null;
	blockedBy?: string | null;
	id: string;
	priority: "critical" | "high" | "low" | "medium";
	status: "blocked" | "done" | "in-progress" | "pending";
	text: string;
}

export type AppStatus = "idle" | "starting" | "streaming" | "error";

/**
 * Renderer-side copy of one pi session handle the user is not looking at.
 *
 * It holds exactly what putting that session back on screen needs, so switching the visible
 * session is pure renderer work: the flat fields of `PiState` stay the visible session, and
 * this slice is stashed/projected around them. Only a multi-session runtime can fill these
 * in; without the patch the map stays empty.
 */
export interface BackgroundSession {
	/** False while the slice is only a placeholder for a session that is still opening. */
	loaded: boolean;
	messageCount: number;
	messages: ChatMessage[];
	piSessionId?: string;
	queue: QueueState;
	/** Working directory the handle runs tools in; pi reports it per session, not per process. */
	sessionCwd?: string;
	sessionFile?: string;
	sessionName?: string;
	status: AppStatus;
	/** True while the handle streams; drives the sidebar dot. */
	streaming: boolean;
	/** True when the handle produced output the user has not looked at yet. */
	unread: boolean;
}

export interface PiState {
	/** Incremented when the user explicitly aborts a run, so scheduled work can pause. */
	abortGeneration: number;
	/** Handle the flat session fields below belong to; undefined before capabilities are known. */
	activeHandleId?: string;
	autoCompactionEnabled?: boolean;
	autoRetryEnabled?: boolean;
	availableThinkingLevels: string[];
	backgroundSessions: Record<string, BackgroundSession>;
	bashOutput?: string;
	bashRunning: boolean;
	commands: SlashCommand[];
	compactionError?: string;
	compactionStatus: "idle" | "running" | "complete" | "error";
	/** The staged text joins what is already typed instead of replacing it (queue recalls). */
	composerAppend?: boolean;
	composerText?: string;
	connectionError?: string;
	error?: string;
	extensionUiNotifications: ExtensionUiNotification[];
	extensionUiRequests: ExtensionUiRequest[];
	extensionUiStatuses: Record<string, string>;
	extensionUiWidgets: Record<string, ExtensionUiWidget>;
	files: string[];
	/** Directory the file listing was taken from; preview paths resolve against it. */
	filesRoot?: string;
	forkMessages: ForkMessage[];
	/** Session file path -> handle id, so clicking a session reuses the handle that has it. */
	handles: Record<string, string>;
	/** Handle ids, most recently used first; the pool cap evicts from the tail. */
	handleOrder: string[];
	isCompacting: boolean;
	lastStderr?: string;
	lastAssistantText?: string;
	messageCount: number;
	model?: string;
	messages: ChatMessage[];
	models: ModelInfo[];
	/** True once `get_capabilities` reported that pi can hold several sessions at once. */
	multiSession: boolean;
	notificationHistory: ExtensionUiNotification[];
	/** Generated tokens per second of the visible session, measured from real usage. */
	outputTokensPerSecond?: number;
	packages: PackageSources;
	queue: QueueState;
	/**
	 * Bumped whenever text is staged for the composer from outside it (a queued message recalled
	 * for editing, a prompt suggestion). The text alone cannot signal that: staging the same text
	 * twice would be no change at all, and the composer would not pick the second one up.
	 */
	recallId: number;
	sessionEntries: SessionEntryRecord[];
	/** Working directory the visible session runs tools in, as reported by its handle. */
	sessionCwd?: string;
	/**
	 * Project the user picked for the session on screen.
	 *
	 * A new session is unbound: pi creates it in whatever folder its runtime already had, which is
	 * not a choice the user made. The picker therefore stays on 选择项目 until they pick, and this
	 * is what remembers that pick for the session.
	 */
	sessionProject?: string;
	sessionFile?: string;
	sessions: SessionInfo[];
	sessionId?: string;
	sessionLoading: boolean;
	sessionName?: string;
	sessionStats?: SessionStats;
	sessionTree: SessionTreeNode[];
	steeringMode: "all" | "one-at-a-time";
	followUpMode: "all" | "one-at-a-time";
	status: AppStatus;
	thinkingLevel?: string;
	/** The visible project's task list, read from its `.pi/todo.json`. */
	todos: TodoItem[];
	/** Root directory from which the current todo list was read. */
	todosCwd?: string;
}
