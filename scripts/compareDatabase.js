const mysql = require('mysql2/promise');

// Database di SVILUPPO
const devDbConfig = {
    host: '80.211.136.249',
    port: 3306,
    user: 'firmedigitali',
    password: 'uk5igls1EO#%B5mi',
    database: 'firmedigitali'
};

// Database di PRODUZIONE
const prodDbConfig = {
    host: '80.211.238.28',
    port: 3306,
    user: 'firmedigitali',
    password: 'uk5igls1EO#%B5mi',
    database: 'firmedigitali'
};

async function getTables(connection) {
    const [tables] = await connection.query('SHOW TABLES');
    return tables.map(row => Object.values(row)[0]).sort();
}

async function getTableStructure(connection, tableName) {
    const [columns] = await connection.query(`DESCRIBE \`${tableName}\``);
    return columns;
}

async function getTableCount(connection, tableName) {
    try {
        const [result] = await connection.query(`SELECT COUNT(*) as count FROM \`${tableName}\``);
        return result[0].count;
    } catch (error) {
        return 'ERROR';
    }
}

async function getTableSample(connection, tableName, limit = 5) {
    try {
        const [rows] = await connection.query(`SELECT * FROM \`${tableName}\` LIMIT ${limit}`);
        return rows;
    } catch (error) {
        return [];
    }
}

(async () => {
    let devConn, prodConn;
    
    try {
        console.log('='.repeat(80));
        console.log('CONFRONTO DATABASE SVILUPPO vs PRODUZIONE');
        console.log('='.repeat(80));
        
        // Connessione ai database
        console.log('\n🔌 Connessione ai database...\n');
        console.log(`  DEV:  ${devDbConfig.host} -> ${devDbConfig.database}`);
        devConn = await mysql.createConnection(devDbConfig);
        console.log('  ✓ Connesso al database di sviluppo');
        
        console.log(`  PROD: ${prodDbConfig.host} -> ${prodDbConfig.database}`);
        prodConn = await mysql.createConnection(prodDbConfig);
        console.log('  ✓ Connesso al database di produzione');
        
        // Ottieni le tabelle
        console.log('\n📋 Recupero lista tabelle...\n');
        const devTables = await getTables(devConn);
        const prodTables = await getTables(prodConn);
        
        console.log(`  DEV:  ${devTables.length} tabelle`);
        console.log(`  PROD: ${prodTables.length} tabelle`);
        
        // Tabelle mancanti
        const missingInProd = devTables.filter(t => !prodTables.includes(t));
        const missingInDev = prodTables.filter(t => !devTables.includes(t));
        
        if (missingInProd.length > 0) {
            console.log('\n⚠️  TABELLE PRESENTI SOLO IN SVILUPPO:');
            missingInProd.forEach(t => console.log(`    - ${t}`));
        }
        
        if (missingInDev.length > 0) {
            console.log('\n⚠️  TABELLE PRESENTI SOLO IN PRODUZIONE:');
            missingInDev.forEach(t => console.log(`    - ${t}`));
        }
        
        // Tabelle comuni
        const commonTables = devTables.filter(t => prodTables.includes(t));
        
        if (commonTables.length === 0) {
            console.log('\n❌ NESSUNA TABELLA IN COMUNE!');
            process.exit(1);
        }
        
        console.log('\n✓ Tabelle in comune:', commonTables.length);
        
        // Confronto struttura e dati
        console.log('\n' + '='.repeat(80));
        console.log('DETTAGLIO TABELLE');
        console.log('='.repeat(80));
        
        for (const table of commonTables) {
            console.log(`\n📊 Tabella: ${table}`);
            console.log('-'.repeat(80));
            
            // Struttura
            const devStructure = await getTableStructure(devConn, table);
            const prodStructure = await getTableStructure(prodConn, table);
            
            console.log(`  Colonne DEV:  ${devStructure.length}`);
            console.log(`  Colonne PROD: ${prodStructure.length}`);
            
            const devColumns = devStructure.map(c => c.Field);
            const prodColumns = prodStructure.map(c => c.Field);
            
            const missingColsInProd = devColumns.filter(c => !prodColumns.includes(c));
            const missingColsInDev = prodColumns.filter(c => !devColumns.includes(c));
            
            if (missingColsInProd.length > 0) {
                console.log(`  ⚠️  Colonne mancanti in PROD: ${missingColsInProd.join(', ')}`);
            }
            if (missingColsInDev.length > 0) {
                console.log(`  ⚠️  Colonne mancanti in DEV: ${missingColsInDev.join(', ')}`);
            }
            
            // Conteggio record
            const devCount = await getTableCount(devConn, table);
            const prodCount = await getTableCount(prodConn, table);
            
            console.log(`  Records DEV:  ${devCount}`);
            console.log(`  Records PROD: ${prodCount}`);
            
            if (devCount !== prodCount) {
                const diff = Math.abs(devCount - prodCount);
                console.log(`  ⚠️  DIFFERENZA: ${diff} record`);
            } else {
                console.log(`  ✓ Stesso numero di record`);
            }
        }
        
        console.log('\n' + '='.repeat(80));
        console.log('RIEPILOGO');
        console.log('='.repeat(80));
        console.log(`\nTabelle totali:`);
        console.log(`  DEV:  ${devTables.length}`);
        console.log(`  PROD: ${prodTables.length}`);
        console.log(`  Comuni: ${commonTables.length}`);
        
        if (missingInProd.length === 0 && missingInDev.length === 0) {
            console.log('\n✅ Entrambi i database hanno le stesse tabelle');
        } else {
            console.log('\n⚠️  I database hanno tabelle diverse');
        }
        
        await devConn.end();
        await prodConn.end();
        process.exit(0);
        
    } catch (error) {
        console.error('\n❌ ERRORE:', error.message);
        if (devConn) await devConn.end();
        if (prodConn) await prodConn.end();
        process.exit(1);
    }
})();
