/**
 * Node 16 (Windows 7) runtime polyfills — CommonJS preload variant.
 *
 * This is the CJS twin of `polyfills-node16.ts`. It exists so the polyfills can
 * be injected into child processes that pi does NOT launch through cli.win7.js —
 * most importantly the pi-subagents async/background runner, which is spawned as
 * `node <jiti-cli> subagent-runner.ts <cfg>` and therefore never imports the ESM
 * entry point. Preload it into every child with:
 *
 *   set NODE_OPTIONS=--require "<...>/dist/polyfills-node16.cjs"
 *
 * Node 16 only supports `--require` (CJS); `--import` (ESM) landed in Node 19.
 *
 * Every install is feature-guarded, so preloading this on a modern Node (or on
 * top of the ESM polyfill that cli.win7.ts already ran) is a harmless no-op.
 *
 * Keep this in sync with polyfills-node16.ts. Covered gaps (Node version that
 * made each a global):
 *  - globalThis.crypto (WebCrypto)      -> Node 20
 *  - fetch/Response/Request/Headers     -> Node 18  (served by undici@5)
 *  - FormData/File                      -> Node 18/20 (served by undici@5)
 *  - Blob                               -> Node 18  (node:buffer)
 *  - ReadableStream/Writable/Transform  -> Node 18  (node:stream/web)
 *  - structuredClone                    -> Node 17
 *  - AbortSignal.timeout                -> Node 17.3
 *  - Array.prototype.findLast/Index     -> Node 18
 */
"use strict";

const { Blob: NodeBlob } = require("node:buffer");
const { webcrypto } = require("node:crypto");
const { Readable } = require("node:stream");
const { ReadableStream, TransformStream, WritableStream } = require("node:stream/web");
const { deserialize, serialize } = require("node:v8");

const g = globalThis;

function define(name, value) {
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
// undici is resolved relative to THIS file — place this .cjs inside pi's app dir
// (dist/) so `require("undici")` finds pi's bundled undici@5 at ../node_modules.
let undici;
try {
	undici = require("undici");
} catch {
	undici = undefined;
}
if (undici) {
	for (const name of ["fetch", "Response", "Request", "Headers", "FormData", "File"]) {
		define(name, undici[name]);
	}
}

// Readable.fromWeb(webStream) — Node 17+.
if (typeof Readable.fromWeb !== "function") {
	Readable.fromWeb = function fromWeb(webStream, opts) {
		const reader = webStream.getReader();
		return new Readable({
			...(opts || {}),
			read() {
				reader.read().then(
					({ done, value }) => {
						this.push(done ? null : Buffer.from(value));
					},
					(error) => this.destroy(error),
				);
			},
			destroy(error, callback) {
				reader.cancel().then(
					() => callback(error),
					() => callback(error),
				);
			},
		});
	};
}

// structuredClone via v8 structured serialization (no transferables).
if (typeof g.structuredClone !== "function") {
	g.structuredClone = (value) => deserialize(serialize(value));
}

// AbortSignal.timeout(ms).
const AbortSignalCtor = g.AbortSignal;
if (AbortSignalCtor && typeof AbortSignalCtor.timeout !== "function") {
	AbortSignalCtor.timeout = (ms) => {
		const controller = new AbortController();
		const error = new Error("The operation timed out");
		error.name = "TimeoutError";
		const timer = setTimeout(() => controller.abort(error), ms);
		if (typeof timer.unref === "function") timer.unref();
		return controller.signal;
	};
}

// Array.prototype.findLast / findLastIndex (ES2023).
const arrayProto = Array.prototype;
if (typeof arrayProto.findLast !== "function") {
	Object.defineProperty(arrayProto, "findLast", {
		configurable: true,
		writable: true,
		value: function findLast(predicate) {
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
		value: function findLastIndex(predicate) {
			for (let i = this.length - 1; i >= 0; i--) {
				if (predicate(this[i], i, this)) return i;
			}
			return -1;
		},
	});
}
