import { Check, ChevronDown, Download, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { buttonClass } from "./buttons";
import { SETTINGS_INPUT_CLASS, SettingsSelect } from "./SettingsControls";
import { t } from "../i18n";

/** One model of a provider, with the fields pi's `models.json` accepts per model. */
export interface ModelDraft {
	contextWindow: string;
	id: string;
	maxTokens: string;
	name: string;
	reasoning: boolean;
	/** Sampling parameters, as key/value pairs the user can extend (vLLM's top_k, min_p, ...). */
	sampling: Array<{ key: string; value: string }>;
	vision: boolean;
}

export interface ProviderDraft {
	api: string;
	apiKey: string;
	baseUrl: string;
	id: string;
	models: ModelDraft[];
	name: string;
}

interface Discovered {
	contextWindow?: number;
	id: string;
	maxTokens?: number;
	name?: string;
}

const API_KINDS = ["openai-completions", "openai-responses", "anthropic-messages"];

/** Sampling keys worth offering; anything else can be typed in. */
const COMMON_SAMPLING = ["temperature", "top_p", "top_k", "min_p", "repetition_penalty"];

export function emptyProviderDraft(): ProviderDraft {
	return { api: "openai-completions", apiKey: "", baseUrl: "", id: "", models: [], name: "" };
}

export function emptyModelDraft(): ModelDraft {
	return { contextWindow: "", id: "", maxTokens: "", name: "", reasoning: false, sampling: [], vision: false };
}

/** Turn the drafts into the `models.json` shape, dropping empty fields. */
export function providerPatchOf(draft: ProviderDraft): Record<string, unknown> {
	return {
		api: draft.api || undefined,
		apiKey: draft.apiKey.trim(),
		baseUrl: draft.baseUrl.trim(),
		id: draft.id.trim(),
		models: draft.models
			.filter((model) => model.id.trim())
			.map((model) => {
				// Sampling parameters ride on the model: pi merges them into every request body that
				// model sends, which is where a server-specific key like vLLM's top_k belongs.
				const samplingParams: Record<string, unknown> = {};
				for (const entry of model.sampling) {
					if (!entry.key.trim()) continue;
					const number = Number(entry.value);
					samplingParams[entry.key.trim()] =
						entry.value.trim() !== "" && Number.isFinite(number) ? number : entry.value;
				}
				return {
					contextWindow: model.contextWindow ? Number(model.contextWindow) : undefined,
					id: model.id.trim(),
					input: model.vision ? ["text", "image"] : ["text"],
					maxTokens: model.maxTokens ? Number(model.maxTokens) : undefined,
					name: model.name.trim() || undefined,
					reasoning: model.reasoning,
					samplingParams: Object.keys(samplingParams).length > 0 ? samplingParams : undefined,
				};
			}),
		name: draft.name.trim() || draft.id.trim(),
	};
}

/** Load one stored provider back into the editor. */
export function draftOfProvider(provider: {
	api?: string;
	baseUrl?: string;
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
}): ProviderDraft {
	return {
		api: provider.api ?? "openai-completions",
		// A stored key is never read back, so the field starts empty and means "keep what is there".
		apiKey: "",
		baseUrl: provider.baseUrl ?? "",
		id: provider.id,
		models: provider.models.map((model) => ({
			contextWindow: model.contextWindow === undefined ? "" : String(model.contextWindow),
			id: model.id,
			maxTokens: model.maxTokens === undefined ? "" : String(model.maxTokens),
			name: model.name ?? "",
			reasoning: model.reasoning === true,
			sampling: Object.entries(model.samplingParams ?? {}).map(([key, value]) => ({
				key,
				value: String(value),
			})),
			vision: Array.isArray(model.input) && model.input.includes("image"),
		})),
		name: provider.name ?? "",
	};
}

function Field({ children, label }: { children: React.ReactNode; label: string }) {
	return (
		<label className="flex flex-col gap-1">
			<span className="text-[11px] text-[#98a2b3]">{label}</span>
			{children}
		</label>
	);
}

/**
 * The provider form, as a dialog stacked over the settings panel: where the endpoint is, the key,
 * the models it serves, and how each model is configured. Models can be typed in or pulled from
 * the endpoint itself, which is how a vLLM or llama.cpp server announces what it has
 * (`GET {baseUrl}/models`, the harness's discovery call).
 */
export function ProviderEditor({
	busy,
	draft,
	editing,
	onCancel,
	onChange,
	onSave,
}: {
	busy: boolean;
	draft: ProviderDraft;
	editing: boolean;
	onCancel: () => void;
	onChange: (draft: ProviderDraft) => void;
	onSave: () => void;
}) {
	const [discovered, setDiscovered] = useState<Discovered[] | undefined>(undefined);
	const [discoveryNote, setDiscoveryNote] = useState("");
	const [discoveryBusy, setDiscoveryBusy] = useState(false);
	const [picked, setPicked] = useState<Set<string>>(new Set());

	const patch = (changes: Partial<ProviderDraft>) => onChange({ ...draft, ...changes });
	const patchModel = (index: number, changes: Partial<ModelDraft>) =>
		patch({ models: draft.models.map((model, position) => (position === index ? { ...model, ...changes } : model)) });

	const pull = async () => {
		setDiscoveryBusy(true);
		setDiscoveryNote("");
		try {
			const result = (await window.pi.discoverModels({
				api: draft.api,
				apiKey: draft.apiKey.trim(),
				baseUrl: draft.baseUrl.trim(),
				providerId: draft.id.trim(),
			})) as { error?: string; models?: Discovered[]; url?: string } | undefined;
			if (result?.error) {
				setDiscoveryNote(result.error);
				setDiscovered(undefined);
			} else {
				setDiscovered(result?.models ?? []);
				setPicked(new Set());
				setDiscoveryNote(t("从 {arg} 读到 {arg2} 个模型", { "arg": result?.url ?? "", "arg2": String(result?.models?.length ?? 0) }));
			}
		} catch (error) {
			setDiscoveryNote(error instanceof Error ? error.message : String(error));
		} finally {
			setDiscoveryBusy(false);
		}
	};

	const adopt = () => {
		const additions = (discovered ?? [])
			.filter((model) => picked.has(model.id) && !draft.models.some((existing) => existing.id === model.id))
			.map((model) => ({
				contextWindow: model.contextWindow === undefined ? "" : String(model.contextWindow),
				id: model.id,
				maxTokens: model.maxTokens === undefined ? "" : String(model.maxTokens),
				name: model.name && model.name !== model.id ? model.name : "",
				reasoning: false,
				sampling: [],
				vision: false,
			}));
		patch({ models: [...draft.models, ...additions] });
		setDiscovered(undefined);
		setDiscoveryNote(t("已加入 {arg} 个模型，按需再改上下文与采样参数", { "arg": String(additions.length) }));
	};

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex shrink-0 items-start justify-between gap-2 pb-2 pl-5 pr-3 pt-4">
				<div className="flex min-w-0 flex-col">
					<span className="text-[16px] font-medium leading-6 text-[#111827]">
						{editing ? t("编辑供应商") : t("新增供应商")}
					</span>
					<span className="text-[12px] text-[#98a2b3]">
						{t("模型写在 agent 配置目录的")}<span className="font-mono">models.json</span>{t("，保存后重启运行时生效")}</span>
				</div>
				<button
					className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#6b7280] hover:bg-black/[0.05]"
					onClick={onCancel}
					title={t("关闭")}
					type="button"
				>
					<X size={15} />
				</button>
			</div>

			<div className="scrollbar-subtle flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 pb-4">
				<div className="grid grid-cols-2 gap-3">
					<Field label={t("id（如 vllm）")}>
						<input
							className={SETTINGS_INPUT_CLASS}
							onChange={(event) => patch({ id: event.target.value })}
							placeholder="vllm"
							value={draft.id}
						/>
					</Field>
					<Field label={t("名称（可选）")}>
						<input
							className={SETTINGS_INPUT_CLASS}
							onChange={(event) => patch({ name: event.target.value })}
							placeholder={t("本地 vLLM")}
							value={draft.name}
						/>
					</Field>
					<Field label={t("baseUrl（如 http://127.0.0.1:8000/v1）")}>
						<input
							className={SETTINGS_INPUT_CLASS}
							onChange={(event) => patch({ baseUrl: event.target.value })}
							placeholder="http://127.0.0.1:8000/v1"
							value={draft.baseUrl}
						/>
					</Field>
					<Field label="api">
						<SettingsSelect
							align="start"
							block
							onChange={(api) => patch({ api })}
							options={API_KINDS.map((kind) => ({ label: kind, value: kind }))}
							title={t("选择 api 类型")}
							value={draft.api}
						/>
					</Field>
				</div>
				<Field label={editing ? t("apiKey（留空沿用已保存的密钥）") : t("apiKey（$ENV 或 !命令；本地服务可留空）")}>
					<input
						className={SETTINGS_INPUT_CLASS}
						onChange={(event) => patch({ apiKey: event.target.value })}
						placeholder="$MY_API_KEY"
						value={draft.apiKey}
					/>
				</Field>

				<div className="flex flex-wrap items-center gap-2 border-t-[0.5px] border-black/[0.06] pt-3">
					<button
						className={buttonClass("secondary", "sm")}
						disabled={discoveryBusy || !draft.baseUrl.trim()}
						onClick={() => void pull()}
						type="button"
					>
						<Download size={12} />
						{discoveryBusy ? t("拉取中…") : t("拉取模型")}
					</button>
					<button
						className={buttonClass("secondary", "sm")}
						onClick={() => patch({ models: [...draft.models, emptyModelDraft()] })}
						type="button"
					>
						<Plus size={12} />
						{t("手动添加模型")}</button>
					<span className="min-w-0 flex-1 truncate text-[11px] text-[#98a2b3]">{discoveryNote}</span>
				</div>

				{discovered ? (
					<div className="flex flex-col gap-1.5 rounded-xl border border-black/[0.08] p-2">
						<div className="flex items-center justify-between gap-2 px-1">
							<span className="text-[12px] text-[#667085]">{t("端点返回的模型（勾选后加入）")}</span>
							<button
								className={buttonClass("primary", "sm")}
								disabled={picked.size === 0}
								onClick={adopt}
								type="button"
							>
								{t("加入选中（")}{picked.size}{t("）")}</button>
						</div>
						<div className="scrollbar-subtle max-h-56 overflow-y-auto">
							{discovered.map((model) => (
								<button
									className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-black/[0.04]"
									key={model.id}
									onClick={() =>
										setPicked((current) => {
											const next = new Set(current);
											if (next.has(model.id)) next.delete(model.id);
											else next.add(model.id);
											return next;
										})
									}
									type="button"
								>
									<span
										className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
											picked.has(model.id) ? "border-[#2f7df6] bg-[#2f7df6] text-white" : "border-black/[0.2]"
										}`}
									>
										{picked.has(model.id) ? <Check size={11} /> : null}
									</span>
									<span className="min-w-0 flex-1 truncate font-mono text-[12px] text-[#1f2937]">
										{model.id}
									</span>
									<span className="shrink-0 text-[11px] text-[#98a2b3]">
										{model.contextWindow ? t("上下文 {contextWindow}", { "contextWindow": model.contextWindow }) : ""}
										{model.maxTokens ? t(" · 输出 {maxTokens}", { "maxTokens": model.maxTokens }) : ""}
									</span>
								</button>
							))}
						</div>
					</div>
				) : null}

				{draft.models.length > 0 ? (
					<div className="flex flex-col gap-2.5">
						{draft.models.map((model, index) => (
							<div className="flex flex-col gap-2.5 rounded-xl bg-[#f7f7f8] p-3" key={index}>
								<div className="flex items-center gap-2">
									<span className="shrink-0 rounded bg-white px-1.5 py-0.5 text-[11px] text-[#667085]">
										#{index + 1}
									</span>
									<span className="min-w-0 flex-1 truncate font-mono text-[12px] text-[#1f2937]">
										{model.id || t("（未填 id）")}
									</span>
									<button
										className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[#b6bcc4] hover:bg-black/[0.04] hover:text-[#d92d20]"
										onClick={() => patch({ models: draft.models.filter((_entry, at) => at !== index) })}
										title={t("移除该模型")}
										type="button"
									>
										<Trash2 size={12} />
									</button>
								</div>
								<div className="grid grid-cols-2 gap-3">
									<Field label={t("模型 id（请求里发送的 id）")}>
										<input
											className={SETTINGS_INPUT_CLASS}
											onChange={(event) => patchModel(index, { id: event.target.value })}
											placeholder="Qwen/Qwen3-32B"
											value={model.id}
										/>
									</Field>
									<Field label={t("显示名（可选）")}>
										<input
											className={SETTINGS_INPUT_CLASS}
											onChange={(event) => patchModel(index, { name: event.target.value })}
											placeholder="Qwen3 32B"
											value={model.name}
										/>
									</Field>
									<Field label={t("上下文长度（tokens）")}>
										<input
											className={SETTINGS_INPUT_CLASS}
											inputMode="numeric"
											onChange={(event) => patchModel(index, { contextWindow: event.target.value })}
											placeholder="131072"
											value={model.contextWindow}
										/>
									</Field>
									<Field label={t("最大输出（tokens）")}>
										<input
											className={SETTINGS_INPUT_CLASS}
											inputMode="numeric"
											onChange={(event) => patchModel(index, { maxTokens: event.target.value })}
											placeholder="16384"
											value={model.maxTokens}
										/>
									</Field>
								</div>
								<div className="flex flex-wrap items-center gap-4">
									<label className="flex items-center gap-1.5 text-[12px] text-[#475467]">
										<input
											checked={model.reasoning}
											className="h-3.5 w-3.5 accent-[#2f7df6]"
											onChange={(event) => patchModel(index, { reasoning: event.target.checked })}
											type="checkbox"
										/>
										{t("支持思考")}</label>
									<label className="flex items-center gap-1.5 text-[12px] text-[#475467]">
										<input
											checked={model.vision}
											className="h-3.5 w-3.5 accent-[#2f7df6]"
											onChange={(event) => patchModel(index, { vision: event.target.checked })}
											type="checkbox"
										/>
										{t("支持图片")}</label>
									<button
										className="ml-auto text-[12px] text-[#667085] hover:text-[#1f2937]"
										onClick={() => patchModel(index, { sampling: [...model.sampling, { key: "", value: "" }] })}
										type="button"
									>
										{t("+ 采样参数")}</button>
								</div>
								{model.sampling.length > 0 ? (
									<div className="flex flex-col gap-1.5">
										<span className="text-[11px] text-[#98a2b3]">
											{t("原样并入请求体，vLLM 的 top_k、min_p 等")}</span>
										{model.sampling.map((entry, position) => (
											<div className="flex items-center gap-2" key={position}>
												<input
													className={`${SETTINGS_INPUT_CLASS} min-w-0 flex-1 font-mono`}
													list="sampling-keys"
													onChange={(event) =>
														patchModel(index, {
															sampling: model.sampling.map((item, at) =>
																at === position ? { ...item, key: event.target.value } : item,
															),
														})
													}
													placeholder="temperature"
													value={entry.key}
												/>
												<input
													className={`${SETTINGS_INPUT_CLASS} min-w-0 flex-1 font-mono`}
													onChange={(event) =>
														patchModel(index, {
															sampling: model.sampling.map((item, at) =>
																at === position ? { ...item, value: event.target.value } : item,
															),
														})
													}
													placeholder="0.7"
													value={entry.value}
												/>
												<button
													className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#b6bcc4] hover:bg-black/[0.04] hover:text-[#d92d20]"
													onClick={() =>
														patchModel(index, {
															sampling: model.sampling.filter((_item, at) => at !== position),
														})
													}
													title={t("移除该参数")}
													type="button"
												>
													<Trash2 size={12} />
												</button>
											</div>
										))}
									</div>
								) : null}
							</div>
						))}
					</div>
				) : (
					<div className="rounded-lg border border-dashed border-black/[0.12] px-3 py-4 text-center text-[12px] text-[#98a2b3]">
						{t("还没有模型：点「拉取模型」从端点读取，或手动添加。")}</div>
				)}
			</div>

			<div className="flex shrink-0 items-center justify-end gap-2 border-t-[0.5px] border-black/[0.06] px-5 py-3">
				<span className="mr-auto min-w-0 truncate text-[11px] text-[#98a2b3]">
					{t("密钥只写入配置文件，读取时不会回传到界面")}</span>
				<button className={buttonClass("secondary")} onClick={onCancel} type="button">
					{t("取消")}</button>
				<button
					className={buttonClass("primary")}
					disabled={busy || !draft.id.trim() || !draft.baseUrl.trim()}
					onClick={onSave}
					type="button"
				>
					{editing ? t("保存修改") : t("保存供应商")}
				</button>
			</div>
			<datalist id="sampling-keys">
				{COMMON_SAMPLING.map((key) => (
					<option key={key} value={key} />
				))}
			</datalist>
		</div>
	);
}
