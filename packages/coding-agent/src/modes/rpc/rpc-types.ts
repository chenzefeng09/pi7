/**
 * RPC protocol types for headless operation.
 *
 * Commands are sent as JSON lines on stdin.
 * Responses and events are emitted as JSON lines on stdout.
 */

import type { AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ImageContent, Model } from "@earendil-works/pi-ai";
import type { SessionStats } from "../../core/agent-session.ts";
import type { BashResult } from "../../core/bash-executor.ts";
import type { CompactionResult } from "../../core/compaction/index.ts";
import type { SessionEntry, SessionTreeNode } from "../../core/session-manager.ts";
import type { SourceInfo } from "../../core/source-info.ts";
import type { JsonAgentSessionEvent } from "../json-event.ts";

/** Bumped when the RPC protocol gains commands a client must know about. */
export const RPC_PROTOCOL_VERSION = 2;

/**
 * Addresses one session runtime instead of the active one.
 *
 * `sessionId` is the handle id returned by `open_session`, not the pi session id: a handle
 * keeps its id when it switches to another session file (`new_session`, `switch_session`).
 * Omit it to target the active session, which is what single-session clients do.
 */
export interface RpcSessionTarget {
	sessionId?: string;
}

// ============================================================================
// RPC Commands (stdin)
// ============================================================================

export type RpcCommand = RpcSessionTarget &
	// Prompting
	(
		| {
				id?: string;
				type: "prompt";
				message: string;
				images?: ImageContent[];
				streamingBehavior?: "steer" | "followUp";
		  }
		| { id?: string; type: "steer"; message: string; images?: ImageContent[] }
		| { id?: string; type: "follow_up"; message: string; images?: ImageContent[] }
		| { id?: string; type: "abort" }
		| { id?: string; type: "clear_queue" }
		| { id?: string; type: "new_session"; parentSession?: string }

		// State
		| { id?: string; type: "get_state" }

		// Model
		| { id?: string; type: "set_model"; provider: string; modelId: string }
		| { id?: string; type: "cycle_model" }
		| { id?: string; type: "get_available_models" }

		// Thinking
		| { id?: string; type: "set_thinking_level"; level: ThinkingLevel }
		| { id?: string; type: "cycle_thinking_level" }
		| { id?: string; type: "get_available_thinking_levels" }

		// Queue modes
		| { id?: string; type: "set_steering_mode"; mode: "all" | "one-at-a-time" }
		| { id?: string; type: "set_follow_up_mode"; mode: "all" | "one-at-a-time" }

		// Compaction
		| { id?: string; type: "compact"; customInstructions?: string }
		| { id?: string; type: "set_auto_compaction"; enabled: boolean }

		// Retry
		| { id?: string; type: "set_auto_retry"; enabled: boolean }
		| { id?: string; type: "abort_retry" }

		// Bash
		| { id?: string; type: "bash"; command: string; excludeFromContext?: boolean }
		| { id?: string; type: "abort_bash" }

		// Session
		| { id?: string; type: "get_session_stats" }
		| { id?: string; type: "export_html"; outputPath?: string }
		| { id?: string; type: "switch_session"; sessionPath: string }
		| { id?: string; type: "fork"; entryId: string }
		| { id?: string; type: "clone" }
		| { id?: string; type: "get_fork_messages" }
		| { id?: string; type: "get_entries"; since?: string }
		| { id?: string; type: "get_tree" }
		| { id?: string; type: "get_last_assistant_text" }
		| { id?: string; type: "set_session_name"; name: string }

		// Messages
		| { id?: string; type: "get_messages" }

		// Commands (available for invocation via prompt)
		| { id?: string; type: "get_commands" }

		// Multiple sessions in one process
		| { id?: string; type: "get_capabilities" }
		| { id?: string; type: "open_session"; sessionPath?: string; cwd?: string; activate?: boolean }
		| { id?: string; type: "close_session"; sessionId: string }
		| { id?: string; type: "get_open_sessions" }
	);

// ============================================================================
// Multi-session
// ============================================================================

export interface RpcCapabilities {
	/** RPC protocol version; `2` added multi-session commands and session-tagged events. */
	protocolVersion: number;
	/** True when this process can hold several sessions at once via `open_session`. */
	multiSession: boolean;
}

/** One live session runtime inside the RPC process. */
export interface RpcOpenSession {
	/** Handle id used as `sessionId` on later commands; stable for the life of the handle. */
	sessionId: string;
	/** pi session id of the session currently loaded in this handle. */
	piSessionId: string;
	sessionFile?: string;
	cwd: string;
	sessionName?: string;
	isStreaming: boolean;
	messageCount: number;
	/** True for the handle that commands without `sessionId` are routed to. */
	active: boolean;
}

/** An event line as written to stdout: the session event plus the handle it came from. */
export type RpcEventLine = JsonAgentSessionEvent & { sessionId: string };

// ============================================================================
// RPC Slash Command (for get_commands response)
// ============================================================================

/** A command available for invocation via prompt */
export interface RpcSlashCommand {
	/** Command name (without leading slash) */
	name: string;
	/** Human-readable description */
	description?: string;
	/** What kind of command this is */
	source: "extension" | "prompt" | "skill";
	/** Source metadata for the owning resource */
	sourceInfo: SourceInfo;
}

// ============================================================================
// RPC State
// ============================================================================

export interface RpcSessionState {
	model?: Model<any>;
	thinkingLevel: ThinkingLevel;
	isStreaming: boolean;
	isCompacting: boolean;
	steeringMode: "all" | "one-at-a-time";
	followUpMode: "all" | "one-at-a-time";
	sessionFile?: string;
	sessionId: string;
	sessionName?: string;
	/** Effective working directory tools run in for this session. */
	cwd: string;
	autoCompactionEnabled: boolean;
	messageCount: number;
	pendingMessageCount: number;
}

// ============================================================================
// RPC Responses (stdout)
// ============================================================================

// Success responses with data
export type RpcResponse =
	// Prompting (async - events follow)
	| {
			id?: string;
			type: "response";
			command: "prompt";
			success: true;
			/** `started` is true when a fresh agent run (and its agent_settled) follows this response. */
			data?: { started: boolean; sessionId: string };
	  }
	| { id?: string; type: "response"; command: "steer"; success: true }
	| { id?: string; type: "response"; command: "follow_up"; success: true }
	| { id?: string; type: "response"; command: "abort"; success: true }
	| {
			id?: string;
			type: "response";
			command: "clear_queue";
			success: true;
			data: { steering: string[]; followUp: string[] };
	  }
	| { id?: string; type: "response"; command: "new_session"; success: true; data: { cancelled: boolean } }

	// State
	| { id?: string; type: "response"; command: "get_state"; success: true; data: RpcSessionState }

	// Model
	| {
			id?: string;
			type: "response";
			command: "set_model";
			success: true;
			data: Model<any>;
	  }
	| {
			id?: string;
			type: "response";
			command: "cycle_model";
			success: true;
			data: { model: Model<any>; thinkingLevel: ThinkingLevel; isScoped: boolean } | null;
	  }
	| {
			id?: string;
			type: "response";
			command: "get_available_models";
			success: true;
			data: { models: Model<any>[] };
	  }

	// Thinking
	| { id?: string; type: "response"; command: "set_thinking_level"; success: true }
	| {
			id?: string;
			type: "response";
			command: "cycle_thinking_level";
			success: true;
			data: { level: ThinkingLevel } | null;
	  }
	| {
			id?: string;
			type: "response";
			command: "get_available_thinking_levels";
			success: true;
			data: { levels: ThinkingLevel[] };
	  }

	// Queue modes
	| { id?: string; type: "response"; command: "set_steering_mode"; success: true }
	| { id?: string; type: "response"; command: "set_follow_up_mode"; success: true }

	// Compaction
	| { id?: string; type: "response"; command: "compact"; success: true; data: CompactionResult }
	| { id?: string; type: "response"; command: "set_auto_compaction"; success: true }

	// Retry
	| { id?: string; type: "response"; command: "set_auto_retry"; success: true }
	| { id?: string; type: "response"; command: "abort_retry"; success: true }

	// Bash
	| { id?: string; type: "response"; command: "bash"; success: true; data: BashResult }
	| { id?: string; type: "response"; command: "abort_bash"; success: true }

	// Session
	| { id?: string; type: "response"; command: "get_session_stats"; success: true; data: SessionStats }
	| { id?: string; type: "response"; command: "export_html"; success: true; data: { path: string } }
	| { id?: string; type: "response"; command: "switch_session"; success: true; data: { cancelled: boolean } }
	| { id?: string; type: "response"; command: "fork"; success: true; data: { text: string; cancelled: boolean } }
	| { id?: string; type: "response"; command: "clone"; success: true; data: { cancelled: boolean } }
	| {
			id?: string;
			type: "response";
			command: "get_fork_messages";
			success: true;
			data: { messages: Array<{ entryId: string; text: string }> };
	  }
	| {
			id?: string;
			type: "response";
			command: "get_entries";
			success: true;
			data: { entries: SessionEntry[]; leafId: string | null };
	  }
	| {
			id?: string;
			type: "response";
			command: "get_tree";
			success: true;
			data: { tree: SessionTreeNode[]; leafId: string | null };
	  }
	| {
			id?: string;
			type: "response";
			command: "get_last_assistant_text";
			success: true;
			data: { text: string | null };
	  }
	| { id?: string; type: "response"; command: "set_session_name"; success: true }

	// Messages
	| { id?: string; type: "response"; command: "get_messages"; success: true; data: { messages: AgentMessage[] } }

	// Commands
	| {
			id?: string;
			type: "response";
			command: "get_commands";
			success: true;
			data: { commands: RpcSlashCommand[] };
	  }

	// Multiple sessions in one process
	| { id?: string; type: "response"; command: "get_capabilities"; success: true; data: RpcCapabilities }
	| { id?: string; type: "response"; command: "open_session"; success: true; data: RpcOpenSession }
	| {
			id?: string;
			type: "response";
			command: "close_session";
			success: true;
			data: { closed: boolean; activeSessionId: string };
	  }
	| {
			id?: string;
			type: "response";
			command: "get_open_sessions";
			success: true;
			data: { activeSessionId: string; sessions: RpcOpenSession[] };
	  }

	// Error response (any command can fail)
	| { id?: string; type: "response"; command: string; success: false; error: string };

// ============================================================================
// Extension UI Events (stdout)
// ============================================================================

/** Emitted when an extension needs user input */
export type RpcExtensionUIRequest = RpcSessionTarget &
	(
		| {
				type: "extension_ui_request";
				id: string;
				method: "select";
				title: string;
				options: string[];
				timeout?: number;
		  }
		| {
				type: "extension_ui_request";
				id: string;
				method: "confirm";
				title: string;
				message: string;
				timeout?: number;
		  }
		| {
				type: "extension_ui_request";
				id: string;
				method: "input";
				title: string;
				placeholder?: string;
				timeout?: number;
		  }
		| { type: "extension_ui_request"; id: string; method: "editor"; title: string; prefill?: string }
		| {
				type: "extension_ui_request";
				id: string;
				method: "notify";
				message: string;
				notifyType?: "info" | "warning" | "error";
		  }
		| {
				type: "extension_ui_request";
				id: string;
				method: "setStatus";
				statusKey: string;
				statusText: string | undefined;
		  }
		| {
				type: "extension_ui_request";
				id: string;
				method: "setWidget";
				widgetKey: string;
				widgetLines: string[] | undefined;
				widgetPlacement?: "aboveEditor" | "belowEditor";
		  }
		| { type: "extension_ui_request"; id: string; method: "setTitle"; title: string }
		| { type: "extension_ui_request"; id: string; method: "set_editor_text"; text: string }
	);

// ============================================================================
// Extension UI Commands (stdin)
// ============================================================================

/** Response to an extension UI request */
export type RpcExtensionUIResponse =
	| { type: "extension_ui_response"; id: string; value: string }
	| { type: "extension_ui_response"; id: string; confirmed: boolean }
	| { type: "extension_ui_response"; id: string; cancelled: true };

// ============================================================================
// Helper type for extracting command types
// ============================================================================

export type RpcCommandType = RpcCommand["type"];
