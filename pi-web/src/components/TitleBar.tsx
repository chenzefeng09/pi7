import { Copy, Minus, PanelLeft, Square, X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { usePiStore } from "../state/store";
import { useUiStore } from "../state/ui";
import { MENU_ITEM_CLASS, MENU_LABEL_CLASS, MENU_PANEL_CLASS, MENU_SEPARATOR_CLASS, MENU_SHORTCUT_CLASS } from "./Menu";
import { Presence } from "./Presence";

interface MenuEntry {
	label: string;
	onSelect?: () => void;
	shortcut?: string;
	separator?: boolean;
}

function MenuButton({ entries, label }: { entries: MenuEntry[]; label: string }) {
	const [open, setOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!open) return;
		const closeOnPointerDown = (event: MouseEvent) => {
			if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
		};
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpen(false);
		};
		document.addEventListener("mousedown", closeOnPointerDown);
		document.addEventListener("keydown", closeOnEscape);
		return () => {
			document.removeEventListener("mousedown", closeOnPointerDown);
			document.removeEventListener("keydown", closeOnEscape);
		};
	}, [open]);

	return (
		<div className="relative" ref={rootRef}>
			<button
				className={`h-7 rounded-md px-2.5 text-[14px] transition-colors ${
					open ? "bg-black/[0.07] text-[#1f2937]" : "text-[#3f4a43] hover:bg-black/[0.05]"
				}`}
				onClick={() => setOpen((value) => !value)}
				type="button"
			>
				{label}
			</button>
			<Presence open={open}>
				<div className={`${MENU_PANEL_CLASS} left-0 top-[30px]`}>
					{entries.map((entry, index) =>
						entry.separator ? (
							<div className={MENU_SEPARATOR_CLASS} key={`sep-${index}`} />
						) : (
							<button
								className={MENU_ITEM_CLASS}
								key={entry.label}
								onClick={() => {
									setOpen(false);
									entry.onSelect?.();
								}}
								type="button"
							>
								<span className={MENU_LABEL_CLASS}>{entry.label}</span>
								{entry.shortcut ? (
									<span className={MENU_SHORTCUT_CLASS}>{entry.shortcut}</span>
								) : null}
							</button>
						),
					)}
				</div>
			</Presence>
		</div>
	);
}

function WindowButton({
	children,
	onClick,
	title,
	wide,
	danger,
}: {
	children: ReactNode;
	onClick: () => void;
	title: string;
	wide?: boolean;
	danger?: boolean;
}) {
	return (
		<button
			className={`flex h-7 items-center justify-center rounded-md text-[#4b5563] transition-colors ${
				wide ? "w-9" : "w-7"
			} ${danger ? "hover:bg-[#e81123] hover:text-white" : "hover:bg-black/[0.06]"}`}
			onClick={onClick}
			title={title}
			type="button"
		>
			{children}
		</button>
	);
}

export function TitleBar() {
	const [maximized, setMaximized] = useState(false);
	const newSession = usePiStore((state) => state.newSession);
	const sidebarCollapsed = useUiStore((state) => state.sidebarCollapsed);
	const setAboutOpen = useUiStore((state) => state.setAboutOpen);
	const setProjectDialogOpen = useUiStore((state) => state.setProjectDialogOpen);
	const setSettingsOpen = useUiStore((state) => state.setSettingsOpen);
	const setSidebarCollapsed = useUiStore((state) => state.setSidebarCollapsed);
	const setView = useUiStore((state) => state.setView);

	useEffect(() => {
		let disposed = false;
		void window.pi.isWindowMaximized().then((value) => {
			if (!disposed) setMaximized(value);
		});
		const off = window.pi.onWindowMaximized(setMaximized);
		return () => {
			disposed = true;
			off();
		};
	}, []);

	const desktop = (action: string) => () => void window.pi.desktopAction(action);

	const menus: Array<{ entries: MenuEntry[]; label: string }> = [
		{
			entries: [
				{
					label: "新对话",
					onSelect: () => {
						setView("chat");
						void newSession();
					},
					shortcut: "Ctrl+N",
				},
				{
					label: "添加项目…",
					onSelect: () => setProjectDialogOpen(true),
				},
				{ separator: true, label: "sep-1" },
				{ label: "退出", onSelect: desktop("app-quit") },
			],
			label: "文件",
		},
		{
			entries: [
				{ label: "撤销", onSelect: desktop("edit-undo"), shortcut: "Ctrl+Z" },
				{ label: "重做", onSelect: desktop("edit-redo"), shortcut: "Ctrl+Y" },
				{ separator: true, label: "sep-2" },
				{ label: "剪切", onSelect: desktop("edit-cut"), shortcut: "Ctrl+X" },
				{ label: "复制", onSelect: desktop("edit-copy"), shortcut: "Ctrl+C" },
				{ label: "粘贴", onSelect: desktop("edit-paste"), shortcut: "Ctrl+V" },
				{ label: "删除", onSelect: desktop("edit-delete") },
				{ separator: true, label: "sep-2b" },
				{ label: "全选", onSelect: desktop("edit-select-all"), shortcut: "Ctrl+A" },
			],
			label: "编辑",
		},
		{
			entries: [
				{
					label: sidebarCollapsed ? "展开侧栏" : "收起侧栏",
					onSelect: () => setSidebarCollapsed(!sidebarCollapsed),
				},
				{ separator: true, label: "sep-view" },
				{ label: "重新加载", onSelect: desktop("view-reload") },
				{ label: "强制重新加载", onSelect: desktop("view-force-reload") },
				{ separator: true, label: "sep-3" },
				{ label: "实际大小", onSelect: desktop("view-zoom-reset"), shortcut: "Ctrl+0" },
				{ label: "放大", onSelect: desktop("view-zoom-in"), shortcut: "Ctrl+=" },
				{ label: "缩小", onSelect: desktop("view-zoom-out"), shortcut: "Ctrl+-" },
				{ separator: true, label: "sep-4" },
				{ label: "全屏", onSelect: desktop("view-fullscreen"), shortcut: "F11" },
			],
			label: "视图",
		},
		{
			entries: [
				{ label: "设置", onSelect: () => setSettingsOpen(true), shortcut: "Ctrl+," },
				{ separator: true, label: "sep-more" },
				{ label: "关于 π7", onSelect: () => setAboutOpen(true) },
			],
			label: "更多",
		},
	];

	return (
		<div className="flex h-9 shrink-0 select-none items-center gap-1 px-2">
			<button
				className="flex h-7 w-7 items-center justify-center rounded-md text-[#4b5563] transition-colors hover:bg-black/[0.06]"
				onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
				title={sidebarCollapsed ? "展开侧栏" : "收起侧栏"}
				type="button"
			>
				<PanelLeft size={15} />
			</button>
			<div className="flex items-center gap-0.5">
				{menus.map((menu) => (
					<MenuButton entries={menu.entries} key={menu.label} label={menu.label} />
				))}
			</div>
			<div className="h-full min-w-8 flex-1 [-webkit-app-region:drag]" />
			<div className="flex items-center gap-0.5">
				<WindowButton onClick={() => void window.pi.windowControl("minimize")} title="最小化">
					<Minus size={14} />
				</WindowButton>
				<WindowButton
					onClick={() => {
						void window.pi.windowControl("toggle-maximize").then(setMaximized);
					}}
					title={maximized ? "向下还原" : "最大化"}
				>
					{maximized ? <Copy size={11} /> : <Square size={11} />}
				</WindowButton>
				<WindowButton danger onClick={() => void window.pi.windowControl("close")} title="关闭" wide>
					<X size={14} />
				</WindowButton>
			</div>
		</div>
	);
}
