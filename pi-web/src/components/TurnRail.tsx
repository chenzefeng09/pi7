import { useEffect, useRef, useState } from "react";
import { t } from "../i18n";

/** One exchange on the rail: the prompt that started it and the answer it got. */
export interface RailMark {
	index: number;
	/** False for a turn the virtualizer has not measured yet; its mark reads lighter and shorter. */
	loaded: boolean;
	prompt: string;
	response: string;
}

/** Fixed pitch between neighbouring marks, the harness TurnNavigator's geometry. */
const PITCH = 10;
/** Rail padding above the first mark and below the last one. */
const INSET = 6;
/** Fade band the mask reserves at a scrollable end. */
const FADE = 24;
/** The rail never grows past this, however long the conversation is. */
const MAX_HEIGHT = 420;

/** Mark under a pointer, from its distance to the rail's top. */
function markAtPointer(marks: RailMark[], scroller: HTMLDivElement, clientY: number): RailMark | undefined {
	const offset = clientY - scroller.getBoundingClientRect().top + scroller.scrollTop - INSET;
	const position = Math.max(0, Math.min(marks.length - 1, Math.round(offset / PITCH)));
	return marks[position];
}

/**
 * Turn rail on the right edge: one mark every ten pixels, the harness quick-locate.
 *
 * Marks are a fixed pitch rather than a scale drawing of the transcript, so the strip stays a
 * compact list; when it outgrows its frame it scrolls, follows the turn in view and fades at the
 * ends that can move. Pointing anywhere on the rail previews the nearest exchange and clicking it
 * jumps there.
 */
export function TurnRail({
	activeIndex,
	bandHeight,
	busyIndex,
	marks,
	onNavigate,
}: {
	activeIndex: number;
	bandHeight: number;
	busyIndex?: number;
	marks: RailMark[];
	onNavigate: (index: number) => void;
}) {
	const [previewIndex, setPreviewIndex] = useState<number | null>(null);
	const [canScroll, setCanScroll] = useState({ down: false, up: false });
	const scrollerRef = useRef<HTMLDivElement | null>(null);
	/** While the pointer works the rail, the follow step must not move it under the hand. */
	const pointerInside = useRef(false);

	const naturalHeight = (marks.length - 1) * PITCH + 2 * INSET;
	const height = Math.max(40, Math.min(naturalHeight, Math.max(0, bandHeight - 64), MAX_HEIGHT));
	const preview = previewIndex === null ? undefined : marks.find((mark) => mark.index === previewIndex);
	const previewPosition = preview ? marks.indexOf(preview) : -1;

	const readScroll = () => {
		const scroller = scrollerRef.current;
		if (!scroller) return;
		const up = scroller.scrollTop > 1;
		const down = scroller.scrollTop < scroller.scrollHeight - scroller.clientHeight - 1;
		setCanScroll((current) => (current.up === up && current.down === down ? current : { down, up }));
	};

	useEffect(readScroll, [marks.length]);

	// Keep the mark of the turn in view inside the rail, the way a scrollbar follows its content.
	useEffect(() => {
		const scroller = scrollerRef.current;
		const position = marks.findIndex((mark) => mark.index === activeIndex);
		if (!scroller || position < 0 || pointerInside.current) return;
		const markTop = position * PITCH + INSET;
		const viewTop = scroller.scrollTop;
		const viewHeight = scroller.clientHeight;
		if (viewHeight <= 0) return;
		if (markTop >= viewTop + FADE && markTop <= viewTop + viewHeight - FADE) return;
		scroller.scrollTo({ behavior: "smooth", top: Math.max(0, markTop - viewHeight / 2) });
	}, [activeIndex, marks]);

	if (marks.length < 2) return null;

	return (
		<nav
			aria-label={t("按轮次快速定位")}
			className="group absolute right-3 z-20 w-7 cursor-pointer"
			onClick={(event) => {
				const scroller = scrollerRef.current;
				if (!scroller) return;
				const mark = markAtPointer(marks, scroller, event.clientY);
				if (mark) onNavigate(mark.index);
			}}
			onPointerEnter={() => {
				pointerInside.current = true;
			}}
			onPointerLeave={() => {
				pointerInside.current = false;
				setPreviewIndex(null);
			}}
			onPointerMove={(event) => {
				const scroller = scrollerRef.current;
				if (!scroller) return;
				const mark = markAtPointer(marks, scroller, event.clientY);
				setPreviewIndex(mark ? mark.index : null);
			}}
			style={{ height, top: 6 + Math.max(0, bandHeight - height) / 2 }}
		>
			<div
				className="relative h-full overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
				onScroll={readScroll}
				ref={scrollerRef}
				style={{
					// Ends that can move fade out, so the strip reads as continuing past the frame.
					maskImage: `linear-gradient(#0000 0, #000 ${canScroll.up ? FADE : 0}px calc(100% - ${canScroll.down ? FADE : 0}px), #0000 100%)`,
					WebkitMaskImage: `linear-gradient(#0000 0, #000 ${canScroll.up ? FADE : 0}px calc(100% - ${canScroll.down ? FADE : 0}px), #0000 100%)`,
				}}
			>
				<div className="relative" style={{ height: naturalHeight }}>
					{marks.map((mark, position) => {
						const active = mark.index === activeIndex;
						const shown = mark.index === previewIndex;
						const busy = mark.index === busyIndex;
						return (
							<div
								className="absolute left-0 right-0 h-[10px] -translate-y-1/2"
								key={mark.index}
								style={{ top: position * PITCH + INSET }}
							>
								<button
									aria-current={active ? "true" : undefined}
									aria-label={mark.prompt || t("第 {arg} 轮", { "arg": position + 1 })}
									className="absolute inset-y-0 right-0 w-5 rounded-lg"
									onClick={(event) => {
										event.stopPropagation();
										onNavigate(mark.index);
									}}
									onBlur={() => setPreviewIndex(null)}
									onFocus={() => setPreviewIndex(mark.index)}
									title={mark.prompt}
									type="button"
								>
									<span
										className={`absolute right-0 top-1/2 h-[2px] -translate-y-1/2 rounded-sm transition-all duration-150 ${
											busy
												? "w-3 animate-pulse bg-black/[0.12]"
												: active
													? "w-5 bg-[#1f2937]"
													: shown
														? "w-[18px] bg-[#98a2b3]"
														: mark.loaded
															? "w-3 bg-black/[0.12]"
															: "w-2 bg-black/[0.12] opacity-60"
										}`}
									/>
								</button>
							</div>
						);
					})}
				</div>
			</div>
			{preview ? (
				<div
					className="pointer-events-none absolute right-[calc(100%+10px)] w-[300px] max-w-[70vw] rounded-[10px] bg-white px-3 py-2.5 shadow-[0_10px_30px_rgba(15,23,42,0.18)]"
					role="tooltip"
					style={{
						top: `clamp(0px, ${previewPosition * PITCH + INSET - (scrollerRef.current?.scrollTop ?? 0) - 50}px, calc(100% - 100px))`,
					}}
				>
					{preview.prompt ? (
						<div className="line-clamp-1 text-[13px] font-semibold text-[#111827]">{preview.prompt}</div>
					) : null}
					{preview.response ? (
						<div className="mt-1 line-clamp-3 text-[12px] leading-5 text-[#adb2b8]">{preview.response}</div>
					) : null}
				</div>
			) : null}
		</nav>
	);
}
