# Configurazione
$ftpHost = "dashboard.brixware.ws"
$ftpUser = "dashboard.brixware.ws"
$ftpPassword = "9kJY6#r8Hq"
$hostKey = "ssh-ed25519 255 GP7nN35cEd+pGyLPXMRnWAMDfY7NLY45Jq/EIvYapPA="
$sftpOptions = " -hostkey=`"$hostKey`" -rawsettings ProxyPort=22"

# Comandi da eseguire
$commands = @"
option batch abort
option confirm off
open sftp://${ftpUser}:${ftpPassword}@${ftpHost}:22${sftpOptions}
cd /var/www/vhosts/dashboard.brixware.ws
rm logs
mkdir logs
chmod 775 logs
call ls -la
exit
"@

# Esegui i comandi
$commands | & "C:\Program Files (x86)\WinSCP\WinSCP.com"