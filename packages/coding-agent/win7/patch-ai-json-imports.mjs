import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const distDir = resolve(process.argv[2] ?? "packages/ai/dist");
const importPattern = /import ([A-Za-z_$][\w$]*) from "([^"]+\.json)" with \{ type: "json" \};/g;
let replacementCount = 0;

function patchDirectory(directory) {
	for (const entry of readdirSync(directory)) {
		const path = resolve(directory, entry);
		if (statSync(path).isDirectory()) {
			patchDirectory(path);
			continue;
		}
		if (!entry.endsWith(".js")) continue;

		const source = readFileSync(path, "utf8");
		const patched = source.replace(importPattern, (_statement, identifier, jsonPath) => {
			const value = JSON.parse(readFileSync(resolve(dirname(path), jsonPath), "utf8"));
			replacementCount++;
			return `const ${identifier} = ${JSON.stringify(value)};`;
		});
		if (patched !== source) writeFileSync(path, patched);
	}
}

patchDirectory(distDir);

if (replacementCount === 0) {
	throw new Error(`No JSON import attributes found under ${distDir}`);
}

console.log(`Inlined ${replacementCount} JSON imports under ${distDir}`);
