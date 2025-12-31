const mysql = require('mysql2/promise');
const { generateHash } = require('../src/utils/password');

const TEMP_PASSWORD = '1234567890';
const USERNAME = 'brixware';

// Database di PRODUZIONE
const prodDbConfig = {
    host: '80.211.238.28',
    port: 3306,
    user: 'firmedigitali',
    password: 'uk5igls1EO#%B5mi',
    database: 'firmedigitali'
};

(async () => {
    let connection;
    try {
        console.log('Connessione al database di PRODUZIONE...');
        console.log(`Host: ${prodDbConfig.host}`);
        console.log(`Database: ${prodDbConfig.database}`);
        
        connection = await mysql.createConnection(prodDbConfig);
        console.log('✓ Connesso al database di produzione\n');

        // Verifica se l'utente esiste
        const [users] = await connection.query(
            'SELECT id, username FROM app_users WHERE username = ?',
            [USERNAME]
        );

        if (users.length === 0) {
            console.error(`✗ Utente '${USERNAME}' non trovato nel database di produzione.`);
            process.exit(1);
        }

        const user = users[0];
        console.log(`✓ Utente trovato: ${user.username} (ID: ${user.id})`);

        // Genera il nuovo hash
        console.log('\nGenerazione hash per la password temporanea...');
        const hash = await generateHash(TEMP_PASSWORD);

        // Aggiorna la password
        console.log('Aggiornamento password...');
        await connection.query(
            'UPDATE app_users SET password_hash = ?, must_change_password = 1, updated_at = NOW() WHERE id = ?',
            [hash, user.id]
        );

        console.log('\n✓✓✓ PASSWORD RESETTATA CON SUCCESSO ✓✓✓');
        console.log(`\nCredenziali per il database di PRODUZIONE (${prodDbConfig.host}):`);
        console.log(`  Username: ${USERNAME}`);
        console.log(`  Password temporanea: ${TEMP_PASSWORD}`);
        console.log(`\nAl prossimo accesso verrà richiesto il cambio password.`);

        await connection.end();
        process.exit(0);
    } catch (error) {
        console.error('\n✗ ERRORE:', error.message);
        if (error.code === 'ECONNREFUSED') {
            console.error('Impossibile connettersi al database. Verifica host e porta.');
        } else if (error.code === 'ER_ACCESS_DENIED_ERROR') {
            console.error('Accesso negato. Verifica username e password del database.');
        }
        if (connection) await connection.end();
        process.exit(1);
    }
})();
