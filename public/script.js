document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('uploadForm');
    const fileInput = document.getElementById('fileInput');
    const messageContainer = document.getElementById('message');

    const setMessage = (text, type = 'info') => {
        messageContainer.textContent = text;
        messageContainer.className = type;
    };

    form.addEventListener('submit', async (event) => {
        event.preventDefault();

        if (!fileInput.files || fileInput.files.length === 0) {
            setMessage('Seleziona un file da caricare.', 'error');
            return;
        }

        const formData = new FormData();
        formData.append('file', fileInput.files[0]);

        try {
            setMessage('Caricamento in corso...', 'info');

            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result?.message || 'Errore sconosciuto durante il caricamento.');
            }

            const stats = result?.stats;
            let details = '';
            if (stats) {
                const parts = [];
                if (typeof stats.base === 'number') parts.push(`base: ${stats.base}`);
                if (typeof stats.assets === 'number') parts.push(`assets: ${stats.assets}`);
                if (typeof stats.documents === 'number') parts.push(`documenti: ${stats.documents}`);
                if (typeof stats.contactsUpdated === 'number') {
                    parts.push(`contatti aggiornati: ${stats.contactsUpdated}`);
                }
                if (typeof stats.renewalsInserted === 'number') {
                    parts.push(`rinnovi inseriti: ${stats.renewalsInserted}`);
                }
                if (parts.length > 0) {
                    details = ` (${parts.join(', ')})`;
                }
            }

            setMessage(
                `${result?.message || 'File caricato con successo.'}${details}`,
                'success'
            );
            form.reset();
        } catch (error) {
            console.error('Errore durante il caricamento del file:', error);
            setMessage(error.message || 'Si è verificato un errore.', 'error');
        }
    });
});
