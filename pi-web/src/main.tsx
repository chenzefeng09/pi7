import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import { getLocale } from "./i18n";
import { startAppearance } from "./state/appearance";
import { usePiStore } from "./state/store";

const container = document.getElementById("root");
if (!container) throw new Error("root element not found");

document.documentElement.lang = getLocale() === "zh" ? "zh-CN" : "en";

// Before the first paint, so a dark preference never flashes a light frame.
startAppearance();

createRoot(container).render(
	<StrictMode>
		<App />
	</StrictMode>,
);

// Focus rings are only meaningful for keyboard users; mouse clicks should look clean.
const markKeyboard = () => document.documentElement.setAttribute("data-input", "keyboard");
const markPointer = () => document.documentElement.removeAttribute("data-input");
window.addEventListener("keydown", markKeyboard, true);
window.addEventListener("mousedown", markPointer, true);

if (import.meta.env.DEV) {
	(window as unknown as { __piStore?: typeof usePiStore }).__piStore = usePiStore;
}
