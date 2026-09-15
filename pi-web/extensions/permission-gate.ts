/**
 * Permission gate: the three modes the app's composer offers, enforced on tool calls.
 *
 * pi has no sandbox of its own (docs/security.md: "Pi does not include a built-in sandbox"), so this
 * is a policy layer, not an OS boundary. What it can do exactly is refuse a file tool whose path
 * leaves the workspace; a shell command is only scanned for path-like tokens, which catches
 * accidents (a stray absolute path, `cd ..`, a redirect outside) and not a determined escape
 * (`node -e`, variable expansion, a script). The real boundary is a container or VM.
 *
 * Modes are per session: one pi process serves every session the app has open, so a single
 * module-level value would leak one project's choice into another.
 */
import os from "node:os";
import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export type PermissionMode = "full" | "read-only" | "workspace-write";

export interface GateDecision {
	allow: boolean;
	reason?: string;
}

/** Tools that change files or run commands, i.e. everything a read-only session must not reach. */
const MUTATING_TOOLS = new Set(["bash", "edit", "powershell", "write"]);
/** Tools that name their target file in `input.path`. */
const PATH_TOOLS = new Set(["edit", "write"]);
/** Tools that run a command string. */
const SHELL_TOOLS = new Set(["bash", "powershell"]);

export const MODE_LABELS: Record<PermissionMode, string> = {
	full: "完全权限",
	"read-only": "仅可查看",
	"workspace-write": "工作区内修改",
};

export function isPermissionMode(value: string): value is PermissionMode {
	return value === "full" || value === "read-only" || value === "workspace-write";
}

/** Windows compares paths case-insensitively and accepts either separator. */
function normalize(value: string): string {
	const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
	return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

/** Resolve existing ancestors too, so a new file under a junction cannot escape the root. */
function resolveTarget(value: string): string {
	let current = path.resolve(value);
	const suffix: string[] = [];
	while (true) {
		try {
			lstatSync(current);
			break;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			const parent = path.dirname(current);
			if (parent === current) throw error;
			suffix.unshift(path.basename(current));
			current = parent;
		}
	}
	return path.join(realpathSync(current), ...suffix);
}

/** True when `target` (relative to `root`, or absolute) stays inside `root`. */
export function insideWorkspace(root: string, target: string): boolean {
	try {
		const base = normalize(resolveTarget(root));
		const resolved = normalize(resolveTarget(path.resolve(root, target)));
		return resolved === base || resolved.startsWith(`${base}/`);
	} catch {
		return false;
	}
}

/**
 * Path-like tokens a shell command names that resolve outside the workspace.
 *
 * A leading `/` or `\\`, a drive (`C:\`, but not the `s:/` inside `https://`), `~`, or `..` mark a
 * token as a path candidate; relative names without those markers stay inside by construction.
 */
export function outsidePaths(command: string, root: string): string[] {
	const candidates =
		command.match(/(?:(?<![A-Za-z0-9])[A-Za-z]:[\\/]|~|\.\.|(?<![\w:./-])[\\/])[^\s"'`;|&()<>]*/g) ?? [];
	const outside = new Set<string>();
	for (const token of candidates) {
		const expanded = token.startsWith("~") ? path.join(os.homedir(), token.slice(1)) : token;
		if (!insideWorkspace(root, expanded)) outside.add(token);
	}
	return [...outside];
}

/** The gate itself: what one tool call may do under one mode. */
export function decide(
	mode: PermissionMode,
	toolName: string,
	input: Record<string, unknown>,
	root: string,
): GateDecision {
	if (mode === "full") return { allow: true };
	if (mode === "read-only") {
		if (!MUTATING_TOOLS.has(toolName)) return { allow: true };
		return {
			allow: false,
			reason: `仅可查看模式：${toolName} 会修改文件或执行命令，已拦截。需要时切换到「工作区内修改」或「完全权限」。`,
		};
	}
	if (PATH_TOOLS.has(toolName)) {
		const target = typeof input.path === "string" ? input.path : undefined;
		if (target === undefined || insideWorkspace(root, target)) return { allow: true };
		return {
			allow: false,
			reason: `工作区内修改模式：${target} 在工作区之外，已拦截。`,
		};
	}
	if (SHELL_TOOLS.has(toolName)) {
		const command = typeof input.command === "string" ? input.command : "";
		const outside = outsidePaths(command, root);
		if (outside.length === 0) return { allow: true };
		return {
			allow: false,
			reason: `工作区内修改模式：命令引用了工作区外的路径 ${outside.slice(0, 3).join("、")}，已拦截。shell 只能按路径粗略判断，确需执行请切换到「完全权限」。`,
		};
	}
	return { allow: true };
}

export default function permissionGate(pi: ExtensionAPI): void {
	const modes = new Map<string, PermissionMode>();
	const keyOf = (ctx: ExtensionContext): string => {
		try {
			return ctx.sessionManager.getSessionId();
		} catch {
			return ctx.cwd;
		}
	};

	pi.registerCommand("permission", {
		description: "切换本会话权限：read-only | workspace-write | full",
		handler: async (args, ctx) => {
			const mode = args.trim();
			if (!isPermissionMode(mode)) {
				ctx.ui.notify(`未知权限模式「${mode}」，可选 read-only / workspace-write / full`, "warning");
				return;
			}
			// The app pushes the remembered mode on every session switch, so a session seeing a
			// mode for the first time is being initialized, not switched — the composer chip
			// already shows it. Only a change on a session that had one is worth a notice.
			const key = keyOf(ctx);
			const previous = modes.get(key);
			if (previous === mode) return;
			modes.set(key, mode);
			if (previous !== undefined) {
				ctx.ui.notify(`权限模式已切换为「${MODE_LABELS[mode]}」`, "info");
			}
		},
	});

	pi.on("tool_call", async (event, ctx) => {
		// Fail closed: a session whose mode has not arrived yet (a fresh session in the gap before
		// the app pushes its remembered mode, or a session the app never opened) gets the app's
		// default boundary rather than no boundary at all.
		const mode = modes.get(keyOf(ctx)) ?? "workspace-write";
		if (mode === "full") return undefined;
		const input = (event.input ?? {}) as Record<string, unknown>;
		const decision = decide(mode, event.toolName, input, ctx.cwd);
		if (decision.allow) return undefined;
		ctx.ui.notify(decision.reason ?? "已拦截", "warning");
		return { block: true, reason: decision.reason ?? "已拦截" };
	});
}
