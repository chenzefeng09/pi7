import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import { InMemoryCodingAgentModelsStore } from "../src/core/models-store.ts";

function writeModels(dir: string, providers: Record<string, unknown>): string {
	const modelsPath = join(dir, "models.json");
	writeFileSync(modelsPath, `${JSON.stringify({ providers }, null, 2)}\n`);
	return modelsPath;
}

async function runtimeFor(modelsPath: string): Promise<ModelRuntime> {
	return ModelRuntime.create({
		credentials: AuthStorage.inMemory(),
		modelsPath,
		modelsStore: new InMemoryCodingAgentModelsStore(),
		allowModelNetwork: false,
	});
}

describe("keyless providers", () => {
	it("lists models of a provider that declares no credential as available", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-keyless-"));
		try {
			// A local server (vLLM/Ollama-style) needs no key: the provider entry is just a
			// baseUrl plus its model list. It must be usable, not filtered out as unconfigured.
			const runtime = await runtimeFor(
				writeModels(dir, {
					"local-vllm": {
						baseUrl: "http://127.0.0.1:8000/v1",
						api: "openai-completions",
						models: [{ id: "qwen-local", input: ["text"], contextWindow: 32768, maxTokens: 8192 }],
					},
				}),
			);
			await runtime.getAvailable();
			expect(runtime.hasConfiguredAuth("local-vllm")).toBe(true);
			expect(runtime.getAvailableSnapshot().map((model) => model.id)).toContain("qwen-local");
		} finally {
			rmSync(dir, { force: true, recursive: true });
		}
	});

	it("resolves a bare auth result so requests go out without a credential", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-keyless-"));
		try {
			const runtime = await runtimeFor(
				writeModels(dir, {
					"local-vllm": {
						baseUrl: "http://127.0.0.1:8000/v1",
						api: "openai-completions",
						models: [{ id: "qwen-local", input: ["text"], contextWindow: 32768, maxTokens: 8192 }],
					},
				}),
			);
			const auth = await runtime.getAuth("local-vllm");
			expect(auth).toBeDefined();
			expect(auth?.auth.apiKey).toBeUndefined();
		} finally {
			rmSync(dir, { force: true, recursive: true });
		}
	});

	it("still reports a provider with an unresolvable $ENV key as unconfigured", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-keyless-"));
		try {
			const runtime = await runtimeFor(
				writeModels(dir, {
					remote: {
						baseUrl: "https://example.test/v1",
						api: "openai-completions",
						apiKey: "$PI_TEST_MISSING_ENV_KEY",
						models: [{ id: "remote-model", input: ["text"], contextWindow: 32768, maxTokens: 8192 }],
					},
				}),
			);
			await runtime.getAvailable();
			expect(runtime.hasConfiguredAuth("remote")).toBe(false);
			expect(runtime.getAvailableSnapshot().some((model) => model.provider === "remote")).toBe(false);
		} finally {
			rmSync(dir, { force: true, recursive: true });
		}
	});
});
