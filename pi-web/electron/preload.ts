import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("pi", {
	abort: () => ipcRenderer.invoke("pi:abort"),
	archiveSession: (sessionPath: string) => ipcRenderer.invoke("pi:archive-session", sessionPath),
	chooseDirectory: () => ipcRenderer.invoke("pi:choose-directory"),
	command: (command: unknown) => ipcRenderer.invoke("pi:command", command),
	desktopAction: (action: string) => ipcRenderer.invoke("desktop:action", action),
	enablePortableConfig: () => ipcRenderer.invoke("pi:enable-portable-config"),
	extensionUiResponse: (response: unknown) => ipcRenderer.invoke("pi:extension-ui-response", response),
	getMessages: () => ipcRenderer.invoke("pi:get-messages"),
	newSession: () => ipcRenderer.invoke("pi:new-session"),
	isWindowMaximized: () => ipcRenderer.invoke("window:is-maximized"),
	renameSession: (sessionPath: string, name: string) =>
		ipcRenderer.invoke("pi:rename-session", sessionPath, name),
	setWorkspaceCwd: (cwd: string) => ipcRenderer.invoke("pi:set-workspace-cwd", cwd),
	windowControl: (action: string) => ipcRenderer.invoke("window:control", action),
	onWindowMaximized: (listener: (maximized: boolean) => void) => {
		const handler = (_event: unknown, maximized: boolean) => listener(maximized);
		ipcRenderer.on("window:maximized", handler);
		return () => ipcRenderer.removeListener("window:maximized", handler);
	},
	listSessions: () => ipcRenderer.invoke("pi:list-sessions"),
	listFiles: (root?: string) => ipcRenderer.invoke("pi:list-files", root),
	listPackages: () => ipcRenderer.invoke("pi:list-packages"),
	installPackage: (source: string, local: boolean) =>
		ipcRenderer.invoke("pi:install-package", source, local),
	removePackage: (source: string, local: boolean) =>
		ipcRenderer.invoke("pi:remove-package", source, local),
	updatePackages: () => ipcRenderer.invoke("pi:update-packages"),
	readFile: (filePath: string) => ipcRenderer.invoke("pi:read-file", filePath),
	copyImage: (dataUrl: string) => ipcRenderer.invoke("pi:copy-image", dataUrl),
	readBytes: (filePath: string, maxBytes?: number) => ipcRenderer.invoke("pi:read-bytes", filePath, maxBytes),
	openPath: (filePath: string) => ipcRenderer.invoke("pi:open-path", filePath),
	pickSessionExportPath: (suggestedName?: string) =>
		ipcRenderer.invoke("pi:pick-session-export-path", suggestedName),
	revealPath: (filePath: string) => ipcRenderer.invoke("pi:reveal-path", filePath),
	readModelConfig: () => ipcRenderer.invoke("pi:read-model-config"),
	writeModelConfig: (patch: unknown) => ipcRenderer.invoke("pi:write-model-config", patch),
	discoverModels: (request: unknown) => ipcRenderer.invoke("pi:discover-models", request),
	exportModelConfig: (filePath?: string) => ipcRenderer.invoke("pi:export-model-config", filePath),
	importModelConfig: (filePath?: string) => ipcRenderer.invoke("pi:import-model-config", filePath),
	switchSession: (sessionPath: string) => ipcRenderer.invoke("pi:switch-session", sessionPath),
	getAvailableModels: () => ipcRenderer.invoke("pi:get-available-models"),
	getAvailableThinkingLevels: () => ipcRenderer.invoke("pi:get-available-thinking-levels"),
	getState: () => ipcRenderer.invoke("pi:get-state"),
	getRuntimeInfo: () => ipcRenderer.invoke("pi:get-runtime-info"),
	onError: (listener: (message: string) => void) => {
		const handler = (_event: unknown, message: string) => listener(message);
		ipcRenderer.on("pi:error", handler);
		return () => ipcRenderer.removeListener("pi:error", handler);
	},
	onEvent: (listener: (event: unknown) => void) => {
		const handler = (_event: unknown, event: unknown) => listener(event);
		ipcRenderer.on("pi:event", handler);
		return () => ipcRenderer.removeListener("pi:event", handler);
	},
	onExit: (listener: (info: unknown) => void) => {
		const handler = (_event: unknown, info: unknown) => listener(info);
		ipcRenderer.on("pi:exit", handler);
		return () => ipcRenderer.removeListener("pi:exit", handler);
	},
	onMenuCommand: (listener: (command: string) => void) => {
		const handler = (_event: unknown, command: string) => listener(command);
		ipcRenderer.on("pi:menu-command", handler);
		return () => ipcRenderer.removeListener("pi:menu-command", handler);
	},
	onStderr: (listener: (text: string) => void) => {
		const handler = (_event: unknown, text: string) => listener(text);
		ipcRenderer.on("pi:stderr", handler);
		return () => ipcRenderer.removeListener("pi:stderr", handler);
	},
	prompt: (text: string) => ipcRenderer.invoke("pi:prompt", text),
	restart: () => ipcRenderer.invoke("pi:restart"),
	setModel: (provider: string, modelId: string) => ipcRenderer.invoke("pi:set-model", provider, modelId),
	setThinkingLevel: (level: string) => ipcRenderer.invoke("pi:set-thinking-level", level),
	start: () => ipcRenderer.invoke("pi:start"),
	stop: () => ipcRenderer.invoke("pi:stop"),
});
