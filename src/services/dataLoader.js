const fs = require('fs/promises');
const path = require('path');
const dbConnector = require('./dbConnector');
const { parseXLS } = require('./xlsParser');
const { isEmpty } = require('../utils/helpers');

const BASE_COLUMN_MAPPING = {
    'N°': 'id',
    Titolare: 'titolare',
    'Data Emissione': 'data_emissione',
    'Emesso DA': 'emesso_da',
    'Costo (i.e.)': 'costo_ie',
    'Fatturazione Costo (i.e.)': 'costo_ie',
    'Importo (i.e.)': 'importo_ie',
    'Fatturazione Importo (i.e.)': 'importo_ie',
    'N° Documento': 'fattura_numero',
    'Fatturazione N° Documento': 'fattura_numero',
    'Tipo Invio': 'fattura_tipo_invio',
    'Fatturazione Tipo Invio': 'fattura_tipo_invio',
    'Tipo Pag.': 'fattura_tipo_pagamento',
    'Tipo Pagamento': 'fattura_tipo_pagamento',
    'Fatturazione Tipo Pag.': 'fattura_tipo_pagamento',
    Note: 'note'
};

const DOCUMENT_COLUMN_MAPPING = {
    'Documenti MR': { category: 'DOCUMENTO', subtype: 'MR' },
    'Documenti AEC': { category: 'DOCUMENTO', subtype: 'AEC' },
    'Documenti DI': { category: 'DOCUMENTO', subtype: 'DI' }
};

const ASSET_COLUMN_MAPPING = {
    'KIT STD': { category: 'KIT', subtype: 'STD' },
    'KIT TOK': { category: 'KIT', subtype: 'TOK' },
    'KIT AK': { category: 'KIT', subtype: 'AK' },
    'KIT AK-CNS': { category: 'KIT', subtype: 'AK-CNS' },
    'SMART CARD STD': { category: 'SMART_CARD', subtype: 'STD' },
    'SMART CARD SIM': { category: 'SMART_CARD', subtype: 'SIM' },
    'SMART CARD TAV': { category: 'SMART_CARD', subtype: 'TAV' },
    'LETTORE TOK': { category: 'LETTORE', subtype: 'TOK' },
    'LETTORE AK': { category: 'LETTORE', subtype: 'AK' },
    'CERTIFICATO CNS-L': { category: 'CERTIFICATO', subtype: 'CNS-L' },
    'CERTIFICATO CNS': { category: 'CERTIFICATO', subtype: 'CNS' },
    'CERTIFICATO CFD': { category: 'CERTIFICATO', subtype: 'CFD' },
    'CERTIFICATO CFD-R': { category: 'CERTIFICATO', subtype: 'CFD-R' }
};

const BOOLEAN_COLUMNS = new Set();
const MONEY_COLUMNS = new Set(['costo_ie', 'importo_ie']);
const DATE_COLUMNS = new Set(['data_emissione']);

const TRUTHY_MARKERS = new Set([
    '■',
    'x',
    'X',
    'si',
    'sì',
    'sí',
    'yes',
    'y',
    'true',
    '1'
]);

const sanitizeTableName = (name = '', fallback) => {
    const trimmed = String(name || '').trim();
    const safe = trimmed.replace(/[^a-zA-Z0-9_]/g, '');
    if (safe.length > 0) {
        return safe;
    }
    return fallback;
};

const standardiseKey = (key = '') =>
    String(key)
        .replace(/\u00A0/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/\r?\n/g, ' ')
        .trim();

const normaliseForLookup = (key = '') =>
    standardiseKey(key)
        .toLowerCase()
        .replace(/[^\da-zàèéìòù°]/gi, '');

const buildLookup = (mapping, type) =>
    Object.entries(mapping).reduce((lookup, [excelKey, value]) => {
        const standardKey = standardiseKey(excelKey);
        const variants = [
            standardKey,
            standardKey.toLowerCase(),
            normaliseForLookup(excelKey)
        ];

        variants.forEach((variant) => {
            lookup[variant] = { type, value };
        });

        return lookup;
    }, {});

const COLUMN_LOOKUP = {
    ...buildLookup(BASE_COLUMN_MAPPING, 'base'),
    ...buildLookup(ASSET_COLUMN_MAPPING, 'asset'),
    ...buildLookup(DOCUMENT_COLUMN_MAPPING, 'document')
};

const buildColumnNames = (headerRows) => {
    const [topRow = [], bottomRow = []] = headerRows;
    const maxLength = Math.max(topRow.length, bottomRow.length);
    const columns = [];

    for (let i = 0; i < maxLength; i += 1) {
        const top = standardiseKey(topRow[i] || '');
        const bottom = standardiseKey(bottomRow[i] || '');

        if (bottom && top && top !== bottom) {
            columns.push(`${top} ${bottom}`.trim());
        } else if (bottom) {
            columns.push(bottom);
        } else if (top) {
            columns.push(top);
        } else {
            columns.push(`column_${i}`);
        }
    }

    return columns;
};

const rowToRecord = (row, columns) => {
    const record = {};

    columns.forEach((columnName, index) => {
        if (index >= row.length) {
            return;
        }

        const value = row[index];
        if (value === null || value === undefined) {
            return;
        }

        record[columnName] = value;
    });

    return record;
};

const mapColumnKey = (key) => {
    const variants = [
        standardiseKey(key),
        standardiseKey(key).toLowerCase(),
        normaliseForLookup(key)
    ];

    for (const variant of variants) {
        if (COLUMN_LOOKUP[variant]) {
            return COLUMN_LOOKUP[variant];
        }
    }

    return null;
};

const parseBoolean = (value) => {
    if (value === null || value === undefined) {
        return false;
    }

    if (typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'number') {
        return value !== 0;
    }

    const trimmed = standardiseKey(String(value)).toLowerCase();

    if (TRUTHY_MARKERS.has(trimmed) || TRUTHY_MARKERS.has(value)) {
        return true;
    }

    if (trimmed === '' || trimmed === '-' || trimmed === 'no' || trimmed === '0') {
        return false;
    }

    return false;
};

const parseMoney = (value) => {
    if (value === null || value === undefined) {
        return null;
    }

    if (typeof value === 'number') {
        return Number(value.toFixed(2));
    }

    const trimmed = String(value)
        .replace(/€/g, '')
        .replace(/\s+/g, '')
        .replace(/\./g, '')
        .replace(',', '.')
        .trim();

    if (trimmed === '' || trimmed === '-') {
        return null;
    }

    const parsed = Number.parseFloat(trimmed);
    return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : null;
};

const parseDate = (value) => {
    if (value === null || value === undefined || value === '' || value === '-') {
        return null;
    }

    if (typeof value === 'number') {
        const excelEpoch = new Date(Math.round((value - 25569) * 86400 * 1000));
        return excelEpoch.toISOString().slice(0, 10);
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed === '' || trimmed === '-') {
            return null;
        }

        const normalised = trimmed.replace(/-/g, '/').replace(/\./g, '/');
        const pattern = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/;
        const match = normalised.match(pattern);

        if (match) {
            const day = Number.parseInt(match[1], 10);
            const month = Number.parseInt(match[2], 10) - 1;
            let year = Number.parseInt(match[3], 10);

            if (year < 100) {
                year += year >= 50 ? 1900 : 2000;
            }

            const parsedDate = new Date(year, month, day);
            if (Number.isNaN(parsedDate.getTime())) {
                return null;
            }

            return parsedDate.toISOString().slice(0, 10);
        }
    }

    return null;
};

const parseGenericValue = (value) => {
    if (value === null || value === undefined) {
        return null;
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();

        if (trimmed === '' || trimmed === '-') {
            return null;
        }

        return trimmed;
    }

    return value;
};

const normaliseId = (value) => {
    if (isEmpty(value)) {
        return null;
    }

    const trimmed = String(value).trim();
    if (trimmed === '') {
        return null;
    }

    const numericMatch = trimmed.match(/\d+/);
    return numericMatch ? numericMatch[0] : trimmed;
};

const normaliseRecord = (rawRecord) => {
    const baseRaw = {};
    const assetRaw = [];
    const documentRaw = [];

    Object.entries(rawRecord).forEach(([rawKey, rawValue]) => {
        const mapped = mapColumnKey(rawKey);
        if (!mapped) {
            return;
        }

        if (mapped.type === 'asset') {
            assetRaw.push({
                category: mapped.value.category,
                subtype: mapped.value.subtype,
                value: rawValue
            });
            return;
        }

        if (mapped.type === 'document') {
            documentRaw.push({
                category: mapped.value.category,
                subtype: mapped.value.subtype,
                value: rawValue
            });
            return;
        }

        baseRaw[mapped.value] = rawValue;
    });

    if (!baseRaw.id) {
        baseRaw.id = normaliseId(rawRecord['N°']);
    } else {
        baseRaw.id = normaliseId(baseRaw.id);
    }

    if (!baseRaw.id) {
        return null;
    }

    const baseNormalised = {};

    Object.entries(baseRaw).forEach(([key, value]) => {
        if (key === 'id') {
            baseNormalised.id = normaliseId(value);
            return;
        }

        if (BOOLEAN_COLUMNS.has(key)) {
            baseNormalised[key] = parseBoolean(value);
            return;
        }

        if (MONEY_COLUMNS.has(key)) {
            baseNormalised[key] = parseMoney(value);
            return;
        }

        if (DATE_COLUMNS.has(key)) {
            baseNormalised[key] = parseDate(value);
            return;
        }

        baseNormalised[key] = parseGenericValue(value);
    });

    BOOLEAN_COLUMNS.forEach((column) => {
        if (!(column in baseNormalised)) {
            baseNormalised[column] = false;
        }
    });

    if (!baseNormalised.titolare) {
        baseNormalised.titolare = '';
    }

    const assetsNormalised = assetRaw
        .map(({ category, subtype, value }) => ({
            category,
            subtype,
            value: parseBoolean(value)
        }))
        .filter((asset) => asset.value);

    const documentsNormalised = documentRaw
        .map(({ category, subtype, value }) => ({
            category,
            subtype,
            value: parseBoolean(value)
        }))
        .filter((document) => document.value);

    return {
        base: baseNormalised,
        assets: assetsNormalised,
        documents: documentsNormalised
    };
};

const buildRecordsFromRows = (rows) => {
    if (!Array.isArray(rows) || rows.length === 0) {
        return [];
    }

    let headerRowCount = Math.min(2, rows.length);

    if (rows.length >= 2) {
        const secondRow = rows[1] || [];
        const firstCell = secondRow[0];
        const firstCellString =
            firstCell === null || firstCell === undefined ? '' : String(firstCell).trim();
        const looksLikeDataRow = firstCellString !== '' && /^\d+/.test(firstCellString);

        if (looksLikeDataRow) {
            headerRowCount = 1;
        }
    }

    const headerRows = rows.slice(0, headerRowCount);
    const dataRows = rows.slice(headerRowCount);

    if (headerRows.length === 1) {
        headerRows.push([]);
    }

    if (!Array.isArray(dataRows) || dataRows.length === 0) {
        return [];
    }

    const columns = buildColumnNames(headerRows);

    return dataRows
        .map((row) => rowToRecord(row, columns))
        .map((record) => normaliseRecord(record))
        .filter((record) => record !== null);
};

const loadDataToDatabase = async (
    connection,
    records,
    baseTableName,
    assetTableName,
    documentTableName
) => {
    if (!Array.isArray(records) || records.length === 0) {
        console.log('Nessun dato da importare nel database.');
        return;
    }

    for (const record of records) {
        const { base, assets, documents } = record;

        await connection.query(`REPLACE INTO \`${baseTableName}\` SET ?`, base);

        await connection.query(`DELETE FROM \`${assetTableName}\` WHERE signature_id = ?`, [
            base.id
        ]);

        if (Array.isArray(assets) && assets.length > 0) {
            const insertValues = assets.map(() => '(?, ?, ?, 1)').join(', ');
            const params = [];

            assets.forEach((asset) => {
                params.push(base.id, asset.category, asset.subtype);
            });

            const insertSql = `INSERT INTO \`${assetTableName}\` (signature_id, category, subtype, has_item) VALUES ${insertValues}`;
            await connection.query(insertSql, params);
        }

        await connection.query(`DELETE FROM \`${documentTableName}\` WHERE signature_id = ?`, [
            base.id
        ]);

        if (Array.isArray(documents) && documents.length > 0) {
            const insertValues = documents.map(() => '(?, ?, ?, 1)').join(', ');
            const params = [];

            documents.forEach((document) => {
                params.push(base.id, document.category, document.subtype);
            });

            const insertSql = `INSERT INTO \`${documentTableName}\` (signature_id, category, subtype, has_item) VALUES ${insertValues}`;
            await connection.query(insertSql, params);
        }
    }
};

const loadDataFromXLS = async (filePath) => {
    const absolutePath = path.resolve(filePath);
    const baseTableName = sanitizeTableName(process.env.DB_TABLE, 'digital_signatures');
    const assetTableName = sanitizeTableName(
        process.env.DB_ASSET_TABLE,
        `${baseTableName}_assets`
    );
    const documentTableName = sanitizeTableName(
        process.env.DB_DOCUMENT_TABLE,
        `${baseTableName}_documents`
    );
    const rows = parseXLS(absolutePath);
    const records = buildRecordsFromRows(rows);

    if (!Array.isArray(records) || records.length === 0) {
        console.log('Il file XLS non contiene righe valide da importare.');
        await fs.unlink(absolutePath).catch(() => {});
        return;
    }

    const connection = await dbConnector.getConnection();

    try {
        await connection.beginTransaction();
        await loadDataToDatabase(
            connection,
            records,
            baseTableName,
            assetTableName,
            documentTableName
        );
        await connection.commit();
        console.log(
            `Importazione completata: ${records.length} righe elaborate per la tabella ${baseTableName}.`
        );
    } catch (error) {
        await connection.rollback();
        console.error("Errore durante l'importazione dei dati:", error);
        throw error;
    } finally {
        connection.release();
        await fs.unlink(absolutePath).catch(() => {});
    }
};

module.exports = {
    loadDataFromXLS,
    loadDataToDatabase
};
