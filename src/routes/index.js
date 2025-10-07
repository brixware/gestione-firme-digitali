const express = require('express');
const multer = require('multer');
const path = require('path');
const { loadDataFromXLS } = require('../services/dataLoader');

const router = express.Router();
const uploadDirName = process.env.UPLOAD_DIR || 'uploads';
const upload = multer({ dest: path.resolve(__dirname, '..', '..', uploadDirName) });

router.post('/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'Nessun file caricato.' });
        }

        const filePath = req.file.path;
        const stats = await loadDataFromXLS(filePath);
        res.status(200).json({
            message: 'File elaborato correttamente.',
            stats
        });
    } catch (error) {
        console.error('Errore durante il caricamento del file:', error);
        const status = error.code === 'NO_VALID_ROWS' || error.code === 'NO_SHEETS' ? 400 : 500;
        res.status(status).json({ message: 'Error loading data from file.', error: error.message });
    }
});

module.exports = router;
