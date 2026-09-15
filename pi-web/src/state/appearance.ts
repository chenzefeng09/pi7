import { create } from "zustand";

/** What the appearance row offers; `system` follows the operating system. */
export type ThemePreference = "dark" | "light" | "system";

const THEME_KEY = "pi-web.theme";
const FONT_SIZE_KEY = "pi-web.font-size";

/** Font sizes the setting offers, in px; 14 is what the app is drawn at. */
export const FONT_SIZES = [12, 13, 14, 15, 16, 17] as const;
/** The size the components are written in, so the scale is 1 at the default. */
export const FONT_SIZE_BASE = 14;
export const FONT_SIZE_DEFAULT = 14;

function readTheme(): ThemePreference {
	try {
		const stored = localStorage.getItem(THEME_KEY);
		return stored === "light" || stored === "dark" ? stored : "system";
	} catch {
		return "system";
	}
}

function readFontSize(): number {
	try {
		const stored = Number(localStorage.getItem(FONT_SIZE_KEY));
		return FONT_SIZES.includes(stored as (typeof FONT_SIZES)[number]) ? stored : FONT_SIZE_DEFAULT;
	} catch {
		return FONT_SIZE_DEFAULT;
	}
}

/** The theme the preference resolves to right now. */
export function resolveTheme(preference: ThemePreference): "dark" | "light" {
	if (preference !== "system") return preference;
	return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Apply the preference to the document: one attribute and one scale the stylesheet keys on. */
function apply(preference: ThemePreference, fontSize: number): void {
	document.documentElement.dataset.theme = resolveTheme(preference);
	document.documentElement.style.setProperty("--pi-font-scale", String(fontSize / FONT_SIZE_BASE));
}

interface AppearanceStore {
	fontSize: number;
	setFontSize: (fontSize: number) => void;
	setTheme: (theme: ThemePreference) => void;
	theme: ThemePreference;
}

/**
 * Appearance preference: light, dark, or whatever the system says, plus the text size.
 *
 * Both live in CSS variables (see styles.css), so a change is one attribute or one variable on
 * `<html>` and every component follows without knowing a setting exists.
 */
export const useAppearance = create<AppearanceStore>((set, get) => ({
	fontSize: readFontSize(),
	setFontSize: (fontSize) => {
		try {
			localStorage.setItem(FONT_SIZE_KEY, String(fontSize));
		} catch {}
		apply(get().theme, fontSize);
		set({ fontSize });
	},
	setTheme: (theme) => {
		try {
			localStorage.setItem(THEME_KEY, theme);
		} catch {}
		apply(theme, get().fontSize);
		set({ theme });
	},
	theme: readTheme(),
}));

/** Apply the stored appearance and keep `system` following the OS. Call once, at startup. */
export function startAppearance(): () => void {
	apply(useAppearance.getState().theme, useAppearance.getState().fontSize);
	const media = window.matchMedia("(prefers-color-scheme: dark)");
	const onChange = () => {
		if (useAppearance.getState().theme === "system") {
			apply("system", useAppearance.getState().fontSize);
		}
	};
	media.addEventListener("change", onChange);
	return () => media.removeEventListener("change", onChange);
}
