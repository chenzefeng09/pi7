import { renderAsync } from "docx-preview";
import { useEffect, useRef, useState } from "react";

function revokeBlobUrls(container: HTMLElement): void {
	const urls = new Set<string>();
	container.querySelectorAll<HTMLElement>("[src^='blob:'], [href^='blob:'], [style*='blob:']").forEach((element) => {
		for (const match of element.outerHTML.matchAll(/blob:[^'" )]+/g)) urls.add(match[0]);
	});
	for (const url of urls) URL.revokeObjectURL(url);
}

/** Browser-side DOCX renderer. It keeps the document in memory and never writes a temporary file. */
export function DocxPreview({ blob }: { blob: Blob }): JSX.Element {
	const containerRef = useRef<HTMLDivElement>(null);
	const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
	const [error, setError] = useState<string>();

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		let cancelled = false;
		container.replaceChildren();
		setStatus("loading");
		setError(undefined);
		void renderAsync(blob, container, undefined, {
			className: "pi-docx",
			inWrapper: true,
			ignoreWidth: false,
			ignoreHeight: false,
		})
			.then(() => {
				if (!cancelled) setStatus("ready");
			})
			.catch((reason: unknown) => {
				if (!cancelled) {
					setError(reason instanceof Error ? reason.message : "无法渲染 DOCX 文档");
					setStatus("error");
				}
			});
		return () => {
			cancelled = true;
			revokeBlobUrls(container);
			container.replaceChildren();
		};
	}, [blob]);

	return (
		<section className="overflow-hidden rounded-lg border border-black/[0.06] bg-[#f7f7f8]">
			<div className="border-b border-black/[0.06] px-4 py-2 text-[12px] font-medium text-[#667085]">文档预览</div>
			{status === "loading" ? <div className="p-4 text-[12px] text-[#98a2b3]">渲染文档...</div> : null}
			{status === "error" ? <div className="p-4 text-[12px] text-[#f04438]">文档渲染失败：{error}</div> : null}
			<div
				className="max-h-[calc(100vh-170px)] overflow-auto bg-[#e7e9ec] px-3 py-3"
				ref={containerRef}
				style={{ display: status === "ready" ? undefined : "none" }}
			/>
		</section>
	);
}

export default DocxPreview;
