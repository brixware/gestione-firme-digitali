document.addEventListener('DOMContentLoaded', () => {
  // Navigazione tra viste + accordion
  const views = Array.from(document.querySelectorAll('.view'));
  const topLinks = Array.from(document.querySelectorAll('.nav-link'));
  const subLinks = Array.from(document.querySelectorAll('.nav-sublink'));
  const allLinks = topLinks.concat(subLinks);
  const accHeader = document.querySelector('.accordion-header');
  const accPanel = document.querySelector('.accordion-panel');

  const showView = (id) => {
    views.forEach((v) => v.classList.toggle('active', v.id === id));
    allLinks.forEach((a) => a.classList.toggle('active', a.getAttribute('data-view') === id));
    if (id === 'signatures-view' || id === 'signature-insert-view' || id === 'signature-renew-view') {
      if (accHeader && accPanel) { accHeader.setAttribute('aria-expanded', 'true'); accPanel.hidden = false; }
    }
    if (id === 'dashboard-view') {
      const d = expDaysSel ? (parseInt(expDaysSel.value, 10) || 15) : 15;
      loadExpiring(d, 1);
    }
  };

  allLinks.forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    const id = a.getAttribute('data-view');
    if (!id) return;
    showView(id);
    if (id === 'signatures-view') loadSignatures(1);
  }));

  accHeader?.addEventListener('click', () => {
    const expanded = accHeader.getAttribute('aria-expanded') === 'true';
    accHeader.setAttribute('aria-expanded', expanded ? 'false' : 'true');
    accPanel.hidden = expanded;
  });

  // Utils
  const esc = (s) => (s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
  const fmt = {
    date: (v) => {
      if (!v) return '';
      if (typeof v === 'string') {
        const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m) return `${m[3]}/${m[2]}/${m[1]}`;
        const d = new Date(v);
        if (!isNaN(d)) return d.toLocaleDateString('it-IT');
        return v;
      }
      if (v instanceof Date) return v.toLocaleDateString('it-IT');
      return String(v);
    },
    money: (v) => (typeof v === 'number' ? v.toFixed(2) : v ?? ''),
  };

  // Upload
  const form = document.getElementById('uploadForm');
  const fileInput = document.getElementById('fileInput');
  const messageContainer = document.getElementById('message');
  const setMessage = (text, type = 'info') => { if (!messageContainer) return; messageContainer.textContent = text; messageContainer.className = type; };
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!fileInput?.files || fileInput.files.length === 0) { setMessage('Seleziona un file da caricare.', 'error'); return; }
    const formData = new FormData(); formData.append('file', fileInput.files[0]);
    try {
      setMessage('Caricamento in corso...', 'info');
      const response = await fetch('/api/upload', { method: 'POST', body: formData });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.message || 'Errore sconosciuto durante il caricamento.');
      const stats = result?.stats; let details = '';
      if (stats) {
        const parts = [];
        if (typeof stats.base === 'number') parts.push(`base: ${stats.base}`);
        if (typeof stats.assets === 'number') parts.push(`assets: ${stats.assets}`);
        if (typeof stats.documents === 'number') parts.push(`documenti: ${stats.documents}`);
        if (typeof stats.contactsUpdated === 'number') parts.push(`contatti aggiornati: ${stats.contactsUpdated}`);
        if (typeof stats.renewalsInserted === 'number') parts.push(`rinnovi inseriti: ${stats.renewalsInserted}`);
        if (parts.length > 0) details = ` (${parts.join(', ')})`;
      }
      setMessage(`${result?.message || 'File caricato con successo.'}${details}`, 'success');
      form.reset(); showView('dashboard-view');
    } catch (error) { console.error('Errore durante il caricamento del file:', error); setMessage(error.message || 'Si è verificato un errore.', 'error'); }
  });

  // Elenco firme (signatures-view)
  const sigBody = document.getElementById('sig-body');
  const sigPrev = document.getElementById('sig-prev');
  const sigNext = document.getElementById('sig-next');
  const sigPageInfo = document.getElementById('sig-page-info');
  const sigRange = document.getElementById('sig-range');
  const sigPageSizeSel = document.getElementById('sig-page-size');
  const thSortables = Array.from(document.querySelectorAll('th[data-sort]'));
  const fId = document.getElementById('f-id');
  const fTitolare = document.getElementById('f-titolare');
  const fEmail = document.getElementById('f-email');
  const fFattura = document.getElementById('f-fattura');
  let sigPage = 1, sigTotalPages = 1, sigPageSize = 20, sortBy = 'id', sortDir = 'asc';
  const filters = { id: '', titolare: '', email: '', fattura_numero: '', emesso_da: '' };

  function setSortIndicator() { thSortables.forEach((th) => { th.classList.remove('asc', 'desc'); if (th.dataset.sort === sortBy) th.classList.add(sortDir); }); }
  async function loadSignatures(page = 1) {
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(sigPageSize), sortBy, sortDir });
      Object.entries(filters).forEach(([k, v]) => { if (v !== '' && v != null) params.set(k, String(v)); });
      const res = await fetch(`/api/signatures?${params.toString()}`);
      if (!res.ok) throw new Error('Errore nel caricamento delle firme');
      const data = await res.json();
      const rows = Array.isArray(data.data) ? data.data : [];
      sigPage = data.page || 1; sigTotalPages = data.totalPages || 1; const total = data.total || 0;
      sigBody.innerHTML = rows.map((r) => {
        const emessoHint = r.emesso_da ? ` <span class="hint" title="Emesso da: ${esc(r.emesso_da)}">🛈</span>` : '';
        return `<tr>
          <td>${r.id ?? ''}</td>
          <td>${r.titolare ?? ''}</td>
          <td>${r.email ?? ''}</td>
          <td>${r.recapito_telefonico ?? ''}</td>
          <td>${fmt.date(r.data_emissione)}${emessoHint}</td>
          <td>${fmt.money(r.costo_ie)}</td>
          <td>${fmt.money(r.importo_ie)}</td>
          <td>${r.fattura_numero ?? ''}</td>
          <td>${r.fattura_tipo_invio ?? ''}</td>
          <td><button class="icon-btn" title="Vedi rinnovi" data-action="renewals" data-sigid="${r.id}">🔁</button></td>
        </tr>`;
      }).join('');
      sigPageInfo.textContent = `Pagina ${sigPage} / ${sigTotalPages}`;
      sigPrev.disabled = sigPage <= 1; sigNext.disabled = sigPage >= sigTotalPages;
      const start = total === 0 ? 0 : (sigPage - 1) * sigPageSize + 1; const end = total === 0 ? 0 : start + rows.length - 1;
      sigRange.textContent = `Mostrando ${start}–${end} di ${total}`; setSortIndicator();
    } catch (e) { console.error(e); }
  }
  sigPrev?.addEventListener('click', () => { if (sigPage > 1) loadSignatures(sigPage - 1); });
  sigNext?.addEventListener('click', () => { if (sigPage < sigTotalPages) loadSignatures(sigPage + 1); });
  sigPageSizeSel?.addEventListener('change', () => { sigPageSize = parseInt(sigPageSizeSel.value, 10) || 20; loadSignatures(1); });
  thSortables.forEach((th) => th.addEventListener('click', () => { const key = th.dataset.sort; if (!key) return; if (sortBy === key) { sortDir = sortDir === 'asc' ? 'desc' : 'asc'; } else { sortBy = key; sortDir = 'asc'; } loadSignatures(1); }));
  let fTimer; const scheduleFilter = () => { clearTimeout(fTimer); fTimer = setTimeout(() => loadSignatures(1), 300); };
  fId?.addEventListener('input', () => { filters.id = fId.value.trim(); scheduleFilter(); });
  fTitolare?.addEventListener('input', () => { filters.titolare = fTitolare.value.trim(); scheduleFilter(); });
  fEmail?.addEventListener('input', () => { filters.email = fEmail.value.trim(); scheduleFilter(); });
  fFattura?.addEventListener('input', () => { filters.fattura_numero = fFattura.value.trim(); scheduleFilter(); });

  // Modale rinnovi (riuso anche in Dashboard)
  const modal = document.getElementById('modal-renewals');
  const renewalsBody = document.getElementById('renewals-body');
  const renewalsWrap = document.getElementById('renewals-table-wrap');
  const renewalsEmpty = document.getElementById('renewals-empty');
  const modalTitle = document.getElementById('modal-renewals-title');
  const openModal = () => { modal.classList.remove('hidden'); modal.setAttribute('aria-hidden', 'false'); };
  const closeModal = () => { modal.classList.add('hidden'); modal.setAttribute('aria-hidden', 'true'); };
  modal?.addEventListener('click', (e) => { const t = e.target; if (t && t.getAttribute('data-close') === 'true') closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
  const loadRenewalsIntoModal = async (sigId) => {
    modalTitle.textContent = `Rinnovi per ID ${sigId}`;
    renewalsBody.innerHTML = ''; renewalsEmpty.style.display = ''; renewalsWrap.style.display = 'none'; openModal();
    try {
      const res = await fetch(`/api/signatures/${encodeURIComponent(sigId)}/renewals`);
      if (!res.ok) throw new Error('Errore nel recupero dei rinnovi');
      const data = await res.json(); const rows = Array.isArray(data.data) ? data.data : [];
      const filtered = rows.filter((r) => [r.rinnovo_da, r.nuova_emissione_id, r.rinnovo_data, r.data_scadenza, r.fattura_numero, r.note].some((v) => v != null && String(v).trim() !== ''));
      if (filtered.length === 0) { renewalsEmpty.style.display = ''; renewalsWrap.style.display = 'none'; return; }
      renewalsBody.innerHTML = filtered.map((r) => `<tr>
          <td>${r.sheet_name ?? ''}</td>
          <td>${r.rinnovo_da ?? ''}</td>
          <td>${r.nuova_emissione_id ?? ''}</td>
          <td>${fmt.date(r.rinnovo_data)}</td>
          <td>${fmt.date(r.data_scadenza)}</td>
          <td>${r.fattura_numero ?? ''}</td>
          <td>${r.note ?? ''}</td>
        </tr>`).join('');
      renewalsEmpty.style.display = 'none'; renewalsWrap.style.display = '';
    } catch (err) { console.error(err); renewalsEmpty.textContent = 'Errore nel caricamento dei rinnovi.'; renewalsEmpty.style.display = ''; renewalsWrap.style.display = 'none'; }
  };
  sigBody?.addEventListener('click', (e) => { const btn = e.target.closest('button[data-action="renewals"]'); if (!btn) return; const sigId = btn.getAttribute('data-sigid'); if (!sigId) return; loadRenewalsIntoModal(sigId); });

  // Dashboard: scadenze paginate + CSV
  const expBody = document.getElementById('expiring-body');
  const expDaysSel = document.getElementById('exp-days');
  const expTotal = document.getElementById('exp-total');
  const expPrev = document.getElementById('exp-prev');
  const expNext = document.getElementById('exp-next');
  const expPageInfo = document.getElementById('exp-page-info');
  const expPageSizeSel = document.getElementById('exp-page-size');
  let expPage = 1, expTotalPages = 1, expPageSize = (expPageSizeSel ? (parseInt(expPageSizeSel.value, 10) || 5) : 5);

  async function loadExpiring(days = 15, page = expPage) {
    if (!expBody) return;
    try {
      const params = new URLSearchParams({ days: String(days), page: String(page), pageSize: String(expPageSize) });
      const res = await fetch(`/api/signatures/expiring?${params.toString()}`);
      if (!res.ok) throw new Error('Errore nel caricamento scadenze');
      const data = await res.json(); const rows = Array.isArray(data.data) ? data.data : [];
      expPage = data.page || 1; expTotalPages = data.totalPages || 1; const total = typeof data.total === 'number' ? data.total : rows.length;
      expBody.innerHTML = rows.map((r) => {
        const actions = `<button class="icon-btn" title="Vedi rinnovi" data-action="renewals" data-sigid="${r.id}">🔁</button>`;
        return `<tr>
          <td>${r.id ?? ''}</td>
          <td>${r.titolare ?? ''}</td>
          <td>${r.email ?? ''}</td>
          <td>${r.recapito_telefonico ?? ''}</td>
          <td>${fmt.date(r.data_scadenza)}</td>
          <td>${r.days_left ?? ''}</td>
          <td>${actions}</td>
        </tr>`;
      }).join('');
      if (expTotal) expTotal.textContent = `Trovate ${total} scadenze`;
      if (expPageInfo) expPageInfo.textContent = `Pagina ${expPage} / ${expTotalPages}`;
      if (expPrev) expPrev.disabled = expPage <= 1; if (expNext) expNext.disabled = expPage >= expTotalPages;
    } catch (e) { console.error(e); if (expBody) expBody.innerHTML = `<tr><td colspan="7">Errore nel caricamento delle scadenze</td></tr>`; }
  }
  document.getElementById('dashboard-view')?.addEventListener('click', (e) => { const btn = e.target.closest('button[data-action="renewals"]'); if (!btn) return; const sigId = btn.getAttribute('data-sigid'); if (!sigId) return; loadRenewalsIntoModal(sigId); });
  expDaysSel?.addEventListener('change', () => { const d = parseInt(expDaysSel.value, 10) || 15; expPage = 1; loadExpiring(d, 1); });
  expPageSizeSel?.addEventListener('change', () => { expPageSize = parseInt(expPageSizeSel.value, 10) || 20; expPage = 1; const d = expDaysSel ? (parseInt(expDaysSel.value, 10) || 15) : 15; loadExpiring(d, 1); });
  expPrev?.addEventListener('click', () => { if (expPage > 1) { const d = expDaysSel ? (parseInt(expDaysSel.value, 10) || 15) : 15; loadExpiring(d, expPage - 1); } });
  expNext?.addEventListener('click', () => { if (expPage < expTotalPages) { const d = expDaysSel ? (parseInt(expDaysSel.value, 10) || 15) : 15; loadExpiring(d, expPage + 1); } });
  document.getElementById('exp-export')?.addEventListener('click', async () => {
    const days = expDaysSel ? (parseInt(expDaysSel.value, 10) || 15) : 15;
    try {
      let page = 1; const pageSize = 1000; let totalPages = 1; const all = [];
      do {
        const params = new URLSearchParams({ days: String(days), page: String(page), pageSize: String(pageSize) });
        const res = await fetch(`/api/signatures/expiring?${params.toString()}`);
        if (!res.ok) throw new Error('Errore export');
        const data = await res.json(); totalPages = data.totalPages || 1; const rows = Array.isArray(data.data) ? data.data : [];
        all.push(...rows); page += 1;
      } while (page <= totalPages);
      const headers = ['id','titolare','email','recapito_telefonico','data_scadenza','days_left'];
      const escapeCsv = (v) => { if (v == null) return ''; const s = String(v).replace(/"/g, '""'); return `"${s}"`; };
      const lines = [headers.join(',')].concat(all.map(r => [r.id, r.titolare, r.email, r.recapito_telefonico, (r.data_scadenza || ''), r.days_left].map(escapeCsv).join(',')));
      const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `scadenze_${days}gg.csv`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch (e) { console.error('Errore durante export CSV', e); }
  });

  // Caricamento iniziale Dashboard
  const initialDays = expDaysSel ? (parseInt(expDaysSel.value, 10) || 15) : 15;
  loadExpiring(initialDays, 1);

  // Dashboard: grafico annuale (pie) con Chart.js
  let yearlyChart;
  async function loadYearlyChart() {
    const canvas = document.getElementById('yearly-chart');
    if (!canvas || typeof Chart === 'undefined') return;
    try {
      const res = await fetch('/api/signatures/stats/yearly');
      if (!res.ok) throw new Error('Errore statistiche annuali');
      const json = await res.json();
      const rows = Array.isArray(json.data) ? json.data : [];
      const labels = rows.map(r => (r.year == null ? 'Sconosciuto' : String(r.year)));
      const data = rows.map(r => r.count || 0);
      const colors = labels.map((_, i) => `hsl(${(i * 47) % 360} 70% 60%)`);
      if (yearlyChart) { yearlyChart.destroy(); }
      yearlyChart = new Chart(canvas.getContext('2d'), {
        type: 'pie',
        data: { labels, datasets: [{ label: 'Firme per anno', data, backgroundColor: colors, borderWidth: 1 }] },
        options: {
          responsive: true,
          plugins: {
            legend: { position: 'bottom' },
            tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${ctx.parsed}` } },
            title: { display: false }
          }
        }
      });
    } catch (e) {
      console.error(e);
    }
  }

  // Carica grafico all'avvio e quando si torna in dashboard
  loadYearlyChart();
  document.querySelector('[data-view="dashboard-view"]')?.addEventListener('click', () => {
    loadYearlyChart();
  });

  // Dashboard: grafico rinnovi annuali
  let renewalsYearlyChart;
  async function loadRenewalsYearlyChart() {
    const canvas = document.getElementById('renewals-yearly-chart');
    if (!canvas || typeof Chart === 'undefined') return;
    try {
      const res = await fetch('/api/signatures/stats/renewals/yearly');
      if (!res.ok) throw new Error('Errore statistiche rinnovi annuali');
      const json = await res.json();
      const rows = Array.isArray(json.data) ? json.data : [];
      const labels = rows.map(r => (r.year == null ? 'Sconosciuto' : String(r.year)));
      const data = rows.map(r => r.count || 0);
      const colors = labels.map((_, i) => `hsl(${(i * 67) % 360} 70% 60%)`);
      if (renewalsYearlyChart) { renewalsYearlyChart.destroy(); }
      renewalsYearlyChart = new Chart(canvas.getContext('2d'), {
        type: 'pie',
        data: { labels, datasets: [{ label: 'Rinnovi per anno', data, backgroundColor: colors, borderWidth: 1 }] },
        options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
      });
    } catch (e) { console.error(e); }
  }
  loadRenewalsYearlyChart();
  document.querySelector('[data-view="dashboard-view"]')?.addEventListener('click', () => { loadRenewalsYearlyChart(); });
});
