import { create } from "zustand";

const STORAGE_KEY = "pi-web.sessions";

/** One session must stay open: the process always holds at least the session on screen. */
export const MIN_OPEN_SESSIONS = 1;
/** Well past this the point of the cap is gone; each handle costs a services set plus its transcript. */
export const MAX_OPEN_SESSIONS = 8;

interface SessionPoolSettings {
	/** How many session runtimes the renderer keeps alive inside the pi process. */
	maxOpenSessions: number;
	setMaxOpenSessions: (value: number) => void;
}

function clamp(value: number): number {
	if (!Number.isFinite(value)) return 3;
	return Math.min(MAX_OPEN_SESSIONS, Math.max(MIN_OPEN_SESSIONS, Math.round(value)));
}

function read(): number {
	try {
		const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as { maxOpenSessions?: unknown };
		return typeof parsed.maxOpenSessions === "number" ? clamp(parsed.maxOpenSessions) : 3;
	} catch {
		return 3;
	}
}

function write(maxOpenSessions: number): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify({ maxOpenSessions }));
	} catch {}
}

export const useSessionPoolSettings = create<SessionPoolSettings>((set) => ({
	maxOpenSessions: read(),
	setMaxOpenSessions: (value) => {
		const next = clamp(value);
		set({ maxOpenSessions: next });
		write(next);
	},
}));
