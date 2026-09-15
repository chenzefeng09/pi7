import { create } from "zustand";
import type { SessionInfo } from "./types";
import { t } from "../i18n";

const PROJECT_LABELS_KEY = "pi-web.project-labels";
const PROJECT_ORDER_KEY = "pi-web.project-order";
const PINNED_PROJECTS_KEY = "pi-web.pinned-projects";
const PROJECTS_KEY = "pi-web.projects";
const SESSION_ORDER_KEY = "pi-web.session-order";

/** Session rows one project lists before the sidebar's 展开显示 control. */
export const COLLAPSED_SESSION_LIMIT = 8;

/** Which side of a hovered row a dragged row would land on. */
export type DropHalf = "before" | "after";

export interface ProjectRecord {
	cwd: string;
	name: string;
}

/** One folder's sessions, as the sidebar lists them. */
export interface ProjectGroup {
	cwd: string;
	name: string;
	sessions: SessionInfo[];
}

function readJson(key: string): unknown {
	try {
		return JSON.parse(localStorage.getItem(key) ?? "null") as unknown;
	} catch {
		return null;
	}
}

function writeJson(key: string, value: unknown): void {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {}
}

export function readProjectLabels(): Record<string, string> {
	const parsed = readJson(PROJECT_LABELS_KEY);
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
	const labels: Record<string, string> = {};
	for (const [key, value] of Object.entries(parsed)) {
		if (typeof value === "string") labels[key] = value;
	}
	return labels;
}

export function readProjectList(): ProjectRecord[] {
	const parsed = readJson(PROJECTS_KEY);
	if (!Array.isArray(parsed)) return [];
	return parsed.flatMap((item) => {
		if (typeof item !== "object" || item === null) return [];
		const record = item as { cwd?: unknown; name?: unknown };
		if (typeof record.cwd !== "string" || !record.cwd) return [];
		return [{ cwd: record.cwd, name: typeof record.name === "string" ? record.name : "" }];
	});
}

export function readPinnedProjects(): string[] {
	const parsed = readJson(PINNED_PROJECTS_KEY);
	return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
}

/** The folder order the user dragged into place. */
export function readProjectOrder(): string[] {
	const parsed = readJson(PROJECT_ORDER_KEY);
	return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
}

/** The dragged session order of every project, keyed by the project's folder path. */
export function readSessionOrder(): Record<string, string[]> {
	const parsed = readJson(SESSION_ORDER_KEY);
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
	const order: Record<string, string[]> = {};
	for (const [key, value] of Object.entries(parsed)) {
		if (!Array.isArray(value)) continue;
		order[key] = value.filter((item): item is string => typeof item === "string");
	}
	return order;
}

/**
 * Put a stored order onto the items that exist now: known items keep the stored order, and items
 * the order has never seen (a session added since, a folder opened for the first time) follow in
 * the order the caller handed them in. Stored entries for items that are gone are dropped, so a
 * renamed or archived session cannot leave a hole behind.
 */
function reconciledOrder(stored: readonly string[] | undefined, items: readonly string[]): string[] {
	if (stored === undefined) return [...items];
	const known = new Set(items);
	const ordered: string[] = [];
	const included = new Set<string>();
	for (const key of stored) {
		if (!known.has(key) || included.has(key)) continue;
		ordered.push(key);
		included.add(key);
	}
	for (const item of items) {
		if (!included.has(item)) ordered.push(item);
	}
	return ordered;
}

/** Pinned entries first; both halves keep the relative order their order list gave them. */
function pinnedFirst<T>(items: T[], pinned: readonly string[], key: (item: T) => string): T[] {
	if (pinned.length === 0) return items;
	const pinnedSet = new Set(pinned);
	return items.sort((left, right) => (pinnedSet.has(key(right)) ? 1 : 0) - (pinnedSet.has(key(left)) ? 1 : 0));
}

/**
 * One project's sessions as the sidebar lists them: the dragged order, the sessions it does not
 * know yet appended behind it, and pinned sessions floated to the top.
 */
export function sessionsInOrder(
	items: SessionInfo[],
	pinned: readonly string[],
	order: readonly string[] = [],
): SessionInfo[] {
	const byPath = new Map(items.map((session) => [session.path, session]));
	const ordered = reconciledOrder(order, items.map((session) => session.path)).flatMap((path) => {
		const session = byPath.get(path);
		return session ? [session] : [];
	});
	return pinnedFirst(ordered, pinned, (session) => session.path);
}

/**
 * Where a dragged session row lands, as the project's new order.
 *
 * A drag reports the half of the row the pointer released on, which names an anchor: the row that
 * should follow the dragged one. A project showing only its first rows cannot express that anchor
 * directly — the row below the hovered one may already be cut off — so the drop resolves against
 * the visible prefix and lands the dragged row at the boundary before the hidden ones. A drop that
 * would push the dragged row out of the visible prefix is refused rather than silently swallowed,
 * and a drop that changes nothing returns undefined.
 *
 * @param accountOrder - every session of the project, in the order the sidebar lists them.
 * @param renderedOrder - the rows the user can see and drop on (a prefix of `accountOrder`).
 * @param expanded - whether `renderedOrder` already is the whole project.
 * @returns the new order, or undefined when the drop asks for nothing.
 */
export function reorderSessions({
	accountOrder,
	renderedOrder,
	expanded,
	source,
	over,
	half,
}: {
	accountOrder: readonly string[];
	renderedOrder: readonly string[];
	expanded: boolean;
	source: string;
	over: string;
	half: DropHalf;
}): string[] | undefined {
	if (source === over) return undefined;
	const targetIndex = renderedOrder.indexOf(over);
	if (targetIndex === -1) return undefined;
	const sourceIndex = renderedOrder.indexOf(source);
	const withoutSource = renderedOrder.filter((path) => path !== source);
	const visibleInsertAt = half === "before" ? withoutSource.indexOf(over) : withoutSource.indexOf(over) + 1;
	if (sourceIndex !== -1 && visibleInsertAt === sourceIndex) return undefined;
	const next = accountOrder.filter((path) => path !== source);
	let anchor: string | undefined;
	if (expanded) {
		anchor = half === "before" ? over : renderedOrder[targetIndex + 1];
	} else {
		const previous = withoutSource[visibleInsertAt - 1];
		if (previous === undefined) {
			anchor = next[0];
		} else {
			const previousIndex = next.indexOf(previous);
			if (previousIndex === -1) return undefined;
			anchor = next[previousIndex + 1];
		}
	}
	const insertAt = anchor === undefined ? next.length : next.indexOf(anchor);
	next.splice(insertAt === -1 ? next.length : insertAt, 0, source);
	if (!expanded && !next.slice(0, COLLAPSED_SESSION_LIMIT).includes(source)) return undefined;
	return next;
}

export function defaultProjectName(cwd: string | undefined): string {
	if (!cwd) return t("无项目");
	const normalized = cwd.replace(/\\/g, "/").replace(/\/$/, "");
	// A bare home folder is where sessions without a project land; naming it after the user's
	// account folder collides with real projects that share that name.
	if (/^[A-Za-z]:\/Users\/[^/]+$/.test(normalized) || /^\/(home|Users)\/[^/]+$/.test(normalized)) return t("主目录");
	const name = normalized.split("/").at(-1) || normalized;
	return /^\d+$/.test(name) ? "pi" : name;
}

export function projectName(cwd: string | undefined, labels: Record<string, string>): string {
	if (!cwd) return t("无项目");
	return labels[cwd] ?? defaultProjectName(cwd);
}

/** Pinned folders first, then the busiest, then by name. */
function compareGroups(pinned: string[], left: ProjectGroup, right: ProjectGroup): number {
	return (
		(pinned.includes(right.cwd) ? 1 : 0) - (pinned.includes(left.cwd) ? 1 : 0) ||
		right.sessions.length - left.sessions.length ||
		left.name.localeCompare(right.name)
	);
}

/** Sessions grouped by their folder, with the hand-added projects that have none yet. */
export function projectGroups(
	sessions: SessionInfo[],
	labels: Record<string, string>,
	pinned: string[],
	projects: ProjectRecord[] = [],
	order: readonly string[] = [],
): ProjectGroup[] {
	const groups = new Map<string, SessionInfo[]>();
	for (const session of sessions) {
		const key = session.cwd ?? "";
		const list = groups.get(key) ?? [];
		list.push(session);
		groups.set(key, list);
	}
	const base: ProjectGroup[] = Array.from(groups.entries()).map(([cwd, items]) => ({
		cwd,
		name: projectName(cwd, labels),
		sessions: items,
	}));
	const known = new Set(base.map((group) => group.cwd));
	const extra: ProjectGroup[] = projects
		.filter((project) => project.cwd && !known.has(project.cwd))
		.map((project) => ({
			cwd: project.cwd,
			name: projectName(project.cwd, labels),
			sessions: [],
		}));
	// The hand-picked order wins; a folder the order has never seen is placed where the default
	// comparator would put it. Pins float either way, so dragging never hides a pinned folder.
	const fallback = [...base, ...extra].sort((left, right) => compareGroups(pinned, left, right));
	const byCwd = new Map(fallback.map((group) => [group.cwd, group]));
	const ordered = reconciledOrder(
		order,
		fallback.map((group) => group.cwd),
	).flatMap((cwd) => {
		const group = byCwd.get(cwd);
		return group ? [group] : [];
	});
	return pinnedFirst(ordered, pinned, (group) => group.cwd);
}

interface ProjectCatalog {
	labels: Record<string, string>;
	/** The folder order the user dragged into place. */
	order: string[];
	pinned: string[];
	projects: ProjectRecord[];
	/** The dragged session order of every project, keyed by the project's folder path. */
	sessionOrder: Record<string, string[]>;
	setLabels: (next: Record<string, string>) => void;
	setOrder: (next: string[]) => void;
	setPinned: (next: string[]) => void;
	setProjects: (next: ProjectRecord[]) => void;
	setSessionOrder: (cwd: string, next: string[]) => void;
}

/**
 * The user's project list, shared by the sidebar and the composer's project picker. It lives in
 * localStorage; keeping it in one store is what makes a rename or an added folder show up in both
 * without either surface re-reading storage.
 */
export const useProjectCatalog = create<ProjectCatalog>((set) => ({
	labels: readProjectLabels(),
	order: readProjectOrder(),
	pinned: readPinnedProjects(),
	projects: readProjectList(),
	sessionOrder: readSessionOrder(),
	setLabels: (next) => {
		writeJson(PROJECT_LABELS_KEY, next);
		set({ labels: next });
	},
	setOrder: (next) => {
		writeJson(PROJECT_ORDER_KEY, next);
		set({ order: next });
	},
	setPinned: (next) => {
		writeJson(PINNED_PROJECTS_KEY, next);
		set({ pinned: next });
	},
	setProjects: (next) => {
		writeJson(PROJECTS_KEY, next);
		set({ projects: next });
	},
	setSessionOrder: (cwd, next) => {
		set((state) => {
			const order = { ...state.sessionOrder, [cwd]: next };
			writeJson(SESSION_ORDER_KEY, order);
			return { sessionOrder: order };
		});
	},
}));
