import { useEffect, useMemo, useState } from "react";
import { t } from "../i18n";
import { usePiStore } from "../state/store";
import type { ChatMessage, ExtensionUiRequest } from "../state/types";
import { MarkdownBlock } from "./stream/Turn";
import { buttonClass } from "./buttons";

/** The options pi-plan-extension's "Plan ready — what next?" select always offers. */
const PLAN_EXECUTE = "Execute the plan";
const PLAN_STAY = "Stay in plan mode";
const PLAN_EXIT = "Exit plan mode";

export function isPlanReviewRequest(request: ExtensionUiRequest): boolean {
	return request.method === "select" && (request.options ?? []).includes(PLAN_EXECUTE);
}

/** Newest plan file the session's create_plan/update_plan calls reported, if any. */
function latestPlanPath(messages: ChatMessage[]): string | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		for (const block of messages[i].blocks) {
			if (block.type !== "toolCall") continue;
			if (block.toolName !== "create_plan" && block.toolName !== "update_plan") continue;
			const path = (block.details as { path?: unknown } | undefined)?.path;
			if (typeof path === "string" && path.length > 0) return path;
		}
	}
	return undefined;
}

/**
 * The plan-ready select rendered as a decision card (deepseek-harness PlanReviewPanel):
 * a warning strip, the plan markdown in a scrollable body, and stay/exit/execute actions that
 * answer with the extension's own option labels.
 */
export function PlanReviewCard({
	onAnswer,
	request,
}: {
	onAnswer: (option: string) => void;
	request: ExtensionUiRequest;
}) {
	const sessionId = request.sessionId;
	const messages = usePiStore((state) =>
		sessionId && state.backgroundSessions[sessionId]
			? state.backgroundSessions[sessionId].messages
			: state.messages,
	);
	const planPath = useMemo(() => latestPlanPath(messages), [messages]);
	const [planText, setPlanText] = useState<string>();
	const [planError, setPlanError] = useState<string>();
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		setPlanText(undefined);
		setPlanError(undefined);
		setBusy(false);
		if (!planPath) return;
		let stale = false;
		void (window.pi.readFile(planPath) as Promise<{ text?: string } | undefined>)
			.then((result) => {
				if (!stale) setPlanText(result?.text ?? "");
			})
			.catch((error: unknown) => {
				if (!stale) setPlanError(error instanceof Error ? error.message : String(error));
			});
		return () => {
			stale = true;
		};
	}, [planPath, request.id]);

	const answer = (option: string) => {
		if (busy) return;
		setBusy(true);
		onAnswer(option);
	};

	const stay = (request.options ?? []).includes(PLAN_STAY) ? PLAN_STAY : undefined;
	const exit = (request.options ?? []).includes(PLAN_EXIT) ? PLAN_EXIT : undefined;

	return (
		<section aria-label={request.title ?? t("计划评审")} data-plan-review-key={request.id}>
			<div className="flex items-center gap-2 rounded-t-[20px] bg-[color-mix(in_srgb,var(--pi-warn)_14%,transparent)] px-4 py-2.5 text-[13px] leading-[18px] text-[var(--pi-warn)]">
				<span className="h-2 w-2 shrink-0 rounded-full bg-[var(--pi-warn)]" />
				{t("计划评审")}
				{planPath ? <span className="truncate opacity-70">{planPath}</span> : null}
			</div>
			<div className="max-h-[min(60vh,520px)] overflow-y-auto overscroll-contain px-4 pb-1 pt-3 text-[14px] leading-[22px]">
				{planText !== undefined ? (
					<MarkdownBlock text={planText} />
				) : (
					<div className="text-ink-muted">{planError ?? request.message ?? request.title}</div>
				)}
			</div>
			<div className="flex items-center justify-end gap-2 px-4 pb-3 pt-2">
				{stay ? (
					<button
						className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-[13px] font-medium text-ink-muted transition-colors hover:text-ink disabled:cursor-default"
						disabled={busy}
						onClick={() => answer(stay)}
						type="button"
					>
						{t("继续完善")}
					</button>
				) : null}
				{exit ? (
					<button
						className={buttonClass("secondary")}
						disabled={busy}
						onClick={() => answer(exit)}
						type="button"
					>
						{t("退出计划模式")}
					</button>
				) : null}
				<button
					className={buttonClass("primary")}
					disabled={busy}
					onClick={() => answer(PLAN_EXECUTE)}
					type="button"
				>
					{t("执行计划")}
				</button>
			</div>
		</section>
	);
}
