const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const { error, info } = require('../src/utils/logger');

const dbConfig = {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
};

async function executeUpdate() {
    let connection;
    try {
        info('Inizializzazione aggiornamento nuova_emissione_id...');

        // Crea la connessione usando la stessa configurazione dell'app
        try {
            connection = await mysql.createConnection(dbConfig);
            console.log('Connessione al database stabilita con successo');
        } catch (connError) {
            console.error('Errore di connessione al database:', connError.message);
            if (connError.code === 'ER_ACCESS_DENIED_ERROR') {
                console.error('Accesso negato: verificare username e password');
            } else if (connError.code === 'ECONNREFUSED') {
                console.error('Impossibile raggiungere il database: verificare host e porta');
            } else {
                console.error('Codice errore:', connError.code);
            }
            throw connError;
        }
        
        info('Connessione al database stabilita');

        // Prima mostra quanti record verranno aggiornati
        const [countResult] = await connection.query(`
            SELECT COUNT(*) as count 
            FROM rinnovi 
            WHERE rinnovo_da REGEXP '^NE-[0-9]+$' 
            AND nuova_emissione_id IS NULL
        `);
        
        info(`Trovati ${countResult[0].count} record da aggiornare`);

        // Esegui l'aggiornamento
        const updateQuery = `
            UPDATE digital_signatures_renewals
            SET nuova_emissione_id = CAST(
                SUBSTRING(
                    rinnovo_da,
                    4,
                    LENGTH(rinnovo_da) - 3
                ) AS UNSIGNED
            )
            WHERE rinnovo_da REGEXP '^NE-[0-9]+$'
            AND nuova_emissione_id IS NULL;
        `;
        
        const [updateResult] = await connection.query(updateQuery);
        console.log('Aggiornamento completato');
        console.log(`Record aggiornati: ${updateResult.affectedRows}`);

        // Mostra alcuni esempi di record aggiornati
        const [examples] = await connection.query(`
            SELECT id, rinnovo_da, nuova_emissione_id 
            FROM rinnovi 
            WHERE rinnovo_da LIKE 'NE-%' 
            LIMIT 5
        `);

        if (examples.length > 0) {
            info('Esempi di record aggiornati:');
            examples.forEach(row => {
                info(`ID: ${row.id}, Rinnovo da: ${row.rinnovo_da}, Nuova emissione: ${row.nuova_emissione_id}`);
            });
        }

    } catch (err) {
        error('Errore durante l\'aggiornamento:', err);
        throw err;
    } finally {
        if (connection) {
            await connection.end();
            info('Connessione al database chiusa');
        }
    }
}

// Esegui lo script
executeUpdate()
    .then(() => {
        info('Script completato con successo');
        process.exit(0);
    })
    .catch(err => {
        error('Script terminato con errori:', err);
        process.exit(1);
    });