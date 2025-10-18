#!/usr/bin/env node
'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const xlsx = require('xlsx');
const mysql = require('mysql2/promise');

const workbookPath = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.resolve(__dirname, '..', 'uploads', 'Riepilogo_Firme_Digitali.xlsx');

const startRowIndex = Math.max(1, parseInt(process.env.XLS_START_ROW || '10', 10)) - 1;
const configuredEndRow = parseInt(process.env.XLS_END_ROW || '0', 10);
const endRowIndex =
    Number.isNaN(configuredEndRow) || configuredEndRow <= 0
        ? null
        : Math.max(startRowIndex, configuredEndRow - 1);

const truthyTokens = new Set([
    '1',
    'true',
    't',
    'yes',
    'y',
    'si',
    'sì',
    'sÃ¬',
    'ok',
    'x',
    '■'
]);

const falsyTokens = new Set(['', '-', '0', 'false', 'f', 'no', 'n', 'off', 'null', 'undefined', 'na']);

const romeFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
});

const formatDateRome = (date) => {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
        return null;
    }
    return romeFormatter.format(date);
};

const decodeMisencodedText = (value) => {
    if (typeof value !== 'string') {
        return value;
    }
    if (!/[Ã�Â]/.test(value)) {
        return value;
    }
    try {
        return Buffer.from(value, 'latin1').toString('utf8');
    } catch (error) {
        return value;
    }
};

const toIsoDate = (value) => {
    if (value === null || value === undefined || value === '' || value === '-') {
        return null;
    }

    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return formatDateRome(value);
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
        const epoch = new Date(Math.round((value - 25569) * 86400 * 1000));
        return formatDateRome(epoch);
    }

    const trimmed = String(value).trim();
    if (trimmed === '' || trimmed === '-') {
        return null;
    }

    if (trimmed.includes('T')) {
        const maybeIso = new Date(trimmed);
        if (!Number.isNaN(maybeIso.getTime())) {
            return formatDateRome(maybeIso);
        }
    }

    const normalised = trimmed
        .replace(/\./g, '/')
        .replace(/-/g, '/')
        .split(/[T\s]/)[0];

    const tryParse = (parts, order) => {
        if (parts.length !== 3) {
            return null;
        }
        const dict = { d: null, m: null, y: null };
        ['d', 'm', 'y'].forEach((key, idx) => {
            const token = order[idx];
            let valueToken = parts[idx];
            if (token === 'y' && valueToken.length === 2) {
                const num = parseInt(valueToken, 10);
                valueToken = String(num >= 50 ? 1900 + num : 2000 + num);
            }
            dict[key] = parseInt(valueToken, 10);
        });
        if ([dict.d, dict.m, dict.y].some((num) => Number.isNaN(num))) {
            return null;
        }
        const date = new Date(dict.y, dict.m - 1, dict.d);
        return Number.isNaN(date.getTime()) ? null : formatDateRome(date);
    };

    const tokens = normalised.split('/');
    return (
        tryParse(tokens, ['d', 'm', 'y']) ||
        tryParse(tokens, ['y', 'm', 'd']) ||
        tryParse(tokens.reverse(), ['d', 'm', 'y']) ||
        (() => {
            const fallback = new Date(trimmed);
            return Number.isNaN(fallback.getTime()) ? null : formatDateRome(fallback);
        })()
    );
};

const toMoney = (value) => {
    if (value === null || value === undefined || value === '' || value === '-') {
        return null;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
        return Number(value.toFixed(2));
    }

    const trimmed = String(value)
        .replace(/['’`]/g, '')
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

const normaliseId = (value) => {
    if (value === null || value === undefined) {
        return null;
    }
    const trimmed = String(value).trim();
    if (trimmed === '') {
        return null;
    }
    const match = trimmed.match(/\d+/);
    if (match) {
        const parsed = parseInt(match[0], 10);
        return Number.isNaN(parsed) ? null : parsed;
    }
    const parsed = parseInt(trimmed, 10);
    return Number.isNaN(parsed) ? null : parsed;
};

const toText = (value) => {
    if (value === null || value === undefined) {
        return null;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed === '' || trimmed === '-' ? null : trimmed;
    }
    if (typeof value === 'number') {
        if (Number.isNaN(value)) {
            return null;
        }
        return Number.isInteger(value) ? String(value) : String(value);
    }
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return formatDateRome(value);
    }
    const stringified = String(value).trim();
    return stringified === '' ? null : stringified;
};

const toNumberOrNull = (value) =>
    value === null || value === undefined ? null : Number(value);

const toBooleanFlag = (value) => {
    if (value === null || value === undefined) {
        return 0;
    }
    if (typeof value === 'number') {
        return value === 0 ? 0 : 1;
    }
    const raw = String(value).trim();
    if (raw === '') {
        return 0;
    }
    if (truthyTokens.has(raw.toLowerCase()) || truthyTokens.has(raw) || raw.includes('■')) {
        return 1;
    }
    return falsyTokens.has(raw.toLowerCase()) ? 0 : 0;
};

const clampRowBounds = (rowsLength) => {
    if (endRowIndex === null) {
        return { start: startRowIndex, end: rowsLength - 1 };
    }
    return {
        start: startRowIndex,
        end: Math.min(endRowIndex, rowsLength - 1)
    };
};

const extractEmissionRecords = (worksheet) => {
    if (!worksheet) {
        throw new Error('Foglio \"Emissione\" non trovato nel file Excel.');
    }
    const rows = xlsx.utils.sheet_to_json(worksheet, {
        header: 1,
        defval: '',
        blankrows: true
    });
    const { start, end } = clampRowBounds(rows.length);
    const records = new Map();

    for (let i = start; i <= end; i += 1) {
        const row = rows[i];
        if (!Array.isArray(row)) {
            continue;
        }
        const id = normaliseId(row[0]);
        if (!id) {
            continue;
        }

        const paymentRaw = row[24];
        const paymentDate = toIsoDate(paymentRaw);
        const paymentType = paymentDate ? 'Altro' : toText(paymentRaw);

        records.set(id, {
            id,
            titolare: toText(row[1]),
            email: null,
            recapito_telefonico: null,
            data_emissione: toIsoDate(row[15]),
            emesso_da: toText(row[16]),
            costo_ie: toMoney(row[20]),
            importo_ie: toMoney(row[21]),
            fattura_numero: toText(row[22]),
            fattura_tipo_invio: toText(row[23]),
            fattura_tipo_pagamento: paymentType,
            data_riferimento_incasso: paymentDate
        });
    }

    return records;
};

const extractRenewalRecords = (worksheet, sheetName) => {
    if (!worksheet) {
        throw new Error(`Foglio \"${sheetName}\" non trovato nel file Excel.`);
    }
    const rows = xlsx.utils.sheet_to_json(worksheet, {
        header: 1,
        defval: '',
        blankrows: true
    });
    const { start, end } = clampRowBounds(rows.length);
    const records = [];

    for (let i = start; i <= end; i += 1) {
        const row = rows[i];
        if (!Array.isArray(row)) {
            continue;
        }
        const id = normaliseId(row[0]);
        if (!id) {
            continue;
        }

        const noteParts = [row[16], row[17], row[18]]
            .map((value) => toText(value))
            .filter((value) => value && value.length > 0);

        const paymentRaw = row[15];
        const paymentDate = toIsoDate(paymentRaw);
        let paymentType = toText(paymentRaw);
        let paymentReference = null;
        if (paymentDate) {
            paymentType = 'Altro';
            paymentReference = paymentDate;
        }

        const rinnovoDa = toText(row[10]);

        const record = {
            signature_id: id,
            sheet_name: sheetName,
            email: toText(row[2]),
            recapito_telefonico: toText(row[3]),
            certificato_cns_l: toBooleanFlag(row[4]),
            certificato_cns: toBooleanFlag(row[5]),
            certificato_cfd: toBooleanFlag(row[6]),
            certificato_cfd_r: 0,
            data_emissione: toIsoDate(row[7]),
            data_scadenza: toIsoDate(row[8]),
            rinnovo_data: toIsoDate(row[9]),
            rinnovo_da: rinnovoDa,
            costo_ie: toMoney(row[11]),
            importo_ie: toMoney(row[12]),
            fattura_numero: toText(row[13]),
            fattura_tipo_invio: toText(row[14]),
            fattura_tipo_pagamento: paymentType,
            data_riferimento_incasso: paymentReference,
            nuova_emissione_id: null,
            note:
                noteParts.length === 0
                    ? null
                    : Array.from(new Set(noteParts))
                          .join(' | ')
                          .trim()
        };

        records.push(record);
    }

    return records;
};

const pickRenewalComparable = (record) => ({
    signature_id: record.signature_id,
    sheet_name: record.sheet_name,
    email: record.email ?? null,
    recapito_telefonico: record.recapito_telefonico ?? null,
    certificato_cns_l: record.certificato_cns_l ?? 0,
    certificato_cns: record.certificato_cns ?? 0,
    certificato_cfd: record.certificato_cfd ?? 0,
    certificato_cfd_r: record.certificato_cfd_r ?? 0,
    data_emissione: record.data_emissione ?? null,
    data_scadenza: record.data_scadenza ?? null,
    rinnovo_data: record.rinnovo_data ?? null,
    rinnovo_da: record.rinnovo_da ?? null,
    nuova_emissione_id: record.nuova_emissione_id ?? null,
    costo_ie: record.costo_ie ?? null,
    importo_ie: record.importo_ie ?? null,
    fattura_numero: record.fattura_numero ?? null,
    fattura_tipo_invio: record.fattura_tipo_invio ?? null,
    fattura_tipo_pagamento: record.fattura_tipo_pagamento ?? null,
    data_riferimento_incasso: record.data_riferimento_incasso ?? null,
    note: record.note ?? null
});

const buildMultiset = (records) => {
    const map = new Map();
    for (const record of records) {
        const payload = pickRenewalComparable(record);
        const key = JSON.stringify(payload);
        if (!map.has(key)) {
            map.set(key, { count: 1, sample: payload });
        } else {
            map.get(key).count += 1;
        }
    }
    return map;
};

const compareRenewalSets = (excelRecords, dbRecords) => {
    const excelSet = buildMultiset(excelRecords);
    const dbSet = buildMultiset(dbRecords);
    const keys = new Set([...excelSet.keys(), ...dbSet.keys()]);
    const onlyInExcel = [];
    const onlyInDb = [];

    for (const key of keys) {
        const excelEntry = excelSet.get(key);
        const dbEntry = dbSet.get(key);
        const excelCount = excelEntry ? excelEntry.count : 0;
        const dbCount = dbEntry ? dbEntry.count : 0;
        if (excelCount > dbCount) {
            onlyInExcel.push({
                record: excelEntry.sample,
                delta: excelCount - dbCount
            });
        } else if (dbCount > excelCount) {
            onlyInDb.push({
                record: dbEntry.sample,
                delta: dbCount - excelCount
            });
        }
    }

    return { onlyInExcel, onlyInDb };
};

const normaliseDbText = (value) => {
    if (value === null || value === undefined) {
        return null;
    }
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return formatDateRome(value);
    }
    if (typeof value === 'number') {
        return Number.isFinite(value) ? (Number.isInteger(value) ? String(value) : String(value)) : null;
    }
    if (typeof value === 'string') {
        const decoded = decodeMisencodedText(value);
        const trimmed = decoded.trim();
        return trimmed === '' || trimmed === '-' ? null : trimmed;
    }
    const stringified = String(value);
    const decoded = decodeMisencodedText(stringified);
    const trimmed = decoded.trim();
    return trimmed === '' || trimmed === '-' ? null : trimmed;
};

const normaliseDbMoney = (value) => {
    if (value === null || value === undefined) {
        return null;
    }
    if (typeof value === 'number') {
        return Number(value.toFixed(2));
    }
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : null;
};

const compareBaseRecords = (excelRecords, dbRecords) => {
    const excelIds = new Set(excelRecords.keys());
    const dbIds = new Set(dbRecords.map((row) => row.id));

    const missingInDb = [...excelIds].filter((id) => !dbIds.has(id));
    const extraInDb = [...dbIds].filter((id) => !excelIds.has(id));

    const fieldMismatches = [];
    const fieldsToCompare = [
        'titolare',
        'email',
        'recapito_telefonico',
        'data_emissione',
        'emesso_da',
        'costo_ie',
        'importo_ie',
        'fattura_numero',
        'fattura_tipo_invio',
        'fattura_tipo_pagamento'
    ];

    for (const row of dbRecords) {
        if (!excelRecords.has(row.id)) {
            continue;
        }
        const excelRecord = excelRecords.get(row.id);
        const dbRecord = {
            id: row.id,
            titolare: normaliseDbText(row.titolare),
            email: normaliseDbText(row.email),
            recapito_telefonico: normaliseDbText(row.recapito_telefonico),
            data_emissione: normaliseDbText(row.data_emissione),
            emesso_da: normaliseDbText(row.emesso_da),
            costo_ie: normaliseDbMoney(row.costo_ie),
            importo_ie: normaliseDbMoney(row.importo_ie),
            fattura_numero: normaliseDbText(row.fattura_numero),
            fattura_tipo_invio: normaliseDbText(row.fattura_tipo_invio),
            fattura_tipo_pagamento: normaliseDbText(row.fattura_tipo_pagamento)
        };

        for (const field of fieldsToCompare) {
            const excelValue = excelRecord[field] ?? null;
            const dbValue = dbRecord[field] ?? null;
            if (excelValue === dbValue) {
                continue;
            }
            const bothNumbers =
                typeof excelValue === 'number' &&
                typeof dbValue === 'number' &&
                Number.isFinite(excelValue) &&
                Number.isFinite(dbValue);
            if (bothNumbers && Math.abs(excelValue - dbValue) < 0.01) {
                continue;
            }
            fieldMismatches.push({
                id: row.id,
                field,
                excel: excelValue,
                db: dbValue
            });
        }
    }

    return { missingInDb, extraInDb, fieldMismatches };
};

const main = async () => {
    const workbook = xlsx.readFile(workbookPath, { cellDates: true });
    const emissionRecords = extractEmissionRecords(workbook.Sheets['Emissione']);

    const renewalSheetNames = ['Rinnovo', 'Rinnovo 2', 'Rinnovo 3'];
    const excelRenewalsBySheet = new Map();
    for (const name of renewalSheetNames) {
        excelRenewalsBySheet.set(name, extractRenewalRecords(workbook.Sheets[name], name));
    }

    const contactInfo = new Map();
    for (const records of excelRenewalsBySheet.values()) {
        for (const record of records) {
            const id = record.signature_id;
            if (!id) {
                continue;
            }
            let info = contactInfo.get(id);
            if (!info) {
                info = { email: null, recapito_telefonico: null };
                contactInfo.set(id, info);
            }
            if (record.email && !info.email) {
                info.email = record.email;
            }
            if (record.recapito_telefonico && !info.recapito_telefonico) {
                info.recapito_telefonico = record.recapito_telefonico;
            }
        }
    }

    for (const [id, baseRecord] of emissionRecords.entries()) {
        const info = contactInfo.get(id);
        if (!info) {
            continue;
        }
        if (info.email) {
            baseRecord.email = info.email;
        }
        if (info.recapito_telefonico) {
            baseRecord.recapito_telefonico = info.recapito_telefonico;
        }
    }

    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: parseInt(process.env.DB_PORT || '3306', 10),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    });

    const baseTable = process.env.DB_TABLE || 'digital_signatures';
    const renewalTable =
        process.env.DB_RENEWAL_TABLE || `${baseTable.replace(/[^a-zA-Z0-9_]/g, '')}_renewals`;

    const [dbBaseRows] = await connection.query(
        `SELECT id,
                titolare,
                email,
                recapito_telefonico,
                data_emissione,
                emesso_da,
                costo_ie,
                importo_ie,
                fattura_numero,
                fattura_tipo_invio,
                fattura_tipo_pagamento
         FROM \`${baseTable}\`
         ORDER BY id`
    );

    const baseComparison = compareBaseRecords(emissionRecords, dbBaseRows);

    console.log('=== Tabella base (Emissione) ===');
    console.log({
        excelCount: emissionRecords.size,
        dbCount: dbBaseRows.length,
        missingInDb: baseComparison.missingInDb.length,
        extraInDb: baseComparison.extraInDb.length,
        fieldMismatches: baseComparison.fieldMismatches.length
    });
    if (baseComparison.missingInDb.length > 0) {
        console.log('ID presenti in Excel ma assenti nel DB (max 10):', baseComparison.missingInDb.slice(0, 10));
    }
    if (baseComparison.extraInDb.length > 0) {
        console.log('ID presenti nel DB ma assenti in Excel (max 10):', baseComparison.extraInDb.slice(0, 10));
    }
    if (baseComparison.fieldMismatches.length > 0) {
        console.log('Differenze di campo (max 10):', baseComparison.fieldMismatches.slice(0, 10));
    }

    for (const name of renewalSheetNames) {
        const excelRecords = excelRenewalsBySheet.get(name);
        const [dbRows] = await connection.query(
            `SELECT signature_id,
                    sheet_name,
                    email,
                    recapito_telefonico,
                    certificato_cns_l,
                    certificato_cns,
                    certificato_cfd,
                    certificato_cfd_r,
                    data_emissione,
                    data_scadenza,
                    rinnovo_data,
                    rinnovo_da,
                    nuova_emissione_id,
                    costo_ie,
                    importo_ie,
                    fattura_numero,
                    fattura_tipo_invio,
                    fattura_tipo_pagamento,
                    data_riferimento_incasso,
                    note
             FROM \`${renewalTable}\`
             WHERE sheet_name = ?
             ORDER BY signature_id, data_scadenza, rinnovo_data`,
            [name]
        );

        const normalisedDbRecords = dbRows.map((row) => ({
            signature_id: row.signature_id,
            sheet_name: row.sheet_name,
            email: normaliseDbText(row.email),
            recapito_telefonico: normaliseDbText(row.recapito_telefonico),
            certificato_cns_l: row.certificato_cns_l ? 1 : 0,
            certificato_cns: row.certificato_cns ? 1 : 0,
            certificato_cfd: row.certificato_cfd ? 1 : 0,
            certificato_cfd_r: row.certificato_cfd_r ? 1 : 0,
            data_emissione: normaliseDbText(row.data_emissione),
            data_scadenza: normaliseDbText(row.data_scadenza),
            rinnovo_data: normaliseDbText(row.rinnovo_data),
            rinnovo_da: normaliseDbText(row.rinnovo_da),
            nuova_emissione_id: row.nuova_emissione_id ?? null,
            costo_ie: normaliseDbMoney(row.costo_ie),
            importo_ie: normaliseDbMoney(row.importo_ie),
            fattura_numero: normaliseDbText(row.fattura_numero),
            fattura_tipo_invio: normaliseDbText(row.fattura_tipo_invio),
            fattura_tipo_pagamento: normaliseDbText(row.fattura_tipo_pagamento),
            data_riferimento_incasso: normaliseDbText(row.data_riferimento_incasso),
            note: normaliseDbText(row.note)
        }));

        const diff = compareRenewalSets(excelRecords, normalisedDbRecords);

        console.log(`=== Foglio ${name} ===`);
        console.log({
            excelCount: excelRecords.length,
            dbCount: normalisedDbRecords.length,
            onlyInExcel: diff.onlyInExcel.length,
            onlyInDb: diff.onlyInDb.length
        });
        if (diff.onlyInExcel.length > 0) {
            console.log('Record presenti solo in Excel (max 5):', diff.onlyInExcel.slice(0, 5));
        }
        if (diff.onlyInDb.length > 0) {
            console.log('Record presenti solo nel DB (max 5):', diff.onlyInDb.slice(0, 5));
        }
    }

    await connection.end();
};

main().catch((error) => {
    console.error('Errore durante la verifica:', error);
    process.exit(1);
});
