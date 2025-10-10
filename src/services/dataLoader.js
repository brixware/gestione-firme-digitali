const fs = require('fs/promises');
const path = require('path');
const xlsx = require('xlsx');
const dbConnector = require('./dbConnector');
const { parseWorkbook } = require('./xlsParser');
const { isEmpty } = require('../utils/helpers');
const { error, warn, info, debug, verbose } = require('../utils/logger');

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

const ASSET_CATEGORIES = {
    'KIT': ['STD', 'TOK', 'AK', 'AK-CNS'],
    'SMART CARD': ['STD', 'SIM', 'TAV'],
    'LETTORE': ['TOK', 'AK'],
    'CERTIFICATO': ['CNS-L', 'CNS', 'CFD', 'CFD-R']
};

const ASSET_COLUMN_MAPPING = {};
Object.entries(ASSET_CATEGORIES).forEach(([category, subtypes]) => {
    subtypes.forEach(subtype => {
        // Mapping per il nome completo (retrocompatibilità)
        const fullName = `${category} ${subtype}`;
        ASSET_COLUMN_MAPPING[fullName] = {
            category: category.replace(/\s+/g, '_'),
            subtype: subtype
        };
        // Mapping per il solo subtipo
        ASSET_COLUMN_MAPPING[subtype] = {
            category: category.replace(/\s+/g, '_'),
            subtype: subtype
        };
    });
});

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
    'CNS-L': 'certificato_cns_l',
    'CNS': 'certificato_cns',
    'CFD': 'certificato_cfd',
    'CFD-R': 'certificato_cfd_r',
    'Data Emissione': 'data_emissione',
    'Data': 'data_emissione',
    'Data Rinnovo': 'data_emissione',
    'Scadenza': 'data_scadenza',
    'Rinnovo Data': 'rinnovo_data',
    'Rinnovo 2 Data': 'rinnovo_data',
    'Rinnovo 3 Data': 'rinnovo_data',
    'Rinnovo DA': 'rinnovo_da',
    'DA': 'rinnovo_da',
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
const FALSY_MARKERS = new Set(['', '-', 'no', 'n', 'false', 'f', '0', 'off', 'null', 'none', 'undefined']);

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

// Colori per evidenziazione certificati
const BLUE_FILL_RGB = new Set(['FFCFE7F5', 'FFC1E5F5', 'FF99CCFF', 'FF7FB3FF']);
const BLUE_BG_INDEXES = new Set([41, 42, 43, 9]);
const LIGHT_BLUE_RGB = 'FF83CAFF'; // Colore allegato

const isCellHighlighted = (cell, colorRgb) => {
    if (!cell || !cell.s) {
        return false;
    }

    const { fgColor, bgColor, patternType } = cell.s;

    if (patternType && patternType.toLowerCase() === 'none') {
        return false;
    }

    // Log per debugging
    if (fgColor || bgColor) {
        debug('Stile cella:', {
            fgColor: fgColor ? {
                rgb: fgColor.rgb,
                indexed: fgColor.indexed,
                theme: fgColor.theme
            } : null,
            bgColor: bgColor ? {
                rgb: bgColor.rgb,
                indexed: bgColor.indexed
            } : null,
            patternType,
            cercaColore: colorRgb
        });
    }

    if (fgColor) {
        if (fgColor.rgb && fgColor.rgb.toUpperCase() === colorRgb) {
            return true;
        }
        if (typeof fgColor.indexed === 'number' && BLUE_BG_INDEXES.has(fgColor.indexed)) {
            return true;
        }
        if (typeof fgColor.theme === 'number') {
            return true;
        }
    }

    if (bgColor) {
        if (bgColor.rgb && bgColor.rgb.toUpperCase() === colorRgb) {
            return true;
        }
        if (typeof bgColor.indexed === 'number' && BLUE_BG_INDEXES.has(bgColor.indexed)) {
            return true;
        }
    }

    return false;
};

const isBlueHighlight = (cell) => isCellHighlighted(cell, LIGHT_BLUE_RGB);

const buildColumnNames = (headerRows) => {
    if (!Array.isArray(headerRows) || headerRows.length === 0) {
        return [];
    }

    console.log('Header Rows:', JSON.stringify(headerRows));

    const maxLength = headerRows.reduce(
        (max, row) => Math.max(max, Array.isArray(row) ? row.length : 0),
        0
    );
    console.log('Max Length:', maxLength);
    const columns = [];

    for (let i = 0; i < maxLength; i += 1) {
        const parts = headerRows
            .map((row) => (Array.isArray(row) ? standardiseKey(row[i] || '') : ''))
            .filter((value) => value && value.length > 0);

        if (parts.length === 0) {
            columns.push(`column_${i}`);
            console.log(`Column ${i}: Using default name 'column_${i}'`);
            continue;
        }

        // Se abbiamo un nome di categoria nella prima riga e un sottotipo nella seconda
        if (parts.length === 2 && 
            Object.keys(ASSET_CATEGORIES).includes(parts[0]) && 
            ASSET_CATEGORIES[parts[0]].includes(parts[1])) {
            columns.push(parts[1]); // Usa solo il sottotipo come nome della colonna
            console.log(`Column ${i}: '${parts[1]}' (from category ${parts[0]})`);
        } else {
            const uniqueParts = parts.filter((value, index) => parts.indexOf(value) === index);
            const columnName = uniqueParts.join(' ').trim();
            columns.push(columnName);
            console.log(`Column ${i}: '${columnName}'`);
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
        // alias posizionali sempre presenti, per fallback robusti (es. colonna K -> __col_10)
        record[`__col_${index}`] = value;
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
        .map((row, index) => {
            // Log per la riga che contiene ID 1000
            if (row && row.length > 0 && (row[0] === 1000 || String(row[0]).includes('1000'))) {
                console.log('[ID 1000] Raw Excel Row:', JSON.stringify(row));
                console.log('[ID 1000] Excel Row Number:', index + 1);
                // Log dettagliato delle colonne degli asset
                columns.forEach((col, idx) => {
                    if (col.includes('SMART_CARD') || col.includes('CERTIFICATO') || col.includes('KIT')) {
                        console.log(`[ID 1000] Column ${col}:`, JSON.stringify(row[idx]));
                    }
                });
            }
            return { row, excelRowNumber: index + 1 };
        })
        .filter(({ excelRowNumber }) => excelRowNumber >= startRow && excelRowNumber <= endRow)
        .filter(({ row }) => rowHasValues(row));

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
    
    // Gestione speciale per il carattere quadrato pieno
    if (typeof value === 'string' && value.includes('■')) {
        return true;
    }

    const trimmed = standardiseKey(String(value)).toLowerCase();

    if (TRUTHY_MARKERS.has(trimmed) || TRUTHY_MARKERS.has(value)) {
        return true;
    }

    if (FALSY_MARKERS.has(trimmed)) {
        return false;
    }

    const numeric = Number(trimmed);
    if (!Number.isNaN(numeric)) {
        return numeric !== 0;
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
    debug('Parsing date value:', { value, type: typeof value });

    if (value === null || value === undefined || value === '' || value === '-') {
        debug('Date value is null/empty');
        return null;
    }

    // Se è già un oggetto Date
    if (value instanceof Date) {
        debug('Value is already a Date object');
        return value.toISOString().slice(0, 10);
    }

    // Se è una stringa ISO o timestamp
    if (typeof value === 'string' && value.includes('T')) {
        debug('Value is an ISO date string');
        const date = new Date(value);
        if (!isNaN(date.getTime())) {
            return date.toISOString().slice(0, 10);
        }
    }

    // Se è una data Excel (numero di giorni dal 1900)
    if (typeof value === 'number') {
        debug('Parsing Excel date number:', value);
        // Excel usa 1900 come anno base e conta i giorni da 1/1/1900
        // 25569 è il numero di giorni tra 1/1/1900 e 1/1/1970 (epoch Unix)
        const excelEpoch = new Date(Math.round((value - 25569) * 86400 * 1000));
        const result = Number.isNaN(excelEpoch.getTime()) ? null : excelEpoch.toISOString().slice(0, 10);
        debug('Excel date result:', result);
        return result;
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        debug('Parsing string date:', trimmed);
        
        if (trimmed === '' || trimmed === '-') {
            debug('String date is empty/dash');
            return null;
        }

        // Prova a parsare come data Excel serializzata come stringa
        const numericValue = parseFloat(trimmed);
        if (!isNaN(numericValue)) {
            debug('String appears to be numeric, trying as Excel date:', numericValue);
            const excelDate = parseDate(numericValue);
            if (excelDate) {
                debug('Successfully parsed as Excel date:', excelDate);
                return excelDate;
            }
        }

        // Normalizza separatori e rimuovi eventuali parti di ora
        let normalised = trimmed
            .replace(/-/g, '/')
            .replace(/\./g, '/')
            .split(/[T\s]/)[0];  // Prendi solo la parte della data
        
        debug('Normalized date string:', normalised);

        // dd/mm/yyyy
        let m = normalised.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
        if (m) {
            debug('Matches dd/mm/yyyy pattern');
            const day = Number.parseInt(m[1], 10);
            const month = Number.parseInt(m[2], 10) - 1;
            let year = Number.parseInt(m[3], 10);
            if (year < 100) year += year >= 50 ? 1900 : 2000;
            const d = new Date(year, month, day);
            if (!Number.isNaN(d.getTime())) {
                const result = d.toISOString().slice(0, 10);
                debug('Successfully parsed dd/mm/yyyy:', result);
                return result;
            }
        }

        // yyyy/mm/dd
        m = normalised.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
        if (m) {
            debug('Matches yyyy/mm/dd pattern');
            const year = Number.parseInt(m[1], 10);
            const month = Number.parseInt(m[2], 10) - 1;
            const day = Number.parseInt(m[3], 10);
            const d = new Date(year, month, day);
            if (!Number.isNaN(d.getTime())) {
                const result = d.toISOString().slice(0, 10);
                debug('Successfully parsed yyyy/mm/dd:', result);
                return result;
            }
        }

        // Prova altri formati comuni italiani
        const formats = [
            /^(\d{1,2})[-\/\s](\d{1,2})[-\/\s](\d{2,4})$/,  // dd-mm-yyyy, dd mm yyyy
            /^(\d{1,2})[-\/\s](\d{1,2})[-\/\s](\d{2})$/,    // dd-mm-yy
            /^(\d{4})[-\/\s](\d{1,2})[-\/\s](\d{1,2})$/     // yyyy-mm-dd, yyyy mm dd
        ];

        for (const format of formats) {
            m = normalised.match(format);
            if (m) {
                debug('Matches alternative format:', format);
                let [_, part1, part2, part3] = m;
                let year = parseInt(part3, 10);
                let month = parseInt(part2, 10);
                let day = parseInt(part1, 10);

                // Se il primo numero è l'anno (4 cifre)
                if (part1.length === 4) {
                    year = parseInt(part1, 10);
                    month = parseInt(part2, 10);
                    day = parseInt(part3, 10);
                }

                // Gestione anno a 2 cifre
                if (year < 100) {
                    year += year >= 50 ? 1900 : 2000;
                }

                // Correggi il mese (0-based)
                month -= 1;

                const d = new Date(year, month, day);
                if (!Number.isNaN(d.getTime())) {
                    const result = d.toISOString().slice(0, 10);
                    debug('Successfully parsed alternative format:', result);
                    return result;
                }
            }
        }

        // Ultimo tentativo con il parser nativo
        debug('Trying native Date parser');
        const fallback = new Date(trimmed);
        if (!Number.isNaN(fallback.getTime())) {
            const result = fallback.toISOString().slice(0, 10);
            debug('Successfully parsed with native parser:', result);
            return result;
        }
    }

    debug('Failed to parse date');
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

const normaliseMasterRecord = (rawRecord, meta = {}) => {
    const { columns = [], excelRowNumber, worksheet, cnsColumnIndex } = meta;
    let hasCnsHighlight = false;

    if (
        worksheet &&
        typeof excelRowNumber === 'number' &&
        typeof cnsColumnIndex === 'number' &&
        cnsColumnIndex >= 0
    ) {
        const cellAddress = xlsx.utils.encode_cell({ r: excelRowNumber - 1, c: cnsColumnIndex });
        const cell = worksheet[cellAddress];
        hasCnsHighlight = isBlueHighlight(cell);
    }
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

    // Log del record grezzo per ID 1000
    if (baseRaw.id === 1000 || normaliseId(rawRecord['N°']) === 1000) {
        console.log('[ID 1000] Complete raw record:', JSON.stringify(rawRecord, null, 2));
    }

    Object.entries(rawRecord).forEach(([rawKey, rawValue]) => {
        const mapped = mapColumnKey(rawKey, COLUMN_LOOKUP);
        if (!mapped) {
            if (baseRaw.id === 1000 || normaliseId(rawRecord['N°']) === 1000) {
                console.log(`[ID 1000] Column not mapped: ${rawKey}`);
            }
            return;
        }

        if (mapped.type === 'asset') {
            // Solo per ID 1000
            if (baseRaw.id === 1000 || normaliseId(rawRecord['N°']) === 1000) {
                const key = `${mapped.value.category}::${mapped.value.subtype}`;
                console.log(`[ID 1000] Processing asset - Key: ${key}`);
                console.log(`[ID 1000] Column name: ${rawKey}`);
                console.log(`[ID 1000] Raw Value:`, JSON.stringify(rawValue));
                console.log(`[ID 1000] Raw Value Type:`, typeof rawValue);
                
                const entry = assetMap.get(key);
                if (entry) {
                    const boolValue = parseBoolean(rawValue);
                    console.log(`[ID 1000] Asset ${key} - Final boolean value:`, boolValue);
                    console.log('------------------------');
                    entry.value = boolValue;
                    entry.present = true;
                }
            } else {
                const key = `${mapped.value.category}::${mapped.value.subtype}`;
                const entry = assetMap.get(key);
                if (entry) {
                    entry.value = parseBoolean(rawValue);
                    entry.present = true;
                }
            }
            return;
        }

        if (mapped.type === 'document') {
            const key = `${mapped.value.category}::${mapped.value.subtype}`;
            const entry = documentMap.get(key);
            if (entry) {
                entry.value = parseBoolean(rawValue);
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
                baseNormalised.data_riferimento_incasso = parsedDate;
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
    if (!('data_riferimento_incasso' in baseNormalised)) {
        baseNormalised.data_riferimento_incasso = null;
    }

    if (hasCnsHighlight) {
        const cnsKey = 'CERTIFICATO::CNS';
        const cfdKey = 'CERTIFICATO::CFD';
        if (assetMap.has(cnsKey)) {
            assetMap.get(cnsKey).value = 1;
        }
        if (assetMap.has(cfdKey)) {
            assetMap.get(cfdKey).value = 1;
        }
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
    
    // Log solo per il record con ID 2
    if (rawRecord['N°'] === '2') {
        debug('Processing renewal record ID 2:', {
            date_values: {
                emissione: rawRecord['Data'] || rawRecord['Data Emissione'] || rawRecord['Data Rinnovo'],
                scadenza: rawRecord['Scadenza'] || rawRecord['Data Scadenza'],
                rinnovo: rawRecord['Rinnovo Data']
            }
        });
    }

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

    // Per i fogli di rinnovo (2, 3, 4) useremo un formato diverso
    const isRenewalSheet = sheetName && (sheetName.includes('Rinnovi') || sheetName.includes('Rinnovo'));

    // Log essenziale solo per il record con ID 2
    if (id === '2' || id === 2) {
        info('Processing record ID 2:', {
            dates: {
                emissione: rawRecord['Data'] || rawRecord['Data Emissione'] || rawRecord['Data Rinnovo'],
                scadenza: rawRecord['Scadenza'] || rawRecord['Data Scadenza'],
                rinnovo: rawRecord['Rinnovo Data']
            }
        });
    }
    
    // Log dei dati grezzi per debug
    debug('Dati grezzi del record:', {
        id,
        certificati: {
            'CNS-L': rawRecord['CNS-L'],
            'CNS': rawRecord['CNS'],
            'CFD': rawRecord['CFD'],
            'CFD-R': rawRecord['CFD-R'],
            'CERTIFICATO CNS-L': rawRecord['CERTIFICATO CNS-L'],
            'CERTIFICATO CNS': rawRecord['CERTIFICATO CNS'],
            'CERTIFICATO CFD': rawRecord['CERTIFICATO CFD'],
            'CERTIFICATO CFD-R': rawRecord['CERTIFICATO CFD-R']
        },
        date: {
            'Data Emissione': mapped.data_emissione,
            'Data Scadenza': mapped.data_scadenza,
            'Rinnovo Data': mapped.rinnovo_data,
            'Colonna 8': rawRecord[7],
            'Colonna 9': rawRecord[8],
            'Colonna 10': rawRecord[9]
        }
    });

    const record = {
        signature_id: id,
        sheet_name: sheetName ? sheetName.trim() : '',
        email: parseGenericValue(mapped.email),
        recapito_telefonico: parseGenericValue(mapped.recapito_telefonico),
        
        // Gestione certificati migliorata
        certificato_cns_l: parseBoolean(rawRecord['CNS-L'] || rawRecord['CERTIFICATO CNS-L']) ? 1 : 0,
        certificato_cns: parseBoolean(rawRecord['CNS'] || rawRecord['CERTIFICATO CNS']) ? 1 : 0,
        certificato_cfd: parseBoolean(rawRecord['CFD'] || rawRecord['CERTIFICATO CFD']) ? 1 : 0,
        certificato_cfd_r: parseBoolean(rawRecord['CFD-R'] || rawRecord['CERTIFICATO CFD-R']) ? 1 : 0,

        // Gestione date con logging dettagliato
        data_emissione: (() => {
            debug('Tentativo parsing data_emissione:', {
                mapped: mapped.data_emissione,
                'Data Emissione': rawRecord['Data Emissione'],
                'Data': rawRecord['Data'],
                'Data Rinnovo': rawRecord['Data Rinnovo'],
                'Colonna 7': rawRecord[7]
            });
            const result = parseDate(mapped.data_emissione) || 
                          parseDate(rawRecord['Data Emissione']) || 
                          parseDate(rawRecord['Data']) || 
                          parseDate(rawRecord['Data Rinnovo']) ||
                          parseDate(rawRecord[7]);
            debug('Risultato parsing data_emissione:', result);
            return result;
        })(),
                       
        data_scadenza: (() => {
            debug('Tentativo parsing data_scadenza:', {
                mapped: mapped.data_scadenza,
                'Scadenza': rawRecord['Scadenza'],
                'Data Scadenza': rawRecord['Data Scadenza'],
                'Colonna 8': rawRecord[8]
            });
            const result = parseDate(mapped.data_scadenza) || 
                          parseDate(rawRecord['Scadenza']) || 
                          parseDate(rawRecord['Data Scadenza']) ||
                          parseDate(rawRecord[8]);
            debug('Risultato parsing data_scadenza:', result);
            return result;
        })(),
                      
        rinnovo_data: (() => {
            const rinnovoValues = {
                mapped: mapped.rinnovo_data,
                'Rinnovo Data': rawRecord['Rinnovo Data'],
                'Rinnovo 2 Data': rawRecord['Rinnovo 2 Data'],
                'Rinnovo 3 Data': rawRecord['Rinnovo 3 Data'],
                'Colonna 9': rawRecord[9],
                'Raw Rinnovo': rawRecord.rinnovo_data
            };
            debug('Tentativo parsing rinnovo_data:', rinnovoValues);
            debug('Tipi dei valori rinnovo_data:', Object.fromEntries(
                Object.entries(rinnovoValues).map(([k, v]) => [k, typeof v])
            ));
            
            let rinnovo = null;
            
            // Prova prima i valori diretti
            ['Rinnovo Data', 'Rinnovo 2 Data', 'Rinnovo 3 Data'].forEach(key => {
                if (!rinnovo && rawRecord[key]) {
                    const attempt = parseDate(rawRecord[key]);
                    if (attempt) {
                        debug(`Data di rinnovo trovata in ${key}:`, attempt);
                        rinnovo = attempt;
                    }
                }
            });
            
            // Se non trovato, prova i valori mappati
            if (!rinnovo) {
                rinnovo = parseDate(mapped.rinnovo_data) ||
                         parseDate(rawRecord[9]);
            }
            
            debug('Risultato finale rinnovo_data:', rinnovo);
            return rinnovo;
        })(),

        // Altri campi
        rinnovo_da: (() => {
            const rawValue = parseGenericValue(mapped.rinnovo_da) || parseGenericValue(rawRecord['DA']) || null;
            if (!rawValue) return null;

            debug('Valore rinnovo_da:', rawValue);
            return rawValue;
        })(),

        nuova_emissione_id: (() => {
            const rawValue = parseGenericValue(mapped.rinnovo_da) || parseGenericValue(rawRecord['DA']) || null;
            if (!rawValue) {
                info(`Record ${rawRecord['N°']}: Nessun valore trovato per rinnovo_da`);
                return null;
            }

            const stringValue = String(rawValue).trim();
            info(`Record ${rawRecord['N°']}: Analisi valore rinnovo_da: "${stringValue}"`);
            const match = stringValue.match(/^NE-(\d+)$/);
            if (match) {
                const id = parseInt(match[1], 10);
                info(`Record ${rawRecord['N°']}: Trovato riferimento NE-${match[1]}`);
                return id;
            }
            return null;
        })(),
        
        // Campi finanziari
        costo_ie: parseMoney(mapped.costo_ie),
        importo_ie: parseMoney(mapped.importo_ie),
        fattura_numero: parseGenericValue(mapped.fattura_numero) || parseGenericValue(rawRecord['N° Documento']),
        fattura_tipo_invio: parseGenericValue(mapped.fattura_tipo_invio) || parseGenericValue(rawRecord['Tipo Invio']),
        fattura_tipo_pagamento: parseGenericValue(mapped.fattura_tipo_pagamento) || parseGenericValue(rawRecord['Tipo Pag.']),
        data_riferimento_incasso: null,
        
        // Note
        note: parseGenericValue(mapped.note)
    };

    // Preferisci il valore mappato per 'Rinnovo DA', altrimenti fallback alla colonna K (indice 10)
    const rinnovoDaRaw = parseGenericValue(
        mapped.rinnovo_da !== undefined ? mapped.rinnovo_da : rawRecord['__col_10']
    );
    if (rinnovoDaRaw) {
        // Richiesta: mettere sempre l'intero valore della colonna K in rinnovo_da
        record.rinnovo_da = rinnovoDaRaw;
        record.nuova_emissione_id = null;
    }

    const paymentDate = parseDate(mapped.fattura_tipo_pagamento);
    if (paymentDate) {
        record.fattura_tipo_pagamento = 'Altro';
        record.data_riferimento_incasso = paymentDate;
    } else {
        record.fattura_tipo_pagamento = parseGenericValue(mapped.fattura_tipo_pagamento);
    }

    return record;
};

const buildMasterRecords = (sheet) => {
    if (!sheet) {
        return [];
    }

    const { rows, worksheet } = sheet;
    const { columns, dataRows } = prepareSheetRows(rows);
    const cnsColumnIndex = columns.findIndex((column) =>
        standardiseKey(column).toLowerCase() === 'certificato cns'
    );

    return dataRows
        .map(({ row, excelRowNumber }) => ({
            record: rowToRecord(row, columns),
            excelRowNumber
        }))
        .map(({ record, excelRowNumber }) =>
            normaliseMasterRecord(record, {
                columns,
                excelRowNumber,
                worksheet,
                cnsColumnIndex
            })
        )
        .filter((record) => record !== null);
};

const buildContactRecords = (rows) => {
    const { columns, dataRows } = prepareSheetRows(rows);

    return dataRows
        .map(({ row }) => rowToRecord(row, columns))
        .map((record) => normaliseContactRecord(record))
        .filter((record) => record !== null);
};

const buildRenewalRecords = (rows, sheetName) => {
    const { columns, dataRows } = prepareSheetRows(rows);

    return dataRows
        .map(({ row }) => rowToRecord(row, columns))
        .map((record) => normaliseRenewalRecord(record, sheetName))
        .filter((record) => record !== null);
};

const MAX_RETRIES = 3;
const BATCH_SIZE = 25; // Ridotto la dimensione del batch per diminuire la probabilità di timeout
const RETRY_DELAY = 2000; // Aumentato a 2 secondi
const MAX_RETRY_DELAY = 10000; // Massimo 10 secondi di attesa

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const executeWithRetry = async (operation, retries = MAX_RETRIES) => {
    for (let i = 0; i < retries; i++) {
        try {
            return await operation();
        } catch (error) {
            const isRetryable = [
                'ER_LOCK_WAIT_TIMEOUT',
                'ER_LOCK_DEADLOCK',
                'ER_QUERY_INTERRUPTED'
            ].includes(error.code);

            if (isRetryable && i < retries - 1) {
                // Backoff esponenziale con jitter e limite massimo
                const baseDelay = Math.min(RETRY_DELAY * Math.pow(2, i), MAX_RETRY_DELAY);
                const jitter = Math.random() * 1000; // Aggiungi fino a 1 secondo di randomicità
                const delay = baseDelay + jitter;
                
                warn(`Tentativo ${i + 1}/${retries} fallito: ${error.message}. Riprovo tra ${Math.round(delay/1000)} secondi...`);
                await sleep(delay);
                continue;
            }
            throw error;
        }
    }
};

const loadDataToDatabase = async (
    connection,
    records,
    baseTableName,
    assetTableName,
    documentTableName
) => {
    if (!Array.isArray(records) || records.length === 0) {
        debug('Nessun dato da importare nel database.');
        return {
            base: 0,
            assets: 0,
            documents: 0
        };
    }

    let baseInserted = 0;
    let assetsInserted = 0;
    let documentsInserted = 0;

    // Aumenta il timeout della sessione
    await connection.query('SET SESSION wait_timeout = 300');
    
    // Processa i record in batch
    info(`Inizio importazione di ${records.length} record in batch da ${BATCH_SIZE}`);
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
        const batch = records.slice(i, i + BATCH_SIZE);
        
        try {
            await connection.beginTransaction();
            
            for (const record of batch) {
                const { base, assets, documents } = record;

                // Inserimento del record base con retry
                await executeWithRetry(async () => {
                    await connection.query(`REPLACE INTO \`${baseTableName}\` SET ?`, base);
                });
                baseInserted += 1;

                // Eliminazione e reinserimento degli asset con retry
                await executeWithRetry(async () => {
                    await connection.query(`DELETE FROM \`${assetTableName}\` WHERE signature_id = ?`, [base.id]);

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
                });

                // Eliminazione e reinserimento dei documenti con retry
                await executeWithRetry(async () => {
                    await connection.query(`DELETE FROM \`${documentTableName}\` WHERE signature_id = ?`, [base.id]);

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
                });
    }

            await connection.commit();
            debug(`Batch completato con successo: ${batch.length} record`);
        } catch (error) {
            await connection.rollback();
            error.message = `Errore durante il processamento del batch: ${error.message}`;
            throw error;
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
        'nuova_emissione_id',
        'costo_ie',
        'importo_ie',
        'fattura_numero',
        'fattura_tipo_invio',
        'fattura_tipo_pagamento',
        'data_riferimento_incasso',
        'note',
        'created_at',
        'updated_at'
    ];

    const dataColumns = columns.slice(0, -2);
    const placeholdersPerRow = `(${dataColumns.map(() => '?').join(', ')}, NOW(), NOW())`;

    const chunkSize = 500;
    let inserted = 0;

    for (let i = 0; i < renewals.length; i += chunkSize) {
        const chunk = renewals.slice(i, i + chunkSize);
        const placeholders = Array(chunk.length).fill(placeholdersPerRow).join(', ');
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
                renewal.nuova_emissione_id,
                renewal.costo_ie,
                renewal.importo_ie,
                renewal.fattura_numero,
                renewal.fattura_tipo_invio,
                renewal.fattura_tipo_pagamento,
                renewal.data_riferimento_incasso,
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
    const masterRecords = buildMasterRecords(masterSheet);

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
    loadDataToDatabase,
    normaliseMasterRecord
};
