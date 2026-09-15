@echo off
rem Windows 7 launcher for pi (Node 16 build).
rem Requires a Node 16.x runtime on PATH (the newest Node that still launches on
rem Windows 7). Run inside ConEmu so ANSI/VT escape sequences render correctly.
setlocal
set "PI_DIR=%~dp0"
rem Preload the Node 16 polyfills into pi and every node child it spawns (in
rem particular the pi-subagents async runner, launched via jiti outside
rem cli.win7.js). --require needs CJS on Node 16 (no --import). Use forward
rem slashes: NODE_OPTIONS treats backslashes as escape characters on Windows.
set "PI_CJS=%PI_DIR%dist\polyfills-node16.cjs"
set "PI_CJS=%PI_CJS:\=/%"
set "NODE_OPTIONS=--require "%PI_CJS%""
node "%PI_DIR%dist\cli.win7.js" %*
endlocal
