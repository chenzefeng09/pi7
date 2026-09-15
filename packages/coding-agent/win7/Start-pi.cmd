@echo off
rem ============================================================
rem  pi for Windows 7 - portable launcher
rem  Double-click to start. No install or administrator rights required.
rem ============================================================
setlocal
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

rem Keep all pi configuration and state inside the portable folder.
set "PATH=%ROOT%\node;%ROOT%\tools;%PATH%"
set "PI_CODING_AGENT_DIR=%ROOT%\config\agent"
set "NODE_SKIP_PLATFORM_CHECK=1"
if not exist "%PI_CODING_AGENT_DIR%" mkdir "%PI_CODING_AGENT_DIR%" >nul 2>&1

rem Refresh the relocatable bundled MCP entry while preserving user-added servers.
"%ROOT%\node\node.exe" "%ROOT%\tools\gen-mcp.js" "%ROOT%" "%PI_CODING_AGENT_DIR%" >nul 2>&1

rem Register the bundled symbol font for this login session.
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\tools\regfont.ps1" "%ROOT%\fonts\Symbola.ttf" >nul 2>&1

rem Launch the bundled ConEmu and keep cmd open after pi exits.
start "" "%ROOT%\conemu\ConEmu64.exe" /LoadCfgFile "%ROOT%\conemu\ConEmu.xml" /cmd cmd /k pi

endlocal
