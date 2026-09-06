$ErrorActionPreference = "Continue"

# 串联编排：等 glm 补跑结束（FILL_DONE 标记）后自动启动 hy3 批次
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$GlmLog = Join-Path $Root "glm_fill.log"

Write-Output "等待 glm_fill.log 出现 FILL_DONE ..."
while ($true) {
    if ((Test-Path $GlmLog) -and (Select-String -Path $GlmLog -Pattern "FILL_DONE" -Quiet)) {
        break
    }
    Start-Sleep -Seconds 60
}
Write-Output "glm 补跑完成，启动 hy3 批次 $(Get-Date -Format 'HH:mm:ss')"

& powershell -NoProfile -ExecutionPolicy Bypass -File "$Root\scripts\fill_hy3.ps1"

Add-Content -Path (Join-Path $Root "glm_fill.log") -Value "ALL_DONE $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
