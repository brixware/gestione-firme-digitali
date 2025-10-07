const fs = require('fs/promises');
const path = require('path');
const dbConnector = require('./dbConnector');
const { parseWorkbook } = require('./xlsParser');
const { isEmpty } = require('../utils/helpers');

const XLS_START_ROW = parseInt(process.env.XLS_START_ROW || '10', 10);
const XLS_END_ROW = parseInt(process.env.XLS_END_ROW || '2247', 10);
const XLS_HEADER_ROWS = parseInt(process.env.XLS_HEADER_ROWS || '2', 10);

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

const CONTACT_COLUMN_MAPPING = {
    'N°': 'id',
    Titolare: 'titolare',
    Email: 'email',
    'Recapito Telefonico': 'recapito_telefonico'
};

const RENEWAL_COLUMN_MAPPING = {
    'N°': 'id',
    Titolare: 'titolare',
    Email: 'email',
    'Recapito Telefonico': 'recapito_telefonico',
    'CERTIFICATO CNS-L': 'certificato_cns_l',
    'CERTIFICATO CNS': 'certificato_cns',
    'CERTIFICATO CFD': 'certificato_cfd',
    'CERTIFICATO CFD-R': 'certificato_cfd_r',
    'Data Emissione': 'data_emissione',
    Emissione: 'data_emissione',
    'Data Scadenza': 'data_scadenza',
    Scadenza: 'data_scadenza',
    'Rinnovo Data': 'rinnovo_data',
    'Rinnovo DA': 'rinnovo_da',
    'Costo (i.e.)': 'costo_ie',
    'Fatturazione Costo (i.e.)': 'costo_ie',
    'Importo (i.e.)': 'importo_ie',
    'Fatturazione Importo (i.e.)': 'importo_ie',
    'Fatturazione N° Documento': 'fattura_numero',
    'Fatturazione Tipo Invio': 'fattura_tipo_invio',
    'Fatturazione Tipo Pag.': 'fattura_tipo_pagamento',
    'Tipo Invio': 'fattura_tipo_invio',
    'Tipo Pag.': 'fattura_tipo_pagamento',
    Note: 'note',
    'Note ': 'note',
    'column_16': 'note',
    'column_17': 'note',
    'column_18': 'note'
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

const CONTACT_LOOKUP = buildLookup(CONTACT_COLUMN_MAPPING, 'contact');
const RENEWAL_LOOKUP = buildLookup(RENEWAL_COLUMN_MAPPING, 'renewal');

const createDefinitions = (mapping) => {
    const map = new Map();
    Object.values(mapping).forEach(({ category, subtype }) => {
        const key = `${category}::${subtype}`;
        if (!map.has(key)) {
            map.set(key, { key, category, subtype });
        }
    });
    return Array.from(map.values());
};

const ASSET_DEFINITIONS = createDefinitions(ASSET_COLUMN_MAPPING);
const DOCUMENT_DEFINITIONS = createDefinitions(DOCUMENT_COLUMN_MAPPING);

const buildColumnNames = (headerRows) => {
    if (!Array.isArray(headerRows) || headerRows.length === 0) {
        return [];
    }

    const maxLength = headerRows.reduce(
        (max, row) => Math.max(max, Array.isArray(row) ? row.length : 0),
        0
    );
    const columns = [];

    for (let i = 0; i < maxLength; i += 1) {
        const parts = headerRows
            .map((row) => (Array.isArray(row) ? standardiseKey(row[i] || '') : ''))
            .filter((value) => value && value.length > 0);

        if (parts.length === 0) {
            columns.push(`column_${i}`);
            continue;
        }

        const uniqueParts = parts.filter((value, index) => parts.indexOf(value) === index);
        columns.push(uniqueParts.join(' ').trim());
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

const rowHasValues = (row = []) =>
    Array.isArray(row) &&
    row.some((value) => {
        if (value === null || value === undefined) {
            return false;
        }
        if (typeof value === 'string' && value.trim() === '') {
            return false;
        }
        return true;
    });

const prepareSheetRows = (rows) => {
    if (!Array.isArray(rows) || rows.length === 0) {
        return { columns: [], dataRows: [] };
    }

    const startRow = Math.max(1, XLS_START_ROW);
    const endRow = Math.max(startRow, XLS_END_ROW);

    const headerCandidates = rows.slice(0, startRow - 1).filter(rowHasValues);
    const headerRows = headerCandidates.slice(-XLS_HEADER_ROWS);

    if (headerRows.length === 0) {
        headerRows.push([]);
    }

    const columns = buildColumnNames(headerRows);

    const dataRows = rows
        .map((row, index) => ({ row, excelRowNumber: index + 1 }))
        .filter(({ excelRowNumber }) => excelRowNumber >= startRow && excelRowNumber <= endRow)
        .map(({ row }) => row)
        .filter(rowHasValues);

    return { columns, dataRows };
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
        return Number.isNaN(excelEpoch.getTime()) ? null : excelEpoch.toISOString().slice(0, 10);
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
    if (numericMatch) {
        const parsed = Number.parseInt(numericMatch[0], 10);
        return Number.isNaN(parsed) ? null : parsed;
    }

    const fallback = Number.parseInt(trimmed, 10);
    if (Number.isNaN(fallback)) {
        return null;
    }

    return fallback;
};

const mapColumnKey = (key, lookup) => {
    const variants = [
        standardiseKey(key),
        standardiseKey(key).toLowerCase(),
        normaliseForLookup(key)
    ];

    for (const variant of variants) {
        if (lookup[variant]) {
            return lookup[variant];
        }
    }

    return null;
};

const normaliseMasterRecord = (rawRecord) => {
    const baseRaw = {};
    const assetMap = new Map(
        ASSET_DEFINITIONS.map((def) => [
            def.key,
            {
                category: def.category,
                subtype: def.subtype,
                value: 0,
                present: true
            }
        ])
    );
    const documentMap = new Map(
        DOCUMENT_DEFINITIONS.map((def) => [
            def.key,
            {
                category: def.category,
                subtype: def.subtype,
                value: 0,
                present: true
            }
        ])
    );

    Object.entries(rawRecord).forEach(([rawKey, rawValue]) => {
        const mapped = mapColumnKey(rawKey, COLUMN_LOOKUP);
        if (!mapped) {
            return;
        }

        if (mapped.type === 'asset') {
            const key = `${mapped.value.category}::${mapped.value.subtype}`;
            const entry = assetMap.get(key);
            if (entry) {
                entry.value = parseBoolean(rawValue) ? 1 : 0;
                entry.present = true;
            }
            return;
        }

        if (mapped.type === 'document') {
            const key = `${mapped.value.category}::${mapped.value.subtype}`;
            const entry = documentMap.get(key);
            if (entry) {
                entry.value = parseBoolean(rawValue) ? 1 : 0;
                entry.present = true;
            }
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

        if (key === 'fattura_tipo_pagamento') {
            const parsedDate = parseDate(value);
            if (parsedDate) {
                baseNormalised.fattura_tipo_pagamento = 'Altro';
                baseNormalised.fattura_data_pagamento = parsedDate;
            } else {
                baseNormalised.fattura_tipo_pagamento = parseGenericValue(value);
            }
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
    if (!('fattura_tipo_pagamento' in baseNormalised)) {
        baseNormalised.fattura_tipo_pagamento = null;
    }
    if (!('fattura_data_pagamento' in baseNormalised)) {
        baseNormalised.fattura_data_pagamento = null;
    }

    const assetsNormalised = Array.from(assetMap.values())
        .filter((asset) => asset.present)
        .map((asset) => ({
            category: asset.category,
            subtype: asset.subtype,
            value: asset.value ? 1 : 0
        }));

    const documentsNormalised = Array.from(documentMap.values())
        .filter((document) => document.present)
        .map((document) => ({
            category: document.category,
            subtype: document.subtype,
            value: document.value ? 1 : 0
        }));

    return {
        base: baseNormalised,
        assets: assetsNormalised,
        documents: documentsNormalised
    };
};

const normaliseContactRecord = (rawRecord) => {
    const mapped = {};

    Object.entries(rawRecord).forEach(([rawKey, rawValue]) => {
        const target = mapColumnKey(rawKey, CONTACT_LOOKUP);
        if (!target) {
            return;
        }
        mapped[target.value] = rawValue;
    });

    const id = normaliseId(mapped.id || rawRecord['N°']);
    if (!id) {
        return null;
    }

    return {
        id,
        email: parseGenericValue(mapped.email),
        recapito_telefonico: parseGenericValue(mapped.recapito_telefonico)
    };
};

const normaliseRenewalRecord = (rawRecord, sheetName) => {
    const mapped = {};

    Object.entries(rawRecord).forEach(([rawKey, rawValue]) => {
        const target = mapColumnKey(rawKey, RENEWAL_LOOKUP);
        if (!target) {
            return;
        }

        if (target.value === 'note') {
            const parsedNote = parseGenericValue(rawValue);
            if (!parsedNote) {
                return;
            }
            if (mapped.note) {
                const existing = parseGenericValue(mapped.note);
                if (existing && existing !== parsedNote) {
                    mapped.note = `${existing} | ${parsedNote}`;
                } else if (!existing) {
                    mapped.note = parsedNote;
                }
            } else {
                mapped.note = parsedNote;
            }
            return;
        }

        mapped[target.value] = rawValue;
    });

    const id = normaliseId(mapped.id || rawRecord['N°']);
    if (!id) {
        return null;
    }

    const record = {
        signature_id: id,
        sheet_name: sheetName ? sheetName.trim() : '',
        email: parseGenericValue(mapped.email),
        recapito_telefonico: parseGenericValue(mapped.recapito_telefonico),
        certificato_cns_l: parseBoolean(mapped.certificato_cns_l) ? 1 : 0,
        certificato_cns: parseBoolean(mapped.certificato_cns) ? 1 : 0,
        certificato_cfd: parseBoolean(mapped.certificato_cfd) ? 1 : 0,
        certificato_cfd_r: parseBoolean(mapped.certificato_cfd_r) ? 1 : 0,
        data_emissione: parseDate(mapped.data_emissione),
        data_scadenza: parseDate(mapped.data_scadenza),
        rinnovo_data: parseDate(mapped.rinnovo_data),
        rinnovo_da: null,
        rinnovo_riferimento: null,
        costo_ie: parseMoney(mapped.costo_ie),
        importo_ie: parseMoney(mapped.importo_ie),
        fattura_numero: parseGenericValue(mapped.fattura_numero),
        fattura_tipo_invio: parseGenericValue(mapped.fattura_tipo_invio),
        fattura_tipo_pagamento: null,
        fattura_data_pagamento: null,
        note: parseGenericValue(mapped.note)
    };

    const rinnovoDaRaw = parseGenericValue(mapped.rinnovo_da);
    if (rinnovoDaRaw) {
        const match = rinnovoDaRaw.match(/NE-?\s*(\d+)/i);
        if (match) {
            const referenceId = Number.parseInt(match[1], 10);
            record.rinnovo_da = `NE-${match[1]}`;
            record.rinnovo_riferimento = Number.isNaN(referenceId) ? null : referenceId;
        } else {
            record.rinnovo_da = rinnovoDaRaw;
        }
    }

    const paymentDate = parseDate(mapped.fattura_tipo_pagamento);
    if (paymentDate) {
        record.fattura_tipo_pagamento = 'Altro';
        record.fattura_data_pagamento = paymentDate;
    } else {
        record.fattura_tipo_pagamento = parseGenericValue(mapped.fattura_tipo_pagamento);
    }

    return record;
};

const buildMasterRecords = (rows) => {
    const { columns, dataRows } = prepareSheetRows(rows);

    return dataRows
        .map((row) => rowToRecord(row, columns))
        .map((record) => normaliseMasterRecord(record))
        .filter((record) => record !== null);
};

const buildContactRecords = (rows) => {
    const { columns, dataRows } = prepareSheetRows(rows);

    return dataRows
        .map((row) => rowToRecord(row, columns))
        .map((record) => normaliseContactRecord(record))
        .filter((record) => record !== null);
};

const buildRenewalRecords = (rows, sheetName) => {
    const { columns, dataRows } = prepareSheetRows(rows);

    return dataRows
        .map((row) => rowToRecord(row, columns))
        .map((record) => normaliseRenewalRecord(record, sheetName))
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
        return {
            base: 0,
            assets: 0,
            documents: 0
        };
    }

    let baseInserted = 0;
    let assetsInserted = 0;
    let documentsInserted = 0;

    for (const record of records) {
        const { base, assets, documents } = record;

        await connection.query(`REPLACE INTO \`${baseTableName}\` SET ?`, base);
        baseInserted += 1;

        await connection.query(`DELETE FROM \`${assetTableName}\` WHERE signature_id = ?`, [
            base.id
        ]);

        if (Array.isArray(assets) && assets.length > 0) {
            const insertValues = assets.map(() => '(?, ?, ?, ?)').join(', ');
            const params = [];

            assets.forEach((asset) => {
                params.push(base.id, asset.category, asset.subtype, asset.value ? 1 : 0);
            });

            const insertSql = `INSERT INTO \`${assetTableName}\` (signature_id, category, subtype, has_item) VALUES ${insertValues}`;
            await connection.query(insertSql, params);
            assetsInserted += assets.length;
        }

        await connection.query(`DELETE FROM \`${documentTableName}\` WHERE signature_id = ?`, [
            base.id
        ]);

        if (Array.isArray(documents) && documents.length > 0) {
            const insertValues = documents.map(() => '(?, ?, ?, ?)').join(', ');
            const params = [];

            documents.forEach((document) => {
                params.push(base.id, document.category, document.subtype, document.value ? 1 : 0);
            });

            const insertSql = `INSERT INTO \`${documentTableName}\` (signature_id, category, subtype, has_item) VALUES ${insertValues}`;
            await connection.query(insertSql, params);
            documentsInserted += documents.length;
        }
    }

    return {
        base: baseInserted,
        assets: assetsInserted,
        documents: documentsInserted
    };
};

const applyContactUpdates = async (connection, baseTableName, contacts) => {
    if (!Array.isArray(contacts) || contacts.length === 0) {
        return 0;
    }

    let updated = 0;

    for (const contact of contacts) {
        const fields = [];
        const params = [];

        if (contact.email) {
            fields.push('email = ?');
            params.push(contact.email);
        }

        if (contact.recapito_telefonico) {
            fields.push('recapito_telefonico = ?');
            params.push(contact.recapito_telefonico);
        }

        if (fields.length === 0) {
            continue;
        }

        fields.push('updated_at = NOW()');
        params.push(contact.id);

        const [result] = await connection.query(
            `UPDATE \`${baseTableName}\` SET ${fields.join(', ')} WHERE id = ?`,
            params
        );
        updated += result.affectedRows;
    }

    return updated;
};

const replaceRenewals = async (connection, renewalTableName, renewals) => {
    if (!renewalTableName) {
        return 0;
    }

    await connection.query(`DELETE FROM \`${renewalTableName}\``);

    if (!Array.isArray(renewals) || renewals.length === 0) {
        return 0;
    }

    const columns = [
        'signature_id',
        'sheet_name',
        'email',
        'recapito_telefonico',
        'certificato_cns_l',
        'certificato_cns',
        'certificato_cfd',
        'certificato_cfd_r',
        'data_emissione',
        'data_scadenza',
        'rinnovo_data',
        'rinnovo_da',
        'costo_ie',
        'importo_ie',
        'fattura_numero',
        'fattura_tipo_invio',
        'fattura_tipo_pagamento',
        'fattura_data_pagamento',
        'note',
        'created_at',
        'updated_at'
    ];

    const chunkSize = 500;
    let inserted = 0;

    for (let i = 0; i < renewals.length; i += chunkSize) {
        const chunk = renewals.slice(i, i + chunkSize);
        const placeholders = chunk
            .map(() => `(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`)
            .join(', ');
        const params = [];

        chunk.forEach((renewal) => {
            params.push(
                renewal.signature_id,
                renewal.sheet_name,
                renewal.email,
                renewal.recapito_telefonico,
                renewal.certificato_cns_l ? 1 : 0,
                renewal.certificato_cns ? 1 : 0,
                renewal.certificato_cfd ? 1 : 0,
                renewal.certificato_cfd_r ? 1 : 0,
                renewal.data_emissione,
                renewal.data_scadenza,
                renewal.rinnovo_data,
                renewal.rinnovo_da,
                renewal.costo_ie,
                renewal.importo_ie,
                renewal.fattura_numero,
                renewal.fattura_tipo_invio,
                renewal.fattura_tipo_pagamento,
                renewal.fattura_data_pagamento,
                renewal.note || null
            );
        });

        const insertSql = `INSERT INTO \`${renewalTableName}\` (${columns.join(
            ', '
        )}) VALUES ${placeholders}`;
        const [result] = await connection.query(insertSql, params);
        inserted += result.affectedRows;
    }

    return inserted;
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
    const renewalTableName = sanitizeTableName(
        process.env.DB_RENEWAL_TABLE,
        `${baseTableName}_renewals`
    );

    const sheets = parseWorkbook(absolutePath);
    if (!Array.isArray(sheets) || sheets.length === 0) {
        await fs.unlink(absolutePath).catch(() => {});
        const error = new Error('Il file XLS non contiene fogli elaborabili.');
        error.code = 'NO_SHEETS';
        throw error;
    }

    const masterSheet = sheets[0];
    const masterRecords = buildMasterRecords(masterSheet.rows);

    if (!Array.isArray(masterRecords) || masterRecords.length === 0) {
        await fs.unlink(absolutePath).catch(() => {});
        const error = new Error('Il file XLS non contiene righe valide da importare.');
        error.code = 'NO_VALID_ROWS';
        throw error;
    }

    const contactSheet = sheets[1];
    const contactRecords =
        contactSheet && Array.isArray(contactSheet.rows)
            ? buildContactRecords(contactSheet.rows)
            : [];

    const renewalRecords = sheets
        .slice(1)
        .flatMap((sheet) => buildRenewalRecords(sheet.rows, sheet.name));

    const connection = await dbConnector.getConnection();

    try {
        await connection.beginTransaction();
        const masterStats = await loadDataToDatabase(
            connection,
            masterRecords,
            baseTableName,
            assetTableName,
            documentTableName
        );
        const contactsUpdated = await applyContactUpdates(
            connection,
            baseTableName,
            contactRecords
        );
        const renewalsInserted = await replaceRenewals(
            connection,
            renewalTableName,
            renewalRecords
        );
        await connection.commit();

        const stats = {
            base: masterStats.base,
            assets: masterStats.assets,
            documents: masterStats.documents,
            contactsUpdated,
            renewalsInserted
        };

        console.log(
            `Importazione completata: base=${masterStats.base}, assets=${masterStats.assets}, documenti=${masterStats.documents}, contatti aggiornati=${contactsUpdated}, rinnovi inseriti=${renewalsInserted}.`
        );

        return stats;
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
