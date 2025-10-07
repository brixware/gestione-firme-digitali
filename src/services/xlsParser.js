const xlsx = require('xlsx');

function parseWorkbook(filePath) {
    const workbook = xlsx.readFile(filePath);

    return workbook.SheetNames.map((sheetName, index) => {
        const worksheet = workbook.Sheets[sheetName];
        const rows = xlsx.utils.sheet_to_json(worksheet, {
            header: 1,
            defval: '',
            blankrows: true
        });

        return {
            index,
            name: sheetName,
            rows
        };
    });
}

module.exports = {
    parseWorkbook
};
