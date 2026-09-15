import type { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";

const MAX_JSONL_LINE_LENGTH = 16 * 1024 * 1024;

/**
 * Serialize a single strict JSONL record.
 *
 * Framing is LF-only. Payload strings may contain other Unicode separators such as
 * U+2028 and U+2029. Clients must split records on `\n` only.
 */
export function serializeJsonLine(value: unknown): string {
	return `${JSON.stringify(value)}\n`;
}

/**
 * Attach an LF-only JSONL reader to a stream.
 *
 * This intentionally does not use Node readline. Readline splits on additional
 * Unicode separators that are valid inside JSON strings and therefore does not
 * implement strict JSONL framing.
 */
export function attachJsonlLineReader(
	stream: Readable,
	onLine: (line: string) => void,
	onError?: (error: Error) => void,
): () => void {
	const decoder = new StringDecoder("utf8");
	let buffer = "";
	let failed = false;

	const fail = (error: Error): void => {
		if (failed) return;
		failed = true;
		buffer = "";
		stream.off("data", onData);
		stream.off("end", onEnd);
		if (onError) onError(error);
		else stream.destroy(error);
	};

	const emitLine = (line: string) => {
		onLine(line.endsWith("\r") ? line.slice(0, -1) : line);
	};

	const onData = (chunk: string | Buffer) => {
		if (failed) return;
		buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
		while (true) {
			const newlineIndex = buffer.indexOf("\n");
			if (newlineIndex === -1) {
				if (buffer.length > MAX_JSONL_LINE_LENGTH) {
					fail(new Error(`JSONL input line exceeds ${MAX_JSONL_LINE_LENGTH} characters`));
				}
				return;
			}
			if (newlineIndex > MAX_JSONL_LINE_LENGTH) {
				fail(new Error(`JSONL input line exceeds ${MAX_JSONL_LINE_LENGTH} characters`));
				return;
			}

			const line = buffer.slice(0, newlineIndex);
			buffer = buffer.slice(newlineIndex + 1);
			emitLine(line);
			if (failed) return;
		}
	};

	const onEnd = () => {
		if (failed) return;
		buffer += decoder.end();
		if (buffer.length > MAX_JSONL_LINE_LENGTH) {
			fail(new Error(`JSONL input line exceeds ${MAX_JSONL_LINE_LENGTH} characters`));
			return;
		}
		if (buffer.length > 0) {
			emitLine(buffer);
			buffer = "";
		}
	};

	stream.on("data", onData);
	stream.on("end", onEnd);

	return () => {
		failed = true;
		buffer = "";
		stream.off("data", onData);
		stream.off("end", onEnd);
	};
}
