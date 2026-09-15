import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../state/types";
import { sessionTodos } from "./todos";

function todoCall(details: unknown, toolName = "todo"): ChatMessage {
	return {
		blocks: [
			{
				details,
				output: "",
				state: "complete",
				toolCallId: "call-1",
				toolName,
				type: "toolCall",
			},
		],
		id: "m1",
		role: "assistant",
		state: "complete",
	};
}

describe("sessionTodos", () => {
	it("reads the list off the latest todo call in the transcript", () => {
		const messages = [
			todoCall({ todos: [{ done: false, id: 1, text: "first" }] }),
			{ blocks: [], id: "m2", role: "user", state: "complete" },
			todoCall({ todos: [{ done: true, id: 1, text: "first" }, { done: false, id: 2, text: "second" }] }),
		] as ChatMessage[];
		expect(sessionTodos(messages)).toEqual([
			{ id: "T-1", status: "done", text: "first" },
			{ id: "T-2", status: "pending", text: "second" },
		]);
	});

	it("returns an empty list when the session cleared its todos", () => {
		const messages = [
			todoCall({ todos: [{ done: false, id: 1, text: "first" }] }),
			todoCall({ todos: [] }),
		] as ChatMessage[];
		expect(sessionTodos(messages)).toEqual([]);
	});

	it("keeps the last good list when the newest call carried none", () => {
		const messages = [
			todoCall({ todos: [{ status: "in_progress", text: "working" }] }),
			todoCall({ error: "boom" }),
		] as ChatMessage[];
		expect(sessionTodos(messages)).toEqual([{ id: "T-1", status: "in-progress", text: "working" }]);
	});

	it("unwraps details.result and accepts items plus content fields", () => {
		const messages = [
			todoCall({ result: { items: [{ content: "write tests", status: "blocked" }] } }, "todo_write"),
		] as ChatMessage[];
		expect(sessionTodos(messages)).toEqual([{ id: "T-1", status: "blocked", text: "write tests" }]);
	});

	it("returns nothing for a session that never called a todo tool", () => {
		const messages = [
			{
				blocks: [{ output: "", state: "complete", toolCallId: "c1", toolName: "bash", type: "toolCall" }],
				id: "m1",
				role: "assistant",
				state: "complete",
			},
		] as ChatMessage[];
		expect(sessionTodos(messages)).toEqual([]);
	});
});
