export type ButtonRole = "danger" | "primary" | "secondary";

const SIZES = {
	md: "px-3 py-2 text-[13px]",
	sm: "px-2.5 py-1.5 text-[12px]",
} as const;

const ROLES = {
	primary:
		"bg-[#1f2937] text-white hover:bg-[#111827] active:bg-black disabled:bg-[#e5e7eb] disabled:text-[#9aa3ad]",
	secondary:
		"border border-black/[0.1] bg-white text-[#475467] hover:bg-black/[0.04] hover:text-[#1f2937] active:bg-black/[0.07] disabled:text-[#b6bcc4]",
	danger:
		"bg-[#d92d20] text-white hover:bg-[#b42318] active:bg-[#912018] disabled:bg-[#f3b6b2]",
} as const;

/**
 * Class list for a dialog or form action.
 *
 * The app carried two button languages: newer dialogs had an ink fill with a hover step, older
 * ones a bare `bg-ink` with no hover, no pressed state and no focus ring — the same action could
 * look inert in one dialog and alive in the next. One definition per role keeps the four
 * interaction states identical everywhere, and a caller only picks the role and the size.
 */
export function buttonClass(
	role: ButtonRole = "secondary",
	size: keyof typeof SIZES = "md",
	wrap = false,
): string {
	return [
		// A flex box: without it a button in a row shrinks and wraps its label into two lines, which
		// is what made the settings buttons look deformed next to a text field. `wrap` opts out of
		// that single-line contract for buttons whose label is user content (extension select
		// options), where truncating to one line would overflow the dialog.
		wrap
			? "inline-flex shrink-0 items-start justify-start gap-1.5 whitespace-normal break-words rounded-lg font-medium transition-colors"
			: "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-colors",
		"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2f7df6]/40",
		"disabled:cursor-default",
		SIZES[size],
		ROLES[role],
	].join(" ");
}
