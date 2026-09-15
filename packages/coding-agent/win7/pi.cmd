@echo off
setlocal
rem Windows 7 launcher for pi (Node 16 build). Run inside ConEmu.
rem Assumes this file sits at the root of the Win7 install dir (e.g. C:\work\pi_win7)
rem next to node_modules\ produced by `npm install` of win7/package.json.
rem
rem Preload the Node 16 polyfills into pi and every node child it spawns (in
rem particular the pi-subagents async runner, launched via jiti outside
rem cli.win7.js). --require needs CJS on Node 16 (no --import). Use forward
rem slashes: NODE_OPTIONS treats backslashes as escape characters on Windows.
set "PI_CJS=%~dp0node_modules\@earendil-works\pi-coding-agent\dist\polyfills-node16.cjs"
set "PI_CJS=%PI_CJS:\=/%"
set "NODE_OPTIONS=--require "%PI_CJS%""
node "%~dp0node_modules\@earendil-works\pi-coding-agent\dist\cli.win7.js" %*
