import type { Config } from "tailwindcss";

const config: Config = {
	content: ["./index.html", "./src/**/*.{ts,tsx}"],
	theme: {
		extend: {
			colors: {
				// Every token is a CSS variable so the appearance setting can swap the palette; the
				// light values live in styles.css, the dark ones in its `[data-theme="dark"]` block.
				canvas: "var(--pi-canvas)",
				surface: "var(--pi-surface)",
				"surface-muted": "var(--pi-surface-muted)",
				"surface-hover": "var(--pi-surface-hover)",
				line: "var(--pi-line)",
				"line-strong": "var(--pi-line-strong)",
				ink: "var(--pi-ink)",
				"ink-muted": "var(--pi-ink-muted)",
				"ink-faint": "var(--pi-ink-faint)",
				accent: "var(--pi-accent)",
				"user-bubble": "var(--pi-user-bubble)",
				// Conversation-flow palette, mirrored from the dsh web client so flow rows and
				// their expanded cards read the same as the app this UI is aligned with.
				"ink-subtle": "var(--pi-ink-subtle)",
				"ink-caption": "var(--pi-ink-caption)",
				code: "var(--pi-code)",
				danger: "var(--pi-danger)",
				success: "var(--pi-success)",
				warn: "var(--pi-warn)",
				// `bg-white` is the app's main surface; pointing it at the variable is what makes a
				// dark theme possible without touching every component.
				white: "var(--pi-surface)",
			},
			borderRadius: {
				sm: "0.25rem",
				md: "0.375rem",
				lg: "0.625rem",
				xl: "0.875rem",
				composer: "1.75rem",
			},
			fontFamily: {
				sans: [
					"ui-sans-serif",
					"-apple-system",
					"system-ui",
					"Segoe UI",
					"Helvetica",
					"Arial",
					"sans-serif",
				],
				mono: ["ui-monospace", "SFMono-Regular", "Consolas", "Liberation Mono", "monospace"],
			},
		},
	},
	plugins: [],
};

export default config;
