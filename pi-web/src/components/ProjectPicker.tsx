import { Check, Folder, Loader2, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { projectGroups, useProjectCatalog } from "../state/projects";
import { usePiStore, useSessionCwd } from "../state/store";
import { useUiStore } from "../state/ui";
import { Presence, popoverOverlayClass, popoverPanelClass } from "./Presence";
import { t } from "../i18n";

/**
 * Project chip above the composer, the Codex pattern: it names the folder the chat runs in and
 * opens a searchable picker. A pi session's folder is fixed when its runtime opens, so picking
 * another project starts the chat there instead of retrofitting the current one.
 */
export function ProjectPicker() {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [highlight, setHighlight] = useState(0);
	const [failure, setFailure] = useState<string | undefined>(undefined);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const labels = useProjectCatalog((state) => state.labels);
	const order = useProjectCatalog((state) => state.order);
	const pinned = useProjectCatalog((state) => state.pinned);
	const projects = useProjectCatalog((state) => state.projects);
	const newSessionIn = usePiStore((state) => state.newSessionIn);
	const messages = usePiStore((state) => state.messages);
	const sessionCwd = useSessionCwd();
	// Every pi session has a folder, but a fresh one only has whatever folder its runtime already
	// carried. Until the user picks — or the session has a transcript — the chip stays unbound,
	// which is the Codex 选择项目 state instead of a project they never chose.
	const sessionProject = usePiStore((state) => state.sessionProject);
	const boundCwd = sessionProject ?? (messages.length > 0 ? sessionCwd : undefined);
	const sessions = usePiStore((state) => state.sessions);
	const status = usePiStore((state) => state.status);
	const setProjectDialogOpen = useUiStore((state) => state.setProjectDialogOpen);
	const groups = useMemo(
		() => projectGroups(sessions, labels, pinned, projects, order),
		[labels, order, pinned, projects, sessions],
	);
	const active = groups.find((group) => group.cwd === boundCwd);
	const normalized = query.trim().toLowerCase();
	const matches = normalized
		? groups.filter(
				(group) =>
					group.name.toLowerCase().includes(normalized) || group.cwd.toLowerCase().includes(normalized),
			)
		: groups;

	useEffect(() => {
		if (!open) return;
		setQuery("");
		setHighlight(0);
		const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpen(false);
		};
		window.addEventListener("keydown", closeOnEscape);
		return () => {
			window.clearTimeout(timer);
			window.removeEventListener("keydown", closeOnEscape);
		};
	}, [open]);

	const choose = async (cwd: string) => {
		setOpen(false);
		if (cwd === boundCwd) return;
		setFailure(undefined);
		try {
			await newSessionIn(cwd);
		} catch (error) {
			setFailure(error instanceof Error ? error.message : String(error));
		}
	};

	return (
		<div className="relative flex items-center gap-2">
			<button
				className={`flex h-7 max-w-[280px] items-center gap-1.5 rounded-lg px-2 text-[14px] transition-colors ${
					open ? "bg-black/[0.07]" : "hover:bg-black/[0.06]"
				} ${active ? "text-[#374151]" : "text-[#667085]"}`}
				onClick={() => setOpen((value) => !value)}
				title={active ? t("当前项目：{name}", { "name": active.name }) : t("选择项目来运行聊天")}
				type="button"
			>
				{status === "starting" ? (
					<Loader2 className="shrink-0 animate-spin text-[#98a2b3]" size={15} />
				) : (
					<Folder className="shrink-0 text-[#6f7a72]" size={15} />
				)}
				<span className="min-w-0 truncate">{active?.name ?? t("选择项目")}</span>
			</button>
			{failure ? <span className="truncate text-[12px] text-[#b42318]">{failure}</span> : null}
			<Presence open={open}>
				{({ phase }) => (
					<>
						<div className={popoverOverlayClass(phase)} onClick={() => setOpen(false)} role="presentation" />
						<div
							className={`${popoverPanelClass(phase)} absolute bottom-[calc(100%+8px)] left-0 z-50 w-[300px] overflow-hidden rounded-2xl border border-black/[0.06] bg-white/95 shadow-[0_18px_50px_rgba(15,23,42,0.18)] backdrop-blur-xl`}
						>
							<div className="flex items-center gap-2 px-3 py-2.5">
								<Search className="shrink-0 text-[#98a2b3]" size={14} />
								<input
									className="min-w-0 flex-1 bg-transparent text-[13px] text-[#1f2937] outline-none placeholder:text-[#98a2b3]"
									onChange={(event) => {
										setQuery(event.target.value);
										setHighlight(0);
									}}
									onKeyDown={(event) => {
										if (event.key === "ArrowDown") {
											event.preventDefault();
											setHighlight((value) => (matches.length === 0 ? 0 : (value + 1) % matches.length));
										}
										if (event.key === "ArrowUp") {
											event.preventDefault();
											setHighlight((value) =>
												matches.length === 0 ? 0 : (value - 1 + matches.length) % matches.length,
											);
										}
										if (event.key === "Enter" && matches[highlight]) {
											event.preventDefault();
											void choose(matches[highlight].cwd);
										}
									}}
									placeholder={t("搜索项目")}
									ref={inputRef}
									value={query}
								/>
							</div>
							<div className="scrollbar-subtle max-h-[220px] overflow-y-auto px-1.5 pb-1.5">
								{matches.length === 0 ? (
									<div className="px-2.5 py-3 text-[13px] text-[#8a938c]">{t("没有匹配的项目")}</div>
								) : (
									matches.map((group, index) => (
										<button
											className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[14px] text-[#1f2937] ${
												index === highlight ? "bg-black/[0.06]" : "hover:bg-black/[0.05]"
											}`}
											key={group.cwd || "no-project"}
											onClick={() => void choose(group.cwd)}
											onMouseEnter={() => setHighlight(index)}
											title={group.cwd || t("无项目路径")}
											type="button"
										>
											<Folder className="shrink-0 text-[#6f7a72]" size={15} />
											<span className="min-w-0 flex-1 truncate">{group.name}</span>
											{group.cwd === boundCwd ? (
												<Check className="shrink-0 text-[#2f7df6]" size={15} />
											) : null}
										</button>
									))
								)}
							</div>
							<div className="border-t border-black/[0.06] p-1.5">
								<button
									className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[14px] text-[#374151] hover:bg-black/[0.05]"
									onClick={() => {
										setOpen(false);
										setProjectDialogOpen(true);
									}}
									type="button"
								>
									<Plus className="shrink-0 text-[#6f7a72]" size={15} />
									{t("新建项目")}</button>
							</div>
						</div>
					</>
				)}
			</Presence>
		</div>
	);
}
