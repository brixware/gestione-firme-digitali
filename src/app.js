const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const express = require('express');
const fs = require('fs');
const routes = require('./routes');

const app = express();
const PORT = process.env.PORT || 3000;
const uploadDirName = process.env.UPLOAD_DIR || 'uploads';
const uploadsDir = path.join(__dirname, '..', uploadDirName);

// Ensure the uploads directory exists before multer writes files into it.
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api', routes);

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
