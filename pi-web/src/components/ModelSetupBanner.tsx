import { Info, X } from "lucide-react";
import { usePiStore } from "../state/store";
import { useUiStore } from "../state/ui";
import { t } from "../i18n";

/**
 * Shown once the model catalog is known to be empty. It guides to settings rather than blocking:
 * the user can dismiss it and still browse sessions; only sending is disabled until a model exists.
 */
export function ModelSetupBanner() {
	const model = usePiStore((state) => state.model);
	const models = usePiStore((state) => state.models);
	const modelsLoaded = usePiStore((state) => state.modelsLoaded);
	const dismissed = useUiStore((state) => state.modelSetupDismissed);
	const setDismissed = useUiStore((state) => state.setModelSetupDismissed);
	const openSettings = useUiStore((state) => state.openSettings);

	if (!modelsLoaded || models.length > 0 || model || dismissed) return null;

	return (
		<div className="flex shrink-0 justify-center px-6 pt-3">
			<div className="flex w-full max-w-[760px] items-start gap-2.5 rounded-2xl border border-black/[0.06] bg-white px-4 py-3 shadow-[0_10px_30px_rgba(15,23,42,0.08)]">
				<Info className="mt-0.5 shrink-0 text-[#667085]" size={16} />
				<div className="min-w-0 flex-1 text-[13px] leading-5 text-[#374151]">
					{t("还没有配置模型，先添加一个供应商或选择一个内置模型，之后就能开始对话。")}
					<button
						className="font-medium text-[#2f7df6] hover:underline"
						onClick={() => openSettings("models")}
						type="button"
					>
						{t("去模型设置")}
					</button>
					{t("。")}
				</div>
				<button
					className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[#98a2b3] hover:bg-black/[0.05] hover:text-[#4b5563]"
					onClick={() => setDismissed(true)}
					title={t("关闭")}
					type="button"
				>
					<X size={14} />
				</button>
			</div>
		</div>
	);
}
