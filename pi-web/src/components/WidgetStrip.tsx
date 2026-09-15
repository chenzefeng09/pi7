import { usePiStore } from "../state/store";

export function WidgetStrip({ placement }: { placement: "aboveEditor" | "belowEditor" }) {
	const widgets = usePiStore((state) => state.extensionUiWidgets);
	const entries = Object.entries(widgets).filter(([, widget]) => widget.placement === placement);
	if (entries.length === 0) return null;
	return (
		<div className="border-t border-[#eef0f2] bg-white px-6 py-1 text-xs text-[#667085]">
			{entries.flatMap(([key, widget]) =>
				widget.lines.map((line, index) => (
					<div className="whitespace-pre-wrap" key={`${key}-${index}`}>
						{line}
					</div>
				)),
			)}
		</div>
	);
}
