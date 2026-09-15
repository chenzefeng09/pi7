import { Check, Copy, Download, FileText, MoreHorizontal, PanelRight, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import { useBlankSession, usePiStore } from "../state/store";
import { useUiStore } from "../state/ui";
import { BashDialog } from "./BashDialog";
import { MENU_PANEL_CLASS } from "./Menu";
import { popoverOverlayClass, popoverPanelClass, Presence } from "./Presence";

export function TopBar() {
	const [menuOpen, setMenuOpen] = useState(false);
	const [editingTitle, setEditingTitle] = useState(false);
	const [titleDraft, setTitleDraft] = useState("");
	const [shareOpen, setShareOpen] = useState(false);
	/**
	 * Export result, shown next to the button: the message, plus the file it wrote when there is
	 * one — an export that only says 已导出 leaves the user hunting the filesystem for it.
	 */
	const [shareFeedback, setShareFeedback] = useState<{ path?: string; text: string } | null>(null);
	const [bashOpen, setBashOpen] = useState(false);
	const setSessionPanel = useUiStore((state) => state.setSessionPanel);
	const setFilePanelOpen = useUiStore((state) => state.setFilePanelOpen);
	const filePanelOpen = useUiStore((state) => state.filePanelOpen);
	const setSettingsOpen = useUiStore((state) => state.setSettingsOpen);
	const exportHtml = usePiStore((state) => state.exportHtml);
	const messages = usePiStore((state) => state.messages);
	const sessionId = usePiStore((state) => state.sessionId);
	const sessionName = usePiStore((state) => state.sessionName);
	const setSessionName = usePiStore((state) => state.setSessionName);
	const sessionLoading = usePiStore((state) => state.sessionLoading);
	const sessions = usePiStore((state) => state.sessions);
	const current = sessions.find((session) => session.id === sessionId);
	// The project picker and this header are the two halves of the same state: one is only for the
	// untouched new chat, the other only once that chat has something to show.
	const blank = useBlankSession();
	const shortSessionId = (current?.id ?? sessionId)?.slice(0, 8);
	// A brand-new session has no name and no listed first message yet, so the transcript is the
	// only immediate source of a title — the session id is an implementation detail, never a name.
	const firstUserText = useMemo(() => {
		for (const message of messages) {
			if (message.role !== "user") continue;
			const text = message.blocks
				.filter((block) => block.type === "text")
				.map((block) => (block.type === "text" ? block.text : ""))
				.join(" ")
				.trim();
			if (text) return text;
		}
		return undefined;
	}, [messages]);
	const rawTitle = sessionName ?? current?.firstMessage ?? firstUserText ?? "新对话";
	// pi records a leading file path as the first message for a drag-and-drop turn; it reads as
	// a filename, not as a conversation title.
	const title = /^[A-Za-z]:[\\/]/.test(rawTitle) || rawTitle.startsWith("/") ? "新对话" : rawTitle;
	// A brand-new chat has nothing to name, share, or inspect yet. Codex shows no session header
	// at all in that state, so the row only appears once the session has a name or a transcript.
	if (blank) return null;

	const saveTitle = async () => {
		const value = titleDraft.trim();
		setEditingTitle(false);
		if (!value || value === title) return;
		await setSessionName(value);
	};

	const flashFeedback = (text: string, options: { path?: string; sticky?: boolean } = {}) => {
		setShareFeedback({ path: options.path, text });
		// A message carrying where the file went stays long enough to read and click.
		window.setTimeout(() => setShareFeedback(null), options.sticky ? 15000 : 2000);
	};

	const copyTranscript = async () => {
		const lines: string[] = [];
		for (const message of messages) {
			const text = message.blocks
				.filter((block) => block.type === "text")
				.map((block) => (block.type === "text" ? block.text : ""))
				.join("\n");
			if (!text.trim()) continue;
			lines.push(message.role === "user" ? `## 用户\n\n${text}` : `## 助手\n\n${text}`);
		}
		try {
			await navigator.clipboard.writeText(lines.join("\n\n"));
			flashFeedback("已复制");
		} catch {
			flashFeedback("复制失败");
		}
		setShareOpen(false);
	};

	/**
	 * Export the session to HTML.
	 *
	 * The path is chosen in a save dialog first: pi writes exactly the path it is handed and never
	 * asks, so without this the file lands in whatever directory the pi runtime happens to run in.
	 * The exported path is then reported, because the dialog is modal and the only other evidence
	 * of where the file went would be the user's memory of it.
	 */
	const exportSession = async () => {
		setShareOpen(false);
		try {
			// A renderer can outlive a main process that predates the picker (the export bridge
			// ships with the app, not with the page), so fall back to pi's own default path.
			const picker = window.pi.pickSessionExportPath;
			let target: string | undefined;
			if (typeof picker === "function") {
				const picked = (await picker(title)) as { canceled?: boolean; path?: string } | undefined;
				if (picked?.canceled || !picked?.path) {
					flashFeedback("导出取消");
					return;
				}
				target = picked.path;
			}
			const written = await exportHtml(target);
			if (!written) {
				flashFeedback("导出取消");
				return;
			}
			flashFeedback(`已导出到 ${written}`, { path: written, sticky: true });
		} catch (error) {
			flashFeedback(`导出失败：${error instanceof Error ? error.message : String(error)}`, { sticky: true });
		}
	};

	return (
		<>
			<div className="flex h-[48px] shrink-0 items-center justify-between border-b border-black/[0.06] bg-white px-5">
				<div className="flex min-w-0 items-center gap-2.5">
					<div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-black/[0.08] bg-white text-[#4b5563]">
						<FileText size={13} />
					</div>
					{editingTitle ? (
						<input
							autoFocus
							className="h-7 w-[280px] rounded-md border border-black/[0.12] px-2 text-[14px] font-semibold text-[#111827] outline-none focus:border-[#9fb2a5]"
							onBlur={() => void saveTitle()}
							onChange={(event) => setTitleDraft(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter") void saveTitle();
								if (event.key === "Escape") setEditingTitle(false);
							}}
							value={titleDraft}
						/>
					) : (
						<button
							className="max-w-[420px] truncate rounded-md px-1 py-0.5 text-left text-[14px] font-semibold text-[#111827] hover:bg-black/[0.05]"
							onClick={() => {
								setTitleDraft(title);
								setEditingTitle(true);
							}}
							title={shortSessionId ? `${title} · 会话 ${shortSessionId}（点击重命名）` : `${title}（点击重命名）`}
							type="button"
						>
							{title}
						</button>
					)}
					<div className="relative">
						<button
							className="flex h-7 w-7 items-center justify-center rounded-md text-[#8b95a1] hover:bg-black/[0.05] hover:text-[#4b5563]"
							onClick={() => setMenuOpen((value) => !value)}
							title="更多"
							type="button"
						>
							<MoreHorizontal size={17} />
						</button>
						<Presence open={menuOpen}>
							{({ phase }) => (
								<>
									<div
										className={popoverOverlayClass(phase)}
										onClick={() => setMenuOpen(false)}
										role="presentation"
									/>
									<div className={`${MENU_PANEL_CLASS} ${popoverPanelClass(phase)} left-0 top-9 w-52`}>
									{(
										[
											["分叉会话", "fork"],
											["会话树", "tree"],
											["会话统计", "stats"],
											["原始记录", "entries"],
										] as const
									).map(([label, mode]) => (
										<button
											className="block w-full rounded-xl px-3 py-2.5 text-left text-[14px] text-[#374151] hover:bg-black/[0.04]"
											key={mode}
											onClick={() => {
												setMenuOpen(false);
												setSessionPanel(mode);
											}}
											type="button"
										>
											{label}
										</button>
									))}
									<div className="my-1 border-t border-black/[0.06]" />
									<button
										className="block w-full rounded-xl px-3 py-2.5 text-left text-[14px] text-[#374151] hover:bg-black/[0.04]"
										onClick={() => {
											setMenuOpen(false);
											setBashOpen(true);
										}}
										type="button"
									>
										运行 Bash
									</button>
									</div>
								</>
							)}
						</Presence>
					</div>
				</div>
				<div className="flex shrink-0 items-center gap-1.5">
					{shareFeedback ? (
						<span className="mr-1 flex max-w-[420px] items-center gap-1 text-[12px] text-[#16a34a]">
							<Check className="shrink-0" size={13} />
							<span className="truncate" title={shareFeedback.text}>
								{shareFeedback.text}
							</span>
							{shareFeedback.path ? (
								<button
									className="shrink-0 rounded px-1 text-[12px] text-[#2f7df6] hover:bg-black/[0.05] hover:underline"
									onClick={() => void window.pi.revealPath(shareFeedback.path ?? "")}
									type="button"
								>
									打开文件夹
								</button>
							) : null}
						</span>
					) : null}
					<div className="relative">
						<button
							className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] text-[#4b5563] hover:bg-black/[0.05]"
							onClick={() => setShareOpen((value) => !value)}
							type="button"
						>
							<Download size={15} />
							导出
						</button>
						<Presence open={shareOpen}>
							{({ phase }) => (
								<>
									<div
										className={popoverOverlayClass(phase)}
										onClick={() => setShareOpen(false)}
										role="presentation"
									/>
									<div className={`${MENU_PANEL_CLASS} ${popoverPanelClass(phase)} right-0 top-10 w-56`}>
										<button
											className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] text-[#374151] hover:bg-black/[0.04]"
											onClick={() => void copyTranscript()}
											type="button"
										>
											<Copy size={16} />
											复制会话内容
										</button>
										<button
											className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] text-[#374151] hover:bg-black/[0.04]"
											onClick={() => void exportSession()}
											type="button"
										>
											<Download size={16} />
											导出会话 HTML…
										</button>
									</div>
								</>
							)}
						</Presence>
					</div>
					<button
						className="flex h-8 w-8 items-center justify-center rounded-lg text-[#6b7280] hover:bg-black/[0.05]"
						onClick={() => setSettingsOpen(true)}
						title="设置"
						type="button"
					>
						<SlidersHorizontal size={17} />
					</button>
					<button
						className={`flex h-8 w-8 items-center justify-center rounded-lg hover:bg-black/[0.05] ${
							filePanelOpen ? "bg-black/[0.07] text-[#1f2937]" : "text-[#6b7280]"
						}`}
						onClick={() => setFilePanelOpen(!filePanelOpen)}
						title="文件面板"
						type="button"
					>
						<PanelRight size={17} />
					</button>
				</div>
			</div>
			<BashDialog onClose={() => setBashOpen(false)} open={bashOpen} />
		</>
	);
}
