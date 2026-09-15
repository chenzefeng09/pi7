import { describe, expect, it } from "vitest";
import { listingUrl, parseListing } from "../../electron/bridge/model-discovery";

describe("listingUrl", () => {
	it("appends /models for the OpenAI-compatible protocols", () => {
		expect(listingUrl("http://127.0.0.1:8000/v1", "openai-completions")).toBe("http://127.0.0.1:8000/v1/models");
		expect(listingUrl("https://api.example.com/v1/", "openai-responses")).toBe("https://api.example.com/v1/models");
	});

	it("keeps a deployment path instead of resolving it away", () => {
		expect(listingUrl("https://gateway.example/openai/v1", "openai-completions")).toBe(
			"https://gateway.example/openai/v1/models",
		);
	});

	it("uses Anthropic's native listing URL with or without a trailing /v1", () => {
		expect(listingUrl("https://api.anthropic.com", "anthropic-messages")).toBe(
			"https://api.anthropic.com/v1/models?limit=1000",
		);
		expect(listingUrl("https://api.anthropic.com/v1", "anthropic-messages")).toBe(
			"https://api.anthropic.com/v1/models?limit=1000",
		);
	});
});

describe("parseListing", () => {
	it("reads a vLLM-style data array, including its capacity extensions", () => {
		const models = parseListing({
			data: [{ context_length: 131072, id: "Qwen/Qwen3-32B", max_tokens: 8192, object: "model" }],
			object: "list",
		});
		expect(models).toEqual([
			{ contextWindow: 131072, id: "Qwen/Qwen3-32B", maxTokens: 8192, name: "Qwen/Qwen3-32B" },
		]);
	});

	it("reads the standard OpenAI shape, where the capacity fields are absent", () => {
		expect(parseListing({ data: [{ id: "gpt-4o", object: "model" }] })).toEqual([
			{ contextWindow: undefined, id: "gpt-4o", maxTokens: undefined, name: "gpt-4o" },
		]);
	});

	it("reads an enriched models map, keyed by the id the endpoint accepts", () => {
		const models = parseListing({
			models: {
				"alias/fast": { context_window: 32000, display_name: "Fast alias", id: "canonical/fast" },
				"alias/slow": {},
				meta: "not a model",
			},
		});
		expect(models).toEqual([
			{ contextWindow: 32000, id: "alias/fast", maxTokens: undefined, name: "Fast alias" },
			{ contextWindow: undefined, id: "alias/slow", maxTokens: undefined, name: "alias/slow" },
		]);
	});

	it("reads Anthropic's capacity names and OpenRouter's nested limits", () => {
		expect(parseListing({ data: [{ id: "claude", max_input_tokens: 200000, max_tokens: 8192 }] })).toEqual([
			{ contextWindow: 200000, id: "claude", maxTokens: 8192, name: "claude" },
		]);
		expect(
			parseListing({ data: [{ id: "openrouter/model", limit: { context: 128000, output: 4096 } }] }),
		).toEqual([{ contextWindow: 128000, id: "openrouter/model", maxTokens: 4096, name: "openrouter/model" }]);
	});

	it("skips rows without a usable id instead of failing the whole listing", () => {
		expect(parseListing({ data: [{ object: "model" }, { id: "ok" }] })).toEqual([
			{ contextWindow: undefined, id: "ok", maxTokens: undefined, name: "ok" },
		]);
	});

	it("answers an unknown shape with nothing", () => {
		expect(parseListing({ error: { message: "nope" } })).toEqual([]);
		expect(parseListing(null)).toEqual([]);
		expect(parseListing("text")).toEqual([]);
	});

	it("ignores a zero or negative capacity rather than showing it", () => {
		expect(parseListing({ data: [{ context_length: 0, id: "zero", max_tokens: -1 }] })).toEqual([
			{ contextWindow: undefined, id: "zero", maxTokens: undefined, name: "zero" },
		]);
	});
});
