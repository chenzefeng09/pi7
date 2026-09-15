export interface EventBatcherOptions {
	cancel?: (handle: number) => void;
	flush: (events: unknown[]) => void;
	schedule?: (callback: () => void) => number;
}

export class EventBatcher {
	private buffer: unknown[] = [];
	private handle: number | undefined;
	private readonly cancel: (handle: number) => void;
	private readonly flush: (events: unknown[]) => void;
	private readonly schedule: (callback: () => void) => number;

	constructor(options: EventBatcherOptions) {
		this.flush = options.flush;
		this.schedule = options.schedule ?? ((callback) => requestAnimationFrame(callback));
		this.cancel =
			options.cancel ??
			((handle) => {
				if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(handle);
			});
	}

	push(event: unknown): void {
		this.buffer.push(event);
		if (this.handle !== undefined) return;
		this.handle = this.schedule(() => {
			this.handle = undefined;
			this.flushNow();
		});
	}

	flushNow(): void {
		if (this.handle !== undefined) {
			this.cancel(this.handle);
			this.handle = undefined;
		}
		if (this.buffer.length === 0) return;
		const events = this.buffer;
		this.buffer = [];
		this.flush(events);
	}

	dispose(): void {
		if (this.handle !== undefined) {
			this.cancel(this.handle);
			this.handle = undefined;
		}
		this.buffer = [];
	}
}
