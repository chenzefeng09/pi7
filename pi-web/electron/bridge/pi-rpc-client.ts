import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import type { PiRpcCommand, PiRpcEvent, PiRpcMessage, PiRpcResponse } from "./types";

interface PendingRequest {
	reject: (error: Error) => void;
	resolve: (response: PiRpcResponse) => void;
}

const MAX_RPC_LINE_LENGTH = 16 * 1024 * 1024;
/** How long a stopped pi gets to run its shutdown hooks before it is killed. */
const STOP_GRACE_MS = 3000;

export interface PiRpcClientOptions {
	args: string[];
	cliPath: string;
	cwd: string;
	env?: NodeJS.ProcessEnv;
	nodePath: string;
}

export class PiRpcClient extends EventEmitter {
	private buffer = "";
	/** Offset of the first unscanned character in `buffer`, so a long line is scanned once. */
	private scanFrom = 0;
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
		this.scanFrom = 0;
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
		// `close` rather than `exit`: stdout can still deliver the last response line after the
		// process itself has exited, and clearing the buffer on `exit` would drop it.
		child.on("close", (code, signal) => {
			if (this.child !== child) return;
			this.child = undefined;
			this.buffer = "";
			this.scanFrom = 0;
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

	/**
	 * Stop pi. Closing stdin is what pi's RPC mode treats as a shutdown request: it runs the
	 * extensions' `session_shutdown` hooks, kills the bash children it tracks and flushes stdout.
	 * A hard kill is only the fallback for a process that does not leave on its own.
	 */
	stop(): Promise<void> {
		const child = this.child;
		this.child = undefined;
		this.rejectAll(new Error("pi rpc client stopped"));
		if (!child) return Promise.resolve();
		this.stoppedChildren.add(child);
		return new Promise<void>((resolve) => {
			if (child.exitCode !== null || child.signalCode !== null) {
				resolve();
				return;
			}
			const timer = setTimeout(() => {
				child.kill();
			}, STOP_GRACE_MS);
			child.once("close", () => {
				clearTimeout(timer);
				resolve();
			});
			// stdin may already be gone if the process died on its own; that is not an error here.
			child.stdin.on("error", () => {});
			child.stdin.end();
		});
	}

	private handleStdout(chunk: string): void {
		this.buffer += chunk;
		let lineStart = 0;
		while (true) {
			const index = this.buffer.indexOf("\n", this.scanFrom);
			if (index < 0) {
				this.buffer = lineStart > 0 ? this.buffer.slice(lineStart) : this.buffer;
				this.scanFrom = this.buffer.length;
				if (this.buffer.length > MAX_RPC_LINE_LENGTH) {
					this.failProtocol(new Error(`pi rpc line exceeds ${MAX_RPC_LINE_LENGTH} characters`));
				}
				return;
			}
			if (index - lineStart > MAX_RPC_LINE_LENGTH) {
				this.failProtocol(new Error(`pi rpc line exceeds ${MAX_RPC_LINE_LENGTH} characters`));
				return;
			}
			const line = this.buffer.slice(lineStart, index).replace(/\r$/, "");
			lineStart = index + 1;
			this.scanFrom = lineStart;
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
		this.scanFrom = 0;
		this.rejectAll(error);
		this.emit("error", error);
		this.child?.kill();
	}
}
