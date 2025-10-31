const mysql = require('mysql2/promise');
const dbConfig = require('../../config/dbConfig');
const { info, error } = require('../utils/logger');

info('Initializing MySQL connection pool...');
info('Database config:', { 
    host: dbConfig.host,
    user: dbConfig.user,
    database: dbConfig.database,
    port: dbConfig.port
});

const pool = mysql.createPool({
    host: dbConfig.host,
    user: dbConfig.user,
    password: dbConfig.password,
    database: dbConfig.database,
    port: dbConfig.port,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    // Timeout configurati correttamente per mysql2
    connectTimeout: 10000
});

// Test della connessione iniziale
pool.getConnection()
    .then(conn => {
        info('Initial database connection successful');
        conn.release();
    })
    .catch(err => {
        error('Failed to establish initial database connection:', err);
    });

const getConnection = async () => {
    try {
        info('Getting database connection from pool...');
        const connection = await pool.getConnection();
        info('Successfully got database connection');
        return connection;
    } catch (err) {
        error('Error getting database connection:', err);
        throw new Error('Impossibile stabilire una connessione al database');
    }
};

const query = async (sql, params = []) => {
    try {
        info('Executing database query:', { sql, params });
        const [rows] = await pool.query(sql, params);
        info('Query executed successfully');
        return rows;
    } catch (error) {
        console.error('Errore durante l\'esecuzione della query:', error.message);
        console.error('Query:', sql);
        console.error('Parametri:', params);
        throw error;
    }
};

const closePool = async () => {
    try {
        await pool.end();
    } catch (error) {
        console.error('Errore durante la chiusura del pool:', error.message);
        throw error;
    }
};

module.exports = {
    pool,
    getConnection,
    query,
    closePool
};
