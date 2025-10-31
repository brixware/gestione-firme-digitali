// Script per configurare il database e creare l'utente di default
require('dotenv').config();
const { ensureAuthSetup } = require('../src/services/auth');

async function setup() {
    try {
        console.log('Configurazione database e utente di default...');
        await ensureAuthSetup();
        console.log('Configurazione completata con successo!');
        console.log('Puoi accedere con:');
        console.log('  Username: brixware');
        console.log('  Password: 1234567890');
        process.exit(0);
    } catch (error) {
        console.error('Errore durante la configurazione:', error);
        process.exit(1);
    }
}

setup();