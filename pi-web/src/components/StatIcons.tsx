/**
 * The stat glyphs, ported from the harness (`packages/client/ui-primitives/src/icons/index.tsx`):
 * 16px boxes, 1.25 stroke, no fill.
 *
 * lucide's equivalents are 24px boxes with a 2px stroke scaled into the same space, so they read
 * heavier than everything around them. These are drawn at the size they are used.
 */

interface IconProps {
	className?: string;
	size?: number;
}

/** Three-tier database cylinder: the turn-usage pill. */
export function DatabaseIcon({ className, size = 15 }: IconProps) {
	return (
		<svg
			className={className}
			fill="none"
			height={size}
			viewBox="0 0 16 16"
			width={size}
			xmlns="http://www.w3.org/2000/svg"
		>
			<ellipse cx="8" cy="3.6" rx="5.75" ry="2.4" stroke="currentColor" strokeWidth="1.25" />
			<path d="M2.25 3.6V12.3A5.75 2.4 0 0 0 13.75 12.3V3.6" stroke="currentColor" strokeWidth="1.25" />
			<path d="M2.25 7.95A5.75 2.4 0 0 0 13.75 7.95" stroke="currentColor" strokeWidth="1.25" />
		</svg>
	);
}

/** Outlined dial with square-cut hands: the turn-time pill. */
export function ClockIcon({ className, size = 15 }: IconProps) {
	return (
		<svg
			className={className}
			fill="none"
			height={size}
			viewBox="0 0 16 16"
			width={size}
			xmlns="http://www.w3.org/2000/svg"
		>
			<circle cx="8" cy="8" r="6.375" stroke="currentColor" strokeWidth="1.25" />
			<path d="M8 4.4V8.3L10.7 9.85" stroke="currentColor" strokeWidth="1.25" />
		</svg>
	);
}
