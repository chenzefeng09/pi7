/**
 * RPC mode: Headless operation with JSON stdin/stdout protocol.
 *
 * Used for embedding the agent in other applications.
 * Receives commands as JSON on stdin, outputs events and responses as JSON on stdout.
 *
 * Protocol:
 * - Commands: JSON objects with `type` field, optional `id` for correlation
 * - Responses: JSON objects with `type: "response"`, `command`, `success`, and optional `data`/`error`
 * - Events: AgentSessionEvent objects streamed as they occur
 * - Extension UI: Extension UI requests are emitted, client responds with extension_ui_response
 */

import * as crypto from "node:crypto";
import { resolve as resolvePath } from "node:path";
import type { AgentSession } from "../../core/agent-session.ts";
import type { AgentSessionRuntime } from "../../core/agent-session-runtime.ts";
import type {
	ExtensionUIContext,
	ExtensionUIDialogOptions,
	ExtensionWidgetOptions,
	WorkingIndicatorOptions,
} from "../../core/extensions/index.ts";
import { clearExtensionCache } from "../../core/extensions/index.ts";
import {
	flushRawStdout,
	takeOverStdout,
	waitForRawStdoutBackpressure,
	writeRawStdout,
} from "../../core/output-guard.ts";
import { killTrackedDetachedChildren } from "../../utils/shell.ts";
import { type Theme, theme } from "../interactive/theme/theme.ts";
import { toJsonEvent } from "../json-event.ts";
import { RpcCommandScheduler } from "./command-scheduler.ts";
import { attachJsonlLineReader, serializeJsonLine } from "./jsonl.ts";
import type {
	RpcCapabilities,
	RpcCommand,
	RpcExtensionUIRequest,
	RpcExtensionUIResponse,
	RpcOpenSession,
	RpcResponse,
	RpcSessionState,
	RpcSlashCommand,
} from "./rpc-types.ts";
import { RPC_PROTOCOL_VERSION } from "./rpc-types.ts";

// Re-export types for consumers
export type {
	RpcCapabilities,
	RpcCommand,
	RpcExtensionUIRequest,
	RpcExtensionUIResponse,
	RpcOpenSession,
	RpcResponse,
	RpcSessionState,
} from "./rpc-types.ts";

/**
 * One live session runtime owned by this process.
 *
 * A handle keeps its id for its whole life even when the session it holds is replaced
 * (`new_session`, `switch_session`), so a host can keep addressing a background session.
 */
interface RpcSessionHandle {
	runtime: AgentSessionRuntime;
	session: AgentSession;
	unsubscribe?: () => void;
	unsubscribeBackpressure?: () => void;
}

/**
 * Run in RPC mode.
 * Listens for JSON commands on stdin, outputs events and responses on stdout.
 *
 * The process can hold several sessions at once (`open_session`): each one streams
 * independently and every event line carries the `sessionId` of the handle it came from.
 * Commands without a `sessionId` address the active handle, which is what single-session
 * clients have always done.
 */
export async function runRpcMode(runtimeHost: AgentSessionRuntime): Promise<never> {
	takeOverStdout();
	const handles = new Map<string, RpcSessionHandle>();
	/** In-flight `open_session` calls, so two opens of one file share a single runtime. */
	const pendingOpens = new Map<string, Promise<string>>();
	const INITIAL_HANDLE_ID = "s1";
	let activeHandleId = INITIAL_HANDLE_ID;
	let nextHandleId = 2;

	const output = (obj: RpcResponse | RpcExtensionUIRequest | object) => {
		writeRawStdout(serializeJsonLine(obj));
	};

	const success = <T extends RpcCommand["type"]>(
		id: string | undefined,
		command: T,
		data?: object | null,
	): RpcResponse => {
		if (data === undefined) {
			return { id, type: "response", command, success: true } as RpcResponse;
		}
		return { id, type: "response", command, success: true, data } as RpcResponse;
	};

	const error = (id: string | undefined, command: string, message: string): RpcResponse => {
		return { id, type: "response", command, success: false, error: message };
	};

	// Pending extension UI requests waiting for response, tagged with the session that asked
	// so that closing a session can settle the dialogs it left open.
	const pendingExtensionRequests = new Map<
		string,
		{ resolve: (value: RpcExtensionUIResponse) => void; reject: (error: Error) => void; sessionId?: string }
	>();
	const bindingVersions = new Map<string, number>();

	// Shutdown request flag
	let shutdownRequested = false;
	let shuttingDown = false;
	const signalCleanupHandlers: Array<() => void> = [];

	const activeHandle = (): RpcSessionHandle => {
		const handle = handles.get(activeHandleId);
		if (!handle) throw new Error(`Active session ${activeHandleId} is not open`);
		return handle;
	};

	/** Route a command to the handle it names, or to the active one when it names none. */
	const resolveHandle = (sessionId?: string): { handle: RpcSessionHandle; handleId: string } => {
		if (!sessionId) return { handle: activeHandle(), handleId: activeHandleId };
		const handle = handles.get(sessionId);
		if (!handle) throw new Error(`Unknown sessionId: ${sessionId}`);
		return { handle, handleId: sessionId };
	};

	const activateHandle = (handleId: string): void => {
		activeHandleId = handleId;
	};

	const describeHandle = (handleId: string, handle: RpcSessionHandle): RpcOpenSession => ({
		active: handleId === activeHandleId,
		cwd: handle.runtime.cwd,
		isStreaming: handle.session.isStreaming,
		messageCount: handle.session.messages.length,
		piSessionId: handle.session.sessionId,
		sessionFile: handle.session.sessionFile,
		sessionId: handleId,
		sessionName: handle.session.sessionName,
	});

	/** Settle dialogs a session left open so its extensions stop waiting. */
	const cancelPendingRequests = (handleId: string): void => {
		for (const [requestId, pending] of pendingExtensionRequests) {
			if (pending.sessionId !== handleId) continue;
			pendingExtensionRequests.delete(requestId);
			pending.resolve({ cancelled: true, id: requestId } as RpcExtensionUIResponse);
		}
	};

	/**
	 * A session file may only be loaded once per process: pi appends to the JSONL without
	 * locking, so two runtimes on one file interleave or truncate each other's transcript.
	 * Windows paths are compared case-insensitively.
	 */
	const sessionFileKey = (file: string | undefined): string | undefined => {
		if (file === undefined) return undefined;
		const normalized = resolvePath(file).replace(/\\/g, "/");
		return process.platform === "win32" ? normalized.toLowerCase() : normalized;
	};

	const assertSessionFileFree = (sessionPath: string, handleId: string): void => {
		const target = sessionFileKey(resolvePath(sessionPath));
		for (const [otherId, other] of handles) {
			if (otherId === handleId) continue;
			if (sessionFileKey(other.session.sessionFile) === target) {
				throw new Error(`Session is already open as ${otherId}: ${sessionPath}`);
			}
		}
	};

	/** Helper for dialog methods with signal/timeout support */
	function createDialogPromise<T>(
		handleId: string,
		opts: ExtensionUIDialogOptions | undefined,
		defaultValue: T,
		request: Record<string, unknown>,
		parseResponse: (response: RpcExtensionUIResponse) => T,
	): Promise<T> {
		if (opts?.signal?.aborted) return Promise.resolve(defaultValue);

		const id = crypto.randomUUID();
		return new Promise((resolve, reject) => {
			let timeoutId: ReturnType<typeof setTimeout> | undefined;

			const cleanup = () => {
				if (timeoutId) clearTimeout(timeoutId);
				opts?.signal?.removeEventListener("abort", onAbort);
				pendingExtensionRequests.delete(id);
			};

			const onAbort = () => {
				cleanup();
				resolve(defaultValue);
			};
			opts?.signal?.addEventListener("abort", onAbort, { once: true });

			if (opts?.timeout) {
				timeoutId = setTimeout(() => {
					cleanup();
					resolve(defaultValue);
				}, opts.timeout);
			}

			pendingExtensionRequests.set(id, {
				resolve: (response: RpcExtensionUIResponse) => {
					cleanup();
					resolve(parseResponse(response));
				},
				reject,
				sessionId: handleId,
			});
			output({ type: "extension_ui_request", id, sessionId: handleId, ...request } as RpcExtensionUIRequest);
		});
	}

	/**
	 * Create an extension UI context that uses the RPC protocol for one session handle.
	 */
	const createExtensionUIContext = (handleId: string): ExtensionUIContext => ({
		select: (title, options, opts) =>
			createDialogPromise(
				handleId,
				opts,
				undefined,
				{ method: "select", title, options, timeout: opts?.timeout },
				(r) => ("cancelled" in r && r.cancelled ? undefined : "value" in r ? r.value : undefined),
			),

		confirm: (title, message, opts) =>
			createDialogPromise(
				handleId,
				opts,
				false,
				{ method: "confirm", title, message, timeout: opts?.timeout },
				(r) => ("cancelled" in r && r.cancelled ? false : "confirmed" in r ? r.confirmed : false),
			),

		input: (title, placeholder, opts) =>
			createDialogPromise(
				handleId,
				opts,
				undefined,
				{ method: "input", title, placeholder, timeout: opts?.timeout },
				(r) => ("cancelled" in r && r.cancelled ? undefined : "value" in r ? r.value : undefined),
			),

		notify(message: string, type?: "info" | "warning" | "error"): void {
			// Fire and forget - no response needed
			output({
				type: "extension_ui_request",
				id: crypto.randomUUID(),
				method: "notify",
				message,
				notifyType: type,
				sessionId: handleId,
			} as RpcExtensionUIRequest);
		},

		onTerminalInput(): () => void {
			// Raw terminal input not supported in RPC mode
			return () => {};
		},

		setStatus(key: string, text: string | undefined): void {
			// Fire and forget - no response needed
			output({
				type: "extension_ui_request",
				id: crypto.randomUUID(),
				method: "setStatus",
				statusKey: key,
				statusText: text,
				sessionId: handleId,
			} as RpcExtensionUIRequest);
		},

		setWorkingMessage(_message?: string): void {
			// Working message not supported in RPC mode - requires TUI loader access
		},

		setWorkingVisible(_visible: boolean): void {
			// Working visibility not supported in RPC mode - requires TUI loader access
		},

		setWorkingIndicator(_options?: WorkingIndicatorOptions): void {
			// Working indicator customization not supported in RPC mode - requires TUI loader access
		},

		setHiddenThinkingLabel(_label?: string): void {
			// Hidden thinking label not supported in RPC mode - requires TUI message rendering access
		},

		setWidget(key: string, content: unknown, options?: ExtensionWidgetOptions): void {
			// Only support string arrays in RPC mode - factory functions are ignored
			if (content === undefined || Array.isArray(content)) {
				output({
					type: "extension_ui_request",
					id: crypto.randomUUID(),
					method: "setWidget",
					widgetKey: key,
					widgetLines: content as string[] | undefined,
					widgetPlacement: options?.placement,
				} as RpcExtensionUIRequest);
			}
			// Component factories are not supported in RPC mode - would need TUI access
		},

		setFooter(_factory: unknown): void {
			// Custom footer not supported in RPC mode - requires TUI access
		},

		setHeader(_factory: unknown): void {
			// Custom header not supported in RPC mode - requires TUI access
		},

		setTitle(title: string): void {
			// Fire and forget - host can implement terminal title control
			output({
				type: "extension_ui_request",
				id: crypto.randomUUID(),
				method: "setTitle",
				title,
				sessionId: handleId,
			} as RpcExtensionUIRequest);
		},

		async custom() {
			// Custom UI not supported in RPC mode
			return undefined as never;
		},

		pasteToEditor(text: string): void {
			// Paste handling not supported in RPC mode - falls back to setEditorText
			this.setEditorText(text);
		},

		setEditorText(text: string): void {
			// Fire and forget - host can implement editor control
			output({
				type: "extension_ui_request",
				id: crypto.randomUUID(),
				method: "set_editor_text",
				text,
				sessionId: handleId,
			} as RpcExtensionUIRequest);
		},

		getEditorText(): string {
			// Synchronous method can't wait for RPC response
			// Host should track editor state locally if needed
			return "";
		},

		async editor(title: string, prefill?: string): Promise<string | undefined> {
			const id = crypto.randomUUID();
			return new Promise((resolve, reject) => {
				pendingExtensionRequests.set(id, {
					resolve: (response: RpcExtensionUIResponse) => {
						if ("cancelled" in response && response.cancelled) {
							resolve(undefined);
						} else if ("value" in response) {
							resolve(response.value);
						} else {
							resolve(undefined);
						}
					},
					reject,
					sessionId: handleId,
				});
				output({
					type: "extension_ui_request",
					id,
					method: "editor",
					title,
					prefill,
					sessionId: handleId,
				} as RpcExtensionUIRequest);
			});
		},

		addAutocompleteProvider(): void {
			// Autocomplete provider composition is not supported in RPC mode
		},

		setEditorComponent(): void {
			// Custom editor components not supported in RPC mode
		},

		getEditorComponent() {
			// Custom editor components not supported in RPC mode
			return undefined;
		},

		get theme() {
			return theme;
		},

		getAllThemes() {
			return [];
		},

		getTheme(_name: string) {
			return undefined;
		},

		setTheme(_theme: string | Theme) {
			// Theme switching not supported in RPC mode
			return { success: false, error: "Theme switching not supported in RPC mode" };
		},

		getToolsExpanded() {
			// Tool expansion not supported in RPC mode - no TUI
			return false;
		},

		setToolsExpanded(_expanded: boolean) {
			// Tool expansion not supported in RPC mode - no TUI
		},
	});

	/**
	 * Attach the RPC bridge (extension UI, events, backpressure) to the session a handle
	 * currently holds. Runs again whenever that handle replaces its session.
	 */
	const bindHandle = async (handleId: string): Promise<void> => {
		const handle = handles.get(handleId);
		if (!handle) return;
		const version = (bindingVersions.get(handleId) ?? 0) + 1;
		bindingVersions.set(handleId, version);
		const handleSession = handle.runtime.session;
		handle.session = handleSession;
		await handleSession.bindExtensions({
			uiContext: createExtensionUIContext(handleId),
			mode: "rpc",
			commandContextActions: {
				waitForIdle: () => handleSession.waitForIdle(),
				newSession: async (options) => handle.runtime.newSession(options),
				fork: async (entryId, forkOptions) => {
					const result = await handle.runtime.fork(entryId, forkOptions);
					return { cancelled: result.cancelled };
				},
				navigateTree: async (targetId, options) => {
					const result = await handleSession.navigateTree(targetId, {
						summarize: options?.summarize,
						customInstructions: options?.customInstructions,
						replaceInstructions: options?.replaceInstructions,
						label: options?.label,
					});
					return { cancelled: result.cancelled };
				},
				switchSession: async (sessionPath, options) => {
					assertSessionFileFree(sessionPath, handleId);
					return handle.runtime.switchSession(sessionPath, options);
				},
				reload: async () => {
					await handleSession.reload();
				},
			},
			shutdownHandler: () => {
				shutdownRequested = true;
			},
			onError: (err) => {
				output({
					type: "extension_error",
					extensionPath: err.extensionPath,
					event: err.event,
					error: err.error,
					sessionId: handleId,
				});
			},
		});
		if (handles.get(handleId) !== handle || bindingVersions.get(handleId) !== version) return;

		handle.unsubscribe?.();
		handle.unsubscribeBackpressure?.();
		handle.unsubscribe = handleSession.subscribe((event) => {
			output({ ...toJsonEvent(event), sessionId: handleId });
			if (event.type === "agent_settled") {
				void checkShutdownRequested();
			}
		});
		handle.unsubscribeBackpressure = handleSession.agent.subscribe(async () => {
			await waitForRawStdoutBackpressure();
		});
	};

	const registerSignalHandlers = (): void => {
		const signals: NodeJS.Signals[] = ["SIGTERM"];
		if (process.platform !== "win32") {
			signals.push("SIGHUP");
		}

		for (const signal of signals) {
			const handler = () => {
				killTrackedDetachedChildren();
				void shutdown(signal === "SIGHUP" ? 129 : 143, signal);
			};
			process.on(signal, handler);
			signalCleanupHandlers.push(() => process.off(signal, handler));
		}
	};

	handles.set(INITIAL_HANDLE_ID, { runtime: runtimeHost, session: runtimeHost.session });
	runtimeHost.setRebindSession(async () => {
		await bindHandle(INITIAL_HANDLE_ID);
	});
	await bindHandle(INITIAL_HANDLE_ID);
	registerSignalHandlers();

	// Handle a single command
	const handleCommand = async (command: RpcCommand): Promise<RpcResponse | undefined> => {
		const id = command.id;

		// Every command runs against one session handle: the one it names, or the active one.
		// The three session-lifecycle commands are not scoped to a session and use the active
		// handle only as the runtime that creates siblings.
		const sessionScoped =
			command.type !== "get_capabilities" && command.type !== "open_session" && command.type !== "get_open_sessions";
		const target = sessionScoped
			? resolveHandle(command.sessionId)
			: { handle: activeHandle(), handleId: activeHandleId };
		const { handle, handleId } = target;
		// Shadow the single-session names so the command bodies below stay unchanged.
		const session = handle.session;
		const runtimeHost = handle.runtime;
		const rebindSession = async (): Promise<void> => {
			await bindHandle(handleId);
		};

		switch (command.type) {
			// =================================================================
			// Prompting
			// =================================================================

			case "prompt": {
				// Start prompt handling immediately, but emit the authoritative response only after
				// prompt preflight succeeds. Queued and immediately handled prompts also count as success.
				let preflightSucceeded = false;
				void session
					.prompt(command.message, {
						images: command.images,
						streamingBehavior: command.streamingBehavior,
						source: "rpc",
						preflightResult: (didSucceed, willStart) => {
							if (didSucceed) {
								preflightSucceeded = true;
								// `started` tells clients an agent_start/agent_settled pair is on the way,
								// so waitForIdle does not resolve in the gap between this response and the
								// first event of the run.
								output(success(id, "prompt", { started: willStart === true, sessionId: handleId }));
							}
						},
					})
					.catch((e: unknown) => {
						if (!preflightSucceeded) {
							output(error(id, "prompt", e instanceof Error ? e.message : String(e)));
						}
					});
				return undefined;
			}

			case "steer": {
				await session.steer(command.message, command.images);
				return success(id, "steer");
			}

			case "follow_up": {
				await session.followUp(command.message, command.images);
				return success(id, "follow_up");
			}

			case "abort": {
				await session.abort();
				return success(id, "abort");
			}

			case "clear_queue": {
				return success(id, "clear_queue", session.clearQueue());
			}

			case "new_session": {
				const options = command.parentSession ? { parentSession: command.parentSession } : undefined;
				const result = await runtimeHost.newSession(options);
				if (!result.cancelled) {
					await rebindSession();
				}
				return success(id, "new_session", result);
			}

			// =================================================================
			// State
			// =================================================================

			case "get_state": {
				const state: RpcSessionState = {
					model: session.model,
					thinkingLevel: session.thinkingLevel,
					isStreaming: session.isStreaming,
					isCompacting: session.isCompacting,
					steeringMode: session.steeringMode,
					followUpMode: session.followUpMode,
					sessionFile: session.sessionFile,
					sessionId: session.sessionId,
					sessionName: session.sessionName,
					cwd: handle.runtime.cwd,
					autoCompactionEnabled: session.autoCompactionEnabled,
					messageCount: session.messages.length,
					pendingMessageCount: session.pendingMessageCount,
				};
				return success(id, "get_state", state);
			}

			// =================================================================
			// Model
			// =================================================================

			case "set_model": {
				const models = session.modelRuntime.getAvailableSnapshot();
				const model = models.find((m) => m.provider === command.provider && m.id === command.modelId);
				if (!model) {
					return error(id, "set_model", `Model not found: ${command.provider}/${command.modelId}`);
				}
				await session.setModel(model);
				return success(id, "set_model", model);
			}

			case "cycle_model": {
				const result = await session.cycleModel();
				if (!result) {
					return success(id, "cycle_model", null);
				}
				return success(id, "cycle_model", result);
			}

			case "get_available_models": {
				const models = session.modelRuntime.getAvailableSnapshot();
				return success(id, "get_available_models", { models });
			}

			// =================================================================
			// Thinking
			// =================================================================

			case "set_thinking_level": {
				session.setThinkingLevel(command.level);
				return success(id, "set_thinking_level");
			}

			case "cycle_thinking_level": {
				const level = session.cycleThinkingLevel();
				if (!level) {
					return success(id, "cycle_thinking_level", null);
				}
				return success(id, "cycle_thinking_level", { level });
			}

			case "get_available_thinking_levels": {
				const levels = session.getAvailableThinkingLevels();
				return success(id, "get_available_thinking_levels", { levels });
			}

			// =================================================================
			// Queue Modes
			// =================================================================

			case "set_steering_mode": {
				session.setSteeringMode(command.mode);
				return success(id, "set_steering_mode");
			}

			case "set_follow_up_mode": {
				session.setFollowUpMode(command.mode);
				return success(id, "set_follow_up_mode");
			}

			// =================================================================
			// Compaction
			// =================================================================

			case "compact": {
				const result = await session.compact(command.customInstructions);
				return success(id, "compact", result);
			}

			case "set_auto_compaction": {
				session.setAutoCompactionEnabled(command.enabled);
				return success(id, "set_auto_compaction");
			}

			// =================================================================
			// Retry
			// =================================================================

			case "set_auto_retry": {
				session.setAutoRetryEnabled(command.enabled);
				return success(id, "set_auto_retry");
			}

			case "abort_retry": {
				session.abortRetry();
				return success(id, "abort_retry");
			}

			// =================================================================
			// Bash
			// =================================================================

			case "bash": {
				const eventResult = await session.extensionRunner.emitUserBash({
					type: "user_bash",
					command: command.command,
					excludeFromContext: command.excludeFromContext ?? false,
					cwd: session.sessionManager.getCwd(),
				});

				if (eventResult?.result) {
					session.recordBashResult(command.command, eventResult.result, {
						excludeFromContext: command.excludeFromContext,
					});
					return success(id, "bash", eventResult.result);
				}

				const result = await session.executeBash(command.command, undefined, {
					excludeFromContext: command.excludeFromContext,
					id,
					operations: eventResult?.operations,
				});
				return success(id, "bash", result);
			}

			case "abort_bash": {
				session.abortBash();
				return success(id, "abort_bash");
			}

			// =================================================================
			// Session
			// =================================================================

			case "get_session_stats": {
				const stats = session.getSessionStats();
				return success(id, "get_session_stats", stats);
			}

			case "export_html": {
				const path = await session.exportToHtml(command.outputPath);
				return success(id, "export_html", { path });
			}

			case "switch_session": {
				assertSessionFileFree(command.sessionPath, handleId);
				const result = await runtimeHost.switchSession(command.sessionPath);
				if (!result.cancelled) {
					await rebindSession();
				}
				return success(id, "switch_session", result);
			}

			case "fork": {
				const result = await runtimeHost.fork(command.entryId);
				if (!result.cancelled) {
					await rebindSession();
				}
				return success(id, "fork", { text: result.selectedText, cancelled: result.cancelled });
			}

			case "clone": {
				const leafId = session.sessionManager.getLeafId();
				if (!leafId) {
					return error(id, "clone", "Cannot clone session: no current entry selected");
				}
				const result = await runtimeHost.fork(leafId, { position: "at" });
				if (!result.cancelled) {
					await rebindSession();
				}
				return success(id, "clone", { cancelled: result.cancelled });
			}

			case "get_fork_messages": {
				const messages = session.getUserMessagesForForking();
				return success(id, "get_fork_messages", { messages });
			}

			case "get_entries": {
				const sessionManager = session.sessionManager;
				let entries = sessionManager.getEntries();
				if (command.since !== undefined) {
					const sinceIndex = entries.findIndex((e) => e.id === command.since);
					if (sinceIndex === -1) {
						return error(id, "get_entries", `Entry not found: ${command.since}`);
					}
					entries = entries.slice(sinceIndex + 1);
				}
				return success(id, "get_entries", { entries, leafId: sessionManager.getLeafId() });
			}

			case "get_tree": {
				const sessionManager = session.sessionManager;
				return success(id, "get_tree", { tree: sessionManager.getTree(), leafId: sessionManager.getLeafId() });
			}

			case "get_last_assistant_text": {
				const text = session.getLastAssistantText();
				return success(id, "get_last_assistant_text", { text });
			}

			case "set_session_name": {
				const name = command.name.trim();
				if (!name) {
					return error(id, "set_session_name", "Session name cannot be empty");
				}
				session.setSessionName(name);
				return success(id, "set_session_name");
			}

			// =================================================================
			// Messages
			// =================================================================

			case "get_messages": {
				return success(id, "get_messages", { messages: session.messages });
			}

			// =================================================================
			// Commands (available for invocation via prompt)
			// =================================================================

			case "get_commands": {
				const commands: RpcSlashCommand[] = [];

				for (const command of session.extensionRunner.getRegisteredCommands()) {
					commands.push({
						name: command.invocationName,
						description: command.description,
						source: "extension",
						sourceInfo: command.sourceInfo,
					});
				}

				for (const template of session.promptTemplates) {
					commands.push({
						name: template.name,
						description: template.description,
						source: "prompt",
						sourceInfo: template.sourceInfo,
					});
				}

				for (const skill of session.resourceLoader.getSkills().skills) {
					commands.push({
						name: `skill:${skill.name}`,
						description: skill.description,
						source: "skill",
						sourceInfo: skill.sourceInfo,
					});
				}

				return success(id, "get_commands", { commands });
			}

			// =================================================================
			// Multiple sessions in one process
			// =================================================================

			case "get_capabilities": {
				const capabilities: RpcCapabilities = {
					multiSession: true,
					protocolVersion: RPC_PROTOCOL_VERSION,
				};
				return success(id, "get_capabilities", capabilities);
			}

			case "open_session": {
				const wantedFile = command.sessionPath ? resolvePath(command.sessionPath) : undefined;
				// Never load the same session file twice: two runtimes writing one JSONL would
				// interleave and corrupt it. Re-opening returns the handle that already has it.
				const wantedKey = sessionFileKey(wantedFile);
				const existing = wantedKey
					? [...handles.entries()].find(([, item]) => sessionFileKey(item.session.sessionFile) === wantedKey)
					: undefined;
				if (existing) {
					const [existingId] = existing;
					if (command.activate !== false) activateHandle(existingId);
					return success(id, "open_session", describeHandle(existingId, existing[1]));
				}

				// Opens of the same file are serialized (a double click must not race the check
				// above); each `open_session` without a path still creates its own session.
				const openKey = wantedKey ?? `new:${crypto.randomUUID()}`;
				let pendingOpen = pendingOpens.get(openKey);
				if (!pendingOpen) {
					// Force a fresh extension module per session: the extension cache is keyed by
					// resolved path, so a cache hit would hand two sessions the same module instance
					// and with it the same module-level state.
					clearExtensionCache();
					pendingOpen = (async () => {
						const sibling = await activeHandle().runtime.openSibling({
							cwd: command.cwd,
							sessionPath: wantedFile,
						});
						const handleId = `s${nextHandleId++}`;
						const opened: RpcSessionHandle = { runtime: sibling, session: sibling.session };
						handles.set(handleId, opened);
						sibling.setRebindSession(async () => {
							await bindHandle(handleId);
						});
						await bindHandle(handleId);
						return handleId;
					})().finally(() => pendingOpens.delete(openKey));
					pendingOpens.set(openKey, pendingOpen);
				}
				const handleId = await pendingOpen;
				if (command.activate !== false) activateHandle(handleId);
				return success(id, "open_session", describeHandle(handleId, handles.get(handleId) ?? activeHandle()));
			}

			case "close_session": {
				const closeId = command.sessionId;
				const closing = handles.get(closeId);
				if (!closing) return error(id, "close_session", `Unknown sessionId: ${closeId}`);
				if (handles.size === 1) {
					return error(id, "close_session", "Cannot close the last open session in the process");
				}

				handles.delete(closeId);
				bindingVersions.delete(closeId);
				cancelPendingRequests(closeId);
				closing.unsubscribe?.();
				closing.unsubscribeBackpressure?.();
				await closing.runtime.dispose();
				if (activeHandleId === closeId) {
					const next = handles.keys().next();
					if (!next.done) activateHandle(next.value);
				}
				return success(id, "close_session", { activeSessionId: activeHandleId, closed: true });
			}

			case "get_open_sessions": {
				return success(id, "get_open_sessions", {
					activeSessionId: activeHandleId,
					sessions: [...handles.entries()].map(([openId, item]) => describeHandle(openId, item)),
				});
			}

			default: {
				const unknownCommand = command as { type: string };
				return error(id, unknownCommand.type, `Unknown command: ${unknownCommand.type}`);
			}
		}
	};

	/**
	 * Check if shutdown was requested and perform shutdown if so.
	 * Called after handling each command when waiting for the next command.
	 */
	let detachInput = () => {};
	const commandScheduler = new RpcCommandScheduler();

	async function shutdown(exitCode = 0, signal?: NodeJS.Signals): Promise<never> {
		if (shuttingDown) {
			process.exit(exitCode);
		}
		shuttingDown = true;
		for (const cleanup of signalCleanupHandlers) {
			cleanup();
		}
		for (const [handleId, handle] of handles) {
			cancelPendingRequests(handleId);
			handle.unsubscribe?.();
			handle.unsubscribeBackpressure?.();
			await handle.runtime.dispose();
		}
		handles.clear();
		detachInput();
		process.stdin.pause();
		if (signal !== "SIGTERM") {
			await flushRawStdout();
		}
		process.exit(exitCode);
	}

	async function checkShutdownRequested(): Promise<void> {
		if (!shutdownRequested) return;
		await shutdown();
	}

	const handleInputLine = async (line: string) => {
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch (parseError: unknown) {
			output(
				error(
					undefined,
					"parse",
					`Failed to parse command: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
				),
			);
			await waitForRawStdoutBackpressure();
			return;
		}

		// Handle extension UI responses
		if (
			typeof parsed === "object" &&
			parsed !== null &&
			"type" in parsed &&
			parsed.type === "extension_ui_response"
		) {
			const response = parsed as RpcExtensionUIResponse;
			const pending = pendingExtensionRequests.get(response.id);
			if (pending) {
				pendingExtensionRequests.delete(response.id);
				pending.resolve(response);
			}
			await waitForRawStdoutBackpressure();
			return;
		}

		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
			output(error(undefined, "parse", "RPC command must be a JSON object"));
			await waitForRawStdoutBackpressure();
			return;
		}
		const candidate = parsed as Record<string, unknown>;
		if (typeof candidate.type !== "string") {
			output(
				error(
					typeof candidate.id === "string" ? candidate.id : undefined,
					"parse",
					"RPC command type must be a string",
				),
			);
			await waitForRawStdoutBackpressure();
			return;
		}
		if (candidate.id !== undefined && typeof candidate.id !== "string") {
			output(error(undefined, "parse", "RPC command id must be a string"));
			await waitForRawStdoutBackpressure();
			return;
		}
		const command = parsed as RpcCommand;
		try {
			// Untagged commands resolve to whatever handle is active when they run, which may
			// differ from the handle that was active when the line was read. Give them one
			// shared scope so ordered commands meant for "the active session" can never run
			// in parallel with each other across an activation flip.
			const scope = command.sessionId ?? "@active";
			const response = await commandScheduler.run(scope, command.type, () => handleCommand(command));
			if (response) {
				output(response);
				await waitForRawStdoutBackpressure();
			}
			await checkShutdownRequested();
		} catch (commandError: unknown) {
			output(
				error(
					command.id,
					command.type,
					commandError instanceof Error ? commandError.message : String(commandError),
				),
			);
			await waitForRawStdoutBackpressure();
		}
	};

	const onInputEnd = () => {
		void shutdown();
	};
	process.stdin.on("end", onInputEnd);

	detachInput = (() => {
		const detachJsonl = attachJsonlLineReader(
			process.stdin,
			(line) => {
				void handleInputLine(line);
			},
			(inputError) => {
				output(error(undefined, "parse", inputError.message));
				void shutdown(1);
			},
		);
		return () => {
			detachJsonl();
			process.stdin.off("end", onInputEnd);
		};
	})();

	// Keep process alive forever
	return new Promise(() => {});
}
