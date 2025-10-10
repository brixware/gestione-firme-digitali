const fs = require('fs');
const path = require('path');

// Crea la directory dei log se non esiste
const LOG_DIR = path.join(__dirname, '../../logs');
if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

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
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return path.join(LOG_DIR, `${year}-${month}-${day}.log`);
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
    error,
    warn,
    info,
    debug,
    verbose
};