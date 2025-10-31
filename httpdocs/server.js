// Server wrapper
const path = require('path');
const fs = require('fs');

// Imposta un timeout globale per l'inizializzazione
const INIT_TIMEOUT = 60000; // 60 secondi

// Directory di base dell'applicazione
const appDir = path.resolve(__dirname);
const projectRoot = path.resolve(appDir, '..');

// Configura le directory per i moduli
process.env.NODE_PATH = [
    path.join(appDir, 'node_modules'),
    path.join(projectRoot, 'node_modules')
].join(path.delimiter);

// Aggiorna i path dei moduli
require('module').Module._initPaths();

// Carica il file .env se esiste
const envPath = path.join(projectRoot, '.env');
if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
}

// Imposta l'ambiente di produzione se non specificato
process.env.NODE_ENV = process.env.NODE_ENV || 'production';

// Avvia l'applicazione con un timeout
const startApp = async () => {
    try {
        // Carica il modulo dell'applicazione
        const app = require('./src/app');
        const port = process.env.PORT || 3000;
        
        // Avvia il server
        const server = app.listen(port, () => {
            console.log(`Server listening on port ${port}`);
        });

        // Gestisce il cleanup alla chiusura
        const cleanup = () => {
            console.log('Shutting down server...');
            server.close(() => {
                console.log('Server closed');
                process.exit(0);
            });
        };

        // Registra gli handler per la terminazione
        process.on('SIGTERM', cleanup);
        process.on('SIGINT', cleanup);

    } catch (err) {
        console.error('Failed to start application:', err);
        process.exit(1);
    }
};

// Avvia con timeout di sicurezza
const initPromise = startApp();
const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Application startup timed out')), INIT_TIMEOUT);
});

// Gestisce errori di inizializzazione
Promise.race([initPromise, timeoutPromise]).catch(err => {
    console.error('Application initialization failed:', err);
    process.exit(1);
});

// Gestisce rejection non catturate
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Gestisce eccezioni non catturate
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    process.exit(1);
});