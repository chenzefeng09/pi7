# Extension compatibility

pi extensions run inside the `pi-win7 --mode rpc` process. The web UI implements
the RPC extension surface. It does not load or execute extension code in the
renderer.

## Supported

| Capability | Web behavior |
|---|---|
| Registered tools | Tool cards show arguments, streaming updates, output, errors, and details. |
| `ctx.ui.input` | Modal text input. |
| `ctx.ui.editor` | Modal multiline editor. |
| `ctx.ui.select` | Modal option list. |
| `ctx.ui.confirm` | Modal confirm/cancel. |
| `ctx.ui.notify` | Top-right notification stack. |
| `ctx.ui.setStatus` | Status bar text. |
| `ctx.ui.setWidget` with `string[]` | Status bar lines. |
| `ctx.ui.setTitle` | Browser window title. |
| `ctx.ui.setEditorText` | Composer text. |
| Registered commands | Command palette through `get_commands`; execution goes through `prompt`. |
| Todo-style tool details | Dedicated list rendering. |
| Subagent-style tool details | Dedicated progress/result rendering. |
| `web_search` tool details | Dedicated result cards with title, URL, snippet, and provider. |
| `web_fetch` tool details | URL and extracted character count. |

## Degraded

| Capability | Web behavior |
|---|---|
| `ctx.ui.custom` | RPC mode returns `undefined`. Extensions should check `ctx.mode === "rpc"` or handle an undefined result. |
| `ctx.ui.setWidget` with a component factory | Ignored by pi RPC mode. Use a string array or render state through tool details. |
| `ctx.ui.setFooter` | Ignored. |
| `ctx.ui.setHeader` | Ignored. |
| `ctx.ui.setEditorComponent` | Ignored. |
| `ctx.ui.onTerminalInput` | No terminal input stream. |
| Theme switching | Not supported by RPC mode. |

## Extension guidance

Terminal-only UI must be guarded:

```ts
if (ctx.mode === "tui") {
	await ctx.ui.custom(factory);
}
```

Prefer the portable subset:

- `ctx.ui.select`, `input`, `editor`, and `confirm`
- `ctx.ui.notify` and `setStatus`
- `ctx.ui.setWidget` with `string[]`
- tool `details` for rich domain-specific rendering
- registered commands for slash-command workflows

The `web-custom-test` extension in `extensions/web-compat-test.ts` verifies that
`ctx.ui.custom` degrades to `undefined` without throwing.
