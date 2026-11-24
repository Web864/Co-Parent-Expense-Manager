# Run by a private Windows task account with restricted .env access.
$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskRoot
New-Item -ItemType Directory -Path (Join-Path $taskRoot 'backups') -Force | Out-Null
& npm.cmd run backup 2>&1 | Tee-Object -FilePath (Join-Path $taskRoot 'backups/backup-job.log') -Append
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
