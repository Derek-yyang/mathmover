$ErrorActionPreference = "Continue"

# hy3 batch runner: archive glm candidates -> switch config -> run 26 cases ->
# second fill pass -> archive hy3 candidates -> restore config.
# NOTE: keep this file ASCII-only; PowerShell 5.1 mis-parses UTF-8 no-BOM CJK comments.

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Python = Join-Path $Root ".venv\Scripts\python.exe"
$Log = Join-Path $Root "hy3_fill.log"
$Cfg = Join-Path $Root "config.json"

# 0) channel health gate: wait up to 3h for the distributor to recover
$deadline = (Get-Date).AddHours(3)
while ($true) {
    & $Python -u "$Root\scripts\probe_channel.py" hy3 *> $null
    if ($LASTEXITCODE -eq 0) {
        Add-Content $Log "CHANNEL_OK hy3 $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
        break
    }
    if ((Get-Date) -gt $deadline) {
        Add-Content $Log "CHANNEL_TIMEOUT hy3 $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
        break
    }
    Add-Content $Log "CHANNEL_WAIT hy3 $(Get-Date -Format 'HH:mm:ss')"
    Start-Sleep -Seconds 120
}

# 1) archive glm-5.3-flash r1 candidates (protect from --fresh overwrite)
Get-ChildItem -Path (Join-Path $Root "benchmarks\cases") -Recurse -Filter candidate_commands.txt |
    ForEach-Object {
        $arch = Join-Path $_.DirectoryName "candidate_glm53flash_r1.txt"
        if (-not (Test-Path $arch)) {
            Copy-Item $_.FullName $arch
            Add-Content $Log "ARCHIVED_GLM $($_.FullName)"
        }
    }

# 2) switch config.json to hy3 (backend re-reads per request)
$hy3Cfg = @"
{
  "provider": "openai_compatible",
  "base_url": "https://api.b.ai/v1",
  "api_key": "sk-2gvwqexgxj3b9c7up95j7qvj2uzxrptx",
  "model_name": "hy3",
  "timeout_seconds": "300"
}
"@
[System.IO.File]::WriteAllText($Cfg, $hy3Cfg)

# 3) full 26-case run (--fresh overwrites glm candidates; glm already archived)
& $Python -u "$Root\scripts\bench_run.py" --label acc_hy3_r1 --fresh --skip-channel-check *>> $Log
# second pass fills whatever failed (no --fresh: skips existing candidates)
& $Python -u "$Root\scripts\bench_run.py" --label acc_hy3_r1_pass2 --skip-channel-check *>> $Log

# 4) archive hy3 candidates
Get-ChildItem -Path (Join-Path $Root "benchmarks\cases") -Recurse -Filter candidate_commands.txt |
    ForEach-Object {
        $arch = Join-Path $_.DirectoryName "candidate_hy3_r1.txt"
        if (-not (Test-Path $arch)) {
            Copy-Item $_.FullName $arch
            Add-Content $Log "ARCHIVED_HY3 $($_.FullName)"
        }
    }

# 5) restore config.json to production model (glm-5.3-flash)
$prodCfg = @"
{
  "provider": "openai_compatible",
  "base_url": "https://api.b.ai/v1",
  "api_key": "sk-2gvwqexgxj3b9c7up95j7qvj2uzxrptx",
  "model_name": "glm-5.3-flash",
  "timeout_seconds": "300"
}
"@
[System.IO.File]::WriteAllText($Cfg, $prodCfg)

Add-Content -Path $Log -Value "HY3_FILL_DONE $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
