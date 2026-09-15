$ErrorActionPreference = "Stop"

$piWeb = Split-Path -Parent $PSScriptRoot
$env:PI_CODING_AGENT_DIR = Join-Path $piWeb ".test-agent"
$env:PI_WORKSPACE_CWD = Join-Path $env:TEMP "pi-web-e2e-workspace"

& pwsh -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "install-test-extensions.ps1")

$scripts = @(
	"scripts/e2e-smoke.mjs",
	"scripts/e2e-tool-smoke.mjs",
	"scripts/e2e-ask-user-smoke.mjs",
	"scripts/e2e-panels-smoke.mjs",
	"scripts/e2e-real-todo-ask-smoke.mjs",
	"scripts/e2e-real-subagent-smoke.mjs",
	"scripts/e2e-web-search-smoke.mjs",
	"scripts/e2e-sessions-smoke.mjs",
	"scripts/e2e-commands-smoke.mjs",
	"scripts/e2e-queue-smoke.mjs",
	"scripts/e2e-session-tools-smoke.mjs",
	"scripts/e2e-reconnect-smoke.mjs"
)
if ($env:PI_WEB_E2E_MATRIX) {
	$scripts = $env:PI_WEB_E2E_MATRIX -split "," | ForEach-Object { $_.Trim() } | Where-Object { $_ }
}

$results = @()
foreach ($script in $scripts) {
	Write-Output "RUN $script"
	$env:PI_WEB_E2E_SCRIPT = $script
	& pwsh -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "run-e2e.ps1")
	$code = $LASTEXITCODE
	$results += [pscustomobject]@{ Script = $script; ExitCode = $code }
	if ($code -ne 0) {
		$results | Format-Table -AutoSize
		throw "E2E failed: $script"
	}
}

$results | Format-Table -AutoSize
Write-Output "E2E MATRIX PASSED"
