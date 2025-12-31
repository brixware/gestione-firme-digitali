# Configurazione
$ftpHost = "dashboard.brixware.ws"
$ftpUser = "dashboard.brixware.ws"
$ftpPassword = "9kJY6#r8Hq"
$remoteBasePath = "/var/www/vhosts/dashboard.brixware.ws"
$remoteHttdocsPath = "$remoteBasePath/httpdocs"
$winScpPath = "C:\Program Files (x86)\WinSCP\WinSCP.com"
$localBasePath = $PSScriptRoot
$hostKey = "ssh-ed25519 255 GP7nN35cEd+pGyLPXMRnWAMDfY7NLY45Jq/EIvYapPA="
$sftpOptions = " -hostkey=`"$hostKey`" -rawsettings ProxyPort=22"

# Funzioni di logging
function Write-Step {
    param([string]$Message)
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Message)
    Write-Host $Message -ForegroundColor Green
}

# Verifica WinSCP
if (-not (Test-Path $winScpPath)) {
    Write-Error "WinSCP non trovato in $winScpPath"
    exit 1
}

# File da escludere
$excludeFiles = @(
    ".git",
    "node_modules",
    ".env",
    ".env.*",
    "*.log",
    "logs/*",
    "deploy.ps1",
    "deploy.ps1.old",
    "backups",
    "deploy",
    "*.ps1",
    "test-*.js",
    "reset.sql",
    "app-startup.log"
)

# Script sensibili da non caricare mai in produzione
$excludeScripts = @(
    "scripts\resetPassword.js",
    "scripts\resetPasswordProduction.js",
    "scripts\compareDatabase.js",
    "scripts\recreateUser.js",
    "scripts\testConnection.js",
    "scripts\testChangePassword.js"
)

# Prepara deploy
Write-Step "Preparazione ambiente locale..."
$deployDir = Join-Path $localBasePath "deploy"
New-Item -ItemType Directory -Force -Path $deployDir | Out-Null

# Copia file
Get-ChildItem -Path $localBasePath -Exclude ($excludeFiles + @("deploy")) | ForEach-Object {
    if ($_.FullName -ne $deployDir) {
        $shouldExclude = $false
        foreach ($pattern in $excludeScripts) {
            $fullPattern = Join-Path $localBasePath $pattern
            if ($_.FullName -like $fullPattern -or $_.FullName -eq $fullPattern) {
                $shouldExclude = $true
                break
            }
        }
        
        if (-not $shouldExclude) {
            if ($_.PSIsContainer) {
                Copy-Item -Path $_.FullName -Destination (Join-Path $deployDir $_.Name) -Recurse -Force
            } else {
                Copy-Item -Path $_.FullName -Destination $deployDir -Force
            }
        }
    }
}

# Rimuovi gli script sensibili dalla cartella deploy/scripts se presenti
foreach ($script in $excludeScripts) {
    $scriptPath = Join-Path $deployDir $script
    if (Test-Path $scriptPath) {
        Remove-Item $scriptPath -Force
        Write-Host "Rimosso script sensibile: $script" -ForegroundColor Yellow
    }
}

# Copia il wrapper app.js
Copy-Item "$localBasePath\root-app.js" "$deployDir\root-app.js" -Force

# Copia lo script di setup per Plesk
Copy-Item "$localBasePath\plesk-install.sh" "$deployDir\plesk-install.sh" -Force

# Copia il file di configurazione
if (Test-Path "$localBasePath\.env.production") {
    Copy-Item "$localBasePath\.env.production" "$deployDir\.env" -Force
} else {
    Write-Warning "File .env.production non trovato"
}

# Copia il file .node-version
Set-Content "$deployDir\.node-version" "25" -Force

# Deploy via WinSCP
Write-Step "Preparazione directories su Plesk..."

# Setup iniziale e creazione directories
$setupScript = @"
option batch abort
option confirm off
open sftp://${ftpUser}:${ftpPassword}@${ftpHost}:22${sftpOptions}
cd "$remoteBasePath/httpdocs"
mkdir config
mkdir logs
mkdir public
mkdir scripts
mkdir src
mkdir uploads
chmod 775 .
chmod 775 config
chmod 775 logs
chmod 775 public
chmod 775 scripts
chmod 775 src
chmod 775 uploads
exit
"@

$setupScript | & $winScpPath

# Poi facciamo il deploy di ogni directory separatamente
$deployScript = @"
option batch abort
option confirm off
open sftp://${ftpUser}:${ftpPassword}@${ftpHost}:22${sftpOptions}
# Prima carico i file nella root
cd "$remoteBasePath"
put -transfer=ascii "$deployDir\.node-version" .node-version
put -transfer=ascii "$deployDir\root-app.js" ./root-app.js
put -transfer=ascii "$deployDir\package.json" ./package.json
put -transfer=ascii "$deployDir\.env" .env
put -transfer=ascii "$deployDir\plesk-install.sh" ./plesk-install.sh

# Poi carico tutto il resto in httpdocs
cd "$remoteHttdocsPath"
option transfer binary
put -transfer=ascii "$deployDir\.user.ini" ./.user.ini
put -transfer=ascii "$deployDir\.gitignore" .gitignore
put "$deployDir\config\*" config/
put "$deployDir\public\*" public/
put "$deployDir\scripts\*" scripts/
put "$deployDir\src\*" src/
put -transfer=ascii "$deployDir\app.js" ./app.js
put -transfer=ascii "$deployDir\package.json" ./package.json
put -transfer=ascii "$deployDir\package-lock.json" ./package-lock.json
exit
"@

Write-Step "Caricamento files..."
$deployScript | & $winScpPath

if ($LASTEXITCODE -ne 0) {
    Write-Error "Deploy fallito"
    exit 1
}

# Eseguo i comandi post-deploy
Write-Step "Esecuzione setup Plesk..."

$postDeployScript = @"
option batch abort
option confirm off
open sftp://${ftpUser}:${ftpPassword}@${ftpHost}:22${sftpOptions}
cd $remoteBasePath
chmod 755 plesk-install.sh
call sh ./plesk-install.sh
exit
"@

$postDeployScript | & $winScpPath

if ($LASTEXITCODE -ne 0) {
    Write-Error "Setup Plesk fallito"
    exit 1
}

# Pulizia
Remove-Item -Recurse -Force $deployDir

Write-Success "Deploy e configurazione completati con successo!"