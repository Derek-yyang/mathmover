$ErrorActionPreference = "Continue"

# glm watchdog (ASCII-only): probe with a generation-shaped request every 5 min;
# when the channel accepts a vision generation, fill the missing glm cases.
# Runs up to 12h, then archives whatever exists and writes the marker.

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Python = Join-Path $Root ".venv\Scripts\python.exe"
$Log = Join-Path $Root "glm_fill.log"
$Deadline = (Get-Date).AddHours(12)

while ((Get-Date) -lt $Deadline) {
    # done when every case has a glm archive candidate
    $cases = Get-ChildItem -Path (Join-Path $Root "benchmarks\cases") -Recurse -Directory
    $missing = 0
    foreach ($c in $cases) {
        if (-not (Test-Path (Join-Path $c.FullName "candidate_glm53flash_r1.txt"))) {
            $missing++
        }
    }
    if ($missing -eq 0) {
        Add-Content $Log "WATCHDOG_ALL_PRESENT $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
        break
    }

    & $Python -u "$Root\scripts\probe_glm_gen.py" *> $null
    if ($LASTEXITCODE -eq 0) {
        Add-Content $Log "WATCHDOG_GEN_OK -> fill pass $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
        & $Python -u "$Root\scripts\bench_run.py" --label acc_glm-5.3-flash_r1_pass5 --skip-channel-check *>> $Log
    } else {
        Add-Content $Log "WATCHDOG_WAIT $(Get-Date -Format 'HH:mm:ss')"
    }
    Start-Sleep -Seconds 300
}

# archive whatever candidate_commands.txt exist that lack a glm archive
Get-ChildItem -Path (Join-Path $Root "benchmarks\cases") -Recurse -Filter candidate_commands.txt |
    ForEach-Object {
        $arch = Join-Path $_.DirectoryName "candidate_glm53flash_r1.txt"
        if (-not (Test-Path $arch)) {
            Copy-Item $_.FullName $arch
            Add-Content $Log "ARCHIVED_GLM $($_.FullName)"
        }
    }

Add-Content -Path $Log -Value "GLM_WATCHDOG_DONE $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
