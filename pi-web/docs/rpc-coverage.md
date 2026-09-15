# RPC coverage

The web UI targets the full command surface exposed by
`packages/coding-agent/src/modes/rpc/rpc-types.ts`.

| RPC command | Web UI |
|---|---|
| `prompt` | Composer; supports text, images, follow-up, and steer |
| `steer` | Store API; Composer uses `prompt.streamingBehavior = "steer"` |
| `follow_up` | Store API; Composer queues with `prompt.streamingBehavior = "followUp"` |
| `abort` | Composer stop button |
| `clear_queue` | Queue bar clear button |
| `new_session` | Sidebar plus button; store accepts `parentSession` |
| `get_state` | Startup, reconnect, and session refresh |
| `set_model` | Model selector |
| `cycle_model` | Status bar cycle button |
| `get_available_models` | Model selector data |
| `set_thinking_level` | Status bar selector |
| `cycle_thinking_level` | Status bar cycle button |
| `get_available_thinking_levels` | Status bar selector data |
| `set_steering_mode` | Agent settings |
| `set_follow_up_mode` | Agent settings |
| `compact` | Agent settings and session stats dialog |
| `set_auto_compaction` | Agent settings |
| `set_auto_retry` | Agent settings |
| `abort_retry` | Agent settings |
| `bash` | Bash dialog |
| `abort_bash` | Bash dialog |
| `get_session_stats` | Session stats dialog |
| `export_html` | Agent settings |
| `switch_session` | Sidebar session list |
| `fork` | Fork dialog and session tree |
| `clone` | Fork dialog |
| `get_fork_messages` | Fork dialog |
| `get_entries` | Raw session entries dialog |
| `get_tree` | Session tree dialog |
| `get_last_assistant_text` | Agent settings |
| `set_session_name` | Agent settings |
| `get_messages` | Session refresh |
| `get_commands` | Composer command palette |
| `get_capabilities` | Startup handshake; decides multi-session vs single-session mode |
| `open_session` | Session list; keeps the previous session alive instead of `switch_session` |
| `get_open_sessions` | Startup, to resync handles after a runtime restart |
| `close_session` | Archiving a session, and dropping handles before a process restart |

## Multi-session

`open_session` keeps several sessions alive in one pi process, so a session that is streaming
keeps running while the user looks at another one. This requires the local runtime patch - see
[pi runtime patch](pi-runtime-patch.md); without it `get_capabilities` fails and the app stays
in single-session mode (`switch_session`, which stops the running turn).

| Aspect | Behavior |
|---|---|
| Events | carry `sessionId`; events for the visible handle update the flat store fields, others update a background slice |
| Switching | moves the visible slice in the renderer only; no RPC and no process restart |
| Background session | transcript, status, queue and unread flag are kept; extension dialogs and notifications still surface, dialog titles name the session |
| Commands | every session-scoped command carries an explicit `sessionId` once multi-session is negotiated |
| Pool cap | 设置 → 高级设置 → 会话缓存上限 (default 3, range 1-8). Idle handles beyond the cap are closed least-recently-used first; the visible session and anything streaming or queued are never evicted, and clicking an evicted session re-opens it through `open_session` and re-reads its transcript |

## Outside RPC

These features use Electron IPC because pi RPC does not expose them directly:

- workspace file listing and file reading for `@file` mentions
- Pi package management through the `pi install/remove/update` CLI

## Extension UI

The RPC extension UI events are handled in the renderer:

| Event | Web behavior |
|---|---|
| `select`, `confirm`, `input`, `editor` | Modal dialogs with timeout handling |
| `notify` | Notification stack |
| `setStatus` | Status bar |
| `setWidget` with `string[]` | Above/below composer widget strip |
| `setTitle` | Document title |
| `set_editor_text` | Composer text |

## Protocol boundaries

These capabilities are not available in pi RPC mode and therefore cannot be
implemented by the web renderer without changing pi:

- `ctx.ui.custom`
- custom footer/header/editor components
- raw terminal input
- terminal theme switching
- working-indicator customization
- `getEditorText()` synchronous reads
