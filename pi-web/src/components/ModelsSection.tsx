import { Check, ChevronDown, Download, Plus, Trash2, Upload, X } from "lucide-react";
import { useEffect, useState } from "react";
import { usePiStore } from "../state/store";
import type { ModelInfo } from "../state/types";
import { clampThinkingLevel } from "../lib/thinking";
import { buttonClass } from "./buttons";
import { Modal } from "./Modal";
import {
	draftOfProvider,
	emptyProviderDraft,
	type ProviderDraft,
	ProviderEditor,
	providerPatchOf,
} from "./ProviderEditor";
import { SettingsPill, SettingsRow, SettingsSelect } from "./SettingsControls";

/** One custom provider as the main process reports it — never with the key itself. */
interface ProviderView {
	api?: string;
	baseUrl?: string;
	credential: "command" | "env" | "literal" | "none";
	credentialHint?: string;
	id: string;
	models: Array<{
		contextWindow?: number;
		id: string;
		input?: string[];
		maxTokens?: number;
		name?: string;
		reasoning?: boolean;
		samplingParams?: Record<string, unknown>;
	}>;
	name?: string;
}

interface ModelConfigView {
	defaultModel?: string;
	defaultProvider?: string;
	defaultThinkingLevel?: string;
	enabledModels: string[];
	providers: ProviderView[];
}

const CREDENTIAL_LABEL: Record<ProviderView["credential"], string> = {
	command: "命令",
	env: "环境变量",
	literal: "密钥",
	none: "未配置",
};

const THINKING_LABEL: Record<string, string> = {
	high: "高",
	low: "低",
	max: "最高",
	medium: "中",
	minimal: "最低",
	off: "关闭",
	xhigh: "极高",
};

/** pi's order, from no thinking to the most (`packages/ai/src/models.ts`). */
const LEVEL_ORDER = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

/**
 * The levels one model actually takes, by pi's own rule: a level mapped to `null` is unsupported,
 * `xhigh`/`max` count only when the model names them, a non-reasoning model has just `off`, and
 * two levels that map to the same provider value are one choice (DeepSeek maps 最低 onto Low).
 */
function thinkingLevelsOf(model: ModelInfo | undefined): string[] {
	if (!model?.reasoning) return ["off"];
	const supported = LEVEL_ORDER.filter((level) => {
		const mapped = model.thinkingLevelMap?.[level];
		if (mapped === null) return false;
		if ((level === "xhigh" || level === "max") && mapped === undefined) return false;
		return true;
	});
	// Two levels that mean the same to the provider are one choice, and the one worth showing is
	// the one named like the provider's value: DeepSeek's 最低 is just Low.
	const byValue = new Map<string, string>();
	for (const level of supported) {
		const value = model.thinkingLevelMap?.[level] ?? level;
		if (!byValue.has(value) || level === value) byValue.set(value, level);
	}
	const chosen = new Set(byValue.values());
	return LEVEL_ORDER.filter((level) => chosen.has(level));
}

/**
 * Model settings: the installation's models rather than one conversation's.
 *
 * Writes the default model for new sessions, the glob rules that scope the catalog, and the
 * custom providers in the agent's own `models.json`. Keys never come back into the renderer: the
 * main process reports only whether one is configured and of what kind.
 */
export function ModelsSection() {
	const currentModelId = usePiStore((state) => state.model);
	const models = usePiStore((state) => state.models);
	const [config, setConfig] = useState<ModelConfigView | undefined>(undefined);
	const [modelQuery, setModelQuery] = useState("");
	const [pickerOpen, setPickerOpen] = useState(false);
	const [providerDraft, setProviderDraft] = useState<ProviderDraft | undefined>(undefined);
	const [editingProvider, setEditingProvider] = useState<string | undefined>(undefined);
	const [busy, setBusy] = useState(false);
	const [notice, setNotice] = useState("");
	const [failure, setFailure] = useState("");

	// The bridge methods ship with the main process, so a renderer newer than the running app has
	// to say so instead of calling into nothing (which unmounts the whole tree).
	const bridgeReady =
		typeof window.pi.readModelConfig === "function" && typeof window.pi.writeModelConfig === "function";

	useEffect(() => {
		if (!bridgeReady) {
			setFailure("模型设置需要重启 π7 后可用。");
			return;
		}
		void window.pi
			.readModelConfig()
			.then((value) => setConfig(value as ModelConfigView))
			.catch((error: unknown) =>
				setFailure(error instanceof Error ? error.message : "无法读取模型配置，重启 π7 后再试。"),
			);
	}, [bridgeReady]);

	const save = async (patch: Record<string, unknown>, message = "已保存，重启运行时后生效") => {
		if (!bridgeReady) {
			setNotice("模型设置需要重启 π7 后可用。");
			return;
		}
		setBusy(true);
		try {
			setConfig((await window.pi.writeModelConfig(patch)) as ModelConfigView);
			setNotice(message);
		} catch (error) {
			setNotice(error instanceof Error ? error.message : String(error));
		} finally {
			setBusy(false);
		}
	};

	/** Export or import the whole model configuration as one file. */
	const transfer = async (direction: "export" | "import") => {
		if (
			typeof window.pi.exportModelConfig !== "function" ||
			typeof window.pi.importModelConfig !== "function"
		) {
			setNotice("导入导出需要重启 π7 后可用。");
			return;
		}
		setBusy(true);
		try {
			if (direction === "export") {
				const result = (await window.pi.exportModelConfig()) as
					| { canceled?: boolean; path?: string; providers?: number; redactedKeys?: number }
					| undefined;
				if (result?.canceled) return;
				setNotice(
					`已导出 ${String(result?.providers ?? 0)} 个供应商到 ${result?.path ?? ""}${
						result?.redactedKeys ? `；${String(result.redactedKeys)} 个明文密钥未写入，需在新环境重新填写` : ""
					}`,
				);
				return;
			}
			const result = (await window.pi.importModelConfig()) as
				| {
						added?: string[];
						canceled?: boolean;
						defaultsApplied?: boolean;
						error?: string;
						keptKeys?: string[];
						path?: string;
						replaced?: string[];
				  }
				| undefined;
			if (result?.canceled) return;
			if (result?.error) {
				setNotice(`导入失败：${result.error}`);
				return;
			}
			setConfig((await window.pi.readModelConfig()) as ModelConfigView);
			setNotice(
				`已从 ${result?.path ?? ""} 导入：新增 ${String(result?.added?.length ?? 0)} 个、覆盖 ${String(
					result?.replaced?.length ?? 0,
				)} 个供应商${result?.defaultsApplied ? "，默认模型已更新" : ""}${
					result?.keptKeys?.length ? "；文件中没有的密钥沿用了原有值" : ""
				}`,
			);
		} catch (error) {
			setNotice(error instanceof Error ? error.message : String(error));
		} finally {
			setBusy(false);
		}
	};

	if (!config) return <div className="py-4 text-[12px] text-[#98a2b3]">{failure || "读取模型配置…"}</div>;

	const selected = models.findIndex(
		(model) => model.id === config.defaultModel && model.provider === config.defaultProvider,
	);
	const query = modelQuery.trim().toLowerCase();
	const filteredModels = (
		query
			? models.filter((model) =>
					`${model.provider}/${model.id} ${model.name ?? ""}`.toLowerCase().includes(query),
				)
			: models
	).slice(0, 60);

	// The default model decides which levels exist; before one is chosen the session's own model
	// answers, and if even that is unknown every level stays on offer.
	const levelsSource =
		models.find((model) => model.id === config.defaultModel && model.provider === config.defaultProvider) ??
		models.find((model) => model.id === currentModelId);
	const thinkingOptions = thinkingLevelsOf(levelsSource);
	// pi's own default is medium; show what a new session would really use instead of a "pi 默认"
	// entry, which only raised the question of what it meant.
	const requestedThinkingLevel =
		config.defaultThinkingLevel ?? (thinkingOptions.includes("medium") ? "medium" : (thinkingOptions[0] ?? "medium"));
	// A stored level the model does not take is not an error: pi runs the nearest level it does, so
	// the row shows that one and says what was asked for.
	const effectiveThinkingLevel = thinkingOptions.includes(requestedThinkingLevel)
		? requestedThinkingLevel
		: clampThinkingLevel(thinkingOptions, requestedThinkingLevel);

	return (
		<div className="flex flex-col">
			<SettingsRow
				description={
					config.defaultProvider ? `${config.defaultProvider} / ${config.defaultModel}` : "新会话使用 pi 自己的默认值"
				}
				title="默认模型"
			>
				<div className="relative">
					<SettingsPill disabled={busy} onClick={() => setPickerOpen((value) => !value)} title="选择默认模型">
						<span className="max-w-[240px] truncate">
							{selected >= 0 ? (models[selected].name ?? models[selected].id) : (config.defaultModel ?? "未设置")}
						</span>
						<ChevronDown className="text-[#98a2b3]" size={14} />
					</SettingsPill>
					{pickerOpen ? (
						<div className="absolute right-0 top-11 z-20 w-[340px] overflow-hidden rounded-xl border border-black/[0.08] bg-white shadow-[0_18px_50px_rgba(15,23,42,0.18)]">
							<div className="border-b border-black/[0.06] p-1.5">
								<input
									autoFocus
									className="h-8 w-full rounded-lg px-2 text-[13px] outline-none placeholder:text-[#98a2b3]"
									onChange={(event) => setModelQuery(event.target.value)}
									placeholder="搜索模型或供应商"
									value={modelQuery}
								/>
							</div>
							<div className="scrollbar-subtle max-h-64 overflow-y-auto p-1">
								{filteredModels.map((model) => (
									<button
										className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-black/[0.04]"
										key={`${model.provider}/${model.id}`}
										onClick={() => {
											setPickerOpen(false);
											void save({ defaultModel: model.id, defaultProvider: model.provider }, "已保存默认模型");
										}}
										type="button"
									>
										<span className="min-w-0 flex-1 truncate text-[13px] text-[#1f2937]">
											{model.name ?? model.id}
										</span>
										<span className="shrink-0 text-[11px] text-[#98a2b3]">{model.provider}</span>
									</button>
								))}
								{filteredModels.length === 0 ? (
									<div className="px-2 py-4 text-center text-[12px] text-[#98a2b3]">没有匹配的模型</div>
								) : null}
							</div>
							<div className="flex items-center justify-between border-t border-black/[0.06] px-2 py-1.5">
								<button
									className="text-[11px] text-[#98a2b3] hover:text-[#4b5563]"
									onClick={() => {
										setPickerOpen(false);
										void save({ defaultModel: "", defaultProvider: "" }, "已清除默认模型");
									}}
									type="button"
								>
									清除默认模型
								</button>
								<span className="text-[11px] text-[#c0c6cd]">
									{query ? `${filteredModels.length} 个匹配` : `${models.length} 个可选`}
								</span>
							</div>
						</div>
					) : null}
				</div>
			</SettingsRow>

			<SettingsRow
				description={
					effectiveThinkingLevel === requestedThinkingLevel
						? `新会话默认使用的推理强度；可选范围由默认模型决定（${thinkingOptions.map((level) => THINKING_LABEL[level] ?? level).join(" / ")}）`
						: `默认模型不支持「${THINKING_LABEL[requestedThinkingLevel] ?? requestedThinkingLevel}」，实际使用「${THINKING_LABEL[effectiveThinkingLevel] ?? effectiveThinkingLevel}」；可选范围（${thinkingOptions.map((level) => THINKING_LABEL[level] ?? level).join(" / ")}）`
				}
				title="默认推理强度"
			>
				<SettingsSelect
					disabled={busy}
					minWidth={72}
					onChange={(level) => void save({ defaultThinkingLevel: level }, "已保存推理强度")}
					options={thinkingOptions.map((level) => ({ label: THINKING_LABEL[level] ?? level, value: level }))}
					title="选择默认推理强度"
					value={effectiveThinkingLevel}
				/>
			</SettingsRow>

			<div className="flex flex-col gap-3 py-4">
				<div className="flex items-center gap-3">
					<div className="flex min-w-0 flex-1 flex-col gap-1">
						<div className="text-[14px] leading-[22px] text-[#1f2937]">自定义供应商</div>
						<div className="text-[12px] leading-[18px] text-[#98a2b3]">
							写在配置目录的 <span className="font-mono">models.json</span>；pi 内置目录里的供应商无需在这里配置。
						</div>
					</div>
					<button
						className="flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12px] text-[#667085] transition-colors hover:bg-black/[0.05] hover:text-[#1f2937]"
						onClick={() => void transfer("export")}
						title="把所有自定义供应商与默认模型导出成一个 JSON 文件（不含明文密钥）"
						type="button"
					>
						<Upload size={14} />
						导出
					</button>
					<button
						className="flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12px] text-[#667085] transition-colors hover:bg-black/[0.05] hover:text-[#1f2937]"
						onClick={() => void transfer("import")}
						title="从导出的 JSON 文件合并供应商与默认模型；已存在的同名供应商会被覆盖"
						type="button"
					>
						<Download size={14} />
						导入
					</button>
					{/* The form is a place you go to, not a permanent part of the page: the + opens it. */}
					<button
						className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#6b7280] transition-colors hover:bg-black/[0.05]"
						onClick={() => {
							setEditingProvider(undefined);
							setProviderDraft(emptyProviderDraft());
						}}
						title="新增供应商"
						type="button"
					>
						<Plus size={16} />
					</button>
				</div>

				{config.providers.map((provider) => (
					<div
						className="flex flex-col gap-1 rounded-xl border-[0.5px] border-black/[0.08] px-3.5 py-3"
						key={provider.id}
					>
						<div className="flex items-center gap-2">
							<span
								className={`h-1.5 w-1.5 shrink-0 rounded-full ${
									provider.credential === "none" ? "bg-[#f04438]" : "bg-[#22c55e]"
								}`}
								title={`凭证：${CREDENTIAL_LABEL[provider.credential]}${
									provider.credentialHint ? ` ${provider.credentialHint}` : ""
								}`}
							/>
							<span className="min-w-0 truncate text-[14px] text-[#1f2937]">
								{provider.name ?? provider.id}
							</span>
							<span className="shrink-0 rounded bg-[#f5f6f7] px-1.5 py-0.5 font-mono text-[10px] text-[#667085]">
								{provider.id}
							</span>
							<span className="min-w-0 flex-1 truncate text-[12px] text-[#98a2b3]">
								{provider.models.length} 个模型 · {provider.api ?? "api 未设置"}
							</span>
							<button
								className="shrink-0 rounded-full px-2 py-0.5 text-[11px] text-[#667085] hover:bg-black/[0.04] hover:text-[#1f2937]"
								onClick={() => {
									setEditingProvider(provider.id);
									setProviderDraft(draftOfProvider(provider));
								}}
								title="编辑该供应商及其模型"
								type="button"
							>
								编辑
							</button>
							<button
								className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[#b6bcc4] hover:bg-black/[0.04] hover:text-[#d92d20]"
								onClick={() => void save({ providers: [{ id: provider.id, removed: true }] }, "已删除供应商")}
								title="删除该供应商"
								type="button"
							>
								<Trash2 size={12} />
							</button>
						</div>
						<div className="break-all font-mono text-[11px] text-[#98a2b3]">
							{provider.baseUrl ?? "未设置 baseUrl"}
						</div>
						{provider.models.length > 0 ? (
							<div className="text-[12px] text-[#667085]">
								{provider.models
									.slice(0, 4)
									.map((model) => model.id)
									.join("、")}
								{provider.models.length > 4 ? ` 等 ${provider.models.length} 个` : ""}
							</div>
						) : null}
					</div>
				))}

				{providerDraft ? (
					<Modal
						className="flex h-[min(760px,calc(100vh-64px))] w-[720px] max-w-[calc(100vw-48px)] flex-col overflow-hidden rounded-[24px] border border-black/[0.06] bg-white shadow-[0_24px_70px_rgba(15,23,42,0.25)]"
						layer="stacked"
						onClose={() => {
							setProviderDraft(undefined);
							setEditingProvider(undefined);
						}}
						open
					>
						<ProviderEditor
							busy={busy}
							draft={providerDraft}
							editing={editingProvider !== undefined}
							onCancel={() => {
								setProviderDraft(undefined);
								setEditingProvider(undefined);
							}}
							onChange={setProviderDraft}
							onSave={() => {
								const patch = providerPatchOf(providerDraft);
								if (!String(patch.id ?? "").trim()) return;
								void save({ providers: [patch] });
								setProviderDraft(undefined);
								setEditingProvider(undefined);
							}}
						/>
					</Modal>
				) : null}
			</div>

			<div className="flex items-center gap-2 py-3">
				{notice ? (
					<span className="flex items-center gap-1 text-[12px] text-[#16a34a]">
						<Check size={12} />
						{notice}
					</span>
				) : null}
			</div>
		</div>
	);
}
