const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const {
    getUserByUsername,
    getUserById,
    verifyPassword,
    updateUserPassword,
    updateUserProfile
} = require('../services/auth');

const router = express.Router();

const uploadDirName = process.env.UPLOAD_DIR || 'uploads';
const avatarsDir = path.resolve(__dirname, '..', '..', uploadDirName, 'avatars');
const AVATAR_MAX_SIZE = parseInt(process.env.AVATAR_MAX_SIZE || '2097152', 10);
const ALLOWED_AVATAR_TYPES = new Set(['image/png', 'image/jpeg', 'image/pjpeg', 'image/gif', 'image/webp']);

if (!fs.existsSync(avatarsDir)) {
    fs.mkdirSync(avatarsDir, { recursive: true });
}

const avatarStorage = multer.diskStorage({
    destination: (_req, _file, cb) => {
        cb(null, avatarsDir);
    },
    filename: (req, file, cb) => {
        const rawExt = path.extname(file.originalname || '').toLowerCase();
        const allowedExt = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
        const safeExt = allowedExt.has(rawExt) ? rawExt : '.png';
        const suffix = Math.random().toString(16).slice(2, 10);
        const userId = req.session?.userId || 'user';
        cb(null, `avatar-${userId}-${Date.now()}-${suffix}${safeExt}`);
    }
});

const avatarUpload = multer({
    storage: avatarStorage,
    limits: { fileSize: AVATAR_MAX_SIZE },
    fileFilter: (_req, file, cb) => {
        if (!ALLOWED_AVATAR_TYPES.has(file.mimetype)) {
            cb(new Error('Formato immagine non supportato. Usa PNG, JPG, GIF o WebP.'));
            return;
        }
        cb(null, true);
    }
});

const ensureAuthenticated = (req, res, next) => {
    if (!req.session.userId) {
        return res.status(401).json({ message: 'Non autenticato.' });
    }
    return next();
};

const runAvatarUpload = (req, res, next) =>
    avatarUpload.single('avatar')(req, res, (err) => {
        if (!err) return next();
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ message: 'L\'immagine è troppo grande. Dimensione massima: 2 MB.' });
        }
        return res
            .status(400)
            .json({ message: err?.message || 'Errore durante il caricamento dell\'immagine.' });
    });

const toRelativeAvatarUrl = (filename) =>
    `/${uploadDirName}/avatars/${filename}`.replace(/\\/g, '/');

const removeAvatarFile = (url) => {
    if (!url || typeof url !== 'string') return;
    const normalized = url.trim();
    const expectedPrefix = `/${uploadDirName}/avatars/`;
    if (!normalized.startsWith(expectedPrefix)) return;
    const absolutePath = path.resolve(
        __dirname,
        '..',
        '..',
        normalized.replace(/^\//, '')
    );
    fs.unlink(absolutePath, (error) => {
        if (error && error.code !== 'ENOENT') {
            console.error('Errore durante la rimozione del vecchio avatar:', error);
        }
    });
};

const regenerateSession = (req) =>
    new Promise((resolve, reject) => {
        req.session.regenerate((err) => (err ? reject(err) : resolve()));
    });

router.get('/session', async (req, res) => {
    if (!req.session.userId) {
        return res.json({ authenticated: false });
    }
    res.json({
        authenticated: true,
        username: req.session.username,
        mustChangePassword: Boolean(req.session.mustChangePassword),
        fullName: req.session.fullName || null,
        avatarUrl: req.session.avatarUrl || null
    });
});

router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body || {};
        if (!username || !password) {
            return res.status(400).json({ message: 'Credenziali mancanti.' });
        }

        const user = await getUserByUsername(username);
        if (!user) {
            return res.status(401).json({ message: 'Credenziali non valide.' });
        }

        const passwordOk = await verifyPassword(password, user.password_hash);
        if (!passwordOk) {
            return res.status(401).json({ message: 'Credenziali non valide.' });
        }

        await regenerateSession(req);
        req.session.userId = user.id;
        req.session.username = user.username;
        req.session.mustChangePassword = Boolean(user.must_change_password);
        req.session.fullName = user.full_name || null;
        req.session.avatarUrl = user.avatar_url || null;

        res.json({
            message: 'Autenticato.',
            mustChangePassword: Boolean(user.must_change_password),
            fullName: user.full_name || null,
            avatarUrl: user.avatar_url || null
        });
    } catch (error) {
        console.error('Errore login:', error);
        res.status(500).json({ message: 'Errore durante il login.' });
    }
});

router.post('/logout', (req, res) => {
    req.session.destroy(() => {
        res.json({ message: 'Disconnesso.' });
    });
});

router.post('/change-password', async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({ message: 'Non autenticato.' });
        }

        const { currentPassword, newPassword } = req.body || {};
        if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 10) {
            return res
                .status(400)
                .json({ message: 'La nuova password deve contenere almeno 10 caratteri.' });
        }

        const user = await getUserById(req.session.userId);
        if (!user) {
            return res.status(404).json({ message: 'Utente non trovato.' });
        }

        if (!currentPassword) {
            return res.status(400).json({ message: 'Inserisci la password attuale.' });
        }

        const passwordOk = await verifyPassword(currentPassword, user.password_hash);
        if (!passwordOk) {
            return res.status(401).json({ message: 'Password attuale non corretta.' });
        }

        const samePassword = await verifyPassword(newPassword, user.password_hash);
        if (samePassword) {
            return res
                .status(400)
                .json({ message: 'La nuova password deve essere diversa da quella attuale.' });
        }

        await updateUserPassword(user.id, newPassword, { requireChangeFlag: false });
        req.session.mustChangePassword = false;

        res.json({ message: 'Password aggiornata correttamente.' });
    } catch (error) {
        console.error('Errore cambio password:', error);
        res.status(500).json({ message: 'Errore durante il cambio password.' });
    }
});

router.post('/profile/avatar', ensureAuthenticated, runAvatarUpload, (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'Nessun file caricato.' });
    }
    const relativeUrl = toRelativeAvatarUrl(req.file.filename);
    res.json({ message: 'Immagine caricata.', url: relativeUrl });
});

router.get('/profile', async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({ message: 'Non autenticato.' });
        }
        const user = await getUserById(req.session.userId);
        if (!user) {
            return res.status(404).json({ message: 'Utente non trovato.' });
        }
        res.json({
            username: user.username,
            fullName: user.full_name || '',
            avatarUrl: user.avatar_url || ''
        });
    } catch (error) {
        console.error('Errore profilo:', error);
        res.status(500).json({ message: 'Errore nel recupero del profilo.' });
    }
});

router.put('/profile', async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({ message: 'Non autenticato.' });
        }
        const { fullName, avatarUrl } = req.body || {};
        const cleanFullName =
            typeof fullName === 'string' && fullName.trim().length > 0
                ? fullName.trim()
                : null;
        const cleanAvatar =
            typeof avatarUrl === 'string' && avatarUrl.trim().length > 0
                ? avatarUrl.trim()
                : null;
        const previousAvatar = req.session.avatarUrl || null;

        await updateUserProfile(req.session.userId, {
            fullName: cleanFullName,
            avatarUrl: cleanAvatar
        });

        req.session.fullName = cleanFullName;
        req.session.avatarUrl = cleanAvatar;
        if (previousAvatar && previousAvatar !== cleanAvatar) {
            removeAvatarFile(previousAvatar);
        }

        res.json({ message: 'Profilo aggiornato.' });
    } catch (error) {
        console.error('Errore aggiornamento profilo:', error);
        res.status(500).json({ message: 'Errore durante l\'aggiornamento del profilo.' });
    }
});

module.exports = router;

