const bcrypt = require('bcrypt');

const SALT_ROUNDS = 10;

async function generateHash(password) {
    return await bcrypt.hash(password, SALT_ROUNDS);
}

async function verifyHash(password, storedHash) {
    return await bcrypt.compare(password, storedHash);
}

module.exports = {
    generateHash,
    verifyHash
};