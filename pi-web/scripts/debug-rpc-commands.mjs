import { spawn } from "node:child_process";

const nodePath =
	process.env.PI_WIN7_NODE ?? "C:\\Users\\27581\\AppData\\Local\\nvm\\v16.20.2\\node.exe";
const cliPath =
	process.env.PI_WIN7_CLI ??
	"D:\\chenzefeng\\Develop\\pi\\pi-web\\resources\\pi-win7\\app\\node_modules\\@earendil-works\\pi-coding-agent\\dist\\cli.win7.js";
const agentDir = process.env.PI_CODING_AGENT_DIR ?? "D:\\chenzefeng\\Develop\\pi\\pi-web\\.test-agent";

const child = spawn(nodePath, [cliPath, "--mode", "rpc", "--no-session"], {
	env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
	stdio: ["pipe", "pipe", "pipe"],
});
let buffer = "";
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
	buffer += chunk;
	let index;
	while ((index = buffer.indexOf("\n")) >= 0) {
		const line = buffer.slice(0, index);
		buffer = buffer.slice(index + 1);
		if (line.trim()) console.log(line);
	}
});
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => process.stderr.write(chunk));
child.on("exit", (code) => process.exit(code ?? 0));

setTimeout(() => child.stdin.write(`${JSON.stringify({ id: "commands", type: "get_commands" })}\n`), 1000);
setTimeout(() => child.stdin.write(`${JSON.stringify({ id: "state", type: "get_state" })}\n`), 1500);
setTimeout(() => child.stdin.end(), 3000);
