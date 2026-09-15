/**
 * Ask a provider endpoint which models it serves, mirroring the harness's model discovery
 * (`packages/llm/llm-pi-ai/src/discovery.ts`).
 *
 * `openai-completions` and `openai-responses` list at `GET {baseUrl}/models` with bearer auth —
 * which is what vLLM, llama.cpp, SGLang and the hosted OpenAI-compatible gateways serve.
 * `anthropic-messages` lists at its native `GET {root}/v1/models`. The reply is candidate metadata
 * only: nothing is stored until the user adopts a row.
 *
 * Written against Node 16 (Electron 22 has no global fetch), so the request goes through
 * `node:https` / `node:http` and bounds the body itself.
 */
import http from "node:http";
import https from "node:https";
import { t } from "../../src/i18n";

/** Cap on a listing body; a catalog is small and a runaway reply must not be read. */
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const ANTHROPIC_MODEL_LIMIT = 1000;
const TIMEOUT_MS = 15_000;

export interface DiscoveredModel {
	contextWindow?: number;
	/** Endpoint-facing id, i.e. what a request must send. */
	id: string;
	maxTokens?: number;
	name?: string;
}

export interface DiscoveryRequest {
	api?: string;
	/** A key typed into the form; when absent the provider's stored key is used. */
	apiKey?: string;
	baseUrl?: string;
	/** Which stored provider the key should come from, when the form has none typed in. */
	providerId?: string;
}

export interface DiscoveryResult {
	error?: string;
	models?: DiscoveredModel[];
	/** The URL that was asked, so a failure can name it. */
	url?: string;
}

/** The listing URL for one protocol, treating the base as a prefix rather than a URL to resolve. */
export function listingUrl(baseUrl: string, api: string): string {
	const base = baseUrl.replace(/\/+$/, "");
	// A deployment path such as https://gateway.example/openai/v1 keeps its segments.
	if (api !== "anthropic-messages") return `${base}/models`;
	const root = base.endsWith("/v1") ? base.slice(0, -3) : base;
	return `${root}/v1/models?limit=${String(ANTHROPIC_MODEL_LIMIT)}`;
}

function positiveInteger(...candidates: unknown[]): number | undefined {
	for (const candidate of candidates) {
		if (typeof candidate === "number" && Number.isInteger(candidate) && candidate > 0) return candidate;
	}
	return undefined;
}

function label(...candidates: unknown[]): string | undefined {
	for (const candidate of candidates) {
		if (typeof candidate === "string" && candidate.length > 0) return candidate;
	}
	return undefined;
}

/**
 * Read one listing reply: the standard `data` array wins when both shapes are present; an enriched
 * `models` map keys each entry by the id the endpoint accepts, and its nested `id` is only a
 * fallback. Rows without a usable id are skipped so one malformed entry cannot deny the rest.
 */
export function parseListing(body: unknown): DiscoveredModel[] {
	if (typeof body !== "object" || body === null) return [];
	const record = body as { data?: unknown; models?: unknown };
	const entries: Array<[string | undefined, unknown]> = Array.isArray(record.data)
		? record.data.map((entry) => [undefined, entry])
		: typeof record.models === "object" && record.models !== null && !Array.isArray(record.models)
			? Object.entries(record.models as Record<string, unknown>)
			: [];
	const models: DiscoveredModel[] = [];
	for (const [key, value] of entries) {
		if (typeof value !== "object" || value === null) continue;
		const entry = value as Record<string, unknown>;
		const limit = typeof entry.limit === "object" && entry.limit !== null ? (entry.limit as Record<string, unknown>) : {};
		const topProvider =
			typeof entry.top_provider === "object" && entry.top_provider !== null
				? (entry.top_provider as Record<string, unknown>)
				: {};
		const id = label(key, entry.id);
		if (id === undefined) continue;
		models.push({
			contextWindow: positiveInteger(
				entry.contextWindow,
				entry.context_window,
				entry.context_length,
				limit.context,
				entry.max_input_tokens,
			),
			id,
			maxTokens: positiveInteger(
				entry.maxTokens,
				entry.maxOutputTokens,
				entry.max_output_tokens,
				entry.max_tokens,
				limit.output,
				topProvider.max_completion_tokens,
			),
			name: label(entry.display_name, entry.displayName, entry.name) ?? id,
		});
	}
	return models;
}

/** One bounded GET, rejecting with the server's own words when it is not a 2xx. */
function getJson(url: string, headers: Record<string, string>): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const target = new URL(url);
		const transport = target.protocol === "http:" ? http : https;
		const request = transport.request(
			{
				headers: { accept: "application/json", ...headers },
				hostname: target.hostname,
				method: "GET",
				path: `${target.pathname}${target.search}`,
				port: target.port || (target.protocol === "http:" ? 80 : 443),
				protocol: target.protocol,
			},
			(response) => {
				const status = response.statusCode ?? 0;
				const chunks: Buffer[] = [];
				let total = 0;
				response.on("data", (chunk: Buffer) => {
					total += chunk.length;
					if (total > MAX_RESPONSE_BYTES) {
						request.destroy(new Error(t("{url} 返回内容过大", { "url": url })));
						return;
					}
					chunks.push(chunk);
				});
				response.on("end", () => {
					const text = Buffer.concat(chunks).toString("utf8");
					if (status < 200 || status >= 300) {
						reject(new Error(t("{url} 返回 {arg}：{arg2}", { "url": url, "arg": String(status), "arg2": text.slice(0, 200) })));
						return;
					}
					try {
						resolve(JSON.parse(text) as unknown);
					} catch {
						reject(new Error(t("{url} 的回复不是 JSON", { "url": url })));
					}
				});
			},
		);
		request.setTimeout(TIMEOUT_MS, () => request.destroy(new Error(t("{url} 请求超时", { "url": url }))));
		request.on("error", reject);
		request.end();
	});
}

/** Ask one endpoint for its catalog. Never throws: the failure is part of the answer. */
export async function discoverModels(request: DiscoveryRequest, storedKey?: string): Promise<DiscoveryResult> {
	const baseUrl = (request.baseUrl ?? "").trim();
	if (!baseUrl) return { error: t("先填 baseUrl，再拉取模型。") };
	const api = request.api ?? "openai-completions";
	const url = listingUrl(baseUrl, api);
	const key = (request.apiKey ?? "").trim() || storedKey;
	const headers: Record<string, string> =
		api === "anthropic-messages"
			? {
					"anthropic-version": "2023-06-01",
					...(key ? { "x-api-key": key } : {}),
				}
			: key
				? { authorization: `Bearer ${key}` }
				: {};
	try {
		const body = await getJson(url, headers);
		const models = parseListing(body);
		// Some gateways answer an empty 200 for an unknown path; say so instead of showing nothing.
		if (models.length === 0) return { error: t("{url} 没有返回可用的模型列表。", { "url": url }), url };
		return { models, url };
	} catch (error) {
		return { error: error instanceof Error ? error.message : String(error), url };
	}
}
