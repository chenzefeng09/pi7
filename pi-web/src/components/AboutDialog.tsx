import { useEffect, useState } from "react";
import { buttonClass } from "./buttons";
import { Modal } from "./Modal";
import { t } from "../i18n";

interface RuntimeInfo {
	agentDir?: string;
	agentDirSource?: string;
	appVersion?: string;
	chrome?: string;
	cliPath?: string;
	cwd?: string;
	electron?: string;
	isPackaged?: boolean;
	nodePath?: string;
}

const SOURCE_LABELS: Record<string, string> = {
	bundled: t("随应用打包的 config/agent"),
	env: t("环境变量 PI_CODING_AGENT_DIR"),
	home: t("用户目录默认 ~/.pi/agent"),
	portable: t("便携目录 data\\agent"),
};

function Row({ hint, label, value, mono }: { hint?: string; label: string; value: string; mono?: boolean }) {
	return (
		<div className="flex items-start gap-3 text-[12px] leading-5">
			<span className="w-[72px] shrink-0 text-[#98a2b3]">{label}</span>
			<span className={`min-w-0 flex-1 break-all text-[#374151] ${mono ? "font-mono text-[11px]" : ""}`}>
				{value}
				{hint ? <span className="ml-2 font-sans text-[11px] text-[#98a2b3]">{hint}</span> : null}
			</span>
		</div>
	);
}

export function AboutDialog({ onClose, open }: { onClose: () => void; open: boolean }) {
	const [info, setInfo] = useState<RuntimeInfo | undefined>(undefined);

	useEffect(() => {
		let disposed = false;
		void window.pi
			.getRuntimeInfo()
			.then((value) => {
				if (!disposed && typeof value === "object" && value !== null) setInfo(value as RuntimeInfo);
			})
			.catch(() => {});
		return () => {
			disposed = true;
		};
	}, []);

	return (
		<Modal
			className="w-full max-w-[440px] rounded-2xl border border-black/[0.06] bg-white p-6 text-center shadow-[0_24px_70px_rgba(15,23,42,0.2)]"
			onClose={onClose}
			open={open}
		>
			<div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-black/[0.08] bg-[#f7f8f7] text-[24px] font-bold tracking-[-0.02em] text-[#1f2937]">
				π7
			</div>
			<div className="mt-4 text-[20px] font-semibold tracking-[-0.02em] text-[#111827]">π7</div>
			<div className="mt-1 text-[13px] text-[#667085]">{t("Pi Agent 的 Win7 兼容版")}</div>
			<div className="mt-1 text-[12px] text-[#98a2b3]">{t("版本")}{info?.appVersion ?? "0.1.0"}</div>

			{/* The installation's own paths: the settings pages hold what can be changed, so the
			    read-only half of that picture lives here, next to the version it belongs to. */}
			<div className="mt-5 space-y-1.5 rounded-xl border border-black/[0.06] bg-[#fafbfa] p-3 text-left">
				<Row
					label={t("运行环境")}
					value={`Electron ${info?.electron ?? "?"} · Chromium ${info?.chrome ?? "?"}`}
				/>
				<Row label="Node" mono value={info?.nodePath ?? t("未连接")} />
				<Row label={t("Pi 运行时")} mono value={info?.cliPath ?? t("未连接")} />
				<Row
					hint={SOURCE_LABELS[info?.agentDirSource ?? ""] ?? info?.agentDirSource}
					label={t("配置目录")}
					mono
					value={info?.agentDir ?? t("未连接")}
				/>
				<Row label={t("工作区")} mono value={info?.cwd ?? t("未连接")} />
			</div>

			<div className="mt-4 text-[11px] text-[#98a2b3]">© chenzefeng · MIT</div>
			<div className="mt-1 text-[11px] text-[#c0c6cf]">{t("基于 pi · © Mario Zechner")}</div>

			<button
				className={`mt-4 h-9 w-full rounded-xl ${buttonClass("primary")}`}
				onClick={onClose}
				type="button"
			>
				{t("确定")}</button>
		</Modal>
	);
}
