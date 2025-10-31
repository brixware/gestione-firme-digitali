// Wrapper per l'applicazione che si trova in httpdocs
const path = require('path');
const fs = require('fs');

// Imposta un timeout globale per l'inizializzazione
const INIT_TIMEOUT = 60000; // 60 secondi

// Directory di base dell'applicazione
const appDir = __dirname;
const httpdocsDir = path.join(appDir, 'httpdocs');

// Configura le directory per i moduli
process.env.NODE_PATH = [
    path.join(httpdocsDir, 'node_modules'),
    path.join(appDir, 'node_modules')
].join(path.delimiter);

// Aggiorna i path dei moduli
require('module').Module._initPaths();

// Carica il file .env se esiste
const envPath = path.join(appDir, '.env');
if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
}

// Imposta l'ambiente di produzione se non specificato
process.env.NODE_ENV = process.env.NODE_ENV || 'production';

// Imposta il timeout per il caricamento dell'applicazione
const LOAD_TIMEOUT = 30000; // 30 secondi

// Carica l'applicazione con un timeout
const loadApp = new Promise((resolve, reject) => {
    // Imposta un timeout per il caricamento
    const timeoutId = setTimeout(() => {
        reject(new Error('Timeout durante l\'inizializzazione dell\'applicazione'));
    }, INIT_TIMEOUT);

    try {
        // Carica il logger dopo che .env è stato caricato
        process.env.LOG_DIR = '/var/www/vhosts/dashboard.brixware.ws/logs';
        const { info, error } = require('./httpdocs/src/utils/logger');

        // Gestione degli errori non catturati
        process.on('uncaughtException', (err) => {
            error('Uncaught Exception:', err);
            // Dai al logger il tempo di scrivere prima di uscire
            setTimeout(() => process.exit(1), 1000);
        });

        process.on('unhandledRejection', (reason, promise) => {
            error('Unhandled Rejection at:', promise, 'reason:', reason);
            // Non terminiamo il processo, ma logghiamo l'errore
        });

        info('Loading application...');
        info('Node version:', process.version);
        info('Environment:', process.env.NODE_ENV);
        info('Current directory:', process.cwd());
        info('Module paths:', module.paths);

        const app = require('./httpdocs/app.js');
        info('Application loaded successfully');
        resolve(app);
    } catch (err) {
        reject(err);
    }
});

// Esporta una Promise che si risolve con l'applicazione o viene rifiutata dopo il timeout
module.exports = Promise.race([
    loadApp,
    new Promise((_, reject) => {
        setTimeout(() => {
            reject(new Error(`Application load timed out after ${LOAD_TIMEOUT}ms`));
        }, LOAD_TIMEOUT);
    })
]);