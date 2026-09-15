import type { ChatMessage } from "../../state/types";
import type { TurnUsageView } from "../TurnStats";
import type { Turn } from "./turns";

/**
 * What one answer cost, in dsh's wording: the tokens the whole turn billed, how long it took
 * wall-clock, and the time it landed.
 *
 * Usage is per provider call and pi restarts it at each step of a tool-using turn, so the turn's
 * bill is the sum over its rated steps. A turn with none — an aborted answer, a restored step pi
 * no longer reports usage for — has no pill rather than a zero one.
 */
export function turnUsage(turn: Turn): TurnUsageView | undefined {
	const steps = turn.messages.filter((message) => message.usage !== undefined);
	if (steps.length === 0) return undefined;
	return {
		cacheRead: steps.reduce((sum, message) => sum + (message.usage?.cacheRead ?? 0), 0),
		cacheWrite: steps.reduce((sum, message) => sum + (message.usage?.cacheWrite ?? 0), 0),
		input: steps.reduce((sum, message) => sum + (message.usage?.input ?? 0), 0),
		output: steps.reduce((sum, message) => sum + (message.usage?.output ?? 0), 0),
		steps: steps.length,
		total: steps.reduce((sum, message) => sum + (message.usage?.total ?? 0), 0),
	};
}

/**
 * The turn's wall clock and its time to first token.
 *
 * `durationMs` is the whole prompt-to-answer time and is absent for turns that were already
 * history when this window opened. `ttftMs` is measured from the prompt to the model's first
 * streamed character of the step that answered; the later tool rounds of a turn are not latency,
 * so only the first reading is kept.
 */
export function turnTiming(turn: Turn): { durationMs?: number; ttftMs?: number } {
	let durationMs: number | undefined;
	let ttftMs: number | undefined;
	for (const message of turn.messages) {
		if (message.durationMs !== undefined) durationMs = message.durationMs;
		if (ttftMs === undefined && message.ttftMs !== undefined) ttftMs = message.ttftMs;
	}
	return { durationMs, ttftMs };
}

/** When the turn landed: the last completion among its steps. */
export function turnCompletedAt(messages: ChatMessage[]): number | undefined {
	return messages.reduce<number | undefined>((found, message) => message.completedAt ?? found, undefined);
}

/** The model that answered the turn; a turn whose steps switched models names the last one. */
export function turnModel(turn: Turn): string | undefined {
	let model: string | undefined;
	for (const message of turn.messages) {
		if (message.model) model = message.provider ? `${message.provider}/${message.model}` : message.model;
	}
	return model;
}
