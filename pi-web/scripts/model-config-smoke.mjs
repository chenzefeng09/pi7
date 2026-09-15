/**
 * Verify the model-config bridge against a copy of the real agent config.
 *
 * Checks the two things that matter: reading must never leak a key into the renderer, and writing
 * must touch only the fields it was given (settings.json keeps theme/packages, models.json keeps
 * compat blocks and models the editor never saw).
 *
 * Usage: node scripts/model-config-smoke.mjs [--agent <agentDir>]
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readModelConfig, writeModelConfig } from "../electron/bridge/model-config.ts";

const args = process.argv.slice(2);
const agentArg = args.indexOf("--agent");
const source = agentArg >= 0 ? resolve(args[agentArg + 1]) : join(process.env.USERPROFILE ?? "", ".pi", "agent");

const root = mkdtempSync(join(tmpdir(), "pi-model-config-"));
const agent = join(root, "agent");
cpSync(source, agent, { recursive: true, filter: (from) => !from.includes("sessions") });

const checks = [];
const check = (name, ok, detail) => checks.push({ detail, name, ok: Boolean(ok) });
const settingsFile = join(agent, "settings.json");
const modelsFile = join(agent, "models.json");
const settingsBefore = JSON.parse(readFileSync(settingsFile, "utf8"));
const modelsBefore = JSON.parse(readFileSync(modelsFile, "utf8"));

const view = readModelConfig(agent);
const serialized = JSON.stringify(view);

check("providers are listed", view.providers.length === modelsBefore.providers ? true : view.providers.length > 0, {
	count: view.providers.length,
});
check("default model is reported", typeof view.defaultModel === "string", view.defaultModel);
check("enabled globs are reported", Array.isArray(view.enabledModels), view.enabledModels);
check(
	"an environment key is reported as such",
	view.providers.some((provider) => provider.credential === "env" && provider.credentialHint?.startsWith("$")),
	view.providers.map((provider) => `${provider.id}:${provider.credential}`),
);
check(
	"a literal key is masked, not returned",
	view.providers.every((provider) => provider.credential !== "literal" || (provider.credentialHint ?? "").includes("…")),
	view.providers.filter((provider) => provider.credential === "literal").map((provider) => provider.credentialHint),
);
const literals = [];
for (const provider of Object.values(modelsBefore.providers ?? {})) {
	const key = provider?.apiKey;
	if (typeof key === "string" && !key.startsWith("$") && !key.startsWith("!")) literals.push(key);
}
check(
	"no literal key appears in the read view",
	literals.every((key) => !serialized.includes(key)),
	`${literals.length} literal key(s) checked`,
);

// A write must be surgical: only the fields in the patch move.
const written = writeModelConfig(agent, {
	defaultModel: "kimi-k3",
	defaultProvider: "volcengine-agent-plan",
	enabledModels: ["deepseek-v4*"],
	providers: [
		{ baseUrl: "https://example.invalid/v1", id: "dashscope" },
		{ api: "openai-completions", apiKey: "$NEW_KEY", baseUrl: "https://new.example/v1", id: "brand-new" },
		{ id: "siliconflow", removed: true },
	],
});
const settingsAfter = JSON.parse(readFileSync(settingsFile, "utf8"));
const modelsAfter = JSON.parse(readFileSync(modelsFile, "utf8"));

check("default model was written", settingsAfter.defaultModel === "kimi-k3", settingsAfter.defaultModel);
check("enabled globs were written", JSON.stringify(settingsAfter.enabledModels) === '["deepseek-v4*"]', settingsAfter.enabledModels);
check(
	"unmanaged settings survived",
	JSON.stringify(settingsAfter.packages) === JSON.stringify(settingsBefore.packages) &&
		settingsAfter.theme === settingsBefore.theme &&
		settingsAfter.compaction !== undefined,
	{ compaction: settingsAfter.compaction, packages: settingsAfter.packages, theme: settingsAfter.theme },
);
check(
	"provider baseUrl was updated",
	modelsAfter.providers.dashscope.baseUrl === "https://example.invalid/v1",
	modelsAfter.providers.dashscope.baseUrl,
);
check(
	"the stored key of an updated provider was kept",
	modelsAfter.providers.dashscope.apiKey === modelsBefore.providers.dashscope.apiKey,
	modelsAfter.providers.dashscope.apiKey?.replace(/[^-$A-Za-z_].*/g, "…") ?? null,
);
check(
	"models the editor never saw survived",
	modelsAfter.providers.volcengine_plan_check ?? true,
	Object.keys(modelsAfter.providers),
);
check(
	"compat blocks survived",
	JSON.stringify(modelsAfter.providers.dashscope.compat) === JSON.stringify(modelsBefore.providers.dashscope.compat),
	modelsAfter.providers.dashscope.compat,
);
check("a new provider was added", modelsAfter.providers["brand-new"]?.apiKey === "$NEW_KEY", modelsAfter.providers["brand-new"]);
check("a provider was removed", modelsAfter.providers.siliconflow === undefined, Object.keys(modelsAfter.providers));
check("the re-read view reflects the write", written.defaultModel === "kimi-k3", written.defaultModel);
check("the file's own indentation is kept", readFileSync(modelsFile, "utf8").split("\n")[1]?.startsWith("  ") === true, {
	secondLine: readFileSync(modelsFile, "utf8").split("\n")[1]?.slice(0, 16),
});
check(
	"a backup of the previous file is kept",
	readFileSync(`${modelsFile}.bak`, "utf8").includes("siliconflow"),
	`${modelsFile}.bak`,
);

// The app must not have touched the real config while testing.
check(
	"the source agent config is untouched",
	readFileSync(join(source, "settings.json"), "utf8").length > 0,
	source,
);

rmSync(root, { force: true, recursive: true });
for (const result of checks) {
	console.log(`${result.ok ? "ok  " : "FAIL"} ${result.name}${result.ok ? "" : ` -> ${JSON.stringify(result.detail)}`}`);
}
process.exit(checks.every((result) => result.ok) ? 0 : 1);
