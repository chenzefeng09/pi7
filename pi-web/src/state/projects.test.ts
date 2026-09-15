import { describe, expect, it } from "vitest";
import { COLLAPSED_SESSION_LIMIT, projectGroups, reorderSessions, sessionsInOrder } from "./projects";
import type { SessionInfo } from "./types";

/** A session whose path is also its id: the sidebar keys rows and orders by path. */
function session(path: string, cwd?: string): SessionInfo {
	return { cwd, id: path, path, updatedAt: "2026-01-01T00:00:00.000Z" };
}

function paths(items: SessionInfo[]): string[] {
	return items.map((item) => item.path);
}

const ALPHA = "D:/work/alpha";
const BETA = "D:/work/beta";
const GAMMA = "D:/work/gamma";

describe("sessionsInOrder", () => {
	it("keeps the sessions a dragged order has never seen behind it", () => {
		const items = [session("a"), session("b"), session("c")];
		expect(paths(sessionsInOrder(items, [], ["c", "a"]))).toEqual(["c", "a", "b"]);
	});

	it("drops stored paths that are gone", () => {
		const items = [session("a"), session("b")];
		expect(paths(sessionsInOrder(items, [], ["gone", "b", "a"]))).toEqual(["b", "a"]);
	});

	it("floats pinned sessions to the top and keeps the dragged order under them", () => {
		const items = [session("a"), session("b"), session("c")];
		expect(paths(sessionsInOrder(items, ["c"], ["b", "a"]))).toEqual(["c", "b", "a"]);
	});
});

describe("projectGroups", () => {
	const sessions = [session("1", ALPHA), session("2", ALPHA), session("3", BETA)];

	it("keeps the default order when nothing was dragged", () => {
		expect(projectGroups(sessions, {}, [], []).map((group) => group.name)).toEqual(["alpha", "beta"]);
	});

	it("applies the dragged folder order", () => {
		expect(projectGroups(sessions, {}, [], [], [BETA, ALPHA]).map((group) => group.name)).toEqual([
			"beta",
			"alpha",
		]);
	});

	it("puts a folder the order has never seen behind the dragged ones", () => {
		const busy = [...sessions, session("4", GAMMA), session("5", GAMMA)];
		expect(projectGroups(busy, {}, [], [], [ALPHA]).map((group) => group.name)).toEqual([
			"alpha",
			"gamma",
			"beta",
		]);
	});

	it("floats a pinned folder above the dragged order", () => {
		expect(projectGroups(sessions, {}, [BETA], [], [ALPHA, BETA]).map((group) => group.name)).toEqual([
			"beta",
			"alpha",
		]);
	});

	it("keeps a hand-added folder with no sessions in the list", () => {
		const groups = projectGroups(sessions, {}, [], [{ cwd: GAMMA, name: "gamma" }], [GAMMA, ALPHA]);
		expect(groups.map((group) => group.name)).toEqual(["gamma", "alpha", "beta"]);
	});
});

describe("reorderSessions", () => {
	const accountOrder = ["a", "b", "c", "d"];

	it("lands the dragged row after the hovered one", () => {
		expect(
			reorderSessions({ accountOrder, expanded: true, half: "after", over: "c", renderedOrder: accountOrder, source: "a" }),
		).toEqual(["b", "c", "a", "d"]);
	});

	it("lands the dragged row before the hovered one", () => {
		expect(
			reorderSessions({ accountOrder, expanded: true, half: "before", over: "b", renderedOrder: accountOrder, source: "d" }),
		).toEqual(["a", "d", "b", "c"]);
	});

	it("refuses a drop that would change nothing", () => {
		expect(
			reorderSessions({ accountOrder, expanded: true, half: "before", over: "b", renderedOrder: accountOrder, source: "a" }),
		).toBeUndefined();
		expect(
			reorderSessions({ accountOrder, expanded: true, half: "after", over: "a", renderedOrder: accountOrder, source: "a" }),
		).toBeUndefined();
	});

	it("keeps a collapsed drop inside the rows the user can see", () => {
		const all = Array.from({ length: COLLAPSED_SESSION_LIMIT + 2 }, (_, index) => `s${index + 1}`);
		const visible = all.slice(0, COLLAPSED_SESSION_LIMIT);
		// Dropped after the last visible row: the row stops at the visible boundary instead of
		// joining the hidden tail, where the user would have seen it vanish.
		const next = reorderSessions({
			accountOrder: all,
			expanded: false,
			half: "after",
			over: "s8",
			renderedOrder: visible,
			source: "s3",
		});
		expect(next).toEqual(["s1", "s2", "s4", "s5", "s6", "s7", "s8", "s3", "s9", "s10"]);
	});

	it("moves a collapsed row to the head of the project", () => {
		const all = Array.from({ length: COLLAPSED_SESSION_LIMIT + 2 }, (_, index) => `s${index + 1}`);
		expect(
			reorderSessions({
				accountOrder: all,
				expanded: false,
				half: "before",
				over: "s1",
				renderedOrder: all.slice(0, COLLAPSED_SESSION_LIMIT),
				source: "s6",
			}),
		).toEqual(["s6", "s1", "s2", "s3", "s4", "s5", "s7", "s8", "s9", "s10"]);
	});
});
