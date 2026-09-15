import { Info, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { usePiStore } from "../state/store";
import { t } from "../i18n";

export function ModelChangeBanner() {
	const model = usePiStore((state) => state.model);
	const models = usePiStore((state) => state.models);
	const messageCount = usePiStore((state) => state.messageCount);
	const sessionId = usePiStore((state) => state.sessionId);
	const setModel = usePiStore((state) => state.setModel);
	const [previous, setPrevious] = useState<string | null>(null);
	const lastModelRef = useRef<string | undefined>(model);
	const lastSessionRef = useRef<string | undefined>(sessionId);

	useEffect(() => {
		if (sessionId !== lastSessionRef.current) {
			lastSessionRef.current = sessionId;
			lastModelRef.current = model;
			setPrevious(null);
			return;
		}
		if (model && lastModelRef.current && model !== lastModelRef.current && messageCount > 0) {
			setPrevious(lastModelRef.current);
		}
		lastModelRef.current = model;
	}, [messageCount, model, sessionId]);

	if (!previous || previous === model) return null;
	const previousInfo = models.find((item) => item.id === previous);
	const previousName = previousInfo?.name ?? previous;

	return (
		<div className="flex shrink-0 justify-center px-6 pt-3">
			<div className="flex w-full max-w-[760px] items-start gap-2.5 rounded-2xl border border-black/[0.06] bg-white px-4 py-3 shadow-[0_10px_30px_rgba(15,23,42,0.08)]">
				<Info className="mt-0.5 shrink-0 text-[#667085]" size={16} />
				<div className="min-w-0 flex-1 text-[13px] leading-5 text-[#374151]">
					{t("在对话中途更改模型会降低性能。为获得最佳体验，请开始新会话，或")}<button
						className="font-medium text-[#2f7df6] hover:underline"
						onClick={() => {
							const provider = previousInfo?.provider;
							if (provider) void setModel(provider, previous);
							setPrevious(null);
						}}
						type="button"
					>
						{t("切换回")}{previousName}
					</button>
					{t("。")}</div>
				<button
					className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[#98a2b3] hover:bg-black/[0.05] hover:text-[#4b5563]"
					onClick={() => setPrevious(null)}
					title={t("关闭")}
					type="button"
				>
					<X size={14} />
				</button>
			</div>
		</div>
	);
}
