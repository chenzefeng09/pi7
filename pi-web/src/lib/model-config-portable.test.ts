import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exportModelConfig, importModelConfig, readModelConfig } from "../../electron/bridge/model-config";

let agentDir = "";

beforeEach(() => {
	agentDir = mkdtempSync(join(tmpdir(), "pi-portable-"));
	writeFileSync(
		join(agentDir, "models.json"),
		JSON.stringify(
			{
				providers: {
					dashscope: {
						apiKey: "$DASHSCOPE_API_KEY",
						baseUrl: "https://dashscope.example/v1",
						headers: { Authorization: "Bearer header-secret", "X-Trace": "keep" },
						// A model field the editor never shows: it has to survive an export/import.
						compat: { thinkingFormat: "qwen" },
						models: [{ contextWindow: 32768, id: "qwen-max", maxTokens: 8192 }],
					},
					local: {
						apiKey: "sk-literal-secret",
						baseUrl: "http://127.0.0.1:8000/v1",
						models: [{ id: "local-model" }],
					},
				},
			},
			null,
			2,
		),
		"utf8",
	);
	writeFileSync(
		join(agentDir, "settings.json"),
		JSON.stringify(
			{ defaultModel: "qwen-max", defaultProvider: "dashscope", defaultThinkingLevel: "high", theme: "dark" },
			null,
			2,
		),
		"utf8",
	);
});

afterEach(() => {
	rmSync(agentDir, { force: true, recursive: true });
});

describe("exportModelConfig", () => {
	it("carries providers, models and defaults", () => {
		const bundle = exportModelConfig(agentDir);
		expect(bundle.format).toBe("pi-web.models");
		expect(Object.keys(bundle.providers)).toEqual(["dashscope", "local"]);
		expect(bundle.defaults).toEqual({
			enabledModels: undefined,
			model: "qwen-max",
			provider: "dashscope",
			thinkingLevel: "high",
		});
		expect(bundle.providers.dashscope).toMatchObject({
			apiKey: "$DASHSCOPE_API_KEY",
			compat: { thinkingFormat: "qwen" },
		});
	});

	it("keeps an environment reference but leaves a literal key out", () => {
		const bundle = exportModelConfig(agentDir);
		expect(bundle.redactedKeys).toBe(3);
			expect((bundle.providers.local as { apiKey?: string }).apiKey).toBeUndefined();
		expect(JSON.stringify(bundle)).not.toContain("sk-literal-secret");
		expect(JSON.stringify(bundle)).not.toContain("header-secret");
		expect((bundle.providers.dashscope as { headers?: Record<string, string> }).headers?.["X-Trace"]).toBeUndefined();
	});
});

describe("importModelConfig", () => {
	it("adds new providers, replaces existing ones and applies defaults", () => {
		const document = {
			defaults: { model: "kimi-k3", provider: "volcengine", thinkingLevel: "max" },
			exportedAt: "2026-01-01T00:00:00.000Z",
			format: "pi-web.models",
			providers: {
				dashscope: { baseUrl: "https://proxy.example/v1", models: [{ id: "qwen-max" }] },
				volcengine: { apiKey: "$VOLC_KEY", baseUrl: "https://ark.example/v3", models: [{ id: "kimi-k3" }] },
			},
			redactedKeys: 0,
			version: 1,
		};
		const summary = importModelConfig(agentDir, document);
		expect(summary.error).toBeUndefined();
		expect(summary.added).toEqual(["volcengine"]);
		expect(summary.replaced).toEqual(["dashscope"]);
		expect(summary.defaultsApplied).toBe(true);

		const view = readModelConfig(agentDir);
		expect(view.providers.map((provider) => provider.id).sort()).toEqual(["dashscope", "local", "volcengine"]);
		expect(view.defaultModel).toBe("kimi-k3");
		expect(view.defaultThinkingLevel).toBe("max");
		// A provider the file never named stays untouched.
		expect(view.providers.find((provider) => provider.id === "local")?.baseUrl).toBe("http://127.0.0.1:8000/v1");
	});

	it("keeps a local key when the file carries none", () => {
		const summary = importModelConfig(agentDir, {
			exportedAt: "2026-01-01T00:00:00.000Z",
			format: "pi-web.models",
			providers: { local: { baseUrl: "https://elsewhere.example/v1" } },
			redactedKeys: 1,
			version: 1,
		});
		expect(summary.keptKeys).toEqual(["local"]);
		const stored = JSON.parse(readFileSync(join(agentDir, "models.json"), "utf8")) as {
			providers: Record<string, { apiKey?: string; baseUrl?: string }>;
		};
		expect(stored.providers.local.apiKey).toBe("sk-literal-secret");
		expect(stored.providers.local.baseUrl).toBe("https://elsewhere.example/v1");
		// The untouched settings keys stay too.
		const settings = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8")) as { theme?: string };
		expect(settings.theme).toBe("dark");
	});

	it("refuses a file that is not one of ours", () => {
		expect(importModelConfig(agentDir, { providers: {} }).error).toContain("pi-web.models");
		expect(importModelConfig(agentDir, "text").error).toContain("JSON");
		expect(
			importModelConfig(agentDir, { format: "pi-web.models", providers: {}, version: 99 }).error,
		).toContain("版本");
		expect(importModelConfig(agentDir, { format: "pi-web.models", version: 1 }).error).toContain("providers");
	});
});
