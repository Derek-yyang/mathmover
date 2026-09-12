$ErrorActionPreference = "Continue"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Python = Join-Path $Root ".venv\Scripts\python.exe"
$Log = Join-Path $Root "l3_validate.log"
& $Python -u "$Root\scripts\l3_run.py" --case "初中/A-二次函数4" --archive candidate_ds_2stage.txt *>> $Log
Add-Content $Log "L3_VALIDATE_DONE"
