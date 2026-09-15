import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function webCompatTest(pi: ExtensionAPI) {
	pi.registerCommand("web-custom-test", {
		description: "Verify that terminal-only custom UI degrades cleanly in RPC mode",
		async handler(_args, ctx) {
			let result: unknown = "not-called";
			try {
				result = await ctx.ui.custom(() => ({
					handleInput() {},
					invalidate() {},
					render() {
						return [];
					},
				}));
			} catch (error) {
				ctx.ui.notify(
					`custom UI threw: ${error instanceof Error ? error.message : String(error)}`,
					"error",
				);
				return;
			}
			ctx.ui.notify(`custom UI fallback: ${result === undefined ? "undefined" : String(result)}`, "info");
		},
	});
}
