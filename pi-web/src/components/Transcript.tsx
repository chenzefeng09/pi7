import { useVirtualizer } from "@tanstack/react-virtual";
import { Cloud, GitPullRequest, Hammer, Loader2, SearchCode } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePiStore, useSessionCwd } from "../state/store";
import { useTranscriptSettings } from "../state/transcript";
import { useUiStore } from "../state/ui";
import { buttonClass } from "./buttons";
import { Modal } from "./Modal";
import { TurnView, TurnStatus } from "./stream/Turn";
import { groupTurns, promptEntryIds, type Turn } from "./stream/turns";
import { type RailMark, TurnRail } from "./TurnRail";
import { t } from "../i18n";

/**
 * The rail's preview shows one line of prompt and three of the answer; anything past this is
 * never displayed, so flattening stops once enough text is collected.
 */
const RAIL_TEXT_LIMIT = 400;

/**
 * Flattened text of a turn, cached on the turn object itself. `groupTurns` keeps a turn's
 * identity while its messages stay unchanged, so a streamed delta re-derives only the tail
 * turn's mark instead of re-flattening the whole transcript.
 */
const railTextCache = new WeakMap<Turn, string>();

function turnText(turn: Turn): string {
	const cached = railTextCache.get(turn);
	if (cached !== undefined) return cached;
	let collected = "";
	for (const message of turn.messages) {
		for (const block of message.blocks) {
			if (block.type !== "text") continue;
			collected += collected ? ` ${block.text}` : block.text;
			if (collected.length >= RAIL_TEXT_LIMIT) break;
		}
		if (collected.length >= RAIL_TEXT_LIMIT) break;
	}
	const text = collected.replace(/\s+/g, " ").trim();
	railTextCache.set(turn, text);
	return text;
}

const SUGGESTIONS = [
	{
		description: t("探索并理解代码"),
		icon: SearchCode,
		prompt: t("探索这个代码库并解释它是如何工作的。"),
		tone: "text-[#2f7df6]",
	},
	{
		description: t("构建新功能、应用或工具"),
		icon: Hammer,
		prompt: t("构建一个新功能。先检查代码库并提出具体方案。"),
		tone: "text-[#8b5cf6]",
	},
	{
		description: t("审查代码并给出修改建议"),
		icon: GitPullRequest,
		prompt: t("审查当前改动并给出具体的改进建议。"),
		tone: "text-[#22c55e]",
	},
];

function EmptyState() {
	return (
		<div className="flex min-h-full flex-col items-center justify-center px-6 pb-28 pt-8">
			<Cloud className="text-[#cdd3da]" size={44} strokeWidth={1.4} />
			<h1 className="mt-6 text-[26px] font-normal tracking-[-0.02em] text-[#111827]">{t("想用 π7 做什么？")}</h1>
			<div className="mt-8 grid w-full max-w-[680px] grid-cols-1 gap-4 md:grid-cols-3">
				{SUGGESTIONS.map((suggestion) => {
					const Icon = suggestion.icon;
					return (
						<button
							className="flex h-[112px] flex-col justify-between rounded-[14px] border border-black/[0.08] bg-white p-3.5 text-left transition hover:border-black/[0.16] hover:bg-black/[0.015]"
							key={suggestion.description}
							onClick={() => usePiStore.setState({ composerAppend: false, composerText: suggestion.prompt })}
							type="button"
						>
							<Icon className={suggestion.tone} size={19} strokeWidth={1.8} />
							<span className="text-[13px] font-medium leading-5 text-[#111827]">{suggestion.description}</span>
						</button>
					);
				})}
			</div>
		</div>
	);
}

function LoadingState() {
	return (
		<div className="flex min-h-full items-center justify-center pb-28">
			<Loader2 className="animate-spin text-[#c7ccd2]" size={22} />
		</div>
	);
}

/**
 * Forking is pi's clone rather than a branch off one message: the whole active branch is written
 * to a new session file and becomes the visible one. That replaces what the window shows, so the
 * dialog in SessionToolsDialog asks first instead of doing it on one click of a row icon.
 */
function ForkConfirmDialog({ onClose, open }: { onClose: () => void; open: boolean }) {
	const cloneSession = usePiStore((state) => state.cloneSession);
	return (
		<Modal
			className="w-full max-w-[420px] rounded-2xl border border-black/[0.06] bg-white p-6 shadow-[0_24px_70px_rgba(15,23,42,0.2)]"
			onClose={onClose}
			open={open}
		>
			<>
				<div className="text-[17px] font-semibold tracking-[-0.01em] text-[#111827]">{t("分叉到新会话")}</div>
				<div className="mt-2 text-[13px] leading-5 text-[#667085]">
					{t("当前会话的完整分支会被复制成一个新的会话文件，并切换到这个新会话；原会话保留在项目列表里，不会被修改。")}</div>
				<div className="mt-5 flex justify-end gap-2">
					<button className={buttonClass()} onClick={onClose} type="button">
						{t("取消")}</button>
					<button
						className={buttonClass("primary")}
						onClick={() => {
							onClose();
							void cloneSession();
						}}
						type="button"
					>
						{t("分叉")}</button>
				</div>
			</>
		</Modal>
	);
}

export function Transcript() {
	const messages = usePiStore((state) => state.messages);
	const editAndResend = usePiStore((state) => state.editAndResend);
	const forkMessages = usePiStore((state) => state.forkMessages);
	const outputTokensPerSecond = usePiStore((state) => state.outputTokensPerSecond);
	const sessionFile = usePiStore((state) => state.sessionFile);
	const sessionId = usePiStore((state) => state.sessionId);
	const sessionLoading = usePiStore((state) => state.sessionLoading);
	const status = usePiStore((state) => state.status);
	const compact = useTranscriptSettings((state) => state.compact);
	// Tool rows show paths relative to the session's own working directory, so the transcript
	// needs the cwd of the visible session rather than the process-wide one.
	const cwd = useSessionCwd();
	const parentRef = useRef<HTMLDivElement | null>(null);
	// True while the transcript follows the tail; the scroll handler keeps it honest so a reader
	// who scrolled up is not yanked back by the next streamed row.
	const pinned = useRef(true);
	// One flow item per turn, not per message: a single answer arrives as several pi messages.
	const turns = useMemo(() => groupTurns(messages), [messages]);
	const entryIds = useMemo(() => promptEntryIds(turns, forkMessages), [forkMessages, turns]);
	const [forkOpen, setForkOpen] = useState(false);
	const onClone = useCallback(() => setForkOpen(true), []);
	const onResend = useCallback(
		(entryId: string, text: string) => editAndResend(entryId, text),
		[editAndResend],
	);
	const virtualizer = useVirtualizer({
		count: turns.length,
		estimateSize: () => 120,
		getScrollElement: () => parentRef.current,
		overscan: 6,
		// The column's top inset and the composer clearance belong to the virtualizer, not to the
		// scroll container: anything the browser scrolls but the virtualizer does not know about is
		// a shortfall it clamps the scroll back to, which is what left the tail one row short.
		paddingEnd: 172,
		paddingStart: 24,
	});
	const count = turns.length;
	// A different session has to open at its end even though the row count may not change.
	const sessionKey = sessionFile ?? sessionId;
	const jumpRequest = useUiStore((state) => state.jumpToBottomRequest);
	// An empty transcript is always "at its end", so the jump button stays hidden.
	useEffect(() => {
		if (count === 0) useUiStore.getState().setAtTranscriptEnd(true);
	}, [count]);
	// The virtualizer only knows a row's real height after it measured it, and the end it scrolled
	// to was placed with the estimate. `totalSize` changes exactly when those measurements land, so
	// it is the signal to place the end again — otherwise the transcript stops one row short.
	const totalSize = virtualizer.getTotalSize();

	useEffect(() => {
		pinned.current = true;
	}, [jumpRequest, sessionKey]);

	useEffect(() => {
		const element = parentRef.current;
		if (count === 0 || !element) return;
		let cancelled = false;
		let tries = 0;
		// The end has to be re-asserted: the virtualizer places it with row *estimates* and then
		// re-applies its own offset as the real heights arrive, which leaves the transcript exactly
		// one row short of the tail. Each pass goes through scrollToIndex so the virtualizer's
		// offset moves with it, and the loop stops as soon as the end holds.
		const settleAtEnd = () => {
			if (cancelled || !pinned.current) return;
			// Ask for the last row first (that is also what renders it and its real height), then
			// for the element's maximum: the end the virtualizer computes for a row is clamped to
			// its own total, and going through scrollToOffset keeps its offset in step with where
			// the element actually ends up — writing scrollTop directly just gets reverted.
			virtualizer.scrollToIndex(count - 1, { align: "end" });
			const max = element.scrollHeight - element.clientHeight;
			if (Math.abs(element.scrollTop - max) > 2) virtualizer.scrollToOffset(max);
			const gap = element.scrollHeight - element.scrollTop - element.clientHeight;
			tries += 1;
			if (gap > 2 && tries < 12) {
				window.setTimeout(settleAtEnd, 60);
				return;
			}
			// Only claim the end once it holds, or the jump button stays on offer — a programmatic
			// scroll does not always produce the event that would have updated this.
			useUiStore.getState().setAtTranscriptEnd(gap <= 2);
		};
		settleAtEnd();
		return () => {
			cancelled = true;
		};
	}, [count, jumpRequest, sessionKey, totalSize, virtualizer]);

	// Rail marks: one per exchange — the prompt and the answer it got. The rail spaces them at a
	// fixed pitch, so unlike the transcript they need no measured offsets.
	const railMarks = useMemo(() => {
		const marks: RailMark[] = [];
		for (let index = 0; index < turns.length; index += 1) {
			const turn = turns[index];
			if (turn.role === "assistant" && index > 0) continue;
			const answer = turns[index + 1];
			marks.push({
				index,
				loaded: virtualizer.measurementsCache[index] !== undefined,
				prompt: turnText(turn),
				response: answer?.role === "assistant" ? turnText(answer) : "",
			});
		}
		return marks;
	}, [turns, virtualizer]);
	const middle = (virtualizer.scrollOffset ?? 0) + (parentRef.current?.clientHeight ?? 0) / 2;
	let activeIndex = railMarks[0]?.index ?? 0;
	for (const mark of railMarks) {
		if (virtualizer.measurementsCache[mark.index]?.start !== undefined) {
			if ((virtualizer.measurementsCache[mark.index]?.start ?? 0) <= middle) activeIndex = mark.index;
		} else if (mark.index <= activeIndex) {
			activeIndex = mark.index;
		}
	}
	// The run's state comes from pi, not from the transcript's own per-message marks: a message
	// left behind as `streaming` by an abort or a reload must not keep the flow looking busy.
	const running = status === "streaming";
	const busyIndex = running ? turns.length - 1 : undefined;
	const lastTurn = turns[turns.length - 1];
	const workingBlock = lastTurn?.messages.at(-1)?.blocks.at(-1);
	// No status line under a prompt the run has not answered yet: at that moment there is no work to
	// report, and the line would claim the model is thinking about a turn that has not started.
	const showTurnStatus = running && lastTurn?.role === "assistant" && Boolean(workingBlock);
	// The rail sits in the band above the floating composer.
	const bandHeight = Math.max(0, (parentRef.current?.clientHeight ?? 0) - 188);

	return (
		<div className="relative flex min-h-0 flex-1 flex-col">
			<div
				className="scrollbar-subtle flex-1 overflow-y-auto bg-white"
				onScroll={(event) => {
					const element = event.currentTarget;
					const gap = element.scrollHeight - element.scrollTop - element.clientHeight;
					// Getting back to the tail re-arms following. It is not armed by position alone:
					// the virtualizer's own scroll to the end lands short of it until its rows are
					// measured, and that gap must not be mistaken for the user scrolling away.
					if (gap < 40) pinned.current = true;
					// The composer's jump button reads this, so a reader who scrolled up can get back.
					useUiStore.getState().setAtTranscriptEnd(gap < 120);
				}}
				onWheel={(event) => {
					if (event.deltaY < 0) pinned.current = false;
				}}
				ref={parentRef}
			>
				{count === 0 ? (
					sessionLoading ? (
						<LoadingState />
					) : (
						<EmptyState />
					)
				) : (
					// Narrower than the composer card below it: the reading column needs the inset, and
					// Codex keeps the two deliberately different widths.
					<div className="mx-auto w-full max-w-[860px] px-6">
						<div className="relative" style={{ height: virtualizer.getTotalSize() }}>
							{virtualizer.getVirtualItems().map((item) => (
								<div
									className="absolute left-0 top-0 w-full pb-4"
									data-index={item.index}
									key={item.key}
									ref={virtualizer.measureElement}
									style={{ transform: `translateY(${item.start}px)` }}
								>
									<TurnView
										compact={compact}
										cwd={cwd}
										entryId={entryIds[item.index]}
										onClone={onClone}
										onResend={onResend}
										// The meter tracks the running turn, so only the tail turn may
										// claim its rate; older answers would show someone else's speed.
										tokensPerSecond={
											item.index === count - 1 ? outputTokensPerSecond : undefined
										}
										turn={turns[item.index]}
									/>
								</div>
							))}
						</div>
					</div>
				)}
			</div>
			{showTurnStatus ? (
				// One line for the session, in the column the turns use, so it reads as the tail of
				// the flow rather than as part of one answer.
				<div className="mx-auto w-full max-w-[860px] px-6 pb-2">
					<TurnStatus executing={workingBlock?.type === "toolCall"} />
				</div>
			) : null}
			{count > 0 ? (
				<TurnRail
					activeIndex={activeIndex}
					bandHeight={bandHeight}
					busyIndex={busyIndex}
					marks={railMarks}
					onNavigate={(index) => {
						pinned.current = false;
						virtualizer.scrollToIndex(index, { align: "start" });
					}}
				/>
			) : null}
			<ForkConfirmDialog onClose={() => setForkOpen(false)} open={forkOpen} />
		</div>
	);
}
