const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const {
  ensureAuthSetup,
  getUserByUsername,
  updateUserPassword
} = require('../src/services/auth');

const TEMP_PASSWORD = '1234567890';
const USERNAME = 'brixware';

(async () => {
  try {
    await ensureAuthSetup();
    const user = await getUserByUsername(USERNAME);
    if (!user) {
      console.error(`Utente '${USERNAME}' non trovato.`);
      process.exit(1);
    }
    await updateUserPassword(user.id, TEMP_PASSWORD, { requireChangeFlag: true });
    console.log(
      `Password per '${USERNAME}' reimpostata a '${TEMP_PASSWORD}'. Verrà richiesto il cambio al prossimo accesso.`
    );
    process.exit(0);
  } catch (error) {
    console.error('Errore durante il reset della password:', error);
    process.exit(1);
  }
})();
