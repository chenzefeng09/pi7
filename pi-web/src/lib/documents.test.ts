import { describe, expect, it } from "vitest";
import { classifyFileKind, isBinaryKind } from "./documents";

describe("file preview classification", () => {
	it("routes modern Office documents to their specialized previewers", () => {
		expect(classifyFileKind("report.docx")).toBe("word");
		expect(classifyFileKind("budget.xlsx")).toBe("excel");
		expect(classifyFileKind("legacy.xls")).toBe("excel");
		expect(classifyFileKind("slides.pptx")).toBe("ppt");
	});

	it("recognizes archive containers as binary previews", () => {
		for (const file of ["bundle.zip", "backup.tar.gz", "logs.7z", "image.iso", "archive.rar"]) {
			const kind = classifyFileKind(file);
			expect(kind).toBe("archive");
			expect(isBinaryKind(kind)).toBe(true);
		}
	});
});
