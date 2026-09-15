import { EventEmitter } from "node:events";
import * as undici from "undici";

export const DEFAULT_HTTP_IDLE_TIMEOUT_MS = 300_000;
// Node's 250ms default can terminate valid connection attempts on high-latency routes.
const DEFAULT_AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_MS = 2_000;

export const HTTP_IDLE_TIMEOUT_CHOICES = [
	{ label: "30 sec", timeoutMs: 30_000 },
	{ label: "1 min", timeoutMs: 60_000 },
	{ label: "2 min", timeoutMs: 120_000 },
	{ label: "5 min", timeoutMs: 300_000 },
	{ label: "disabled", timeoutMs: 0 },
] as const;

const originalGlobalFetch = globalThis.fetch;
let installedGlobalFetch: typeof globalThis.fetch | undefined;

export function parseHttpIdleTimeoutMs(value: unknown): number | undefined {
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (trimmed.toLowerCase() === "disabled") {
			return 0;
		}
		if (trimmed.length === 0) {
			return undefined;
		}
		return parseHttpIdleTimeoutMs(Number(trimmed));
	}

	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		return undefined;
	}
	return Math.floor(value);
}

export function formatHttpIdleTimeoutMs(timeoutMs: number): string {
	const choice = HTTP_IDLE_TIMEOUT_CHOICES.find((item) => item.timeoutMs === timeoutMs);
	if (choice) {
		return choice.label;
	}
	return `${timeoutMs / 1000} sec`;
}

export function applyHttpProxySettings(httpProxy: string | undefined): void {
	const proxy = httpProxy?.trim();
	if (!proxy) return;
	process.env.HTTP_PROXY ??= proxy;
	process.env.HTTPS_PROXY ??= proxy;
}

const ignoreUndiciDispatcherError = (_error: unknown): void => {};

// Undici can emit an internal Client "error" while terminating a mid-stream
// fetch body. The body stream still rejects through reader.read(); this listener
// only prevents EventEmitter's unhandled "error" special case from crashing pi.
function withUndiciErrorListener<T extends undici.Dispatcher>(dispatcher: T): T {
	if (dispatcher instanceof EventEmitter) {
		EventEmitter.prototype.on.call(dispatcher, "error", ignoreUndiciDispatcherError);
	}
	return dispatcher;
}

function createUndiciClient(origin: string | URL, options: object): undici.Dispatcher {
	return withUndiciErrorListener(new undici.Client(origin, options as undici.Client.Options));
}

function createUndiciOriginDispatcher(origin: string | URL, options: object): undici.Dispatcher {
	const dispatcherOptions = options as undici.Pool.Options;
	if (dispatcherOptions.connections === 1) {
		return createUndiciClient(origin, dispatcherOptions);
	}
	return withUndiciErrorListener(
		new undici.Pool(origin, {
			...dispatcherOptions,
			factory: createUndiciClient,
		}),
	);
}

// undici >= 6.19 ships EnvHttpProxyAgent and >= 7 ships install(); older majors
// (undici@5, used for the Node 16 / Windows 7 build) provide neither, so we build
// an equivalent dispatcher from Agent/ProxyAgent and wire fetch globals manually.
const hasModernUndici =
	typeof (undici as { EnvHttpProxyAgent?: unknown }).EnvHttpProxyAgent === "function" &&
	typeof (undici as { install?: unknown }).install === "function";

function firstProxyFromEnv(): string | undefined {
	return (
		process.env.HTTPS_PROXY ||
		process.env.https_proxy ||
		process.env.HTTP_PROXY ||
		process.env.http_proxy ||
		undefined
	);
}

// undici@5 has no install(); mirror its effect by pointing the fetch globals at
// this undici instance so they share the dispatcher configured below.
function installUndiciFetchGlobals(): void {
	const source = undici as unknown as Record<string, unknown>;
	for (const name of ["fetch", "Response", "Request", "Headers", "FormData", "File"]) {
		const value = source[name];
		if (value !== undefined) {
			(globalThis as unknown as Record<string, unknown>)[name] = value;
		}
	}
}

function buildModernDispatcher(timeoutMs: number): undici.Dispatcher {
	const EnvHttpProxyAgent = (undici as unknown as { EnvHttpProxyAgent: new (opts: object) => undici.Dispatcher })
		.EnvHttpProxyAgent;
	return withUndiciErrorListener(
		new EnvHttpProxyAgent({
			allowH2: false,
			bodyTimeout: timeoutMs,
			connect: {
				autoSelectFamilyAttemptTimeout: DEFAULT_AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_MS,
			},
			headersTimeout: timeoutMs,
			clientFactory: createUndiciClient,
			factory: createUndiciOriginDispatcher,
		}),
	);
}

function buildLegacyDispatcher(timeoutMs: number): undici.Dispatcher {
	const options = {
		bodyTimeout: timeoutMs,
		headersTimeout: timeoutMs,
		factory: createUndiciOriginDispatcher,
	} as Record<string, unknown>;
	const proxy = firstProxyFromEnv();
	const dispatcher = proxy
		? new (undici as unknown as { ProxyAgent: new (opts: object) => undici.Dispatcher }).ProxyAgent({
				uri: proxy,
				...options,
			})
		: new (undici as unknown as { Agent: new (opts: object) => undici.Dispatcher }).Agent(options);
	return withUndiciErrorListener(dispatcher);
}

function installFetchGlobals(): void {
	if (hasModernUndici) {
		(undici as unknown as { install?: () => void }).install?.();
	} else {
		installUndiciFetchGlobals();
	}
}

export function configureHttpDispatcher(timeoutMs: number = DEFAULT_HTTP_IDLE_TIMEOUT_MS): void {
	const normalizedTimeoutMs = parseHttpIdleTimeoutMs(timeoutMs);
	if (normalizedTimeoutMs === undefined) {
		throw new Error(`Invalid HTTP idle timeout: ${String(timeoutMs)}`);
	}
	const dispatcher = hasModernUndici
		? buildModernDispatcher(normalizedTimeoutMs)
		: buildLegacyDispatcher(normalizedTimeoutMs);
	undici.setGlobalDispatcher(dispatcher);
	// Keep fetch and the dispatcher on the same undici implementation. Node 26.0's
	// bundled fetch can otherwise consume compressed responses through npm undici's
	// dispatcher without decompressing them, causing response.json() failures.
	// If a caller replaced fetch after module load, preserve that deliberate override.
	const shouldInstallGlobals =
		installedGlobalFetch === undefined
			? globalThis.fetch === originalGlobalFetch
			: globalThis.fetch === installedGlobalFetch;
	if (shouldInstallGlobals) {
		installFetchGlobals();
		installedGlobalFetch = globalThis.fetch;
	}
}
