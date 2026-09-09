$ErrorActionPreference = "Continue"

# A/B: same 26 cases, backend now with semantic loop (ASCII-only)
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Python = Join-Path $Root ".venv\Scripts\python.exe"
$Log = Join-Path $Root "ds_linkab.log"

& $Python -u "$Root\scripts\bench_run.py" --label acc_ds_amd_linkab --fresh --skip-channel-check *>> $Log
& $Python -u "$Root\scripts\bench_run.py" --label acc_ds_amd_linkab_pass2 --skip-channel-check *>> $Log

Get-ChildItem -Path (Join-Path $Root "benchmarks\cases") -Recurse -Filter candidate_commands.txt |
    ForEach-Object {
        $arch = Join-Path $_.DirectoryName "candidate_ds_amdv2_link.txt"
        if (-not (Test-Path $arch)) {
            Copy-Item $_.FullName $arch
            Add-Content $Log "ARCHIVED $($_.FullName)"
        }
    }

Add-Content $Log "LINKAB_DONE $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
