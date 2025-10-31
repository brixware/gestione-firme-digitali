# Test connessione SFTP
$ftpHost = "dashboard.brixware.ws"
$ftpUser = "dashboard.brixware.ws"
$ftpPassword = "9kJY6#r8Hq"
$hostKey = "ssh-ed25519 255 GP7nN35cEd+pGyLPXMRnWAMDfY7NLY45Jq/EIvYapPA="
$winScpPath = "C:\Program Files (x86)\WinSCP\WinSCP.com"

Write-Host "Testing SFTP connection..." -ForegroundColor Cyan

$testScript = @"
option batch abort
option confirm off
open sftp://${ftpUser}:${ftpPassword}@${ftpHost}:22 -hostkey="${hostKey}" -rawsettings ProxyPort=22
pwd
ls -la
exit
"@

$testScript | & $winScpPath

if ($LASTEXITCODE -eq 0) {
    Write-Host "SFTP connection successful!" -ForegroundColor Green
} else {
    Write-Host "SFTP connection failed!" -ForegroundColor Red
}