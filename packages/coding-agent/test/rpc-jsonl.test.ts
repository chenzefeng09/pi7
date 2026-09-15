import { Readable } from "node:stream";
import { describe, expect, test } from "vitest";
import { attachJsonlLineReader, serializeJsonLine } from "../src/modes/rpc/jsonl.ts";

describe("RPC JSONL framing", () => {
	test("serializes strict JSONL records without escaping Unicode separators", () => {
		const line = serializeJsonLine({ text: "a\u2028b\u2029c" });

		expect(line).toContain("a\u2028b\u2029c");
		expect(line.endsWith("\n")).toBe(true);
		expect(JSON.parse(line.trim())).toEqual({ text: "a\u2028b\u2029c" });
	});

	test("splits on LF only and preserves U+2028/U+2029 inside payloads", async () => {
		const lines: string[] = [];
		const stream = Readable.from([serializeJsonLine({ text: "a\u2028b\u2029c" })]);

		const done = new Promise<void>((resolve) => {
			stream.on("end", resolve);
		});

		attachJsonlLineReader(stream, (line) => {
			lines.push(line);
		});

		await done;

		expect(lines).toHaveLength(1);
		expect(JSON.parse(lines[0])).toEqual({ text: "a\u2028b\u2029c" });
	});

	test("handles CRLF-delimited input", async () => {
		const lines: string[] = [];
		const stream = Readable.from([Buffer.from('{"a":1}\r\n{"b":2}\r\n')]);

		const done = new Promise<void>((resolve) => {
			stream.on("end", resolve);
		});

		attachJsonlLineReader(stream, (line) => {
			lines.push(line);
		});

		await done;

		expect(lines).toEqual(['{"a":1}', '{"b":2}']);
	});

	test("reassembles a line split across many chunks and keeps later lines in one chunk", async () => {
		const lines: string[] = [];
		const long = JSON.stringify({ data: "x".repeat(200_000) });
		const chunks: Buffer[] = [];
		for (let index = 0; index < long.length; index += 4096) {
			chunks.push(Buffer.from(long.slice(index, index + 4096)));
		}
		chunks.push(Buffer.from('\n{"a":1}\n{"b":2}\n{"c":'));
		chunks.push(Buffer.from("3}\n"));
		const stream = Readable.from(chunks);

		const done = new Promise<void>((resolve) => {
			stream.on("end", resolve);
		});

		attachJsonlLineReader(stream, (line) => {
			lines.push(line);
		});

		await done;

		expect(lines).toEqual([long, '{"a":1}', '{"b":2}', '{"c":3}']);
	});

	test("rejects a line over the limit even when it arrives in small chunks", async () => {
		const lines: string[] = [];
		const errors: string[] = [];
		const chunk = Buffer.from("y".repeat(1024 * 1024));
		const stream = Readable.from(Array.from({ length: 17 }, () => chunk));

		const done = new Promise<void>((resolve) => {
			stream.on("end", resolve);
			stream.on("close", resolve);
		});

		attachJsonlLineReader(
			stream,
			(line) => {
				lines.push(line);
			},
			(error) => {
				errors.push(error.message);
				stream.destroy();
			},
		);

		await done;

		expect(lines).toEqual([]);
		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain("exceeds");
	});

	test("emits a final line without trailing LF", async () => {
		const lines: string[] = [];
		const stream = Readable.from([Buffer.from('{"a":1}')]);

		const done = new Promise<void>((resolve) => {
			stream.on("end", resolve);
		});

		attachJsonlLineReader(stream, (line) => {
			lines.push(line);
		});

		await done;

		expect(lines).toEqual(['{"a":1}']);
	});
});
