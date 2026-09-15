import { describe, expect, it } from "vitest";
import type { ChatMessage, MessageBlock } from "../../state/types";
import { analyzeTurn, foldLabel, groupTurns, promptEntryIds } from "./turns";

function assistant(id: string, blocks: MessageBlock[], state: ChatMessage["state"] = "complete"): ChatMessage {
	return { blocks, id, role: "assistant", state };
}

function user(id: string, text: string): ChatMessage {
	return { blocks: [{ state: "complete", text, type: "text" }], id, role: "user", state: "complete" };
}

function text(value: string): MessageBlock {
	return { state: "complete", text: value, type: "text" };
}

function thinking(value: string): MessageBlock {
	return { state: "complete", text: value, type: "thinking" };
}

function tool(toolName: string): MessageBlock {
	return { output: "", state: "complete", toolCallId: `call-${toolName}`, toolName, type: "toolCall" };
}

describe("turn grouping", () => {
	it("collects the assistant steps of one answer into a single turn", () => {
		const turns = groupTurns([
			user("u1", "hi"),
			assistant("a1", [thinking("look"), tool("read")]),
			assistant("a2", [tool("bash")]),
			assistant("a3", [text("done")]),
			user("u2", "again"),
		]);
		expect(turns.map((turn) => turn.role)).toEqual(["user", "assistant", "user"]);
		expect(turns[1].messages.map((message) => message.id)).toEqual(["a1", "a2", "a3"]);
	});
});

describe("turn analysis", () => {
	const turn = groupTurns([
		user("u1", "hi"),
		assistant("a1", [thinking("look"), tool("read")]),
		assistant("a2", [tool("bash"), text("中间说明")]),
		assistant("a3", [thinking("think"), text("答案")]),
	])[1];

	it("folds the process when the answer sits after the last tool call", () => {
		const flow = analyzeTurn(turn, true);
		expect(flow.foldable).toBe(true);
		expect(flow.answerBlocks).toEqual([thinking("think"), text("答案")]);
		expect(flow.processBlocks).toHaveLength(4);
		expect(flow.counts).toEqual({ messages: 1, subagents: 0, toolCalls: 2 });
	});

	it("keeps every row when the transcript is not compact", () => {
		expect(analyzeTurn(turn, false).foldable).toBe(false);
	});

	it("does not fold a turn that ends in a tool call", () => {
		const open = groupTurns([user("u1", "hi"), assistant("a1", [thinking("look"), tool("bash")])])[1];
		const flow = analyzeTurn(open, true);
		expect(flow.answerBlocks).toEqual([]);
		expect(flow.foldable).toBe(false);
	});

	it("does not fold a streaming turn", () => {
		const live = groupTurns([
			user("u1", "hi"),
			assistant("a1", [tool("bash")], "streaming"),
			assistant("a2", [text("partial")], "streaming"),
		])[1];
		expect(analyzeTurn(live, true).foldable).toBe(false);
		expect(analyzeTurn(live, true).streaming).toBe(true);
	});

	it("counts subagents apart from tool calls", () => {
		const withSubagent = groupTurns([
			user("u1", "hi"),
			assistant("a1", [tool("subagent"), tool("grepx"), text("go")]),
			assistant("a2", [text("done")]),
		])[1];
		expect(analyzeTurn(withSubagent, true).counts).toEqual({ messages: 1, subagents: 1, toolCalls: 1 });
	});
});

describe("fold label", () => {
	it("joins the counts in dsh's order", () => {
		expect(foldLabel({ messages: 2, subagents: 1, toolCalls: 5 })).toBe("5 次工具调用 · 2 条消息 · 1 个 subagent");
	});

	it("falls back to the thought label", () => {
		expect(foldLabel({ messages: 0, subagents: 0, toolCalls: 0 })).toBe("已思考");
	});
});

describe("prompt entry ids", () => {
	const turns = groupTurns([
		user("u1", "第一个问题"),
		assistant("a1", [text("第一个回答")]),
		user("u2", "重复的提示"),
		assistant("a2", [text("第二个回答")]),
		user("u3", "重复的提示"),
		assistant("a3", [text("第三个回答")]),
	]);

	it("gives an answer the entry id of the prompt it answered", () => {
		const ids = promptEntryIds(turns, [
			{ entryId: "e1", text: "第一个问题" },
			{ entryId: "e2", text: "重复的提示" },
			{ entryId: "e3", text: "重复的提示" },
		]);
		expect(ids).toEqual(["e1", "e1", "e2", "e2", "e3", "e3"]);
	});

	it("drops the actions for a prompt pi no longer lists", () => {
		const ids = promptEntryIds(turns, [{ entryId: "e1", text: "第一个问题" }]);
		expect(ids).toEqual(["e1", "e1", undefined, undefined, undefined, undefined]);
	});

	it("pairs a repeated prompt with its own occurrence, not the first match", () => {
		const ids = promptEntryIds(
			groupTurns([user("u1", "重复的提示"), assistant("a1", [text("答")]), user("u2", "重复的提示")]),
			[
				{ entryId: "first", text: "重复的提示" },
				{ entryId: "second", text: "重复的提示" },
			],
		);
		expect(ids).toEqual(["first", "first", "second"]);
	});
});
