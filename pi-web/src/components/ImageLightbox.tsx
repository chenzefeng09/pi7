import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useImageMenu } from "./ImageMenu";

/**
 * Original-image preview, the harness's ImageLightbox: a full-viewport backdrop with a separate
 * mask layer (blurring the backdrop itself would blur the picture with it), the image fitted to the
 * viewport, and one close control in the corner.
 *
 * Rendered through a body portal because an opener inside a transformed or filtered ancestor would
 * otherwise trap the fixed backdrop inside that ancestor's box. Escape, a mask press, or the close
 * control dismisses it, and focus goes back to whatever opened it.
 */
export function ImageLightbox({ alt, onClose, src }: { alt: string; onClose: () => void; src: string }) {
	const closeRef = useRef<HTMLButtonElement | null>(null);
	const restoreRef = useRef<HTMLElement | null>(null);
	const imageMenu = useImageMenu(src);

	useEffect(() => {
		restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		closeRef.current?.focus();
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => {
			window.removeEventListener("keydown", onKeyDown);
			restoreRef.current?.focus();
		};
	}, [onClose]);

	return createPortal(
		<div
			aria-label="原图预览"
			aria-modal="true"
			className="fixed inset-0 z-[1000] grid place-items-center p-10"
			role="dialog"
		>
			<div
				aria-hidden="true"
				className="absolute inset-0 bg-black/45 backdrop-blur-sm"
				onMouseDown={onClose}
			/>
			<img
				alt={alt}
				className="relative max-h-[calc(100vh-80px)] max-w-[min(100%,1600px)] rounded-xl bg-white object-contain shadow-[0_24px_70px_rgba(15,23,42,0.35)]"
				onContextMenu={imageMenu.onContextMenu}
				src={src}
			/>
			{imageMenu.menu}
			<button
				aria-label="关闭原图预览"
				className="fixed right-5 top-5 z-10 grid h-9 w-9 place-items-center rounded-full border-[0.5px] border-black/10 bg-white text-[#1f2937] transition-colors hover:bg-black/[0.05]"
				onClick={onClose}
				ref={closeRef}
				type="button"
			>
				<X size={16} />
			</button>
		</div>,
		document.body,
	);
}
