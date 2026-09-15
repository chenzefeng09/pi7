@echo off
setlocal EnableExtensions DisableDelayedExpansion
rem Upgrade a previous portable bundle into this version without changing the old folder.

set "NEW_ROOT=%~dp0"
if "%NEW_ROOT:~-1%"=="\" set "NEW_ROOT=%NEW_ROOT:~0,-1%"
set "OLD_ROOT=%~1"
set "PAUSE_AT_END=0"

if not defined OLD_ROOT (
	set "OLD_ROOT=%NEW_ROOT%\..\pi-win7-portable"
	set "PAUSE_AT_END=1"
)

if not exist "%OLD_ROOT%\config\agent" (
	echo Old portable config was not found:
	echo   %OLD_ROOT%\config\agent
	echo.
	echo Usage:
	echo   Upgrade-from-old.cmd "C:\path\to\old-pi-win7-portable"
	if "%PAUSE_AT_END%"=="1" pause
	exit /b 2
)

if not exist "%NEW_ROOT%\node\node.exe" (
	echo Bundled Node runtime was not found in:
	echo   %NEW_ROOT%\node
	if "%PAUSE_AT_END%"=="1" pause
	exit /b 2
)

echo Close pi in both folders before continuing.
echo.
echo Old bundle: %OLD_ROOT%
echo New bundle: %NEW_ROOT%
echo.
if "%PAUSE_AT_END%"=="1" pause

set "NODE_SKIP_PLATFORM_CHECK=1"
"%NEW_ROOT%\node\node.exe" "%NEW_ROOT%\tools\migrate-config.js" "%OLD_ROOT%" "%NEW_ROOT%"
if errorlevel 1 (
	echo.
	echo Upgrade failed. The old bundle was not changed.
	if "%PAUSE_AT_END%"=="1" pause
	exit /b 1
)

"%NEW_ROOT%\node\node.exe" "%NEW_ROOT%\tools\gen-mcp.js" "%NEW_ROOT%" "%NEW_ROOT%\config\agent"
if errorlevel 1 (
	echo.
	echo Configuration migrated, but the portable MCP entry could not be refreshed.
	if "%PAUSE_AT_END%"=="1" pause
	exit /b 1
)

echo.
echo Upgrade completed. The old folder is unchanged and remains the rollback copy.
echo Start the new version with Start-pi.cmd.
if "%PAUSE_AT_END%"=="1" pause
exit /b 0
