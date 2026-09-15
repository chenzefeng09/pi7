import { describe, expect, it } from "vitest";
import { clampThinkingLevel } from "./thinking";

/** The level sets the live catalog reports for a few real models. */
const DEEPSEEK = ["minimal", "low", "medium", "high", "xhigh", "max"];
const QWEN_27B = ["off", "low", "medium", "xhigh"];
const OPENROUTER_FLASH = ["off", "high", "xhigh"];
const NOT_A_REASONER = ["off"];

describe("clampThinkingLevel", () => {
	it("keeps a supported level untouched", () => {
		expect(clampThinkingLevel(DEEPSEEK, "max")).toBe("max");
		expect(clampThinkingLevel(QWEN_27B, "low")).toBe("low");
	});

	it("steps down to the strongest level below the request", () => {
		// The case that started this: max on a model that stops at xhigh.
		expect(clampThinkingLevel(QWEN_27B, "max")).toBe("xhigh");
		expect(clampThinkingLevel(OPENROUTER_FLASH, "max")).toBe("xhigh");
	});

	it("prefers a stronger level over a weaker one", () => {
		// Nothing at or below `medium` exists here, so the upward search wins over `off`.
		expect(clampThinkingLevel(OPENROUTER_FLASH, "medium")).toBe("high");
		expect(clampThinkingLevel(["high", "xhigh"], "low")).toBe("high");
	});

	it("falls back to the weakest level when nothing is above either", () => {
		expect(clampThinkingLevel(["off", "low"], "max")).toBe("low");
		expect(clampThinkingLevel(NOT_A_REASONER, "high")).toBe("off");
	});

	it("leaves an unknown level alone when the list is empty", () => {
		expect(clampThinkingLevel([], "max")).toBe("max");
	});
});
