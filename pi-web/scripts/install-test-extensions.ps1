$ErrorActionPreference = "Stop"

$piWeb = Split-Path -Parent $PSScriptRoot
$source = Join-Path $piWeb "extensions"
$target = Join-Path $piWeb ".test-agent\extensions"

New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item -Path (Join-Path $source "*.ts") -Destination $target -Force
Write-Output "Installed test extensions into $target"
