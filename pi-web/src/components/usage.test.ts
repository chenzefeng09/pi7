import { describe, expect, it } from "vitest";
import { formatClock, formatDuration, formatPercent, formatTokens } from "./usage";

describe("formatTokens", () => {
	it("follows the dsh scale: 517 / 12.2K / 517K / 1.2M", () => {
		expect(formatTokens(517)).toBe("517");
		expect(formatTokens(12_200)).toBe("12.2K");
		expect(formatTokens(517_000)).toBe("517K");
		expect(formatTokens(1_200_000)).toBe("1.2M");
	});

	it("drops the decimal once the scaled number is past a hundred", () => {
		expect(formatTokens(99_949)).toBe("99.9K");
		expect(formatTokens(100_000)).toBe("100K");
	});
});

describe("formatPercent", () => {
	it("rounds whole percent by default and tenths on request", () => {
		expect(formatPercent(0.9936)).toBe("99%");
		expect(formatPercent(0.9936, 1)).toBe("99.4%");
	});

	it("never rounds a partial hit up to a perfect score", () => {
		expect(formatPercent(0.9997, 1)).toBe("99.9%");
		expect(formatPercent(1, 1)).toBe("100%");
	});
});

describe("formatDuration", () => {
	it("reports sub-second turns in milliseconds instead of rounding them to zero", () => {
		expect(formatDuration(480)).toBe("480毫秒");
		expect(formatDuration(0)).toBe("0毫秒");
	});

	it("pads seconds so a column of durations lines up", () => {
		expect(formatDuration(12_000)).toBe("12秒");
		expect(formatDuration(126_000)).toBe("2分06秒");
		expect(formatDuration(3_600_000)).toBe("1小时00分");
	});

	it("has nothing to say about a value that is not a duration", () => {
		expect(formatDuration(Number.NaN)).toBe("");
		expect(formatDuration(-1)).toBe("");
	});
});

describe("formatClock", () => {
	it("prints the settled time without a date", () => {
		// A fixed local time: the string is built from the reader's own clock, not UTC.
		const at = new Date(2026, 8, 12, 18, 36).getTime();
		expect(formatClock(at)).toBe("18:36");
	});

	it("ignores an unparsable timestamp", () => {
		expect(formatClock(Number.NaN)).toBe("");
	});
});
