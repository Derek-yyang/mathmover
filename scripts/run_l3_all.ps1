$ErrorActionPreference = "Continue"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Python = Join-Path $Root ".venv\Scripts\python.exe"
$Log = Join-Path $Root "l3_all.log"
& $Python "$Root\scripts\switch_provider.py" use b_ai qwen3.8-flash --no-probe *>> $Log
& $Python -u "$Root\scripts\l3_run.py" --archive candidate_mimo_2stage.txt *>> $Log
& $Python "$Root\scripts\switch_provider.py" use b_ai mimo-v2.5 --no-probe *>> $Log
& $Python -u "$Root\scripts\l3_run.py" --archive candidate_glm_2stage.txt *>> $Log
& $Python -u "$Root\scripts\l3_run.py" --archive candidate_qwen_2stage.txt *>> $Log
& $Python -u "$Root\scripts\l3_run.py" --archive candidate_ds_2stage.txt *>> $Log
Add-Content $Log "L3_ALL_DONE $(Get-Date -Format yyyy-MM-dd HH:mm:ss)"
