// migrate-config.js <oldBundleRoot> <newBundleRoot>
// Migrates portable user state without replacing the new runtime or bundled packages.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const BUNDLED_PACKAGE_SOURCES = [
	"npm:pi-subagents@0.64.0",
	"npm:pi-mcp-adapter@2.11.0",
	"npm:@juicesharp/rpiv-ask-user-question@2.9.0",
	"npm:@juicesharp/rpiv-todo@2.9.0",
];

const oldRootArg = process.argv[2];
const newRootArg = process.argv[3];
if (!oldRootArg || !newRootArg) {
	console.error("Usage: migrate-config.js <oldBundleRoot> <newBundleRoot>");
	process.exit(2);
}

const oldRoot = path.resolve(oldRootArg);
const newRoot = path.resolve(newRootArg);
const oldAgentDir = path.join(oldRoot, "config", "agent");
const newAgentDir = path.join(newRoot, "config", "agent");

if (oldRoot.toLowerCase() === newRoot.toLowerCase()) {
	console.error("The old and new bundle directories must be different.");
	process.exit(2);
}
if (!fs.existsSync(oldAgentDir)) {
	console.error(`Old portable config not found: ${oldAgentDir}`);
	process.exit(2);
}
if (!fs.existsSync(path.join(newRoot, "node", "node.exe"))) {
	console.error(`New portable runtime not found: ${newRoot}`);
	process.exit(2);
}

fs.mkdirSync(newAgentDir, { recursive: true });

const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
const backupRoot = path.join(newRoot, "_upgrade-backups", timestamp);
const reportPath = path.join(newRoot, `upgrade-report-${timestamp}.txt`);
const warnings = [];
let copiedUserFiles = 0;
let backedUpFiles = 0;
let mergedNpmFiles = 0;
let mergedBinFiles = 0;
let skippedLinks = 0;

function ensureParent(filePath) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function hashFile(filePath) {
	const hash = crypto.createHash("sha256");
	const fd = fs.openSync(filePath, "r");
	const buffer = Buffer.allocUnsafe(64 * 1024);
	try {
		let bytesRead;
		do {
			bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
			if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
		} while (bytesRead > 0);
	} finally {
		fs.closeSync(fd);
	}
	return hash.digest("hex");
}

function filesMatch(left, right) {
	const leftStat = fs.statSync(left);
	const rightStat = fs.statSync(right);
	return leftStat.size === rightStat.size && hashFile(left) === hashFile(right);
}

function copyUserFile(source, target, relativePath) {
	if (fs.existsSync(target) && filesMatch(source, target)) return;
	if (fs.existsSync(target)) {
		const backupPath = path.join(backupRoot, "config", "agent", relativePath);
		ensureParent(backupPath);
		fs.copyFileSync(target, backupPath);
		backedUpFiles += 1;
	}
	ensureParent(target);
	fs.copyFileSync(source, target);
	copiedUserFiles += 1;
}

function copyUserTree(sourceDir, targetDir, relativeDir = "") {
	for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
		const relativePath = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
		const source = path.join(sourceDir, entry.name);
		const target = path.join(targetDir, entry.name);
		if (entry.isSymbolicLink()) {
			skippedLinks += 1;
			warnings.push(`Skipped symbolic link: config\\agent\\${relativePath}`);
			continue;
		}
		if (entry.isDirectory()) {
			fs.mkdirSync(target, { recursive: true });
			copyUserTree(source, target, relativePath);
			continue;
		}
		if (entry.isFile()) copyUserFile(source, target, relativePath);
	}
}

function copyTree(sourceDir, targetDir, counter) {
	if (!fs.existsSync(sourceDir)) return;
	for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
		const source = path.join(sourceDir, entry.name);
		const target = path.join(targetDir, entry.name);
		if (entry.isSymbolicLink()) {
			skippedLinks += 1;
			continue;
		}
		if (entry.isDirectory()) {
			fs.mkdirSync(target, { recursive: true });
			copyTree(source, target, counter);
			continue;
		}
		if (entry.isFile()) {
			ensureParent(target);
			fs.copyFileSync(source, target);
			counter();
		}
	}
}

function copyMissingFiles(sourceDir, targetDir, counter) {
	if (!fs.existsSync(sourceDir)) return;
	for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
		const source = path.join(sourceDir, entry.name);
		const target = path.join(targetDir, entry.name);
		if (entry.isSymbolicLink()) {
			skippedLinks += 1;
			continue;
		}
		if (entry.isDirectory()) {
			fs.mkdirSync(target, { recursive: true });
			copyMissingFiles(source, target, counter);
		} else if (entry.isFile() && !fs.existsSync(target)) {
			ensureParent(target);
			fs.copyFileSync(source, target);
			counter();
		}
	}
}

function copyMissingNpmPackages(sourceRoot, targetRoot) {
	if (!fs.existsSync(sourceRoot)) return;
	fs.mkdirSync(targetRoot, { recursive: true });
	for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
		if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
		const source = path.join(sourceRoot, entry.name);
		const target = path.join(targetRoot, entry.name);
		if (entry.name === ".bin") {
			copyMissingFiles(source, target, () => {
				mergedNpmFiles += 1;
			});
			continue;
		}
		if (entry.name.startsWith("@")) {
			fs.mkdirSync(target, { recursive: true });
			for (const scopedEntry of fs.readdirSync(source, { withFileTypes: true })) {
				if (!scopedEntry.isDirectory() || scopedEntry.isSymbolicLink()) continue;
				const scopedSource = path.join(source, scopedEntry.name);
				const scopedTarget = path.join(target, scopedEntry.name);
				if (fs.existsSync(scopedTarget)) continue;
				fs.mkdirSync(scopedTarget, { recursive: true });
				copyTree(scopedSource, scopedTarget, () => {
					mergedNpmFiles += 1;
				});
			}
			continue;
		}
		if (fs.existsSync(target)) continue;
		fs.mkdirSync(target, { recursive: true });
		copyTree(source, target, () => {
			mergedNpmFiles += 1;
		});
	}
}

function readJson(filePath) {
	const text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
	return JSON.parse(text);
}

function sourceOf(entry) {
	return typeof entry === "string" ? entry : entry && typeof entry.source === "string" ? entry.source : "";
}

function npmIdentity(source) {
	if (!source.startsWith("npm:")) return source;
	const spec = source.slice(4);
	if (spec.startsWith("@")) {
		const separator = spec.indexOf("@", 1);
		return separator === -1 ? spec : spec.slice(0, separator);
	}
	const separator = spec.lastIndexOf("@");
	return separator <= 0 ? spec : spec.slice(0, separator);
}

function mergePackages(oldPackages, newPackages) {
	const oldList = Array.isArray(oldPackages) ? oldPackages : [];
	const newList = Array.isArray(newPackages) ? newPackages : [];
	const bundledIdentities = new Set(BUNDLED_PACKAGE_SOURCES.map((source) => npmIdentity(source)));
	const merged = [];

	for (const fixedSource of BUNDLED_PACKAGE_SOURCES) {
		const identity = npmIdentity(fixedSource);
		const oldEntry = oldList.find((entry) => npmIdentity(sourceOf(entry)) === identity);
		const newEntry = newList.find((entry) => npmIdentity(sourceOf(entry)) === identity);
		const template = oldEntry || newEntry;
		merged.push(template && typeof template === "object" ? { ...template, source: fixedSource } : fixedSource);
	}

	const seen = new Set(merged.map((entry) => npmIdentity(sourceOf(entry))));
	for (const entry of [...oldList, ...newList]) {
		const source = sourceOf(entry);
		if (!source) continue;
		const identity = npmIdentity(source);
		if (bundledIdentities.has(identity) || seen.has(identity)) continue;
		seen.add(identity);
		merged.push(entry);
	}
	return merged;
}

const oldSettingsPath = path.join(oldAgentDir, "settings.json");
const newSettingsPath = path.join(newAgentDir, "settings.json");
let settingsMerged = false;
let mergedPackages = [];

if (fs.existsSync(oldSettingsPath)) {
	try {
		const oldSettings = readJson(oldSettingsPath);
		const newSettings = fs.existsSync(newSettingsPath) ? readJson(newSettingsPath) : {};
		const mergedSettings = { ...newSettings, ...oldSettings };
		mergedSettings.packages = mergePackages(oldSettings.packages, newSettings.packages);
		mergedPackages = mergedSettings.packages;
		if (fs.existsSync(newSettingsPath)) {
			const backupPath = path.join(backupRoot, "config", "agent", "settings.json");
			ensureParent(backupPath);
			fs.copyFileSync(newSettingsPath, backupPath);
			backedUpFiles += 1;
		}
		fs.writeFileSync(newSettingsPath, `${JSON.stringify(mergedSettings, null, 2)}\n`);
		settingsMerged = true;
	} catch (error) {
		warnings.push(`Could not merge old settings.json; new settings were kept: ${error.message}`);
	}
}

const oldMcpPath = path.join(oldAgentDir, "mcp.json");
if (fs.existsSync(oldMcpPath)) {
	try {
		readJson(oldMcpPath);
		copyUserFile(oldMcpPath, path.join(newAgentDir, "mcp.json"), "mcp.json");
	} catch (error) {
		warnings.push(`Old mcp.json is invalid and was not activated: ${error.message}`);
	}
}

for (const entry of fs.readdirSync(oldAgentDir, { withFileTypes: true })) {
	if (["npm", "bin", "tmp"].includes(entry.name) || ["settings.json", "mcp.json"].includes(entry.name)) continue;
	const source = path.join(oldAgentDir, entry.name);
	const target = path.join(newAgentDir, entry.name);
	if (entry.isSymbolicLink()) {
		skippedLinks += 1;
		warnings.push(`Skipped symbolic link: config\\agent\\${entry.name}`);
	} else if (entry.isDirectory()) {
		fs.mkdirSync(target, { recursive: true });
		copyUserTree(source, target, entry.name);
	} else if (entry.isFile()) {
		copyUserFile(source, target, entry.name);
	}
}

copyMissingNpmPackages(path.join(oldAgentDir, "npm", "node_modules"), path.join(newAgentDir, "npm", "node_modules"));
copyMissingFiles(path.join(oldAgentDir, "bin"), path.join(newAgentDir, "bin"), () => {
	mergedBinFiles += 1;
});

const bundledIdentities = new Set(BUNDLED_PACKAGE_SOURCES.map((source) => npmIdentity(source)));
for (const entry of mergedPackages) {
	const identity = npmIdentity(sourceOf(entry));
	if (!sourceOf(entry).startsWith("npm:") || bundledIdentities.has(identity)) continue;
	const oldPackageJson = path.join(oldAgentDir, "npm", "node_modules", identity, "package.json");
	const newPackageJson = path.join(newAgentDir, "npm", "node_modules", identity, "package.json");
	if (!fs.existsSync(oldPackageJson)) {
		warnings.push(`Configured custom npm package was not installed in the old bundle: ${identity}`);
		continue;
	}
	if (!fs.existsSync(newPackageJson)) {
		warnings.push(`Configured custom npm package could not be copied into the new bundle: ${identity}`);
		continue;
	}
	try {
		const oldVersion = readJson(oldPackageJson).version;
		const newVersion = readJson(newPackageJson).version;
		if (oldVersion && newVersion && oldVersion !== newVersion) {
			warnings.push(`Custom npm package version conflict kept the new copy: ${identity} (${oldVersion} -> ${newVersion})`);
		}
	} catch (error) {
		warnings.push(`Could not verify custom npm package ${identity}: ${error.message}`);
	}
}

const report = [
	"pi Windows 7 portable upgrade report",
	"====================================",
	`Created: ${new Date().toISOString()}`,
	`Old bundle: ${oldRoot}`,
	`New bundle: ${newRoot}`,
	"",
	`User files copied: ${copiedUserFiles}`,
	`New-bundle files backed up before replacement: ${backedUpFiles}`,
	`Missing npm files copied without replacing new packages: ${mergedNpmFiles}`,
	`Missing tool files copied without replacing new tools: ${mergedBinFiles}`,
	`Settings merged: ${settingsMerged ? "yes" : "no"}`,
	`Symbolic links skipped: ${skippedLinks}`,
	"",
	"Bundled extension versions kept by this release:",
	...BUNDLED_PACKAGE_SOURCES.map((source) => `  ${source}`),
	"",
	"Runtime files under app, node, tools, conemu, and the root launchers were not",
	"copied from the old bundle. Reapply any local code changes manually by comparing",
	"against the unchanged old directory.",
	"",
	`Rollback: close pi and launch the old bundle at ${oldRoot}`,
];
if (backedUpFiles > 0) report.push(`New-file backups: ${backupRoot}`);
if (warnings.length > 0) report.push("", "Warnings:", ...warnings.map((warning) => `  ${warning}`));

fs.writeFileSync(reportPath, `${report.join("\r\n")}\r\n`);
console.log(`REPORT=${reportPath}`);
console.log(`Migrated ${copiedUserFiles} user files; preserved the new runtime and bundled packages.`);
