const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const {
  ensureAuthSetup,
  getUserByUsername,
  verifyPassword,
  updateUserPassword
} = require('../src/services/auth');

(async () => {
  try {
    await ensureAuthSetup();
    const user = await getUserByUsername('brixware');
    if (!user) {
      console.log('Utente non trovato');
      process.exit(0);
    }
    console.log('must_change_password?', user.must_change_password);
    const oldOk = await verifyPassword('1234567890', user.password_hash);
    console.log('Verifica password attuale 1234567890:', oldOk);
    await updateUserPassword(user.id, '#1234567890', { requireChangeFlag: false });
    const user2 = await getUserByUsername('brixware');
    console.log('Aggiornamento completato, verifica nuova password:', await verifyPassword('#1234567890', user2.password_hash));
    process.exit(0);
  } catch (error) {
    console.error('Errore script test password:', error);
    process.exit(1);
  }
})();
