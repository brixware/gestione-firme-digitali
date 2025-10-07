# Gestione Firme Digitali

Questo progetto consente di caricare dati da un file XLS in un database MySQL. È progettato per semplificare la gestione delle firme digitali, consentendo agli utenti di caricare facilmente i dati e gestirli tramite un'interfaccia utente.

## Struttura del Progetto

Il progetto è organizzato come segue:

```
GestioneFirmeDigitali
├── src
│   ├── app.js                # Punto di ingresso dell'applicazione
│   ├── services
│   │   ├── xlsParser.js      # Funzioni per analizzare file XLS
│   │   ├── dbConnector.js     # Gestione della connessione al database
│   │   └── dataLoader.js      # Funzioni per caricare dati nel database
│   ├── routes
│   │   └── index.js          # Gestione delle rotte dell'applicazione
│   └── utils
│       └── helpers.js        # Funzioni di utilità generali
├── config
│   └── dbConfig.js          # Configurazione per la connessione al database
├── public
│   └── index.html            # Pagina HTML principale per l'interfaccia utente
├── package.json              # Configurazione per npm
├── .env                      # Variabili d'ambiente per la sicurezza
└── README.md                 # Documentazione del progetto
```

## Installazione

1. Clona il repository:
   ```
   git clone <URL del repository>
   ```

2. Naviga nella cartella del progetto:
   ```
   cd GestioneFirmeDigitali
   ```

3. Installa le dipendenze:
   ```
   npm install
   ```

4. Configura le variabili d'ambiente nel file `.env` con le credenziali del tuo database MySQL.

### Opzione: usare Docker per MySQL

Se non hai un'istanza MySQL locale, puoi avviarne una con Docker:

1. Copia/aggiorna il file `.env` con questi valori (puoi modificarli a piacere, assicurandoti che coincidano con quelli di Docker):
   ```
   DB_HOST=127.0.0.1
   DB_PORT=3306
   DB_USER=gestione_user
   DB_PASSWORD=gestione_pass
   DB_NAME=gestione_firme
   DB_TABLE=digital_signatures
   DB_ASSET_TABLE=digital_signatures_assets
   DB_DOCUMENT_TABLE=digital_signatures_documents
   DB_CHARSET=utf8mb4
   DB_COLLATION=utf8mb4_unicode_ci
   ```
   > Se il tuo server MySQL non supporta `utf8mb4` (es. MySQL 5.5 o precedenti) imposta `DB_CHARSET=utf8` e `DB_COLLATION=utf8_general_ci`.

2. Avvia MySQL in Docker:
   ```
   docker compose up -d
   ```

   Il container esporrà MySQL sulla porta 3306 della tua macchina usando di default:
   - utente applicativo `gestione_user` con password `gestione_pass`
   - database `gestione_firme`
   - root password `rootpassword`
   Puoi ridefinire questi valori impostando le variabili `MYSQL_*` prima di eseguire `docker compose up -d`.

3. (Facoltativo ma consigliato) crea le tabelle richieste dall'applicazione:
   ```
   npm run db:setup
   ```

4. Per fermare il database, esegui:
   ```
   docker compose down
   ```

### Opzione: installare MySQL nativamente (macOS con Homebrew)

1. Installa MySQL:
   ```
   brew update
   brew install mysql
   ```

2. Avvia il servizio:
   ```
   brew services start mysql
   ```

3. Esegui il wizard di sicurezza (facoltativo ma consigliato) per impostare la password di root:
   ```
   mysql_secure_installation
   ```

4. Crea il database e l'utente dedicato:
   ```
   mysql -u root -p
   ```
   Una volta nella console MySQL esegui:
   ```sql
   CREATE DATABASE IF NOT EXISTS gestione_firme CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE USER IF NOT EXISTS 'gestione_user'@'localhost' IDENTIFIED BY 'gestione_pass';
   GRANT ALL PRIVILEGES ON gestione_firme.* TO 'gestione_user'@'localhost';
   FLUSH PRIVILEGES;
   EXIT;
   ```

5. Imposta il file `.env` con:
   ```
   DB_HOST=127.0.0.1
   DB_PORT=3306
   DB_USER=gestione_user
   DB_PASSWORD=gestione_pass
   DB_NAME=gestione_firme
   DB_TABLE=digital_signatures
   DB_ASSET_TABLE=digital_signatures_assets
   DB_DOCUMENT_TABLE=digital_signatures_documents
   ```

6. Crea le tabelle richieste dal progetto:
   ```
   npm run db:setup
   ```

7. Avvia l'app:
   ```
   npm start
   ```
## Utilizzo

1. Avvia l'applicazione:
   ```
   npm start
   ```

2. Apri il tuo browser e vai su `http://localhost:3000` per accedere all'interfaccia utente.

3. Carica il tuo file XLS e segui le istruzioni per completare il caricamento dei dati nel database.

## Contribuzione

Le contribuzioni sono benvenute! Se desideri contribuire, apri un problema o invia una richiesta di pull.

## Licenza

Questo progetto è concesso in licenza sotto la MIT License. Vedi il file LICENSE per ulteriori dettagli.
