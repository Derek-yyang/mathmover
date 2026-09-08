$ErrorActionPreference = "Continue"

# deepseek r2+r3 on AMD Radeon Cloud (ASCII-only). Config stays DeepSeek-V4-Flash-Vision-Exp.
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Python = Join-Path $Root ".venv\Scripts\python.exe"
$Log = Join-Path $Root "ds_r23.log"

# ---- round 2 ----
& $Python -u "$Root\scripts\bench_run.py" --label acc_deepseek-v4-vision_r2 --fresh --skip-channel-check *>> $Log
& $Python -u "$Root\scripts\bench_run.py" --label acc_deepseek-v4-vision_r2_pass2 --skip-channel-check *>> $Log
Get-ChildItem -Path (Join-Path $Root "benchmarks\cases") -Recurse -Filter candidate_commands.txt |
    ForEach-Object {
        $arch = Join-Path $_.DirectoryName "candidate_ds_r2.txt"
        if (-not (Test-Path $arch)) {
            Copy-Item $_.FullName $arch
            Add-Content $Log "ARCHIVED_R2 $($_.FullName)"
        }
    }
Add-Content $Log "DS_R2_DONE $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"

# ---- round 3 ----
& $Python -u "$Root\scripts\bench_run.py" --label acc_deepseek-v4-vision_r3 --fresh --skip-channel-check *>> $Log
& $Python -u "$Root\scripts\bench_run.py" --label acc_deepseek-v4-vision_r3_pass2 --skip-channel-check *>> $Log
Get-ChildItem -Path (Join-Path $Root "benchmarks\cases") -Recurse -Filter candidate_commands.txt |
    ForEach-Object {
        $arch = Join-Path $_.DirectoryName "candidate_ds_r3.txt"
        if (-not (Test-Path $arch)) {
            Copy-Item $_.FullName $arch
            Add-Content $Log "ARCHIVED_R3 $($_.FullName)"
        }
    }
Add-Content $Log "DS_R3_DONE $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
