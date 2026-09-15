/**
 * Build a tiny docx/xlsx/pptx set for verifying the file panel's document preview.
 *
 * Usage: node scripts/make-preview-fixtures.mjs <outDir>
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import * as XLSX from "@keep-lts/xlsx";

function crc32(buffer) {
	let crc = 0xffffffff;
	for (const byte of buffer) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
	}
	return (crc ^ 0xffffffff) >>> 0;
}

/** Minimal ZIP writer: local headers, then the central directory, deflate for every entry. */
function zip(files) {
	const chunks = [];
	const central = [];
	let offset = 0;
	for (const [name, text] of Object.entries(files)) {
		const nameBytes = Buffer.from(name, "utf8");
		const data = Buffer.from(text, "utf8");
		const compressed = deflateRawSync(data);
		const crc = crc32(data);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(0, 6);
		local.writeUInt16LE(8, 8);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(compressed.length, 18);
		local.writeUInt32LE(data.length, 22);
		local.writeUInt16LE(nameBytes.length, 26);
		chunks.push(local, nameBytes, compressed);
		const entry = Buffer.alloc(46);
		entry.writeUInt32LE(0x02014b50, 0);
		entry.writeUInt16LE(20, 4);
		entry.writeUInt16LE(20, 6);
		entry.writeUInt16LE(8, 10);
		entry.writeUInt32LE(crc, 16);
		entry.writeUInt32LE(compressed.length, 20);
		entry.writeUInt32LE(data.length, 24);
		entry.writeUInt16LE(nameBytes.length, 28);
		entry.writeUInt32LE(offset, 42);
		central.push(entry, nameBytes);
		offset += local.length + nameBytes.length + compressed.length;
	}
	const centralSize = central.reduce((total, part) => total + part.length, 0);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(Object.keys(files).length, 8);
	end.writeUInt16LE(Object.keys(files).length, 10);
	end.writeUInt32LE(centralSize, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...chunks, ...central, end]);
}

const outDir = process.argv[2];
mkdirSync(outDir, { recursive: true });

const docx = zip({
	"[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`,
	"_rels/.rels": `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
	"word/_rels/document.xml.rels": `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`,
	"word/styles.xml": `<?xml version="1.0" encoding="UTF-8"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults/><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
</w:styles>`,
	"word/document.xml": `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t>季度报告</w:t></w:r></w:p>
<w:p><w:r><w:t>收入同比增长 18%，主要来自</w:t></w:r><w:r><w:t>企业客户</w:t></w:r></w:p>
<w:p><w:r><w:t>下周重点：交付验收</w:t></w:r></w:p>
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
</w:body></w:document>`,
});
writeFileSync(join(outDir, "报告.docx"), docx);

const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(
	workbook,
	XLSX.utils.aoa_to_sheet([
		["项目", "金额"],
		["服务器", 12800],
		["合计", 12800],
	]),
	"预算",
);
writeFileSync(join(outDir, "预算.xlsx"), XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }));

const pptx = zip({
	"[Content_Types].xml": `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`,
	"ppt/slides/slide1.xml": `<?xml version="1.0"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<p:cSld><p:spTree><p:sp><p:txBody>
<a:p><a:r><a:t>2026 产品路线</a:t></a:r></a:p>
<a:p><a:r><a:t>三个季度的交付节奏</a:t></a:r></a:p>
</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
	"ppt/slides/slide2.xml": `<?xml version="1.0"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<p:cSld><p:spTree><p:sp><p:txBody>
<a:p><a:r><a:t>风险与依赖</a:t></a:r></a:p>
</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
});
writeFileSync(join(outDir, "演示.pptx"), pptx);

writeFileSync(
	join(outDir, "样本.md"),
	"# 预览样本\n\n- 列表项\n- **加粗**\n\n| 列 | 值 |\n| --- | --- |\n| a | 1 |\n",
);

// A one-pixel image and a hand-written PDF: enough for the two viewers the panel hands off.
writeFileSync(
	join(outDir, "像素.png"),
	Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
		"base64",
	),
);

const content = "BT /F1 16 Tf 24 60 Td (pi-web preview) Tj ET";
const pdf = [
	"%PDF-1.4",
	"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
	"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
	"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 240 120]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj",
	`4 0 obj<</Length ${content.length}>>stream\n${content}\nendstream endobj`,
	"5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj",
	"trailer<</Root 1 0 R/Size 6>>",
	"%%EOF",
	"",
].join("\n");
writeFileSync(join(outDir, "样本.pdf"), pdf);

console.log(`fixtures written to ${outDir}`);
