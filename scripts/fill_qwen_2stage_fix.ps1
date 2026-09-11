$ErrorActionPreference = "Continue"

# A/B: same 26 cases, backend now with semantic loop (ASCII-only)
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Python = Join-Path $Root ".venv\Scripts\python.exe"
$Log = Join-Path $Root "qwen_2stage_fix.log"

& $Python -u "$Root\scripts\bench_run.py" --label acc_qwen_2stage_fix --fresh --skip-channel-check *>> $Log
& $Python -u "$Root\scripts\bench_run.py" --label acc_qwen_2stage_fix_pass2 --skip-channel-check *>> $Log

Get-ChildItem -Path (Join-Path $Root "benchmarks\cases") -Recurse -Filter candidate_commands.txt |
    ForEach-Object {
        $arch = Join-Path $_.DirectoryName "candidate_qwen_2stage.txt"
        if (-not (Test-Path $arch)) {
            Copy-Item $_.FullName $arch
            Add-Content $Log "ARCHIVED $($_.FullName)"
        }
    }

Add-Content $Log "QWEN_2STAGE_FIX_DONE $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
