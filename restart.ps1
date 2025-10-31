$ftpHost = "dashboard.brixware.ws"
$ftpUser = "dashboard.brixware.ws"
$ftpPassword = "9kJY6#r8Hq"
$remoteBasePath = "/var/www/vhosts/dashboard.brixware.ws"
$winScpPath = "C:\Program Files (x86)\WinSCP\WinSCP.com"

$restartScript = @"
option batch abort
option confirm off
open sftp://${ftpUser}:${ftpPassword}@${ftpHost} -hostkey="ssh-ed25519 255 u0ue3hnBERd9gYMsuYYsZrUayDWKH/XVuI3VQ1CgGXE="
cd $remoteBasePath
call touch tmp/restart.txt
exit
"@

$restartScript | & $winScpPath