#!/bin/bash

# Funzione di verifica prerequisiti
check_prerequisites() {
    echo "Verifico i prerequisiti..."
    
    # Verifica Passenger
    if ! command -v passenger-config >/dev/null 2>&1; then
        echo "Error: Passenger non è installato"
        exit 1
    fi
    
    # Verifica Node.js
    if ! command -v node >/dev/null 2>&1; then
        echo "Error: Node.js non è installato"
        exit 1
    fi
    
    echo "Tutti i prerequisiti sono soddisfatti"
}

# Verifica i prerequisiti
check_prerequisites

# Vai alla directory radice
cd /var/www/vhosts/dashboard.brixware.ws

# Configurazione per Plesk Node.js
echo "22.21.0" > .node-version

# Installa le dipendenze nella directory radice
npm install

# Vai alla directory httpdocs
cd httpdocs

# Installa le dipendenze anche qui
npm install

# Torna alla radice
cd ..

# Crea le directory necessarie
mkdir -p logs
mkdir -p tmp

# Imposta i permessi corretti
chmod 755 root-app.js
chmod 755 .passenger-version
chmod 755 httpdocs
chmod 755 httpdocs/config
chmod 755 httpdocs/public
chmod 755 httpdocs/scripts
chmod 755 httpdocs/src
chmod -R 777 logs
chmod -R 755 tmp

# Copia la configurazione nginx se esiste
if [ -f nginx-custom.conf ]; then
    sudo cp nginx-custom.conf /etc/nginx/sites-available/dashboard.brixware.ws
    sudo service nginx reload
fi

# Riavvia il processo Passenger
touch tmp/restart.txt