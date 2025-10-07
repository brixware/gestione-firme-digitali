const express = require('express');
const multer = require('multer');
const path = require('path');
const { loadDataFromXLS } = require('../services/dataLoader');

const router = express.Router();
const uploadDirName = process.env.UPLOAD_DIR || 'uploads';
const upload = multer({ dest: path.resolve(__dirname, '..', '..', uploadDirName) });

router.post('/upload', upload.single('file'), async (req, res) => {
    try {
        const filePath = req.file.path;
        await loadDataFromXLS(filePath);
        res.status(200).json({ message: 'File uploaded and data loaded successfully.' });
    } catch (error) {
        res.status(500).json({ message: 'Error loading data from file.', error: error.message });
    }
});

module.exports = router;
