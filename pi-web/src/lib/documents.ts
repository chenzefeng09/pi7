import { t } from "../i18n";
/** File-kind classification and small legacy helpers shared by the file panel. */

export type FileKind =
	| "archive"
	| "code"
	| "excel"
	| "html"
	| "image"
	| "markdown"
	| "other"
	| "pdf"
	| "ppt"
	| "text"
	| "word";

const EXTENSION_KINDS: Record<string, FileKind> = {
	avif: "image",
	ar: "archive",
	bmp: "image",
	bz2: "archive",
	c: "code",
	cc: "code",
	cjs: "code",
	cpio: "archive",
	cpp: "code",
	cs: "code",
	css: "code",
	csv: "code",
	doc: "word",
	docx: "word",
	gif: "image",
	gz: "archive",
	go: "code",
	h: "code",
	hpp: "code",
	htm: "html",
	html: "html",
	ico: "image",
	iso: "archive",
	jpeg: "image",
	jpg: "image",
	js: "code",
	lz4: "archive",
	json: "code",
	jsonc: "code",
	jsx: "code",
	less: "code",
	log: "text",
	md: "markdown",
	mdx: "markdown",
	mjs: "code",
	markdown: "markdown",
	odt: "word",
	pdf: "pdf",
	png: "image",
	ppt: "ppt",
	pptx: "ppt",
	py: "code",
	rar: "archive",
	rb: "code",
	rs: "code",
	rtf: "word",
	scss: "code",
	sh: "code",
	sql: "code",
	svg: "image",
	swift: "code",
	tif: "image",
	tiff: "image",
	tar: "archive",
	tbz: "archive",
	tbz2: "archive",
	tgz: "archive",
	txz: "archive",
	toml: "code",
	ts: "code",
	tsv: "code",
	tsx: "code",
	txt: "text",
	vue: "code",
	webp: "image",
	xz: "archive",
	xls: "excel",
	xlsm: "excel",
	xlsx: "excel",
	xml: "code",
	yaml: "code",
	yml: "code",
	zip: "archive",
	zst: "archive",
	"7z": "archive",
};

/** Kinds whose bytes are a document rather than text. */
const BINARY_KINDS: ReadonlySet<FileKind> = new Set(["archive", "excel", "image", "pdf", "ppt", "word"]);

export function classifyFileKind(filePath: string): FileKind {
	const name = filePath.slice(Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\")) + 1).toLowerCase();
	const dot = name.lastIndexOf(".");
	const extension = dot < 0 ? "" : name.slice(dot + 1);
	// `in` would also match prototype keys: "constructor" is no kind of file.
	if (Object.hasOwn(EXTENSION_KINDS, extension)) return EXTENSION_KINDS[extension] ?? "other";
	if (/^(readme|changelog|contributing|license)(\.|$)/.test(name)) return "markdown";
	return "text";
}

export function isBinaryKind(kind: FileKind): boolean {
	return BINARY_KINDS.has(kind);
}

/** Legacy OLE formats share the extension family but not the ZIP container. */
export function isLegacyOffice(filePath: string): boolean {
	const extension = filePath.slice(filePath.lastIndexOf(".") + 1).toLowerCase();
	return extension === "doc" || extension === "xls" || extension === "ppt";
}

function base64ToBytes(base64: string): Uint8Array {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
	return bytes;
}

/** One previewed part never needs more than this; a zip bomb is capped before it OOMs. */
const MAX_INFLATED_BYTES = 64 * 1024 * 1024;

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
	// `deflate-raw` is what ZIP stores (Chromium 103+), so no library is needed for OOXML.
	const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > MAX_INFLATED_BYTES) {
			await reader.cancel();
			throw new Error(t("解压结果超过 {arg}MB，已放弃预览", { "arg": MAX_INFLATED_BYTES / 1024 / 1024 }));
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

/** Read a ZIP's central directory and return its entries by name. */
async function readZip(base64: string): Promise<Map<string, Uint8Array>> {
	const bytes = base64ToBytes(base64);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const decoder = new TextDecoder();
	let endOfDirectory = -1;
	for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65558); index -= 1) {
		if (view.getUint32(index, true) === 0x06054b50) {
			endOfDirectory = index;
			break;
		}
	}
	if (endOfDirectory < 0) throw new Error(t("不是有效的 OOXML/zip 文件"));
	const count = view.getUint16(endOfDirectory + 10, true);
	let offset = view.getUint32(endOfDirectory + 16, true);
	const entries = new Map<string, Uint8Array>();
	for (let index = 0; index < count; index += 1) {
		if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) break;
		const method = view.getUint16(offset + 10, true);
		const compressedSize = view.getUint32(offset + 20, true);
		const nameLength = view.getUint16(offset + 28, true);
		const extraLength = view.getUint16(offset + 30, true);
		const commentLength = view.getUint16(offset + 32, true);
		const localOffset = view.getUint32(offset + 42, true);
		if (offset + 46 + nameLength + extraLength + commentLength > bytes.length) throw new Error(t("zip 目录条目越界"));
		const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
		if (localOffset + 30 > bytes.length) throw new Error(t("zip 文件条目越界"));
		const localNameLength = view.getUint16(localOffset + 26, true);
		const localExtraLength = view.getUint16(localOffset + 28, true);
		const start = localOffset + 30 + localNameLength + localExtraLength;
		if (start < 0 || start + compressedSize > bytes.length) {
			throw new Error(t("zip 文件条目越界"));
		}
		if (method !== 0 && method !== 8) throw new Error(t("不支持的 zip 压缩方法：{method}", { "method": method }));
		const raw = bytes.subarray(start, start + compressedSize);
		entries.set(name, method === 0 ? raw : await inflateRaw(raw));
		offset += 46 + nameLength + extraLength + commentLength;
	}
	return entries;
}

function xmlOf(entries: Map<string, Uint8Array>, name: string): string | undefined {
	const bytes = entries.get(name);
	return bytes ? new TextDecoder().decode(bytes) : undefined;
}

/** Resolve an OOXML relationship target relative to the source part. */
function resolveZipTarget(source: string, target: string): string {
	const segments = (target.startsWith("/") ? target.slice(1) : `${source.slice(0, source.lastIndexOf("/") + 1)}${target}`).split("/");
	const resolved: string[] = [];
	for (const segment of segments) {
		if (!segment || segment === ".") continue;
		if (segment === "..") resolved.pop();
		else resolved.push(segment);
	}
	return resolved.join("/");
}

function textOf(element: Element | undefined): string {
	return element?.textContent ?? "";
}

/** Paragraphs of a Word document. */
export async function readDocx(base64: string): Promise<string[]> {
	const entries = await readZip(base64);
	const document = xmlOf(entries, "word/document.xml");
	if (!document) throw new Error(t("docx 缺少 word/document.xml"));
	const parsed = new DOMParser().parseFromString(document, "application/xml");
	const paragraphs = Array.from(parsed.getElementsByTagName("w:p"));
	const lines = paragraphs.map((paragraph) =>
		Array.from(paragraph.getElementsByTagName("w:t"))
			.map((run) => textOf(run))
			.join(""),
	);
	return lines;
}

export interface SheetView {
	name: string;
	rows: string[][];
}

/** Values of a workbook, sheet by sheet, resolved through the shared string table. */
export async function readXlsx(base64: string): Promise<SheetView[]> {
	const entries = await readZip(base64);
	const shared: string[] = [];
	const sharedXml = xmlOf(entries, "xl/sharedStrings.xml");
	if (sharedXml) {
		const parsed = new DOMParser().parseFromString(sharedXml, "application/xml");
		for (const item of Array.from(parsed.getElementsByTagName("si"))) shared.push(textOf(item));
	}
	const workbook = xmlOf(entries, "xl/workbook.xml");
	const sheetRefs: Array<{ name: string; relId: string }> = [];
	if (workbook) {
		const parsed = new DOMParser().parseFromString(workbook, "application/xml");
		for (const sheet of Array.from(parsed.getElementsByTagName("sheet"))) {
			sheetRefs.push({ name: sheet.getAttribute("name") ?? "", relId: sheet.getAttribute("r:id") ?? "" });
		}
	}
	const rels = new Map<string, string>();
	const relXml = xmlOf(entries, "xl/_rels/workbook.xml.rels");
	if (relXml) {
		const parsed = new DOMParser().parseFromString(relXml, "application/xml");
		for (const rel of Array.from(parsed.getElementsByTagName("Relationship"))) {
			const id = rel.getAttribute("Id");
			const target = rel.getAttribute("Target");
			if (id && target) rels.set(id, resolveZipTarget("xl/workbook.xml", target));
		}
	}
	const sheetEntries = sheetRefs.map((ref) => ({ name: ref.name, path: rels.get(ref.relId) })).filter((entry): entry is { name: string; path: string } => !!entry.path);
	const sheets: SheetView[] = [];
	for (const [index, sheet] of sheetEntries.entries()) {
		const xml = xmlOf(entries, sheet.path);
		if (!xml) continue;
		const parsed = new DOMParser().parseFromString(xml, "application/xml");
		const rows: string[][] = [];
		for (const row of Array.from(parsed.getElementsByTagName("row"))) {
			const cells = new Map<number, string>();
			let rowIndex = Number(row.getAttribute("r")) - 1;
			if (!Number.isInteger(rowIndex) || rowIndex < 0) rowIndex = rows.length;
			if (rowIndex > 10_000) continue;
			while (rows.length < rowIndex) rows.push([]);
			for (const cell of Array.from(row.getElementsByTagName("c"))) {
				const ref = cell.getAttribute("r") ?? "";
				const match = /^([A-Z]+)\d+$/.exec(ref);
				const column = match ? [...match[1]].reduce((value, char) => value * 26 + char.charCodeAt(0) - 64, 0) - 1 : cells.size;
				const type = cell.getAttribute("t");
				const value = textOf(Array.from(cell.getElementsByTagName("v"))[0]);
				if (type === "s") cells.set(column, shared[Number(value)] ?? "");
				else if (type === "inlineStr") cells.set(column, textOf(Array.from(cell.getElementsByTagName("t"))[0]));
				else cells.set(column, value);
			}
			const width = Math.min(Math.max(-1, ...cells.keys()) + 1, 10_000);
			rows.push(Array.from({ length: width }, (_, column) => cells.get(column) ?? ""));
		}
		sheets.push({ name: sheet.name || t("工作表 {arg}", { "arg": index + 1 }), rows });
	}
	return sheets;
}

export interface SlideView {
	lines: string[];
	index: number;
}

/** Text runs of every slide, in slide order. */
export async function readPptx(base64: string): Promise<SlideView[]> {
	const entries = await readZip(base64);
	const slideNames: string[] = [];
	const presentation = xmlOf(entries, "ppt/presentation.xml");
	const presentationRels = xmlOf(entries, "ppt/_rels/presentation.xml.rels");
	if (presentation && presentationRels) {
		const relationships = new Map<string, string>();
		const relParsed = new DOMParser().parseFromString(presentationRels, "application/xml");
		for (const rel of Array.from(relParsed.getElementsByTagName("Relationship"))) {
			const id = rel.getAttribute("Id");
			const target = rel.getAttribute("Target");
			if (id && target) relationships.set(id, resolveZipTarget("ppt/presentation.xml", target));
		}
		const presentationParsed = new DOMParser().parseFromString(presentation, "application/xml");
		for (const slide of Array.from(presentationParsed.getElementsByTagName("p:sldId"))) {
			const relId = slide.getAttribute("r:id");
			const name = relId ? relationships.get(relId) : undefined;
			if (name) slideNames.push(name);
		}
	}
	if (slideNames.length === 0) {
		slideNames.push(
			...[...entries.keys()]
				.filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
				.sort((left, right) => left.localeCompare(right, undefined, { numeric: true })),
		);
	}
	const views: SlideView[] = [];
	for (const [index, name] of slideNames.entries()) {
		const xml = xmlOf(entries, name);
		if (!xml) continue;
		const parsed = new DOMParser().parseFromString(xml, "application/xml");
		const lines = Array.from(parsed.getElementsByTagName("a:p")).map((paragraph) =>
			Array.from(paragraph.getElementsByTagName("a:t"))
				.map((run) => textOf(run))
				.join(""),
		);
		views.push({ index: index + 1, lines: lines.filter((line) => line.trim().length > 0) });
	}
	return views;
}

/** A PDF rendered by Chromium's own viewer, which needs a URL rather than bytes. */
export function pdfBlobUrl(base64: string): string {
	const bytes = base64ToBytes(base64);
	return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
}

export function imageDataUrl(base64: string, mimeType: string): string {
	return `data:${mimeType};base64,${base64}`;
}
