import { Brain, RefreshCw } from "lucide-react";
import { usePiStore } from "../state/store";
import { ModelSelector } from "./ModelSelector";
import { t } from "../i18n";

function thinkingLevelLabel(level: string): string {
	const labels: Record<string, string> = {
		off: t("关闭"),
		minimal: t("最低"),
		low: t("低"),
		medium: t("中"),
		high: t("高"),
		xhigh: t("极高"),
		max: t("最高"),
	};
	return labels[level] ?? level;
}

export function StatusBar() {
	const availableThinkingLevels = usePiStore((state) => state.availableThinkingLevels);
	const cycleModel = usePiStore((state) => state.cycleModel);
	const cycleThinkingLevel = usePiStore((state) => state.cycleThinkingLevel);
	const compactionError = usePiStore((state) => state.compactionError);
	const compactionStatus = usePiStore((state) => state.compactionStatus);
	const error = usePiStore((state) => state.error);
	const extensionStatuses = usePiStore((state) => state.extensionUiStatuses);
	const setThinkingLevel = usePiStore((state) => state.setThinkingLevel);
	const sessionStats = usePiStore((state) => state.sessionStats);
	const status = usePiStore((state) => state.status);
	const thinkingLevel = usePiStore((state) => state.thinkingLevel);
	const statusLabel =
		status === "idle"
			? t("空闲")
			: status === "starting"
				? t("启动中")
				: status === "streaming"
					? t("生成中")
					: t("错误");
	return (
		<div className="flex items-center gap-3 border-t border-line bg-canvas px-6 py-1.5 text-xs text-ink-muted">
			<span className="font-medium text-ink">{statusLabel}</span>
			<ModelSelector />
			<button
				className="rounded border border-line p-0.5 hover:bg-surface-hover"
				onClick={() => void cycleModel()}
				title={t("切换模型")}
				type="button"
			>
				<RefreshCw size={12} />
			</button>
			<select
				className="rounded border border-line bg-surface px-1 py-0.5 text-xs"
				onChange={(event) => void setThinkingLevel(event.target.value)}
				value={thinkingLevel ?? ""}
			>
				{thinkingLevel && !availableThinkingLevels.includes(thinkingLevel) ? (
					<option value={thinkingLevel}>{thinkingLevelLabel(thinkingLevel)}</option>
				) : null}
				{availableThinkingLevels.map((level) => (
					<option key={level} value={level}>
						{thinkingLevelLabel(level)}
					</option>
				))}
			</select>
			<button
				className="rounded border border-line p-0.5 hover:bg-surface-hover"
				onClick={() => void cycleThinkingLevel()}
				title={t("切换推理强度")}
				type="button"
			>
				<Brain size={12} />
			</button>
			{sessionStats?.contextUsage?.percent !== null && sessionStats?.contextUsage?.percent !== undefined ? (
				<span>{t("上下文")}{sessionStats.contextUsage.percent.toFixed(0)}%</span>
			) : null}
			{compactionStatus === "running" ? <span className="text-blue-600">{t("正在压缩...")}</span> : null}
			{Object.entries(extensionStatuses)
				.filter(([, text]) => text)
				.map(([key, text]) => (
					<span key={key}>{text}</span>
				))}
			{error ? <span className="text-red-600">{error}</span> : null}
			{compactionError ? <span className="text-red-600">{compactionError}</span> : null}
		</div>
	);
}
