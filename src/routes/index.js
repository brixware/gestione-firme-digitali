const express = require('express');
const multer = require('multer');
const path = require('path');
const { loadDataFromXLS } = require('../services/dataLoader');
const db = require('../services/dbConnector');

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

// GET /api/signatures?page=1&pageSize=20
router.get('/signatures', async (req, res) => {
    try {
        const rawPage = parseInt(String(req.query.page || '1'), 10);
        const rawPageSize = parseInt(String(req.query.pageSize || '20'), 10);
        const page = Number.isNaN(rawPage) ? 1 : Math.max(1, rawPage);
        const pageSize = Number.isNaN(rawPageSize) ? 20 : Math.min(100, Math.max(1, rawPageSize));
        const offset = (page - 1) * pageSize;

        const baseTableEnv = process.env.DB_TABLE || 'digital_signatures';
        const tableName = baseTableEnv.replace(/[^a-zA-Z0-9_]/g, '') || 'digital_signatures';

        // Filtri
        const filters = {
            id: req.query.id,
            titolare: req.query.titolare,
            email: req.query.email,
            fattura_numero: req.query.fattura_numero,
            emesso_da: req.query.emesso_da
        };

        const whereParts = [];
        const params = [];

        if (filters.id) {
            whereParts.push('id = ?');
            params.push(parseInt(String(filters.id), 10) || 0);
        }
        if (filters.titolare) {
            whereParts.push('titolare LIKE ?');
            params.push(`%${String(filters.titolare).trim()}%`);
        }
        if (filters.email) {
            whereParts.push('email LIKE ?');
            params.push(`%${String(filters.email).trim()}%`);
        }
        if (filters.fattura_numero) {
            whereParts.push('fattura_numero LIKE ?');
            params.push(`%${String(filters.fattura_numero).trim()}%`);
        }
        if (filters.emesso_da) {
            whereParts.push('emesso_da LIKE ?');
            params.push(`%${String(filters.emesso_da).trim()}%`);
        }

        const whereSql = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

        // Ordinamento
        const ALLOWED_SORT = new Set([
            'id',
            'titolare',
            'email',
            'recapito_telefonico',
            'data_emissione',
            'emesso_da',
            'costo_ie',
            'importo_ie',
            'fattura_numero',
            'fattura_tipo_invio'
        ]);
        const sortByRaw = String(req.query.sortBy || 'id');
        const sortBy = ALLOWED_SORT.has(sortByRaw) ? sortByRaw : 'id';
        const sortDir = String(req.query.sortDir || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';

        const countSql = `SELECT COUNT(*) AS total FROM \`${tableName}\` ${whereSql}`;
        const [[{ total }]] = await db.pool.query(countSql, params);

        const dataSql = `SELECT id, titolare, email, recapito_telefonico, data_emissione, emesso_da, costo_ie, importo_ie, fattura_numero, fattura_tipo_invio
                         FROM \`${tableName}\`
                         ${whereSql}
                         ORDER BY ${sortBy} ${sortDir}
                         LIMIT ? OFFSET ?`;
        const [rows] = await db.pool.query(dataSql, [...params, pageSize, offset]);

        const totalPages = Math.ceil(total / pageSize);
        res.json({ data: rows, page, pageSize, total, totalPages });
    } catch (error) {
        console.error('Errore signatures:', error);
        res.status(500).json({ message: 'Errore nel recupero delle firme.' });
    }
});

// GET /api/signatures/:id/renewals
router.get('/signatures/:id/renewals', async (req, res) => {
    try {
        const id = parseInt(String(req.params.id), 10);
        if (Number.isNaN(id) || id <= 0) {
            return res.status(400).json({ message: 'ID non valido' });
        }

        const baseTableEnv = process.env.DB_RENEWAL_TABLE || `${(process.env.DB_TABLE || 'digital_signatures').replace(/[^a-zA-Z0-9_]/g, '')}_renewals`;
        const tableName = baseTableEnv.replace(/[^a-zA-Z0-9_]/g, '') || 'digital_signatures_renewals';

        const [rows] = await db.pool.query(
            `SELECT id, signature_id, sheet_name, email, recapito_telefonico,
                    certificato_cns_l, certificato_cns, certificato_cfd, certificato_cfd_r,
                    data_emissione, data_scadenza, rinnovo_data, rinnovo_da, nuova_emissione_id,
                    costo_ie, importo_ie, fattura_numero, fattura_tipo_invio, fattura_tipo_pagamento,
                    data_riferimento_incasso, note, created_at, updated_at
             FROM \`${tableName}\`
             WHERE signature_id = ?
             ORDER BY (rinnovo_data IS NULL), rinnovo_data ASC, id ASC`,
            [id]
        );

        res.json({ data: rows });
    } catch (error) {
        console.error('Errore renewals:', error);
        res.status(500).json({ message: 'Errore nel recupero dei rinnovi.' });
    }
});

// GET /api/signatures/expiring?days=15&limit=50
router.get('/signatures/expiring', async (req, res) => {
    try {
        const rawDays = parseInt(String(req.query.days || '15'), 10);
        const days = Number.isNaN(rawDays) ? 15 : Math.max(1, Math.min(365, rawDays));
        // Pagination
        let page = parseInt(String(req.query.page || '1'), 10);
        let pageSize = parseInt(String(req.query.pageSize || '20'), 10);
        if (Number.isNaN(page) || page < 1) page = 1;
        if (Number.isNaN(pageSize) || pageSize < 1) pageSize = 20;
        pageSize = Math.min(1000, pageSize);
        const offset = (page - 1) * pageSize;
        // Backwards-compat: allow 'limit' to override pageSize when page not specified
        if (req.query.limit && !req.query.page) {
            const rawLimit = parseInt(String(req.query.limit), 10);
            if (!Number.isNaN(rawLimit) && rawLimit > 0) {
                page = 1;
                pageSize = Math.min(10000, rawLimit);
            }
        }

        const baseTableEnv = process.env.DB_TABLE || 'digital_signatures';
        const baseTable = baseTableEnv.replace(/[^a-zA-Z0-9_]/g, '') || 'digital_signatures';
        const renewalTableEnv =
            process.env.DB_RENEWAL_TABLE || `${baseTable}_renewals`;
        const renewalTable = renewalTableEnv.replace(/[^a-zA-Z0-9_]/g, '') || `${baseTable}_renewals`;

        // Total count
        const [countRows] = await db.pool.query(
            `SELECT COUNT(*) AS total FROM (
                SELECT s.id
                FROM \`${baseTable}\` s
                JOIN \`${renewalTable}\` r ON r.signature_id = s.id
                WHERE r.data_scadenza IS NOT NULL
                  AND r.data_scadenza BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)
                GROUP BY s.id
            ) t`,
            [days]
        );
        const total = countRows[0]?.total || 0;

        // Page data
        const [rows] = await db.pool.query(
            `SELECT s.id,
                    s.titolare,
                    s.email,
                    s.recapito_telefonico,
                    MIN(r.data_scadenza) AS data_scadenza,
                    DATEDIFF(MIN(r.data_scadenza), CURDATE()) AS days_left
             FROM \`${baseTable}\` s
             JOIN \`${renewalTable}\` r ON r.signature_id = s.id
             WHERE r.data_scadenza IS NOT NULL
               AND r.data_scadenza BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)
             GROUP BY s.id, s.titolare, s.email, s.recapito_telefonico
             HAVING MIN(r.data_scadenza) IS NOT NULL
             ORDER BY data_scadenza ASC
             LIMIT ? OFFSET ?`,
            [days, pageSize, offset]
        );

        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        res.json({ data: rows, days, page, pageSize, total, totalPages });
    } catch (error) {
        console.error('Errore expiring:', error);
        res.status(500).json({ message: 'Errore nel recupero delle scadenze.' });
    }
});

// GET /api/signatures/stats/yearly
router.get('/signatures/stats/yearly', async (req, res) => {
    try {
        const baseTableEnv = process.env.DB_TABLE || 'digital_signatures';
        const tableName = baseTableEnv.replace(/[^a-zA-Z0-9_]/g, '') || 'digital_signatures';

        const [rows] = await db.pool.query(
            `SELECT YEAR(data_emissione) AS year, COUNT(*) AS count
             FROM \`${tableName}\`
             WHERE data_emissione IS NOT NULL
             GROUP BY YEAR(data_emissione)
             ORDER BY YEAR(data_emissione)`
        );

        res.json({ data: rows });
    } catch (error) {
        console.error('Errore stats yearly:', error);
        res.status(500).json({ message: 'Errore nel recupero delle statistiche annuali.' });
    }
});

// GET /api/signatures/stats/renewals/yearly
router.get('/signatures/stats/renewals/yearly', async (req, res) => {
    try {
        const baseTableEnv = process.env.DB_TABLE || 'digital_signatures';
        const baseTable = baseTableEnv.replace(/[^a-zA-Z0-9_]/g, '') || 'digital_signatures';
        const renewalTableEnv = process.env.DB_RENEWAL_TABLE || `${baseTable}_renewals`;
        const renewalTable = renewalTableEnv.replace(/[^a-zA-Z0-9_]/g, '') || `${baseTable}_renewals`;

        const [rows] = await db.pool.query(
            `SELECT YEAR(rinnovo_data) AS year, COUNT(*) AS count
             FROM \`${renewalTable}\`
             WHERE rinnovo_data IS NOT NULL
             GROUP BY YEAR(rinnovo_data)
             ORDER BY YEAR(rinnovo_data)`
        );

        res.json({ data: rows });
    } catch (error) {
        console.error('Errore stats renewals yearly:', error);
        res.status(500).json({ message: 'Errore nel recupero delle statistiche rinnovi annuali.' });
    }
});

module.exports = router;
