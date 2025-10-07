// Questo file contiene funzioni di utilità generali utilizzate in tutto il progetto.

function isEmpty(value) {
    return value === null || value === undefined || value === '';
}

function formatDate(date) {
    const options = { year: 'numeric', month: '2-digit', day: '2-digit' };
    return new Date(date).toLocaleDateString('it-IT', options);
}

function parseXlsDate(xlsDate) {
    const date = new Date((xlsDate - 25569) * 86400 * 1000);
    return formatDate(date);
}

module.exports = {
    isEmpty,
    formatDate,
    parseXlsDate
};