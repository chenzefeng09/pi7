import { Check, ChevronDown } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

/**
 * Settings row, the harness's unit: title and description on the left, the control on the right,
 * a hairline under each row and none after the last one.
 */
export function SettingsRow({
	children,
	description,
	title,
}: {
	children?: ReactNode;
	description?: ReactNode;
	title: ReactNode;
}) {
	return (
		<div className="flex items-center gap-4 border-b-[0.5px] border-black/[0.06] py-4 last:border-b-0">
			<div className="flex min-w-0 flex-1 flex-col gap-1 pr-2">
				<div className="text-[14px] leading-[22px] text-[#1f2937]">{title}</div>
				{description ? <div className="text-[12px] leading-[18px] text-[#98a2b3]">{description}</div> : null}
			</div>
			{children ? <div className="flex shrink-0 items-center gap-2">{children}</div> : null}
		</div>
	);
}

/** The harness's selector pill: 36px tall, 18px radius, module-platform fill. */
export function SettingsPill({
	children,
	disabled,
	fill,
	onClick,
	title,
}: {
	children: ReactNode;
	disabled?: boolean;
	/** Stretch to the container's width, for a pill that plays the part of a form field. */
	fill?: boolean;
	onClick?: () => void;
	title?: string;
}) {
	return (
		<button
			className={`inline-flex h-9 items-center gap-3 rounded-[18px] bg-[#f5f6f7] px-3.5 text-[14px] leading-[22px] text-[#1f2937] transition-colors hover:bg-black/[0.05] disabled:cursor-default disabled:opacity-40 ${
				fill ? "w-full justify-between" : ""
			}`}
			disabled={disabled}
			onClick={onClick}
			title={title}
			type="button"
		>
			{children}
		</button>
	);
}

/** The harness's switch: 36x20 track, 16px knob, primary fill when on. */
export function SettingsSwitch({
	checked,
	disabled,
	onChange,
	title,
}: {
	checked: boolean;
	disabled?: boolean;
	onChange: (value: boolean) => void;
	title?: string;
}) {
	return (
		<button
			aria-checked={checked}
			className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:cursor-default disabled:opacity-40 ${
				checked ? "bg-[#2f7df6]" : "bg-black/[0.12]"
			}`}
			disabled={disabled}
			onClick={() => onChange(!checked)}
			role="switch"
			title={title}
			type="button"
		>
			<span
				className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
					checked ? "left-[18px]" : "left-0.5"
				}`}
			/>
		</button>
	);
}

/** Field styling shared by the settings editors. */
export const SETTINGS_INPUT_CLASS =
	"h-8 w-full rounded-lg border border-black/[0.1] bg-white px-2.5 text-[13px] text-[#1f2937] outline-none focus:border-[#9fb2a5]";

/**
 * The harness's selector, with its own menu instead of the operating system's dropdown.
 *
 * A native `<select>` renders in the OS's language and colours and ignores the row it sits in,
 * which is what makes it look foreign here; this keeps the pill and opens a panel in the app's own
 * style, with the current choice ticked.
 */
export function SettingsSelect<T extends string>({
	align = "end",
	block,
	disabled,
	minWidth,
	onChange,
	options,
	title,
	value,
}: {
	/** Which edge the panel hangs from; `start` for controls at the left of a form. */
	align?: "end" | "start";
	/** Fill the container, for use inside a form grid where its neighbours are full-width fields. */
	block?: boolean;
	disabled?: boolean;
	minWidth?: number;
	onChange: (value: T) => void;
	options: Array<{ label: string; value: T }>;
	title?: string;
	value: T;
}) {
	const [open, setOpen] = useState(false);
	const root = useRef<HTMLDivElement | null>(null);
	const selected = options.find((option) => option.value === value);

	useEffect(() => {
		if (!open) return;
		const dismiss = (event: MouseEvent) => {
			if (!root.current?.contains(event.target as Node)) setOpen(false);
		};
		document.addEventListener("mousedown", dismiss);
		return () => document.removeEventListener("mousedown", dismiss);
	}, [open]);

	return (
		<div className={block ? "relative w-full" : "relative"} ref={root}>
			<SettingsPill
				disabled={disabled}
				fill={block}
				onClick={() => setOpen((current) => !current)}
				title={title}
			>
				<span
					className={`truncate text-center ${block ? "flex-1" : ""}`}
					style={minWidth ? { minWidth } : undefined}
				>
					{selected?.label ?? value}
				</span>
				<ChevronDown className="shrink-0 text-[#98a2b3]" size={14} />
			</SettingsPill>
			{open ? (
				<div
					className={`absolute top-11 z-20 max-h-64 w-max min-w-[140px] overflow-y-auto rounded-xl border border-black/[0.08] bg-white p-1 shadow-[0_18px_50px_rgba(15,23,42,0.18)] ${
						align === "end" ? "right-0" : "left-0"
					}`}
				>
					{options.map((option) => (
						<button
							className="flex w-full items-center gap-2 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-left text-[13px] text-[#1f2937] transition-colors hover:bg-black/[0.04]"
							key={option.value || "empty"}
							onClick={() => {
								setOpen(false);
								onChange(option.value);
							}}
							type="button"
						>
							<span className="flex-1">{option.label}</span>
							{option.value === value ? <Check className="shrink-0 text-[#1f2937]" size={14} /> : null}
						</button>
					))}
				</div>
			) : null}
		</div>
	);
}
