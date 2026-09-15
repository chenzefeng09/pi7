import { create } from "zustand";

export type AppView = "chat" | "schedule";

/** What the agent may do this session; enforced by pi's permission-gate extension. */
export type PermissionMode = "full" | "read-only" | "workspace-write";

const PERMISSION_KEY = "pi-web.permission-mode";

/**
 * Remembered permission preset, defaulting to the workspace.
 *
 * A fresh install starts where the agent can do its job inside the project and nothing outside it;
 * widening that to 完全权限 is an explicit, confirmed choice in the composer menu, so it is never
 * what someone gets by not deciding.
 */
function readPermissionMode(): PermissionMode {
	try {
		const stored = localStorage.getItem(PERMISSION_KEY);
		return stored === "read-only" || stored === "full" ? stored : "workspace-write";
	} catch {
		return "workspace-write";
	}
}

/** Pages of the session-tools dialog; whoever opens one names the page. */
export type SessionToolMode = "entries" | "fork" | "stats" | "tree";

interface UiStore {
	aboutOpen: boolean;
	/** True while the transcript is showing its end, which is what hides the jump-to-bottom button. */
	atTranscriptEnd: boolean;
	/** Right-hand file panel: the workspace tree with a preview. */
	filePanelOpen: boolean;
	goal?: string;
	jumpToBottomRequest: number;
	planMode: boolean;
	/** Preset remembered across sessions; new sessions inherit it. */
	permissionMode: PermissionMode;
	projectDialogOpen: boolean;
	/** Page of the session-tools dialog to show; null keeps it closed. */
	sessionPanel: SessionToolMode | null;
	settingsOpen: boolean;
	sidebarCollapsed: boolean;
	view: AppView;
	setAboutOpen: (open: boolean) => void;
	setAtTranscriptEnd: (value: boolean) => void;
	setFilePanelOpen: (open: boolean) => void;
	setGoal: (goal?: string) => void;
	setPlanMode: (enabled: boolean) => void;
	setPermissionMode: (mode: PermissionMode) => void;
	setProjectDialogOpen: (open: boolean) => void;
	setSessionPanel: (mode: SessionToolMode | null) => void;
	setSettingsOpen: (open: boolean) => void;
	setSidebarCollapsed: (collapsed: boolean) => void;
	setView: (view: AppView) => void;
	/** Ask the transcript to jump to its end; the counter makes repeated clicks work. */
	requestJumpToBottom: () => void;
}

export const useUiStore = create<UiStore>((set) => ({
	aboutOpen: false,
	atTranscriptEnd: true,
	filePanelOpen: false,
	jumpToBottomRequest: 0,
	planMode: false,
	permissionMode: readPermissionMode(),
	projectDialogOpen: false,
	sessionPanel: null,
	settingsOpen: false,
	sidebarCollapsed: false,
	view: "chat",
	setAboutOpen: (open) => set({ aboutOpen: open }),
	setAtTranscriptEnd: (value) => set({ atTranscriptEnd: value }),
	setFilePanelOpen: (open) => set({ filePanelOpen: open }),
	setGoal: (goal) => set({ goal: goal?.trim() ? goal.trim() : undefined }),
	setPlanMode: (enabled) => set({ planMode: enabled }),
	setPermissionMode: (mode) => {
		try {
			localStorage.setItem(PERMISSION_KEY, mode);
		} catch {
			// The in-memory selection remains usable when storage is unavailable or full.
		}
		set({ permissionMode: mode });
	},
	setProjectDialogOpen: (open) => set({ projectDialogOpen: open }),
	setSessionPanel: (mode) => set({ sessionPanel: mode }),
	setSettingsOpen: (open) => set({ settingsOpen: open }),
	setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
	setView: (view) => set({ view }),
	requestJumpToBottom: () => set((state) => ({ jumpToBottomRequest: state.jumpToBottomRequest + 1 })),
}));
