const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const mysql = require('mysql2/promise');
const dbConfig = require('../config/dbConfig');

(async () => {
    const { host, user, password, database, port } = dbConfig;
    const baseTable = (process.env.DB_TABLE || 'digital_signatures').replace(/[^a-zA-Z0-9_]/g, '') || 'digital_signatures';
    const renewalTable = (process.env.DB_RENEWAL_TABLE || `${baseTable}_renewals`).replace(/[^a-zA-Z0-9_]/g, '') || `${baseTable}_renewals`;

    console.log('Connessione DB', { host, database, user, port });

    const conn = await mysql.createConnection({ host, user, password, database, port });
    try {
        // 1. Conteggio totale date di scadenza
        const [totalRows] = await conn.query(
            `SELECT 
                COUNT(*) as total_records,
                COUNT(data_scadenza) as records_with_date,
                MIN(data_scadenza) as earliest_date,
                MAX(data_scadenza) as latest_date
             FROM \`${renewalTable}\`
             WHERE data_scadenza IS NOT NULL`
        );
        console.log('\nStatistiche date di scadenza:');
        console.log(totalRows[0]);

        // 2. Distribuzione date per mese
        const [monthlyDist] = await conn.query(
            `SELECT 
                DATE_FORMAT(data_scadenza, '%Y-%m') as month,
                COUNT(*) as count
             FROM \`${renewalTable}\`
             WHERE data_scadenza IS NOT NULL
             GROUP BY DATE_FORMAT(data_scadenza, '%Y-%m')
             ORDER BY month DESC
             LIMIT 12`
        );
        console.log('\nDistribuzione mensile delle scadenze:');
        monthlyDist.forEach(row => console.log(row));

        // 3. Scadenze nei prossimi 30 giorni
        const [nextMonth] = await conn.query(
            `SELECT 
                r.signature_id,
                s.titolare,
                r.data_scadenza,
                DATEDIFF(r.data_scadenza, CURDATE()) as days_until_expiry
             FROM \`${renewalTable}\` r
             JOIN \`${baseTable}\` s ON s.id = r.signature_id
             WHERE r.data_scadenza IS NOT NULL
               AND r.data_scadenza BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)
             ORDER BY r.data_scadenza ASC
             LIMIT 5`
        );
        console.log('\nProssime 5 scadenze:');
        nextMonth.forEach(row => console.log(row));

        process.exit(0);
    } catch (err) {
        console.error('Errore query:', err.message);
        process.exit(1);
    } finally {
        await conn.end();
    }
})();