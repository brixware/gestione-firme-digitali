const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const mysql = require('mysql2/promise');
const dbConfig = require('../config/dbConfig');

(async () => {
    const { host, user, password, database, port } = dbConfig;
    console.log(
        'Verifica connessione MySQL ->',
        'host:', host,
        'user:', user,
        'db:', database,
        'port:', port
    );
    try {
        const connection = await mysql.createConnection({
            host,
            user,
            password,
            database,
            port
        });

        const [rows] = await connection.query('SELECT VERSION() AS version, NOW() AS now');
        console.log('Connessione OK.', 'Versione server:', rows[0].version, 'Ora:', rows[0].now);
        await connection.end();
        process.exit(0);
    } catch (err) {
        console.error('Connessione FALLITA:', err.code || err.message, err.sqlMessage || '');
        if (err.code === 'ER_ACCESS_DENIED_ERROR') {
            console.error('Suggerimento: verifica utente/password e GRANT per il tuo IP/origine.');
        } else if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') {
            console.error('Host non risolvibile o DNS in errore.');
        } else if (err.code === 'ECONNREFUSED') {
            console.error('Connessione rifiutata: MySQL non in ascolto o firewall/porta bloccata.');
        } else if (err.code === 'ER_BAD_DB_ERROR') {
            console.error('Database non esistente. Crea il DB o esegui lo script di setup.');
        }
        process.exit(1);
    }
})();

