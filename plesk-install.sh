#!/bin/bash

# Imposta ambiente Node.js
NODE_VERSION="25"
echo $NODE_VERSION > .node-version

# Usa la versione corretta di Node.js
eval "$(nodenv init -)"
nodenv shell $NODE_VERSION

# Vai alla directory dell'applicazione
cd /var/www/vhosts/dashboard.brixware.ws

# Installa pm2 localmente
npm install pm2 --save

# Installa le dipendenze nella root
echo "Installing root dependencies..."
npm install --production

# Vai alla directory httpdocs
cd httpdocs

# Installa le dipendenze dell'applicazione
echo "Installing application dependencies..."
npm install --production

# Crea le directory necessarie se non esistono
mkdir -p logs
mkdir -p uploads/avatars
mkdir -p tmp

# Imposta i permessi corretti per Plesk
find . -type d -exec chmod 755 {} \;
find . -type f -exec chmod 644 {} \;
chmod 755 src/app.js
chmod 755 root-app.js
chmod -R 775 logs
chmod -R 775 uploads
chmod -R 775 tmp

# Avvia l'applicazione con pm2
cd /var/www/vhosts/dashboard.brixware.ws
npx pm2 delete all 2>/dev/null || true
NODE_ENV=production npx pm2 start root-app.js --name "dashboard"
npx pm2 save
npx pm2 startup || true # Ignora errori di startup che richiedono root

# Riavvia l'applicazione in Plesk
touch tmp/restart.txt

echo "Setup completed successfully!"