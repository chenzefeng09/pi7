import { create } from "zustand";

const STORAGE_KEY = "pi-web.transcript";

interface TranscriptSettings {
	/** Fold a settled turn's reasoning and tool rows behind one summary line. */
	compact: boolean;
	setCompact: (value: boolean) => void;
}

function read(): boolean {
	try {
		const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as { compact?: unknown };
		return typeof parsed.compact === "boolean" ? parsed.compact : true;
	} catch {
		return true;
	}
}

function write(compact: boolean): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify({ compact }));
	} catch {}
}

/** Conversation flow preferences; compact is the dsh transcript default. */
export const useTranscriptSettings = create<TranscriptSettings>((set) => ({
	compact: read(),
	setCompact: (value) => {
		set({ compact: value });
		write(value);
	},
}));
