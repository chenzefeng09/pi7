import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Text of a session entry's message, or undefined when it is not a user prompt. */
function promptText(entry: unknown): string | undefined {
	if (typeof entry !== "object" || entry === null) return undefined;
	const message = (entry as { message?: unknown }).message;
	if (typeof message !== "object" || message === null) return undefined;
	const record = message as { content?: unknown; role?: unknown };
	if (record.role !== "user") return undefined;
	if (typeof record.content === "string") return record.content;
	if (!Array.isArray(record.content)) return undefined;
	return record.content
		.map((part) =>
			typeof part === "object" && part !== null && (part as { type?: unknown }).type === "text"
				? String((part as { text?: unknown }).text ?? "")
				: "",
		)
		.join("");
}

/**
 * Rewind a session to just before one of its user messages, in place.
 *
 * pi's TUI does this from `/tree` (see docs/sessions.md): the leaf moves to the selected message's
 * parent, the message text goes back into the editor, and the abandoned branch stays in the
 * session tree — same session file, no fork. None of that is reachable over RPC, so the app's
 * transcript rows call this command instead.
 *
 * The text is read from the session manager rather than from `navigateTree`'s result: the RPC
 * bridge returns `{ cancelled }` only and drops the `editorText` the TUI consumes.
 */
export default function sessionEdit(pi: ExtensionAPI) {
	pi.registerCommand("session-edit", {
		description: "回到某条已发送消息之前，把它放回输入框（同一会话）",
		handler: async (args, ctx) => {
			const entryId = args.trim();
			if (!entryId) {
				ctx.ui.notify("用法：/session-edit <entryId>", "warning");
				return;
			}
			const text = promptText(ctx.sessionManager.getEntry(entryId));
			if (text === undefined) {
				ctx.ui.notify(`只能回到用户消息之前：${entryId}`, "warning");
				return;
			}
			try {
				const result = await ctx.navigateTree(entryId, { summarize: false });
				if (result.cancelled) return;
				ctx.ui.setEditorText(text);
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});
}
