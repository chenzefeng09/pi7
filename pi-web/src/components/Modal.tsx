import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

/**
 * Which dialogs are open, oldest first. Only the top one answers Escape, so a dialog stacked on
 * another (the provider editor over the settings panel) closes alone instead of taking its parent
 * down with it.
 */
const openModals: symbol[] = [];

/**
 * Modal shell with enter and exit animations. Dialogs stay mounted while leaving so the panel
 * can fade/scale out instead of disappearing in one frame; render the dialog itself
 * unconditionally and drive it with `open`.
 *
 * The animations are CSS keyframes (see `.modal-*` in styles.css) instead of transitions: a
 * transition needs one extra painted frame before the visible state is applied, and a window
 * that is not producing frames never delivers it, which leaves the dialog invisible.
 */
export function Modal({
	children,
	className,
	layer = "base",
	onClose,
	open,
}: {
	children: ReactNode;
	className?: string;
	/** `stacked` sits on top of another modal and dims it further. */
	layer?: "base" | "stacked";
	onClose: () => void;
	open: boolean;
}) {
	const [rendered, setRendered] = useState(open);
	const [closing, setClosing] = useState(!open);
	const [content, setContent] = useState(children);
	const id = useRef(Symbol("modal"));

	// Latch the latest content so the dialog keeps its last look while leaving. Kept apart from
	// the open/close effect so parent re-renders cannot interfere with the animation state.
	useEffect(() => {
		if (open) setContent(children);
	}, [children, open]);

	useEffect(() => {
		if (open) {
			setRendered(true);
			setClosing(false);
			return;
		}
		setClosing(true);
		const timer = window.setTimeout(() => setRendered(false), 200);
		return () => window.clearTimeout(timer);
	}, [open]);

	useEffect(() => {
		if (!open) return;
		const key = id.current;
		openModals.push(key);
		return () => {
			const at = openModals.indexOf(key);
			if (at >= 0) openModals.splice(at, 1);
		};
	}, [open]);

	useEffect(() => {
		if (!open) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			if (openModals[openModals.length - 1] !== id.current) return;
			onClose();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [onClose, open]);

	if (!rendered) return null;
	return (
		<div
			className={`fixed inset-0 flex items-center justify-center px-4 ${
				layer === "stacked" ? "z-[60] bg-black/30" : "z-50 bg-black/20"
			} ${closing ? "modal-overlay-exit" : "modal-overlay-enter"}`}
			onClick={onClose}
			role="presentation"
		>
			<div
				className={`${className ?? ""} ${closing ? "modal-panel-exit" : "modal-panel-enter"}`}
				onClick={(event) => event.stopPropagation()}
				role="dialog"
			>
				{content}
			</div>
		</div>
	);
}
