$ErrorActionPreference = "Stop"

$node18 = "C:\Users\27581\AppData\Local\nvm\v18.20.8\node.exe"
$piWeb = "D:\chenzefeng\Develop\pi\pi-web"
$viteOut = Join-Path $env:TEMP "pi-web-vite.out.log"
$viteErr = Join-Path $env:TEMP "pi-web-vite.err.log"
$electronOut = Join-Path $env:TEMP "pi-web-electron.out.log"
$electronErr = Join-Path $env:TEMP "pi-web-electron.err.log"

if (-not $env:PI_WEB_NO_SESSION) {
	$env:PI_WEB_NO_SESSION = "1"
}

$vite = $null
$electron = $null

try {
	$vite = Start-Process -FilePath $node18 `
		-ArgumentList "node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "5173", "--strictPort" `
		-WorkingDirectory $piWeb -WindowStyle Hidden -PassThru `
		-RedirectStandardOutput $viteOut -RedirectStandardError $viteErr

	$deadline = (Get-Date).AddSeconds(60)
	$viteReady = $false
	while ((Get-Date) -lt $deadline) {
		try {
			$response = Invoke-WebRequest -NoProxy -UseBasicParsing -TimeoutSec 2 http://127.0.0.1:5173
			if ($response.StatusCode -eq 200) {
				$viteReady = $true
				break
			}
		} catch {}
		Start-Sleep -Milliseconds 500
	}
	if (-not $viteReady) {
		Write-Output "VITE NOT READY"
		Get-Content $viteOut -Tail 40 -ErrorAction SilentlyContinue
		Get-Content $viteErr -Tail 40 -ErrorAction SilentlyContinue
		throw "vite not ready"
	}
	Write-Output "vite ready"

	$electronExe = Join-Path $piWeb "node_modules\electron\dist\electron.exe"
	$electron = Start-Process -FilePath $electronExe `
		-ArgumentList "--remote-debugging-port=9222", "." `
		-WorkingDirectory $piWeb -WindowStyle Hidden -PassThru `
		-RedirectStandardOutput $electronOut -RedirectStandardError $electronErr

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
		Write-Output "CDP NOT READY"
		Get-Content $electronOut -Tail 60 -ErrorAction SilentlyContinue
		Get-Content $electronErr -Tail 60 -ErrorAction SilentlyContinue
		throw "cdp not ready"
	}
	Write-Output "cdp ready"

	Push-Location $piWeb
	try {
		$e2eScript = if ($env:PI_WEB_E2E_SCRIPT) { $env:PI_WEB_E2E_SCRIPT } else { "scripts/e2e-smoke.mjs" }
		& $node18 $e2eScript
		$code = $LASTEXITCODE
	} finally {
		Pop-Location
	}
	Write-Output "E2E EXIT=$code"
	Write-Output "=== ELECTRON OUT ==="
	Get-Content $electronOut -Tail 40 -ErrorAction SilentlyContinue
	Write-Output "=== ELECTRON ERR ==="
	Get-Content $electronErr -Tail 80 -ErrorAction SilentlyContinue
	exit $code
} finally {
	if ($electron) {
		Stop-Process -Id $electron.Id -Force -ErrorAction SilentlyContinue
	}
	if ($vite) {
		Stop-Process -Id $vite.Id -Force -ErrorAction SilentlyContinue
	}
	Get-CimInstance Win32_Process -Filter "Name='electron.exe'" |
		Where-Object { $_.CommandLine -match "pi-web" } |
		ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
	Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
		Where-Object { $_.CommandLine -match "pi-web.*vite" } |
		ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}
