import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePiStore } from "../state/store";
import type { ModelInfo } from "../state/types";
import { clampThinkingLevel } from "../lib/thinking";
import { Presence } from "./Presence";

function modelName(model: ModelInfo | undefined, modelId: string | undefined): string {
	if (!model) return modelId ?? "选择模型";
	return model.name ?? model.id;
}

function compactModelName(model: ModelInfo | undefined, modelId: string | undefined): string {
	const name = modelName(model, modelId);
	const compact = name.replace(/\s+\([^)]*\)/g, "").replace(/\s+\[[^\]]*\]/g, "").trim();
	return compact || name;
}

function thinkingLevelLabel(value: string): string {
	const labels: Record<string, string> = {
		off: "关闭",
		minimal: "最低",
		low: "低",
		medium: "中",
		high: "高",
		xhigh: "极高",
		max: "最高",
	};
	return labels[value] ?? (value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value);
}

function LevelSlider({
	disabled,
	index,
	levels,
	onChange,
}: {
	disabled: boolean;
	index: number;
	levels: string[];
	onChange: (index: number) => void;
}) {
	const trackRef = useRef<HTMLDivElement | null>(null);
	const count = Math.max(1, levels.length - 1);
	const ratio = levels.length <= 1 ? 0 : index / count;
	// The thumb's centre can travel only between its radius and the opposite radius. Keep this
	// geometry shared by the ticks, fill edge, thumb and pointer mapping so every visual marker lands
	// on the same selectable value.
	const thumbRadius = 13;
	const position = (value: number): string =>
		`calc(${thumbRadius}px + ${value * 100}% - ${value * thumbRadius * 2}px)`;

	const setFromClientX = (clientX: number) => {
		const track = trackRef.current;
		if (!track || disabled) return;
		const rect = track.getBoundingClientRect();
		const travel = Math.max(1, rect.width - thumbRadius * 2);
		const value = Math.min(1, Math.max(0, (clientX - rect.left - thumbRadius) / travel));
		onChange(Math.round(value * count));
	};

	return (
		<div className="px-[15px]">
			<div
				className={`relative h-[24px] w-full rounded-full ${disabled ? "opacity-40" : "cursor-pointer"}`}
				onPointerDown={(event) => {
					if (disabled) return;
					event.currentTarget.setPointerCapture(event.pointerId);
					setFromClientX(event.clientX);
				}}
				onPointerMove={(event) => {
					if (disabled || (event.buttons & 1) !== 1) return;
					setFromClientX(event.clientX);
				}}
				ref={trackRef}
				style={{
					background: `linear-gradient(to right, #2f7df6 0, #2f7df6 ${position(ratio)}, #e5e7eb ${position(ratio)}, #e5e7eb 100%)`,
				}}
				role="slider"
				aria-valuemax={count}
				aria-valuemin={0}
				aria-valuenow={index}
				tabIndex={disabled ? -1 : 0}
				onKeyDown={(event) => {
					if (disabled) return;
					if (event.key === "ArrowLeft") onChange(Math.max(0, index - 1));
					if (event.key === "ArrowRight") onChange(Math.min(count, index + 1));
				}}
			>
				{levels.map((level, tick) => {
					if (levels.length <= 1) return null;
					const tickRatio = tick / count;
					return (
						<span
							className="absolute top-1/2 h-[4px] w-[4px] -translate-x-1/2 -translate-y-1/2 rounded-full"
							key={level}
							style={{
								backgroundColor: tick <= index ? "rgba(255, 255, 255, 0.45)" : "#aeb4bd",
								left: position(tickRatio),
							}}
						/>
					);
				})}
				<span
					className="absolute top-1/2 h-[26px] w-[26px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_1px_6px_rgba(15,23,42,0.24)]"
					style={{ left: position(ratio) }}
				/>
			</div>
		</div>
	);
}

export function ModelSelector() {
	const [menu, setMenu] = useState<"level" | "model" | null>(null);
	const rootRef = useRef<HTMLDivElement | null>(null);
	const availableThinkingLevels = usePiStore((state) => state.availableThinkingLevels);
	const model = usePiStore((state) => state.model);
	const models = usePiStore((state) => state.models);
	const setModel = usePiStore((state) => state.setModel);
	const setThinkingLevel = usePiStore((state) => state.setThinkingLevel);
	const thinkingLevel = usePiStore((state) => state.thinkingLevel);
	const currentModel = useMemo(() => models.find((item) => item.id === model), [model, models]);
	const selectedModelName = compactModelName(currentModel, model);
	const selectedThinkingLevel = thinkingLevelLabel(thinkingLevel ?? "");
	// The session may carry a level the current model does not take (it was set for another one);
	// pi runs the nearest level the model does support, so the slider sits on that instead of
	// falling to the weakest entry.
	const effectiveThinkingLevel = clampThinkingLevel(availableThinkingLevels, thinkingLevel ?? "");
	const thinkingLevelIndex = Math.max(0, availableThinkingLevels.indexOf(effectiveThinkingLevel));
	const hasLevels = availableThinkingLevels.length > 0;
	// Strength is the home page of the menu; a model without levels only offers the model list.
	const view: "level" | "model" | null =
		menu === null ? null : menu === "level" && hasLevels ? "level" : "model";

	useEffect(() => {
		if (!menu) return;
		const closeOnPointerDown = (event: MouseEvent) => {
			if (!rootRef.current?.contains(event.target as Node)) setMenu(null);
		};
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") setMenu(null);
		};
		document.addEventListener("mousedown", closeOnPointerDown);
		document.addEventListener("keydown", closeOnEscape);
		return () => {
			document.removeEventListener("mousedown", closeOnPointerDown);
			document.removeEventListener("keydown", closeOnEscape);
		};
	}, [menu]);

	return (
		<div className="relative" ref={rootRef}>
			<button
				className={`flex h-8 max-w-[260px] items-center gap-1.5 rounded-full pl-2.5 pr-2 text-[13px] transition-colors ${
					menu ? "bg-transparent hover:bg-transparent" : "bg-black/[0.05] hover:bg-black/[0.08]"
				}`}
				onClick={() => setMenu((current) => (current ? null : hasLevels ? "level" : "model"))}
				title="选择模型和强度"
				type="button"
			>
				<span className="min-w-0 truncate text-[#1f2937]">{selectedModelName}</span>
				{hasLevels ? <span className="shrink-0 text-[#8b95a1]">{selectedThinkingLevel}</span> : null}
				<ChevronDown className="shrink-0 text-[#8b95a1]" size={14} />
			</button>
			<Presence open={view === "level"}>
				<div className="popup-fade absolute bottom-[calc(100%+8px)] right-0 z-50 w-[260px] rounded-[18px] border border-black/[0.06] bg-white pb-4 pt-4 shadow-[0_14px_38px_rgba(15,23,42,0.14)]">
					<button
					className="mx-auto flex w-fit flex-col items-center rounded-xl px-2.5 py-1 transition-colors hover:bg-black/[0.05]"
						onClick={() => setMenu("model")}
						title="选择模型"
						type="button"
					>
						<span className="flex items-center gap-0.5 text-[13px] font-semibold text-[#2f7df6]">
							{selectedThinkingLevel || "默认"}
							<ChevronRight className="text-[#8b95a1]" size={13} />
						</span>
						<span className="max-w-[190px] truncate text-[11px] text-[#8b95a1]">{selectedModelName}</span>
					</button>
					<div className="mt-4">
						<LevelSlider
							disabled={availableThinkingLevels.length <= 1}
							index={thinkingLevelIndex}
							levels={availableThinkingLevels}
							onChange={(next) => {
								const level = availableThinkingLevels[next];
								if (level) void setThinkingLevel(level);
							}}
						/>
					</div>
				</div>
			</Presence>
			<Presence open={view === "model"}>
				<div className="popup-fade absolute bottom-[calc(100%+8px)] right-0 z-50 w-[260px] overflow-hidden rounded-[16px] border border-black/[0.06] bg-white p-1 shadow-[0_14px_38px_rgba(15,23,42,0.14)]">
					<div className="px-2.5 pb-0.5 pt-1.5 text-[11px] text-[#98a2b3]">选择模型</div>
					<div className="scrollbar-subtle max-h-[280px] overflow-y-auto">
						{models.map((item) => {
							const selected = item.id === model;
							return (
								<button
									className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left leading-4 ${
										selected ? "bg-black/[0.05]" : "hover:bg-black/[0.04]"
									}`}
									key={`${item.provider}:${item.id}`}
									onClick={() => {
										void setModel(item.provider, item.id);
										setMenu("level");
									}}
									title={`${item.name ?? item.id} (${item.provider}/${item.id})`}
									type="button"
								>
									<span className="min-w-0 flex-1 truncate text-[12px] text-[#1f2937]">
										{item.name ?? item.id}
									</span>
									{selected ? <Check className="shrink-0 text-[#1f2937]" size={13} /> : null}
								</button>
							);
						})}
						{models.length === 0 ? (
							<div className="px-2.5 py-4 text-center text-[11px] text-[#8b95a1]">未找到模型</div>
						) : null}
					</div>
				</div>
			</Presence>
		</div>
	);
}
