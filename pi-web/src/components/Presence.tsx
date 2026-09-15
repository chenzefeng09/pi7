import { cloneElement, useEffect, useState } from "react";
import type { ReactElement, ReactNode } from "react";

export type PresencePhase = "closed" | "open";

interface PresenceProps {
	/** Single element child (gets the animation class) or a render prop receiving the phase. */
	children: ReactElement<{ className?: string }> | ((props: { phase: PresencePhase }) => ReactNode);
	open: boolean;
}

/** Overlay behind a popover: fades with the panel and stops clicks while the popover leaves. */
export function popoverOverlayClass(phase: PresencePhase): string {
	return `fixed inset-0 z-30 ${phase === "closed" ? "popover-overlay-exit" : "popover-overlay-enter"}`;
}

/** Panel class for the render-prop form. */
export function popoverPanelClass(phase: PresencePhase): string {
	return phase === "closed" ? "popup-exit" : "popup-enter";
}

/**
 * Keeps a popover mounted while it animates out. Menus that render an overlay plus a panel
 * use the render-prop form and apply `popoverOverlayClass` / `popoverPanelClass` per element.
 * Both are CSS keyframes, so nothing depends on requestAnimationFrame firing.
 */
export function Presence({ children, open }: PresenceProps) {
	const [rendered, setRendered] = useState(open);
	const [phase, setPhase] = useState<PresencePhase>(open ? "open" : "closed");
	// Wrapped in an arrow: a render-prop child is a function, and `useState(fn)` would call it
	// as a lazy initializer instead of storing it.
	const [content, setContent] = useState<PresenceProps["children"]>(() => children);

	// Latch the latest children so the popover keeps its last look while leaving.
	useEffect(() => {
		if (open) setContent(() => children as PresenceProps["children"]);
	}, [children, open]);

	useEffect(() => {
		if (open) {
			setRendered(true);
			setPhase("open");
			return;
		}
		setPhase("closed");
		const timer = window.setTimeout(() => setRendered(false), 150);
		return () => window.clearTimeout(timer);
	}, [open]);

	if (!rendered) return null;
	if (typeof content === "function") return <>{content({ phase })}</>;
	return cloneElement(content, {
		className: `${content.props.className ?? ""} ${popoverPanelClass(phase)}`.trim(),
	});
}
