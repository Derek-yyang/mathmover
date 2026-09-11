$ErrorActionPreference = "Continue"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Python = Join-Path $Root ".venv\Scripts\python.exe"
$Log = Join-Path $Root "mimo_2stage.log"
$Cutoff = Get-Date
& $Python -u "$Root\scripts\bench_run.py" --label acc_mimo_2stage --fresh --skip-channel-check *>> $Log
& $Python -u "$Root\scripts\bench_run.py" --label acc_mimo_2stage_pass2 --skip-channel-check *>> $Log
Get-ChildItem -Path (Join-Path $Root "benchmarks\cases") -Recurse -Filter candidate_commands.txt |
    ForEach-Object {
        if ($_.LastWriteTime -lt $Cutoff) { return }
        $arch = Join-Path $_.DirectoryName "candidate_mimo_2stage.txt"
        if (-not (Test-Path $arch)) {
            Copy-Item $_.FullName $arch
            Add-Content $Log "ARCHIVED $($_.FullName)"
        }
    }
Add-Content $Log "MIMO_2STAGE_DONE $(Get-Date -Format yyyy-MM-dd HH:mm:ss)"
