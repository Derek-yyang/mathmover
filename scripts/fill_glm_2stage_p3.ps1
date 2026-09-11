$ErrorActionPreference = "Continue"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Python = Join-Path $Root ".venv\Scripts\python.exe"
$Log = Join-Path $Root "glm_2stage_p3.log"
& $Python -u "$Root\scripts\bench_run.py" --label acc_glm_2stage_p3 --skip-channel-check *>> $Log
Get-ChildItem -Path (Join-Path $Root "benchmarks\cases") -Recurse -Filter candidate_commands.txt |
    ForEach-Object {
        $arch = Join-Path $_.DirectoryName "candidate_glm_2stage.txt"
        if (-not (Test-Path $arch)) {
            Copy-Item $_.FullName $arch
            Add-Content $Log "ARCHIVED $($_.FullName)"
        }
    }
Add-Content $Log "GLM_2STAGE_P3_DONE $(Get-Date -Format yyyy-MM-dd HH:mm:ss)"
