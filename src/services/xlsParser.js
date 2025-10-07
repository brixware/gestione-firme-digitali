const xlsx = require('xlsx');

function parseXLS(filePath) {
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0]; // Use the first sheet by default
    const worksheet = workbook.Sheets[sheetName];

    // Return the sheet as a bidimensional array to preserve multi-row headers.
    return xlsx.utils.sheet_to_json(worksheet, {
        header: 1,
        defval: null,
        blankrows: false
    });
}

module.exports = {
    parseXLS
};
