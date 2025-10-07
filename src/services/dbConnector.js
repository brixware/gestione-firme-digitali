const mysql = require('mysql2/promise');
const dbConfig = require('../../config/dbConfig');

const pool = mysql.createPool({
    host: dbConfig.host,
    user: dbConfig.user,
    password: dbConfig.password,
    database: dbConfig.database,
    port: dbConfig.port,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

const getConnection = async () => pool.getConnection();

const query = async (sql, params = []) => {
    const [rows] = await pool.query(sql, params);
    return rows;
};

const closePool = async () => {
    await pool.end();
};

module.exports = {
    pool,
    getConnection,
    query,
    closePool
};
