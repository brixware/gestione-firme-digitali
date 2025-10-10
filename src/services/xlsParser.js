const xlsx = require('xlsx');

function parseWorkbook(filePath) {
    const workbook = xlsx.readFile(filePath, { 
        cellStyles: true,
        cellText: false,
        cellFormula: false,
        cellHTML: false,
        cellNF: false,
        cellDates: true,
        raw: true
    });

    return workbook.SheetNames.map((sheetName, index) => {
        const worksheet = workbook.Sheets[sheetName];
        const rows = xlsx.utils.sheet_to_json(worksheet, {
            header: 1,
            defval: '',
            blankrows: true,
            raw: true
        });

        return {
            index,
            name: sheetName,
            rows,
            worksheet
        };
    });
}

module.exports = {
    parseWorkbook
};
