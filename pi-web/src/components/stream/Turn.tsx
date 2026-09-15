import { Check, ChevronDown, Copy, GitFork, Pencil } from "lucide-react";
import { memo, type ReactNode, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage, ImageBlock, MessageBlock } from "../../state/types";
import { buttonClass } from "../buttons";
import { formatClock } from "../usage";
import { TurnTimePill, TurnUsagePill } from "../TurnStats";
import { MessageImages } from "./MessageImages";
import { ReasoningRow } from "./ReasoningRow";
import { ToolRow } from "./ToolRow";
import { turnCompletedAt, turnModel, turnTiming, turnUsage } from "./tail";
import { analyzeTurn, blockKey, foldLabel, type Turn } from "./turns";

/** Folded process disclosure: a 14px label over a hairline, chevron pointing right when closed. */
const ProcessRow = memo(function ProcessRow({
	label,
	onToggle,
	open,
}: {
	label: string;
	onToggle: () => void;
	open: boolean;
}) {
	return (
		<button
			aria-expanded={open}
			className="flex h-[33px] w-full items-center border-b-[0.5px] border-black/10 pb-2 text-left"
			data-fold-row
			onClick={onToggle}
			type="button"
		>
			<span className="truncate text-[14px] leading-6 text-ink-muted">{label}</span>
			<ChevronDown
				className="ml-1.5 flex-none text-ink-subtle transition-transform duration-100"
				size={16}
				style={{ transform: open ? "rotate(0deg)" : "rotate(-90deg)" }}
			/>
		</button>
	);
});

function MarkdownBlock({ text }: { text: string }) {
	return (
		<div className="prose-pi">
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				components={{
					code({ className, children, ...props }) {
						const isBlock = typeof className === "string" && className.includes("language-");
						if (isBlock) {
							return (
								<pre className="overflow-x-auto rounded-[12px] border-[0.5px] border-black/[0.06] bg-code p-4 font-mono text-[12px] leading-[19px]">
									<code className={className} {...props}>
										{children}
									</code>
								</pre>
							);
						}
						return (
							<code
								className="rounded-md border-[0.5px] border-black/[0.04] bg-code px-[5px] font-mono text-[12px]"
								{...props}
							>
								{children}
							</code>
						);
					},
				}}
			>
				{text}
			</ReactMarkdown>
		</div>
	);
}

/** One image of an answer; a user prompt's images render as its attachment row instead. */
function isImage(block: MessageBlock): block is ImageBlock {
	return block.type === "image";
}

function BlockView({ block, cwd }: { block: MessageBlock; cwd?: string }) {
	if (block.type === "image") return <MessageImages align="start" blocks={[block]} />;
	if (block.type === "thinking") return <ReasoningRow block={block} />;
	if (block.type === "toolCall") return <ToolRow block={block} cwd={cwd} />;
	return <MarkdownBlock text={block.text} />;
}

/** Copy affordance shared by both message rows; `onEdit` adds Codex's second action. */
function CopyAction({ onEdit, text }: { onEdit?: () => void; text: string }) {
	const [copied, setCopied] = useState(false);
	if (!text.trim()) return null;
	return (
		<>
			<button
				className="flex h-7 w-7 items-center justify-center rounded-full text-ink-subtle hover:bg-black/[0.05] hover:text-ink-muted"
				onClick={() => {
					void navigator.clipboard
						.writeText(text)
						.then(() => {
							setCopied(true);
							window.setTimeout(() => setCopied(false), 1500);
						})
						.catch(() => {});
				}}
				title="复制"
				type="button"
			>
				{copied ? <Check className="text-success" size={15} /> : <Copy size={15} />}
			</button>
			{onEdit ? (
				<button
					className="flex h-7 w-7 items-center justify-center rounded-full text-ink-subtle hover:bg-black/[0.05] hover:text-ink-muted"
					onClick={onEdit}
					title="编辑"
					type="button"
				>
					<Pencil size={14} />
				</button>
			) : null}
		</>
	);
}

/**
 * Copy and branch, the left end of the tail row.
 *
 * Branching here is pi's clone, not a fork: the entire active branch is written to a new session
 * file and becomes the visible one, so the new window starts as a complete copy of this
 * conversation instead of a truncated page.
 */
function MessageActions({ onClone, text }: { onClone: () => void; text: string }) {
	return (
		<div className="flex h-7 shrink-0 items-center gap-2">
			<CopyAction text={text} />
			<button
				className="flex h-7 w-7 items-center justify-center rounded-full text-ink-subtle hover:bg-black/[0.05] hover:text-ink-muted"
				onClick={onClone}
				title="分支到新会话"
				type="button"
			>
				<GitFork size={15} />
			</button>
		</div>
	);
}

/** Plain text of a turn's answer, the string its copy action writes and its footer measures. */
function answerText(messages: ChatMessage[]): string {
	return messages
		.flatMap((message) => message.blocks)
		.filter((block) => block.type === "text")
		.map((block) => (block.type === "text" ? block.text : ""))
		.join("\n");
}

/**
 * Row under a settled turn: copy and branch at its left end, the turn's stats right after them.
 *
 * Nothing stretches here: the pill cluster sits on the answer's own left edge, so the row reads as
 * one strip of chrome under the text (dsh seats the stat pills inside its actions row the same way
 * and pulls the row back by its own padding so the first icon lines up with the answer above).
 *
 * Without an answer to copy the row still carries the stat pills, and without either it is not
 * rendered at all.
 */
function MessageFooter({
	messages,
	onClone,
	turn,
	tokensPerSecond,
}: {
	messages: ChatMessage[];
	onClone: () => void;
	turn: Turn;
	tokensPerSecond?: number;
}) {
	const text = answerText(messages);
	const copyable = text.trim().length > 0;
	const usage = turnUsage(turn);
	const { durationMs, ttftMs } = turnTiming(turn);
	const completedAt = turnCompletedAt(messages);
	if (!usage && durationMs === undefined && !copyable) return null;
	return (
		<div className="-ml-1.5 mt-1 flex h-7 items-center gap-2 text-[13px] text-ink-subtle">
			{copyable ? <MessageActions onClone={onClone} text={text} /> : null}
			{usage ? <TurnUsagePill model={turnModel(turn)} usage={usage} /> : null}
			{durationMs !== undefined ? (
				<TurnTimePill durationMs={durationMs} tokensPerSecond={tokensPerSecond} ttftMs={ttftMs} />
			) : null}
			{completedAt !== undefined ? (
				<span className="shrink-0 whitespace-nowrap">{formatClock(completedAt)}</span>
			) : null}
		</div>
	);
}

/**
 * User turn: the prompt as a bubble, with the same copy/edit pair Codex puts under a sent
 * message. Images render as a 240px attachment row above the bubble instead of inside it.
 *
 * Editing happens in place: the bubble turns into a text box holding the prompt, and only 发送
 * touches the session — it rewinds the branch to just before this prompt and sends the edited
 * text there, so the conversation continues from this point with everything after it replaced.
 * 取消 costs nothing because nothing has been sent yet.
 */
function UserTurn({
	entryId,
	message,
	cwd,
	onResend,
}: {
	entryId?: string;
	message: ChatMessage;
	cwd?: string;
	onResend: (entryId: string, text: string) => Promise<boolean>;
}) {
	// null = showing the bubble; a string = editing that text.
	const [draft, setDraft] = useState<string | null>(null);
	const [sending, setSending] = useState(false);
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const text = message.blocks
		.filter((block) => block.type === "text")
		.map((block) => (block.type === "text" ? block.text : ""))
		.join("\n");
	// Images are the prompt's attachments, not its words: they sit above the bubble, the way dsh
	// stacks an attachment row, so a pasted screenshot never widens the bubble. A prompt that is
	// nothing but an image therefore has no bubble — its frame is the whole row.
	const images = message.blocks.filter(isImage);
	const blocks = message.blocks.filter((block) => !isImage(block));
	const showsBubble = blocks.some((block) => block.type !== "text" || block.text.trim().length > 0);

	useEffect(() => {
		const element = textareaRef.current;
		if (!element) return;
		element.style.height = "auto";
		element.style.height = `${Math.min(element.scrollHeight, 320)}px`;
	}, [draft]);

	const submit = async () => {
		const value = draft?.trim();
		if (!value || !entryId || sending) return;
		setSending(true);
		try {
			const sent = await onResend(entryId, value);
			// A rewind that did not happen keeps the editor open, so the text is not lost.
			if (sent) setDraft(null);
		} finally {
			// Whatever the store reported, the row must not stay stuck on "发送中…".
			setSending(false);
		}
	};

	if (draft !== null && entryId) {
		return (
			<div className="w-full">
				<div className="rounded-[18px] bg-black/[0.045] px-3.5 pb-2.5 pt-3">
					<textarea
						autoFocus
						className="max-h-[320px] min-h-[44px] w-full resize-none bg-transparent text-[14px] leading-[22px] text-[#111827] outline-none"
						onChange={(event) => setDraft(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Escape") {
								event.preventDefault();
								setDraft(null);
								return;
							}
							if (event.key === "Enter" && !event.shiftKey) {
								event.preventDefault();
								void submit();
							}
						}}
						ref={textareaRef}
						value={draft}
					/>
					<div className="mt-1.5 flex justify-end gap-2">
						<button className={buttonClass()} onClick={() => setDraft(null)} type="button">
							取消
						</button>
						<button
							className={buttonClass("primary")}
							disabled={!draft.trim() || sending}
							onClick={() => void submit()}
							type="button"
						>
							{sending ? "发送中..." : "发送"}
						</button>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="group flex w-full flex-col items-end">
			{images.length > 0 ? (
				<div className="mb-2 max-w-[82%]">
					<MessageImages align="end" blocks={images} />
				</div>
			) : null}
			{showsBubble ? (
				<div className="max-w-[82%] whitespace-pre-wrap break-words rounded-[22px] bg-[#edf3fe] px-4 py-2.5 text-[14px] leading-[22px] text-ink">
					{blocks.map((block, index) => (
						<div data-block={block.type} data-role={message.role} key={`${message.id}-${index}`}>
							<BlockView block={block} cwd={cwd} />
						</div>
					))}
				</div>
			) : null}
			<div className="mt-1 flex h-7 items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
				<CopyAction onEdit={entryId ? () => setDraft(text) : undefined} text={text} />
			</div>
		</div>
	);
}

/**
 * One turn of the conversation flow.
 *
 * An assistant turn reads as a flow of compact rows — the reasoning it did and the tools it ran —
 * followed by the answer. Once the turn has settled its process folds behind a
 * `N 次工具调用 · M 条消息` summary (the dsh compact transcript), so a long history reads as a
 * column of answers with one line of provenance each. `compact={false}` keeps every row in place.
 */
export const TurnView = memo(function TurnView({
	compact,
	cwd,
	entryId,
	onClone,
	onResend,
	tokensPerSecond,
	turn,
}: {
	compact: boolean;
	cwd?: string;
	/** pi entry id of this turn's prompt; missing means the message cannot be edited. */
	entryId?: string;
	onClone: () => void;
	onResend: (entryId: string, text: string) => Promise<boolean>;
	/** Decode rate of the turn the runtime is on; only the tail turn has one to report. */
	tokensPerSecond?: number;
	turn: Turn;
}) {
	const [processOpen, setProcessOpen] = useState(false);
	const flow = analyzeTurn(turn, compact);
	if (turn.role === "user") {
		return <UserTurn cwd={cwd} entryId={entryId} message={turn.messages[0]} onResend={onResend} />;
	}

	const folded = flow.foldable && !processOpen;
	const rows: ReactNode[] = [];
	const push = (block: MessageBlock, index: number, className: string) => {
		rows.push(
			<div className={className} data-block={block.type} data-role="assistant" key={blockKey(turn, block, index)}>
				<BlockView block={block} cwd={cwd} />
			</div>,
		);
	};

	if (folded) {
		rows.push(<ProcessRow key="fold" label={foldLabel(flow.counts)} onToggle={() => setProcessOpen(true)} open={false} />);
		// The closed summary already carries 8px of its own below the hairline, so the answer
		// only adds the other 8 of the dsh 16px hairline-to-answer distance.
		flow.answerBlocks.forEach((block, index) => push(block, flow.processBlocks.length + index, index === 0 ? "mt-2" : "mt-4"));
	} else {
		if (flow.foldable) {
			rows.push(<ProcessRow key="fold" label={foldLabel(flow.counts)} onToggle={() => setProcessOpen(false)} open />);
		}
		// Process plus answer is the whole turn; only the split matters for the folded case.
		const visible = [...flow.processBlocks, ...flow.answerBlocks];
		visible.forEach((block, index) => push(block, index, index === 0 && !flow.foldable ? "" : "mt-4"));
	}

	return (
		<div className="group flex w-full justify-start">
			<div className="flex min-w-0 flex-1 flex-col">
				{rows}
				{flow.streaming ? null : (
					<MessageFooter
						messages={turn.messages}
						onClone={onClone}
						tokensPerSecond={tokensPerSecond}
						turn={turn}
					/>
				)}
			</div>
		</div>
	);
});

/**
 * The running turn's status line, mounted once by the transcript rather than by each turn.
 *
 * The TUI answers this with one status bar that `turn_start` raises and `agent_end` clears, and
 * dsh renders one `role="status"` line anchored to `turn/start`. Asking each turn whether any of
 * its messages still carried a `streaming` mark — which is renderer state, not pi's — is what left
 * a 正在思考… line behind after an abort, and one line per unfinished turn.
 *
 * `executing` only chooses the wording: the run is on its tools rather than on the model.
 */
export function TurnStatus({ executing }: { executing: boolean }) {
	return <div className="turn-status">{executing ? "正在执行…" : "正在思考…"}</div>;
}