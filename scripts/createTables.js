require('dotenv').config();
const mysql = require('mysql2/promise');
const dbConfig = require('../config/dbConfig');

const sanitizeIdentifier = (value = '', fallback) => {
    const trimmed = String(value || '').trim();
    const safe = trimmed.replace(/[^a-zA-Z0-9_]/g, '');
    if (safe.length > 0) {
        return safe;
    }
    if (fallback) {
        return fallback;
    }
    throw new Error('Identifier non valido: specificare un valore appropriato nelle variabili di ambiente.');
};

const main = async () => {
    const {
        host,
        user,
        password,
        database: rawDatabase,
        port
    } = dbConfig;

    if (!rawDatabase) {
        throw new Error('Variabile DB_NAME mancante: impostare il nome del database nel file .env.');
    }

    const database = sanitizeIdentifier(rawDatabase);
    const tableName = sanitizeIdentifier(process.env.DB_TABLE, 'digital_signatures');
    const assetTableName = sanitizeIdentifier(process.env.DB_ASSET_TABLE, `${tableName}_assets`);
    const documentTableName = sanitizeIdentifier(
        process.env.DB_DOCUMENT_TABLE,
        `${tableName}_documents`
    );
    const desiredCharset = sanitizeIdentifier(process.env.DB_CHARSET, 'utf8mb4');
    const desiredCollation = sanitizeIdentifier(
        process.env.DB_COLLATION,
        desiredCharset === 'utf8mb4' ? 'utf8mb4_unicode_ci' : 'utf8_general_ci'
    );

    const fallbackCharset = sanitizeIdentifier(
        process.env.DB_FALLBACK_CHARSET,
        desiredCharset === 'utf8mb4' ? 'utf8' : desiredCharset
    );

    const fallbackCollation = sanitizeIdentifier(
        process.env.DB_FALLBACK_COLLATION,
        fallbackCharset === 'utf8' ? 'utf8_general_ci' : `${fallbackCharset}_general_ci`
    );

    const connection = await mysql.createConnection({
        host,
        user,
        password,
        port
    });

    try {
        const createDatabase = async (charset, collation) => {
            await connection.query(
                `CREATE DATABASE IF NOT EXISTS \`${database}\` DEFAULT CHARACTER SET ${charset} COLLATE ${collation};`
            );
            console.log(
                `Database '${database}' verificato/creato con successo (charset ${charset}, collation ${collation}).`
            );
            return { charset, collation };
        };

        let activeCharset = desiredCharset;
        let activeCollation = desiredCollation;

        try {
            ({ charset: activeCharset, collation: activeCollation } = await createDatabase(
                desiredCharset,
                desiredCollation
            ));
        } catch (error) {
            const shouldFallback =
                (error.code === 'ER_UNKNOWN_CHARACTER_SET' ||
                    error.code === 'ER_UNKNOWN_COLLATION' ||
                    error.errno === 1115 ||
                    error.errno === 1273) &&
                (desiredCharset !== fallbackCharset || desiredCollation !== fallbackCollation);

            if (shouldFallback) {
                console.warn(
                    `Charset/Collation '${desiredCharset}/${desiredCollation}' non supportati. Fallback a '${fallbackCharset}/${fallbackCollation}'.`
                );
                ({ charset: activeCharset, collation: activeCollation } = await createDatabase(
                    fallbackCharset,
                    fallbackCollation
                ));
            } else {
                throw error;
            }
        }

        await connection.changeUser({ database });

        const createTableSql = `
            CREATE TABLE IF NOT EXISTS \`${tableName}\` (
                id VARCHAR(10) NOT NULL,
                titolare VARCHAR(255) NOT NULL,
                data_emissione DATE NULL,
                emesso_da VARCHAR(50) NULL,
                costo_ie DECIMAL(10,2) NULL,
                importo_ie DECIMAL(10,2) NULL,
                fattura_numero VARCHAR(100) NULL,
                fattura_tipo_invio VARCHAR(50) NULL,
                fattura_tipo_pagamento VARCHAR(50) NULL,
                note VARCHAR(255) NULL,
                created_at TIMESTAMP NULL,
                updated_at TIMESTAMP NULL,
                PRIMARY KEY (id)
            ) ENGINE=InnoDB DEFAULT CHARSET=${activeCharset} COLLATE=${activeCollation};
        `;

        await connection.query(createTableSql);
        console.log(`Tabella '${tableName}' verificata/creata con successo nel database '${database}'.`);

        const createAssetsTableSql = `
            CREATE TABLE IF NOT EXISTS \`${assetTableName}\` (
                signature_id VARCHAR(10) NOT NULL,
                category VARCHAR(50) NOT NULL,
                subtype VARCHAR(50) NOT NULL,
                has_item TINYINT(1) NOT NULL DEFAULT 1,
                created_at TIMESTAMP NULL,
                updated_at TIMESTAMP NULL,
                PRIMARY KEY (signature_id, category, subtype),
                CONSTRAINT fk_${assetTableName}_signature
                    FOREIGN KEY (signature_id) REFERENCES \`${tableName}\`(id)
                    ON DELETE CASCADE ON UPDATE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=${activeCharset} COLLATE=${activeCollation};
        `;

        await connection.query(createAssetsTableSql);
        console.log(
            `Tabella '${assetTableName}' verificata/creata con successo nel database '${database}'.`
        );

        const createDocumentsTableSql = `
            CREATE TABLE IF NOT EXISTS \`${documentTableName}\` (
                signature_id VARCHAR(10) NOT NULL,
                category VARCHAR(50) NOT NULL,
                subtype VARCHAR(50) NOT NULL,
                has_item TINYINT(1) NOT NULL DEFAULT 1,
                created_at TIMESTAMP NULL,
                updated_at TIMESTAMP NULL,
                PRIMARY KEY (signature_id, category, subtype),
                CONSTRAINT fk_${documentTableName}_signature
                    FOREIGN KEY (signature_id) REFERENCES \`${tableName}\`(id)
                    ON DELETE CASCADE ON UPDATE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=${activeCharset} COLLATE=${activeCollation};
        `;

        await connection.query(createDocumentsTableSql);
        console.log(
            `Tabella '${documentTableName}' verificata/creata con successo nel database '${database}'.`
        );
    } finally {
        await connection.end();
    }
};

main()
    .then(() => {
        console.log('Setup database completato.');
        process.exit(0);
    })
    .catch((error) => {
        console.error('Errore durante la creazione delle tabelle:', error.message);
        process.exit(1);
    });
