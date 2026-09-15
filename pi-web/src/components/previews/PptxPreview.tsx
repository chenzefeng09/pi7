import { useEffect, useRef, useState } from "react";
import { PPTXViewer } from "pptx-viewer";

/** Visual PPTX renderer. The library runs entirely in the renderer process. */
export function PptxPreview({ blob }: { blob: Blob }): JSX.Element {
	const containerRef = useRef<HTMLDivElement>(null);
	const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
	const [error, setError] = useState<string>();

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		let cancelled = false;
		let viewer: PPTXViewer | undefined;
		container.replaceChildren();
		setStatus("loading");
		setError(undefined);
		void (async () => {
				viewer = new PPTXViewer(container, { keyboardNavigation: true, showControls: true });
				await viewer.load(await blob.arrayBuffer());
				if (!cancelled) setStatus("ready");
			})()
			.catch((reason: unknown) => {
				if (!cancelled) {
					setError(reason instanceof Error ? reason.message : "无法渲染 PPTX");
					setStatus("error");
				}
			});
		return () => {
			cancelled = true;
			viewer?.destroy();
			container.replaceChildren();
		};
	}, [blob]);

	return (
		<section className="overflow-hidden rounded-lg border border-black/[0.06] bg-[#f7f7f8]">
			<div className="border-b border-black/[0.06] px-4 py-2 text-[12px] font-medium text-[#667085]">演示文稿预览</div>
			{status === "loading" ? <div className="p-4 text-[12px] text-[#98a2b3]">渲染演示文稿...</div> : null}
			{status === "error" ? <div className="p-4 text-[12px] text-[#f04438]">PPTX 解析失败：{error}</div> : null}
			<div
				className="max-h-[calc(100vh-170px)] overflow-auto bg-[#e7e9ec] p-3"
				ref={containerRef}
				style={{ display: status === "ready" ? undefined : "none" }}
			/>
		</section>
	);
}

export default PptxPreview;
