import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

interface SearchResult {
	snippet: string;
	title: string;
	url: string;
}

interface SearchDetails {
	query: string;
	results: SearchResult[];
	provider: string;
}

const USER_AGENT =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36";

/** A page bigger than this is cut off mid-download: `response.text()` would buffer all of it. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

/** Decode the response body, stopping the download once `limit` bytes have arrived. */
async function readBodyText(response: Response, limit: number): Promise<string> {
	const body = response.body;
	if (!body) return response.text();
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let text = "";
	let received = 0;
	try {
		while (received < limit) {
			const { done, value } = await reader.read();
			if (done) break;
			received += value.byteLength;
			text += decoder.decode(value, { stream: true });
		}
	} finally {
		// Cancel whatever is still in flight: nothing past the cap gets decoded anyway.
		await reader.cancel().catch(() => {});
	}
	return text + decoder.decode();
}

function decodeHtml(text: string): string {
	const entities: Record<string, string> = {
		"&amp;": "&",
		"&apos;": "'",
		"&#39;": "'",
		"&gt;": ">",
		"&lt;": "<",
		"&nbsp;": " ",
		"&quot;": '"',
	};
	return text
		.replace(/&#x([0-9a-f]+);/gi, (_match, value: string) => String.fromCodePoint(Number.parseInt(value, 16)))
		.replace(/&#([0-9]+);/g, (_match, value: string) => String.fromCodePoint(Number.parseInt(value, 10)))
		.replace(/&[a-z#0-9]+;/gi, (entity) => entities[entity.toLowerCase()] ?? entity);
}

function stripTags(text: string): string {
	return decodeHtml(text.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " "))
		.replace(/\s+/g, " ")
		.trim();
}

function normalizeUrl(url: string): string {
	const decoded = decodeHtml(url.trim());
	try {
		const parsed = new URL(decoded, "https://duckduckgo.com");
		const redirected = parsed.searchParams.get("uddg");
		if (redirected) return redirected;
		if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.toString();
	} catch {}
	return decoded;
}

async function fetchText(url: string, timeoutMs = 15000, signal?: AbortSignal): Promise<string> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	// The tool's own abort counts too: a stopped turn must not leave a download running.
	const onAbort = () => controller.abort();
	if (signal?.aborted) controller.abort();
	else signal?.addEventListener("abort", onAbort, { once: true });
	try {
		const response = await fetch(url, {
			headers: {
				"Accept-Language": "en-US,en;q=0.8",
				"User-Agent": USER_AGENT,
			},
			signal: controller.signal,
		});
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		return await readBodyText(response, MAX_BODY_BYTES);
	} finally {
		clearTimeout(timeout);
		signal?.removeEventListener("abort", onAbort);
	}
}

function parseDuckDuckGo(html: string, maxResults: number): SearchResult[] {
	const results: SearchResult[] = [];
	const pattern =
		/<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>|<div[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>)?/gi;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(html)) && results.length < maxResults) {
		const url = normalizeUrl(match[1] ?? "");
		const title = stripTags(match[2] ?? "");
		const snippet = stripTags(match[3] ?? match[4] ?? "");
		if (url && title) results.push({ snippet, title, url });
	}
	return results;
}

function parseBing(html: string, maxResults: number): SearchResult[] {
	const results: SearchResult[] = [];
	const blocks = html.match(/<li class="b_algo"[\s\S]*?<\/li>/gi) ?? [];
	for (const block of blocks) {
		if (results.length >= maxResults) break;
		const link = block.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
		if (!link) continue;
		const snippet = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
		const url = normalizeUrl(link[1] ?? "");
		const title = stripTags(link[2] ?? "");
		if (url && title) results.push({ snippet: stripTags(snippet?.[1] ?? ""), title, url });
	}
	return results;
}

async function searchWeb(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchDetails> {
	const encoded = encodeURIComponent(query);
	try {
		const html = await fetchText(`https://html.duckduckgo.com/html/?q=${encoded}`, 15000, signal);
		const results = parseDuckDuckGo(html, maxResults);
		if (results.length > 0) return { provider: "duckduckgo", query, results };
	} catch {}
	const html = await fetchText(`https://www.bing.com/search?q=${encoded}&count=${maxResults}`, 15000, signal);
	const results = parseBing(html, maxResults);
	if (results.length === 0) throw new Error(`No search results found for "${query}"`);
	return { provider: "bing", query, results };
}

function formatResults(details: SearchDetails): string {
	return details.results
		.map((result, index) => `${index + 1}. ${result.title}\n${result.url}\n${result.snippet}`.trim())
		.join("\n\n");
}

export default function webSearch(pi: ExtensionAPI) {
	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description: "Search the public web and return titles, URLs, and snippets.",
		parameters: Type.Object({
			query: Type.String({ description: "Search query" }),
			maxResults: Type.Optional(
				Type.Number({ description: "Maximum number of results (1-10)", minimum: 1, maximum: 10 }),
			),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
			if (signal?.aborted) throw new Error("web_search aborted");
			const query = params.query.trim();
			if (!query) {
				return {
					content: [{ type: "text", text: "Error: query is required" }],
					details: { provider: "none", query, results: [] } satisfies SearchDetails,
				};
			}
			const maxResults = Math.min(10, Math.max(1, Math.floor(params.maxResults ?? 5)));
			const details = await searchWeb(query, maxResults, signal);
			return {
				content: [{ type: "text", text: formatResults(details) }],
				details,
			};
		},
	});

	pi.registerTool({
		name: "web_fetch",
		label: "Web Fetch",
		description: "Fetch a public http(s) page and return readable text.",
		parameters: Type.Object({
			url: Type.String({ description: "HTTP or HTTPS URL" }),
			maxChars: Type.Optional(
				Type.Number({ description: "Maximum characters to return (1000-50000)", minimum: 1000, maximum: 50000 }),
			),
		}),
		async execute(_toolCallId, params, signal) {
			if (signal?.aborted) throw new Error("web_fetch aborted");
			const url = new URL(params.url);
			if (url.protocol !== "http:" && url.protocol !== "https:") {
				throw new Error("web_fetch only supports http and https URLs");
			}
			const maxChars = Math.min(50000, Math.max(1000, Math.floor(params.maxChars ?? 20000)));
			const html = await fetchText(url.toString(), 20000, signal);
			const text = stripTags(html).slice(0, maxChars);
			return {
				content: [{ type: "text", text }],
				details: { characters: text.length, url: url.toString() },
			};
		},
	});

	pi.registerCommand("web-search-test", {
		description: "Run the built-in web search without calling a model",
		async handler(args, ctx) {
			const query = args.trim() || "pi coding agent";
			try {
				const details = await searchWeb(query, 3);
				ctx.ui.notify(
					`${details.provider}: ${details.results.map((result) => result.title).join(" | ")}`,
					"info",
				);
			} catch (error) {
				ctx.ui.notify(`web search failed: ${error instanceof Error ? error.message : String(error)}`, "error");
			}
		},
	});
}
