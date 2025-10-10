-- Script per aggiornare nuova_emissione_id dai riferimenti NE-XXXX in rinnovo_da
-- Assicurarsi di fare un backup del database prima di eseguire questo script

-- Aggiorna il campo nuova_emissione_id estraendo il numero dopo NE-
UPDATE digital_signatures_renewals
SET nuova_emissione_id = CAST(
    SUBSTRING(
        rinnovo_da,
        4,  -- Inizia dopo "NE-"
        LENGTH(rinnovo_da) - 3  -- Lunghezza totale meno "NE-"
    ) AS UNSIGNED
)
WHERE 
    rinnovo_da REGEXP '^NE-[0-9]+$'  -- Verifica il pattern corretto
    AND nuova_emissione_id IS NULL;  -- Solo dove non è già impostato

-- Verifica i risultati
SELECT 
    id,
    rinnovo_da,
    nuova_emissione_id
FROM digital_signatures_renewals
WHERE rinnovo_da LIKE 'NE-%'
ORDER BY id;