const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const asyncHandler = require('../utils/asyncHandler');
const {
    getUserByUsername,
    getUserById,
    verifyPassword,
    updateUserPassword,
    updateUserProfile
} = require('../services/auth');

const router = express.Router();

const uploadDirName = process.env.UPLOAD_DIR || 'uploads';
const uploadsRoot = path.resolve(__dirname, '..', '..', uploadDirName);
const AVATAR_MAX_SIZE = parseInt(process.env.AVATAR_MAX_SIZE || '2097152', 10);
const ALLOWED_AVATAR_TYPES = new Set([
    'image/png',
    'image/jpeg',
    'image/pjpeg',
    'image/gif',
    'image/webp'
]);
const EXTENSION_MIME_MAP = new Map([
    ['.png', 'image/png'],
    ['.jpg', 'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
    ['.gif', 'image/gif'],
    ['.webp', 'image/webp']
]);

const avatarUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: AVATAR_MAX_SIZE },
    fileFilter: (_req, file, cb) => {
        if (!ALLOWED_AVATAR_TYPES.has(file.mimetype)) {
            cb(new Error('Formato immagine non supportato. Usa PNG, JPG, GIF o WebP.'));
            return;
        }
        cb(null, true);
    }
});

const buildAvatarDataUrl = (mime, buffer) => {
    if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) return null;
    const safeMime = typeof mime === 'string' && mime.trim().length > 0 ? mime.trim() : 'image/png';
    const base64 = buffer.toString('base64');
    return `data:${safeMime};base64,${base64}`;
};

const parseAvatarDataUrl = (value) => {
    if (value == null) return { buffer: null, mime: null };
    if (typeof value !== 'string' || value.trim() === '') {
        return { buffer: null, mime: null };
    }
    const trimmed = value.trim();
    const match = trimmed.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
        throw new Error('Formato immagine non valido.');
    }
    const mime = match[1];
    if (!ALLOWED_AVATAR_TYPES.has(mime)) {
        throw new Error('Formato immagine non supportato. Usa PNG, JPG, GIF o WebP.');
    }
    try {
        const buffer = Buffer.from(match[2], 'base64');
        if (buffer.length > AVATAR_MAX_SIZE) {
            throw new Error('L\'immagine e\' troppo grande. Dimensione massima: 2 MB.');
        }
        return { buffer, mime };
    } catch (error) {
        throw new Error('Immagine non valida.');
    }
};

const loadLegacyAvatarDataUrl = (avatarPath) => {
    if (!avatarPath || typeof avatarPath !== 'string') return null;
    const normalized = avatarPath.replace(/^\/+/, '');
    const absolute = path.resolve(__dirname, '..', '..', normalized);
    if (!absolute.toLowerCase().startsWith(uploadsRoot.toLowerCase())) return null;
    try {
        const buffer = fs.readFileSync(absolute);
        const ext = path.extname(absolute).toLowerCase();
        const mime = EXTENSION_MIME_MAP.get(ext) || 'image/png';
        return buildAvatarDataUrl(mime, buffer);
    } catch (error) {
        return null;
    }
};

const extractAvatarDataUrl = (user) => {
    if (user?.avatar_data && user.avatar_data.length) {
        return buildAvatarDataUrl(user.avatar_mime || 'image/png', user.avatar_data);
    }
    if (user?.avatar_url) {
        return loadLegacyAvatarDataUrl(user.avatar_url);
    }
    return null;
};

const regenerateSession = (req) =>
    new Promise((resolve, reject) => {
        req.session.regenerate((err) => (err ? reject(err) : resolve()));
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
            return res
                .status(400)
                .json({ message: 'L\'immagine e\' troppo grande. Dimensione massima: 2 MB.' });
        }
        return res
            .status(400)
            .json({ message: err?.message || 'Errore durante il caricamento dell\'immagine.' });
    });

router.get('/session', asyncHandler(async (req, res) => {
    if (!req.session.userId) {
        return res.json({ authenticated: false });
    }
    let avatarDataUrl = req.session.avatarUrl || null;
    if (!avatarDataUrl) {
        const user = await getUserById(req.session.userId);
        avatarDataUrl = extractAvatarDataUrl(user) || null;
        if (avatarDataUrl) req.session.avatarUrl = avatarDataUrl;
    }
    res.json({
        authenticated: true,
        username: req.session.username,
        mustChangePassword: Boolean(req.session.mustChangePassword),
        fullName: req.session.fullName || null,
        avatarUrl: avatarDataUrl
    });
}));

router.post('/login', asyncHandler(async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
        return res.status(400).json({ message: 'Credenziali mancanti.' });
    }

    let user;
    try {
        user = await getUserByUsername(username);
        if (!user) {
            return res.status(401).json({ message: 'Credenziali non valide.' });
        }

        const passwordOk = await verifyPassword(password, user.password_hash);
        if (!passwordOk) {
            return res.status(401).json({ message: 'Credenziali non valide.' });
        }
    } catch (error) {
        console.error('Errore durante la verifica delle credenziali:', error);
        return res.status(500).json({ message: 'Errore durante la verifica delle credenziali.' });
    }

    await regenerateSession(req);
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.mustChangePassword = Boolean(user.must_change_password);
    req.session.fullName = user.full_name || null;
    const avatarDataUrl = extractAvatarDataUrl(user);
    req.session.avatarUrl = avatarDataUrl;

    res.json({
        message: 'Autenticato.',
        mustChangePassword: Boolean(user.must_change_password),
        fullName: user.full_name || null,
        avatarUrl: avatarDataUrl || null
    });
}));

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
    const dataUrl = buildAvatarDataUrl(req.file.mimetype, req.file.buffer);
    if (!dataUrl) {
        return res.status(400).json({ message: 'Immagine non valida.' });
    }
    res.json({ message: 'Immagine caricata.', dataUrl });
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
        const avatarDataUrl = extractAvatarDataUrl(user);
        if (avatarDataUrl && !req.session.avatarUrl) {
            req.session.avatarUrl = avatarDataUrl;
        }
        res.json({
            username: user.username,
            fullName: user.full_name || '',
            avatarUrl: avatarDataUrl || ''
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
        const rawAvatar = typeof avatarUrl === 'string' ? avatarUrl.trim() : '';
        let avatarBuffer = null;
        let avatarMime = null;
        if (rawAvatar) {
            try {
                const parsed = parseAvatarDataUrl(rawAvatar);
                avatarBuffer = parsed.buffer;
                avatarMime = parsed.mime;
            } catch (parseError) {
                console.error('Avatar non valido:', parseError);
                return res
                    .status(400)
                    .json({ message: parseError.message || 'Immagine non valida.' });
            }
        }

        await updateUserProfile(req.session.userId, {
            fullName: cleanFullName,
            avatarData: avatarBuffer,
            avatarMime
        });

        req.session.fullName = cleanFullName;
        req.session.avatarUrl = avatarBuffer ? buildAvatarDataUrl(avatarMime, avatarBuffer) : null;

        res.json({ message: 'Profilo aggiornato.' });
    } catch (error) {
        console.error('Errore aggiornamento profilo:', error);
        res
            .status(500)
            .json({ message: error?.message || 'Errore durante l\'aggiornamento del profilo.' });
    }
});

module.exports = router;

