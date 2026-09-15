import { Check, Copy } from "lucide-react";
import { type MouseEvent as ReactMouseEvent, useEffect, useState } from "react";
import { createPortal } from "react-dom";

/** Where the menu was opened, in viewport coordinates. */
interface MenuAt {
	x: number;
	y: number;
}

/**
 * Right-click menu for an image: the one action a preview needs.
 *
 * The write goes through the main process because the renderer's clipboard API only works in a
 * secure context, and a packaged app loads its page over `file://`.
 */
export function ImageMenu({ at, onClose, src }: { at: MenuAt; onClose: () => void; src: string }) {
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		const dismiss = () => onClose();
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		window.addEventListener("mousedown", dismiss);
		window.addEventListener("keydown", onKeyDown);
		return () => {
			window.removeEventListener("mousedown", dismiss);
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [onClose]);

	// Keep the panel inside the window when the click lands near an edge.
	const left = Math.max(4, Math.min(at.x, window.innerWidth - 172));
	const top = Math.max(4, Math.min(at.y, window.innerHeight - 52));

	return createPortal(
		<div
			className="fixed z-[1100] w-[168px] overflow-hidden rounded-xl border border-black/[0.08] bg-white p-1 shadow-[0_14px_38px_rgba(15,23,42,0.18)]"
			onMouseDown={(event) => event.stopPropagation()}
			style={{ left, top }}
		>
			<button
				className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-[#1f2937] transition-colors hover:bg-black/[0.04]"
				onClick={() => {
					void window.pi
						.copyImage(src)
						.then((result) => {
							const copied = (result as { copied?: boolean } | undefined)?.copied === true;
							setCopied(copied);
							window.setTimeout(onClose, copied ? 420 : 0);
						})
						.catch(() => setCopied(false));
				}}
				type="button"
			>
				{copied ? <Check className="text-[#16a34a]" size={14} /> : <Copy size={14} />}
				{copied ? "已复制" : "复制图片"}
			</button>
		</div>,
		document.body,
	);
}

/**
 * Wire an `<img>` to that menu: hand `onContextMenu` to the element and render `menu` beside it.
 * `src` is the image the menu copies, which for a data URL is the same string the element uses.
 */
export function useImageMenu(src: string) {
	const [at, setAt] = useState<MenuAt | undefined>(undefined);
	return {
		menu: at ? <ImageMenu at={at} onClose={() => setAt(undefined)} src={src} /> : null,
		onContextMenu: (event: ReactMouseEvent) => {
			event.preventDefault();
			event.stopPropagation();
			setAt({ x: event.clientX, y: event.clientY });
		},
	};
}
