param([switch]$Install, [switch]$Development, [switch]$Rebuild, [switch]$Restart)
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
Set-Location -LiteralPath $projectRoot

function Get-RequiredCommand([string]$Name, [string]$HelpText) {
    $command = Get-Command $Name -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $command) { throw $HelpText }
    return $command.Source
}

function Invoke-Checked([string]$Command, [string[]]$Arguments, [string]$Failure) {
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw $Failure }
}

function Get-Listener([int]$Port) {
    $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    $processIds = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
    if ($processIds.Count -gt 1) { throw "Port $Port has multiple listening processes; close the conflicting service first." }
    if ($processIds.Count -eq 1) { return Get-Process -Id $processIds[0] -ErrorAction Stop }
    return $null
}

function Test-Api {
    try {
        $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/api/health' -TimeoutSec 2
        return ($health.app -eq 'Open FPL' -and $health.status -eq 'ok')
    } catch { return $false }
}

function Test-ProductionSite {
    try {
        $response = Invoke-WebRequest -Uri 'http://127.0.0.1:8000/' -UseBasicParsing -TimeoutSec 3
        $builtIndex = Get-Content -LiteralPath (Join-Path $projectRoot 'dist/index.html') -Raw -Encoding UTF8
        return ($response.StatusCode -eq 200 -and $response.Content.Trim() -ceq $builtIndex.Trim())
    } catch { return $false }
}

$pythonCommand = Get-RequiredCommand 'python' 'Install Python 3.11+ and add it to PATH, then run ./start.ps1 again.'
$nodeCommand = Get-RequiredCommand 'node' 'Install Node 20.19+ or 22.12+ and add it to PATH, then run ./start.ps1 again.'
$npmCommand = Get-RequiredCommand 'npm.cmd' 'npm.cmd was not found. Repair the Node installation and run ./start.ps1 again.'
$pythonVersion = & $pythonCommand -c 'import sys; print(chr(46).join(map(str, sys.version_info[:3])))'
if ($LASTEXITCODE -ne 0 -or [version]$pythonVersion -lt [version]'3.11.0') {
    throw 'Python 3.11+ is required. Check which Python is on PATH with Get-Command python.'
}
$nodeVersionText = & $nodeCommand -p 'process.versions.node'
if ($LASTEXITCODE -ne 0) { throw 'Node could not start. Repair the Node installation.' }
$nodeVersion = [version]$nodeVersionText
if (-not (($nodeVersion.Major -eq 20 -and $nodeVersion.Minor -ge 19) -or $nodeVersion -ge [version]'22.12.0')) {
    throw "Node $nodeVersion is unsupported. Install Node 20.19+ or 22.12+."
}

$existingApi = Get-Listener 8000
if ($existingApi -and -not (Test-Api)) {
    throw 'Port 8000 is already used by another or unhealthy service. It was left running; close it in its own terminal first.'
}
$runtimeDirectory = Join-Path $projectRoot 'data/cache/runtime'
$apiRecordPath = Join-Path $runtimeDirectory 'api-process.json'

function Test-OwnedApi($Process) {
    if (-not $Process -or -not (Test-Path -LiteralPath $apiRecordPath)) { return $false }
    try {
        $record = Get-Content -LiteralPath $apiRecordPath -Raw | ConvertFrom-Json
        return ($record.project_root -eq $projectRoot -and $record.process_id -eq $Process.Id -and
            [Math]::Abs((([datetime]$record.started_utc).ToUniversalTime() - $Process.StartTime.ToUniversalTime()).TotalSeconds) -lt 1)
    } catch { return $false }
}

$requirementsPath = Join-Path $projectRoot 'backend/requirements.txt'
$dependencyProbe = @'
import sys
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from pip._vendor.packaging.requirements import Requirement
issues = []
for line in Path(sys.argv[1]).read_text().splitlines():
    if not line.strip() or line.lstrip().startswith('#'):
        continue
    requirement = Requirement(line)
    try:
        if version(requirement.name) not in requirement.specifier:
            issues.append(requirement.name)
    except PackageNotFoundError:
        issues.append(requirement.name)
if issues:
    print('Missing or incompatible Python packages: ' + ', '.join(issues))
sys.exit(bool(issues))
'@
& $pythonCommand -c $dependencyProbe $requirementsPath
if ($Install -or $LASTEXITCODE -ne 0) {
    Write-Host 'Installing Python dependencies...'
    Invoke-Checked $pythonCommand @('-m', 'pip', 'install', '-r', $requirementsPath) 'Python dependency installation failed. Check the pip output above.'
}

$packagePath = Join-Path $projectRoot 'package.json'
$lockPath = Join-Path $projectRoot 'package-lock.json'
$dependencyRecordPath = Join-Path $projectRoot 'node_modules/.open-fpl-manifest.json'
$manifestHashes = @((Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash)
if (Test-Path -LiteralPath $lockPath) { $manifestHashes += (Get-FileHash -LiteralPath $lockPath -Algorithm SHA256).Hash }
$manifestHash = $manifestHashes -join ':'
$package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
$requiredPackages = @($package.dependencies.PSObject.Properties.Name) + @($package.devDependencies.PSObject.Properties.Name)
$javascriptMissing = -not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules/.bin/tsc.cmd')) -or
    -not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules/.bin/vite.cmd'))
foreach ($packageName in $requiredPackages) {
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot "node_modules/$packageName/package.json"))) { $javascriptMissing = $true }
}
$javascriptChanged = $false
if (Test-Path -LiteralPath $dependencyRecordPath) {
    try {
        $dependencyRecord = Get-Content -LiteralPath $dependencyRecordPath -Raw | ConvertFrom-Json
        $javascriptChanged = $dependencyRecord.manifest_hash -ne $manifestHash
    } catch { $javascriptChanged = $true }
} elseif (Test-Path -LiteralPath $lockPath) {
    $installedLockPath = Join-Path $projectRoot 'node_modules/.package-lock.json'
    $javascriptChanged = -not (Test-Path -LiteralPath $installedLockPath) -or
        (Get-Item -LiteralPath $lockPath).LastWriteTimeUtc -gt (Get-Item -LiteralPath $installedLockPath -ErrorAction SilentlyContinue).LastWriteTimeUtc
}
if ($Install -or $javascriptMissing -or $javascriptChanged) {
    Write-Host 'Installing JavaScript dependencies...'
    $installArguments = @('install', '--no-audit', '--no-fund')
    if (Test-Path -LiteralPath $lockPath) { $installArguments[0] = 'ci' }
    Invoke-Checked $npmCommand $installArguments 'JavaScript dependency installation failed. Check the npm output above.'
    $javascriptChanged = $true
}
@{ manifest_hash = $manifestHash } | ConvertTo-Json | Set-Content -LiteralPath $dependencyRecordPath -Encoding UTF8

if (-not $Development -or $Rebuild) {
    $builtIndexPath = Join-Path $projectRoot 'dist/index.html'
    $buildRequired = $Rebuild -or $javascriptChanged -or -not (Test-Path -LiteralPath $builtIndexPath)
    if (-not $buildRequired) {
        $buildInputs = @(Get-ChildItem -LiteralPath (Join-Path $projectRoot 'src') -File -Recurse)
        if (Test-Path -LiteralPath (Join-Path $projectRoot 'public')) {
            $buildInputs += @(Get-ChildItem -LiteralPath (Join-Path $projectRoot 'public') -File -Recurse)
        }
        $buildInputs += @(Get-ChildItem -LiteralPath $projectRoot -File | Where-Object {
            $_.Name -match '^(package(-lock)?\.json|index\.html|tsconfig.*\.json|vite\.config\..+)$'
        })
        $builtAt = (Get-Item -LiteralPath $builtIndexPath).LastWriteTimeUtc
        $buildRequired = @($buildInputs | Where-Object { $_.LastWriteTimeUtc -gt $builtAt }).Count -gt 0
    }
    if ($buildRequired) {
        Write-Host 'Building the latest production app...'
        Invoke-Checked $npmCommand @('run', 'build') 'Production build failed. The existing server was left running; fix the build error above and retry.'
    }
}

if ($existingApi) {
    $backendInputs = @(Get-ChildItem -LiteralPath (Join-Path $projectRoot 'backend') -Filter '*.py' -File -Recurse)
    $backendInputs += Get-Item -LiteralPath $requirementsPath
    $backendChanged = @($backendInputs | Where-Object { $_.LastWriteTimeUtc -gt $existingApi.StartTime.ToUniversalTime() }).Count -gt 0
    $productionMissing = -not $Development -and -not (Test-ProductionSite)
    if ($Restart -or $backendChanged -or $productionMissing) {
        if (-not (Test-OwnedApi $existingApi)) {
            throw 'The running Open FPL API needs a restart, but this script did not start it. Restart its original API terminal, then retry ./start.ps1. The process was left running.'
        }
        Write-Host 'Restarting the Open FPL API for this checkout...'
        Stop-Process -Id $existingApi.Id -ErrorAction Stop
        Wait-Process -Id $existingApi.Id -Timeout 10 -ErrorAction SilentlyContinue
        $existingApi = $null
    }
}

if (-not $existingApi) {
    New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
    $logTime = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $stdoutPath = Join-Path $runtimeDirectory "api-$logTime-out.log"
    $stderrPath = Join-Path $runtimeDirectory "api-$logTime-err.log"
    $apiProcess = Start-Process -FilePath $pythonCommand -ArgumentList @('-m', 'uvicorn', 'backend.app:app', '--host', '127.0.0.1', '--port', '8000') -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
    @{ project_root = $projectRoot; process_id = $apiProcess.Id; started_utc = $apiProcess.StartTime.ToUniversalTime().ToString('o') } |
        ConvertTo-Json | Set-Content -LiteralPath $apiRecordPath -Encoding UTF8
    $ready = $false
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        $apiProcess.Refresh()
        if ($apiProcess.HasExited) { break }
        if (Test-Api) { $ready = $true; break }
        Start-Sleep -Milliseconds 250
    }
    if (-not $ready) {
        $apiProcess.Refresh()
        if (-not $apiProcess.HasExited) { Stop-Process -Id $apiProcess.Id }
        throw "Open FPL API did not start. Inspect $stderrPath for the error."
    }
}

if ($Development) {
    $existingVite = Get-Listener 5173
    if ($existingVite) {
        $viteProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($existingVite.Id)"
        $vitePath = Join-Path $projectRoot 'node_modules'
        if (-not $viteProcess.CommandLine -or $viteProcess.CommandLine.IndexOf($vitePath, [StringComparison]::OrdinalIgnoreCase) -lt 0 -or $viteProcess.CommandLine -notmatch 'vite') {
            throw 'Port 5173 is already used by another service. It was left running; close it in its own terminal first.'
        }
        $viteInputs = @(Get-Item -LiteralPath $packagePath, $lockPath)
        $viteInputs += @(Get-ChildItem -LiteralPath $projectRoot -File | Where-Object { $_.Name -match '^vite\.config\.' })
        if ($javascriptChanged -or @($viteInputs | Where-Object { $_.LastWriteTimeUtc -gt $existingVite.StartTime.ToUniversalTime() }).Count -gt 0) {
            throw 'The Vite terminal needs a restart after dependency/configuration changes. Restart npm run dev in its original terminal. The process was left running.'
        }
        Write-Host 'Open FPL development app is already running: http://127.0.0.1:5173'
        return
    }
    Write-Host 'Open FPL development app: http://127.0.0.1:5173'
    Invoke-Checked $npmCommand @('run', 'dev') 'Vite stopped with an error. Check the output above.'
} else {
    if (-not (Test-ProductionSite)) { throw 'The API is healthy but the production site is unavailable. Run ./start.ps1 -Restart to reload its static files.' }
    Write-Host 'Open FPL is running: http://127.0.0.1:8000'
    Write-Host 'The API runs in the background. Use ./start.ps1 -Restart after changes; logs are in data/cache/runtime/.'
}
