/**
 * Thinking-level fallback, mirroring pi's own `clampThinkingLevel`
 * (`packages/ai/src/models.ts`): a level the model does not take is replaced by the nearest one it
 * does, searched upward first and then downward, so a stored `max` on a model capped at `xhigh`
 * runs as `xhigh` rather than being refused or silently dropped to the weakest level.
 */

/** pi's order, weakest first. */
export const THINKING_ORDER = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export function clampThinkingLevel(levels: readonly string[], level: string): string {
	if (levels.length === 0) return level;
	if (levels.includes(level)) return level;
	const requested = THINKING_ORDER.indexOf(level as (typeof THINKING_ORDER)[number]);
	if (requested === -1) return levels[0] ?? level;
	for (let index = requested; index < THINKING_ORDER.length; index += 1) {
		const candidate = THINKING_ORDER[index];
		if (levels.includes(candidate)) return candidate;
	}
	for (let index = requested - 1; index >= 0; index -= 1) {
		const candidate = THINKING_ORDER[index];
		if (levels.includes(candidate)) return candidate;
	}
	return levels[0] ?? level;
}
