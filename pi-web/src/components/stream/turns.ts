import type { ChatMessage, ForkMessage, MessageBlock } from "../../state/types";
import { t } from "../../i18n";

/** One transcript entry: a user message, or the run of assistant steps that answered it. */
export interface Turn {
	id: string;
	messages: ChatMessage[];
	role: "user" | "assistant";
}

/**
 * Group messages into turns.
 *
 * pi ends an assistant message at every tool call, so one answer arrives as several consecutive
 * assistant messages. A turn — what the conversation flow shows as one block — is that whole run,
 * bounded by user messages.
 *
 * Turn objects are reused across calls when their messages did not change: a streamed delta
 * rebuilds only the tail turn it lands in, and the memoized TurnViews of every earlier turn skip
 * re-rendering. Reuse compares message object identity, which is safe because the store updates
 * messages immutably.
 */
export function groupTurns(messages: ChatMessage[]): Turn[] {
	const turns: Turn[] = [];
	for (const message of messages) {
		const last = turns[turns.length - 1];
		if (message.role === "assistant" && last?.role === "assistant") {
			last.messages.push(message);
			continue;
		}
		turns.push({ id: message.id, messages: [message], role: message.role });
	}
	for (let index = 0; index < turns.length; index += 1) {
		const old = lastGrouping?.[index];
		const turn = turns[index];
		if (!old || old.id !== turn.id || old.role !== turn.role || old.messages.length !== turn.messages.length) {
			continue;
		}
		if (turn.messages.every((message, position) => message === old.messages[position])) turns[index] = old;
	}
	lastGrouping = turns;
	return turns;
}

let lastGrouping: Turn[] | undefined;

export interface TurnFlow {
	/** Blocks after the last tool call of the final step: the answer itself. */
	answerBlocks: MessageBlock[];
	/** Subagent delegations among the process tool calls. */
	counts: { messages: number; subagents: number; toolCalls: number };
	/** True when the process can fold: settled, compact, and with an answer to keep in view. */
	foldable: boolean;
	/** Blocks up to and including the last tool call: the work that produced the answer. */
	processBlocks: MessageBlock[];
	streaming: boolean;
}

/** Split a turn into the work it did and the answer it produced. */
export function analyzeTurn(turn: Turn, compact: boolean): TurnFlow {
	const messages = turn.messages;
	const streaming = messages.some((message) => message.state === "streaming");
	const last = messages[messages.length - 1];
	const lastTool = last.blocks.reduce((found, block, index) => (block.type === "toolCall" ? index : found), -1);
	const answerBlocks = last.blocks.slice(lastTool + 1);
	const flat = messages.flatMap((message) => message.blocks);
	const processBlocks = flat.slice(0, flat.length - answerBlocks.length);

	let messages_ = 0;
	let subagents = 0;
	let toolCalls = 0;
	for (const block of processBlocks) {
		if (block.type === "text") messages_ += 1;
		if (block.type !== "toolCall") continue;
		// Same delegation set the subagent card renders: companion tools like
		// subagent_models are utilities, not spawned agents.
		if (block.toolName === "subagent" || block.toolName === "task") {
			subagents += 1;
		} else {
			toolCalls += 1;
		}
	}

	return {
		answerBlocks,
		counts: { messages: messages_, subagents, toolCalls },
		foldable: compact && !streaming && processBlocks.length > 0 && answerBlocks.length > 0,
		processBlocks,
		streaming,
	};
}

/** Fold label: dsh's `N 次工具调用 · M 条消息 · K 个 subagent`, counts in that order. */
export function foldLabel(counts: TurnFlow["counts"]): string {
	const parts: string[] = [];
	if (counts.toolCalls > 0) parts.push(t("{toolCalls} 次工具调用", { "toolCalls": counts.toolCalls }));
	if (counts.messages > 0) parts.push(t("{messages} 条消息", { "messages": counts.messages }));
	if (counts.subagents > 0) parts.push(t("{subagents} 个 subagent", { "subagents": counts.subagents }));
	return parts.length === 0 ? t("已思考") : parts.join(" · ");
}

/** Identity of a block inside a turn, stable across streaming updates of the same position. */
export function blockKey(turn: Turn, block: MessageBlock, index: number): string {
	return `${turn.id}-${index}-${block.type}`;
}

/** The prompt a user turn carries; that text is what pi keys a fork point by. */
function promptText(turn: Turn): string {
	return turn.messages[0].blocks
		.filter((block) => block.type === "text")
		.map((block) => (block.type === "text" ? block.text : ""))
		.join("")
		.trim();
}

/**
 * Give every turn the session entry id pi knows its prompt by.
 *
 * pi lists the session's user messages with their entry ids, while the transcript only carries
 * renderer-side ids — the prompt text is the one thing both sides share. A prompt repeated
 * verbatim appears once per repetition on each side, so occurrences are counted per text instead
 * of matching the first hit. A turn whose prompt has no entry id (it predates a compaction, say)
 * gets `undefined`, which is what hides the actions that need one.
 *
 * An assistant turn reports the id of the user turn that prompted it, so a row can address the
 * message the answer belongs to.
 */
export function promptEntryIds(turns: Turn[], forkMessages: ForkMessage[]): Array<string | undefined> {
	const byText = new Map<string, string[]>();
	for (const forkMessage of forkMessages) {
		const entryIds = byText.get(forkMessage.text.trim());
		if (entryIds) entryIds.push(forkMessage.entryId);
		else byText.set(forkMessage.text.trim(), [forkMessage.entryId]);
	}
	const occurrences = new Map<string, number>();
	const result: Array<string | undefined> = [];
	let inherited: string | undefined;
	for (const turn of turns) {
		if (turn.role === "user") {
			const text = promptText(turn);
			const occurrence = occurrences.get(text) ?? 0;
			occurrences.set(text, occurrence + 1);
			inherited = byText.get(text)?.[occurrence];
		}
		result.push(inherited);
	}
	return result;
}
