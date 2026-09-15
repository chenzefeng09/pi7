import type { MessageUsage, SessionStats } from "../state/types";
import { t } from "../i18n";

/** The four token columns a rate can be computed from; session and turn totals share them. */
export type TokenCounts = MessageUsage | SessionStats["tokens"];

/**
 * Compact token count, the dsh scale: `517` / `12.2K` / `517K` / `1.2M`.
 *
 * One decimal only while the scaled number is small enough for it to mean something; past a
 * hundred it is noise in a pill that has room for four characters.
 */
export function formatTokens(value: number): string {
	const scaled = (candidate: number): string =>
		candidate >= 100 ? String(Math.round(candidate)) : String(Math.round(candidate * 10) / 10);
	if (value < 1_000) return String(value);
	if (value < 1_000_000) return `${scaled(value / 1_000)}K`;
	return `${scaled(value / 1_000_000)}M`;
}

/**
 * Share of prompt-side tokens served from the cache.
 *
 * Fresh prompt tokens are the uncached input plus everything written into the cache; both were
 * processed by the model, so both belong in the denominator next to the cache reads.
 */
export function cacheHitRate(tokens: TokenCounts): number | undefined {
	const promptTokens = tokens.input + tokens.cacheRead + tokens.cacheWrite;
	if (promptTokens <= 0) return undefined;
	return tokens.cacheRead / promptTokens;
}

/**
 * Cache-hit share for display: whole percent by default, tenths for the tighter readouts.
 *
 * A partial hit never rounds up to `100%` — a cache that missed tokens is not a full hit — so the
 * value truncates instead of rounding when it would land on a perfect score.
 */
export function formatPercent(value: number, decimals: 0 | 1 = 0): string {
	const percent = value * 100;
	const factor = decimals === 1 ? 10 : 1;
	const rounded = Math.round(percent * factor) / factor;
	if (rounded < 100 || percent >= 100) return `${rounded}%`;
	return `${Math.floor(percent * factor) / factor}%`;
}

/**
 * How long a turn took, at the precision a reader cares about: `2分06秒`, `12秒`, `480毫秒`.
 *
 * Seconds are zero-padded so a column of durations stays scannable, and anything under a second
 * is reported in milliseconds rather than as `0秒` — a cached answer really does come back that
 * fast, and rounding it away would read as missing data.
 */
export function formatDuration(ms: number): string {
	if (!Number.isFinite(ms) || ms < 0) return "";
	if (ms < 1000) return t("{arg}毫秒", { "arg": Math.max(0, Math.round(ms)) });
	const seconds = Math.round(ms / 1000);
	if (seconds < 60) return t("{seconds}秒", { "seconds": seconds });
	const minutes = Math.floor(seconds / 60);
	const rest = seconds % 60;
	if (minutes < 60) return t("{minutes}分{arg}秒", { "minutes": minutes, "arg": String(rest).padStart(2, "0") });
	return t("{arg}小时{arg2}分", { "arg": Math.floor(minutes / 60), "arg2": String(minutes % 60).padStart(2, "0") });
}

/** Clock time of a settled turn: "18:36". */
export function formatClock(ms: number): string {
	const date = new Date(ms);
	if (Number.isNaN(date.getTime())) return "";
	return date.toLocaleTimeString("zh-CN", { hour: "2-digit", hour12: false, minute: "2-digit" });
}
