import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import type { PiRpcCommand, PiRpcEvent, PiRpcMessage, PiRpcResponse } from "./types";

interface PendingRequest {
	reject: (error: Error) => void;
	resolve: (response: PiRpcResponse) => void;
}

const MAX_RPC_LINE_LENGTH = 16 * 1024 * 1024;

export interface PiRpcClientOptions {
	args: string[];
	cliPath: string;
	cwd: string;
	env?: NodeJS.ProcessEnv;
	nodePath: string;
}

export class PiRpcClient extends EventEmitter {
	private buffer = "";
	private child: ChildProcessWithoutNullStreams | undefined;
	private nextId = 1;
	private readonly pending = new Map<string, PendingRequest>();
	private readonly stoppedChildren = new WeakSet<ChildProcessWithoutNullStreams>();

	constructor(private readonly options: PiRpcClientOptions) {
		super();
	}

	get running(): boolean {
		return this.child !== undefined && this.child.exitCode === null && !this.child.killed;
	}

	start(): void {
		if (this.child) return;
		this.buffer = "";
		const child = spawn(this.options.nodePath, [this.options.cliPath, ...this.options.args], {
			cwd: this.options.cwd,
			env: {
				...process.env,
				...this.options.env,
			},
			stdio: ["pipe", "pipe", "pipe"],
		});
		this.child = child;
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => this.handleStdout(chunk));
		child.stderr.on("data", (chunk: string) => this.emit("stderr", chunk));
		// A write after shutdown otherwise emits an unhandled stream error and can take down the
		// Electron main process while the renderer is reconnecting.
		child.stdin.on("error", (error) => {
			if (this.child !== child) return;
			this.rejectAll(error);
			this.emit("error", error);
		});
		child.on("error", (error) => {
			if (this.child !== child) return;
			this.emit("error", error);
			this.rejectAll(error);
		});
		child.on("exit", (code, signal) => {
			if (this.child !== child) return;
			this.child = undefined;
			this.buffer = "";
			const stopped = this.stoppedChildren.has(child);
			this.stoppedChildren.delete(child);
			const error = new Error(
				stopped ? "pi rpc client stopped" : `pi rpc exited (code=${code ?? "null"} signal=${signal ?? "null"})`,
			);
			this.rejectAll(error);
			this.emit("exit", { code, signal, stopped });
		});
	}

	send(command: PiRpcCommand): Promise<PiRpcResponse> {
		const child = this.child;
		if (!child) throw new Error("pi rpc client is not running");
		const id = command.id ?? `req-${this.nextId++}`;
		if (this.pending.has(id)) return Promise.reject(new Error(`duplicate pi rpc request id: ${id}`));
		const payload = { ...command, id };
		return new Promise<PiRpcResponse>((resolve, reject) => {
			this.pending.set(id, { reject, resolve });
			try {
				child.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
					if (!error) return;
					this.pending.delete(id);
					reject(error);
				});
			} catch (error) {
				this.pending.delete(id);
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}

	sendNotification(command: PiRpcCommand): void {
		const child = this.child;
		if (!child) throw new Error("pi rpc client is not running");
		try {
			child.stdin.write(`${JSON.stringify(command)}\n`);
		} catch (error) {
			const writeError = error instanceof Error ? error : new Error(String(error));
			this.emit("error", writeError);
			throw writeError;
		}
	}

	stop(): void {
		const child = this.child;
		this.child = undefined;
		if (child) {
			this.stoppedChildren.add(child);
			child.stdin.end();
			child.kill();
		}
		this.rejectAll(new Error("pi rpc client stopped"));
	}

	private handleStdout(chunk: string): void {
		this.buffer += chunk;
		const firstNewline = this.buffer.indexOf("\n");
		if (firstNewline < 0 && this.buffer.length > MAX_RPC_LINE_LENGTH) {
			this.failProtocol(new Error(`pi rpc line exceeds ${MAX_RPC_LINE_LENGTH} characters`));
			return;
		}
		let index: number;
		while ((index = this.buffer.indexOf("\n")) >= 0) {
			if (index > MAX_RPC_LINE_LENGTH) {
				this.failProtocol(new Error(`pi rpc line exceeds ${MAX_RPC_LINE_LENGTH} characters`));
				return;
			}
			const line = this.buffer.slice(0, index).replace(/\r$/, "");
			this.buffer = this.buffer.slice(index + 1);
			if (line.trim()) this.handleLine(line);
		}
	}

	private handleLine(line: string): void {
		let message: PiRpcMessage;
		try {
			message = JSON.parse(line) as PiRpcMessage;
		} catch (error) {
			this.failProtocol(new Error(`invalid pi rpc json: ${String(error)}`));
			return;
		}
		if (message.type === "response") {
			const response = message as PiRpcResponse;
			if (response.id) {
				const pending = this.pending.get(response.id);
				if (pending) {
					this.pending.delete(response.id);
					if (response.success) pending.resolve(response);
					else pending.reject(new Error(response.error ?? `pi rpc command failed: ${response.command}`));
				}
			}
			this.emit("response", response);
			return;
		}
		this.emit("event", message as PiRpcEvent);
	}

	private rejectAll(error: Error): void {
		for (const pending of this.pending.values()) pending.reject(error);
		this.pending.clear();
	}

	private failProtocol(error: Error): void {
		this.buffer = "";
		this.rejectAll(error);
		this.emit("error", error);
		this.child?.kill();
	}
}
