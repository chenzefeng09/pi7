import { en } from "./en";

export type Locale = "en" | "zh";

/**
 * Map a BCP-47 tag ("zh-CN", "en-US", …) to the locales this app ships. Chinese speakers get
 * Chinese; everything else falls back to English.
 */
export function localeFromTag(tag: string | undefined): Locale {
	return typeof tag === "string" && tag.toLowerCase().startsWith("zh") ? "zh" : "en";
}

function detectLocale(): Locale {
	try {
		if (typeof navigator === "object" && navigator) return localeFromTag(navigator.language);
	} catch {
		// No navigator (tests, main process): the caller decides via setLocale.
	}
	return "en";
}

let current: Locale = detectLocale();

export function getLocale(): Locale {
	return current;
}

export function setLocale(locale: Locale): void {
	current = locale;
}

function interpolate(text: string, vars?: Record<string, unknown>): string {
	if (!vars) return text;
	return text.replace(/\{([^{}]+)\}/g, (match, name: string) => {
		const value = vars[name.trim()];
		return value === undefined || value === null ? match : String(value);
	});
}

/**
 * Translate a message. The key is the Chinese source string; under English the `en` dictionary
 * supplies the text, and a missing entry falls back to the key so an untranslated string still
 * renders instead of disappearing.
 */
export function t(key: string, vars?: Record<string, unknown>): string {
	const text = current === "zh" ? key : (en[key] ?? key);
	return interpolate(text, vars);
}
