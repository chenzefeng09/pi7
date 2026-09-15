/**
 * Node 16 (Windows 7) runtime polyfills.
 *
 * pi's source assumes Node >= 22 globals. To run the built `dist/` output on the
 * newest Node that still launches on Windows 7 (Node 16.x), this module installs
 * the missing globals BEFORE any application module evaluates.
 *
 * Every install is feature-guarded, so importing this on a modern Node runtime is
 * a no-op. It must be imported first — see cli.win7.ts.
 *
 * Covered gaps (Node version that made each a global):
 *  - globalThis.crypto (WebCrypto)      -> Node 20
 *  - fetch/Response/Request/Headers     -> Node 18  (served by undici@5)
 *  - FormData/File                      -> Node 18/20 (served by undici@5)
 *  - Blob                               -> Node 18  (node:buffer)
 *  - ReadableStream/Writable/Transform  -> Node 18  (node:stream/web)
 *  - structuredClone                    -> Node 17
 *  - AbortSignal.timeout                -> Node 17.3
 *  - Array.prototype.findLast/Index     -> Node 18
 */
import { Blob as NodeBlob } from "node:buffer";
import { webcrypto } from "node:crypto";
import { Readable } from "node:stream";
import { ReadableStream, TransformStream, WritableStream } from "node:stream/web";
import { deserialize, serialize } from "node:v8";
import * as undici from "undici";

type AnyGlobal = Record<string, unknown>;
const g = globalThis as unknown as AnyGlobal;

function define(name: string, value: unknown): void {
	if (typeof g[name] === "undefined" && value !== undefined) {
		g[name] = value;
	}
}

// WebCrypto: crypto.subtle.* and crypto.randomUUID() are used as bare globals.
define("crypto", webcrypto);

// Web streams.
define("ReadableStream", ReadableStream);
define("WritableStream", WritableStream);
define("TransformStream", TransformStream);

// Blob (from node:buffer, present since Node 15.7).
define("Blob", NodeBlob);

// fetch family + multipart bodies, all backed by undici@5.
for (const name of ["fetch", "Response", "Request", "Headers", "FormData", "File"] as const) {
	define(name, (undici as unknown as AnyGlobal)[name]);
}

// Readable.fromWeb(webStream) — Node 17+. Used to stream fetch() response bodies
// (web ReadableStream) into node:fs write streams (e.g. tool/self-update downloads).
const readableCtor = Readable as unknown as {
	fromWeb?: (stream: ReadableStream, opts?: object) => Readable;
};
if (typeof readableCtor.fromWeb !== "function") {
	readableCtor.fromWeb = (webStream: ReadableStream, opts?: object): Readable => {
		const reader = (webStream as unknown as { getReader: () => AnyReader }).getReader();
		return new Readable({
			...(opts as object),
			read(): void {
				reader.read().then(
					({ done, value }) => {
						this.push(done ? null : Buffer.from(value as Uint8Array));
					},
					(error: unknown) => this.destroy(error as Error),
				);
			},
			destroy(error: Error | null, callback: (e: Error | null) => void): void {
				reader.cancel().then(
					() => callback(error),
					() => callback(error),
				);
			},
		});
	};
}

interface AnyReader {
	read(): Promise<{ done: boolean; value: unknown }>;
	cancel(): Promise<void>;
}

// structuredClone via v8 structured serialization (no transferables — pi never uses them).
if (typeof g.structuredClone !== "function") {
	g.structuredClone = (value: unknown): unknown => deserialize(serialize(value));
}

// AbortSignal.timeout(ms).
const AbortSignalCtor = g.AbortSignal as (AbortSignalConstructor & AnyGlobal) | undefined;
if (AbortSignalCtor && typeof AbortSignalCtor.timeout !== "function") {
	AbortSignalCtor.timeout = (ms: number): AbortSignal => {
		const controller = new AbortController();
		const error = new Error("The operation timed out");
		error.name = "TimeoutError";
		const timer = setTimeout(() => controller.abort(error), ms);
		// Do not keep the event loop alive just for a pending timeout.
		(timer as { unref?: () => void }).unref?.();
		return controller.signal;
	};
}

interface AbortSignalConstructor {
	timeout?: (ms: number) => AbortSignal;
}

// Array.prototype.findLast / findLastIndex (ES2023).
const arrayProto = Array.prototype as unknown as AnyGlobal;
if (typeof arrayProto.findLast !== "function") {
	Object.defineProperty(arrayProto, "findLast", {
		configurable: true,
		writable: true,
		value: function findLast<T>(this: T[], predicate: (v: T, i: number, a: T[]) => unknown): T | undefined {
			for (let i = this.length - 1; i >= 0; i--) {
				if (predicate(this[i], i, this)) return this[i];
			}
			return undefined;
		},
	});
}
if (typeof arrayProto.findLastIndex !== "function") {
	Object.defineProperty(arrayProto, "findLastIndex", {
		configurable: true,
		writable: true,
		value: function findLastIndex<T>(this: T[], predicate: (v: T, i: number, a: T[]) => unknown): number {
			for (let i = this.length - 1; i >= 0; i--) {
				if (predicate(this[i], i, this)) return i;
			}
			return -1;
		},
	});
}
