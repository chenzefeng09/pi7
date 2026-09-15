import { create } from "zustand";

const STORAGE_KEY = "pi-web.compaction";

interface CompactionSettings {
	autoCompact: boolean;
	/** Fraction of the context window that triggers an automatic compaction. */
	threshold: number;
	setAutoCompact: (enabled: boolean) => void;
	setThreshold: (threshold: number) => void;
}

function read(): { autoCompact: boolean; threshold: number } {
	try {
		const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as {
			autoCompact?: unknown;
			threshold?: unknown;
		};
		const threshold = typeof parsed.threshold === "number" ? parsed.threshold : 0.85;
		return {
			autoCompact: typeof parsed.autoCompact === "boolean" ? parsed.autoCompact : true,
			threshold: Math.min(0.95, Math.max(0.5, threshold)),
		};
	} catch {
		return { autoCompact: true, threshold: 0.85 };
	}
}

function write(state: { autoCompact: boolean; threshold: number }): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
	} catch {}
}

export const useCompactionSettings = create<CompactionSettings>((set, get) => ({
	...read(),
	setAutoCompact: (enabled) => {
		set({ autoCompact: enabled });
		write({ autoCompact: enabled, threshold: get().threshold });
	},
	setThreshold: (threshold) => {
		const next = Math.min(0.95, Math.max(0.5, threshold));
		set({ threshold: next });
		write({ autoCompact: get().autoCompact, threshold: next });
	},
}));
