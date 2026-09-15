import type { ChatMessage, TodoItem } from "../state/types";

/** Tool names whose call details carry the session's todo list. */
const TODO_TOOLS = new Set(["todo", "todo_write", "todos"]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function normalizeStatus(record: Record<string, unknown>): TodoItem["status"] {
	const raw = typeof record.status === "string" ? record.status : undefined;
	if (raw === "done" || raw === "completed" || record.done === true) return "done";
	if (raw === "in-progress" || raw === "in_progress") return "in-progress";
	if (raw === "blocked") return "blocked";
	return "pending";
}

function normalizeId(record: Record<string, unknown>, index: number): string {
	if (typeof record.id === "string" && record.id) return record.id;
	if (typeof record.id === "number") return `T-${record.id}`;
	return `T-${index + 1}`;
}

/**
 * The visible session's todo list, read off its own transcript the way pi's todo extension
 * keeps it: each todo tool call's details carry the whole list, so the last call carrying one
 * is the list now — including an empty one, which means the session cleared it. Nothing is
 * read from disk: the list belongs to the conversation, not to the project folder.
 */
export function sessionTodos(messages: ChatMessage[]): TodoItem[] {
	for (let m = messages.length - 1; m >= 0; m--) {
		const blocks = messages[m].blocks;
		for (let b = blocks.length - 1; b >= 0; b--) {
			const block = blocks[b];
			if (block.type !== "toolCall" || !TODO_TOOLS.has(block.toolName)) continue;
			const details = asRecord(block.details);
			const result = asRecord(details?.result) ?? details;
			const list = Array.isArray(result?.todos) ? result.todos : Array.isArray(result?.items) ? result.items : undefined;
			// A call without a list (e.g. an errored one) changes nothing — keep scanning back.
			if (!list) continue;
			return list.flatMap((entry, index) => {
				const record = asRecord(entry);
				const text =
					typeof record?.text === "string"
						? record.text
						: typeof record?.content === "string"
							? record.content
							: undefined;
				if (!record || !text) return [];
				return [{ id: normalizeId(record, index), status: normalizeStatus(record), text }];
			});
		}
	}
	return [];
}
