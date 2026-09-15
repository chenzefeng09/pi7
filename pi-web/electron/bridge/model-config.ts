import fs from "node:fs";
import path from "node:path";
import { t } from "../../src/i18n";

/** How a provider gets its key; the value itself never leaves this module. */
export type CredentialKind = "command" | "env" | "literal" | "none";

export interface ModelEntryView {
	contextWindow?: number;
	id: string;
	input?: string[];
	maxTokens?: number;
	name?: string;
	reasoning?: boolean;
	/** Arbitrary sampling parameters pi merges into the request body (vLLM's top_k, min_p, ...). */
	samplingParams?: Record<string, unknown>;
}

export interface ProviderView {
	api?: string;
	baseUrl?: string;
	credential: CredentialKind;
	/** For `env`/`command`: the expression itself. For `literal`: a masked tail, never the key. */
	credentialHint?: string;
	id: string;
	models: ModelEntryView[];
	name?: string;
}

/** What the renderer gets: no secrets, but enough to show what is configured. */
export interface ModelConfigView {
	defaultModel?: string;
	defaultProvider?: string;
	defaultThinkingLevel?: string;
	enabledModels: string[];
	providers: ProviderView[];
}

/** What the renderer may send back. An empty `apiKey` means "keep whatever is there". */
export interface ModelConfigPatch {
	defaultModel?: string;
	defaultProvider?: string;
	defaultThinkingLevel?: string;
	enabledModels?: string[];
	providers?: Array<{
		api?: string;
		apiKey?: string;
		baseUrl?: string;
		id: string;
		models?: ModelEntryView[];
		name?: string;
		removed?: boolean;
	}>;
}

function agentFiles(agentDir: string): { models: string; settings: string } {
	return { models: path.join(agentDir, "models.json"), settings: path.join(agentDir, "settings.json") };
}

function readJson(file: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
		return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

/**
 * Like readJson, but a file that exists and does not parse is an error rather than `{}`.
 *
 * Writers merge into what they read; treating a corrupt settings.json as empty would write back
 * only the patched fields and silently drop everything else the user had in it.
 */
function readJsonForWrite(file: string): Record<string, unknown> {
	let text: string;
	try {
		text = fs.readFileSync(file, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
		throw error;
	}
	if (!text.trim()) return {};
	const parsed = JSON.parse(text) as unknown;
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new Error(t("{file} 不是 JSON 对象，已停止写入以免覆盖。", { file }));
	}
	return parsed as Record<string, unknown>;
}

/** Write through a temporary file so a crash cannot leave a half-written config behind. */
function writeJson(file: string, value: unknown): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const previous = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
	if (previous) fs.copyFileSync(file, `${file}.bak`);
	// Keep the file's own indentation: re-indenting a hand-formatted config turns every small save
	// into a whole-file diff.
	const indent = /^([\t ]+)\S/m.exec(previous)?.[1]?.includes("\t") ? "\t" : "  ";
	const temporary = `${file}.tmp`;
	fs.writeFileSync(temporary, `${JSON.stringify(value, null, indent)}\n`, "utf8");
	fs.renameSync(temporary, file);
}

function credentialOf(value: unknown): { credential: CredentialKind; credentialHint?: string } {
	if (typeof value !== "string" || value.length === 0) return { credential: "none" };
	if (value.startsWith("!")) return { credential: "command", credentialHint: value };
	if (value.startsWith("$")) return { credential: "env", credentialHint: value };
	// A literal key: report the shape, never the value.
	return { credential: "literal", credentialHint: `${value.slice(0, 4)}…${value.slice(-2)}` };
}

function modelsOf(value: unknown): ModelEntryView[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((entry) => {
		if (typeof entry !== "object" || entry === null) return [];
		const model = entry as Record<string, unknown>;
		if (typeof model.id !== "string") return [];
		const sampling =
			typeof model.samplingParams === "object" && model.samplingParams !== null && !Array.isArray(model.samplingParams)
				? (model.samplingParams as Record<string, unknown>)
				: undefined;
		return [
			{
				contextWindow: typeof model.contextWindow === "number" ? model.contextWindow : undefined,
				id: model.id,
				input: Array.isArray(model.input) ? model.input.map(String) : undefined,
				maxTokens: typeof model.maxTokens === "number" ? model.maxTokens : undefined,
				name: typeof model.name === "string" ? model.name : undefined,
				reasoning: model.reasoning === true,
				samplingParams: sampling,
			},
		];
	});
}

/** The literal key stored for one provider, for callers inside the main process only. */
export function readProviderKey(agentDir: string, providerId: string): string | undefined {
	const file = readJson(agentFiles(agentDir).models);
	const providers =
		typeof file.providers === "object" && file.providers !== null
			? (file.providers as Record<string, unknown>)
			: {};
	const provider = providers[providerId];
	if (typeof provider !== "object" || provider === null) return undefined;
	const key = (provider as { apiKey?: unknown }).apiKey;
	return typeof key === "string" && key.length > 0 && !key.startsWith("$") && !key.startsWith("!") ? key : undefined;
}

export function readModelConfig(agentDir: string): ModelConfigView {
	const files = agentFiles(agentDir);
	const settings = readJson(files.settings);
	const modelsFile = readJson(files.models);
	const providersRecord =
		typeof modelsFile.providers === "object" && modelsFile.providers !== null
			? (modelsFile.providers as Record<string, unknown>)
			: {};
	const providers: ProviderView[] = Object.entries(providersRecord).map(([id, value]) => {
		const provider = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
		return {
			api: typeof provider.api === "string" ? provider.api : undefined,
			baseUrl: typeof provider.baseUrl === "string" ? provider.baseUrl : undefined,
			...credentialOf(provider.apiKey),
			id,
			models: modelsOf(provider.models),
			name: typeof provider.name === "string" ? provider.name : undefined,
		};
	});
	return {
		defaultModel: typeof settings.defaultModel === "string" ? settings.defaultModel : undefined,
		defaultProvider: typeof settings.defaultProvider === "string" ? settings.defaultProvider : undefined,
		defaultThinkingLevel:
			typeof settings.defaultThinkingLevel === "string" ? settings.defaultThinkingLevel : undefined,
		enabledModels: Array.isArray(settings.enabledModels) ? settings.enabledModels.map(String) : [],
		providers,
	};
}

export function writeModelConfig(agentDir: string, patch: ModelConfigPatch): ModelConfigView {
	const files = agentFiles(agentDir);
	if (
		patch.defaultModel !== undefined ||
		patch.defaultProvider !== undefined ||
		patch.defaultThinkingLevel !== undefined ||
		patch.enabledModels !== undefined
	) {
		// Read-modify-write: everything the app does not manage (theme, packages, shellPath) stays.
		const settings = readJsonForWrite(files.settings);
		if (patch.defaultModel !== undefined) settings.defaultModel = patch.defaultModel;
		if (patch.defaultProvider !== undefined) settings.defaultProvider = patch.defaultProvider;
		if (patch.defaultThinkingLevel !== undefined) settings.defaultThinkingLevel = patch.defaultThinkingLevel;
		if (patch.enabledModels !== undefined) settings.enabledModels = patch.enabledModels;
		writeJson(files.settings, settings);
	}
	if (patch.providers !== undefined) {
		const modelsFile = readJsonForWrite(files.models);
		const providers =
			typeof modelsFile.providers === "object" && modelsFile.providers !== null
				? (modelsFile.providers as Record<string, unknown>)
				: {};
		for (const provider of patch.providers) {
			if (provider.removed === true) {
				delete providers[provider.id];
				continue;
			}
			const existing =
				typeof providers[provider.id] === "object" && providers[provider.id] !== null
					? (providers[provider.id] as Record<string, unknown>)
					: {};
			const next: Record<string, unknown> = { ...existing };
			if (provider.name !== undefined) next.name = provider.name;
			if (provider.baseUrl !== undefined) next.baseUrl = provider.baseUrl;
			if (provider.api !== undefined) next.api = provider.api;
			if (provider.models !== undefined) {
				// The editor shows a subset of what a model entry may carry (cost, compat, thinking
				// levels): every other field of a model that is still there has to survive an edit.
				const before = Array.isArray(existing.models) ? existing.models : [];
				next.models = provider.models.map((model) => {
					const previous = before.find(
						(entry) => typeof entry === "object" && entry !== null && (entry as { id?: unknown }).id === model.id,
					);
					return typeof previous === "object" && previous !== null
						? { ...(previous as Record<string, unknown>), ...model }
						: model;
				});
			}
			// An empty apiKey keeps the stored one, so the editor never has to hold a secret.
			if (typeof provider.apiKey === "string" && provider.apiKey.length > 0) next.apiKey = provider.apiKey;
			providers[provider.id] = next;
		}
		modelsFile.providers = providers;
		writeJson(files.models, modelsFile);
	}
	return readModelConfig(agentDir);
}

/** Marker and version of the portable document, so a wrong file is refused by name. */
export const PORTABLE_FORMAT = "pi-web.models";
export const PORTABLE_VERSION = 1;

export interface PortableBundle {
	defaults?: {
		enabledModels?: string[];
		model?: string;
		provider?: string;
		thinkingLevel?: string;
	};
	exportedAt: string;
	format: typeof PORTABLE_FORMAT;
	providers: Record<string, unknown>;
	/** How many literal keys were left out of the file. */
	redactedKeys: number;
	version: number;
}

/**
 * The portable copy of the model configuration.
 *
 * `$ENV` and `!command` references travel as they are — they name a secret without carrying one —
 * but a key written into the file literally is left out and counted: an exported file is meant to
 * be copied, mailed or committed, and a plaintext key in it would be a leak nobody asked for.
 */
export function exportModelConfig(agentDir: string): PortableBundle {
	const files = agentFiles(agentDir);
	const settings = readJson(files.settings);
	const models = readJson(files.models);
	const stored =
		typeof models.providers === "object" && models.providers !== null
			? (models.providers as Record<string, unknown>)
			: {};
	const providers: Record<string, unknown> = {};
	let redactedKeys = 0;
	const redact = (value: unknown, parentKey?: string): unknown => {
		if (Array.isArray(value)) return value.map((entry) => redact(entry));
		if (typeof value !== "object" || value === null) return value;
		return Object.fromEntries(Object.entries(value).flatMap(([key, entry]) => {
			// Header names are extensible: even a vendor-specific header can contain a credential.
			const credential = key === "apiKey" || parentKey === "headers";
			const reference = typeof entry === "string" &&
				(entry.startsWith("!") || /^\$(?:[A-Za-z_][A-Za-z0-9_]*|\{[A-Za-z_][A-Za-z0-9_]*\})$/.test(entry));
			if (credential && typeof entry === "string" && entry.length > 0 && !reference) {
				redactedKeys += 1;
				return [];
			}
			return [[key, redact(entry, key)]];
		}));
	};
	for (const [id, value] of Object.entries(stored)) {
		if (typeof value !== "object" || value === null) continue;
		providers[id] = redact(value);
	}
	return {
		defaults: {
			enabledModels: Array.isArray(settings.enabledModels) ? settings.enabledModels.map(String) : undefined,
			model: typeof settings.defaultModel === "string" ? settings.defaultModel : undefined,
			provider: typeof settings.defaultProvider === "string" ? settings.defaultProvider : undefined,
			thinkingLevel: typeof settings.defaultThinkingLevel === "string" ? settings.defaultThinkingLevel : undefined,
		},
		exportedAt: new Date().toISOString(),
		format: PORTABLE_FORMAT,
		providers,
		redactedKeys,
		version: PORTABLE_VERSION,
	};
}

export interface ImportSummary {
	added: string[];
	defaultsApplied: boolean;
	error?: string;
	/** Providers whose key was missing from the file and stayed as it was locally. */
	keptKeys: string[];
	replaced: string[];
}

/** Merge a portable document into the agent's configuration. */
export function importModelConfig(agentDir: string, document: unknown): ImportSummary {
	const empty: ImportSummary = { added: [], defaultsApplied: false, keptKeys: [], replaced: [] };
	if (typeof document !== "object" || document === null || Array.isArray(document)) {
		return { ...empty, error: t("文件不是有效的 JSON 对象。") };
	}
	const bundle = document as Partial<PortableBundle>;
	if (bundle.format !== PORTABLE_FORMAT) {
		return { ...empty, error: t("不是 π7 模型配置导出文件（format 应为 {PORTABLE_FORMAT}）。", { "PORTABLE_FORMAT": PORTABLE_FORMAT }) };
	}
	if (typeof bundle.version !== "number" || bundle.version > PORTABLE_VERSION) {
		return { ...empty, error: t("文件版本 {arg} 高于本应用支持的 {arg2}。", { "arg": String(bundle.version), "arg2": String(PORTABLE_VERSION) }) };
	}
	if (typeof bundle.providers !== "object" || bundle.providers === null || Array.isArray(bundle.providers)) {
		return { ...empty, error: t("文件里没有 providers。") };
	}

	const files = agentFiles(agentDir);
	let models: Record<string, unknown>;
	try {
		models = readJsonForWrite(files.models);
	} catch (error) {
		return { ...empty, error: error instanceof Error ? error.message : String(error) };
	}
	const providers =
		typeof models.providers === "object" && models.providers !== null
			? (models.providers as Record<string, unknown>)
			: {};
	const added: string[] = [];
	const replaced: string[] = [];
	const keptKeys: string[] = [];
	for (const [id, value] of Object.entries(bundle.providers as Record<string, unknown>)) {
		if (typeof value !== "object" || value === null) continue;
		const incoming = { ...(value as Record<string, unknown>) };
		// A literal key never travels, so an import must not wipe the key that is already there.
		if (typeof incoming.apiKey !== "string" || incoming.apiKey.length === 0) {
			const existing = providers[id];
			const local =
				typeof existing === "object" && existing !== null ? (existing as { apiKey?: unknown }).apiKey : undefined;
			if (typeof local === "string" && local.length > 0) {
				incoming.apiKey = local;
				keptKeys.push(id);
			}
		}
		if (id in providers) replaced.push(id);
		else added.push(id);
		providers[id] = incoming;
	}
	models.providers = providers;
	writeJson(files.models, models);

	let defaultsApplied = false;
	const defaults = bundle.defaults;
	if (defaults && typeof defaults === "object") {
		let settings: Record<string, unknown>;
		try {
			settings = readJsonForWrite(files.settings);
		} catch (error) {
			// The providers above did land; only the defaults were refused.
			return { added, defaultsApplied, error: error instanceof Error ? error.message : String(error), keptKeys, replaced };
		}
		if (typeof defaults.provider === "string" && typeof defaults.model === "string" && defaults.model) {
			settings.defaultProvider = defaults.provider;
			settings.defaultModel = defaults.model;
		}
		if (typeof defaults.thinkingLevel === "string" && defaults.thinkingLevel) {
			settings.defaultThinkingLevel = defaults.thinkingLevel;
		}
		if (Array.isArray(defaults.enabledModels)) settings.enabledModels = defaults.enabledModels.map(String);
		writeJson(files.settings, settings);
		defaultsApplied = true;
	}
	return { added, defaultsApplied, keptKeys, replaced };
}
