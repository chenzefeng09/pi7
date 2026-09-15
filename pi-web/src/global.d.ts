export {};

declare global {
	interface Window {
		pi: {
			abort(): Promise<unknown>;
			archiveSession(sessionPath: string): Promise<unknown>;
			chooseDirectory(): Promise<string | undefined>;
			command(command: unknown): Promise<unknown>;
			desktopAction(action: string): Promise<unknown>;
			enablePortableConfig(): Promise<unknown>;
			extensionUiResponse(response: unknown): Promise<unknown>;
			getAvailableModels(): Promise<unknown>;
			getAvailableThinkingLevels(): Promise<unknown>;
			getMessages(): Promise<unknown>;
			isWindowMaximized(): Promise<boolean>;
			listSessions(): Promise<unknown>;
			listFiles(root?: string): Promise<unknown>;
			listPackages(): Promise<unknown>;
			installPackage(source: string, local: boolean): Promise<unknown>;
			removePackage(source: string, local: boolean): Promise<unknown>;
			updatePackages(): Promise<unknown>;
			readFile(filePath: string): Promise<unknown>;
			copyImage(dataUrl: string): Promise<unknown>;
			readBytes(filePath: string, maxBytes?: number): Promise<unknown>;
			openPath(filePath: string): Promise<unknown>;
			pickSessionExportPath(suggestedName?: string): Promise<unknown>;
			revealPath(filePath: string): Promise<unknown>;
			readModelConfig(): Promise<unknown>;
			writeModelConfig(patch: unknown): Promise<unknown>;
			discoverModels(request: unknown): Promise<unknown>;
			exportModelConfig(filePath?: string): Promise<unknown>;
			importModelConfig(filePath?: string): Promise<unknown>;
			newSession(): Promise<unknown>;
			getState(): Promise<unknown>;
			getRuntimeInfo(): Promise<unknown>;
			onError(listener: (message: string) => void): () => void;
			onEvent(listener: (event: unknown) => void): () => void;
			onExit(listener: (info: unknown) => void): () => void;
			onMenuCommand(listener: (command: string) => void): () => void;
			onStderr(listener: (text: string) => void): () => void;
			onWindowMaximized(listener: (maximized: boolean) => void): () => void;
			prompt(text: string): Promise<unknown>;
			renameSession(sessionPath: string, name: string): Promise<unknown>;
			restart(): Promise<unknown>;
			setModel(provider: string, modelId: string): Promise<unknown>;
			setThinkingLevel(level: string): Promise<unknown>;
			setWorkspaceCwd(cwd: string): Promise<unknown>;
			start(): Promise<unknown>;
			stop(): Promise<unknown>;
			switchSession(sessionPath: string): Promise<unknown>;
			windowControl(action: string): Promise<boolean>;
		};
	}
}
