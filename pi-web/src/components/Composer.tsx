import {
	ArrowDown,
	ArrowUp,
	Compass,
	FileText,
	Loader2,
	Paperclip,
	Plus,
	Puzzle,
	Sparkles,
	Square,
	Target,
	TriangleAlert,
	X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePiStore, useBlankSession } from "../state/store";
import type { FileAttachment, ImageAttachment } from "../state/types";
import { useUiStore } from "../state/ui";
import { ContextMeter } from "./ContextMeter";
import { ModelSelector } from "./ModelSelector";
import { MENU_PANEL_CLASS } from "./Menu";
import { PermissionMenu } from "./PermissionMenu";
import { Presence } from "./Presence";
import { ProjectPicker } from "./ProjectPicker";
import { QueueDock } from "./QueueDock";
import { TodoPanel } from "./TodoPanel";
import { t } from "../i18n";

function readImage(file: File): Promise<ImageAttachment> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = () => reject(reader.error ?? new Error(t("无法读取 {name}", { "name": file.name })));
		reader.onload = () => {
			const result = typeof reader.result === "string" ? reader.result : "";
			const comma = result.indexOf(",");
			if (comma < 0) {
				reject(new Error(t("无法读取 {name}", { "name": file.name })));
				return;
			}
			resolve({
				data: result.slice(comma + 1),
				mimeType: file.type || "image/png",
				name: file.name,
			});
		};
		reader.readAsDataURL(file);
	});
}

export function Composer() {
	const [text, setText] = useState("");
	const [highlight, setHighlight] = useState(0);
	const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
	const [fileAttachments, setFileAttachments] = useState<FileAttachment[]>([]);
	const [cursorPos, setCursorPos] = useState(0);
	const [addMenuOpen, setAddMenuOpen] = useState(false);
	const [goalArmed, setGoalArmed] = useState(false);
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const addMenuRef = useRef<HTMLDivElement | null>(null);
	const commands = usePiStore((state) => state.commands);
	const composerText = usePiStore((state) => state.composerText);
	const recallId = usePiStore((state) => state.recallId);
	const files = usePiStore((state) => state.files);
	const filesRoot = usePiStore((state) => state.filesRoot);
	const model = usePiStore((state) => state.model);
	const models = usePiStore((state) => state.models);
	const modelsLoaded = usePiStore((state) => state.modelsLoaded);
	const queue = usePiStore((state) => state.queue);
	const sessionProject = usePiStore((state) => state.sessionProject);
	const status = usePiStore((state) => state.status);
	const steerAllQueued = usePiStore((state) => state.steerAllQueued);
	const send = usePiStore((state) => state.send);
	const abort = usePiStore((state) => state.abort);
	const goal = useUiStore((state) => state.goal);
	const atTranscriptEnd = useUiStore((state) => state.atTranscriptEnd);
	const planMode = useUiStore((state) => state.planMode);
	const setGoal = useUiStore((state) => state.setGoal);
	const setPlanMode = useUiStore((state) => state.setPlanMode);
	const busy = status === "streaming";
	const starting = status === "starting";
	const blank = useBlankSession();
	const workspaceSelected = !blank || Boolean(sessionProject);
	const commandQuery = text.startsWith("/") && !text.includes("\n") ? text.slice(1) : undefined;
	const beforeCursor = text.slice(0, cursorPos);
	const fileMention = beforeCursor.match(/(?:^|\s)@([^\s@]*)$/);
	const fileQuery = fileMention?.[1];
	const suggestions = useMemo(() => {
		if (commandQuery === undefined || commandQuery.includes(" ")) return [];
		const normalized = commandQuery.toLowerCase();
		return commands.filter((command) => command.name.toLowerCase().includes(normalized)).slice(0, 12);
	}, [commandQuery, commands]);
	const fileSuggestions = useMemo(() => {
		if (fileQuery === undefined) return [];
		const normalized = fileQuery.toLowerCase();
		return files
			.filter((file) => file.toLowerCase().includes(normalized))
			.sort((left, right) => left.length - right.length || left.localeCompare(right))
			.slice(0, 20);
	}, [fileQuery, files]);
	const showCommandSuggestions = suggestions.length > 0 && fileQuery === undefined;
	const showFileSuggestions = fileSuggestions.length > 0;
	const queuedCount = queue.steering.length + queue.followUp.length;
	// Nothing to send with before a model exists; the setup banner says how to fix it.
	const noModel = modelsLoaded && models.length === 0 && !model;
	const canSend = !noModel && workspaceSelected && (Boolean(text.trim()) || attachments.length > 0 || fileAttachments.length > 0);

	useEffect(() => {
		// `recallId` is in the dependency list on purpose: staging the same text twice (recalling the
		// same queued message again) is not a change to `composerText`, and the second recall has to
		// land in the box just like the first. Recalled text is appended so it cannot erase what
		// the user typed in the meantime; everything else still takes over the box.
		if (typeof composerText !== "string") return;
		if (usePiStore.getState().composerAppend && composerText) {
			setText((previous) => (previous.trim() ? `${previous}\n\n${composerText}` : composerText));
			return;
		}
		setText(composerText);
	}, [composerText, recallId]);

	useEffect(() => {
		setHighlight(0);
	}, [commandQuery, fileQuery]);

	useEffect(() => {
		if (!addMenuOpen) return;
		const closeOnPointerDown = (event: MouseEvent) => {
			if (!addMenuRef.current?.contains(event.target as Node)) setAddMenuOpen(false);
		};
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") setAddMenuOpen(false);
		};
		document.addEventListener("mousedown", closeOnPointerDown);
		document.addEventListener("keydown", closeOnEscape);
		return () => {
			document.removeEventListener("mousedown", closeOnPointerDown);
			document.removeEventListener("keydown", closeOnEscape);
		};
	}, [addMenuOpen]);

	const selectFile = (path: string) => {
		const match = beforeCursor.match(/(?:^|\s)@([^\s@]*)$/);
		if (!match) return;
		const leading = match[0].startsWith("@") ? 0 : 1;
		const start = cursorPos - match[0].length + leading;
		const next = `${text.slice(0, start)}@${path} ${text.slice(cursorPos)}`;
		setText(next);
		setCursorPos(start + path.length + 2);
		setFileAttachments((current) =>
			current.some((file) => file.path === path && file.root === filesRoot)
				? current
				: [...current, { name: path.split("/").at(-1) ?? path, path, root: filesRoot }],
		);
		requestAnimationFrame(() => {
			const textarea = textareaRef.current;
			if (!textarea) return;
			textarea.focus();
			const position = start + path.length + 2;
			textarea.setSelectionRange(position, position);
		});
	};

	const buildPrompt = async (value: string): Promise<{ images: ImageAttachment[]; text: string }> => {
		let prefix = "";
		const images = [...attachments];
		for (const file of fileAttachments) {
			try {
				// Prefer the root captured when the file was picked: the live filesRoot follows
				// session switches, the attachment must not.
				const root = file.root ?? filesRoot;
				const resolvedPath = root ? `${root.replace(/[\\/]+$/, "")}/${file.path}` : file.path;
				const result = (await window.pi.readFile(resolvedPath)) as
					| { data: string; mimeType: string; path: string; type: "image" }
					| { path: string; text: string; type: "text" };
				if (result.type === "image") {
					images.push({ data: result.data, mimeType: result.mimeType, name: file.name });
					prefix += `<file name="${result.path}"></file>\n`;
				} else {
					prefix += `<file name="${result.path}">\n${result.text}\n</file>\n`;
				}
			} catch (error) {
				prefix += `<file name="${file.path}">Error: ${error instanceof Error ? error.message : String(error)}</file>\n`;
			}
		}
		let promptText = value;
		for (const file of fileAttachments) promptText = promptText.split(`@${file.path}`).join("");
		return { images, text: `${prefix}${promptText}`.trim() };
	};

	const submit = async (streamingBehavior?: "followUp" | "steer") => {
		if (noModel) {
			// Enter bypasses the disabled button; resurface the guide instead of failing silently.
			useUiStore.getState().setModelSetupDismissed(false);
			return;
		}
		if (!workspaceSelected) {
			usePiStore.setState({ error: t("请先选择工作区，再开始会话。") });
			return;
		}
		const payload = await buildPrompt(text);
		// While goal mode is armed, the composer content is the goal itself.
		if (goalArmed) {
			const objective = text.trim();
			if (!objective) return;
			setText("");
			setAttachments([]);
			setFileAttachments([]);
			setGoal(objective);
			setGoalArmed(false);
			await send(`/goal ${objective}`);
			return;
		}
		const recallBefore = usePiStore.getState().recallId;
		try {
			// Ctrl/Cmd+Enter interjects: everything still queued goes first, in FIFO order, then this.
			if (streamingBehavior === "steer" && busy) await steerAllQueued();
			await send(payload.text, busy ? (streamingBehavior ?? "followUp") : undefined, payload.images);
		} catch {
			// `send` reported why it failed; the composer keeps the text so it can be retried.
			return;
		}
		// A queue requeue that failed mid-way stages the unsent text back into the composer via
		// recallId; clearing the box here would drop exactly the text that recovery restored.
		if (usePiStore.getState().recallId !== recallBefore) return;
		setText("");
		setAttachments([]);
		setFileAttachments([]);
	};

	const focusTextarea = () => {
		requestAnimationFrame(() => textareaRef.current?.focus());
	};

	// Goal and plan mode are driven by pi extensions (pi-goal-x, pi-plan-extension).
	// They are mutually exclusive: pi-plan enforces read-only while pi-goal drives work.
	const exitGoalMode = async () => {
		const hadGoal = Boolean(goal);
		setGoal(undefined);
		setGoalArmed(false);
		if (hadGoal) await send("/goal-unfocus");
	};

	const armGoalMode = async () => {
		if (!workspaceSelected) {
			usePiStore.setState({ error: t("请先选择工作区，再开始会话。") });
			return;
		}
		setAddMenuOpen(false);
		if (planMode) {
			setPlanMode(false);
			await send("/plan");
		}
		setGoalArmed(true);
		focusTextarea();
	};

	const enterPlanMode = async () => {
		if (!workspaceSelected) {
			usePiStore.setState({ error: t("请先选择工作区，再开始会话。") });
			return;
		}
		setAddMenuOpen(false);
		if (goal || goalArmed) await exitGoalMode();
		setPlanMode(true);
		await send("/plan");
	};

	const exitPlanMode = async () => {
		setPlanMode(false);
		await send("/plan");
	};

	const resizeTextarea = () => {
		const element = textareaRef.current;
		if (!element) return;
		element.style.height = "auto";
		element.style.height = `${Math.min(element.scrollHeight, 240)}px`;
	};

	useEffect(() => {
		resizeTextarea();
	}, [text]);

	return (
		<div className="relative bg-white px-6 pb-3 pt-2">
			{!atTranscriptEnd ? (
				<button
					className="absolute -top-5 left-1/2 z-10 grid h-9 w-9 -translate-x-1/2 place-items-center rounded-full border border-black/[0.08] bg-white text-[#4b5563] shadow-[0_4px_14px_rgba(15,23,42,0.12)] transition-colors hover:bg-black/[0.03]"
					onClick={() => useUiStore.getState().requestJumpToBottom()}
					title={t("滚动到底部")}
					type="button"
				>
					<ArrowDown size={16} />
				</button>
			) : null}
			<TodoPanel />
			<QueueDock />
			{showFileSuggestions ? (
				<div className="scrollbar-subtle mx-auto mb-2 max-h-64 w-full max-w-[1010px] overflow-y-auto rounded-2xl border border-black/[0.06] bg-white p-1.5 shadow-[0_18px_50px_rgba(15,23,42,0.16)]">
					{fileSuggestions.map((file, index) => (
						<button
							className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left ${
								index === highlight ? "bg-black/[0.05]" : ""
							}`}
							key={file}
							onMouseEnter={() => setHighlight(index)}
							onMouseDown={(event) => event.preventDefault()}
							onClick={() => selectFile(file)}
							type="button"
						>
							<FileText className="shrink-0 text-[#98a2b3]" size={14} />
							<span className="truncate font-mono text-xs text-[#344054]">{file}</span>
						</button>
					))}
				</div>
			) : null}
			{showCommandSuggestions ? (
				<div className="scrollbar-subtle mx-auto mb-2 max-h-64 w-full max-w-[1010px] overflow-y-auto rounded-2xl border border-black/[0.06] bg-white p-1.5 shadow-[0_18px_50px_rgba(15,23,42,0.16)]">
					{suggestions.map((command, index) => (
						<button
							className={`flex w-full items-center justify-between gap-4 rounded-xl px-3 py-2 text-left ${
								index === highlight ? "bg-black/[0.05]" : ""
							}`}
							key={`${command.source}:${command.name}`}
							onMouseEnter={() => setHighlight(index)}
							onMouseDown={(event) => event.preventDefault()}
							onClick={() => setText(`/${command.name} `)}
							type="button"
						>
							<span className="min-w-0">
								<span className="font-mono text-sm text-[#111827]">/{command.name}</span>
								{command.description ? (
									<span className="ml-2 text-xs text-[#667085]">{command.description}</span>
								) : null}
							</span>
							<span className="shrink-0 text-xs uppercase tracking-wide text-[#98a2b3]">{command.source}</span>
						</button>
					))}
				</div>
			) : null}

			{/* Codex tucks the project chip behind the input card's top edge, and only while the chat is
			    still new: an existing conversation already belongs to a fixed project, so the bar goes
			    away and the card keeps its own rounded corners. */}
			{blank ? (
				<div className="mx-auto w-full max-w-[1010px] px-3.5">
					<div className="flex h-9 items-center rounded-t-xl bg-[#f4f4f5] px-2.5">
						<ProjectPicker />
					</div>
				</div>
			) : null}

			<div className="relative mx-auto w-full max-w-[1010px]">
				<Presence open={addMenuOpen}>
					<div
						className={`${MENU_PANEL_CLASS} bottom-[calc(100%+10px)] left-0 max-h-[380px] w-[340px] overflow-y-auto`}
						ref={addMenuRef}
					>
						<div className="px-2.5 pb-0.5 pt-1 text-[11px] font-medium text-[#8b95a1]">{t("添加")}</div>
						<button
							className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1 text-left hover:bg-black/[0.05]"
							onClick={() => {
								setAddMenuOpen(false);
								fileInputRef.current?.click();
							}}
							type="button"
						>
							<Paperclip className="shrink-0 text-[#667085]" size={14} />
							<span className="text-[13px] font-medium text-[#1f2937]">{t("文件和文件夹")}</span>
						</button>
						<button
							className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1 text-left hover:bg-black/[0.05]"
							onClick={() => void armGoalMode()}
							type="button"
						>
							<Target className="shrink-0 text-[#667085]" size={14} />
							<span className="shrink-0 text-[13px] font-medium text-[#1f2937]">{t("目标")}</span>
							<span className="min-w-0 flex-1 truncate text-[11px] text-[#98a2b3]">{t("用会话框内容作为目标")}</span>
						</button>
						<button
							className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1 text-left hover:bg-black/[0.05]"
							onClick={() => void enterPlanMode()}
							type="button"
						>
							<Compass className="shrink-0 text-[#667085]" size={14} />
							<span className="shrink-0 text-[13px] font-medium text-[#1f2937]">{t("计划模式")}</span>
							<span className="min-w-0 flex-1 truncate text-[11px] text-[#98a2b3]">
								{planMode ? t("已开启（/plan）") : t("只读探索，先出计划")}
							</span>
						</button>
						{commands.length > 0 ? (
							<>
								<div className="px-2.5 pb-0.5 pt-2 text-[11px] font-medium text-[#8b95a1]">{t("插件")}</div>
								{commands.slice(0, 12).map((command) => (
									<button
										className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1 text-left hover:bg-black/[0.05]"
										key={`${command.source}:${command.name}`}
										onClick={() => {
											setText(`/${command.name} `);
											setAddMenuOpen(false);
											focusTextarea();
										}}
										type="button"
									>
										{command.source === "skill" ? (
											<Sparkles className="shrink-0 text-[#8b5cf6]" size={14} />
										) : command.source === "extension" ? (
											<Puzzle className="shrink-0 text-[#2f7df6]" size={14} />
										) : (
											<FileText className="shrink-0 text-[#f79009]" size={14} />
										)}
										<span className="shrink-0 text-[13px] font-medium text-[#1f2937]">{command.name}</span>
										<span className="min-w-0 flex-1 truncate text-[11px] text-[#98a2b3]">
											{command.description ?? command.source}
										</span>
									</button>
								))}
							</>
						) : null}
					</div>
				</Presence>

				<div
					className="rounded-[20px] border border-black/[0.08] bg-white shadow-[0_10px_28px_rgba(15,23,42,0.07)]"
					onPaste={(event) => {
						const imageFiles = Array.from(event.clipboardData?.items ?? [])
							.filter((item) => item.kind === "file" && item.type.startsWith("image/"))
							.map((item) => item.getAsFile())
							.filter((file): file is File => file !== null);
						if (imageFiles.length === 0) return;
						event.preventDefault();
						void Promise.all(imageFiles.map(readImage)).then((images) =>
							setAttachments((current) => [...current, ...images]),
						);
					}}
				>
					<input
						accept="image/*"
						className="hidden"
						multiple
						onChange={(event) => {
							const selected = Array.from(event.target.files ?? []);
							event.target.value = "";
							void Promise.all(selected.map(readImage)).then((images) =>
								setAttachments((current) => [...current, ...images]),
							);
						}}
						ref={fileInputRef}
						type="file"
					/>
					{attachments.length > 0 || fileAttachments.length > 0 ? (
						<div className="flex flex-wrap gap-2.5 px-3.5 pt-3.5">
							{attachments.map((attachment, index) => (
								<div className="group relative" key={`${attachment.name}-${index}`}>
									<img
										alt={attachment.name}
										className="h-20 w-20 rounded-xl border border-black/[0.08] object-cover"
										src={`data:${attachment.mimeType};base64,${attachment.data}`}
										title={attachment.name}
									/>
									<button
										className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-[#1f2937] text-white shadow hover:bg-black"
										onClick={() =>
											setAttachments((current) => current.filter((_item, itemIndex) => itemIndex !== index))
										}
										title={t("移除")}
										type="button"
									>
										<X size={11} />
									</button>
								</div>
							))}
							{fileAttachments.map((file, index) => (
								<div
									className="flex h-8 items-center gap-2 rounded-lg border border-black/[0.08] bg-white px-2 text-[12px]"
									key={`${file.path}-${index}`}
								>
									<FileText className="text-[#98a2b3]" size={13} />
									<span className="max-w-[220px] truncate font-mono">{file.path}</span>
									<button
										className="text-[#98a2b3] hover:text-[#344054]"
										onClick={() =>
											setFileAttachments((current) => current.filter((_item, itemIndex) => itemIndex !== index))
										}
										type="button"
									>
										<X size={12} />
									</button>
								</div>
							))}
						</div>
					) : null}
					<textarea
						className="max-h-[240px] min-h-[44px] w-full resize-none bg-transparent px-4 pb-1 pt-3 text-[14px] leading-[22px] text-[#111827] outline-none placeholder:text-[#98a2b3]"
						onChange={(event) => {
							setText(event.target.value);
							setCursorPos(event.target.selectionStart ?? event.target.value.length);
						}}
						onClick={(event) =>
							setCursorPos(event.currentTarget.selectionStart ?? event.currentTarget.value.length)
						}
						onKeyDown={(event) => {
							if (showFileSuggestions && event.key === "ArrowDown") {
								event.preventDefault();
								setHighlight((value) => (value + 1) % fileSuggestions.length);
								return;
							}
							if (showFileSuggestions && event.key === "ArrowUp") {
								event.preventDefault();
								setHighlight((value) => (value - 1 + fileSuggestions.length) % fileSuggestions.length);
								return;
							}
							if (showFileSuggestions && (event.key === "Tab" || event.key === "Enter")) {
								event.preventDefault();
								selectFile(fileSuggestions[highlight] ?? fileSuggestions[0]);
								return;
							}
							if (showCommandSuggestions && event.key === "ArrowDown") {
								event.preventDefault();
								setHighlight((value) => (value + 1) % suggestions.length);
								return;
							}
							if (showCommandSuggestions && event.key === "ArrowUp") {
								event.preventDefault();
								setHighlight((value) => (value - 1 + suggestions.length) % suggestions.length);
								return;
							}
							if (showCommandSuggestions && event.key === "Tab") {
								event.preventDefault();
								setText(`/${suggestions[highlight]?.name ?? suggestions[0].name} `);
								return;
							}
							if (event.key === "Enter" && !event.shiftKey) {
								event.preventDefault();
								if (showCommandSuggestions && !commandQuery?.includes(" ")) {
									setText(`/${suggestions[highlight]?.name ?? suggestions[0].name} `);
									return;
								}
								void submit(event.ctrlKey || event.metaKey ? "steer" : undefined);
							}
						}}
						onSelect={(event) =>
							setCursorPos(event.currentTarget.selectionStart ?? event.currentTarget.value.length)
						}
						placeholder={
							busy
								? queuedCount > 0
									? t("Ctrl+Enter 插话发送全部排队消息")
									: t("输入后续消息...")
								: goalArmed
									? t("描述你的目标，定义可衡量的成果，以获得最佳效果")
									: t("随心输入")
						}
						ref={textareaRef}
						rows={1}
						value={text}
					/>
					<div className="flex items-center gap-1.5 px-2 pb-2 pt-0.5">
						<button
							className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#4b5563] transition-colors ${
								addMenuOpen ? "bg-black/[0.08]" : "hover:bg-black/[0.05]"
							}`}
							onClick={() => setAddMenuOpen((value) => !value)}
							title={t("添加")}
							type="button"
						>
							<Plus size={18} />
						</button>
						<PermissionMenu />
						{goal || goalArmed || planMode ? <span className="mx-0.5 h-4 w-px shrink-0 bg-black/[0.12]" /> : null}
						{goal || goalArmed ? (
							<button
								className="group flex shrink-0 items-center rounded-full bg-black/[0.06] py-[3px] pl-2.5 pr-2.5 text-[12px] text-[#667085] transition-colors hover:bg-black/[0.1] group-hover:pl-[3px] hover:pl-[3px]"
								onClick={() => void exitGoalMode()}
								title={goal ? t("目标模式：{goal}", { "goal": goal }) : t("目标模式：发送的内容将作为目标")}
								type="button"
							>
								<span className="flex h-4 w-0 items-center justify-center overflow-hidden rounded-full bg-[#b9bec7] text-white opacity-0 transition-all duration-150 group-hover:w-4 group-hover:opacity-100">
									<X size={10} strokeWidth={3} />
								</span>
								<span className="transition-all duration-150 group-hover:pl-1.5">{t("目标")}</span>
							</button>
						) : null}
						{planMode ? (
							<button
								className="group flex shrink-0 items-center rounded-full bg-black/[0.06] py-[3px] pl-2.5 pr-2.5 text-[12px] text-[#667085] transition-colors hover:bg-black/[0.1] hover:pl-[3px]"
								onClick={() => void exitPlanMode()}
								title={t("计划模式（点击退出）")}
								type="button"
							>
								<span className="flex h-4 w-0 items-center justify-center overflow-hidden rounded-full bg-[#b9bec7] text-white opacity-0 transition-all duration-150 group-hover:w-4 group-hover:opacity-100">
									<X size={10} strokeWidth={3} />
								</span>
								<span className="transition-all duration-150 group-hover:pl-1.5">{t("计划模式")}</span>
							</button>
						) : null}
						<div className="min-w-0 flex-1" />
						<div className="flex shrink-0 items-center gap-1.5">
							<ModelSelector />
							<ContextMeter />
							{busy ? (
								<button
									className="flex h-8 w-8 items-center justify-center rounded-full bg-[#1f2937] text-white hover:bg-black"
									onClick={() => void abort()}
									title={t("停止")}
									type="button"
								>
									<Square size={12} />
								</button>
							) : starting ? (
								<button
									className="flex h-8 w-8 cursor-default items-center justify-center rounded-full bg-[#eef1f4] text-[#9aa3ad]"
									disabled
									title={t("正在初始化")}
									type="button"
								>
									<Loader2 className="animate-spin" size={16} />
								</button>
							) : (
								<button
									className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
										canSend
											? "bg-[#2f7df6] text-white hover:bg-[#1f6fe5]"
											: "bg-[#eef1f4] text-[#9aa3ad]"
									}`}
									disabled={!canSend}
									onClick={() => void submit()}
									title={noModel ? t("配置模型后即可发送") : t("发送")}
									type="button"
								>
									<ArrowUp size={16} />
								</button>
							)}
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
