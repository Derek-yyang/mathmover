$ErrorActionPreference = "Continue"

# glm pass3 (ASCII-only): clear candidates for cases without a glm archive,
# regenerate with glm-5.3-flash (config.json already restored to glm), archive.

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Python = Join-Path $Root ".venv\Scripts\python.exe"
$Log = Join-Path $Root "glm_fill.log"

Get-ChildItem -Path (Join-Path $Root "benchmarks\cases") -Recurse -Filter candidate_commands.txt |
    ForEach-Object {
        $glmArch = Join-Path $_.DirectoryName "candidate_glm53flash_r1.txt"
        if (-not (Test-Path $glmArch)) {
            Remove-Item $_.FullName -Force
            Add-Content $Log "PASS3_CLEARED $($_.FullName)"
        }
    }

& $Python -u "$Root\scripts\bench_run.py" --label acc_glm-5.3-flash_r1_pass3 --skip-channel-check *>> $Log
& $Python -u "$Root\scripts\bench_run.py" --label acc_glm-5.3-flash_r1_pass4 --skip-channel-check *>> $Log

Get-ChildItem -Path (Join-Path $Root "benchmarks\cases") -Recurse -Filter candidate_commands.txt |
    ForEach-Object {
        $arch = Join-Path $_.DirectoryName "candidate_glm53flash_r1.txt"
        if (-not (Test-Path $arch)) {
            Copy-Item $_.FullName $arch
            Add-Content $Log "ARCHIVED_GLM $($_.FullName)"
        }
    }

Add-Content -Path $Log -Value "GLM_PASS3_DONE $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
