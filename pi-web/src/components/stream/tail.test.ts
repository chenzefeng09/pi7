import { describe, expect, it } from "vitest";
import type { ChatMessage, MessageUsage } from "../../state/types";
import { turnCompletedAt, turnModel, turnTiming, turnUsage } from "./tail";
import type { Turn } from "./turns";

function usage(input: number, output: number, cacheRead: number, cacheWrite = 0): MessageUsage {
	return { cacheRead, cacheWrite, input, output, total: input + output + cacheRead + cacheWrite };
}

function step(overrides: Partial<ChatMessage> = {}): ChatMessage {
	return {
		blocks: [{ state: "complete", text: "答", type: "text" }],
		id: "m1",
		role: "assistant",
		state: "complete",
		...overrides,
	};
}

function turn(messages: ChatMessage[]): Turn {
	return { id: messages[0]?.id ?? "t", messages, role: "assistant" };
}

describe("turn tail stats", () => {
	it("sums the turn's steps, because pi restarts usage at every tool round", () => {
		const view = turnUsage(
			turn([
				step({ id: "a", usage: usage(100, 20, 900) }),
				step({ id: "b", usage: usage(50, 30, 1000, 10) }),
			]),
		);
		expect(view).toEqual({
			cacheRead: 1900,
			cacheWrite: 10,
			input: 150,
			output: 50,
			steps: 2,
			total: 2110,
		});
	});

	it("has no usage to show for a turn pi never rated", () => {
		expect(turnUsage(turn([step({ state: "aborted" })]))).toBeUndefined();
	});

	it("takes the elapsed time from the step that closed the turn", () => {
		const timing = turnTiming(
			turn([
				step({ completedAt: 2_000, createdAt: 1_000, id: "a", ttftMs: 1_200 }),
				step({ completedAt: 9_000, createdAt: 1_000, durationMs: 8_000, id: "b", ttftMs: 900 }),
			]),
		);
		expect(timing).toEqual({ durationMs: 8_000, ttftMs: 1_200 });
	});

	it("reports nothing it does not know, so a restored turn shows no duration", () => {
		expect(turnTiming(turn([step({ completedAt: 5_000 })]))).toEqual({
			durationMs: undefined,
			ttftMs: undefined,
		});
	});

	it("names the model of the last rated step", () => {
		expect(
			turnModel(
				turn([
					step({ id: "a", model: "v3", provider: "deepseek" }),
					step({ id: "b", model: "r1" }),
				]),
			),
		).toBe("r1");
	});

	it("clocks the turn at its last completion", () => {
		expect(turnCompletedAt([step({ completedAt: 4_000 }), step({ id: "b" })])).toBe(4_000);
	});
});
