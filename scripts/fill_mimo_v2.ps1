$ErrorActionPreference = "Continue"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Python = Join-Path $Root ".venv\Scripts\python.exe"
$Log = Join-Path $Root "mimo_v2.log"
$Cutoff = Get-Date
& $Python -u "$Root\scripts\bench_run.py" --label acc_mimo_v2 --fresh --skip-channel-check *>> $Log
& $Python -u "$Root\scripts\bench_run.py" --label acc_mimo_v2_pass2 --skip-channel-check *>> $Log
Get-ChildItem -Path (Join-Path $Root "benchmarks\cases") -Recurse -Filter candidate_commands.txt |
    ForEach-Object {
        if ($_.LastWriteTime -lt $Cutoff) { return }
        $arch = Join-Path $_.DirectoryName "candidate_mimo_v2.txt"
        if (-not (Test-Path $arch)) {
            Copy-Item $_.FullName $arch
            Add-Content $Log "ARCHIVED $($_.FullName)"
        }
    }
Add-Content $Log "MIMO_V2_DONE $(Get-Date -Format yyyy-MM-dd HH:mm:ss)"
