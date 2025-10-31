const fs = require('fs');
const path = require('path');

// Determina il percorso della directory dei log
// Funzione per ottenere il percorso dei log
const getLogDir = () => {
    // Il percorso di produzione è sempre .ws, mai .net
    const prodPath = '/var/www/vhosts/dashboard.brixware.ws/logs';

    // In produzione, usa sempre il percorso .ws per garantire coerenza
    if (process.env.NODE_ENV === 'production') {
        return prodPath;
    }
    // In sviluppo, usa il percorso relativo
    return path.join(__dirname, '../../logs');
};

// Assicura che la directory dei log esista
const ensureLogDir = (dir) => {
    try {
        // Se siamo in produzione, assicurati che non stiamo provando a usare .net
        if (process.env.NODE_ENV === 'production' && dir.includes('.net')) {
            console.error('Tentativo di usare .net invece di .ws nel percorso dei log');
            return false;
        }

        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            console.log(`Created log directory: ${dir}`);
        }

        // Test di scrittura per verificare i permessi
        const testFile = path.join(dir, '.test');
        fs.writeFileSync(testFile, '');
        fs.unlinkSync(testFile);

        return true;
    } catch (error) {
        console.error(`Errore nella creazione/accesso directory log ${dir}:`, error);
        return false;
    }
};

const LOG_LEVELS = {
    ERROR: 0,   // Errori critici che richiedono attenzione
    WARN: 1,    // Avvisi importanti ma non critici
    INFO: 2,    // Informazioni importanti sul processo
    DEBUG: 3,   // Informazioni dettagliate per il debug
    VERBOSE: 4  // Log molto dettagliati per debugging approfondito
};

const getCurrentLogLevel = () => {
    if (process.env.VERBOSE_MODE === 'true') return LOG_LEVELS.VERBOSE;
    if (process.env.DEBUG_MODE === 'true') return LOG_LEVELS.DEBUG;
    return LOG_LEVELS.INFO;
};

const getLogFileName = () => {
    // Ottieni il percorso dei log
    const logDir = getLogDir();
    
    // Assicurati che la directory esista
    if (!ensureLogDir(logDir)) {
        console.error(`Failed to ensure log directory exists: ${logDir}`);
        process.exit(1);
    }

    // Costruisci il nome del file
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return path.join(logDir, `${year}-${month}-${day}.log`);
};

const formatMessage = (level, ...args) => {
    const timestamp = new Date().toISOString();
    const levelStr = Object.keys(LOG_LEVELS).find(key => LOG_LEVELS[key] === level);
    const message = args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(' ');
    
    return `[${timestamp}] [${levelStr}] ${message}\n`;
};

const log = (level, ...args) => {
    const currentLevel = getCurrentLogLevel();
    if (level <= currentLevel) {
        const logMessage = formatMessage(level, ...args);
        
        // Scrivi su file
        fs.appendFileSync(getLogFileName(), logMessage);
        
        // Scrivi anche su console se in modalità debug o verbose
        if (currentLevel >= LOG_LEVELS.DEBUG) {
            if (level === LOG_LEVELS.ERROR) console.error(logMessage);
            else if (level === LOG_LEVELS.WARN) console.warn(logMessage);
            else console.log(logMessage);
        }
    }
};

// Funzioni helper per i diversi livelli di log
const error = (...args) => log(LOG_LEVELS.ERROR, ...args);
const warn = (...args) => log(LOG_LEVELS.WARN, ...args);
const info = (...args) => log(LOG_LEVELS.INFO, ...args);
const debug = (...args) => log(LOG_LEVELS.DEBUG, ...args);
const verbose = (...args) => log(LOG_LEVELS.VERBOSE, ...args);

module.exports = {
    LOG_LEVELS,
    log,
    error,
    warn,
    info,
    debug,
    verbose
};