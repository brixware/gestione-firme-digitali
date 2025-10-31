const mysql = require('mysql2/promise');
const dbConfig = require('../config/dbConfig');

async function createSessionsTable() {
    const connection = await mysql.createConnection({
        host: dbConfig.host,
        user: dbConfig.user,
        password: dbConfig.password,
        database: dbConfig.database,
        port: dbConfig.port
    });

    try {
        // Creazione della tabella sessions se non esiste
        await connection.query(`
            CREATE TABLE IF NOT EXISTS sessions (
                session_id varchar(128) NOT NULL,
                expires int(11) unsigned NOT NULL,
                data mediumtext,
                PRIMARY KEY (session_id)
            ) ENGINE=InnoDB;
        `);

        console.log('Tabella sessions creata con successo!');
    } catch (error) {
        console.error('Errore durante la creazione della tabella:', error);
        throw error;
    } finally {
        await connection.end();
    }
}

createSessionsTable().catch(console.error);