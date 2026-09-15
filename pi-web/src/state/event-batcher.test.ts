import { describe, expect, it, vi } from "vitest";
import { EventBatcher } from "./event-batcher";

describe("EventBatcher", () => {
	it("coalesces multiple pushes into one scheduled flush", () => {
		const flush = vi.fn();
		const callbacks: Array<() => void> = [];
		const batcher = new EventBatcher({
			flush,
			schedule: (callback) => {
				callbacks.push(callback);
				return callbacks.length;
			},
		});
		batcher.push({ type: "a" });
		batcher.push({ type: "b" });
		batcher.push({ type: "c" });
		expect(flush).not.toHaveBeenCalled();
		expect(callbacks).toHaveLength(1);
		callbacks[0]();
		expect(flush).toHaveBeenCalledTimes(1);
		expect(flush).toHaveBeenCalledWith([{ type: "a" }, { type: "b" }, { type: "c" }]);
	});

	it("flushes immediately and cancels the scheduled callback", () => {
		const flush = vi.fn();
		const cancel = vi.fn();
		let scheduled: (() => void) | undefined;
		const batcher = new EventBatcher({
			cancel,
			flush,
			schedule: (callback) => {
				scheduled = callback;
				return 42;
			},
		});
		batcher.push({ type: "delta" });
		batcher.flushNow();
		expect(cancel).toHaveBeenCalledWith(42);
		expect(flush).toHaveBeenCalledWith([{ type: "delta" }]);
		scheduled?.();
		expect(flush).toHaveBeenCalledTimes(1);
	});

	it("flushes without a frame once the buffer is full", () => {
		const flush = vi.fn();
		const batcher = new EventBatcher({
			flush,
			// The window being hidden is exactly when no frame ever arrives.
			schedule: () => 1,
		});
		for (let index = 0; index < 200; index += 1) batcher.push({ index });
		expect(flush).toHaveBeenCalledTimes(1);
		expect(flush.mock.calls[0][0]).toHaveLength(200);
		batcher.push({ index: 200 });
		expect(flush).toHaveBeenCalledTimes(1);
	});

	it("drops buffered events on dispose", () => {
		const flush = vi.fn();
		const batcher = new EventBatcher({
			flush,
			schedule: () => 1,
		});
		batcher.push({ type: "delta" });
		batcher.dispose();
		batcher.flushNow();
		expect(flush).not.toHaveBeenCalled();
	});
});
