const path = require('path');
const fs = require('fs');
const httpdocsPath = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.resolve(httpdocsPath, '.env') });
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const { LOG_LEVELS, info, error } = require('./utils/logger');
const dbConfig = require('../config/dbConfig');

const routes = require('./routes');
const authRoutes = require('./routes/auth');
const { ensureAuthSetup } = require('./services/auth');

info('Initializing Express application...');
const app = express();
const PORT = process.env.PORT || 3000;
const uploadDirName = process.env.UPLOAD_DIR || 'uploads';
const uploadsDir = path.join(httpdocsPath, uploadDirName);
const staticMiddleware = express.static(path.join(httpdocsPath, 'public'));

// Impostazioni per timeout e limiti
const SERVER_TIMEOUT = 120000; // 2 minuti
app.set('timeout', SERVER_TIMEOUT);

// Middleware per il controllo del timeout
app.use((req, res, next) => {
    res.setTimeout(SERVER_TIMEOUT, () => {
        error(`Request timeout: ${req.method} ${req.url}`);
        res.status(503).json({ error: 'Timeout della richiesta' });
    });
    next();
});

info('Checking uploads directory...');
if (!fs.existsSync(uploadsDir)) {
    info('Creating uploads directory...');
    fs.mkdirSync(uploadsDir, { recursive: true });
}

const BODY_LIMIT = process.env.REQUEST_BODY_LIMIT || '50mb';
info('Configuring Express middleware...');
app.use(express.json({ limit: BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT }));

info('Initializing MySQL session store...');
info('Database config:', { ...dbConfig, password: '***' });

const options = {
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
    database: dbConfig.database,
    createDatabaseTable: true,
    clearExpired: true,
    checkExpirationInterval: 900000, // 15 minuti
    expiration: 86400000, // 24 ore
    schema: {
        tableName: 'sessions',
        columnNames: {
            session_id: 'session_id',
            expires: 'expires',
            data: 'data'
        }
    }
};

// Creiamo un pool MySQL standard (non promise-based) per le sessioni
const sessionPool = require('mysql').createPool(options);
const sessionStore = new MySQLStore(options, sessionPool);

sessionStore.onReady().then(() => {
    info('Session store initialized successfully');
}).catch(err => {
    error('Failed to initialize session store:', err);
    throw err;
});

app.use(
    session({
        secret: process.env.SESSION_SECRET || 'gestione-firme-secret',
        resave: false,
        saveUninitialized: false,
        store: sessionStore,
        cookie: {
            httpOnly: true,
            sameSite: 'lax',
            maxAge: 24 * 60 * 60 * 1000  // 24 ore
        }
    })
);

info('Setting up authentication routes...');
app.use('/api/auth', authRoutes);

info('Configuring API authentication middleware...');
const ensureApiAuthenticated = (req, res, next) => {
    if (!req.session.userId) {
        info('API request rejected: Not authenticated');
        return res.status(401).json({ message: 'Non autenticato.' });
    }
    if (req.session.mustChangePassword) {
        info('API request rejected: Password change required');
        return res
            .status(403)
            .json({ message: 'Cambio password richiesto.', mustChangePassword: true });
    }
    return next();
};

info('Setting up API routes...');
app.use('/api', ensureApiAuthenticated, routes);

info('Configuring page authentication middleware...');
const ensurePageAuthenticated = (req, res, next) => {
    if (!req.session.userId) {
        info('Page request redirected to login: Not authenticated');
        return res.redirect('/login');
    }
    if (req.session.mustChangePassword) {
        info('Page request redirected to login: Password change required');
        return res.redirect('/login?change=1');
    }
    return next();
};

app.get('/login', (req, res) => {
    if (req.session.userId && !req.session.mustChangePassword) {
        info('Login page skipped: Already authenticated');
        return res.redirect('/');
    }
    info('Serving login page');
    return res.sendFile(path.join(__dirname, '..', 'public', 'login.html'));
});

app.get('/', ensurePageAuthenticated, (req, res) => {
    info('Serving index page');
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

info('Setting up static middleware...');
app.use(ensurePageAuthenticated, staticMiddleware);

// Error handling middleware
info('Setting up error handling middleware...');

// Middleware per catturare errori nelle promise non gestite
app.use((req, res, next) => {
    res.promise = (promise) => {
        return promise
            .then((data) => res.json(data))
            .catch(next);
    };
    next();
});

// Middleware per la gestione degli errori
app.use((err, req, res, next) => {
    const errorDetails = {
        message: err.message || 'Errore sconosciuto',
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
        code: err.code,
        status: err.status || 500
    };
    error('Unhandled error:', errorDetails);
    res.status(errorDetails.status).json({
        error: 'Errore interno del server',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Si è verificato un errore durante l\'elaborazione della richiesta',
        details: process.env.NODE_ENV === 'development' ? errorDetails : undefined
    });
});

// 404 handler
app.use((req, res) => {
    info(`404 Not Found: ${req.method} ${req.url}`);
    res.status(404).json({ error: 'Risorsa non trovata' });
});

// Gestione errori globali
process.on('unhandledRejection', (reason, promise) => {
    error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
    error('Uncaught Exception:', err);
    // Dai al logger il tempo di scrivere prima di uscire
    setTimeout(() => process.exit(1), 1000);
});

// Inizializzazione asincrona dell'app
const initializeApp = async () => {
    info('Initializing application...');
    try {
        info('Ensuring authentication setup...');
        await ensureAuthSetup();
        info('Authentication setup completed');

        // Avvia sempre il server
        const server = app.listen(PORT, () => {
            info(`Server avviato su http://localhost:${PORT}`);
        });

        server.on('error', (err) => {
            error('Server error:', err);
            process.exit(1);
        });
        
        // Esportiamo l'app configurata
        return app;
    } catch (err) {
        error('Failed to initialize application:', err);
        throw err;
    }
};

// Esportiamo una Promise che si risolve con l'app inizializzata
module.exports = initializeApp();
