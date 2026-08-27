$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$PidPath = Join-Path $Root "backend-local.pid"
$OutLog = Join-Path $Root "backend-local.out.log"
$ErrLog = Join-Path $Root "backend-local.err.log"
$VenvPython = Join-Path $Root ".venv\Scripts\python.exe"

if (Test-Path $PidPath) {
    $ExistingPidText = (Get-Content -Raw $PidPath).Trim()
    if ($ExistingPidText -match "^\d+$") {
        $ExistingProcess = Get-Process -Id ([int]$ExistingPidText) -ErrorAction SilentlyContinue
        if ($ExistingProcess) {
            Write-Host "Backend already appears to be running. PID: $ExistingPidText"
            Write-Host "URL: http://127.0.0.1:5000/api/"
            exit 0
        }
    }
}

if (Test-Path $VenvPython) {
    $Python = $VenvPython
} else {
    $Python = "python"
}

$Process = Start-Process `
    -FilePath $Python `
    -ArgumentList "app.py" `
    -WorkingDirectory $Root `
    -RedirectStandardOutput $OutLog `
    -RedirectStandardError $ErrLog `
    -WindowStyle Hidden `
    -PassThru

Set-Content -Path $PidPath -Value $Process.Id

Write-Host "Backend started. PID: $($Process.Id)"
Write-Host "URL: http://127.0.0.1:5000/api/"
Write-Host "Logs: $OutLog"
