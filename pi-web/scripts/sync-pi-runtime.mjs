/**
 * Copy a freshly built pi-coding-agent `dist/` into the bundled Win7 runtime.
 *
 * The bundled runtime under `resources/pi-win7/app` is an npm install tree of the published
 * pi packages (see docs/pi-runtime-patch.md). Local patches to pi's source are not published,
 * so after `npm run build` in the monorepo their compiled files must be copied into that tree -
 * and into the staging copy the dev app runs from - or the app keeps executing the old code.
 *
 * Usage:
 *   node scripts/sync-pi-runtime.mjs [--dry-run] [--dist <dir>] [--target <dir> ...]
 *
 * Defaults: dist = <monorepo>/packages/coding-agent/dist
 *           targets = resources/pi-win7/app/node_modules/@earendil-works/pi-coding-agent/dist
 *                     plus the dev staging dir from PI_WIN7_CLI, when it points at a dist tree.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const piWebRoot = resolve(here, "..");
const repoRoot = resolve(piWebRoot, "..");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
function argValue(name) {
	const index = args.indexOf(name);
	return index >= 0 ? args[index + 1] : undefined;
}

const distDir = resolve(argValue("--dist") ?? join(repoRoot, "packages", "coding-agent", "dist"));
const targets = [];
for (let index = 0; index < args.length; index += 1) {
	if (args[index] === "--target" && args[index + 1]) targets.push(resolve(args[index + 1]));
}
if (targets.length === 0) {
	targets.push(join(piWebRoot, "resources", "pi-win7", "app", "node_modules", "@earendil-works", "pi-coding-agent", "dist"));
	const stagingCli = process.env.PI_WIN7_CLI;
	// PI_WIN7_CLI points at <stage>/node_modules/@earendil-works/pi-coding-agent/dist/cli.win7.js
	if (stagingCli) targets.push(dirname(resolve(stagingCli)));
}

/** Packaging artifacts of a full monorepo build; the Win7 runtime runs the unbundled tree. */
const BUILD_ONLY_PREFIXES = ["bundle/", "bun/"];

if (!existsSync(distDir)) {
	console.error(`missing build output: ${distDir}\nRun: cd packages/coding-agent && npm run build`);
	process.exit(1);
}

function walk(dir) {
	const files = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) files.push(...walk(full));
		else files.push(full);
	}
	return files;
}

let copied = 0;
let missing = 0;
let failed = false;
for (const target of targets) {
	if (!existsSync(target)) {
		console.error(`target does not exist: ${target}`);
		failed = true;
		continue;
	}
	console.log(`sync ${distDir}\n  -> ${target}`);
	for (const source of walk(distDir)) {
		if (!source.endsWith(".js") && !source.endsWith(".json") && !source.endsWith(".cjs")) continue;
		const relative = source.slice(distDir.length + 1);
		if (BUILD_ONLY_PREFIXES.some((prefix) => relative.startsWith(prefix))) continue;
		const destination = join(target, relative);
		if (existsSync(destination)) {
			const same =
				statSync(source).size === statSync(destination).size &&
				readFileSync(source).equals(readFileSync(destination));
			if (same) continue;
		}
		if (!existsSync(dirname(destination))) {
			console.error(`  no such file in runtime: ${relative}`);
			missing += 1;
			continue;
		}
		console.log(`  ${dryRun ? "would copy" : "copy"} ${relative}`);
		if (!dryRun) copyFileSync(source, destination);
		copied += 1;
	}
}
if (missing > 0) {
	console.error(`${missing} file(s) exist in the build but not in the runtime - the runtime may be a different pi version`);
}
console.log(`${dryRun ? "dry run: " : ""}${copied} file(s) ${dryRun ? "to copy" : "copied"} across ${targets.length} target(s)`);
process.exit(failed || missing > 0 ? 1 : 0);
