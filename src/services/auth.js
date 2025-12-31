const db = require('./dbConnector');
const dbConfig = require('../../config/dbConfig');
const { generateHash, verifyHash } = require('../utils/password');

const USERS_TABLE = 'app_users';
const DEFAULT_USERNAME = 'brixware';
const TEMP_PASSWORD = '1234567890';

const ensureUsersTable = async () => {
    await db.pool.query(
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
};

const columnExists = async (columnName) => {
    const [rows] = await db.pool.query(
        `SELECT 1
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ?
           AND TABLE_NAME = ?
           AND COLUMN_NAME = ?
         LIMIT 1`,
        [dbConfig.database, USERS_TABLE, columnName]
    );
    return rows.length > 0;
};

const ensureColumn = async (columnName, definition) => {
    const exists = await columnExists(columnName);
    if (!exists) {
        await db.pool.query(
            `ALTER TABLE \`${USERS_TABLE}\`
             ADD COLUMN ${definition}`
        );
    }
};

const ensureDefaultUser = async () => {
    try {
        const [rows] = await db.pool.query(
            `SELECT id FROM \`${USERS_TABLE}\` WHERE username = ? LIMIT 1`,
            [DEFAULT_USERNAME]
        );
        if (rows.length === 0) {
            const hash = await generateHash(TEMP_PASSWORD);
            await db.pool.query(
                `INSERT INTO \`${USERS_TABLE}\` (username, password_hash, must_change_password)
                 VALUES (?, ?, 1)`,
                [DEFAULT_USERNAME, hash]
            );
            console.log(
                `Utente di default creato: ${DEFAULT_USERNAME} (password temporanea: ${TEMP_PASSWORD})`
            );
        }
    } catch (error) {
        console.error('Errore durante la creazione dell\'utente di default:', error);
        throw error;
    }
};

const ensureAuthSetup = async () => {
    await ensureUsersTable();
    await ensureColumn('full_name', 'full_name VARCHAR(150) NULL AFTER must_change_password');
    await ensureColumn('avatar_url', 'avatar_url VARCHAR(255) NULL AFTER full_name');
    await ensureColumn('avatar_data', 'avatar_data LONGBLOB NULL AFTER avatar_url');
    await ensureColumn('avatar_mime', 'avatar_mime VARCHAR(100) NULL AFTER avatar_data');
    await ensureColumn(
        'updated_at',
        'updated_at TIMESTAMP NULL DEFAULT NULL'
    );
    await ensureDefaultUser();
};

const getUserByUsername = async (username) => {
    const [rows] = await db.pool.query(
        `SELECT * FROM \`${USERS_TABLE}\` WHERE username = ? LIMIT 1`,
        [username]
    );
    return rows[0] || null;
};

const getUserById = async (id) => {
    const [rows] = await db.pool.query(
        `SELECT * FROM \`${USERS_TABLE}\` WHERE id = ? LIMIT 1`,
        [id]
    );
    return rows[0] || null;
};

const verifyPassword = async (password, hash) => verifyHash(password, hash);

const updateUserPassword = async (id, newPassword, { requireChangeFlag = false } = {}) => {
    try {
        const hash = await generateHash(newPassword);
        await db.pool.query(
            `UPDATE \`${USERS_TABLE}\`
             SET password_hash = ?, must_change_password = ?, updated_at = NOW()
             WHERE id = ?`,
            [hash, requireChangeFlag ? 1 : 0, id]
        );
    } catch (error) {
        console.error('Errore durante l\'aggiornamento della password:', error);
        throw error;
    }
};

const updateUserProfile = async (
    id,
    { fullName = null, avatarData = null, avatarMime = null } = {}
) => {
    await db.pool.query(
        `UPDATE \`${USERS_TABLE}\`
         SET full_name = ?, avatar_url = NULL, avatar_data = ?, avatar_mime = ?, updated_at = NOW()
         WHERE id = ?`,
        [fullName || null, avatarData ?? null, avatarMime ?? null, id]
    );
};

module.exports = {
    ensureAuthSetup,
    getUserByUsername,
    getUserById,
    verifyPassword,
    updateUserPassword,
    updateUserProfile
};
