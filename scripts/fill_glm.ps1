$ErrorActionPreference = "Continue"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Python = Join-Path $Root ".venv\Scripts\python.exe"
$Log = Join-Path $Root "glm_fill.log"

# 两轮补齐：bench_run 无 --fresh 时自动跳过已有候选的题，
# 第一轮漏掉的（上游抖动）由第二轮兜底；错误事件已由 bench_run 内置重试
& $Python -u "$Root\scripts\bench_run.py" --label acc_glm-5.3-flash_r1 --skip-channel-check *>> $Log
& $Python -u "$Root\scripts\bench_run.py" --label acc_glm-5.3-flash_r1_pass2 --skip-channel-check *>> $Log

Add-Content -Path $Log -Value "FILL_DONE $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
