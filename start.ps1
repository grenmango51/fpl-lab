param([switch]$Install, [switch]$Development)
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$existingApi = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
if ($existingApi) {
    try {
        $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/api/health' -TimeoutSec 5
    } catch { throw 'Port 8000 is already used by another service.' }
    if ($health.app -ne 'Open FPL') { throw 'Port 8000 is already used by another service.' }
    if (-not $Development) {
        Write-Host 'Open FPL is already running: http://127.0.0.1:8000'
        return
    }
}
if ($Install) {
    python -m pip install -r backend/requirements.txt
    if ($LASTEXITCODE -ne 0) { throw 'Python dependency installation failed.' }
    npm.cmd install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'JavaScript dependency installation failed.' }
}
if ($Development) {
    $existingApi = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
    if (-not $existingApi) {
        Start-Process -FilePath 'python' -ArgumentList @('-m','uvicorn','backend.app:app','--host','127.0.0.1','--port','8000') -WorkingDirectory $projectRoot -WindowStyle Hidden
    }
    npm.cmd run dev
} else {
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'dist/index.html'))) {
        npm.cmd run build
        if ($LASTEXITCODE -ne 0) { throw 'Production build failed.' }
    }
    Write-Host 'Open FPL: http://127.0.0.1:8000'
    python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000
}
