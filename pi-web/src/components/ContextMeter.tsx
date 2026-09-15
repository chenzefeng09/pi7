import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { usePiStore } from "../state/store";
import { buttonClass } from "./buttons";
import { Modal } from "./Modal";
import { Presence } from "./Presence";
import { formatTokens } from "./usage";

/**
 * Ring geometry taken from the harness composer meter: a 14px viewBox with a 2px stroke, so the
 * ring carries the same weight as the icons next to it instead of reading as a filled badge.
 * The trigger is a bare 28px hit area that only tints on hover.
 */
const RING_RADIUS = 5.5;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const RING_TRACK = "#e5e7eb";
const RING_FILL = "#98a2b3";

function tokenLabel(value: number | null | undefined): string {
	return typeof value === "number" ? `${formatTokens(value)} tok` : "—";
}

/**
 * Context occupancy between the model picker and the send button.
 *
 * The ring is the only place the window's fill level is visible mid-conversation, and its panel is
 * where the number becomes actionable: compaction is destructive, so it stays behind an explicit
 * confirmation instead of a single click.
 */
export function ContextMeter() {
	const [open, setOpen] = useState(false);
	const [confirmOpen, setConfirmOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement | null>(null);
	const compact = usePiStore((state) => state.compact);
	const compactionStatus = usePiStore((state) => state.compactionStatus);
	const sessionStats = usePiStore((state) => state.sessionStats);
	const contextUsage = usePiStore((state) => state.sessionStats?.contextUsage);
	const running = compactionStatus === "running";
	// pi can only measure the window once a reply has been through it, so right after a
	// compaction the readout is unknown rather than zero.
	const usagePercent = contextUsage?.percent;
	const known = typeof usagePercent === "number";
	const percent = typeof usagePercent === "number" ? usagePercent : 0;

	useEffect(() => {
		if (!open) return;
		const closeOnPointerDown = (event: MouseEvent) => {
			if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
		};
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpen(false);
		};
		document.addEventListener("mousedown", closeOnPointerDown);
		document.addEventListener("keydown", closeOnEscape);
		return () => {
			document.removeEventListener("mousedown", closeOnPointerDown);
			document.removeEventListener("keydown", closeOnEscape);
		};
	}, [open]);

	if (!sessionStats) return null;

	const clamped = Math.max(0, Math.min(100, percent));
	const used = contextUsage?.tokens;
	const capacity = contextUsage?.contextWindow;
	const remaining = typeof used === "number" && typeof capacity === "number" ? Math.max(0, capacity - used) : undefined;

	return (
		<div className="relative shrink-0" ref={rootRef}>
			<button
				aria-expanded={open}
				aria-haspopup="dialog"
				className={`grid h-7 w-7 place-items-center rounded-full transition-colors ${
					open ? "bg-black/[0.08]" : "hover:bg-black/[0.06]"
				}`}
				onClick={() => setOpen((value) => !value)}
				title={known ? `上下文已用 ${clamped.toFixed(0)}%` : "上下文用量未知"}
				type="button"
			>
				{running ? (
					<Loader2 className="animate-spin text-[#8b95a1]" size={14} />
				) : (
					<svg aria-hidden height="14" viewBox="0 0 14 14" width="14">
						<circle cx="7" cy="7" fill="none" r={RING_RADIUS} stroke={RING_TRACK} strokeWidth="2" />
						<circle
							cx="7"
							cy="7"
							fill="none"
							r={RING_RADIUS}
							stroke={RING_FILL}
							strokeDasharray={`${(RING_CIRCUMFERENCE * clamped) / 100} ${RING_CIRCUMFERENCE}`}
							strokeLinecap="round"
							strokeWidth="2"
							transform="rotate(-90 7 7)"
						/>
					</svg>
				)}
			</button>
			<Presence open={open}>
				<div
					className="absolute bottom-[calc(100%+8px)] right-0 z-50 w-[264px] rounded-xl border border-black/[0.06] bg-white p-3 text-[12px] leading-5 text-[#667085] shadow-[0_14px_38px_rgba(15,23,42,0.16)]"
					role="dialog"
				>
					<div className="flex items-center gap-1.5">
						<span>上下文已用</span>
						<span className="font-medium text-[#111827]">{known ? `${clamped.toFixed(0)}%` : "未知"}</span>
						<span className="ml-auto font-medium tabular-nums text-[#111827]">
							{known ? `${formatTokens(used ?? 0)} / ${formatTokens(capacity ?? 0)}` : ""}
						</span>
					</div>
					<div className="my-2.5 flex h-1 overflow-hidden rounded-full bg-black/[0.06]">
						<span className="h-full rounded-full bg-[#98a2b3]" style={{ width: `${clamped}%` }} />
					</div>
					<dl>
						<div className="flex items-center justify-between gap-3 py-0.5">
							<dt>已用</dt>
							<dd className="tabular-nums text-[#111827]">{tokenLabel(used)}</dd>
						</div>
						<div className="flex items-center justify-between gap-3 py-0.5">
							<dt>剩余</dt>
							<dd className="tabular-nums text-[#111827]">{tokenLabel(remaining)}</dd>
						</div>
						<div className="flex items-center justify-between gap-3 py-0.5">
							<dt>上下文窗口</dt>
							<dd className="tabular-nums text-[#111827]">{tokenLabel(capacity)}</dd>
						</div>
					</dl>
					<button
						className={`mt-2.5 w-full ${buttonClass("secondary", "sm")}`}
						onClick={() => {
							setOpen(false);
							setConfirmOpen(true);
						}}
						type="button"
					>
						压缩上下文…
					</button>
				</div>
			</Presence>
			<Modal
				className="w-full max-w-[400px] rounded-2xl border border-black/[0.06] bg-white p-5 shadow-[0_24px_70px_rgba(15,23,42,0.2)]"
				onClose={() => setConfirmOpen(false)}
				open={confirmOpen}
			>
				<>
					<div className="text-[17px] font-semibold tracking-[-0.01em] text-[#111827]">压缩上下文</div>
					<div className="mt-2 text-[13px] leading-5 text-[#667085]">
						{known
							? `当前上下文已用 ${clamped.toFixed(1)}%`
							: "当前上下文用量未知（压缩后需要一次新的回复才能测量）"}
						{known && typeof used === "number" && typeof capacity === "number"
							? `（${formatTokens(used)} / ${formatTokens(capacity)} tok）`
							: ""}
						。压缩会把较早的会话历史总结成摘要，为后续对话腾出空间。
					</div>
					<div className="mt-4 flex justify-end gap-2">
						<button className={buttonClass()} onClick={() => setConfirmOpen(false)} type="button">
							取消
						</button>
						<button
							className={buttonClass("primary")}
							onClick={() => {
								setConfirmOpen(false);
								void compact();
							}}
							type="button"
						>
							压缩
						</button>
					</div>
				</>
			</Modal>
		</div>
	);
}
