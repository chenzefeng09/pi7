import { ChevronDown } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useState } from "react";
import { t } from "../../i18n";

/**
 * Run state of one conversation flow row.
 *
 * Mirrors the dsh web client's `ToolRowState`: a settled call is `ok` unless it failed, and a
 * call that was interrupted rather than answered is `stopped` (amber) rather than `error` (red),
 * because the user caused it and it is not a failure to report.
 */
export type RowState = "running" | "ok" | "error" | "stopped";

/** Visually hidden run-state text: the dot and the sweep are colour/animation only. */
function statusText(state: RowState): string | undefined {
	if (state === "running") return t("运行中");
	if (state === "error") return t("失败");
	if (state === "stopped") return t("已停止");
	return undefined;
}

/**
 * Status mark: a 10px halo plus a 6px core, the dsh StateDot.
 * @param props.tone - Semantic colour: red failure, amber interruption, green done, grey idle.
 * @param props.size - Outer diameter in px.
 */
export function StateDot({ tone, size = 10 }: { tone: "error" | "warning" | "done" | "idle"; size?: number }) {
	const color =
		tone === "error" ? "#ec1313" : tone === "warning" ? "#f59e0b" : tone === "done" ? "#22c55e" : "#81858c";
	return (
		<span aria-hidden className="relative flex-none" style={{ height: size, width: size }}>
			<span className="absolute inset-0 rounded-full opacity-10" style={{ background: color }} />
			<span className="absolute rounded-full" style={{ background: color, inset: "20%" }} />
		</span>
	);
}

/** Row summary text: one line, ellipsized, in the tertiary tier. */
export function RowSummary({ text, error }: { text: string; error?: boolean }) {
	return (
		<span className={`min-w-0 flex-1 truncate text-[13px] leading-6 ${error ? "text-danger" : "text-ink-subtle"}`}>
			{text}
		</span>
	);
}

/**
 * A secondary tier token wider than a path: the trailing `+N -M` of a file mutation.
 * Mono and two px under the summary so digits read as a count, not as part of the path.
 */
export function RowSuffix({ text }: { text: string }) {
	return <span className="ml-2.5 flex-none font-mono text-[11px] leading-6 text-ink-caption">{text}</span>;
}

export interface DisclosureRowProps {
	/** Expanded body; rendered only while open. */
	children?: ReactNode;
	/** False renders a static row: no chevron, no pointer, no keyboard role. */
	expandable: boolean;
	icon: ReactNode;
	onToggle: () => void;
	open: boolean;
	state: RowState;
	suffix?: ReactNode;
	summary?: ReactNode;
	title: string;
}

/**
 * The shared 24px disclosure header every flow row uses: icon, title, a dot separator, then the
 * summary. Hovering swaps the icon for a chevron; clicking anywhere on the line toggles the body.
 */
export function DisclosureRow({
	children,
	expandable,
	icon,
	onToggle,
	open,
	state,
	suffix,
	summary,
	title,
}: DisclosureRowProps) {
	const leading =
		state === "error" ? (
			<StateDot tone="error" />
		) : state === "stopped" ? (
			<StateDot tone="warning" />
		) : (
			icon
		);
	const toggle = () => {
		if (expandable) onToggle();
	};
	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (!expandable || (event.key !== "Enter" && event.key !== " ")) return;
		event.preventDefault();
		onToggle();
	};
	const status = statusText(state);
	return (
		<div className="flex flex-col" data-row-state={state}>
			{status ? <span className="sr-only">{status}</span> : null}
			<div
				aria-expanded={expandable ? open : undefined}
				className={`group/row relative flex h-6 min-w-0 items-center overflow-hidden rounded-md ${
					expandable ? "cursor-pointer" : ""
				}`}
				data-disclosure-row
				onClick={expandable ? toggle : undefined}
				onKeyDown={onKeyDown}
				role={expandable ? "button" : undefined}
				tabIndex={expandable ? 0 : undefined}
			>
				<span className="relative mr-1.5 flex h-4 w-4 flex-none items-center justify-center text-ink-subtle">
					{open ? (
						<ChevronDown className="text-ink-muted" size={14} />
					) : (
						<>
							<span className="flex transition-opacity duration-100 group-hover/row:opacity-0">{leading}</span>
							{expandable ? (
								<ChevronDown
									className="absolute inset-0 m-auto text-ink-muted opacity-0 transition-opacity duration-100 group-hover/row:opacity-100"
									size={14}
								/>
							) : null}
						</>
					)}
				</span>
				<span className="flex-none text-[13px] leading-6 text-ink-muted">{title}</span>
				{summary ? (
					<>
						<span aria-hidden className="mx-2 h-0.5 w-0.5 flex-none rounded-full bg-ink-caption" />
						{summary}
					</>
				) : null}
				{suffix}
				{state === "running" ? <span aria-hidden className="row-sweep" /> : null}
			</div>
			{open ? children : null}
		</div>
	);
}

/** Expanded card surface shared by every row body. */
export function RowCard({ children, className = "" }: { children: ReactNode; className?: string }) {
	return (
		<div
			className={`mb-1 ml-1 mt-1 overflow-hidden rounded-[12px] border-[0.5px] border-black/[0.06] bg-code text-[12px] leading-[18px] ${className}`}
			data-row-card
		>
			{children}
		</div>
	);
}

/**
 * `… 其余 N 行` toggle under a capped card body, matching the dsh fold control.
 * @param props.hidden - Rows currently elided; the caller renders the head/tail slices.
 */
export function FoldToggle({
	expanded,
	hidden,
	indent = 0,
	onToggle,
}: {
	expanded: boolean;
	hidden: number;
	indent?: number;
	onToggle: () => void;
}) {
	if (!expanded && hidden <= 0) return null;
	return (
		<button
			className="block w-full text-left text-[12px] leading-[18px] text-ink-subtle hover:text-ink-muted"
			onClick={onToggle}
			style={{ paddingLeft: indent }}
			type="button"
		>
			{expanded ? t("收起") : t("… 其余 {hidden} 行", { "hidden": hidden })}
		</button>
	);
}

/** Banner copy affordance used by the read, terminal and diff cards. */
export function CopyButton({ label = t("复制"), text }: { label?: string; text: string }) {
	const [copied, setCopied] = useState(false);
	if (!text) return null;
	return (
		<button
			className="flex-none text-[13px] leading-5 text-ink-muted hover:text-ink"
			onClick={() => {
				void (async () => {
					try {
						await navigator.clipboard.writeText(text);
						setCopied(true);
						window.setTimeout(() => setCopied(false), 1000);
					} catch {}
				})();
			}}
			type="button"
		>
			{copied ? t("复制成功") : label}
		</button>
	);
}
