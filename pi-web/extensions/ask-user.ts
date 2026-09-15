import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

interface AskUserDetails {
	answer: string | null;
	options?: string[];
	question: string;
	wasCustom?: boolean;
}

export default function askUser(pi: ExtensionAPI) {
	pi.registerTool({
		name: "ask_user",
		label: "Ask User",
		description:
			"Ask the user a question. Use options for multiple choice, or omit them for freeform input.",
		parameters: Type.Object({
			question: Type.String({ description: "The question to ask the user" }),
			options: Type.Optional(
				Type.Array(Type.String(), { description: "Optional multiple-choice options" }),
			),
		}),
		executionMode: "sequential",
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const question = params.question.trim();
			if (!question) {
				return {
					content: [{ type: "text", text: "Error: question is required" }],
					details: { answer: null, question } satisfies AskUserDetails,
				};
			}
			if (Array.isArray(params.options) && params.options.length > 0) {
				const answer = await ctx.ui.select(question, params.options);
				return {
					content: [{ type: "text", text: answer ? `User selected: ${answer}` : "User cancelled" }],
					details: {
						answer: answer ?? null,
						options: params.options,
						question,
					} satisfies AskUserDetails,
				};
			}
			const answer = await ctx.ui.input(question, "Type your answer...");
			return {
				content: [{ type: "text", text: answer ? `User answered: ${answer}` : "User cancelled" }],
				details: { answer: answer ?? null, question, wasCustom: true } satisfies AskUserDetails,
			};
		},
	});
}
