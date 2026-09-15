import { MessagesSquare, Monitor, Moon, Puzzle, RotateCw, Settings2, SlidersHorizontal, Sun, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useCompactionSettings } from "../state/compaction";
import { MAX_OPEN_SESSIONS, MIN_OPEN_SESSIONS, useSessionPoolSettings } from "../state/session-pool";
import {
	FONT_SIZE_DEFAULT,
	FONT_SIZES,
	type ThemePreference,
	useAppearance,
} from "../state/appearance";
import { usePiStore } from "../state/store";
import { useTranscriptSettings } from "../state/transcript";
import { buttonClass } from "./buttons";
import { Modal } from "./Modal";
import { ModelsSection } from "./ModelsSection";
import { PluginsSection } from "./PluginsSection";
import { SettingsRow, SettingsSelect, SettingsSwitch } from "./SettingsControls";

/**
 * What the runtime reports about this installation. Everything here is read-only, so it belongs to
 * the About dialog rather than to a settings page: a preference screen is for things the user can
 * change, and the paths a build was installed under are not one of them.
 */
interface RuntimeInfo {
	agentDir?: string;
	agentDirSource?: string;
	appVersion?: string;
	cliPath?: string;
	cwd?: string;
	electron?: string;
	nodePath?: string;
}

type SettingsSectionId = "general" | "models" | "plugins" | "session";

/** Appearance cubes, in the harness's order: light, dark, follow the system. */
const THEME_CUBES: Array<{ icon: typeof Sun; label: string; value: ThemePreference }> = [
	{ icon: Sun, label: "浅色", value: "light" },
	{ icon: Moon, label: "深色", value: "dark" },
	{ icon: Monitor, label: "跟随系统", value: "system" },
];

/**
 * The rail's pages. 通用设置 holds how the app looks and how many conversations it keeps warm;
 * everything about how a conversation itself runs — context compaction and how its transcript
 * reads — is 会话设置, so a reader looking for one of those does not have to know which page the
 * app's author happened to file it under.
 */
const SECTIONS: Array<{ icon: typeof Settings2; id: SettingsSectionId; label: string }> = [
	{ icon: Settings2, id: "general", label: "通用设置" },
	{ icon: MessagesSquare, id: "session", label: "会话设置" },
	{ icon: SlidersHorizontal, id: "models", label: "模型设置" },
	{ icon: Puzzle, id: "plugins", label: "插件设置" },
];

/**
 * Settings panel, the harness shell: one 800px card with a section rail on the left and the
 * selected section's rows on the right. Sections are global preferences — the per-session model
 * and permission live in the composer, so nothing here changes only the open conversation.
 */
export function SettingsDialog({ onClose, open }: { onClose: () => void; open: boolean }) {
	const [section, setSection] = useState<SettingsSectionId>("general");
	const theme = useAppearance((state) => state.theme);
	const setTheme = useAppearance((state) => state.setTheme);
	const fontSize = useAppearance((state) => state.fontSize);
	const setFontSize = useAppearance((state) => state.setFontSize);
	const autoCompact = useCompactionSettings((state) => state.autoCompact);
	const setAutoCompact = useCompactionSettings((state) => state.setAutoCompact);
	const setThreshold = useCompactionSettings((state) => state.setThreshold);
	const threshold = useCompactionSettings((state) => state.threshold);
	const openHandles = usePiStore((state) => Object.keys(state.handles).length);
	const enforceSessionPool = usePiStore((state) => state.enforceSessionPool);
	const maxOpenSessions = useSessionPoolSettings((state) => state.maxOpenSessions);
	const setMaxOpenSessions = useSessionPoolSettings((state) => state.setMaxOpenSessions);
	const compactTranscript = useTranscriptSettings((state) => state.compact);
	const setCompactTranscript = useTranscriptSettings((state) => state.setCompact);
	const [runtime, setRuntime] = useState<RuntimeInfo | undefined>(undefined);
	const [portableMessage, setPortableMessage] = useState("");
	const [portableBusy, setPortableBusy] = useState(false);
	const [restarting, setRestarting] = useState(false);

	useEffect(() => {
		if (!open) return;
		void window.pi.getRuntimeInfo().then((value) => {
			if (typeof value === "object" && value !== null) setRuntime(value as RuntimeInfo);
		});
	}, [open]);

	const enablePortable = async () => {
		setPortableBusy(true);
		setPortableMessage("");
		try {
			const result = (await window.pi.enablePortableConfig()) as
				| { copied?: string[]; target?: string }
				| undefined;
			setPortableMessage(`已复制到 ${result?.target ?? "便携目录"}，正在切换…`);
			window.setTimeout(() => window.location.reload(), 1200);
		} catch (error) {
			setPortableMessage(error instanceof Error ? error.message : String(error));
		} finally {
			setPortableBusy(false);
		}
	};

	return (
		<Modal
			className="flex h-[min(800px,calc(100vh-48px))] w-[800px] max-w-[calc(100vw-48px)] flex-col overflow-hidden rounded-[32px] border border-black/[0.06] bg-white shadow-[0_24px_70px_rgba(15,23,42,0.2)] md:flex-row"
			onClose={onClose}
			open={open}
		>
			<nav className="flex w-[188px] shrink-0 flex-col gap-[18px] px-3 pt-[22px]">
				<div className="px-3 text-[16px] font-medium leading-6 text-[#111827]">设置</div>
				<div className="flex flex-col gap-1">
					{SECTIONS.map(({ icon: Icon, id, label }) => (
						<button
							aria-current={section === id ? "true" : undefined}
							className={`flex h-10 items-center gap-2 rounded-xl py-[9px] pl-3 pr-4 text-left text-[14px] leading-[22px] transition-colors ${
								section === id ? "bg-[#ebeef2] text-[#111827]" : "text-[#1f2937] hover:bg-black/[0.04]"
							}`}
							key={id}
							onClick={() => setSection(id)}
							type="button"
						>
							<Icon className="shrink-0 text-[#4b5563]" size={16} />
							<span className="min-w-0 flex-1 truncate">{label}</span>
						</button>
					))}
				</div>
			</nav>
			<div className="flex min-w-0 flex-1 flex-col">
				<div className="flex h-[54px] shrink-0 items-start justify-between gap-2 pb-2 pl-2.5 pr-3.5 pt-5">
					<div className="flex items-center gap-2 text-[12px] text-[#98a2b3]">
						{runtime?.agentDirSource === "home" ? "使用 ~/.pi/agent 配置" : ""}
					</div>
					<button
						className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[#4b5563] transition-colors hover:bg-black/[0.05]"
						onClick={onClose}
						title="关闭"
						type="button"
					>
						<X size={14} />
					</button>
				</div>
				<div className="scrollbar-subtle min-h-0 flex-1 overflow-y-auto px-6 pb-6">
					{section === "general" ? (
						<div className="flex flex-col">
							{/* Appearance, the harness's row: title, then one cube per preference. */}
							<SettingsRow
								description="换主题只改颜色，不改布局；跟随系统时随 Windows 的深浅色切换"
								title="外观"
							>
								<div className="flex items-center gap-2">
									{THEME_CUBES.map(({ icon: Icon, label, value }) => (
										<button
											aria-pressed={theme === value}
											className={`flex w-[86px] flex-col items-center justify-center gap-1 rounded-[14px] border-[0.5px] px-3 py-2.5 text-[12px] transition-colors ${
												theme === value
													? "border-[#adb2b8] bg-[#f5f6f7] text-[#1f2937]"
													: "border-black/[0.12] text-[#475467] hover:bg-black/[0.04]"
											}`}
											key={value}
											onClick={() => setTheme(value)}
											title={label}
											type="button"
										>
											<Icon size={15} />
											{label}
										</button>
									))}
								</div>
							</SettingsRow>
							<SettingsRow
								description="只改文字大小，行高与图标间距不变；和「视图 → 放大/缩小」不同，那个是整体缩放"
								title="字号"
							>
								<SettingsSelect
									minWidth={56}
									onChange={(value) => setFontSize(Number(value))}
									options={FONT_SIZES.map((size) => ({
										label: size === FONT_SIZE_DEFAULT ? `${size} px（默认）` : `${size} px`,
										value: String(size),
									}))}
									title="选择文字大小"
									value={String(fontSize)}
								/>
							</SettingsRow>
							{/* Portable config and restarting the runtime act on the installation rather
							    than on a conversation, so they stay on the general page. */}
							<SettingsRow
								description="把配置、密钥、技能和会话复制到应用目录，换机器或拷 U 盘时一起带走"
								title="便携配置"
							>
								<button
									className={buttonClass("secondary", "sm")}
									disabled={portableBusy}
									onClick={() => void enablePortable()}
									type="button"
								>
									复制到 data\agent
								</button>
							</SettingsRow>
							{portableMessage ? (
								<div className="py-2 text-[11px] text-[#667085]">{portableMessage}</div>
							) : null}
							<SettingsRow
								description="工作区、模型与插件配置在启动时读取，改完需要重启一次"
								title="重启运行时"
							>
								<button
									className={buttonClass("secondary", "sm")}
									disabled={restarting}
									onClick={() => {
										setRestarting(true);
										void window.pi.restart().finally(() => window.setTimeout(() => setRestarting(false), 1500));
									}}
									type="button"
								>
									<RotateCw size={12} />
									{restarting ? "重启中…" : "立即重启"}
								</button>
							</SettingsRow>
						</div>
					) : null}

					{section === "session" ? (
						<div className="flex flex-col">
							<SettingsRow
								description="上下文接近上限时自动整理历史，让对话继续下去"
								title="自动压缩上下文"
							>
								<SettingsSwitch checked={autoCompact} onChange={setAutoCompact} />
							</SettingsRow>
							<SettingsRow
								description={`当前 ${Math.round(threshold * 100)}%，达到后触发自动压缩`}
								title="压缩触发阈值"
							>
								{/* Track, fill and knob are drawn here and positioned from one expression, so the
								    fill can only ever end under the knob; the native input sits on top,
								    invisible, and keeps drag, click and keyboard behaviour. */}
								<div
									className={`relative h-5 w-[220px] rounded-full focus-within:ring-2 focus-within:ring-[#2f7df6]/30 ${
										autoCompact ? "cursor-pointer" : "cursor-default opacity-40"
									}`}
								>
									<div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-black/[0.12]" />
									<div
										className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-[#2f7df6]"
										style={{ width: `calc((100% - 16px) * ${threshold} + 8px)` }}
									/>
									<div
										className="absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-[#2f7df6] shadow-[0_1px_3px_rgba(15,23,42,0.25)]"
										style={{ left: `calc((100% - 16px) * ${threshold})` }}
									/>
									<input
										aria-label="压缩触发阈值"
										className="absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent opacity-0"
										disabled={!autoCompact}
										max={95}
										min={50}
										onChange={(event) => setThreshold(Number(event.target.value) / 100)}
										step={1}
										type="range"
										value={Math.round(threshold * 100)}
									/>
								</div>
							</SettingsRow>
							<SettingsRow
								description="回答结束后把思考与命令折叠成一行摘要，点开可展开；回答过程中始终完整显示"
								title="紧凑会话流"
							>
								<SettingsSwitch checked={compactTranscript} onChange={setCompactTranscript} />
							</SettingsRow>
							<SettingsRow
								description={`同时保留在后台的会话数，超出的空闲会话会被关闭。当前打开 ${openHandles} 个`}
								title="会话缓存上限"
							>
								<SettingsSelect
									onChange={(value) => {
										setMaxOpenSessions(Number(value));
										enforceSessionPool();
									}}
									options={Array.from(
										{ length: MAX_OPEN_SESSIONS - MIN_OPEN_SESSIONS + 1 },
										(_value, index) => MIN_OPEN_SESSIONS + index,
									).map((value) => ({ label: `${value} 个`, value: String(value) }))}
									title="选择同时保留的会话数"
									value={String(maxOpenSessions)}
								/>
							</SettingsRow>
						</div>
					) : null}

					{section === "models" ? <ModelsSection /> : null}

					{section === "plugins" ? <PluginsSection /> : null}
				</div>
			</div>
		</Modal>
	);
}
