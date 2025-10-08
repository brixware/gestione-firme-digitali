const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const mysql = require('mysql2/promise');
const dbConfig = require('../config/dbConfig');

(async () => {
    const { host, user, password, database, port } = dbConfig;
    const baseTable = (process.env.DB_TABLE || 'digital_signatures').replace(/[^a-zA-Z0-9_]/g, '') || 'digital_signatures';
    const renewalTable = (process.env.DB_RENEWAL_TABLE || `${baseTable}_renewals`).replace(/[^a-zA-Z0-9_]/g, '') || `${baseTable}_renewals`;
    const days = parseInt(process.env.CHECK_EXPIRING_DAYS || '15', 10) || 15;

    console.log('Connessione DB', { host, database, user, port });
    console.log(`Controllo scadenze entro ${days} giorni su tabella ${renewalTable}.colonna=data_scadenza`);

    const conn = await mysql.createConnection({ host, user, password, database, port });
    try {
        const [countRows] = await conn.query(
            `SELECT COUNT(*) AS cnt
             FROM \`${renewalTable}\`
             WHERE data_scadenza IS NOT NULL
               AND data_scadenza BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)`,
            [days]
        );
        const total = countRows[0]?.cnt || 0;
        console.log('Totale in scadenza:', total);

        const [sample] = await conn.query(
            `SELECT signature_id, sheet_name, data_scadenza, rinnovo_da, fattura_numero
             FROM \`${renewalTable}\`
             WHERE data_scadenza IS NOT NULL
               AND data_scadenza BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)
             ORDER BY data_scadenza ASC
             LIMIT 20`,
            [days]
        );
        if (sample.length === 0) {
            console.log('Nessun record da mostrare.');
        } else {
            sample.forEach((r) => console.log(r));
        }
        process.exit(0);
    } catch (err) {
        console.error('Errore query:', err.message);
        process.exit(1);
    } finally {
        await conn.end();
    }
})();

