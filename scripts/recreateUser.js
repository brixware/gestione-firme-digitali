require('dotenv').config();
const mysql = require('mysql2/promise');
const { generateHash } = require('../src/utils/password');

const USERS_TABLE = 'app_users';
const DEFAULT_USERNAME = 'brixware';
const TEMP_PASSWORD = '1234567890';

async function recreateUser() {
    const config = {
        host: process.env.DB_HOST,
        port: parseInt(process.env.DB_PORT, 10),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    };

    try {
        const connection = await mysql.createConnection(config);
        console.log('Connesso al database');

        // Verifica se la tabella esiste
        const [tables] = await connection.query(
            'SHOW TABLES LIKE ?',
            [USERS_TABLE]
        );

        if (tables.length === 0) {
            console.log('Creazione tabella utenti...');
            await connection.query(
                `CREATE TABLE IF NOT EXISTS \`${USERS_TABLE}\` (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    username VARCHAR(100) NOT NULL UNIQUE,
                    password_hash VARCHAR(255) NOT NULL,
                    must_change_password TINYINT(1) NOT NULL DEFAULT 0,
                    full_name VARCHAR(150) NULL,
                    avatar_url VARCHAR(255) NULL,
                    avatar_data LONGBLOB NULL,
                    avatar_mime VARCHAR(100) NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP NULL DEFAULT NULL
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_general_ci`
            );
            console.log('Tabella creata');
        }

        // Elimina l'utente se esiste
        console.log('Elimino utente esistente se presente...');
        await connection.query(
            `DELETE FROM \`${USERS_TABLE}\` WHERE username = ?`,
            [DEFAULT_USERNAME]
        );

        // Crea nuovo utente
        console.log('Creazione nuovo utente...');
        const hash = generateHash(TEMP_PASSWORD);
        await connection.query(
            `INSERT INTO \`${USERS_TABLE}\` (username, password_hash, must_change_password)
             VALUES (?, ?, 1)`,
            [DEFAULT_USERNAME, hash]
        );

        console.log('\nUtente ricreato con successo!');
        console.log('Username:', DEFAULT_USERNAME);
        console.log('Password:', TEMP_PASSWORD);

        // Verifica finale
        const [users] = await connection.query(
            `SELECT * FROM \`${USERS_TABLE}\` WHERE username = ?`,
            [DEFAULT_USERNAME]
        );
        
        if (users.length > 0) {
            console.log('\nVerifica utente: OK');
            console.log('ID:', users[0].id);
            console.log('Username:', users[0].username);
            console.log('Must change password:', users[0].must_change_password === 1 ? 'Sì' : 'No');
        }

        await connection.end();
    } catch (error) {
        console.error('Errore:', error);
    }
}

recreateUser();