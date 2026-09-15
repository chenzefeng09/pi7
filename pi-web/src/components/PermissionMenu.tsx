import { Check, ChevronDown, Eye, ShieldAlert, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useBlankSession, usePiStore } from "../state/store";
import { type PermissionMode, useUiStore } from "../state/ui";
import { PermissionConfirmDialog } from "./PermissionConfirmDialog";

const MODES: Array<{ description: string; icon: typeof Eye; label: string; mode: PermissionMode }> = [
	{
		description: "只读工具可用，写入文件与执行命令会被拦截",
		icon: Eye,
		label: "仅可查看",
		mode: "read-only",
	},
	{
		description: "文件只能改工作区内；命令里出现工作区外的路径会被拦截",
		icon: ShieldCheck,
		label: "工作区内修改",
		mode: "workspace-write",
	},
	{
		description: "不拦截任何工具，pi 拥有当前用户的所有权限",
		icon: ShieldAlert,
		label: "完全权限",
		mode: "full",
	},
];

/** Tone per mode: the chip is the one place worth colouring, since it decides what the agent may do. */
const TONES: Record<PermissionMode, string> = {
	full: "text-[#f97316]",
	"read-only": "text-[#16a34a]",
	"workspace-write": "text-[#2f7df6]",
};

/**
 * Permission preset for this session, the composer's counterpart of the harness's selector.
 *
 * The choice is enforced by pi's `permission-gate` extension, which blocks tool calls; the app only
 * sends it the mode (`/permission <mode>`). Because that extension is a policy layer rather than a
 * sandbox, the menu says what each mode actually does instead of implying an OS boundary.
 *
 * The gate keeps its mode per pi session and starts unrestricted, so the remembered choice is
 * re-sent for every session the window shows. `lastSent` is the session file plus the mode that
 * was sent for it: a new chat keeps the same file path until pi names it, so keying on the path
 * alone would skip the re-send and leave the new session on the gate's default (完全权限).
 */
let lastSent: { key: string; mode: PermissionMode } | undefined;

export function PermissionMenu() {
	const permissionMode = useUiStore((state) => state.permissionMode);
	const setPermissionMode = useUiStore((state) => state.setPermissionMode);
	const applyPermissionMode = usePiStore((state) => state.applyPermissionMode);
	const sessionFile = usePiStore((state) => state.sessionFile);
	const sessionId = usePiStore((state) => state.sessionId);
	const sessionProject = usePiStore((state) => state.sessionProject);
	const blank = useBlankSession();
	const [open, setOpen] = useState(false);
	const [elevateOpen, setElevateOpen] = useState(false);
	const root = useRef<HTMLDivElement | null>(null);
	const active = MODES.find((entry) => entry.mode === permissionMode) ?? MODES[2];
	const Icon = active.icon;

	const choose = (mode: PermissionMode) => {
		// Going unrestricted is the one direction that widens what the agent may touch, so it waits
		// behind the confirmation dialog; the other two apply at once.
		if (mode === "full") {
			setElevateOpen(true);
			return;
		}
		setPermissionMode(mode);
		void applyPermissionMode(mode);
	};

	// One pi process serves every session, and the gate keeps its mode per session, so the choice
	// follows the window from session to session instead of being sent once per run.
	const current = sessionFile ?? sessionId ?? "";
	useEffect(() => {
		if (blank && !sessionProject) return;
		if (lastSent && lastSent.key === current && lastSent.mode === permissionMode) return;
		lastSent = { key: current, mode: permissionMode };
		void applyPermissionMode(permissionMode).then((applied) => {
			// A mode that did not reach pi must not look like it did: forget the send so the next
			// session change tries again.
			if (!applied) lastSent = undefined;
		});
	}, [applyPermissionMode, blank, permissionMode, current, sessionProject]);

	useEffect(() => {
		if (!open) return;
		const dismiss = (event: MouseEvent) => {
			if (!root.current?.contains(event.target as Node)) setOpen(false);
		};
		document.addEventListener("mousedown", dismiss);
		return () => document.removeEventListener("mousedown", dismiss);
	}, [open]);

	return (
		<div className="relative shrink-0" ref={root}>
			<button
				className={`flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium transition-colors hover:bg-black/[0.05] ${TONES[active.mode]}`}
				onClick={() => setOpen((value) => !value)}
				title={active.description}
				type="button"
			>
				<Icon size={13} />
				{active.label}
				<ChevronDown size={12} />
			</button>
			{open ? (
				<div className="absolute bottom-9 left-0 z-40 w-[280px] overflow-hidden rounded-xl border border-black/[0.08] bg-white p-1 shadow-[0_14px_38px_rgba(15,23,42,0.16)]">
					{MODES.map(({ description, icon: ModeIcon, label, mode }) => (
						<button
							className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-black/[0.04]"
							key={mode}
							onClick={() => {
								setOpen(false);
								choose(mode);
							}}
							type="button"
						>
							<ModeIcon className={`mt-0.5 shrink-0 ${TONES[mode]}`} size={15} />
							<span className="min-w-0 flex-1">
								<span className="block text-[13px] text-[#1f2937]">{label}</span>
								<span className="mt-0.5 block text-[11px] leading-4 text-[#98a2b3]">{description}</span>
							</span>
							{mode === permissionMode ? (
								<Check className="mt-0.5 shrink-0 text-[#1f2937]" size={14} />
							) : null}
						</button>
					))}
				</div>
			) : null}
			<PermissionConfirmDialog
				onCancel={() => setElevateOpen(false)}
				onConfirm={() => {
					setElevateOpen(false);
					setPermissionMode("full");
					void applyPermissionMode("full");
				}}
				open={elevateOpen}
			/>
		</div>
	);
}
