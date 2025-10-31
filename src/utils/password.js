const crypto = require('crypto');

const SALT_LENGTH = 16;
const KEY_LENGTH = 64;
const ITERATIONS = 10000;
const DIGEST = 'sha512';

function generateHash(password) {
    const salt = crypto.randomBytes(SALT_LENGTH);
    const hash = crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, DIGEST);
    const combined = Buffer.concat([salt, hash]);
    return combined.toString('base64');
}

function verifyHash(password, storedHash) {
    const buffer = Buffer.from(storedHash, 'base64');
    const salt = buffer.slice(0, SALT_LENGTH);
    const hash = buffer.slice(SALT_LENGTH);
    const newHash = crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, DIGEST);
    return crypto.timingSafeEqual(hash, newHash);
}

module.exports = {
    generateHash,
    verifyHash
};