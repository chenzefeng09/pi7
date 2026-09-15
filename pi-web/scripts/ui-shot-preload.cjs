// Stub of the Electron bridge for offscreen UI shots: enough canned pi state for the renderer to
// draw the sidebar, a transcript and the composer without a pi process.
const session = {
	sessionFile: "C:\\Users\\dev\\.pi\\agent\\sessions\\--D--work--\\demo.jsonl",
	sessionId: "01a092e0-demo",
};

const messages = process.env.SHOT_EMPTY === "1" ? [] : [
	{ content: [{ text: "把会话流改成 dsh 那种紧凑行，并把项目选择器放到输入框上面。", type: "text" }], role: "user" },
	{
		content: [
			{ thinking: "先看现在的渲染路径，再按 dsh 的行高和间距改。", type: "thinking" },
			{ arguments: { command: "npm run check" }, id: "call-1", name: "bash", type: "toolCall" },
			{
				arguments: { path: "D:/work/src/components/Composer.tsx" },
				id: "call-2",
				name: "read",
				type: "toolCall",
			},
			{ text: "已改完：工具行 24px、行距 16px，编辑行尾显示 +N -M。", type: "text" },
		],
		role: "assistant",
		stopReason: "stop",
	},
];

const sessions = [
	{
		cwd: "D:\\work\\app",
		firstMessage: "把会话流改成 dsh 那种紧凑行",
		id: "01a092e0-demo",
		path: session.sessionFile,
		updatedAt: new Date().toISOString(),
	},
	{
		cwd: "D:\\work\\app",
		firstMessage: "修复查看截图卡死问题",
		id: "01a092e1-demo",
		path: "C:\\Users\\dev\\.pi\\agent\\sessions\\--D--work--\\demo2.jsonl",
		updatedAt: new Date(Date.now() - 3600_000).toISOString(),
	},
	{
		cwd: "C:\\Users\\dev",
		firstMessage: "整理最近的会话记录和工作进展，生成今日简报",
		id: "01a092e2-demo",
		path: "C:\\Users\\dev\\.pi\\agent\\sessions\\--C--Users-dev--\\demo3.jsonl",
		updatedAt: new Date(Date.now() - 7200_000).toISOString(),
	},
	{
		cwd: "D:\\work\\dify_wrapper",
		firstMessage: "Dify 匿名 EndUser 的统计口径",
		id: "01a092e3-demo",
		path: "C:\\Users\\dev\\.pi\\agent\\sessions\\--D--work-dify--\\demo4.jsonl",
		updatedAt: new Date(Date.now() - 86_400_000).toISOString(),
	},
	{
		cwd: "D:\\work\\nx-skill-test",
		firstMessage: "用 skills 对 nx 设计文件做公差分析",
		id: "01a092e4-demo",
		path: "C:\\Users\\dev\\.pi\\agent\\sessions\\--D--work-nx--\\demo5.jsonl",
		updatedAt: new Date(Date.now() - 172_800_000).toISOString(),
	},
];

const noop = () => () => {};

const api = {
	abort: async () => ({}),
	archiveSession: async () => ({}),
	chooseDirectory: async () => undefined,
	command: async (command) => {
		switch (command?.type) {
			case "get_capabilities":
				return { data: { multiSession: true, protocolVersion: 2 } };
			case "get_open_sessions":
				return {
					data: {
						activeSessionId: "s1",
						sessions: [{ cwd: "D:\\work\\app", sessionFile: session.sessionFile, sessionId: "s1" }],
					},
				};
			case "get_state":
				return {
					data: {
						...session,
						followUpMode: "one-at-a-time",
						isStreaming: false,
						messageCount: messages.length,
						model: { id: "deepseek-v4-flash", name: "DeepSeek V4.1 Flash", provider: "deepseek" },
						steeringMode: "one-at-a-time",
						thinkingLevel: "high",
					},
				};
			case "get_messages":
				return { data: { messages } };
			case "get_available_models":
				return {
					data: {
						models: [
							{ id: "deepseek-v4-flash", name: "DeepSeek V4.1 Flash", provider: "deepseek" },
							{ id: "kimi-k3", name: "kimi-k3", provider: "volcengine" },
						],
					},
				};
			case "get_available_thinking_levels":
				return { data: { levels: ["low", "medium", "high"] } };
			case "get_session_stats":
				return {
					data: {
						contextUsage: { contextWindow: 400000, percent: 12, tokens: 48000 },
						cost: 0,
						sessionId: session.sessionId,
						tokens: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 48000 },
						toolCalls: 2,
						totalMessages: 2,
						userMessages: 1,
					},
				};
			case "get_commands":
				return { data: { commands: [] } };
			default:
				return { data: {} };
		}
	},
	desktopAction: async () => ({ ok: true }),
	enablePortableConfig: async () => ({}),
	extensionUiResponse: async () => ({}),
	getAvailableModels: async () => [],
	getAvailableThinkingLevels: async () => [],
	getMessages: async () => messages,
	getRuntimeInfo: async () => ({
		agentDir: "C:\\Users\\dev\\.pi\\agent",
		appVersion: "0.1.0",
		cwd: "D:\\work\\app",
		electron: "22.3.27",
	}),
	getState: async () => ({}),
	installPackage: async () => "",
	isWindowMaximized: async () => false,
	listFiles: async () => [],
	listPackages: async () => ({ global: [], project: [] }),
	listSessions: async () => sessions,
	newSession: async () => ({}),
	onError: noop,
	onEvent: noop,
	onExit: noop,
	onMenuCommand: noop,
	onStderr: noop,
	onWindowMaximized: noop,
	prompt: async () => ({}),
	readFile: async () => ({ path: "", text: "", type: "text" }),
	removePackage: async () => "",
	renameSession: async () => ({}),
	restart: async () => ({}),
	setModel: async () => ({}),
	setThinkingLevel: async () => ({}),
	setWorkspaceCwd: async () => ({}),
	start: async () => ({}),
	stop: async () => ({}),
	switchSession: async () => ({}),
	updatePackages: async () => "",
	windowControl: async () => false,
};

// The renderer runs with context isolation, so the stub has to cross the bridge explicitly.
require("electron").contextBridge.exposeInMainWorld("pi", api);
