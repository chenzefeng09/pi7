import { useEffect, useState } from "react";
import { usePiStore } from "../state/store";
import type { SessionTreeNode } from "../state/types";
import type { SessionToolMode } from "../state/ui";
import { buttonClass } from "./buttons";
import { Modal } from "./Modal";
import { cacheHitRate, formatPercent, formatTokens } from "./usage";
import { t } from "../i18n";

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function contentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => {
			const record = asRecord(part);
			return typeof record?.text === "string" ? record.text : "";
		})
		.join("");
}

function entrySummary(node: SessionTreeNode): { detail: string; title: string } {
	const entry = node.entry;
	if (entry.type === "message") {
		const message = asRecord(entry.message);
		const role = typeof message?.role === "string" ? message.role : "message";
		const text = contentText(message?.content).trim().replace(/\s+/g, " ");
		const roleLabel = role === "user" ? t("用户") : role === "assistant" ? t("助手") : role;
		return {
			detail: text.slice(0, 180) || entry.id,
			title: node.label ?? roleLabel,
		};
	}
	if (entry.type === "compaction") {
		return { detail: t("上下文已压缩"), title: node.label ?? t("压缩") };
	}
	if (entry.type === "branch_summary") {
		return { detail: t("分支摘要"), title: node.label ?? t("分支摘要") };
	}
	return { detail: entry.id, title: node.label ?? entry.type };
}

function TreeBranch({ node, onFork }: { node: SessionTreeNode; onFork: (entryId: string) => void }) {
	const summary = entrySummary(node);
	const canFork = node.entry.type === "message";
	return (
		<div className="border-l border-line pl-3">
			<div className="mb-2 rounded-lg border border-line bg-surface px-3 py-2">
				<div className="flex items-center justify-between gap-3">
					<div className="min-w-0">
						<div className="text-xs font-medium uppercase tracking-wide text-ink-faint">{summary.title}</div>
						<div className="mt-1 truncate text-sm">{summary.detail}</div>
					</div>
					{canFork ? (
						<button
							className={`shrink-0 ${buttonClass("secondary", "sm")}`}
							onClick={() => onFork(node.entry.id)}
							type="button"
						>
							{t("分叉")}</button>
					) : null}
				</div>
			</div>
			{node.children.map((child) => (
				<TreeBranch key={child.entry.id} node={child} onFork={onFork} />
			))}
		</div>
	);
}

function TokenRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-baseline justify-between gap-4">
			<dt className="text-ink-muted">{label}</dt>
			<dd className="font-mono text-ink">{value}</dd>
		</div>
	);
}

export function SessionToolsDialog({
	mode,
	onClose,
	open,
}: {
	mode: SessionToolMode | null;
	onClose: () => void;
	open: boolean;
}) {
	const cloneSession = usePiStore((state) => state.cloneSession);
	const fork = usePiStore((state) => state.fork);
	const forkMessages = usePiStore((state) => state.forkMessages);
	const loadForkMessages = usePiStore((state) => state.loadForkMessages);
	const loadEntries = usePiStore((state) => state.loadEntries);
	const loadSessionStats = usePiStore((state) => state.loadSessionStats);
	const loadTree = usePiStore((state) => state.loadTree);
	const sessionEntries = usePiStore((state) => state.sessionEntries);
	const sessionStats = usePiStore((state) => state.sessionStats);
	const sessionTree = usePiStore((state) => state.sessionTree);
	// Keeps the last opened page on screen while the dialog animates out.
	const [lastMode, setLastMode] = useState<SessionToolMode>(mode ?? "stats");
	const hitRate = sessionStats ? cacheHitRate(sessionStats.tokens) : undefined;

	useEffect(() => {
		if (mode) setLastMode(mode);
	}, [mode]);

	const active = mode ?? lastMode;

	useEffect(() => {
		if (!open) return;
		if (active === "fork") void loadForkMessages();
		if (active === "entries") void loadEntries();
		if (active === "tree") void loadTree();
		if (active === "stats") void loadSessionStats();
	}, [active, loadEntries, loadForkMessages, loadSessionStats, loadTree, open]);

	const title =
		active === "fork"
			? t("分叉会话")
			: active === "tree"
				? t("会话树")
				: active === "entries"
					? t("会话记录")
					: t("会话统计");

	return (
		<Modal
			className="flex max-h-[82vh] w-full max-w-[720px] flex-col rounded-xl border border-line bg-surface shadow-lg"
			onClose={onClose}
			open={open}
		>
			<>
				<div className="flex items-center justify-between border-b border-line px-5 py-3">
					<div className="text-base font-semibold">{title}</div>
					<button
						className="rounded px-2 py-1 text-sm text-ink-muted hover:bg-surface-hover"
						onClick={onClose}
						type="button"
					>
						{t("关闭")}</button>
				</div>
				<div className="overflow-y-auto p-5">
					{active === "fork" ? (
						<div className="space-y-2">
							{forkMessages.map((message) => (
								<div
									className="flex items-start justify-between gap-3 rounded-lg border border-line px-3 py-2"
									key={message.entryId}
								>
									<div className="min-w-0 text-sm">{message.text}</div>
									<button
										className={`shrink-0 ${buttonClass("primary", "sm")}`}
										onClick={() =>
											void fork(message.entryId).then(() => {
												onClose();
											})
										}
										type="button"
									>
										{t("从此处分叉")}</button>
								</div>
							))}
							{forkMessages.length === 0 ? (
								<div className="py-8 text-center text-sm text-ink-faint">{t("暂无可分叉的用户消息。")}</div>
							) : null}
							<button
								className={`mt-4 w-full ${buttonClass()}`}
								onClick={() =>
									void cloneSession().then(() => {
										onClose();
									})
								}
								type="button"
							>
								{t("克隆当前分支")}</button>
						</div>
					) : null}
					{active === "tree" ? (
						<div className="space-y-2">
							{sessionTree.map((node) => (
								<TreeBranch
									key={node.entry.id}
									node={node}
									onFork={(entryId) =>
										void fork(entryId).then(() => {
											onClose();
										})
									}
								/>
							))}
							{sessionTree.length === 0 ? (
								<div className="py-8 text-center text-sm text-ink-faint">{t("会话树为空。")}</div>
							) : null}
						</div>
					) : null}
					{active === "entries" ? (
						<pre className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-line bg-surface-muted p-3 font-mono text-xs">
							{JSON.stringify(sessionEntries, null, 2)}
						</pre>
					) : null}
					{active === "stats" ? (
						<div className="space-y-4">
							{sessionStats ? (
								<>
									<div className="grid grid-cols-2 gap-2 text-sm">
										<div className="rounded-lg border border-line p-3">
											<div className="text-xs text-ink-faint">{t("消息数")}</div>
											<div>{sessionStats.totalMessages}</div>
										</div>
										<div className="rounded-lg border border-line p-3">
											<div className="text-xs text-ink-faint">{t("工具调用")}</div>
											<div>{sessionStats.toolCalls}</div>
										</div>
										<div className="rounded-lg border border-line p-3">
											<div className="text-xs text-ink-faint">{t("Token 数")}</div>
											<div>{sessionStats.tokens.total.toLocaleString()}</div>
										</div>
										<div className="rounded-lg border border-line p-3">
											<div className="text-xs text-ink-faint">{t("上下文")}</div>
											<div>
												{sessionStats.contextUsage?.percent === null ||
												sessionStats.contextUsage?.percent === undefined
													? t("未知")
													: `${sessionStats.contextUsage.percent.toFixed(1)}%`}
											</div>
										</div>
									</div>
									{/* The same breakdown Codex shows behind its token readout: where the traffic
									    went, and how much of the prompt never had to be processed fresh. */}
									<div className="rounded-lg border border-line p-3">
										<div className="flex items-baseline justify-between text-sm">
											<span className="font-medium text-ink">{t("Token 用量")}</span>
											<span className="font-semibold">
												{sessionStats.tokens.total.toLocaleString()} tok
											</span>
										</div>
										<dl className="mt-3 space-y-1.5 border-t border-line pt-3 text-[13px]">
											<TokenRow
												label={t("缓存命中")}
												value={
													hitRate === undefined ? "—" : formatPercent(hitRate)
												}
											/>
											<TokenRow
												label={t("未缓存输入")}
												value={`${sessionStats.tokens.input.toLocaleString()} tok`}
											/>
											<TokenRow
												label={t("缓存读取")}
												value={`${sessionStats.tokens.cacheRead.toLocaleString()} tok`}
											/>
											<TokenRow
												label={t("缓存写入")}
												value={`${sessionStats.tokens.cacheWrite.toLocaleString()} tok`}
											/>
											<TokenRow
												label={t("输出")}
												value={`${sessionStats.tokens.output.toLocaleString()} tok`}
											/>
											<TokenRow
												label={t("上下文窗口")}
												value={
													sessionStats.contextUsage
														? `${formatTokens(sessionStats.contextUsage.tokens ?? 0)} / ${formatTokens(sessionStats.contextUsage.contextWindow)}`
														: t("未知")
												}
											/>
										</dl>
									</div>
								</>
							) : (
								<div className="text-sm text-ink-faint">{t("正在加载统计...")}</div>
							)}
						</div>
					) : null}
				</div>
			</>
		</Modal>
	);
}
