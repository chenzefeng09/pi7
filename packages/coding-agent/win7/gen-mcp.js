// gen-mcp.js <bundleRoot> <agentDir>
// Registers the bundled Node16 "web" HTTP MCP server in <agentDir>/mcp.json with paths
// derived from the (relocatable) bundle root, so the portable folder works wherever it is
// extracted. Only the "web" entry is managed; any other user-added servers are preserved.
const fs = require("fs");
const path = require("path");

const bundleRoot = process.argv[2];
const agentDir = process.argv[3];
if (!bundleRoot || !agentDir) process.exit(0);

const fwd = (p) => p.split("\\").join("/");
const nodeExe = fwd(path.join(bundleRoot, "node", "node.exe"));
const serverJs = fwd(path.join(bundleRoot, "tools", "webfetch-mcp.mjs"));
const polyfill = fwd(path.join(bundleRoot, "app", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "polyfills-node16.cjs"));
const mcpPath = path.join(agentDir, "mcp.json");

let cfg = { mcpServers: {} };
try {
	if (fs.existsSync(mcpPath)) {
		const parsed = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
		if (parsed && typeof parsed === "object") cfg = parsed;
		if (!cfg.mcpServers || typeof cfg.mcpServers !== "object") cfg.mcpServers = {};
	}
} catch {
	cfg = { mcpServers: {} };
}

// Only ship the "web" server if its script is actually present in the bundle.
if (fs.existsSync(path.join(bundleRoot, "tools", "webfetch-mcp.mjs"))) {
	cfg.mcpServers.web = {
		command: nodeExe,
		args: [serverJs],
		env: {
			NODE_SKIP_PLATFORM_CHECK: "1",
			// forward slashes: NODE_OPTIONS treats backslashes as escapes on Windows
			NODE_OPTIONS: "--require " + polyfill,
		},
		lifecycle: "keep-alive",
	};
}

try {
	fs.mkdirSync(agentDir, { recursive: true });
} catch {}
fs.writeFileSync(mcpPath, JSON.stringify(cfg, null, 2) + "\n");
