import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import type { MessageUsage } from "../state/types";
import { ClockIcon, DatabaseIcon } from "./StatIcons";
import { cacheHitRate, formatDuration, formatPercent, formatTokens } from "./usage";

/** Turn usage as the pill and its dialog read it: summed buckets plus the call count. */
export interface TurnUsageView extends MessageUsage {
	/** Provider calls the turn made; the pill's dialog names the model once per turn. */
	steps: number;
}

/** Distance between the trigger's top edge and the panel's bottom, and the viewport margin. */
const PANEL_GAP = 8;
const PANEL_MARGIN = 12;

/**
 * Trigger-anchored stat panel.
 *
 * The harness portals this above the pill it belongs to and clamps it inside the viewport
 * (`useAnchoredPosition` in `stat-dialog.ts`): the numbers are about the row underneath, so they
 * belong next to it rather than in the middle of the screen behind a dimming overlay. Placement is
 * measured after mount, and the measurement pass keeps the panel invisible until it is placed, so
 * it never paints at the wrong spot first.
 */
function StatPanel({
	children,
	open,
	onClose,
	trigger,
}: {
	children: ReactNode;
	onClose: () => void;
	open: boolean;
	trigger: React.RefObject<HTMLSpanElement | null>;
}) {
	const panel = useRef<HTMLDivElement | null>(null);
	const [pos, setPos] = useState<{ left: number; top: number; visible: boolean } | null>(null);

	useLayoutEffect(() => {
		if (!open) {
			setPos(null);
			return;
		}
		const anchor = trigger.current?.getBoundingClientRect();
		const box = panel.current?.getBoundingClientRect();
		if (!anchor || !box) return;
		const maxLeft = Math.max(PANEL_MARGIN, window.innerWidth - box.width - PANEL_MARGIN);
		const left = Math.min(Math.max(PANEL_MARGIN, anchor.left), maxLeft);
		// Below the trigger when there is not enough room above it, which is what keeps a pill near
		// the top of the window from pushing its panel off-screen.
		const above = anchor.top - box.height - PANEL_GAP;
		const top = above >= PANEL_MARGIN ? above : Math.min(anchor.bottom + PANEL_GAP, window.innerHeight - box.height - PANEL_MARGIN);
		setPos({ left, top, visible: true });
	}, [open, trigger]);

	useEffect(() => {
		if (!open) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		const onPointerDown = (event: MouseEvent) => {
			const target = event.target as Node;
			if (panel.current?.contains(target) || trigger.current?.contains(target)) return;
			onClose();
		};
		document.addEventListener("keydown", onKeyDown);
		document.addEventListener("mousedown", onPointerDown);
		return () => {
			document.removeEventListener("keydown", onKeyDown);
			document.removeEventListener("mousedown", onPointerDown);
		};
	}, [onClose, open, trigger]);

	if (!open) return null;
	return createPortal(
		<div
			className="fixed z-[1100] w-max min-w-[300px] max-w-[min(440px,calc(100vw-24px))] rounded-xl border-[0.5px] border-black/[0.1] bg-white p-4 text-[12px] leading-[18px] text-ink-muted shadow-[0_18px_50px_rgba(15,23,42,0.18)]"
			ref={panel}
			role="dialog"
			style={{
				left: pos?.left ?? 0,
				top: pos?.top ?? 0,
				visibility: pos?.visible ? "visible" : "hidden",
			}}
		>
			{children}
		</div>,
		document.body,
	);
}

/** Dialog heading: the section name left, its headline value right. */
function PanelTitle({ children, icon, value }: { children: ReactNode; icon: ReactNode; value: string }) {
	return (
		<>
			<div className="flex items-center justify-between gap-4 font-medium text-[#1f2937]">
				<span className="flex min-w-0 items-center gap-1.5">
					<span className="text-[#98a2b3]">{icon}</span>
					{children}
				</span>
				<span className="tabular-nums">{value}</span>
			</div>
			<div className="mb-2.5 mt-2 border-t-[0.5px] border-black/[0.06]" />
		</>
	);
}

/** One label/value row: label left in the tertiary tier, value right-aligned and secondary. */
function PanelRow({ label, value }: { label: string; value: ReactNode }) {
	return (
		<>
			<dt className="min-w-0 text-[#98a2b3]">{label}</dt>
			<dd className="min-w-0 break-words text-right tabular-nums text-[#1f2937]">{value}</dd>
		</>
	);
}

/**
 * Turn usage pill: a database glyph plus the turn's token total, opening the usage breakdown.
 *
 * The label is what the harness shows there — the whole turn's bill in one number — and the
 * breakdown is where the input / cache / output split lives, so the row itself stays one line.
 */
export function TurnUsagePill({ model, usage }: { model?: string; usage: TurnUsageView }) {
	const [open, setOpen] = useState(false);
	const root = useRef<HTMLSpanElement | null>(null);
	const hitRate = cacheHitRate(usage);
	return (
		<span className="inline-flex min-w-0" ref={root}>
			<StatPill
				expanded={open}
				icon={<DatabaseIcon />}
				label={`用量 ${formatTokens(usage.total)} tok`}
				title="本轮用量"
				onClick={() => setOpen((value) => !value)}
			/>
			<StatPanel onClose={() => setOpen(false)} open={open} trigger={root}>
				<PanelTitle icon={<DatabaseIcon size={14} />} value={`${usage.total.toLocaleString()} tok`}>
					本轮用量
				</PanelTitle>
				<dl className="grid grid-cols-[minmax(76px,auto)_minmax(0,1fr)] gap-x-4 gap-y-1.5">
					{model ? <PanelRow label="提供方 / 模型" value={model} /> : null}
					{hitRate === undefined ? null : <PanelRow label="缓存命中" value={formatPercent(hitRate, 1)} />}
					<PanelRow label="未缓存输入" value={`${usage.input.toLocaleString()} tok`} />
					<PanelRow label="缓存读取" value={`${usage.cacheRead.toLocaleString()} tok`} />
					<PanelRow label="缓存写入" value={`${usage.cacheWrite.toLocaleString()} tok`} />
					<PanelRow label="输出" value={`${usage.output.toLocaleString()} tok`} />
				</dl>
			</StatPanel>
		</span>
	);
}

/**
 * Turn time pill: a clock glyph plus how long the turn took, opening the timing breakdown.
 *
 * `tokensPerSecond` belongs to the turn the runtime is on; a replaced or restored turn has no rate
 * to report, and a turn whose first token was never seen has no TTFT, so those rows are simply
 * absent.
 */
export function TurnTimePill({
	durationMs,
	tokensPerSecond,
	ttftMs,
}: {
	durationMs: number;
	tokensPerSecond?: number;
	ttftMs?: number;
}) {
	const [open, setOpen] = useState(false);
	const root = useRef<HTMLSpanElement | null>(null);
	return (
		<span className="inline-flex min-w-0" ref={root}>
			<StatPill
				expanded={open}
				icon={<ClockIcon />}
				label={`用时 ${formatDuration(durationMs)}`}
				title="本轮用时和速度"
				onClick={() => setOpen((value) => !value)}
			/>
			<StatPanel onClose={() => setOpen(false)} open={open} trigger={root}>
				<PanelTitle icon={<ClockIcon size={14} />} value={formatDuration(durationMs)}>
					本轮用时和速度
				</PanelTitle>
				<dl className="grid grid-cols-[minmax(76px,auto)_minmax(0,1fr)] gap-x-4 gap-y-1.5">
					<PanelRow label="本轮总用时" value={formatDuration(durationMs)} />
					{tokensPerSecond === undefined ? null : (
						<PanelRow label="生成速度" value={`${Math.round(tokensPerSecond)} tok/s`} />
					)}
					{ttftMs === undefined ? null : <PanelRow label="首 token 用时（TTFT）" value={formatDuration(ttftMs)} />}
				</dl>
			</StatPanel>
		</span>
	);
}

/**
 * The pill both stat triggers share: 28px tall, 6px/8px padding, 4px between glyph and label,
 * tabular figures, tertiary text that turns secondary over a hover fill — the harness's
 * TurnUsagePanel geometry, which is the icon buttons beside it widened to carry a label.
 */
function StatPill({
	expanded,
	icon,
	label,
	onClick,
	title,
}: {
	expanded: boolean;
	icon: ReactNode;
	label: string;
	onClick: () => void;
	title: string;
}) {
	return (
		<button
			aria-expanded={expanded}
			aria-haspopup="dialog"
			className={`flex h-7 min-w-0 items-center gap-1 rounded-full px-2 text-[12px] leading-6 tabular-nums transition-colors ${
				expanded ? "bg-black/[0.06] text-ink-muted" : "text-ink-subtle hover:bg-black/[0.05] hover:text-ink-muted"
			}`}
			onClick={onClick}
			title={title}
			type="button"
		>
			<span className="shrink-0">{icon}</span>
			<span className="min-w-0 truncate">{label}</span>
		</button>
	);
}
