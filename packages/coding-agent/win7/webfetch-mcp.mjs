// Node16-compatible HTTP MCP server (stdio, newline-delimited JSON-RPC 2.0).
// Tools:
//   http_request  - general HTTP (any method/headers/body), returns status+headers+set-cookie+body,
//                   with an optional in-memory cookie jar (session) for login/API flows.
//   cookies       - inspect or clear a session's cookie jar.
// Uses global fetch (provided on Node 16 by the preloaded polyfills-node16.cjs via NODE_OPTIONS).

const jars = new Map(); // sessionId -> Map<host, Map<name, value>>

function jarFor(session) {
	if (!jars.has(session)) jars.set(session, new Map());
	return jars.get(session);
}
function hostOf(u) {
	try {
		return new URL(u).host;
	} catch {
		return "";
	}
}
function cookieHeaderFor(session, url) {
	const host = hostOf(url);
	const hostMap = jarFor(session).get(host);
	if (!hostMap || hostMap.size === 0) return "";
	return [...hostMap.entries()].map(([n, v]) => `${n}=${v}`).join("; ");
}
function storeSetCookies(session, url, setCookieList) {
	const host = hostOf(url);
	const jar = jarFor(session);
	if (!jar.has(host)) jar.set(host, new Map());
	const hostMap = jar.get(host);
	for (const sc of setCookieList) {
		const first = String(sc).split(";")[0];
		const eq = first.indexOf("=");
		if (eq < 0) continue;
		const name = first.slice(0, eq).trim();
		const value = first.slice(eq + 1).trim();
		if (!name) continue;
		// crude expiry handling: Max-Age=0 or empty value deletes
		if (/(?:^|;)\s*max-age\s*=\s*0\b/i.test(sc) || value === "") hostMap.delete(name);
		else hostMap.set(name, value);
	}
}

async function httpRequest(args) {
	const url = args.url;
	if (!url || typeof url !== "string") throw new Error("`url` (string) is required");
	const method = (args.method || "GET").toUpperCase();
	const maxBytes = typeof args.maxBytes === "number" ? args.maxBytes : 1000000;
	const timeoutMs = typeof args.timeoutMs === "number" ? args.timeoutMs : 30000;
	const redirect = args.redirect === "manual" ? "manual" : "follow";
	const headers = Object.assign({}, args.headers || {});
	if (args.session) {
		const ck = cookieHeaderFor(args.session, url);
		if (ck) {
			const existing = Object.keys(headers).find((k) => k.toLowerCase() === "cookie");
			headers[existing || "Cookie"] = existing ? `${headers[existing]}; ${ck}` : ck;
		}
	}
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	let resp;
	try {
		resp = await fetch(url, {
			method,
			headers,
			body: args.body != null && method !== "GET" && method !== "HEAD" ? String(args.body) : undefined,
			redirect,
			signal: controller.signal,
		});
	} finally {
		clearTimeout(timer);
	}
	const setCookie = typeof resp.headers.getSetCookie === "function" ? resp.headers.getSetCookie() : [];
	if (args.session && setCookie.length) storeSetCookies(args.session, resp.url || url, setCookie);
	const respHeaders = {};
	for (const [k, v] of resp.headers) {
		if (k.toLowerCase() === "set-cookie") continue;
		respHeaders[k] = v;
	}
	const full = await resp.text();
	const truncated = full.length > maxBytes;
	const body = truncated ? full.slice(0, maxBytes) : full;
	return {
		ok: resp.ok,
		status: resp.status,
		statusText: resp.statusText,
		finalUrl: resp.url || url,
		headers: respHeaders,
		setCookie,
		jarCookies: args.session ? cookieHeaderFor(args.session, resp.url || url) : undefined,
		bodyChars: full.length,
		truncated,
		body,
	};
}

function cookiesTool(args) {
	const session = args.session;
	if (!session) throw new Error("`session` is required");
	if (args.action === "clear") {
		jars.delete(session);
		return { cleared: true, session };
	}
	const jar = jars.get(session) || new Map();
	const out = {};
	for (const [host, m] of jar) {
		if (args.host && host !== args.host) continue;
		out[host] = Object.fromEntries(m);
	}
	return { session, cookies: out };
}

const TOOLS = [
	{
		name: "http_request",
		description:
			"Make an HTTP(S) request (fetch a web page or call an API). Supports any method, custom headers, and a request body. Set `session` to a stable id to persist cookies across calls (login/auth flows): stored cookies are sent automatically and Set-Cookie responses are captured. Returns status, response headers, Set-Cookie, cookie jar, and the (possibly truncated) body text.",
		inputSchema: {
			type: "object",
			properties: {
				url: { type: "string", description: "Absolute http/https URL." },
				method: { type: "string", description: "HTTP method (GET, POST, PUT, DELETE, ...). Default GET." },
				headers: { type: "object", description: "Request headers as name/value pairs.", additionalProperties: { type: "string" } },
				body: { type: "string", description: "Request body (e.g. a JSON string for APIs). Ignored for GET/HEAD." },
				session: { type: "string", description: "Optional cookie-jar id. Reuse the same id across calls to keep a logged-in session." },
				maxBytes: { type: "number", description: "Max response body characters to return (default 1000000)." },
				timeoutMs: { type: "number", description: "Request timeout in milliseconds (default 30000)." },
				redirect: { type: "string", enum: ["follow", "manual"], description: "Redirect handling. Default follow." },
			},
			required: ["url"],
			additionalProperties: false,
		},
	},
	{
		name: "cookies",
		description: "Inspect or clear the cookie jar for a session created via http_request's `session`.",
		inputSchema: {
			type: "object",
			properties: {
				session: { type: "string", description: "Cookie-jar id." },
				action: { type: "string", enum: ["get", "clear"], description: "get = list stored cookies; clear = empty the jar." },
				host: { type: "string", description: "Optional host filter for `get`." },
			},
			required: ["session", "action"],
			additionalProperties: false,
		},
	},
];

function send(msg) {
	process.stdout.write(JSON.stringify(msg) + "\n");
}

async function handle(msg) {
	const id = msg.id;
	try {
		switch (msg.method) {
			case "initialize":
				return send({
					jsonrpc: "2.0",
					id,
					result: {
						protocolVersion: (msg.params && msg.params.protocolVersion) || "2025-06-18",
						capabilities: { tools: {} },
						serverInfo: { name: "web-http", version: "1.0.0" },
					},
				});
			case "tools/list":
				return send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
			case "tools/call": {
				const name = msg.params && msg.params.name;
				const args = (msg.params && msg.params.arguments) || {};
				let result;
				if (name === "http_request") result = await httpRequest(args);
				else if (name === "cookies") result = cookiesTool(args);
				else throw new Error("unknown tool: " + name);
				return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] } });
			}
			case "resources/list":
				return send({ jsonrpc: "2.0", id, result: { resources: [] } });
			case "resources/templates/list":
				return send({ jsonrpc: "2.0", id, result: { resourceTemplates: [] } });
			case "prompts/list":
				return send({ jsonrpc: "2.0", id, result: { prompts: [] } });
			case "ping":
				return send({ jsonrpc: "2.0", id, result: {} });
			case "notifications/initialized":
				return;
			default:
				if (id !== undefined && id !== null) {
					send({ jsonrpc: "2.0", id, error: { code: -32601, message: "method not found: " + msg.method } });
				}
		}
	} catch (e) {
		if (msg.method === "tools/call" && id !== undefined && id !== null) {
			// surface tool errors to the model rather than killing the JSON-RPC call
			return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "ERROR: " + (e && e.message ? e.message : String(e)) }], isError: true } });
		}
		if (id !== undefined && id !== null) {
			send({ jsonrpc: "2.0", id, error: { code: -32603, message: e && e.message ? e.message : String(e) } });
		}
	}
}

process.stdin.setEncoding("utf8");
let buf = "";
process.stdin.on("data", (chunk) => {
	buf += chunk;
	let idx;
	while ((idx = buf.indexOf("\n")) >= 0) {
		const line = buf.slice(0, idx).trim();
		buf = buf.slice(idx + 1);
		if (!line) continue;
		let msg;
		try {
			msg = JSON.parse(line);
		} catch {
			continue;
		}
		handle(msg);
	}
});
