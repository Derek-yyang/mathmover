$ErrorActionPreference = "Continue"

# glm r2+r3 acceptance rounds (ASCII-only). Config stays glm-5.3-flash throughout.
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Python = Join-Path $Root ".venv\Scripts\python.exe"
$Log = Join-Path $Root "glm_r23.log"

# ---- round 2 ----
& $Python -u "$Root\scripts\bench_run.py" --label acc_glm-5.3-flash_r2 --fresh --skip-channel-check *>> $Log
& $Python -u "$Root\scripts\bench_run.py" --label acc_glm-5.3-flash_r2_pass2 --skip-channel-check *>> $Log
Get-ChildItem -Path (Join-Path $Root "benchmarks\cases") -Recurse -Filter candidate_commands.txt |
    ForEach-Object {
        $arch = Join-Path $_.DirectoryName "candidate_glm53flash_r2.txt"
        if (-not (Test-Path $arch)) {
            Copy-Item $_.FullName $arch
            Add-Content $Log "ARCHIVED_R2 $($_.FullName)"
        }
    }
Add-Content $Log "GLM_R2_DONE $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"

# ---- round 3 ----
& $Python -u "$Root\scripts\bench_run.py" --label acc_glm-5.3-flash_r3 --fresh --skip-channel-check *>> $Log
& $Python -u "$Root\scripts\bench_run.py" --label acc_glm-5.3-flash_r3_pass2 --skip-channel-check *>> $Log
Get-ChildItem -Path (Join-Path $Root "benchmarks\cases") -Recurse -Filter candidate_commands.txt |
    ForEach-Object {
        $arch = Join-Path $_.DirectoryName "candidate_glm53flash_r3.txt"
        if (-not (Test-Path $arch)) {
            Copy-Item $_.FullName $arch
            Add-Content $Log "ARCHIVED_R3 $($_.FullName)"
        }
    }
Add-Content $Log "GLM_R3_DONE $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
