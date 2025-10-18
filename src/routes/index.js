const express = require('express');
const multer = require('multer');
const path = require('path');
const { loadDataFromXLS } = require('../services/dataLoader');
const db = require('../services/dbConnector');

const sanitizeIdentifier = (value = '', fallback = '') => {
    const trimmed = String(value || '').trim();
    const safe = trimmed.replace(/[^a-zA-Z0-9_]/g, '');
    if (safe.length > 0) return safe;
    const fallbackTrimmed = String(fallback || '').trim();
    return fallbackTrimmed.replace(/[^a-zA-Z0-9_]/g, '');
};
const normalizeAssetCategory = (value = '') => String(value || '').trim().replace(/\s+/g, '_').toUpperCase();
const normalizeAssetSubtype = (value = '') => String(value || '').trim().toUpperCase();
const RAW_ASSET_OPTIONS = {
    KIT: ['STD', 'TOK', 'AK', 'AK-CNS'],
    SMART_CARD: ['STD', 'SIM', 'TAV'],
    LETTORE: ['TAV', 'TOK', 'AK'],
    CERTIFICATO: ['CNS-L', 'CNS', 'CFD', 'CFD-R']
};
const ASSET_OPTIONS = Object.fromEntries(
    Object.entries(RAW_ASSET_OPTIONS).map(([category, subtypes]) => [
        normalizeAssetCategory(category),
        Array.from(new Set(subtypes.map((sub) => normalizeAssetSubtype(sub))))
    ])
);
const isValidAssetCombo = (category, subtype) => {
    const cat = normalizeAssetCategory(category);
    const sub = normalizeAssetSubtype(subtype);
    const allowed = ASSET_OPTIONS[cat];
    return Array.isArray(allowed) && allowed.includes(sub);
};

const EUROPE_ROME_FORMATTER = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
});

const formatDateEuropeRome = (value) => {
    if (!value) {
        return null;
    }
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return EUROPE_ROME_FORMATTER.format(value);
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : EUROPE_ROME_FORMATTER.format(parsed);
};

const toNumberOrNull = (value) =>
    value === null || value === undefined ? null : Number(value);

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
            recapito_telefonico: req.query.recapito_telefonico,
            data_emissione: req.query.data_emissione,
            fattura_numero: req.query.fattura_numero,
            fattura_tipo_invio: req.query.fattura_tipo_invio,
            emesso_da: req.query.emesso_da,
            paid: req.query.paid
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
        if (filters.recapito_telefonico) {
            whereParts.push('recapito_telefonico LIKE ?');
            params.push(`%${String(filters.recapito_telefonico).trim()}%`);
        }
        if (filters.data_emissione) {
            whereParts.push('DATE(data_emissione) = ?');
            params.push(String(filters.data_emissione).trim());
        }
        if (filters.fattura_numero) {
            whereParts.push('fattura_numero LIKE ?');
            params.push(`%${String(filters.fattura_numero).trim()}%`);
        }
        if (filters.fattura_tipo_invio) {
            whereParts.push('fattura_tipo_invio LIKE ?');
            params.push(`%${String(filters.fattura_tipo_invio).trim()}%`);
        }
        if (filters.emesso_da) {
            whereParts.push('emesso_da LIKE ?');
            params.push(`%${String(filters.emesso_da).trim()}%`);
        }

        if (filters.paid !== undefined && filters.paid !== '' && filters.paid !== null) {
            const paidVal = String(filters.paid).trim();
            if (paidVal === '1' || paidVal.toLowerCase() === 'true') {
                whereParts.push('fattura_pagata = 1');
            } else if (paidVal === '0' || paidVal.toLowerCase() === 'false') {
                whereParts.push('fattura_pagata = 0');
            }
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
            'fattura_tipo_invio',
            'paid',
            'fattura_pagata'
        ]);
        const sortByRaw = String(req.query.sortBy || 'id');
        const sortBy = ALLOWED_SORT.has(sortByRaw) ? sortByRaw : 'id';
        const sortDir = String(req.query.sortDir || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';

        const countSql = `SELECT COUNT(*) AS total FROM \`${tableName}\` ${whereSql}`;
        const [[{ total }]] = await db.pool.query(countSql, params);

        const dataSql = `SELECT id, titolare, email, recapito_telefonico, data_emissione, emesso_da, costo_ie, importo_ie, fattura_numero, fattura_tipo_invio,
                         IFNULL(fattura_pagata, CASE WHEN data_riferimento_incasso IS NOT NULL THEN 1 ELSE 0 END) AS paid
                         FROM \`${tableName}\`
                         ${whereSql}
                         ORDER BY ${sortBy} ${sortDir}
                         LIMIT ? OFFSET ?`;
        const [rows] = await db.pool.query(dataSql, [...params, pageSize, offset]);

        const normalizedRows = rows.map((row) => ({
            ...row,
            data_emissione: formatDateEuropeRome(row.data_emissione),
            costo_ie: row.costo_ie == null ? null : Number(row.costo_ie),
            importo_ie: row.importo_ie == null ? null : Number(row.importo_ie),
            paid: row.paid ? 1 : 0
        }));

        const totalPages = Math.ceil(total / pageSize);
        res.json({ data: normalizedRows, page, pageSize, total, totalPages });
    } catch (error) {
        console.error('Errore signatures:', error);
        res.status(500).json({ message: 'Errore nel recupero delle firme.' });
    }
});

// PATCH /api/signatures/:id/paid { paid: 0|1 }
router.patch('/signatures/:id/paid', async (req, res) => {
    try {
        const id = parseInt(String(req.params.id), 10);
        if (!Number.isFinite(id) || id <= 0) {
            return res.status(400).json({ message: 'ID non valido' });
        }
        const baseTableEnv = process.env.DB_TABLE || 'digital_signatures';
        const tableName = baseTableEnv.replace(/[^a-zA-Z0-9_]/g, '') || 'digital_signatures';
        const paidRaw = (req.body && req.body.paid) ?? null;
        if (paidRaw === null || paidRaw === undefined) {
            return res.status(400).json({ message: 'Campo paid mancante' });
        }
        const paid = paidRaw === true || paidRaw === 1 || paidRaw === '1' || String(paidRaw).toLowerCase() === 'true' ? 1 : 0;
        // Se settiamo a pagata, imposta data_riferimento_incasso se assente; se togliamo pagamento, azzera la data
        const sql = `UPDATE \`${tableName}\`
                    SET fattura_pagata = ?,
                        data_riferimento_incasso = CASE WHEN ? = 1 THEN IFNULL(data_riferimento_incasso, CURDATE()) ELSE NULL END,
                        updated_at = NOW()
                    WHERE id = ?`;
        const [result] = await db.pool.query(sql, [paid, paid, id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Firma non trovata' });
        }
        res.json({ message: 'Aggiornato', id, paid });
    } catch (error) {
        console.error('Errore toggle paid:', error);
        res.status(500).json({ message: 'Errore aggiornamento pagamento.' });
    }
});

// GET /api/signatures/search?q=...&limit=20
router.get('/signatures/search', async (req, res) => {
    try {
        const baseTableEnv = process.env.DB_TABLE || 'digital_signatures';
        const tableName = baseTableEnv.replace(/[^a-zA-Z0-9_]/g, '') || 'digital_signatures';
        const q = String(req.query.q || '').trim();
        const rawLimit = parseInt(String(req.query.limit || '20'), 10);
        const limit = Number.isNaN(rawLimit) ? 20 : Math.max(1, Math.min(100, rawLimit));
        if (q.length < 2) {
            return res.json({ data: [] });
        }

        const like = `%${q}%`;
        const [rows] = await db.pool.query(
            `SELECT id, titolare, email, recapito_telefonico
             FROM \`${tableName}\`
             WHERE titolare LIKE ? OR email LIKE ? OR fattura_numero LIKE ?
             ORDER BY titolare ASC
             LIMIT ?`,
            [like, like, like, limit]
        );
        res.json({ data: rows });
    } catch (error) {
        console.error('Errore search signatures:', error);
        res.status(500).json({ message: 'Errore nella ricerca.' });
    }
});

// GET /api/signatures/next-id (definito prima di /:id per evitare conflitti)
router.get('/signatures/next-id', async (req, res) => {
    try {
        const baseTableEnv = process.env.DB_TABLE || 'digital_signatures';
        const tableName = baseTableEnv.replace(/[^a-zA-Z0-9_]/g, '') || 'digital_signatures';
        const [[row]] = await db.pool.query(`SELECT IFNULL(MAX(id),0)+1 AS nextId FROM \`${tableName}\``);
        res.json({ nextId: row?.nextId || 1 });
    } catch (error) {
        console.error('Errore next-id:', error);
        res.status(500).json({ message: 'Errore nel calcolo del prossimo ID.' });
    }
});


// Utility: parse simple date strings to YYYY-MM-DD
const toSqlDate = (value) => {
    if (!value) return null;
    if (typeof value === 'string') {
        const t = value.trim();
        const m1 = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
        if (m1) {
            const y = m1[1];
            const mm = String(parseInt(m1[2], 10)).padStart(2, '0');
            const dd = String(parseInt(m1[3], 10)).padStart(2, '0');
            return `${y}-${mm}-${dd}`;
        }
        const m2 = t.replace(/\./g, '/').replace(/-/g, '/').match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
        if (m2) {
            let y = parseInt(m2[3], 10);
            if (y < 100) y += y >= 50 ? 1900 : 2000;
            const mm = String(parseInt(m2[2], 10)).padStart(2, '0');
            const dd = String(parseInt(m2[1], 10)).padStart(2, '0');
            return `${y}-${mm}-${dd}`;
        }
    }
    return null;
};

// (next-id definito sopra)

// POST /api/signatures
router.post('/signatures', async (req, res) => {
    try {
        const baseTableEnv = process.env.DB_TABLE || 'digital_signatures';
        const tableName = baseTableEnv.replace(/[^a-zA-Z0-9_]/g, '') || 'digital_signatures';

        const body = req.body || {};
        let { id } = body;
        const til = (v) => (typeof v === 'string' ? v.trim() : v);
        const titolare = til(body.titolare || '');
        if (!titolare) return res.status(400).json({ message: 'Campo titolare obbligatorio.' });

        if (id == null || id === '') {
            const [[row]] = await db.pool.query(`SELECT IFNULL(MAX(id),0)+1 AS nextId FROM \`${tableName}\``);
            id = row?.nextId || 1;
        } else {
            id = parseInt(String(id), 10);
            if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ message: 'ID non valido.' });
        }

        const email = til(body.email || null);
        const recapito_telefonico = til(body.recapito_telefonico || null);
        const data_emissione = toSqlDate(body.data_emissione) || null;
        const emesso_da = til(body.emesso_da || null);
        const fattura_numero = til(body.fattura_numero || null);
        const fattura_tipo_invio = til(body.fattura_tipo_invio || null);
        const costo_ie = body.costo_ie != null ? Number.parseFloat(body.costo_ie) : null;
        const importo_ie = body.importo_ie != null ? Number.parseFloat(body.importo_ie) : null;
        const paidRaw = body.paid;
        const paid = paidRaw === true || paidRaw === 1 || paidRaw === '1' || String(paidRaw).toLowerCase() === 'true';
        // Se pagata e non è stata fornita una data di incasso, usa la data odierna
        const nowDate = new Date();
        const today = `${nowDate.getFullYear()}-${String(nowDate.getMonth()+1).padStart(2,'0')}-${String(nowDate.getDate()).padStart(2,'0')}`;
        const data_riferimento_incasso = paid && !body.data_riferimento_incasso ? today : (toSqlDate(body.data_riferimento_incasso) || null);

        // Try insert; if duplicate id, return conflict
        const sql = `INSERT INTO \`${tableName}\` (id, titolare, email, recapito_telefonico, data_emissione, emesso_da, costo_ie, importo_ie, fattura_numero, fattura_tipo_invio, data_riferimento_incasso, fattura_pagata, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`;
        await db.pool.query(sql, [
            id,
            titolare,
            email,
            recapito_telefonico,
            data_emissione,
            emesso_da,
            isNaN(costo_ie) ? null : costo_ie,
            isNaN(importo_ie) ? null : importo_ie,
            fattura_numero,
            fattura_tipo_invio,
            data_riferimento_incasso,
            paid ? 1 : 0
        ]);

        if (assetTableName) {
            const assetInput = Array.isArray(body.assets) ? body.assets : [];
            const validAssets = [];
            const seenKeys = new Set();
            assetInput.forEach((asset) => {
                if (!asset) return;
                const category = normalizeAssetCategory(asset.category);
                const subtype = normalizeAssetSubtype(asset.subtype);
                if (!isValidAssetCombo(category, subtype)) return;
                const key = `${category}::${subtype}`;
                if (seenKeys.has(key)) return;
                seenKeys.add(key);
                validAssets.push({ category, subtype });
            });
            try {
                await db.pool.query(`DELETE FROM \`${assetTableName}\` WHERE signature_id = ?`, [id]);
                if (validAssets.length > 0) {
                    const placeholders = validAssets.map(() => '(?, ?, ?, ?)').join(', ');
                    const params = [];
                    validAssets.forEach(({ category, subtype }) => {
                        params.push(id, category, subtype, 1);
                    });
                    await db.pool.query(
                        `INSERT INTO \`${assetTableName}\` (signature_id, category, subtype, has_item) VALUES ${placeholders}`,
                        params
                    );
                }
            } catch (assetError) {
                console.error('Errore salvataggio asset firma:', assetError);
            }
        }

        res.status(201).json({ message: 'Firma inserita correttamente.', id });
    } catch (error) {
        if (error && error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ message: 'ID già esistente. Scegli un altro ID.' });
        }
        console.error('Errore insert signature:', error);
        res.status(500).json({ message: 'Errore durante l\'inserimento.' });
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
        const renewalTableEnv = process.env.DB_RENEWAL_TABLE || `${baseTable}_renewals`;
        const renewalTable = renewalTableEnv.replace(/[^a-zA-Z0-9_]/g, '') || `${baseTable}_renewals`;

        // Total count
        const [countRows] = await db.pool.query(
            `SELECT COUNT(*) AS total FROM (
                SELECT r.signature_id AS id
                FROM \`${renewalTable}\` r
                WHERE r.data_scadenza IS NOT NULL
                  AND r.data_scadenza > CURDATE()
                  AND r.data_scadenza <= DATE_ADD(CURDATE(), INTERVAL ? DAY)
                GROUP BY r.signature_id
            ) t`,
            [days]
        );
        const total = countRows[0]?.total || 0;

        // Page data
        const [rows] = await db.pool.query(
            `SELECT r.signature_id AS id,
                    s.titolare,
                    s.email,
                    s.recapito_telefonico,
                    MIN(r.data_scadenza) AS data_scadenza,
                    DATEDIFF(MIN(r.data_scadenza), CURDATE()) AS days_left
             FROM \`${renewalTable}\` r
             LEFT JOIN \`${baseTable}\` s ON s.id = r.signature_id
             WHERE r.data_scadenza IS NOT NULL
               AND r.data_scadenza > CURDATE()
               AND r.data_scadenza <= DATE_ADD(CURDATE(), INTERVAL ? DAY)
             GROUP BY r.signature_id, s.titolare, s.email, s.recapito_telefonico
             ORDER BY data_scadenza ASC
             LIMIT ? OFFSET ?`,
            [days, pageSize, offset]
        );

        const normalizedRows = rows.map((row) => ({
            ...row,
            data_scadenza: formatDateEuropeRome(row.data_scadenza),
            days_left: row.days_left != null ? Number(row.days_left) : null
        }));

        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        res.json({ data: normalizedRows, days, page, pageSize, total, totalPages });
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

// GET /api/signatures/:id (dettaglio semplice)
router.get('/signatures/:id', async (req, res) => {
    try {
        const id = parseInt(String(req.params.id), 10);
        if (Number.isNaN(id) || id <= 0) {
            return res.status(400).json({ message: 'ID non valido' });
        }
        const baseTableEnv = process.env.DB_TABLE || 'digital_signatures';
        const tableName = baseTableEnv.replace(/[^a-zA-Z0-9_]/g, '') || 'digital_signatures';
        const assetTableEnv = process.env.DB_ASSET_TABLE || `${tableName}_assets`;
        const assetTableName = sanitizeIdentifier(assetTableEnv, `${tableName}_assets`);
        const [rows] = await db.pool.query(
            `SELECT id, titolare, email, recapito_telefonico, data_emissione, emesso_da, costo_ie, importo_ie, fattura_numero, fattura_tipo_invio
             FROM \`${tableName}\`
             WHERE id = ?
             LIMIT 1`,
            [id]
        );
        if (!rows || rows.length === 0) {
            return res.status(404).json({ message: 'Firma non trovata' });
        }
        let assets = [];
        if (assetTableName) {
            try {
                const [assetRows] = await db.pool.query(
                    `SELECT category, subtype, has_item FROM \`${assetTableName}\` WHERE signature_id = ?`,
                    [id]
                );
                assets = assetRows.map((row) => ({
                    category: normalizeAssetCategory(row.category),
                    subtype: normalizeAssetSubtype(row.subtype),
                    has_item: row.has_item
                }));
            } catch (assetError) {
                console.error('Errore recupero asset firma:', assetError);
            }
        }
        const baseRecord = rows[0];
        const normalizedRecord = {
            ...baseRecord,
            data_emissione: formatDateEuropeRome(baseRecord.data_emissione),
            costo_ie: toNumberOrNull(baseRecord.costo_ie),
            importo_ie: toNumberOrNull(baseRecord.importo_ie)
        };
        res.json({ data: { ...normalizedRecord, assets } });
    } catch (error) {
        console.error('Errore get signature:', error);
        res.status(500).json({ message: 'Errore nel recupero della firma.' });
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

        const normalizedRows = rows.map((row) => ({
            ...row,
            data_emissione: formatDateEuropeRome(row.data_emissione),
            data_scadenza: formatDateEuropeRome(row.data_scadenza),
            rinnovo_data: formatDateEuropeRome(row.rinnovo_data),
            data_riferimento_incasso: formatDateEuropeRome(row.data_riferimento_incasso),
            created_at: formatDateEuropeRome(row.created_at),
            updated_at: formatDateEuropeRome(row.updated_at),
            costo_ie: toNumberOrNull(row.costo_ie),
            importo_ie: toNumberOrNull(row.importo_ie)
        }));

        res.json({ data: normalizedRows });
    } catch (error) {
        console.error('Errore renewals:', error);
        res.status(500).json({ message: 'Errore nel recupero dei rinnovi.' });
    }
});
module.exports = router;
