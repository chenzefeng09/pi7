@echo off
setlocal
rem ============================================================
rem  pi launcher - SELF-SUFFICIENT.
rem  Works from ANY shell/terminal (VS Code integrated terminal, a system ConEmu,
rem  plain cmd), not only via Start-pi.cmd. Everything is derived from this file's
rem  own location (%~dp0 = the bundle's tools\ folder), so `pi` "just works" as long
rem  as this tools\ dir is on PATH (or you call this .cmd by its full path).
rem ============================================================
set "PI_ROOT=%~dp0.."
set "PI_NODE=%PI_ROOT%\node\node.exe"

rem Use the bundled config dir unless the caller already set one (Start-pi.cmd does).
if not defined PI_CODING_AGENT_DIR (
	set "PI_CODING_AGENT_DIR=%PI_ROOT%\config\agent"
)
if not exist "%PI_CODING_AGENT_DIR%" mkdir "%PI_CODING_AGENT_DIR%" >nul 2>&1

rem Silence Node 16's Win7 "unsupported platform" warning (unless caller set it).
if not defined NODE_SKIP_PLATFORM_CHECK set "NODE_SKIP_PLATFORM_CHECK=1"

rem Refresh the relocatable bundled MCP entry while preserving user-added servers.
"%PI_NODE%" "%~dp0gen-mcp.js" "%PI_ROOT%" "%PI_CODING_AGENT_DIR%" >nul 2>&1

rem The Win7/ConEmu render recipe (16-color, ASCII spinner, safe cursor width,
rem throttled redraw) is now the pi HOST's own default whenever it detects it is
rem running on Windows 7 or earlier (see isLegacyWindowsConsole() in pi-tui's
rem terminal.ts) - regardless of terminal (ConEmu, VS Code's integrated terminal
rem via winpty, plain cmd, etc). No launcher-side detection is needed here
rem anymore; PI_TUI_MIN_RENDER_MS / PI_TUI_SAFE_WIDTH / PI_TUI_ASCII / PI_TUI_COLOR
rem remain available below to override the default if you ever need to.

rem Put the bundled Node and this launcher on PATH for any child that shells out.
set "PATH=%PI_ROOT%\node;%~dp0;%PATH%"

rem Preload the Node 16 polyfills into pi + every node child it spawns (esp. the
rem pi-subagents async runner, launched via jiti outside cli.win7.js). --require
rem needs CJS on Node 16. Forward slashes: NODE_OPTIONS treats backslashes as escapes.
set "PI_CJS=%PI_ROOT%\app\node_modules\@earendil-works\pi-coding-agent\dist\polyfills-node16.cjs"
set "PI_CJS=%PI_CJS:\=/%"
set "NODE_OPTIONS=--require "%PI_CJS%""

"%PI_NODE%" "%PI_ROOT%\app\node_modules\@earendil-works\pi-coding-agent\dist\cli.win7.js" %*
