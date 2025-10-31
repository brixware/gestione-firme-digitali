/**
 * Wrapper per gestire gli errori nelle funzioni asincrone di Express
 * @param {Function} fn - La funzione handler da wrappare
 * @returns {Function} Handler wrappato che gestisce gli errori
 */
const asyncHandler = (fn) => (req, res, next) => {
    return Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;