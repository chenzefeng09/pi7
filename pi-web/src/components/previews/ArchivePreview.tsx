import { useEffect, useState, type ReactNode } from "react";
import { Archive } from "libarchive.js";

const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const ARCHIVE_WORKER_URL = new URL("libarchive/worker-bundle.js", document.baseURI).toString();

interface ArchiveEntry {
	path: string;
	size: number;
}

interface TreeFolder {
	type: "folder";
	name: string;
	path: string;
	children: TreeNode[];
}

interface TreeFile {
	type: "file";
	name: string;
	path: string;
	size: number;
}

type TreeNode = TreeFolder | TreeFile;

function formatBytes(size: number): string {
	if (size < 1024) return `${size} B`;
	if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
	return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function buildTree(entries: ArchiveEntry[]): TreeNode[] {
	const root: TreeFolder = { children: [], name: "", path: "", type: "folder" };
	for (const entry of entries) {
		const parts = entry.path.split("/").filter(Boolean);
		if (parts.length === 0) continue;
		let folder = root;
		for (let index = 0; index < parts.length - 1; index += 1) {
			const name = parts[index];
			const path = parts.slice(0, index + 1).join("/");
			let child = folder.children.find((node): node is TreeFolder => node.type === "folder" && node.name === name);
			if (!child) {
				child = { children: [], name, path, type: "folder" };
				folder.children.push(child);
			}
			folder = child;
		}
		folder.children.push({ name: parts.at(-1) ?? entry.path, path: entry.path, size: entry.size, type: "file" });
	}
	const sort = (folder: TreeFolder): void => {
		folder.children.sort((left, right) => Number(right.type === "folder") - Number(left.type === "folder") || left.name.localeCompare(right.name, undefined, { numeric: true }));
		for (const child of folder.children) if (child.type === "folder") sort(child);
	};
	sort(root);
	return root.children;
}

function renderTree(nodes: TreeNode[], depth: number): ReactNode {
	return nodes.map((node) => (
		<div key={`${node.type}:${node.path}`} className="font-mono text-[12px] text-[#475467]" style={{ paddingLeft: depth * 16 }}>
			<div className="flex items-center gap-2 py-1">
				<span className="shrink-0 text-[#98a2b3]">{node.type === "folder" ? "▾" : "·"}</span>
				<span className="min-w-0 flex-1 truncate">{node.name}{node.type === "folder" ? "/" : ""}</span>
				{node.type === "file" ? <span className="shrink-0 text-[10px] text-[#98a2b3]">{formatBytes(node.size)}</span> : null}
			</div>
			{node.type === "folder" ? renderTree(node.children, depth + 1) : null}
		</div>
	));
}

/** Lists archive metadata in a Worker; individual entries are never extracted to disk. */
export function ArchivePreview({ blob, filename }: { blob: Blob; filename: string }): JSX.Element {
	const [entries, setEntries] = useState<ArchiveEntry[]>([]);
	const [encrypted, setEncrypted] = useState(false);
	const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

	useEffect(() => {
		let cancelled = false;
		let archive: Awaited<ReturnType<typeof Archive.open>> | undefined;
		setStatus("loading");
		setEntries([]);
		setEncrypted(false);
		if (blob.size > MAX_ARCHIVE_BYTES) {
			setStatus("error");
			return;
		}
		void (async () => {
			try {
				Archive.init({ workerUrl: ARCHIVE_WORKER_URL });
				archive = await Archive.open(new File([blob], filename, { type: "application/octet-stream" }));
				const hasEncrypted = await archive.hasEncryptedData();
				const listed = await archive.getFilesArray();
				if (cancelled) return;
				setEncrypted(hasEncrypted === true);
				setEntries(listed.map((entry) => ({ path: `${entry.path ?? ""}${entry.file?.name ?? ""}`, size: Number(entry.file?.size ?? 0) })).filter((entry) => entry.path));
				setStatus("ready");
			} catch {
				if (!cancelled) setStatus("error");
			} finally {
				await archive?.close().catch(() => {});
			}
		})();
		return () => {
			cancelled = true;
			void archive?.close().catch(() => {});
		};
	}, [blob, filename]);

	if (status === "loading") return <div className="p-4 text-[12px] text-[#98a2b3]">读取压缩包目录...</div>;
	if (status === "error") return <div className="p-4 text-[12px] text-[#f04438]">压缩包过大（上限 64 MB）或格式不受支持。</div>;
	const total = entries.reduce((sum, entry) => sum + entry.size, 0);
	return (
		<section className="rounded-lg border border-black/[0.06] bg-white p-3">
			<div className="flex flex-wrap items-center gap-2 text-[11px] text-[#667085]">
				<span>{entries.length} 个文件 · 解压后 {formatBytes(total)}</span>
				{encrypted ? <span className="rounded border border-[#f79009]/30 bg-[#fff7e6] px-1.5 py-0.5 text-[#b54708]">含加密内容</span> : null}
				<span className="text-[#98a2b3]">仅列出目录，未解压文件内容</span>
			</div>
			<div className="mt-2 max-h-[calc(100vh-190px)] overflow-auto rounded border border-black/[0.06] bg-[#fafafa] p-2">{renderTree(buildTree(entries), 0)}</div>
		</section>
	);
}

export default ArchivePreview;
