/**
 * Assemble the bundled pi runtime under `resources/pi-win7` for one target platform.
 *
 * The runtime tree is:
 *   resources/pi-win7/
 *     app/      npm install tree: win7/package.json + the three locally packed tarballs
 *     node/     the platform's Node binary (node.exe on Windows, node elsewhere)
 *     config/   agent config, filled later by prepare-resources.mjs
 *
 * Windows bundles Node 16 (the whole point of pi-win7). macOS and Linux run the
 * normal CLI entry on a modern Node — the win7 code path is only needed there.
 *
 * Usage:
 *   node scripts/build-runtime.mjs --platform <win|mac|linux> [--arch x64|arm64]
 *                                  [--node <version>] [--force-app]
 *
 * Re-running for a different --arch refreshes only the node binary; the npm
 * install tree is reused unless --force-app is passed.
 */
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const piWebRoot = resolve(here, "..");
const repoRoot = resolve(piWebRoot, "..");
const runtimeRoot = join(piWebRoot, "resources", "pi-win7");
const appDir = join(runtimeRoot, "app");
const nodeDir = join(runtimeRoot, "node");

const args = process.argv.slice(2);
function argValue(name) {
	const index = args.indexOf(name);
	return index >= 0 ? args[index + 1] : undefined;
}

const platform = argValue("--platform");
if (!["win", "mac", "linux"].includes(platform)) {
	console.error("usage: node scripts/build-runtime.mjs --platform <win|mac|linux> [--arch x64|arm64] [--node <version>] [--force-app]");
	process.exit(1);
}
const defaultArch = platform === "mac" ? "arm64" : "x64";
const arch = argValue("--arch") ?? defaultArch;
const nodeVersion = argValue("--node") ?? (platform === "win" ? "16.20.2" : "22.19.0");
const forceApp = args.includes("--force-app");

const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

function run(cmd, argv, options = {}) {
	const result = spawnSync(cmd, argv, { stdio: "inherit", shell: true, ...options });
	if (result.status !== 0) {
		console.error(`command failed (${result.status}): ${cmd} ${argv.join(" ")}`);
		process.exit(result.status ?? 1);
	}
}

function runCapture(cmd, argv, options = {}) {
	const result = spawnSync(cmd, argv, { encoding: "utf8", shell: true, ...options });
	if (result.status !== 0) {
		console.error(`command failed (${result.status}): ${cmd} ${argv.join(" ")}\n${result.stderr}`);
		process.exit(result.status ?? 1);
	}
	return result.stdout.trim();
}

/** npm pack one workspace package and copy the tarball next to app/package.json. */
function packPackage(packageDir, tarballName) {
	const dir = join(repoRoot, packageDir);
	const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
	// @scope/name x.y.z packs deterministically as scope-name-x.y.z.tgz
	const packedName = `${manifest.name.replace("@", "").replace("/", "-")}-${manifest.version}.tgz`;
	run(NPM, ["pack", "--ignore-scripts"], { cwd: dir });
	const produced = join(dir, packedName);
	if (!existsSync(produced)) {
		console.error(`npm pack in ${packageDir} did not produce ${packedName}`);
		process.exit(1);
	}
	copyFileSync(produced, join(appDir, tarballName));
	rmSync(produced);
	console.log(`packed ${packageDir} -> ${tarballName}`);
}

const NODE_DIST = "https://nodejs.org/dist";

async function download(url, destination) {
	const response = await fetch(url);
	if (!response.ok) {
		console.error(`download failed (${response.status}): ${url}`);
		process.exit(1);
	}
	writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
	console.log(`downloaded ${url}`);
}

async function installNodeBinary() {
	rmSync(nodeDir, { recursive: true, force: true });
	mkdirSync(nodeDir, { recursive: true });
	const extractDir = join(tmpdir(), `pi7-node-${platform}-${arch}-${Date.now()}`);
	mkdirSync(extractDir, { recursive: true });
	let fileName;
	if (platform === "win") fileName = `node-v${nodeVersion}-win-x64.zip`;
	else if (platform === "mac") fileName = `node-v${nodeVersion}-darwin-${arch}.tar.gz`;
	else fileName = `node-v${nodeVersion}-linux-${arch}.tar.xz`;
	const archive = join(extractDir, fileName);
	await download(`${NODE_DIST}/v${nodeVersion}/${fileName}`, archive);
	// tar is bsdtar on the Windows/macOS runners (reads zip too) and GNU tar on Linux
	// (only ever sees tar.* archives here), so one invocation covers all three.
	run("tar", ["-xf", archive, "-C", extractDir]);
	const extractedRoot = join(extractDir, fileName.replace(/\.(zip|tar\.gz|tar\.xz)$/, ""));
	const binaryName = platform === "win" ? "node.exe" : "node";
	const binarySource = platform === "win" ? join(extractedRoot, "node.exe") : join(extractedRoot, "bin", "node");
	if (!existsSync(binarySource)) {
		console.error(`node binary not found in archive: ${binarySource}`);
		process.exit(1);
	}
	copyFileSync(binarySource, join(nodeDir, binaryName));
	const license = join(extractedRoot, "LICENSE");
	if (existsSync(license)) copyFileSync(license, join(nodeDir, "LICENSE"));
	if (platform !== "win") chmodSync(join(nodeDir, binaryName), 0o755);
	rmSync(extractDir, { recursive: true, force: true });
	console.log(`node ${nodeVersion} (${platform}/${arch}) -> resources/pi-win7/node/${binaryName}`);
}

function installApp() {
	mkdirSync(appDir, { recursive: true });
	copyFileSync(join(repoRoot, "packages", "coding-agent", "win7", "package.json"), join(appDir, "package.json"));
	// pi-ai's compiled output uses `with { type: "json" }` import attributes, which the
	// bundled Node 16 cannot parse. Inline the JSON catalogs before packing (see
	// packages/coding-agent/docs/win7.md); the patch only touches the built dist tree.
	run(process.execPath, [
		join(repoRoot, "packages", "coding-agent", "win7", "patch-ai-json-imports.mjs"),
		join(repoRoot, "packages", "ai", "dist"),
	]);
	packPackage("packages/ai", "pi-ai.tgz");
	packPackage("packages/tui", "pi-tui.tgz");
	packPackage("packages/coding-agent", "pi-coding-agent.tgz");
	// A lockfile from an earlier install pins the old file: tarball integrity, and npm then
	// reuses that cached tarball instead of the freshly packed one — silently shipping stale
	// code whenever the package version did not change.
	rmSync(join(appDir, "package-lock.json"), { force: true });
	run(NPM, ["install", "--ignore-scripts"], { cwd: appDir });
}

if (forceApp || !existsSync(join(appDir, "node_modules"))) {
	rmSync(join(appDir, "node_modules"), { recursive: true, force: true });
	installApp();
} else {
	console.log("app/ already installed (use --force-app to rebuild)");
}
await installNodeBinary();
mkdirSync(join(runtimeRoot, "config", "agent"), { recursive: true });
console.log(`runtime ready at ${runtimeRoot}`);
