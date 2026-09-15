export interface PiRpcCommand {
	id?: string;
	type: string;
	[key: string]: unknown;
}

export interface PiRpcResponse {
	id?: string;
	type: "response";
	command: string;
	success: boolean;
	data?: unknown;
	error?: string;
}

export interface PiRpcEvent {
	type: string;
	[key: string]: unknown;
}

export type PiRpcMessage = PiRpcResponse | PiRpcEvent;

export interface PiRuntimeInfo {
	agentDir: string;
	agentDirSource: string;
	appVersion: string;
	chrome: string;
	cliPath: string;
	cwd: string;
	electron: string;
	isPackaged: boolean;
	nodePath: string;
}
