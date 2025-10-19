const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const express = require('express');
const session = require('express-session');

const routes = require('./routes');
const authRoutes = require('./routes/auth');
const { ensureAuthSetup } = require('./services/auth');

const app = express();
const PORT = process.env.PORT || 3000;
const uploadDirName = process.env.UPLOAD_DIR || 'uploads';
const uploadsDir = path.join(__dirname, '..', uploadDirName);
const staticMiddleware = express.static(path.join(__dirname, '..', 'public'));
const uploadsStaticMiddleware = express.static(uploadsDir);

if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
    session({
        secret: process.env.SESSION_SECRET || 'gestione-firme-secret',
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            sameSite: 'lax',
            maxAge: 24 * 60 * 60 * 1000  // 24 ore
        }
    })
);

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
    return res.sendFile(path.join(__dirname, '..', 'public', 'login.html'));
});

app.get('/', ensurePageAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use('/uploads', ensurePageAuthenticated, uploadsStaticMiddleware);
app.use(ensurePageAuthenticated, staticMiddleware);

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
