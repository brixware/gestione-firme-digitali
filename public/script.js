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

            setMessage(result?.message || 'File caricato con successo.', 'success');
            form.reset();
        } catch (error) {
            console.error('Errore durante il caricamento del file:', error);
            setMessage(error.message || 'Si è verificato un errore.', 'error');
        }
    });
});
