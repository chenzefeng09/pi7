import {
	Archive,
	Bell,
	CalendarClock,
	ChevronRight,
	CirclePlus,
	Database,
	Folder,
	FolderPlus,
	Gauge,
	GitFork,
	Info,
	Loader2,
	MoreHorizontal,
	Pencil,
	Pin,
	Plus,
	Search,
	Settings,
	SquarePen,
	X,
} from "lucide-react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { COLLAPSED_SESSION_LIMIT, defaultProjectName, type DropHalf, projectGroups, reorderSessions, sessionsInOrder, useProjectCatalog, type ProjectRecord } from "../state/projects";
import { sessionMapKey, useBlankSession, usePiStore, useSessionCwd } from "../state/store";
import type { SessionInfo } from "../state/types";
import { useUiStore } from "../state/ui";
import { buttonClass } from "./buttons";
import {
	MENU_ITEM_CLASS,
	MENU_ITEM_DANGER_CLASS,
	MENU_LABEL_CLASS,
	MENU_PANEL_CLASS,
	MENU_SEPARATOR_CLASS,
	MENU_SHORTCUT_CLASS,
} from "./Menu";
import { Modal } from "./Modal";
import { popoverOverlayClass, popoverPanelClass, Presence } from "./Presence";
import { cacheHitRate, formatPercent, formatTokens } from "./usage";

const PINNED_SESSIONS_KEY = "pi-web.pinned-sessions";

function readStringList(key: string): string[] {
	try {
		const parsed = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown;
		return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
	} catch {
		return [];
	}
}

function sessionTitle(session: SessionInfo): string {
	const rawTitle = session.name ?? session.firstMessage ?? "新对话";
	return /^[A-Za-z]:[\\/]/.test(rawTitle) || rawTitle.startsWith("/") ? "新对话" : rawTitle;
}

function sessionTime(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "";
	return date.toLocaleString("zh-CN", { day: "numeric", hour: "2-digit", minute: "2-digit", month: "numeric" });
}

/** In-flight session-row drag: its project, its row, and the boundary the marker sits on. */
interface SessionDrag {
	cwd: string;
	path: string;
	over: { path: string; half: DropHalf } | null;
}

/** In-flight project-row drag: the folder being moved and the boundary the marker sits on. */
interface ProjectDrag {
	cwd: string;
	over: { cwd: string; half: DropHalf } | null;
}

/** The drag wiring one session row needs from the list that owns the drag state. */
interface SessionRowDrag {
	/** A session drag inside this project is in flight. */
	active: boolean;
	/** Marker on this row: insert above, below, or nothing. */
	marker: DropHalf | null;
	drop: (half: DropHalf) => void;
	end: () => void;
	hover: (half: DropHalf) => void;
	start: () => void;
}

/** Which half of the hovered row (or project section) the pointer is in. */
function rowHalf(event: { clientY: number; currentTarget: HTMLElement }): DropHalf {
	const rect = event.currentTarget.getBoundingClientRect();
	return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
}

/**
 * Accept the native drag at document level while a row drag is in flight.
 *
 * Only rows are drop targets, so releasing over a project header, a modal or the transcript would
 * otherwise look like a rejected drop even though dragend is about to commit the last hovered
 * boundary. Accepting the drag document-wide keeps the cursor honest; the marker, not the drop
 * event, is what decides where the row lands.
 */
function useNativeDragAcceptance(active: boolean): void {
	useEffect(() => {
		if (!active) return;
		const acceptDrag = (event: DragEvent) => {
			event.preventDefault();
			if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
		};
		const acceptDrop = (event: DragEvent) => {
			event.preventDefault();
		};
		document.addEventListener("dragover", acceptDrag);
		document.addEventListener("drop", acceptDrop);
		return () => {
			document.removeEventListener("dragover", acceptDrag);
			document.removeEventListener("drop", acceptDrop);
		};
	}, [active]);
}

export function Sidebar() {
	const [bellOpen, setBellOpen] = useState(false);
	const [editProject, setEditProject] = useState<{ cwd: string; value: string } | null>(null);
	const [searchOpen, setSearchOpen] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");
	const [expanded, setExpanded] = useState<Record<string, boolean>>({});
	const [pinnedSessions, setPinnedSessions] = useState<string[]>(() => readStringList(PINNED_SESSIONS_KEY));
	const [projectMenu, setProjectMenu] = useState<{ cwd: string; left: number; top: number } | null>(null);
	const [shownProjectMenu, setShownProjectMenu] = useState<{ cwd: string; left: number; top: number } | null>(null);
	const [sessionMenu, setSessionMenu] = useState<{ left: number; top: number; session: SessionInfo } | null>(null);
	const [shownSessionMenu, setShownSessionMenu] = useState<{ left: number; top: number; session: SessionInfo } | null>(
		null,
	);
	const [renameTarget, setRenameTarget] = useState<{ path: string; title: string; value: string } | null>(null);
	const [archiveTarget, setArchiveTarget] = useState<{ path: string; title: string } | null>(null);
	const [projectDraft, setProjectDraft] = useState<ProjectRecord>({ cwd: "", name: "" });
	const [error, setError] = useState<string | undefined>(undefined);
	const searchRef = useRef<HTMLInputElement | null>(null);
	const activeHandleId = usePiStore((state) => state.activeHandleId);
	const backgroundSessions = usePiStore((state) => state.backgroundSessions);
	const closeHandle = usePiStore((state) => state.closeHandle);
	const cloneSession = usePiStore((state) => state.cloneSession);
	const beginSessionSwitch = usePiStore((state) => state.beginSessionSwitch);
	const dismissNotification = usePiStore((state) => state.dismissNotification);
	const handles = usePiStore((state) => state.handles);
	const loadSessions = usePiStore((state) => state.loadSessions);
	const multiSession = usePiStore((state) => state.multiSession);
	const newSessionIn = usePiStore((state) => state.newSessionIn);
	const newSession = usePiStore((state) => state.newSession);
	const sessionCwd = useSessionCwd();
	const setAboutOpen = useUiStore((state) => state.setAboutOpen);
	const clearNotificationHistory = usePiStore((state) => state.clearNotificationHistory);
	const notificationHistory = usePiStore((state) => state.notificationHistory);
	const reconnect = usePiStore((state) => state.reconnect);
	const sessionFile = usePiStore((state) => state.sessionFile);
	const sessionId = usePiStore((state) => state.sessionId);
	const sessionStats = usePiStore((state) => state.sessionStats);
	const blankSession = useBlankSession();
	const sessions = usePiStore((state) => state.sessions);
	const showSession = usePiStore((state) => state.showSession);
	const status = usePiStore((state) => state.status);
	const switchSession = usePiStore((state) => state.switchSession);
	const tokensPerSecond = usePiStore((state) => state.outputTokensPerSecond);
	const projectDialogOpen = useUiStore((state) => state.projectDialogOpen);
	const setProjectDialogOpen = useUiStore((state) => state.setProjectDialogOpen);
	const setSessionPanel = useUiStore((state) => state.setSessionPanel);
	const setSettingsOpen = useUiStore((state) => state.setSettingsOpen);
	const setView = useUiStore((state) => state.setView);
	const view = useUiStore((state) => state.view);
	const labels = useProjectCatalog((state) => state.labels);
	const projectOrder = useProjectCatalog((state) => state.order);
	const pinnedProjects = useProjectCatalog((state) => state.pinned);
	const projects = useProjectCatalog((state) => state.projects);
	const sessionOrder = useProjectCatalog((state) => state.sessionOrder);
	const setLabels = useProjectCatalog((state) => state.setLabels);
	const setPinnedProjects = useProjectCatalog((state) => state.setPinned);
	const setProjectOrder = useProjectCatalog((state) => state.setOrder);
	const setProjects = useProjectCatalog((state) => state.setProjects);
	const setSessionOrder = useProjectCatalog((state) => state.setSessionOrder);
	const groups = useMemo(
		() => projectGroups(sessions, labels, pinnedProjects, projects, projectOrder),
		[labels, pinnedProjects, projectOrder, projects, sessions],
	);
	const hitRate = sessionStats ? cacheHitRate(sessionStats.tokens) : undefined;
	const activeProjectMenu = shownProjectMenu
		? groups.find((group) => group.cwd === shownProjectMenu.cwd)
		: undefined;
	// The visible session's project: what 新对话 and the hover button on a project row start in.
	const activeProjectName = sessionCwd
		? (groups.find((group) => group.cwd === sessionCwd)?.name ?? defaultProjectName(sessionCwd))
		: undefined;
	const query = searchQuery.trim().toLowerCase();

	useEffect(() => {
		if (searchOpen) searchRef.current?.focus();
	}, [searchOpen]);

	useEffect(() => {
		if (projectDialogOpen) setProjectDraft({ cwd: "", name: "" });
	}, [projectDialogOpen]);

	useEffect(() => {
		if (!sessionMenu) return;
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") setSessionMenu(null);
		};
		window.addEventListener("keydown", closeOnEscape);
		return () => window.removeEventListener("keydown", closeOnEscape);
	}, [sessionMenu]);

	useEffect(() => {
		if (!projectMenu) return;
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") setProjectMenu(null);
		};
		window.addEventListener("keydown", closeOnEscape);
		return () => window.removeEventListener("keydown", closeOnEscape);
	}, [projectMenu]);

	const openProjectMenu = (event: ReactMouseEvent<HTMLButtonElement>, cwd: string) => {
		event.stopPropagation();
		const rect = event.currentTarget.getBoundingClientRect();
		const left = Math.max(12, Math.min(rect.left - 60, window.innerWidth - 300));
		const top = Math.max(12, Math.min(rect.bottom + 6, window.innerHeight - 200));
		setProjectMenu({ cwd, left, top });
		setShownProjectMenu({ cwd, left, top });
	};

	const saveProjectName = () => {
		if (!editProject) return;
		const value = editProject.value.trim();
		const next = { ...labels };
		if (value) next[editProject.cwd] = value;
		else delete next[editProject.cwd];
		setLabels(next);
		setEditProject(null);
	};

	const toggleProjectPinned = (cwd: string) => {
		setPinnedProjects(
			pinnedProjects.includes(cwd) ? pinnedProjects.filter((item) => item !== cwd) : [cwd, ...pinnedProjects],
		);
	};

	const toggleSessionPinned = (sessionPath: string) => {
		const next = pinnedSessions.includes(sessionPath)
			? pinnedSessions.filter((item) => item !== sessionPath)
			: [sessionPath, ...pinnedSessions];
		setPinnedSessions(next);
		try {
			localStorage.setItem(PINNED_SESSIONS_KEY, JSON.stringify(next));
		} catch {}
	};

	const openSessionMenu = (event: ReactMouseEvent<HTMLElement>, session: SessionInfo, atPointer: boolean) => {
		event.preventDefault();
		event.stopPropagation();
		const rect = event.currentTarget.getBoundingClientRect();
		const left = atPointer ? event.clientX - 12 : rect.right - 180;
		const top = atPointer ? event.clientY - 8 : rect.bottom + 4;
		const next = {
			left: Math.max(12, Math.min(left, window.innerWidth - 220)),
			session,
			top: Math.max(12, Math.min(top, window.innerHeight - 200)),
		};
		setSessionMenu(next);
		// Kept while the menu animates out, so it does not lose its session mid-exit.
		setShownSessionMenu(next);
	};

	// Sessions belong to a workspace folder. A multi-session pi opens a session in its own cwd,
	// so only the single-session fallback (and creating a project in a new folder) still needs
	// the process restarted onto that workspace.
	const switchWorkspace = async (cwd: string) => {
		try {
			const info = (await window.pi.getRuntimeInfo()) as { cwd?: string } | undefined;
			if (!cwd || info?.cwd === cwd) return;
			await window.pi.setWorkspaceCwd(cwd);
			// keepSession: the pending switch below loads the target session itself.
			await reconnect({ keepSession: true });
		} catch {}
	};

	// A project is a folder: the next new session runs there, which for a multi-session pi means
	// a second handle rather than a restart.
	const startSession = async (cwd?: string) => {
		setView("chat");
		setError(undefined);
		try {
			await newSessionIn(cwd);
		} catch (sessionError) {
			setError(sessionError instanceof Error ? sessionError.message : String(sessionError));
		}
	};

	const selectProject = (cwd: string) => {
		// Reveal where the next session lands instead of leaving the list as it was.
		setExpanded((current) => ({ ...current, [cwd]: true }));
	};

	const openSession = async (session: SessionInfo) => {
		setView("chat");
		// Without the multi-session patch a switch still aborts the running turn, and a session
		// from another project needs the whole process restarted onto that workspace.
		if (!multiSession) {
			// Re-opening the visible session only re-reads it, so the transcript stays put.
			if (session.id !== sessionId) beginSessionSwitch(session);
			if (session.cwd) await switchWorkspace(session.cwd);
			await switchSession(session.path);
			return;
		}
		// With it, pi adopts the session's own cwd for tools: opening the handle is all a switch
		// needs, and the session on screen keeps streaming.
		try {
			await showSession(session.path);
		} catch (openError) {
			setError(openError instanceof Error ? openError.message : String(openError));
		}
	};

	const renameSession = async () => {
		if (!renameTarget) return;
		const value = renameTarget.value.trim();
		if (!value) return;
		try {
			await window.pi.renameSession(renameTarget.path, value);
			setRenameTarget(null);
			await loadSessions();
		} catch (renameError) {
			setError(renameError instanceof Error ? renameError.message : String(renameError));
		}
	};

	const forkSession = async (session: SessionInfo) => {
		setView("chat");
		try {
			// Cloning copies the visible session, so the clicked one has to be on screen first.
			if (multiSession) await showSession(session.path);
			else await switchSession(session.path);
			await cloneSession();
		} catch (forkError) {
			setError(forkError instanceof Error ? forkError.message : String(forkError));
		}
	};

	const archiveSession = async () => {
		if (!archiveTarget) return;
		try {
			const handleId = handles[sessionMapKey(archiveTarget.path)];
			const visible =
				sessionFile !== undefined && sessionMapKey(archiveTarget.path) === sessionMapKey(sessionFile);
			// Archiving the visible session moves its handle onto a new session file first.
			if (visible) await newSession();
			// A handle still holding the archived file must go, otherwise pi keeps a deleted
			// JSONL alive and the renderer keeps a session that is no longer listed.
			if (handleId && handleId !== activeHandleId) await closeHandle(handleId);
			await window.pi.archiveSession(archiveTarget.path);
			setArchiveTarget(null);
			await loadSessions();
		} catch (archiveError) {
			setError(archiveError instanceof Error ? archiveError.message : String(archiveError));
		}
	};

	const chooseProjectFolder = async () => {
		const picked = (await window.pi.chooseDirectory()) as string | undefined;
		if (picked) setProjectDraft((current) => ({ ...current, cwd: picked }));
	};

	const createProject = async () => {
		const cwd = projectDraft.cwd;
		if (!cwd) return;
		const name = projectDraft.name.trim() || defaultProjectName(cwd);
		setProjects([...projects.filter((project) => project.cwd !== cwd), { cwd, name }]);
		setLabels({ ...labels, [cwd]: name });
		setProjectDialogOpen(false);
		setView("chat");
		// The new project is where the next session belongs, so open it in that folder.
		try {
			await newSessionIn(cwd);
		} catch (sessionError) {
			setError(sessionError instanceof Error ? sessionError.message : String(sessionError));
		}
	};

	const filteredSessions = useMemo(() => {
		if (!query) return [];
		return sessions.filter((session) => sessionTitle(session).toLowerCase().includes(query)).slice(0, 20);
	}, [query, sessions]);

	// Transient drag state: which row is in flight and which boundary the marker sits on. The drop
	// itself is committed on dragend, so releasing anywhere still lands on the last boundary seen.
	const [sessionDrag, setSessionDrag] = useState<SessionDrag | null>(null);
	const sessionDropCommitted = useRef(false);
	const [projectDrag, setProjectDrag] = useState<ProjectDrag | null>(null);
	const projectDropCommitted = useRef(false);
	useNativeDragAcceptance(sessionDrag !== null || projectDrag !== null);

	// A session drag stays inside its project: the row moves within that folder's list, and a
	// collapsed folder resolves the drop against the rows it actually shows.
	const commitSessionDrag = (activeDrag: SessionDrag, over: { path: string; half: DropHalf }) => {
		if (sessionDropCommitted.current) return;
		sessionDropCommitted.current = true;
		setSessionDrag(null);
		const group = groups.find((candidate) => candidate.cwd === activeDrag.cwd);
		if (!group) return;
		const showAll = expanded[`more:${group.cwd}`] ?? false;
		const ordered = sessionsInOrder(group.sessions, pinnedSessions, sessionOrder[group.cwd]);
		const visible = showAll ? ordered : ordered.slice(0, COLLAPSED_SESSION_LIMIT);
		const next = reorderSessions({
			accountOrder: ordered.map((session) => session.path),
			expanded: showAll,
			half: over.half,
			over: over.path,
			renderedOrder: visible.map((session) => session.path),
			source: activeDrag.path,
		});
		if (next) setSessionOrder(activeDrag.cwd, next);
	};

	// A project drag reorders the folder list itself. The order written back is the one on screen,
	// so the next render of the sidebar is exactly what the drop showed.
	const commitProjectDrag = (activeDrag: ProjectDrag, over: { cwd: string; half: DropHalf }) => {
		if (projectDropCommitted.current) return;
		projectDropCommitted.current = true;
		setProjectDrag(null);
		const overIndex = groups.findIndex((group) => group.cwd === over.cwd);
		if (overIndex === -1) return;
		const anchor = over.half === "before" ? over.cwd : groups[overIndex + 1]?.cwd;
		if (anchor === activeDrag.cwd) return;
		const order = groups.map((group) => group.cwd);
		const next = order.filter((cwd) => cwd !== activeDrag.cwd);
		const insertAt = anchor === undefined ? next.length : next.indexOf(anchor);
		next.splice(insertAt === -1 ? next.length : insertAt, 0, activeDrag.cwd);
		if (next.every((cwd, index) => cwd === order[index])) return;
		setProjectOrder(next);
	};

	const renderSession = (session: SessionInfo, drag?: SessionRowDrag) => {
		const active = session.id === sessionId;
		const pinned = pinnedSessions.includes(session.path);
		const title = sessionTitle(session);
		// The row's two marks say different things: a spinner means "still working", a dot means
		// "produced something while you were away". Being the visible session is neither — that is
		// what the row's own selected background is for, so it stays unmarked.
		const handleId = handles[sessionMapKey(session.path)];
		const slice = handleId ? backgroundSessions[handleId] : undefined;
		const running = active ? status === "streaming" : slice?.streaming === true;
		const unread = !active && !running && slice?.unread === true;
		return (
			<div
				className={`group mb-0.5 flex items-center rounded-lg transition-colors ${
					active ? "bg-black/[0.07]" : "hover:bg-black/[0.05]"
				} ${drag?.marker === "before" ? "pi-drop-before" : drag?.marker === "after" ? "pi-drop-after" : ""}`}
				draggable={drag !== undefined}
				key={session.path}
				onDragEnd={drag?.end}
				onDragOver={
					drag === undefined
						? undefined
						: (event) => {
								if (!drag.active) return;
								event.preventDefault();
								event.dataTransfer.dropEffect = "move";
								drag.hover(rowHalf(event));
							}
				}
				onDragStart={
					drag === undefined
						? undefined
						: (event) => {
								event.dataTransfer.effectAllowed = "move";
								event.dataTransfer.setData("text/plain", session.path);
								drag.start();
							}
				}
				onDrop={
					drag === undefined
						? undefined
						: (event) => {
								if (!drag.active) return;
								event.preventDefault();
								drag.drop(rowHalf(event));
							}
				}
			>
				<button
					className={`flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left text-[14px] ${
						active ? "font-medium text-[#111827]" : "text-[#3f4a43]"
					}`}
					onClick={() => void openSession(session)}
					onContextMenu={(event) => openSessionMenu(event, session, true)}
					title={`${title} · 会话 ${session.id.slice(0, 8)} · ${sessionTime(session.updatedAt)}`}
					type="button"
				>
					<span className="min-w-0 flex-1 truncate">{title}</span>
					{pinned ? <Pin className="shrink-0 text-[#9aa3ad]" size={11} /> : null}
					{running ? (
						<span className="flex shrink-0 items-center text-[#7f9d88]" title="正在运行">
							<Loader2 className="animate-spin" size={13} />
						</span>
					) : null}
					{unread ? (
						<span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#2f7df6]" title="有新内容" />
					) : null}
				</button>
				<button
					className="mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-[#8a938c] opacity-0 transition-opacity hover:bg-black/[0.06] group-hover:opacity-100"
					onClick={(event) => openSessionMenu(event, session, false)}
					title="会话菜单"
					type="button"
				>
					<MoreHorizontal size={15} />
				</button>
			</div>
		);
	};

	return (
		<aside className="flex w-[248px] shrink-0 flex-col text-[#1f2937]">
			<div className="relative flex h-[56px] items-center justify-between px-4">
				<button
					className="flex items-center rounded-lg px-1 py-1 text-[17px] font-bold tracking-[-0.01em] hover:bg-black/[0.05]"
					onClick={() => setAboutOpen(true)}
					title="关于 π7"
					type="button"
				>
					π7
				</button>
				<div className="flex items-center gap-0.5">
					<button
						className={`flex h-8 w-8 items-center justify-center rounded-lg text-[#4b5563] hover:bg-black/[0.05] ${searchOpen ? "bg-black/[0.07]" : ""}`}
						onClick={() => {
							setSearchOpen((value) => !value);
							setSearchQuery("");
						}}
						title="搜索会话"
						type="button"
					>
						<Search size={17} />
					</button>
					<button
						className={`flex h-8 w-8 items-center justify-center rounded-lg text-[#4b5563] hover:bg-black/[0.05] ${bellOpen ? "bg-black/[0.07]" : ""}`}
						onClick={() => setBellOpen((value) => !value)}
						title="通知记录"
						type="button"
					>
						<Bell size={17} />
					</button>
				</div>
				<Presence open={bellOpen}>
					{({ phase }) => (
						<>
							<div
								className={popoverOverlayClass(phase)}
								onClick={() => setBellOpen(false)}
								role="presentation"
							/>
							<div className={`${MENU_PANEL_CLASS} ${popoverPanelClass(phase)} right-2 top-[50px] w-[320px] p-0`}>
								<div className="flex items-center justify-between px-3 pb-1 pt-2">
									<span className="text-[12px] font-medium text-[#8b95a1]">通知记录</span>
									{notificationHistory.length > 0 ? (
										<button
											className="text-[11px] text-[#98a2b3] hover:text-[#4b5563]"
											onClick={() => clearNotificationHistory()}
											type="button"
										>
											清空
										</button>
									) : null}
								</div>
								{notificationHistory.length === 0 ? (
									<div className="px-2.5 py-5 text-center text-[12px] text-[#98a2b3]">暂无通知</div>
								) : (
									<div className="scrollbar-subtle max-h-[300px] overflow-y-auto pb-1">
										{notificationHistory.map((notification) => (
											<div className="flex items-start gap-2 rounded-lg px-2.5 py-1.5" key={`${notification.id}-${notification.at ?? 0}`}>
												<span
													className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
														notification.type === "error"
															? "bg-[#f04438]"
															: notification.type === "warning"
																? "bg-[#f79009]"
																: "bg-[#2f7df6]"
													}`}
												/>
												<span className="min-w-0 flex-1 break-words text-[12px] leading-5 text-[#374151]">
													{notification.message}
												</span>
												{notification.at ? (
													<span className="shrink-0 pt-0.5 text-[11px] text-[#98a2b3]">
														{new Date(notification.at).toLocaleTimeString("zh-CN", {
															hour: "2-digit",
															minute: "2-digit",
														})}
													</span>
												) : null}
											</div>
										))}
									</div>
								)}
							</div>
						</>
					)}
				</Presence>
			</div>

			{searchOpen ? (
				<div className="px-3 pb-1">
					<div className="flex h-9 items-center gap-2 rounded-full border border-black/[0.08] bg-white/70 px-3">
						<Search className="shrink-0 text-[#8b95a1]" size={14} />
						<input
							className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[#98a2b3]"
							onChange={(event) => setSearchQuery(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Escape") {
									setSearchOpen(false);
									setSearchQuery("");
								}
							}}
							placeholder="搜索会话"
							ref={searchRef}
							value={searchQuery}
						/>
					</div>
				</div>
			) : null}

			<nav className="flex flex-col gap-0.5 px-2.5 pt-2">
				<div className="group flex items-center rounded-lg transition-colors hover:bg-black/[0.05]">
					<SidebarAction
						icon={<SquarePen size={18} />}
						label="新对话"
						onClick={() => void startSession(blankSession ? undefined : sessionCwd)}
					/>
					<button
						className="mr-1.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#6b7280] opacity-0 transition-opacity hover:bg-black/[0.06] group-hover:opacity-100"
						onClick={() => void startSession(blankSession ? undefined : sessionCwd)}
						title={activeProjectName ? `在 ${activeProjectName} 中新建会话` : "新对话"}
						type="button"
					>
						<CirclePlus size={16} />
					</button>
				</div>
				<SidebarAction
					icon={<CalendarClock size={18} />}
					label="定时任务"
					onClick={() => setView("schedule")}
				/>
			</nav>

			<div className="scrollbar-subtle mt-6 flex-1 overflow-y-auto px-2.5 pb-4">
				{searchOpen && query ? (
					filteredSessions.length === 0 ? (
						<div className="px-3 py-2 text-[13px] text-[#8a938c]">没有匹配的会话</div>
					) : (
						filteredSessions.map((session) => renderSession(session))
					)
				) : (
					<>
						<div className="flex items-center justify-between px-3 pb-2">
							<span className="text-[13px] font-medium text-[#8a938c]">项目</span>
							<button
								className="flex h-5 w-5 items-center justify-center rounded text-[#8a938c] hover:bg-black/[0.06] hover:text-[#4b5563]"
								onClick={() => setProjectDialogOpen(true)}
								title="添加项目"
								type="button"
							>
								<Plus size={14} />
							</button>
						</div>
						{groups.map((group) => {
							const isExpanded = expanded[group.cwd] ?? true;
							const showAll = expanded[`more:${group.cwd}`] ?? false;
							// The dragged order and the pins apply to the whole project; the collapsed view only
							// cuts the list afterwards, so a pinned session never falls out of sight.
							const ordered = sessionsInOrder(group.sessions, pinnedSessions, sessionOrder[group.cwd]);
							const visible = showAll ? ordered : ordered.slice(0, COLLAPSED_SESSION_LIMIT);
							const marker = projectDrag?.over?.cwd === group.cwd ? projectDrag.over.half : null;
							return (
								<div
									className={`mb-1 ${
										marker === "before" ? "pi-drop-before" : marker === "after" ? "pi-drop-after" : ""
									}`}
									key={group.cwd || "no-project"}
									onDragOver={
										projectDrag === null
											? undefined
											: (event) => {
													event.preventDefault();
													event.dataTransfer.dropEffect = "move";
													const half = rowHalf(event);
													setProjectDrag((current) =>
														current === null ? current : { ...current, over: { cwd: group.cwd, half } },
													);
												}
									}
									onDrop={
										projectDrag === null
											? undefined
											: (event) => {
													event.preventDefault();
													commitProjectDrag(projectDrag, { cwd: group.cwd, half: rowHalf(event) });
												}
									}
								>
									<div
										className="group flex items-center rounded-lg transition-colors hover:bg-black/[0.05]"
										draggable
										onDragEnd={() => {
											if (projectDrag?.over) commitProjectDrag(projectDrag, projectDrag.over);
											else setProjectDrag(null);
											projectDropCommitted.current = false;
										}}
										onDragStart={(event) => {
											event.dataTransfer.effectAllowed = "move";
											event.dataTransfer.setData("text/plain", group.cwd);
											projectDropCommitted.current = false;
											setProjectDrag({ cwd: group.cwd, over: null });
										}}
									>
										<button
											className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-[14px] font-medium"
											onClick={() => setExpanded((current) => ({ ...current, [group.cwd]: !isExpanded }))}
											type="button"
										>
											<Folder className="shrink-0 text-[#6f7a72]" size={16} />
											<span className="min-w-0 flex-1 truncate">{group.name}</span>
											{pinnedProjects.includes(group.cwd) ? (
												<Pin className="shrink-0 fill-current text-[#7f8b83]" size={12} />
											) : null}
											<ChevronRight
												className={`shrink-0 text-[#9aa3ad] transition-transform ${isExpanded ? "rotate-90" : ""}`}
												size={14}
											/>
										</button>
										<button
											className="mr-1.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#8a938c] opacity-0 transition-opacity hover:bg-black/[0.06] group-hover:opacity-100"
											onClick={(event) => {
												event.stopPropagation();
												void startSession(group.cwd);
											}}
											title={`在 ${group.name} 中新建会话`}
											type="button"
										>
											<SquarePen size={15} />
										</button>
										<button
											className="mr-1.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#8a938c] opacity-0 transition-opacity hover:bg-black/[0.06] group-hover:opacity-100"
											onClick={(event) => openProjectMenu(event, group.cwd)}
											title="项目菜单"
											type="button"
										>
											<MoreHorizontal size={16} />
										</button>
									</div>
									{isExpanded ? (
										<div>
											{visible.map((session) => {
												// A session drag stays inside its project, so every other project's rows ignore it.
												const sameProject =
													sessionDrag !== null && sessionDrag.cwd === group.cwd;
												return renderSession(session, {
													active: sameProject,
													drop: (half) => {
														if (sessionDrag !== null) {
															commitSessionDrag(sessionDrag, { half, path: session.path });
														}
													},
													end: () => {
														if (sessionDrag?.over) commitSessionDrag(sessionDrag, sessionDrag.over);
														else setSessionDrag(null);
														sessionDropCommitted.current = false;
													},
													hover: (half) => {
														setSessionDrag((current) =>
															current === null
																? current
																: { ...current, over: { half, path: session.path } },
														);
													},
													marker:
														sameProject && sessionDrag.over?.path === session.path
															? sessionDrag.over.half
															: null,
													start: () => {
														sessionDropCommitted.current = false;
														setSessionDrag({ cwd: group.cwd, over: null, path: session.path });
													},
												});
											})}
											{ordered.length > COLLAPSED_SESSION_LIMIT ? (
												<button
													className="px-3 py-1.5 text-[13px] text-[#7d8780] hover:text-[#4b5563]"
													onClick={() =>
														setExpanded((current) => ({ ...current, [`more:${group.cwd}`]: !showAll }))
													}
													type="button"
												>
													{showAll ? "收起" : "展开显示"}
												</button>
											) : null}
										</div>
									) : null}
								</div>
							);
						})}
						{sessions.length === 0 ? <div className="px-3 py-2 text-[13px] text-[#8a938c]">暂无会话</div> : null}
					</>
				)}
			</div>

			{/* Codex keeps the session's vitals in the corner rather than in the header: rounds,
			    steps and live output speed on one line, traffic and cache reuse on the next. The
			    hairline sets the readout apart from the session list above it. Nothing else shares
			    the corner any more — settings and about live in the 更多 menu. A session that has
			    not started yet has no vitals worth a row, so the block stays away until then. */}
			{blankSession ? null : (
				<div className="mt-1 border-t border-black/[0.06] px-2 pb-2 pt-2">
					<button
						className="flex w-full flex-col gap-0.5 rounded-lg px-2 py-1 text-left transition-colors hover:bg-black/[0.04]"
						onClick={() => setSessionPanel("stats")}
						title="会话统计"
						type="button"
					>
						<span className="flex items-center gap-1.5 text-[11px] leading-4 text-[#98a2b3]">
							<Gauge className="shrink-0 text-[#b6bcc4]" size={12} />
							<span className="truncate">
								{sessionStats ? `${sessionStats.userMessages} 轮 ${sessionStats.toolCalls} 步` : "—"}
								{tokensPerSecond ? ` · ${Math.round(tokensPerSecond)} tok/s` : ""}
							</span>
						</span>
						<span className="flex items-center gap-1.5 text-[11px] leading-4 text-[#98a2b3]">
							<Database className="shrink-0 text-[#b6bcc4]" size={12} />
							<span className="truncate">
								{sessionStats ? `${formatTokens(sessionStats.tokens.total)} tok` : "—"}
								{hitRate === undefined ? "" : ` · 缓存命中 ${formatPercent(hitRate)}`}
							</span>
						</span>
					</button>
				</div>
			)}

			{shownSessionMenu ? (
				<Presence open={Boolean(sessionMenu)}>
					{({ phase }) => (
						<>
							<div
								className={popoverOverlayClass(phase)}
								onClick={() => setSessionMenu(null)}
								onContextMenu={(event) => {
									event.preventDefault();
									setSessionMenu(null);
								}}
								role="presentation"
							/>
							<div
								className={`${MENU_PANEL_CLASS} ${popoverPanelClass(phase)} fixed`}
								style={{ left: shownSessionMenu.left, top: shownSessionMenu.top }}
							>
								<button
									className={MENU_ITEM_CLASS}
									onClick={() => {
										toggleSessionPinned(shownSessionMenu.session.path);
										setSessionMenu(null);
									}}
									type="button"
								>
									<Pin
										className={`shrink-0 ${pinnedSessions.includes(shownSessionMenu.session.path) ? "fill-current" : ""}`}
										size={14}
									/>
									<span className={MENU_LABEL_CLASS}>
										{pinnedSessions.includes(shownSessionMenu.session.path) ? "取消置顶" : "置顶"}
									</span>
								</button>
								<button
									className={MENU_ITEM_CLASS}
									onClick={() => {
										setRenameTarget({
											path: shownSessionMenu.session.path,
											title: sessionTitle(shownSessionMenu.session),
											value: sessionTitle(shownSessionMenu.session),
										});
										setSessionMenu(null);
									}}
									type="button"
								>
									<Pencil className="shrink-0" size={14} />
									<span className={MENU_LABEL_CLASS}>重命名</span>
									<span className={MENU_SHORTCUT_CLASS}>Alt+Ctrl+R</span>
								</button>
								<button
									className={MENU_ITEM_CLASS}
									onClick={() => {
										void forkSession(shownSessionMenu.session);
										setSessionMenu(null);
									}}
									type="button"
								>
									<GitFork className="shrink-0" size={14} />
									<span className={MENU_LABEL_CLASS}>分叉（复制为新会话）</span>
								</button>
								<div className={MENU_SEPARATOR_CLASS} />
								<button
									className={MENU_ITEM_DANGER_CLASS}
									onClick={() => {
										setArchiveTarget({
											path: shownSessionMenu.session.path,
											title: sessionTitle(shownSessionMenu.session),
										});
										setSessionMenu(null);
									}}
									type="button"
								>
									<Archive className="shrink-0" size={14} />
									<span className={MENU_LABEL_CLASS}>归档（删除会话）</span>
								</button>
							</div>
						</>
					)}
				</Presence>
			) : null}

			<Modal
				className="w-full max-w-[420px] rounded-2xl border border-black/[0.06] bg-white p-5 shadow-[0_24px_70px_rgba(15,23,42,0.2)]"
				onClose={() => setRenameTarget(null)}
				open={Boolean(renameTarget)}
			>
				{renameTarget ? (
					<>
						<div className="text-[17px] font-semibold tracking-[-0.01em] text-[#111827]">重命名会话</div>
						<input
							autoFocus
							className="mt-4 h-10 w-full rounded-xl border border-black/[0.1] px-3 text-[14px] text-[#1f2937] outline-none focus:border-[#9fb2a5]"
							onChange={(event) => setRenameTarget({ ...renameTarget, value: event.target.value })}
							onKeyDown={(event) => {
								if (event.key === "Enter") void renameSession();
							}}
							placeholder="会话名称"
							value={renameTarget.value}
						/>
						<div className="mt-5 flex justify-end gap-2">
							<button className={buttonClass()} onClick={() => setRenameTarget(null)} type="button">
								取消
							</button>
							<button className={buttonClass("primary")} onClick={() => void renameSession()} type="button">
								保存
							</button>
						</div>
					</>
				) : null}
			</Modal>

			<Modal
				className="w-full max-w-[420px] rounded-2xl border border-black/[0.06] bg-white p-5 shadow-[0_24px_70px_rgba(15,23,42,0.2)]"
				onClose={() => setArchiveTarget(null)}
				open={Boolean(archiveTarget)}
			>
				{archiveTarget ? (
					<>
						<div className="text-[17px] font-semibold tracking-[-0.01em] text-[#111827]">归档会话</div>
						<div className="mt-2 text-[13px] leading-6 text-[#667085]">
							将把「{archiveTarget.title}」移出列表并移到 agent 的 archive 目录，需要时可以手动找回。
						</div>
						<div className="mt-5 flex justify-end gap-2">
							<button className={buttonClass()} onClick={() => setArchiveTarget(null)} type="button">
								取消
							</button>
							<button className={buttonClass("danger")} onClick={() => void archiveSession()} type="button">
								归档
							</button>
						</div>
					</>
				) : null}
			</Modal>

			<Modal
				className="w-full max-w-[520px] rounded-2xl border border-black/[0.06] bg-white p-5 shadow-[0_24px_70px_rgba(15,23,42,0.2)]"
				onClose={() => setProjectDialogOpen(false)}
				open={projectDialogOpen}
			>
				<>
					<div className="flex items-start justify-between gap-4">
						<div className="text-[17px] font-semibold tracking-[-0.01em] text-[#111827]">创建项目</div>
						<button
							className="flex h-7 w-7 items-center justify-center rounded-md text-[#8b95a1] hover:bg-black/[0.05]"
							onClick={() => setProjectDialogOpen(false)}
							title="关闭"
							type="button"
						>
							<X size={15} />
						</button>
					</div>
					<div className="mt-4 flex h-10 items-center gap-2 rounded-xl border border-black/[0.08] px-3">
						<Folder className="shrink-0 text-[#8b95a1]" size={15} />
						<input
							autoFocus
							className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-[#98a2b3]"
							onChange={(event) => setProjectDraft((current) => ({ ...current, name: event.target.value }))}
							placeholder="项目名称"
							value={projectDraft.name}
						/>
					</div>
					<div className="mt-4 text-[13px] font-medium text-[#374151]">源文件夹</div>
					<button
						className="mt-2 flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-black/[0.14] py-9 text-[13px] text-[#667085] transition-colors hover:bg-black/[0.02]"
						onClick={() => void chooseProjectFolder()}
						type="button"
					>
						<FolderPlus className="text-[#8b95a1]" size={18} />
						<span className="max-w-[420px] truncate">
							{projectDraft.cwd || "添加 π7 可读取和编辑的文件夹"}
						</span>
					</button>
					<div className="mt-5 flex justify-end gap-2">
						<button
							className={buttonClass()}
							onClick={() => setProjectDialogOpen(false)}
							type="button"
						>
							取消
						</button>
						<button
							className={buttonClass("primary")}
							disabled={!projectDraft.cwd}
							onClick={() => void createProject()}
							type="button"
						>
							创建项目
						</button>
					</div>
				</>
			</Modal>

			{error ? (
				<div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-[#b42318] px-4 py-2 text-[13px] text-white shadow-lg">
					<button onClick={() => setError(undefined)} type="button">
						{error}
					</button>
				</div>
			) : null}

			{shownProjectMenu && activeProjectMenu ? (
				<Presence open={Boolean(projectMenu)}>
					{({ phase }) => (
						<>
							<div
								className={popoverOverlayClass(phase)}
								onClick={() => setProjectMenu(null)}
								role="presentation"
							/>
							<div
								className={`${MENU_PANEL_CLASS} ${popoverPanelClass(phase)} fixed !w-[280px]`}
								onMouseDown={(event) => event.stopPropagation()}
								style={{ left: shownProjectMenu.left, top: shownProjectMenu.top }}
							>
								<div className="flex items-center gap-2 rounded-xl px-3 py-2.5">
									<Folder className="shrink-0 text-[#6f7a72]" size={16} />
									<span className="min-w-0 flex-1 truncate text-[14px] font-medium text-[#1f2937]">
										{activeProjectMenu.name}
									</span>
								</div>
								<div className="px-3 pb-1 text-[12px] text-[#8b95a1]">
									{activeProjectMenu.sessions.length} 个任务
								</div>
								<div className="mx-2 my-1 break-all px-1 font-mono text-[11px] text-[#98a2b3]">
									{activeProjectMenu.cwd || "无项目路径"}
								</div>
								<div className={MENU_SEPARATOR_CLASS} />
								<button
									className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] text-[#374151] hover:bg-black/[0.04]"
									onClick={() => {
										toggleProjectPinned(activeProjectMenu.cwd);
										setProjectMenu(null);
									}}
									type="button"
								>
									<Pin
										className={pinnedProjects.includes(activeProjectMenu.cwd) ? "fill-current" : ""}
										size={16}
									/>
									{pinnedProjects.includes(activeProjectMenu.cwd) ? "取消置顶" : "置顶项目"}
								</button>
								<button
									className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] text-[#374151] hover:bg-black/[0.04]"
									onClick={() => {
										setProjectMenu(null);
										setEditProject({ cwd: activeProjectMenu.cwd, value: activeProjectMenu.name });
									}}
									type="button"
								>
									<Settings size={16} />
									编辑项目
								</button>
							</div>
						</>
					)}
				</Presence>
			) : null}
			<Modal
				className="w-full max-w-[420px] rounded-2xl border border-black/[0.06] bg-white p-5 shadow-[0_24px_70px_rgba(15,23,42,0.2)]"
				onClose={() => setEditProject(null)}
				open={Boolean(editProject)}
			>
				{editProject ? (
					<>
						<div className="text-[18px] font-semibold tracking-[-0.01em] text-[#111827]">编辑项目</div>
						<div className="mt-1 break-all font-mono text-[11px] text-[#8b95a1]">{editProject.cwd}</div>
						<input
							autoFocus
							className="mt-4 h-10 w-full rounded-xl border border-black/[0.1] px-3 text-[14px] text-[#1f2937] outline-none focus:border-[#9fb2a5]"
							onChange={(event) => setEditProject({ ...editProject, value: event.target.value })}
							onKeyDown={(event) => {
								if (event.key === "Enter") saveProjectName();
							}}
							placeholder="项目名称"
							value={editProject.value}
						/>
						<div className="mt-4 flex justify-end gap-2">
							<button className={buttonClass()} onClick={() => setEditProject(null)} type="button">
								取消
							</button>
							<button className={buttonClass("primary")} onClick={saveProjectName} type="button">
								保存
							</button>
						</div>
					</>
				) : null}
			</Modal>
		</aside>
	);
}

function SidebarAction({
	icon,
	label,
	onClick,
}: {
	icon: ReactNode;
	label: string;
	onClick?: () => void;
}) {
	return (
		<button
			className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-1.5 text-left text-[14px] transition-colors hover:bg-black/[0.05] focus-visible:bg-black/[0.05]"
			onClick={onClick}
			type="button"
		>
			<span className="shrink-0 text-[#4b5563]">{icon}</span>
			<span className="truncate">{label}</span>
		</button>
	);
}
