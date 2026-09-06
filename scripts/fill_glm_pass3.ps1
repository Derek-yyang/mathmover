$ErrorActionPreference = "Continue"

# glm pass3：等 hy3 批次结束后，补齐 glm r1 缺失题
# 逻辑：无 candidate_glm53flash_r1.txt 的案例 = glm 从未成功过，
#       删掉其当前 candidate_commands.txt（hy3 的，已归档）让 bench_run 重生成
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Python = Join-Path $Root ".venv\Scripts\python.exe"
$Hy3Log = Join-Path $Root "hy3_fill.log"
$Log = Join-Path $Root "glm_fill.log"

Write-Output "等待 hy3_fill.log 出现 HY3_FILL_DONE ..."
while ($true) {
    if ((Test-Path $Hy3Log) -and (Select-String -Path $Hy3Log -Pattern "HY3_FILL_DONE" -Quiet)) {
        break
    }
    Start-Sleep -Seconds 60
}
Write-Output "hy3 批次完成，启动 glm pass3 $(Get-Date -Format 'HH:mm:ss')"

# 删除 glm 缺失题的当前候选（hy3 版本，已归档）
Get-ChildItem -Path (Join-Path $Root "benchmarks\cases") -Recurse -Filter candidate_commands.txt |
    ForEach-Object {
        $glmArch = Join-Path $_.DirectoryName "candidate_glm53flash_r1.txt"
        if (-not (Test-Path $glmArch)) {
            Remove-Item $_.FullName -Force
            Add-Content $Log "PASS3_CLEARED $($_.FullName)"
        }
    }

# 两轮补齐
& $Python -u "$Root\scripts\bench_run.py" --label acc_glm-5.3-flash_r1_pass3 --skip-channel-check *>> $Log
& $Python -u "$Root\scripts\bench_run.py" --label acc_glm-5.3-flash_r1_pass4 --skip-channel-check *>> $Log

# 归档最终 glm 候选
Get-ChildItem -Path (Join-Path $Root "benchmarks\cases") -Recurse -Filter candidate_commands.txt |
    ForEach-Object {
        $arch = Join-Path $_.DirectoryName "candidate_glm53flash_r1.txt"
        if (-not (Test-Path $arch)) {
            Copy-Item $_.FullName $arch
            Add-Content $Log "ARCHIVED $($_.FullName)"
        }
    }

Add-Content -Path $Log -Value "GLM_PASS3_DONE $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
