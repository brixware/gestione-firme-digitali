require('dotenv').config();

const parsePort = (value, fallback) => {
    const parsed = parseInt(value, 10);
    return Number.isNaN(parsed) ? fallback : parsed;
};

module.exports = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || '',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || '',
    port: parsePort(process.env.DB_PORT, 3306)
};
