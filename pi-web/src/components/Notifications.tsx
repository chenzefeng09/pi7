import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { usePiStore } from "../state/store";
import type { ExtensionUiNotification } from "../state/types";
import { Presence } from "./Presence";

const TIMEOUTS: Record<string, number> = { error: 8000, info: 4000, warning: 6000 };

function Toast({
	notification,
	onDismiss,
}: {
	notification: ExtensionUiNotification;
	onDismiss: () => void;
}) {
	const [hovered, setHovered] = useState(false);
	const type = notification.type ?? "info";
	const tone =
		type === "error"
			? "border-[#f0c9c9] bg-[#fff5f5]/95 text-[#b42318]"
			: type === "warning"
				? "border-[#f5d0a9] bg-[#fffaf0]/95 text-[#b54708]"
				: "border-black/[0.06] bg-white/95 text-[#1f2937]";

	// Auto-dismiss, but hold while the pointer rests on the toast so it can be read.
	useEffect(() => {
		if (hovered) return;
		const timer = window.setTimeout(onDismiss, TIMEOUTS[type] ?? 4000);
		return () => window.clearTimeout(timer);
	}, [hovered, onDismiss, type]);

	return (
		<Presence open>
			<div
				className={`group pointer-events-auto flex items-start gap-2 rounded-xl border px-3 py-2 shadow-[0_12px_40px_rgba(15,23,42,0.16),0_2px_8px_rgba(15,23,42,0.06)] backdrop-blur-xl ${tone}`}
				onClick={onDismiss}
				onMouseEnter={() => setHovered(true)}
				onMouseLeave={() => setHovered(false)}
				role="presentation"
			>
				<span className="min-w-0 flex-1 text-[13px] leading-5">{notification.message}</span>
				<button
					className="-mr-0.5 -mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md opacity-0 transition-opacity hover:bg-black/[0.06] group-hover:opacity-100"
					onClick={(event) => {
						event.stopPropagation();
						onDismiss();
					}}
					title="关闭"
					type="button"
				>
					<X size={13} />
				</button>
			</div>
		</Presence>
	);
}

export function Notifications() {
	const notifications = usePiStore((state) => state.extensionUiNotifications);
	const dismiss = usePiStore((state) => state.dismissNotification);
	if (notifications.length === 0) return null;
	return (
		<div className="pointer-events-none fixed right-4 top-4 z-40 flex w-[320px] flex-col gap-2">
			{notifications.slice(-4).map((notification) => (
				<Toast
					key={notification.id}
					notification={notification}
					onDismiss={() => dismiss(notification.id)}
				/>
			))}
		</div>
	);
}
