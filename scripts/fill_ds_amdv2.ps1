$ErrorActionPreference = "Continue"

# deepseek re-screen on updated AMD deployment (ASCII-only)
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Python = Join-Path $Root ".venv\Scripts\python.exe"
$Log = Join-Path $Root "ds_amdv2.log"

& $Python -u "$Root\scripts\bench_run.py" --label acc_ds_amdv2_r1 --fresh --skip-channel-check *>> $Log
& $Python -u "$Root\scripts\bench_run.py" --label acc_ds_amdv2_r1_pass2 --skip-channel-check *>> $Log

Get-ChildItem -Path (Join-Path $Root "benchmarks\cases") -Recurse -Filter candidate_commands.txt |
    ForEach-Object {
        $arch = Join-Path $_.DirectoryName "candidate_ds_amdv2.txt"
        if (-not (Test-Path $arch)) {
            Copy-Item $_.FullName $arch
            Add-Content $Log "ARCHIVED $($_.FullName)"
        }
    }

Add-Content $Log "DS_AMDV2_DONE $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
