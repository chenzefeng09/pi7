$ErrorActionPreference = "Stop"

$node18 = "C:\Users\27581\AppData\Local\nvm\v18.20.8\node.exe"
$piWeb = "D:\chenzefeng\Develop\pi\pi-web"
$exe = Join-Path $piWeb "release\win-unpacked\π7.exe"
$outLog = Join-Path $env:TEMP "pi-web-packaged.out.log"
$errLog = Join-Path $env:TEMP "pi-web-packaged.err.log"

$bundledAgent = $null
if ($env:PI_WEB_USE_BUNDLED_CONFIG -eq "1") {
	$bundledSource = Join-Path $piWeb "release\win-unpacked\resources\pi-win7\config\agent"
	$bundledAgent = Join-Path $env:TEMP ("pi-web-bundled-agent-" + [guid]::NewGuid().ToString("N"))
	New-Item -ItemType Directory -Force -Path $bundledAgent | Out-Null
	Copy-Item -Path (Join-Path $bundledSource "*") -Destination $bundledAgent -Recurse -Force
	Copy-Item -Path (Join-Path $piWeb ".test-agent\auth.json") -Destination (Join-Path $bundledAgent "auth.json") -Force
	$env:PI_CODING_AGENT_DIR = $bundledAgent
} else {
	$env:PI_CODING_AGENT_DIR = Join-Path $piWeb ".test-agent"
}
Remove-Item Env:PI_WORKSPACE_CWD -ErrorAction SilentlyContinue
if (-not $env:PI_WEB_NO_SESSION) {
	$env:PI_WEB_NO_SESSION = "1"
}
if (-not $env:PI_WEB_RENDERER_MATCH) {
	$env:PI_WEB_RENDERER_MATCH = "index.html"
}
if (-not $env:PI_WEB_E2E_SCRIPT) {
	$env:PI_WEB_E2E_SCRIPT = "scripts/e2e-smoke.mjs"
}

$app = $null
try {
	$app = Start-Process -FilePath $exe `
		-ArgumentList "--remote-debugging-port=9222" `
		-WorkingDirectory $piWeb -WindowStyle Hidden -PassThru `
		-RedirectStandardOutput $outLog -RedirectStandardError $errLog

	$deadline = (Get-Date).AddSeconds(60)
	$cdpReady = $false
	while ((Get-Date) -lt $deadline) {
		try {
			$response = Invoke-WebRequest -NoProxy -UseBasicParsing -TimeoutSec 2 http://127.0.0.1:9222/json
			if ($response.StatusCode -eq 200) {
				$cdpReady = $true
				break
			}
		} catch {}
		Start-Sleep -Milliseconds 500
	}
	if (-not $cdpReady) {
		Write-Output "PACKAGED CDP NOT READY"
		Get-Content $outLog -Tail 40 -ErrorAction SilentlyContinue
		Get-Content $errLog -Tail 60 -ErrorAction SilentlyContinue
		throw "packaged cdp not ready"
	}
	Write-Output "packaged cdp ready"

	Push-Location $piWeb
	try {
		& $node18 $env:PI_WEB_E2E_SCRIPT
		$code = $LASTEXITCODE
	} finally {
		Pop-Location
	}
	Write-Output "PACKAGED E2E EXIT=$code"
	Get-Content $errLog -Tail 60 -ErrorAction SilentlyContinue
	exit $code
} finally {
	if ($app) {
		Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue
	}
	Get-CimInstance Win32_Process -Filter "Name='π7.exe'" |
		ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
	if ($bundledAgent) {
		$tempRoot = [System.IO.Path]::GetFullPath($env:TEMP)
		$resolvedBundled = [System.IO.Path]::GetFullPath($bundledAgent)
		if ($resolvedBundled.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
			Remove-Item -LiteralPath $resolvedBundled -Recurse -Force -ErrorAction SilentlyContinue
		}
	}
}
