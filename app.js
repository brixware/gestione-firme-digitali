const path = require('path');
const fs = require('fs');
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);

// Configura il logger prima di tutto
const logger = require('./src/utils/logger');

// Alias per comodità
const log = logger.log.bind(logger);
const LOG_LEVELS = logger.LOG_LEVELS;
process.env.DEBUG_MODE = 'true'; // Abilita logging dettagliato

// Log informazioni di avvio
log(LOG_LEVELS.INFO, 'Starting application...');
log(LOG_LEVELS.INFO, 'Node version:', process.version);
log(LOG_LEVELS.INFO, 'Environment:', process.env.NODE_ENV);
log(LOG_LEVELS.INFO, 'Current directory:', process.cwd());
log(LOG_LEVELS.INFO, 'Module paths:', module.paths);

const routes = require('./src/routes');
const authRoutes = require('./src/routes/auth');
const { ensureAuthSetup } = require('./src/services/auth');

const app = express();
const PORT = process.env.PORT || 3000;
const uploadDirName = process.env.UPLOAD_DIR || 'uploads';
const uploadsDir = path.join(__dirname, uploadDirName);
const staticMiddleware = express.static(path.join(__dirname, 'public'));

if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Gestione non-catching delle promise
process.on('unhandledRejection', (reason, p) => {
    console.error('Unhandled Rejection at:', p, 'reason:', reason);
});

const BODY_LIMIT = process.env.REQUEST_BODY_LIMIT || '50mb';

app.use(express.json({ limit: BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT }));

// Configurazione del session store
const sessionStore = new MySQLStore({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT, 10),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    createDatabaseTable: true,
    clearExpired: true,
    checkExpirationInterval: 900000, // 15 minuti
    expiration: 86400000 // 24 ore
});

app.use(
    session({
        secret: process.env.SESSION_SECRET || 'gestione-firme-secret',
        store: sessionStore,
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            sameSite: 'lax',
            maxAge: 24 * 60 * 60 * 1000  // 24 ore
        }
    })
);

// Log middleware per tutte le richieste
app.use((req, res, next) => {
    log(LOG_LEVELS.INFO, `${req.method} ${req.url}`, {
        ip: req.ip,
        headers: req.headers,
        query: req.query,
        body: req.method !== 'GET' ? req.body : undefined
    });
    next();
});

app.use('/api/auth', authRoutes);

const ensureApiAuthenticated = (req, res, next) => {
    if (!req.session.userId) {
        return res.status(401).json({ message: 'Non autenticato.' });
    }
    if (req.session.mustChangePassword) {
        return res
            .status(403)
            .json({ message: 'Cambio password richiesto.', mustChangePassword: true });
    }
    return next();
};

app.use('/api', ensureApiAuthenticated, routes);

const ensurePageAuthenticated = (req, res, next) => {
    if (!req.session.userId) {
        return res.redirect('/login');
    }
    if (req.session.mustChangePassword) {
        return res.redirect('/login?change=1');
    }
    return next();
};

app.get('/login', (req, res) => {
    if (req.session.userId && !req.session.mustChangePassword) {
        return res.redirect('/');
    }
    return res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/', ensurePageAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use(ensurePageAuthenticated, staticMiddleware);

// Avvia il server se questo file viene eseguito direttamente
if (require.main === module) {
    ensureAuthSetup()
        .then(() => {
            app.listen(PORT, () => {
                console.log(`Server avviato su http://localhost:${PORT}`);
            });
        })
        .catch((error) => {
            console.error('Impossibile inizializzare il sistema di autenticazione:', error);
            process.exit(1);
        });
}

// Esporta l'applicazione per Passenger
module.exports = app;