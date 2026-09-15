import {
	ArrowLeft,
	Archive,
	ChevronRight,
	ExternalLink,
	FileCode2,
	FileImage,
	FileSpreadsheet,
	FileText,
	FileType2,
	Folder,
	FolderOpen,
	Presentation,
	RefreshCw,
	Search,
	X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { lazy, Suspense } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
	classifyFileKind,
	imageDataUrl,
	type FileKind,
} from "../lib/documents";
import { usePiStore, useSessionCwd } from "../state/store";
import { useUiStore } from "../state/ui";
import { useImageMenu } from "./ImageMenu";
import { t } from "../i18n";

const DocxPreview = lazy(() => import("./previews/DocxPreview"));
const ExcelPreview = lazy(() => import("./previews/ExcelPreview"));
const PdfPreview = lazy(() => import("./previews/PdfPreview"));
const PptxPreview = lazy(() => import("./previews/PptxPreview"));
const ArchivePreview = lazy(() => import("./previews/ArchivePreview"));

const ARCHIVE_EXTENSIONS = new Set([
	"zip",
	"tar",
	"gz",
	"tgz",
	"bz2",
	"tbz",
	"tbz2",
	"xz",
	"txz",
	"7z",
	"rar",
	"zst",
	"lz4",
	"cpio",
	"iso",
	"ar",
]);

const MAX_BINARY_PREVIEW_BYTES = 64 * 1024 * 1024;

function extensionOf(filePath: string): string {
	const name = filePath.slice(Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\")) + 1);
	return name.slice(name.lastIndexOf(".") + 1).toLowerCase();
}

function bytesToBlob(base64: string, mimeType: string): Blob {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
	return new Blob([bytes], { type: mimeType });
}

/** One entry of the tree, assembled from the flat workspace listing. */
interface TreeEntry {
	children: TreeEntry[];
	name: string;
	path: string;
	type: "directory" | "file";
}

const ICONS: Record<FileKind, typeof FileText> = {
	archive: Archive,
	code: FileCode2,
	excel: FileSpreadsheet,
	html: FileCode2,
	image: FileImage,
	markdown: FileText,
	other: FileType2,
	pdf: FileText,
	ppt: Presentation,
	text: FileText,
	word: FileText,
};

const TONES: Partial<Record<FileKind, string>> = {
	archive: "text-[#f79009]",
	code: "text-[#2f7df6]",
	excel: "text-[#22c55e]",
	image: "text-[#8b5cf6]",
	markdown: "text-[#667085]",
	pdf: "text-[#f04438]",
	ppt: "text-[#f97316]",
	word: "text-[#2f7df6]",
};

/** Natural name order, so `file2` precedes `file10`; directories first. */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function buildTree(paths: string[]): TreeEntry[] {
	const root: TreeEntry = { children: [], name: "", path: "", type: "directory" };
	const directories = new Map<string, TreeEntry>([["", root]]);
	for (const path of paths) {
		const segments = path.split("/");
		let parent = root;
		let prefix = "";
		segments.forEach((segment, index) => {
			prefix = prefix ? `${prefix}/${segment}` : segment;
			const isFile = index === segments.length - 1;
			let entry = directories.get(prefix);
			if (!entry) {
				entry = { children: [], name: segment, path: prefix, type: isFile ? "file" : "directory" };
				directories.set(prefix, entry);
				parent.children.push(entry);
			}
			parent = entry;
		});
	}
	const sort = (entry: TreeEntry): void => {
		entry.children.sort((left, right) => {
			const group = Number(right.type === "directory") - Number(left.type === "directory");
			return group !== 0 ? group : collator.compare(left.name, right.name);
		});
		for (const child of entry.children) sort(child);
	};
	sort(root);
	return root.children;
}

/** A previewed image, with the right-click menu that copies it. */
function ImagePreview({ url }: { url: string }) {
	const imageMenu = useImageMenu(url);
	return (
		<div className="p-3">
			<img
				alt=""
				className="max-w-full rounded-lg border border-black/[0.06]"
				onContextMenu={imageMenu.onContextMenu}
				src={url}
			/>
			{imageMenu.menu}
		</div>
	);
}

/** The preview pane's content for one file, chosen by kind. */
function Preview({ filePath }: { filePath: string }) {
	const extension = extensionOf(filePath);
	const isArchive = ARCHIVE_EXTENSIONS.has(extension);
	const [state, setState] = useState<
		| { status: "loading" }
		| { kind: FileKind; status: "text"; text: string; truncated?: boolean }
		| { kind: FileKind; status: "image"; url: string }
		| { blob: Blob; kind: FileKind; status: "binary"; truncated: boolean }
		| { status: "unsupported"; message: string }
		| { status: "error"; message: string }
	>({ status: "loading" });

	useEffect(() => {
		let disposed = false;
		const kind = classifyFileKind(filePath);
		const isLegacyWordOrPpt = extension === "doc" || extension === "ppt";
		const isUnsupportedOffice = (kind === "word" && extension !== "docx") || (kind === "ppt" && extension !== "pptx");
		const load = async () => {
			if (isLegacyWordOrPpt || isUnsupportedOffice) {
				setState({
					message: t("该文档格式无法在应用内预览，可用系统程序打开。"),
					status: "unsupported",
				});
				return;
			}
			try {
				if (!isArchive && (kind === "text" || kind === "code" || kind === "markdown" || kind === "html")) {
					const file = (await window.pi.readFile(filePath)) as { text?: string; type?: string } | undefined;
					if (disposed) return;
					setState({
						kind,
						status: "text",
						text: typeof file?.text === "string" ? file.text : "",
						truncated: (file as { truncated?: boolean } | undefined)?.truncated,
					});
					return;
				}
				const bytes = (await window.pi.readBytes(filePath, MAX_BINARY_PREVIEW_BYTES)) as
					| { base64?: string; size?: number; truncated?: boolean }
					| undefined;
				const base64 = bytes?.base64 ?? "";
				if (disposed) return;
				if (!base64) {
					setState({ message: t("文件内容为空或无法读取。"), status: "error" });
					return;
				}
				if (kind === "image") {
					const extension = filePath.slice(filePath.lastIndexOf(".") + 1).toLowerCase();
					const mime = extension === "svg" ? "image/svg+xml" : `image/${extension === "jpg" ? "jpeg" : extension}`;
					setState({ kind, status: "image", url: imageDataUrl(base64, mime) });
					return;
				}
				const mime =
					extension === "pdf"
						? "application/pdf"
						: extension === "docx"
							? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
							: extension === "xlsx" || extension === "xlsm"
								? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
								: extension === "xls"
									? "application/vnd.ms-excel"
									: extension === "pptx"
										? "application/vnd.openxmlformats-officedocument.presentationml.presentation"
										: "application/octet-stream";
				setState({ blob: bytesToBlob(base64, mime), kind, status: "binary", truncated: bytes?.truncated === true });
			} catch (error) {
				if (!disposed) {
					setState({ message: error instanceof Error ? error.message : String(error), status: "error" });
				}
			}
		};
		void load();
		return () => { disposed = true; };
	}, [filePath]);

	if (state.status === "loading") {
		return <div className="p-4 text-[12px] text-[#98a2b3]">{t("读取中…")}</div>;
	}
	if (state.status === "error" || state.status === "unsupported") {
		return <div className="p-4 text-[12px] text-[#98a2b3]">{state.message}</div>;
	}
	if (state.status === "image") {
		return <ImagePreview url={state.url} />;
	}
	if (state.status === "binary") {
		return (
			<Suspense fallback={<div className="p-4 text-[12px] text-[#98a2b3]">{t("加载预览组件...")}</div>}>
				{state.truncated ? <div className="p-3 text-[11px] text-[#b54708]">{t("文件超过 64 MB，仅读取了前 64 MB，预览可能不完整。")}</div> : null}
				{state.kind === "pdf" ? <PdfPreview blob={state.blob} /> : null}
				{state.kind === "word" ? <DocxPreview blob={state.blob} /> : null}
				{state.kind === "excel" ? <ExcelPreview blob={state.blob} /> : null}
				{state.kind === "ppt" ? <PptxPreview blob={state.blob} /> : null}
				{isArchive ? <ArchivePreview blob={state.blob} filename={filePath} /> : null}
			</Suspense>
		);
	}
	const lines = state.text.split("\n");
	if (state.kind === "markdown") {
		return (
			<div className="prose-pi px-4 py-3 text-[13px]">
				<ReactMarkdown remarkPlugins={[remarkGfm]}>{state.text}</ReactMarkdown>
			</div>
		);
	}
	if (state.kind === "html") {
		// The markup shows as source: rendering a workspace file's HTML inside the app would run
		// scripts with the app's own privileges.
		return (
			<pre className="whitespace-pre-wrap break-words px-4 py-3 font-mono text-[12px] text-[#1f2937]">
				{state.text.slice(0, 200_000)}
			</pre>
		);
	}
	return (
		<div className="flex min-h-full text-[12px] leading-[19px]">
			<div className="sticky left-0 shrink-0 select-none border-r border-black/[0.06] bg-[#fafafa] px-2 py-2 text-right font-mono text-[11px] text-[#c0c6cd]">
				{lines.slice(0, 4000).map((_line, index) => (
					<div key={index}>{index + 1}</div>
				))}
			</div>
			<pre className="min-w-0 flex-1 whitespace-pre-wrap break-words px-3 py-2 font-mono text-[#1f2937]">
				{lines.slice(0, 4000).join("\n")}
			</pre>
		</div>
	);
}

/** One tree level: directories toggle, files open the preview. */
function TreeLevel({
	depth,
	entries,
	expanded,
	onOpen,
	onToggle,
	selected,
}: {
	depth: number;
	entries: TreeEntry[];
	expanded: Set<string>;
	onOpen: (path: string) => void;
	onToggle: (path: string) => void;
	selected?: string;
}) {
	return (
		<ul className="m-0 list-none p-0" style={{ paddingLeft: depth === 0 ? 0 : 14 }}>
			{entries.map((entry) => {
				const kind = classifyFileKind(entry.path);
				const Icon = ICONS[kind];
				const open = expanded.has(entry.path);
				return (
					<li key={entry.path}>
						<button
							className={`flex w-full items-center gap-2 rounded-[10px] px-2.5 py-[5px] text-left text-[13px] transition-colors ${
								selected === entry.path ? "bg-black/[0.06]" : "hover:bg-black/[0.04]"
							}`}
							onClick={() => (entry.type === "directory" ? onToggle(entry.path) : onOpen(entry.path))}
							title={entry.path}
							type="button"
						>
							{entry.type === "directory" ? (
								<>
									<ChevronRight
										className={`shrink-0 text-[#b6bcc4] transition-transform ${open ? "rotate-90" : ""}`}
										size={13}
									/>
									{open ? (
										<FolderOpen className="shrink-0 text-[#b6bcc4]" size={14} />
									) : (
										<Folder className="shrink-0 text-[#b6bcc4]" size={14} />
									)}
								</>
							) : (
								<Icon className={`ml-[19px] shrink-0 ${TONES[kind] ?? "text-[#b6bcc4]"}`} size={14} />
							)}
							<span className="min-w-0 flex-1 truncate text-[#1f2937]">{entry.name}</span>
						</button>
						{entry.type === "directory" && open ? (
							<TreeLevel
								depth={depth + 1}
								entries={entry.children}
								expanded={expanded}
								onOpen={onOpen}
								onToggle={onToggle}
								selected={selected}
							/>
						) : null}
					</li>
				);
			})}
		</ul>
	);
}

const WIDTH_KEY = "pi-web.file-panel-width";
const WIDTH_DEFAULT = 420;
const WIDTH_MIN = 280;

function readWidth(): number {
	const stored = Number(localStorage.getItem(WIDTH_KEY));
	return Number.isFinite(stored) && stored > 0 ? stored : WIDTH_DEFAULT;
}

/** The panel never takes more than this from the conversation. */
function maxWidth(): number {
	return Math.max(WIDTH_MIN, Math.min(760, window.innerWidth - 520));
}

/**
 * Drag handle on the panel's left edge, the dockkit divider: no width of its own, a hairline for
 * the eye and an 8px strip for the pointer, following the gesture on the window so a drag that
 * leaves the panel keeps working.
 */
function ResizeHandle({ onResize, onSettle }: { onResize: (width: number) => void; onSettle: () => void }) {
	return (
		<div
			className="absolute bottom-0 left-[-4px] top-0 z-10 w-2 cursor-col-resize touch-none"
			onPointerDown={(event) => {
				event.preventDefault();
				const startX = event.clientX;
				const startWidth = Number(event.currentTarget.parentElement?.dataset.width ?? WIDTH_DEFAULT);
				const element = event.currentTarget;
				element.setPointerCapture(event.pointerId);
				const stop = () => {
					window.removeEventListener("pointermove", move);
					window.removeEventListener("pointerup", stop);
					window.removeEventListener("pointercancel", stop);
					document.body.style.cursor = "";
					document.body.style.userSelect = "";
					onSettle();
				};
				const move = (moveEvent: PointerEvent) => {
					onResize(Math.max(WIDTH_MIN, Math.min(maxWidth(), startWidth - (moveEvent.clientX - startX))));
				};
				document.body.style.cursor = "col-resize";
				document.body.style.userSelect = "none";
				window.addEventListener("pointermove", move);
				window.addEventListener("pointerup", stop);
				window.addEventListener("pointercancel", stop);
			}}
			role="separator"
		/>
	);
}

/**
 * Right-hand file panel: the workspace tree, and a preview for the file that is open.
 *
 * The listing is the flat one the app already had; the tree is assembled here so a directory can
 * be expanded without another round trip. Office files are read by the document helpers, which
 * unzip them in the renderer.
 */
export function FilePanel() {
	const cwd = useSessionCwd();
	const fileList = usePiStore((state) => state.files);
	const filesRoot = usePiStore((state) => state.filesRoot);
	const loadFiles = usePiStore((state) => state.loadFiles);
	const [width, setWidth] = useState(readWidth);
	// The gesture writes through a ref so the release persists the last value it produced.
	const widthRef = useRef(width);
	const applyWidth = (value: number) => {
		widthRef.current = value;
		setWidth(value);
	};
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const [openFile, setOpenFile] = useState<string | undefined>(undefined);
	const [query, setQuery] = useState("");
	const [reloading, setReloading] = useState(false);
	const setFilePanelOpen = useUiStore((state) => state.setFilePanelOpen);

	const tree = useMemo(() => buildTree(fileList), [fileList]);
	const matches = useMemo(() => {
		const normalized = query.trim().toLowerCase();
		if (!normalized) return undefined;
		return fileList.filter((path) => path.toLowerCase().includes(normalized)).slice(0, 200);
	}, [fileList, query]);

	// The listing belongs to the folder the session works in, and the panel resolves preview paths
	// against that same root: whenever the root moves, the tree is re-read.
	useEffect(() => {
		if (cwd) void loadFiles().catch(() => {});
	}, [cwd, loadFiles]);

	// A window that shrank under a wide panel pulls it back inside the limit.
	useEffect(() => {
		const clamp = () => {
			if (widthRef.current > maxWidth()) applyWidth(maxWidth());
		};
		window.addEventListener("resize", clamp);
		clamp();
		return () => window.removeEventListener("resize", clamp);
	}, []);

	// The listing carries the root it was taken from: resolving previews against anything else is
	// how a session whose folder differs from the listed one ends up reading the wrong path.
	const root = (filesRoot ?? cwd ?? "").replace(/[\\/]+$/, "");
	const parts = root.split(/[\\/]/).filter(Boolean);

	return (
		<aside
			className="relative ml-2.5 flex shrink-0 flex-col overflow-hidden rounded-[16px] border border-black/[0.06] bg-white shadow-[0_2px_12px_rgba(31,41,55,0.05)]"
			data-width={width}
			style={{ width }}
		>
			<ResizeHandle
				onResize={applyWidth}
				onSettle={() => localStorage.setItem(WIDTH_KEY, String(widthRef.current))}
			/>
			<div className="flex h-[38px] shrink-0 items-center gap-1 border-b-[0.5px] border-black/[0.06] pl-4 pr-1.5">
				{openFile ? (
					<button
						className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#4b5563] hover:bg-black/[0.05]"
						onClick={() => setOpenFile(undefined)}
						title={t("返回文件列表")}
						type="button"
					>
						<ArrowLeft size={14} />
					</button>
				) : null}
				<div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
					{openFile ? (
						<span className="min-w-0 truncate text-[12px] text-[#1f2937]" title={openFile}>
							{openFile.split("/").at(-1)}
						</span>
					) : (
						<>
							<span className="min-w-0 truncate text-[12px] text-[#98a2b3]">
								{parts.slice(0, -1).join("\\")}
								{parts.length > 1 ? "\\" : ""}
							</span>
							<span className="shrink-0 text-[12px] text-[#1f2937]">{parts.at(-1) ?? ""}</span>
						</>
					)}
				</div>
				<button
					className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#6b7280] hover:bg-black/[0.05]"
					onClick={() => {
						setReloading(true);
						void loadFiles().finally(() => setReloading(false));
					}}
					title={t("重新读取文件列表")}
					type="button"
				>
					<RefreshCw className={reloading ? "animate-spin" : ""} size={14} />
				</button>
				{openFile ? (
					<button
						className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#6b7280] hover:bg-black/[0.05]"
						onClick={() => void window.pi.openPath(`${root}/${openFile}`)}
						title={t("用系统程序打开")}
						type="button"
					>
						<ExternalLink size={14} />
					</button>
				) : null}
				<button
					className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#6b7280] hover:bg-black/[0.05]"
					onClick={() => setFilePanelOpen(false)}
					title={t("关闭文件面板")}
					type="button"
				>
					<X size={14} />
				</button>
			</div>

			{openFile ? (
				<div className="scrollbar-subtle min-h-0 flex-1 overflow-auto">
					<Preview filePath={`${root}/${openFile}`} />
				</div>
			) : (
				<>
					<div className="shrink-0 px-3 pb-1.5 pt-2">
						<div className="flex h-8 items-center gap-2 rounded-full border border-black/[0.08] px-2.5">
							<Search className="shrink-0 text-[#98a2b3]" size={13} />
							<input
								className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-[#98a2b3]"
								onChange={(event) => setQuery(event.target.value)}
								placeholder={t("搜索文件")}
								value={query}
							/>
						</div>
					</div>
					<div className="scrollbar-subtle min-h-0 flex-1 overflow-auto px-2 pb-2">
						{matches ? (
							<ul className="m-0 list-none p-0">
								{matches.map((path) => {
									const kind = classifyFileKind(path);
									const Icon = ICONS[kind];
									return (
										<li key={path}>
											<button
												className="flex w-full items-center gap-2 rounded-[10px] px-2.5 py-[5px] text-left hover:bg-black/[0.04]"
												onClick={() => setOpenFile(path)}
												title={path}
												type="button"
											>
												<Icon className={`shrink-0 ${TONES[kind] ?? "text-[#b6bcc4]"}`} size={14} />
												<span className="min-w-0 flex-1 truncate text-[12px] text-[#475467]">{path}</span>
											</button>
										</li>
									);
								})}
								{matches.length === 0 ? (
									<li className="px-2.5 py-3 text-[12px] text-[#98a2b3]">{t("没有匹配的文件")}</li>
								) : null}
							</ul>
						) : tree.length === 0 ? (
							<div className="px-2.5 py-3 text-[12px] text-[#98a2b3]">{t("这个项目暂时没有可读取的文件")}</div>
						) : (
							<TreeLevel
								depth={0}
								entries={tree}
								expanded={expanded}
								onOpen={setOpenFile}
								onToggle={(path) =>
									setExpanded((current) => {
										const next = new Set(current);
										if (next.has(path)) next.delete(path);
										else next.add(path);
										return next;
									})
								}
								selected={openFile}
							/>
						)}
					</div>
				</>
			)}
		</aside>
	);
}
