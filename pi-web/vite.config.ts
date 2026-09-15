/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
	test: {
		setupFiles: ["./src/test-setup.ts"],
	},
	base: "./",
	build: {
		outDir: "dist/renderer",
		target: "chrome108",
	},
	plugins: [react()],
	server: {
		host: "127.0.0.1",
		port: 5173,
		strictPort: true,
	},
});
