$ErrorActionPreference = "Continue"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Python = Join-Path $Root ".venv\Scripts\python.exe"
$Log = Join-Path $Root "hy3_fill.log"
$Cfg = Join-Path $Root "config.json"

# 0) 通道健康门禁：分销商抖动/故障期等待恢复（最长 3 小时），避免整批空烧
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

# 1) 归档 glm-5.3-flash r1 候选（防被 --fresh 覆盖；已存在的归档不动）
Get-ChildItem -Path (Join-Path $Root "benchmarks\cases") -Recurse -Filter candidate_commands.txt |
    ForEach-Object {
        $arch = Join-Path $_.DirectoryName "candidate_glm53flash_r1.txt"
        if (-not (Test-Path $arch)) {
            Copy-Item $_.FullName $arch
            Add-Content $Log "ARCHIVED $($_.FullName)"
        }
    }

# 1) config.json 切到 hy3（后端每请求重读，即时生效）
@"
{
  "provider": "openai_compatible",
  "base_url": "https://api.b.ai/v1",
  "api_key": "sk-2gvwqexgxj3b9c7up95j7qvj2uzxrptx",
  "model_name": "hy3",
  "timeout_seconds": "300"
}
"@ | Set-Content -Path $Cfg -Encoding Ascii

# 2) 全量 26 题重跑（--fresh 覆盖 glm 候选，glm 已归档）
& $Python -u "$Root\scripts\bench_run.py" --label acc_hy3_r1 --fresh --skip-channel-check *>> $Log
# 第二轮兜底（无 --fresh 只跑缺候选的题）
& $Python -u "$Root\scripts\bench_run.py" --label acc_hy3_r1_pass2 --skip-channel-check *>> $Log

# 3) 归档 hy3 候选
Get-ChildItem -Path (Join-Path $Root "benchmarks\cases") -Recurse -Filter candidate_commands.txt |
    ForEach-Object {
        $arch = Join-Path $_.DirectoryName "candidate_hy3_r1.txt"
        if (-not (Test-Path $arch)) {
            Copy-Item $_.FullName $arch
            Add-Content $Log "ARCHIVED $($_.FullName)"
        }
    }

# 4) config.json 恢复生产模型（glm-5.3-flash）
@"
{
  "provider": "openai_compatible",
  "base_url": "https://api.b.ai/v1",
  "api_key": "sk-2gvwqexgxj3b9c7up95j7qvj2uzxrptx",
  "model_name": "glm-5.3-flash",
  "timeout_seconds": "300"
}
"@ | Set-Content -Path $Cfg -Encoding Ascii

Add-Content -Path $Log -Value "HY3_FILL_DONE $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
