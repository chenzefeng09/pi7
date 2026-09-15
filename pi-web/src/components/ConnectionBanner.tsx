import { usePiStore } from "../state/store";
import { t } from "../i18n";

export function ConnectionBanner() {
	const connectionError = usePiStore((state) => state.connectionError);
	const reconnect = usePiStore((state) => state.reconnect);
	const status = usePiStore((state) => state.status);
	if (!connectionError) return null;
	return (
		<div className="flex items-center justify-between gap-4 border-b border-red-200 bg-red-50 px-6 py-2 text-sm text-red-700">
			<span className="truncate">{connectionError}</span>
			<button
				className="shrink-0 rounded-md border border-red-300 bg-white px-3 py-1 font-medium hover:bg-red-100 disabled:opacity-50"
				disabled={status === "starting"}
				onClick={() => void reconnect()}
				type="button"
			>
				{status === "starting" ? t("正在重新连接...") : t("重新连接")}
			</button>
		</div>
	);
}
