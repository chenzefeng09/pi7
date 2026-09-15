# Running pi on Windows 7 (Node 16 fork)

Mainline pi requires Node ≥ 22 and a Windows 10+ VT console, so it does not run on
Windows 7. This fork makes the **built output** run on the newest Node that still
launches on Windows 7 (Node 16.x), rendered through **ConEmu**.

You still build/assemble on a modern machine and copy artifacts to the Win7 box.

> **Verified** on Windows 7 SP1 (6.1.7601) + Node 16.20.2: startup, `--version`,
> `--help`, `--list-models`, OpenRouter auth, model-catalog HTTPS fetch, and a real
> streaming LLM generation (`-p`) over undici@5 all work. Only the full-screen
> interactive TUI must be driven manually in ConEmu.

## What the fork changes (source)

1. **`undici` → 5.29.0** (`packages/coding-agent/package.json`). undici@8 requires
   Node ≥ 22; undici@5 supports Node ≥ 14 and provides `fetch`/`Response`/`Request`/
   `Headers`/`FormData`/`File`/`ProxyAgent`/`Agent`/`setGlobalDispatcher`.
2. **`src/polyfills-node16.ts`** installs the Node 22 globals Node 16 lacks:
   `globalThis.crypto`, `fetch` family, `Blob`, `ReadableStream`/`WritableStream`/
   `TransformStream`, `structuredClone`, `AbortSignal.timeout`,
   `Array.prototype.findLast`/`findLastIndex`. Feature-guarded → no-op on modern Node.
3. **`src/cli.win7.ts`** — entry that imports the polyfills first, then the normal CLI.
4. **`src/core/http-dispatcher.ts`** — version-adaptive: uses undici@8's
   `EnvHttpProxyAgent`/`install()` when present, otherwise builds the dispatcher from
   undici@5's `Agent`/`ProxyAgent` and wires the fetch globals manually.
5. **`packages/tui/src/utils.ts`** — the three ES2024 `v`-flag (unicodeSets) regexes
   broke Node 16 at parse time. The two single-property ones now use the `u` flag
   (behaviourally identical); the `\p{RGI_Emoji}` one (a string property that *requires*
   `v`) is built at runtime with a `u`-flag `Extended_Pictographic`/`Regional_Indicator`
   fallback.
6. **`packages/tui/src/terminal.ts`** — ConEmu wraps the cursor immediately when the
   last column is written (no deferred wrap like xterm), so every full-width row eats an
   extra line and breaks differential-rendering cursor math (duplicated frames, large
   gaps). The `columns` getter now renders one column narrower when `ConEmuANSI=ON` is
   detected; override with `PI_TUI_SAFE_WIDTH=1`/`0`.
7. **`packages/tui/src/terminal-image.ts`** — capability detection has an explicit
   ConEmu branch reporting `trueColor: false`. Probe-verified on ConEmu 230724: the 16
   basic SGR colors render correctly, 256-color SGR is quantized badly, and 24-bit SGR
   is silently dropped (even with TrueMod enabled).
8. **theme 16-color mode** (`theme.ts`) — on ConEmu the theme degrades to the 16 ANSI
   colors: chromatic colors are classified by hue family (pastel accents land on the
   right bright color instead of white), dark backgrounds map to plain black (avoids
   the gray-bar artifact — the bright-black slot is shared with dim text), dim/neutral
   text maps to bright-black. Override with `PI_TUI_COLOR=16|256|truecolor`.
9. **render throttle** (`tui.ts`) — ConEmu has no synchronized-output (DECSET 2026), so
   60fps diff-rendering visibly flickers the editor border lines during streaming. The
   minimum render interval is 100ms under ConEmu (override `PI_TUI_MIN_RENDER_MS`).
10. **glyph fallbacks** — Win7-era console fonts (Consolas/Lucida Console) lack several
    Unicode blocks pi uses. Under ConEmu: the Braille spinner (`loader.ts`) falls back
    to ASCII `|/-\` (override `PI_TUI_ASCII=1/0`), the session-selector radio `◉`
    becomes `●`, and the tree-selector fold markers `⊞`/`⊟` become `+`/`-`. A full
    glyph audit found the rest of pi's UI glyphs (box drawing, blocks, arrows, `•…›·`)
    are covered by Consolas.

## Dependency downgrades (Node 16 compatibility)

Several transitive deps dropped Node 16 and break at load/runtime. They are pinned to
their last Node-16-compatible versions via npm `overrides` (see `win7/package.json`):

| Package | Installed by | Pinned to | Why |
|---|---|---|---|
| `lru-cache` | hosted-git-info, path-scurry | `10.4.3` | v11 calls `diagnostics_channel.tracingChannel` (Node 20+) at load |
| `path-scurry` | glob | `1.11.1` | v2 needs lru-cache@11 |
| `glob` | coding-agent | `10.4.5` | v13 requires Node 20 |
| `minimatch` | coding-agent, glob | `9.0.5` | v10 requires Node 18 |
| `hosted-git-info` | coding-agent | `7.0.2` | v9 pulls lru-cache@11 |

Still Node 18+ but **lazy-loaded / not on the startup path** (only used for Google /
Vertex auth): `gaxios`, `gcp-metadata`, `google-auth-library`. `marked@18` and
`get-east-asian-width@1.6` declare Node ≥ 18/20 but are pure JS and run on Node 16.
So the Google/Vertex provider may fail on Win7; other providers (Anthropic, OpenAI,
OpenRouter, DeepSeek, …) use direct `fetch` and work.

## Build & assemble (on a modern machine)

```bash
# 1. Build the forked packages (produces dist/, incl. cli.win7.js and the tui fix)
npm install --ignore-scripts
npm run build

# 2. Pack the forked coding-agent WITHOUT the undici@8 shrinkwrap
mv packages/coding-agent/npm-shrinkwrap.json /tmp/sw.bak
( cd packages/coding-agent && npm pack --ignore-scripts --pack-destination /tmp )
mv /tmp/sw.bak packages/coding-agent/npm-shrinkwrap.json
# -> /tmp/earendil-works-pi-coding-agent-<ver>.tgz
```

## Install on Windows 7

Copy to the Win7 box: the packed `*.tgz`, `packages/coding-agent/win7/package.json`
(the overrides wrapper), and `packages/coding-agent/win7/pi.cmd`. Put the tgz next to
`package.json` as `pi-coding-agent.tgz`, then, with a Node 16.x runtime on PATH:

```bat
cd C:\work\pi_win7
npm install --ignore-scripts --no-audit --no-fund

REM Overwrite the registry tui with the v-flag-fixed build:
copy /Y path\to\forked\packages\tui\dist\utils.js ^
  node_modules\@earendil-works\pi-tui\dist\utils.js
```

The tui `utils.js` overwrite is required because the registry `pi-tui@0.80.3` still has
the parse-time `v`-flag regexes. (Alternatively, pack and install the forked pi-tui.)

## Run (in ConEmu)

```bat
cd C:\work\pi_win7
pi.cmd --version
pi.cmd            REM interactive TUI — must be run in ConEmu, not stock conhost
```

Provider auth lives in `%USERPROFILE%\.pi\agent\auth.json` (copy it, or run
`/login` inside pi). `settings.json` there holds default provider/model and `shellPath`
(point it at the Win7 machine's own shell, e.g. `C:\Program Files\Git\bin\bash.exe`).

## ConEmu setup

- No ConEmu settings are required: the fork auto-detects ConEmu (`ConEmuANSI=ON`) and
  handles the immediate-wrap quirk, degrades the theme to the 16 ANSI colors, and
  throttles rendering (changes 6–9 above). TrueMod does NOT help — probe-verified that
  this ConEmu drops 24-bit SGR even with TrueMod enabled.
- **Emoji / symbols in model output**: Consolas has none, so they render as boxes. Fix
  without installing anything — set ConEmu's **Alternative font** to **Segoe UI Symbol**
  (ships with Win7): `Settings → General → Fonts → Alternative font`, or set
  `FontName2` in `%APPDATA%\ConEmu.xml` while ConEmu is closed (it rewrites the file on
  exit). Verified coverage: ☀✅✓✗♪✨◉⊞ and 🎵🎤🎉🎂👋 all render; only the Emoticons
  face block (😀 U+1F600–1F64F) is missing — install Symbola/Noto Emoji if you need those.
- ConEmu renders no italics and no synchronized output; thinking text loses its italic
  styling and some repaint flicker remains during streaming. This is ConEmu's ceiling —
  and on Windows 7 there is no better VT terminal: Windows Terminal / Alacritty /
  WezTerm need ConPTY (Win10 1809+); mintty gives native programs pipes, not a console
  (pi sees no TTY; winpty routes through the VT-less Win7 conhost); Cmder is ConEmu
  underneath; SSH-in from a modern machine hits the same conhost screen-scraping.
  ConEmu's in-process WriteConsole hook that interprets VT itself is unique on Win7.

## fd / ripgrep on Win7

pi auto-downloads `fd` and `rg` on first TUI start, but this fails on Win7: extraction
needs `System32\tar.exe` (Win10 1803+) or PowerShell `Expand-Archive` (PS5; Win7 ships
PS2), and current fd/rg releases are built with Rust ≥ 1.78, which dropped Win7 anyway.
Pre-place the last Win7-compatible builds instead (no further download is attempted once
the binaries exist):

- [ripgrep 13.0.0](https://github.com/BurntSushi/ripgrep/releases/tag/13.0.0)
  `ripgrep-13.0.0-x86_64-pc-windows-msvc.zip` → `%USERPROFILE%\.pi\agent\bin\rg.exe`
- [fd v8.7.1](https://github.com/sharkdp/fd/releases/tag/v8.7.1)
  `fd-v8.7.1-x86_64-pc-windows-msvc.zip` → `%USERPROFILE%\.pi\agent\bin\fd.exe`

## Known limitations on Win7

- **Shift+Tab** is indistinguishable from Tab (the `ENABLE_VIRTUAL_TERMINAL_INPUT`
  native helper is a Win10 1607+ API; it no-ops on Win7).
- **Kitty keyboard protocol** is unavailable under ConEmu; pi falls back to
  `modifyOtherKeys`.
- **Proxy** support is basic (`HTTPS_PROXY`/`HTTP_PROXY`; no full `NO_PROXY` matching).
- **Google/Vertex provider** may fail (google-auth-library/gaxios are Node 18+).
- **32-bit (ia32) Win7** is not covered by the native prebuilds (x64/arm64 only).
- **EOL software** — Node 16 and Windows 7 are both end-of-life.

## Subagents (pi-subagents extension)

`pi-subagents` (the `subagent` tool — parallel / chain / async delegation) is pre-installed
and autoloaded in the portable bundle. It works on Node 16 with two fork-side fixes:

- **Extension loader** — `core/extensions/loader.ts` resolved pi's bundled packages with
  `import.meta.resolve` (Node 20+), which throws on Node 16 and broke loading of *any*
  installed third-party `.ts` extension ("(intermediate value).resolve is not a function").
  It now keeps `import.meta.resolve` on modern Node and, on Node 16, derives the installed
  package's dist entry directly (`require.resolve` cannot — pi's `exports` are ESM-only, so
  it reports "No exports main defined").
- **Async runner polyfills** — the background/async runner is spawned as
  `node <jiti> subagent-runner.ts`, outside `cli.win7.js`, so it never loads the ESM
  polyfills and would crash on `structuredClone`. `dist/polyfills-node16.cjs` (a CJS twin of
  `polyfills-node16.ts`) is preloaded into every child via `NODE_OPTIONS=--require`, set in
  the launchers. The path MUST use forward slashes — `NODE_OPTIONS` treats backslashes as
  escape characters on Windows.

Install uses the system `npm` (`npm install ... --prefix <agentDir>/npm --legacy-peer-deps`);
the bundle ships npm in `node\`. jiti 2.7.0 transpiles the extension's TypeScript fine on
Node 16. The extension's hard-pinned `@earendil-works/pi-tui@0.74.0` is aliased to pi's own
patched build by the loader, so its ES2024 `v`-flag regex is never parsed; `koffi` is an
optional dep of that nested pi-tui and is never loaded.

## Verification status

Build, startup, CLI commands, auth, model-catalog fetch, and a real streaming LLM
generation are verified on Win7 SP1 + Node 16.20.2. The interactive full-screen TUI
(rendering/input/keybindings) must be exercised manually in ConEmu.
