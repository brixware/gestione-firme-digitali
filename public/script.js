// Stato globale e funzioni di utility
const app = {
  currentUser: null,

  // Utility per gestire il profilo utente
  updateProfileHeader(user = {}) {
    const elements = {
      fullName: document.getElementById('profile-fullname'),
      username: document.getElementById('profile-username'),
      avatarImg: document.getElementById('profile-avatar-img'),
      avatarInitial: document.getElementById('profile-avatar-initial'),
      topName: document.getElementById('topbar-profile-name'),
      topUsername: document.getElementById('topbar-profile-username'),
      topAvatarImg: document.getElementById('topbar-avatar-img'),
      topAvatarInitial: document.getElementById('topbar-avatar-initial'),
      topLink: document.getElementById('topbar-profile-link')
    };

    const username = user.username || this.currentUser?.username || '';
    const fullName = user.fullName || this.currentUser?.fullName || '';
    const avatarUrl = user.avatarUrl || this.currentUser?.avatarUrl || '';
    const hasIdentity = Boolean(fullName || username);
    const displayName = hasIdentity ? (fullName || username) : 'Profilo';
    const initial = (fullName || username || 'P').charAt(0).toUpperCase();

    if (elements.fullName) elements.fullName.textContent = fullName || username || '-';
    if (elements.username) elements.username.textContent = username ? `@${username}` : '';

    const setAvatar = (imgEl, initialEl) => {
      if (!imgEl || !initialEl) return;
      if (avatarUrl) {
        imgEl.src = avatarUrl;
        imgEl.classList.add('visible');
        initialEl.style.display = 'none';
      } else {
        imgEl.src = '';
        imgEl.classList.remove('visible');
        initialEl.textContent = initial;
        initialEl.style.display = 'block';
      }
    };

    setAvatar(elements.avatarImg, elements.avatarInitial);
    setAvatar(elements.topAvatarImg, elements.topAvatarInitial);

    if (elements.topName) elements.topName.textContent = displayName;
    if (elements.topUsername) elements.topUsername.textContent = username ? `@${username}` : '';
    if (elements.topLink) {
      const linkTitle = hasIdentity ? `Apri profilo di ${displayName}` : 'Apri profilo';
      elements.topLink.setAttribute('title', linkTitle);
      elements.topLink.setAttribute('aria-label', linkTitle);
    }
  },

  // Gestione toggle password
  initPasswordToggles(container = document) {
    if (!container) return;
    const buttons = container.querySelectorAll('[data-toggle-password]');
    buttons.forEach(btn => {
      if (!btn || btn.dataset.bound === 'true') return;
      const inputId = btn.dataset.togglePassword;
      const input = container.querySelector(`#${inputId}`) || document.getElementById(inputId);
      if (!input) return;
      btn.dataset.bound = 'true';
      btn.addEventListener('click', () => {
        const isHidden = input.type === 'password';
        input.type = isHidden ? 'text' : 'password';
        btn.textContent = isHidden ? '🙈' : '👁';
      });
    });
  },

  // Gestione sessione
  async ensureSession() {
    try {
      const res = await fetch('/api/auth/session');
      const data = await res.json().catch(() => ({}));
      
      if (!res.ok || !data.authenticated) {
        if (window.location.pathname !== '/login') {
          redirectToLogin('/login');
        }
        return;
      }
      
      if (data.mustChangePassword && window.location.pathname !== '/login') {
        redirectToLogin('/login?change=1');
        return;
      }
      
      this.currentUser = {
        username: data.username || '',
        fullName: data.fullName || '',
        avatarUrl: data.avatarUrl || ''
      };
      
      document.body.dataset.username = this.currentUser.username || '';
      this.updateProfileHeader(this.currentUser);
      
      const profileView = document.getElementById('profile-view');
      if (profileView) {
        this.initPasswordToggles(profileView);
      }
      
      const expDaysSel = document.getElementById('exp-days');
      if (expDaysSel && typeof loadExpiring === 'function') {
        const d = parseInt(expDaysSel.value, 10) || 15;
        loadExpiring(d, 1);
      }
    } catch (error) {
      console.error('Errore verifica sessione:', error);
      if (window.location.pathname !== '/login') {
        redirectToLogin('/login');
      }
    }
  }
};

// Inizializzazione dell'applicazione quando il DOM è pronto
// Funzioni di utilità globali
const esc = (s) => (s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));

const redirectToLogin = (target = '/login') => {
  if (typeof window !== 'undefined' && typeof window.__closeLiveReload === 'function') {
    try { window.__closeLiveReload(); } catch (_) { /* ignore */ }
  }
  window.location.href = target;
};

// Configurazione live reload
let liveReloadSource = null;
function setupLiveReload() {
  if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;
  let reconnectAttempts = 0;
  let reloading = false;

  const cleanup = () => {
    if (liveReloadSource) {
      liveReloadSource.close();
      liveReloadSource = null;
    }
  };

  if (typeof window.__closeLiveReload === 'function') {
    window.removeEventListener('beforeunload', window.__closeLiveReload);
    try { window.__closeLiveReload(); } catch (_) { /* ignore previous errors */ }
  }

  window.__closeLiveReload = cleanup;
  window.addEventListener('beforeunload', cleanup);

  const connect = () => {
    cleanup();
    const es = new EventSource('/api/live-reload');
    liveReloadSource = es;
    es.onopen = () => {
      if (reconnectAttempts > 0 && !reloading) {
        reloading = true;
        window.location.reload();
      }
      reconnectAttempts = 0;
    };
    es.onerror = () => {
      es.close();
      if (reloading || document.readyState === 'unloading') return;
      reconnectAttempts += 1;
      const delay = Math.min(1000 * 2 ** reconnectAttempts, 10000);
      setTimeout(connect, delay);
    };
  };

  connect();
}

// Formattazione
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
    money: (v) => (typeof v === 'number' ? `${v.toFixed(2)} €` : (v ? `${v} €` : '')),
  };

  // Navigation + accordion
  const views = Array.from(document.querySelectorAll('.view'));
  const topLinks = Array.from(document.querySelectorAll('.nav-link, .topbar-link'));
  const subLinks = Array.from(document.querySelectorAll('.nav-sublink'));
  const allLinks = topLinks.concat(subLinks);
  const accHeader = document.querySelector('.accordion-header');
  const accPanel = document.querySelector('.accordion-panel');
  const showView = async (id) => {
    views.forEach((v) => v.classList.toggle('active', v.id === id));
    allLinks.forEach((a) => a.classList.toggle('active', a.getAttribute('data-view') === id));
    if (id === 'signatures-view' || id === 'signature-insert-view' || id === 'signature-renew-view') {
      if (accHeader && accPanel) { accHeader.setAttribute('aria-expanded', 'true'); accPanel.hidden = false; }
    }
    if (id === 'signature-insert-view') {
      prepareInsertView();
    }
    if (id === 'dashboard-view') {
      const d = expDaysSel ? (parseInt(expDaysSel.value, 10) || 15) : 15;
      loadExpiring(d, 1);
    }
    if (id === 'statistics-view') {
      loadYearlyChart();
      loadRenewalsYearlyChart();
    }
    if (id === 'reports-view') {
      loadReportSummary();
    }
    if (id === 'profile-view') {
      await loadProfile();
      app.initPasswordToggles(profileView);
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

  // Dashboard elements
  const expDaysSel = document.getElementById('exp-days');
  const expPageSizeSel = document.getElementById('exp-page-size');
  const expPrevBtn = document.getElementById('exp-prev');
  const expNextBtn = document.getElementById('exp-next');
  const expPageInfo = document.getElementById('exp-page-info');
  const expTotal = document.getElementById('exp-total');
  const expBadge = document.getElementById('exp-badge');
  const expiringBody = document.getElementById('expiring-body');
  const expExportBtn = document.getElementById('exp-export');

  // Upload form
  const reportExpiringEl = document.getElementById('report-expiring-count');
  const reportUnpaidEl = document.getElementById('report-unpaid-count');
  const logoutBtn = document.getElementById('logout-btn');
  const form = document.getElementById('uploadForm');
  const fileInput = document.getElementById('fileInput');
  const messageContainer = document.getElementById('message');
  const setMessage = (text, type = 'info') => { if (!messageContainer) return; messageContainer.textContent = text; messageContainer.className = type; };

  const profileView = document.getElementById('profile-view');
  const profileInfoForm = document.getElementById('profile-info-form');
  const profilePasswordForm = document.getElementById('profile-password-form');
  const profileInfoMsg = document.getElementById('profile-info-msg');
  const profilePasswordMsg = document.getElementById('profile-password-msg');
  const profileFullNameEl = document.getElementById('profile-fullname');
  const profileUsernameEl = document.getElementById('profile-username');
  const profileAvatarImg = document.getElementById('profile-avatar-img');
  const profileAvatarInitial = document.getElementById('profile-avatar-initial');
  const profileFullNameInput = document.getElementById('profile-full-name');
  const profileAvatarInput = document.getElementById('profile-avatar-url');
  const profileCurrentPasswordInput = document.getElementById('profile-current-password');
  const profileNewPasswordInput = document.getElementById('profile-new-password');
  const profileConfirmPasswordInput = document.getElementById('profile-confirm-password');
  const profileAvatarStatus = document.getElementById('profile-avatar-status');
  const profileAvatarFileInput = document.getElementById('profile-avatar-file');
  const profileAvatarUploadBtn = document.getElementById('profile-avatar-upload');
  const profileAvatarClearBtn = document.getElementById('profile-avatar-clear');
  const AVATAR_MAX_SIZE = 2 * 1024 * 1024; // 2 MB

  const getSafeCurrentUser = () => {
    if (app.currentUser && typeof app.currentUser === 'object') return app.currentUser;
    const fallbackUsername = document.body?.dataset?.username || '';
    const fallbackFullName = profileFullNameEl?.textContent || '';
    return { username: fallbackUsername, fullName: fallbackFullName };
  };

  const applyAvatarUrl = (nextUrl = '') => {
    const cleanUrl = typeof nextUrl === 'string' ? nextUrl.trim() : '';
    if (profileAvatarInput && profileAvatarInput.value !== cleanUrl) {
      profileAvatarInput.value = cleanUrl;
    }
    const baseUser = getSafeCurrentUser();
    app.currentUser = { ...baseUser, avatarUrl: cleanUrl || null };
    app.updateProfileHeader(app.currentUser);
    updateAvatarStatus(cleanUrl);
  };

  const showProfileInfoStatus = (text, type = 'info') => {
    setFormMessage(profileInfoMsg, text, type);
  };

  const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Impossibile leggere il file.'));
    reader.readAsDataURL(file);
  });

  const loadImageElement = (src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Impossibile elaborare l\'immagine.'));
    img.src = src;
  });

  const MAX_AVATAR_DIMENSION = 256;
  const processAvatarFile = async (file) => {
    const originalDataUrl = await readFileAsDataUrl(file);
    const img = await loadImageElement(originalDataUrl);
    const { width, height } = img;
    const maxSide = Math.max(width, height);
    let targetWidth = width;
    let targetHeight = height;
    if (maxSide > MAX_AVATAR_DIMENSION) {
      const scale = MAX_AVATAR_DIMENSION / maxSide;
      targetWidth = Math.max(1, Math.round(width * scale));
      targetHeight = Math.max(1, Math.round(height * scale));
    }
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, targetWidth, targetHeight);
    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
    const outputMime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const quality = outputMime === 'image/jpeg' ? 0.85 : undefined;
    return canvas.toDataURL(outputMime, quality);
  };

  const updateAvatarStatus = (dataUrl) => {
    if (!profileAvatarStatus) return;
    if (!dataUrl) {
      profileAvatarStatus.textContent = 'Nessuna immagine caricata';
      profileAvatarStatus.classList.remove('has-image');
      profileAvatarStatus.classList.add('muted');
      return;
    }
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      profileAvatarStatus.textContent = 'Immagine personalizzata';
      profileAvatarStatus.classList.add('has-image');
      profileAvatarStatus.classList.remove('muted');
      return;
    }
    const mime = match[1];
    const payload = match[2];
    const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
    const byteLength = Math.max(0, Math.floor(payload.length * 0.75) - padding);
    const humanSize = byteLength >= 1024 * 1024
      ? `${(byteLength / (1024 * 1024)).toFixed(2)} MB`
      : `${(byteLength / 1024).toFixed(1)} KB`;
    profileAvatarStatus.textContent = `Immagine pronta (${mime}, ${humanSize})`;
    profileAvatarStatus.classList.add('has-image');
    profileAvatarStatus.classList.remove('muted');
  };

  profileAvatarClearBtn?.addEventListener('click', () => {
    applyAvatarUrl('');
    showProfileInfoStatus('Avatar rimosso. Ricorda di salvare per confermare.', 'info');
  });

  profileAvatarUploadBtn?.addEventListener('click', () => {
    profileAvatarFileInput?.click();
  });

  profileAvatarFileInput?.addEventListener('change', async () => {
    if (!profileAvatarFileInput?.files || profileAvatarFileInput.files.length === 0) return;
    const [file] = profileAvatarFileInput.files;
    if (!file) return;
    if (!/^image\//.test(file.type || '')) {
      showProfileInfoStatus('Formato immagine non supportato. Usa PNG, JPG, GIF o WebP.', 'error');
      profileAvatarFileInput.value = '';
      return;
    }
    if (file.size > AVATAR_MAX_SIZE) {
      showProfileInfoStatus('L\'immagine e\' troppo grande. Dimensione massima: 2 MB.', 'error');
      profileAvatarFileInput.value = '';
      return;
    }
    try {
      showProfileInfoStatus('Elaborazione immagine...', 'info');
      const dataUrl = await processAvatarFile(file);
      applyAvatarUrl(dataUrl);
      showProfileInfoStatus('Immagine pronta. Ricorda di salvare per confermare.', 'success');
    } catch (error) {
      console.error('Errore elaborazione avatar:', error);
      showProfileInfoStatus(error.message || 'Errore durante l\'elaborazione dell\'immagine.', 'error');
    } finally {
      profileAvatarFileInput.value = '';
    }
  });

  const setFormMessage = (el, text = '', type = 'info') => {
    if (!el) return;
    el.textContent = text || '';
    el.className = 'form-message';
    if (text && type) {
      el.classList.add(type);
    }
  };

  const getInitial = (fullName, username) => {
    const source = (fullName && fullName.trim()) || (username && username.trim()) || 'U';
    return source.substring(0, 1).toUpperCase();
  };

  // Rimossa la duplicazione delle funzioni che ora sono nell'oggetto app
  logoutBtn?.addEventListener('click', async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (error) {
      console.error('Errore durante il logout:', error);
    } finally {
      redirectToLogin('/login');
    }
  });
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

  // Signatures list
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
  const fRecapito = document.getElementById('f-recapito');
  const fData = document.getElementById('f-data');
  const fFattura = document.getElementById('f-fattura');
  const fInvio = document.getElementById('f-invio');
  const fPaid = document.getElementById('f-paid');
  const fClear = document.getElementById('f-clear');
  const editModal = document.getElementById('modal-edit');
  const editForm = document.getElementById('edit-form');
  const editMsg = document.getElementById('edit-msg');
  const editFields = {
    titolare: document.getElementById('edit-titolare'),
    email: document.getElementById('edit-email'),
    recapito: document.getElementById('edit-recapito'),
    data: document.getElementById('edit-data'),
    emesso: document.getElementById('edit-emesso'),
    costo: document.getElementById('edit-costo'),
    importo: document.getElementById('edit-importo'),
    fattura: document.getElementById('edit-fattura'),
    invio: document.getElementById('edit-invio')
  };
  let editingId = null;
  let sigPage = 1, sigTotalPages = 1, sigPageSize = sigPageSizeSel ? (parseInt(sigPageSizeSel.value, 10) || 20) : 20, sortBy = 'id', sortDir = 'desc';
  const filters = {
    id: '',
    titolare: '',
    email: '',
    recapito_telefonico: '',
    data_emissione: '',
    fattura_numero: '',
    fattura_tipo_pagamento: '',
    emesso_da: '',
    paid: fPaid ? fPaid.value : ''
  };
  const setFieldValue = (el, value) => { if (!el) return; el.value = value ?? ''; };
  const openEditModal = () => { if (!editModal) return; editModal.classList.remove('hidden'); editModal.setAttribute('aria-hidden', 'false'); };
  const closeEditModal = () => {
    if (!editModal) return;
    editModal.classList.add('hidden');
    editModal.setAttribute('aria-hidden', 'true');
    if (editMsg) editMsg.textContent = '';
    editingId = null;
  };
  editModal?.addEventListener('click', (e) => { const t = e.target; if (t && t.getAttribute('data-close') === 'true') closeEditModal(); });
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
        const emHint = r.emesso_da ? ` <span class="hint-icon" title="Emesso da: ${esc(r.emesso_da)}">i</span>` : '';
        const editBtn = `<button class="icon-btn" title="Modifica" data-action="edit" data-id="${r.id}">&#9998;</button>`;
        const paidClass = r.paid ? 'icon-btn-success' : 'icon-btn-danger';
        const paidBtn = `<button class="icon-btn ${paidClass}" data-action="toggle-paid" data-id="${r.id}" data-paid="${r.paid ? 1 : 0}" title="${r.paid ? 'Segna non pagata' : 'Segna pagata'}">${r.paid ? '&check;' : '&times;'}</button>`;
        const renewBtn = `<button class="icon-btn" title="Vedi rinnovi" data-action="renewals" data-sigid="${r.id}">&#8635;</button>`;
        return `<tr>
          <td>${r.id ?? ''}</td>
          <td>${r.titolare ?? ''}</td>
          <td>${r.email ?? ''}</td>
          <td>${r.recapito_telefonico ?? ''}</td>
          <td>${fmt.date(r.data_emissione)}${emHint}</td>
          <td>${fmt.money(r.costo_ie)}</td>
          <td>${fmt.money(r.importo_ie)}</td>
          <td>${r.fattura_numero ?? ''}${r.fattura_tipo_invio ? ` <span class="hint-icon" title="Tipo invio: ${esc(r.fattura_tipo_invio)}">i</span>` : ''}</td>
          <td>${r.fattura_tipo_pagamento ?? ''}</td>
          <td><span class="action-group">${editBtn}${paidBtn}${renewBtn}</span></td>
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
  fRecapito?.addEventListener('input', () => { filters.recapito_telefonico = fRecapito.value.trim(); scheduleFilter(); });
  fData?.addEventListener('change', () => { filters.data_emissione = fData.value; scheduleFilter(); });
  fFattura?.addEventListener('input', () => { filters.fattura_numero = fFattura.value.trim(); scheduleFilter(); });
  fTipoPagamento?.addEventListener('input', () => { filters.fattura_tipo_pagamento = fTipoPagamento.value.trim(); scheduleFilter(); });
  fPaid?.addEventListener('change', () => { filters.paid = fPaid.value; loadSignatures(1); });
  fClear?.addEventListener('click', () => {
    if (fId) fId.value = '';
    if (fTitolare) fTitolare.value = '';
    if (fEmail) fEmail.value = '';
    if (fRecapito) fRecapito.value = '';
    if (fData) fData.value = '';
    if (fFattura) fFattura.value = '';
    if (fInvio) fInvio.value = '';
    if (fPaid) fPaid.value = '';
    filters.id = '';
    filters.titolare = '';
    filters.email = '';
    filters.recapito_telefonico = '';
    filters.data_emissione = '';
    filters.fattura_numero = '';
    filters.fattura_tipo_pagamento = '';
    filters.emesso_da = '';
    filters.paid = '';
    loadSignatures(1);
  });
  sigBody?.addEventListener('click', async (e) => {
    const tgl = e.target.closest('button[data-action="toggle-paid"]');
    if (tgl) {
      const id = tgl.getAttribute('data-id');
      const current = tgl.getAttribute('data-paid') === '1' ? 1 : 0;
      const next = current ? 0 : 1;
      try {
        const res = await fetch(`/api/signatures/${encodeURIComponent(id)}/paid`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paid: next }) });
        if (!res.ok) throw new Error('Errore aggiornamento pagamento');
        await loadSignatures(sigPage);
      } catch (err) { console.error(err); }
      return;
    }
    const editBtn = e.target.closest('button[data-action="edit"]');
    if (editBtn) {
      const id = editBtn.getAttribute('data-id');
      if (id) { await openEditModalFor(id); }
      return;
    }
    const btn = e.target.closest('button[data-action="renewals"]'); if (!btn) return; const sigId = btn.getAttribute('data-sigid'); if (!sigId) return; loadRenewalsIntoModal(sigId);
  });

  // Renewals modal
  const modal = document.getElementById('modal-renewals');
  const renewalsBody = document.getElementById('renewals-body');
  const renewalsWrap = document.getElementById('renewals-table-wrap');
  const renewalsEmpty = document.getElementById('renewals-empty');
  const modalTitle = document.getElementById('modal-renewals-title');
  const openModal = () => { modal.classList.remove('hidden'); modal.setAttribute('aria-hidden', 'false'); };
  const closeModal = () => { modal.classList.add('hidden'); modal.setAttribute('aria-hidden', 'true'); };
    modal?.addEventListener('click', (e) => { const t = e.target; if (t && t.getAttribute('data-close') === 'true') closeModal(); });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!modal.classList.contains('hidden')) closeModal();
      if (editModal && !editModal.classList.contains('hidden')) closeEditModal();
    });
  async function loadRenewalsIntoModal(sigId) {
    modalTitle.textContent = `Rinnovi per ID ${sigId}`;
    renewalsBody.innerHTML = ''; renewalsEmpty.style.display = ''; renewalsWrap.style.display = 'none'; openModal();
    try {
      const res = await fetch(`/api/signatures/${encodeURIComponent(sigId)}/renewals`);
      if (!res.ok) throw new Error('Errore nel recupero dei rinnovi');
      const data = await res.json();
      const rows = Array.isArray(data.data) ? data.data : [];
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
  }
  document.getElementById('dashboard-view')?.addEventListener('click', (e) => { const btn = e.target.closest('button[data-action="renewals"]'); if (!btn) return; const sigId = btn.getAttribute('data-sigid'); if (!sigId) return; loadRenewalsIntoModal(sigId); });

  // Dashboard expiring
  let expPage = 1, expTotalPages = 1, expPageSize = expPageSizeSel ? (parseInt(expPageSizeSel.value, 10) || 5) : 5;
  async function loadExpiring(days = 15, page = expPage) {
    if (!expiringBody) return;
    try {
      const params = new URLSearchParams({ days: String(days), page: String(page), pageSize: String(expPageSize) });
      const res = await fetch(`/api/signatures/expiring?${params.toString()}`);
      if (!res.ok) throw new Error('Errore nel caricamento scadenze');
      const data = await res.json();
      const rows = Array.isArray(data.data) ? data.data : [];
      expPage = data.page || 1; expTotalPages = data.totalPages || 1; const total = typeof data.total === 'number' ? data.total : rows.length;
      expiringBody.innerHTML = rows.map((r) => {
        const actions = `<button class=\"icon-btn\" title=\"Vedi rinnovi\" data-action=\"renewals\" data-sigid=\"${r.id}\">&#8635;</button>`;
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
      if (expBadge) expBadge.textContent = String(total);
      if (expPageInfo) expPageInfo.textContent = `Pagina ${expPage} / ${expTotalPages}`;
      if (expPrevBtn) expPrevBtn.disabled = expPage <= 1; if (expNextBtn) expNextBtn.disabled = expPage >= expTotalPages;
    } catch (e) { console.error(e); if (expiringBody) expiringBody.innerHTML = `<tr><td colspan=\"7\">Errore nel caricamento delle scadenze</td></tr>`; }
  }
  expDaysSel?.addEventListener('change', () => { const d = parseInt(expDaysSel.value, 10) || 15; expPage = 1; loadExpiring(d, 1); });
  expPageSizeSel?.addEventListener('change', () => { expPageSize = parseInt(expPageSizeSel.value, 10) || 5; expPage = 1; const d = expDaysSel ? (parseInt(expDaysSel.value, 10) || 15) : 15; loadExpiring(d, 1); });
  expPrevBtn?.addEventListener('click', () => { if (expPage > 1) { const d = expDaysSel ? (parseInt(expDaysSel.value, 10) || 15) : 15; loadExpiring(d, expPage - 1); } });
  expNextBtn?.addEventListener('click', () => { if (expPage < expTotalPages) { const d = expDaysSel ? (parseInt(expDaysSel.value, 10) || 15) : 15; loadExpiring(d, expPage + 1); } });

  // Dashboard charts
  let yearlyChart, renewalsYearlyChart;
  const formatPercentage = (value) => {
    if (typeof value !== 'number' || Number.isNaN(value)) return '0%';
    const fixed = value.toFixed(2);
    return `${fixed.endsWith('.00') ? fixed.slice(0, -3) : fixed}%`;
  };
  const formatCount = (value) => {
    if (typeof value !== 'number' || Number.isNaN(value)) return '0';
    return value.toLocaleString('it-IT');
  };
  const formatStatLabel = (row, { includeTotal = false } = {}) => {
    const yearLabel = row.year == null ? 'Sconosciuto' : String(row.year);
    const pieces = [`${yearLabel}`, formatCount(row.count)];
    if (typeof row.percentage === 'number') {
      pieces.push(`(${formatPercentage(row.percentage)})`);
    }
    let text = pieces.join(' ');
    if (includeTotal && typeof row.total === 'number') {
      text += ` su ${formatCount(row.total)}`;
    }
    return text;
  };

  async function loadYearlyChart() {
    const canvas = document.getElementById('yearly-chart');
    if (!canvas || typeof Chart === 'undefined') return;
    try {
      const res = await fetch('/api/signatures/stats/yearly');
      if (!res.ok) throw new Error('Errore statistiche annuali');
      const json = await res.json();
      const rows = Array.isArray(json.data) ? json.data : [];
      const labels = rows.map(row => formatStatLabel(row));
      const data = rows.map(row => row.count || 0);
      const colors = labels.map((_, i) => `hsl(${(i * 47) % 360} 70% 60%)`);
      if (yearlyChart) yearlyChart.destroy();
      yearlyChart = new Chart(canvas.getContext('2d'), {
        type: 'pie',
        data: { labels, datasets: [{ data, backgroundColor: colors }] },
        options: {
          plugins: {
            legend: { position: 'bottom' },
            tooltip: {
              displayColors: false,
              callbacks: {
                title: (items) => {
                  const item = items?.[0];
                  if (!item) return '';
                  const row = rows[item.dataIndex];
                  const countText = formatCount(row.count || 0);
                  if (typeof row.percentage === 'number') {
                    return `${countText} (${formatPercentage(row.percentage)})`;
                  }
                  return countText;
                },
                label: () => '',
                afterLabel: () => ''
              }
            }
          }
        }
      });

      // No additional list rendering; chart labels already include counts and percentuali.
    } catch (e) { console.error(e); }
  }
  async function loadRenewalsYearlyChart() {
    const canvas = document.getElementById('renewals-yearly-chart');
    if (!canvas || typeof Chart === 'undefined') return;
    try {
      const res = await fetch('/api/signatures/stats/renewals/yearly');
      if (!res.ok) throw new Error('Errore statistiche rinnovi annuali');
      const json = await res.json();
      const rows = Array.isArray(json.data) ? json.data : [];
      const labels = rows.map(row => formatStatLabel(row));
      const data = rows.map(row => row.count || 0);
      const colors = labels.map((_, i) => `hsl(${(i * 67) % 360} 70% 60%)`);
      if (renewalsYearlyChart) renewalsYearlyChart.destroy();
      renewalsYearlyChart = new Chart(canvas.getContext('2d'), {
        type: 'pie',
        data: { labels, datasets: [{ data, backgroundColor: colors }] },
        options: {
          plugins: {
            legend: { position: 'bottom' },
            tooltip: {
              displayColors: false,
              callbacks: {
                title: (items) => {
                  const item = items?.[0];
                  if (!item) return '';
                  const row = rows[item.dataIndex];
                  const countText = formatCount(row.count || 0);
                  if (typeof row.percentage === 'number') {
                    return `${countText} (${formatPercentage(row.percentage)})`;
                  }
                  return countText;
                },
                label: () => '',
                afterLabel: () => ''
              }
            }
          }
        }
      });

      // No additional list rendering; chart labels already include counts and percentuali.
    } catch (e) { console.error(e); }
  }

  async function loadReportSummary() {
    if (!reportExpiringEl || !reportUnpaidEl) return;
    reportExpiringEl.textContent = '...';
    reportUnpaidEl.textContent = '...';
    try {
      const res = await fetch('/api/reports/summary');
      if (!res.ok) throw new Error('Errore report');
      const data = await res.json();
      const { expiringNext30, unpaidCount } = data || {};
      reportExpiringEl.textContent = formatCount(expiringNext30 ?? 0);
      reportUnpaidEl.textContent = formatCount(unpaidCount ?? 0);
    } catch (error) {
      console.error(error);
      reportExpiringEl.textContent = '—';
      reportUnpaidEl.textContent = '—';
    }
  }

  profileInfoForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!profileInfoForm) return;
    const fullName = profileFullNameInput ? profileFullNameInput.value.trim() : '';
    const avatarUrl = profileAvatarInput ? profileAvatarInput.value.trim() : '';
    setFormMessage(profileInfoMsg, 'Salvataggio...','info');
    try {
      const res = await fetch('/api/auth/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName, avatarUrl })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || 'Errore durante l\'aggiornamento del profilo.');
      app.currentUser = { ...app.currentUser, fullName, avatarUrl };
      applyAvatarUrl(avatarUrl);
      app.initPasswordToggles(profileView);
      setFormMessage(profileInfoMsg, 'Profilo aggiornato.','success');
    } catch (error) {
      console.error('Errore aggiornamento profilo:', error);
      setFormMessage(
        profileInfoMsg,
        error.message || 'Errore durante l\'aggiornamento del profilo.','error'
      );
    }
  });

  profilePasswordForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!profilePasswordForm) return;
    const currentPassword = profileCurrentPasswordInput ? profileCurrentPasswordInput.value : '';
    const newPassword = profileNewPasswordInput ? profileNewPasswordInput.value : '';
    const confirmPassword = profileConfirmPasswordInput ? profileConfirmPasswordInput.value : '';
    if (newPassword !== confirmPassword) {
      setFormMessage(profilePasswordMsg, 'Le password non coincidono.','error');
      return;
    }
    if (!newPassword || newPassword.length < 10) {
      setFormMessage(profilePasswordMsg, 'La nuova password deve contenere almeno 10 caratteri.','error');
      return;
    }
    setFormMessage(profilePasswordMsg, 'Aggiornamento password...','info');
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || 'Errore durante il cambio password.');
      setFormMessage(profilePasswordMsg, 'Password aggiornata correttamente.','success');
      if (profileCurrentPasswordInput) profileCurrentPasswordInput.value = '';
      if (profileNewPasswordInput) profileNewPasswordInput.value = '';
      if (profileConfirmPasswordInput) profileConfirmPasswordInput.value = '';
    } catch (error) {
      console.error('Errore cambio password:', error);
      setFormMessage(
        profilePasswordMsg,
        error.message || 'Errore durante il cambio password.','error'
      );
    }
  });

  app.initPasswordToggles(document);
  async function loadProfile() {
    if (!profileView) return;
    try {
      const res = await fetch('/api/auth/profile');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || 'Errore nel caricamento del profilo.');
      const fullName = data.fullName || '';
      const avatarUrl = data.avatarUrl || '';
      if (profileFullNameInput) profileFullNameInput.value = fullName;
      if (profileCurrentPasswordInput) profileCurrentPasswordInput.value = '';
      if (profileNewPasswordInput) profileNewPasswordInput.value = '';
      if (profileConfirmPasswordInput) profileConfirmPasswordInput.value = '';
      setFormMessage(profileInfoMsg, '');
      setFormMessage(profilePasswordMsg, '');
      app.currentUser = {
        ...app.currentUser,
        username: data.username || app.currentUser?.username || '',
        fullName,
        avatarUrl
      };
      applyAvatarUrl(avatarUrl);
      app.initPasswordToggles(profileView);
    } catch (error) {
      console.error('Errore profilo:', error);
      setFormMessage(
        profileInfoMsg,
        error.message || 'Errore nel caricamento del profilo.',
        'error'
      );
    }
  }

  // Insert view
  const insertForm = document.getElementById('insert-form');
  const siNextBtn = document.getElementById('si-nextid');
  const siResetBtn = document.getElementById('si-reset');
  const siMsg = document.getElementById('si-msg');
  const siSearch = document.getElementById('si-search');
  const siSuggest = document.getElementById('si-suggest');
  const siLoadId = document.getElementById('si-load-id');
  const siLoadBtn = document.getElementById('si-load-btn');
  const siIdInput = document.getElementById('si-id');
  const siEmessoInput = document.getElementById('si-emesso');
  const siReferenceInput = document.getElementById('si-ref-id');
  const insertAssetCheckboxes = Array.from(document.querySelectorAll('#insert-form input[data-asset-category]'));
  const editAssetCheckboxes = Array.from(document.querySelectorAll('#edit-form input[data-asset-category]'));
  const normalizeAssetCategory = (value) => (value ? String(value).trim().replace(/\\s+/g, '_').toUpperCase() : '');
  const normalizeAssetSubtype = (value) => (value ? String(value).trim().toUpperCase() : '');
  const TRUTHY_TOKENS = new Set(['1', 'true', 't', 'yes', 'y', 'si', 's', 'ok', 'x']);
  const FALSY_TOKENS = new Set(['0', 'false', 'f', 'no', 'n', 'off', 'null', 'undefined', '']);
  const isTruthyValue = (value) => {
    if (value === true) return true;
    if (value === false) return false;
    if (typeof value === 'number') return !Number.isNaN(value) && value !== 0;
    if (value == null) return false;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (FALSY_TOKENS.has(normalized)) return false;
      if (TRUTHY_TOKENS.has(normalized)) return true;
      const numeric = Number(normalized);
      if (!Number.isNaN(numeric)) return numeric !== 0;
      return true;
    }
    return Boolean(value);
  };
  const resetCheckboxes = (checkboxes) => { checkboxes.forEach((cb) => { if (cb) cb.checked = false; }); };
  const applyAssetsToCheckboxes = (checkboxes, assets) => {
    resetCheckboxes(checkboxes);
    if (!Array.isArray(assets)) return;
    assets.forEach((asset) => {
      if (!asset) return;
      const category = normalizeAssetCategory(asset.category);
      const subtype = normalizeAssetSubtype(asset.subtype);
      if (!category || !subtype) return;
      const checkbox = checkboxes.find((cb) => cb
        && normalizeAssetCategory(cb.getAttribute('data-asset-category')) === category
        && normalizeAssetSubtype(cb.value) === subtype);
      if (checkbox) {
        const rawValue = asset.has_item ?? asset.value ?? 1;
        checkbox.checked = isTruthyValue(rawValue);
      }
    });
  };
  const collectCheckboxAssets = (checkboxes) => {
    const selected = [];
    const seen = new Set();
    checkboxes.forEach((cb) => {
      if (!cb || !cb.checked) return;
      const category = normalizeAssetCategory(cb.getAttribute('data-asset-category'));
      const subtype = normalizeAssetSubtype(cb.value);
      if (!category || !subtype) return;
      const key = category + '::' + subtype;
      if (seen.has(key)) return;
      seen.add(key);
      selected.push({ category, subtype });
    });
    return selected;
  };
  let isEditingExisting = false;
  async function fetchNextId(force = false) {
    if (isEditingExisting && !force) return;
    try {
      const res = await fetch('/api/signatures/next-id');
      if (!res.ok) throw new Error('Errore calcolo prossimo ID');
      const data = await res.json();
      if (siIdInput) siIdInput.value = data.nextId;
    } catch (e) { console.error(e); }
  }
  const getInputEl = (id) => document.getElementById(id);
  const getTrimmedValue = (id) => {
    const el = getInputEl(id);
    if (!el) return '';
    if (typeof el.value === 'string') {
      const trimmed = el.value.trim();
      if (trimmed !== el.value) el.value = trimmed;
      return trimmed;
    }
    return el.value ?? '';
  };
  const getOptionalString = (id) => {
    const value = getTrimmedValue(id);
    return value === '' ? undefined : value;
  };
  const getOptionalNumber = (id) => {
    const el = getInputEl(id);
    if (!el) return undefined;
    const value = el.value;
    if (value === '') return undefined;
    const num = Number(value);
    return Number.isNaN(num) ? undefined : num;
  };
  const enterNewMode = () => {
    isEditingExisting = false;
    if (insertForm) insertForm.reset();
    if (siMsg) siMsg.textContent = '';
    resetCheckboxes(insertAssetCheckboxes);
    if (siSearch) siSearch.value = '';
    if (siSuggest) { siSuggest.classList.add('hidden'); siSuggest.innerHTML = ''; }
    if (siLoadId) siLoadId.value = '';
    if (siReferenceInput) siReferenceInput.value = '';
    if (siEmessoInput) siEmessoInput.value = 'A.F.';
    const paidEl = getInputEl('si-paid'); if (paidEl) paidEl.checked = false;
    if (siIdInput) { siIdInput.readOnly = true; siIdInput.value = ''; }
    if (siNextBtn) siNextBtn.disabled = false;
    fetchNextId(true);
  };
  function prepareInsertView() { enterNewMode(); }
  siNextBtn?.addEventListener('click', () => { if (isEditingExisting) return; fetchNextId(true); });
  siResetBtn?.addEventListener('click', () => {
    enterNewMode();
  });
  insertForm?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (siMsg) siMsg.textContent = '';
    const requiredFields = [
      { id: 'si-id', label: 'ID', type: 'number' },
      { id: 'si-titolare', label: 'Titolare', type: 'text' },
      { id: 'si-email', label: 'Email', type: 'email' },
      { id: 'si-recapito', label: 'Recapito', type: 'text' },
      { id: 'si-data', label: 'Data Emissione', type: 'date' },
      { id: 'si-costo', label: 'Costo (i.e.)', type: 'number' },
      { id: 'si-importo', label: 'Importo (i.e.)', type: 'number' },
    ];
    const invalidFields = [];
    requiredFields.forEach((field) => {
      const el = getInputEl(field.id);
      if (!el) return;
      const value = (typeof el.value === 'string') ? el.value.trim() : el.value;
      if (typeof el.value === 'string') el.value = value;
      const isEmpty = value === '' || value == null;
      if (isEmpty) { invalidFields.push(field); return; }
      if (field.type === 'number') {
        const num = Number(value);
        if (!Number.isFinite(num)) { invalidFields.push(field); return; }
      }
      if (field.type === 'email' && !el.checkValidity()) {
        invalidFields.push(field);
      }
    });
    if (invalidFields.length > 0) {
      if (siMsg) siMsg.textContent = `Compila i campi obbligatori: ${invalidFields.map((f) => f.label).join(', ')}.`;
      const firstInvalid = invalidFields[0];
      const el = getInputEl(firstInvalid.id);
      if (typeof el?.reportValidity === 'function') el.reportValidity();
      else el?.focus();
      return;
    }
    const payload = {
      id: (() => {
        const val = getOptionalNumber('si-id');
        return typeof val === 'number' ? Math.trunc(val) : undefined;
      })(),
      titolare: getTrimmedValue('si-titolare'),
      email: getTrimmedValue('si-email'),
      recapito_telefonico: getTrimmedValue('si-recapito'),
      data_emissione: getInputEl('si-data')?.value || undefined,
      emesso_da: getOptionalString('si-emesso'),
      fattura_numero: getOptionalString('si-fnum'),
      fattura_tipo_invio: getOptionalString('si-finvio'),
      costo_ie: getOptionalNumber('si-costo'),
      importo_ie: getOptionalNumber('si-importo'),
      paid: getInputEl('si-paid')?.checked ? 1 : 0,
    };
    const selectedAssets = collectCheckboxAssets(insertAssetCheckboxes);
    payload.assets = selectedAssets;
    try {
      const res = await fetch('/api/signatures', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out?.message || 'Errore durante salvataggio.');
      enterNewMode();
      if (siMsg) siMsg.textContent = `Salvato ID ${out.id}.`;
    } catch (e) { console.error(e); if (siMsg) siMsg.textContent = e.message || 'Errore.'; }
  });
  let siTimer;
  async function searchSignatures(q) {
    if (!siSuggest) return;
    const query = (q ?? '').trim();
    if (query.length < 2) {
      siSuggest.classList.add('hidden');
      siSuggest.innerHTML = '';
      return;
    }
    try {
      const res = await fetch(`/api/signatures/search?q=${encodeURIComponent(query)}&limit=20`);
      if (!res.ok) throw new Error('Errore ricerca');
      const json = await res.json();
      const list = Array.isArray(json.data) ? json.data : [];
      if (list.length === 0) {
        siSuggest.classList.add('hidden');
        siSuggest.innerHTML = '';
        return;
      }
      siSuggest.classList.remove('hidden');
      siSuggest.innerHTML = `<div class="suggest-list">${list.map(r => `<div class="suggest-item" data-id="${r.id}"><strong>${esc(r.titolare ?? '')}</strong> <small>(ID ${r.id})</small><br><span class="muted">${esc(r.email ?? '')}${r.recapito_telefonico ? ' � ' + esc(r.recapito_telefonico) : ''}</span></div>`).join('')}</div>`;
    } catch (err) {
      console.error(err);
    }
  }
  siSearch?.addEventListener('input', () => {
    clearTimeout(siTimer);
    siTimer = setTimeout(() => searchSignatures(siSearch.value), 250);
  });
  async function fetchSignature(id) {
    const res = await fetch(`/api/signatures/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error('Firma non trovata');
    const json = await res.json();
    return json.data || {};
  }
  siSuggest?.addEventListener('click', async (e) => {
    const item = e.target.closest('.suggest-item');
    if (!item) return;
    const id = item.getAttribute('data-id');
    if (!id) return;
    await loadSignatureIntoForm(id);
    siSuggest.classList.add('hidden');
  });
  document.addEventListener('click', (e) => {
    if (!siSuggest) return;
    if (!siSuggest.classList.contains('hidden') && !siSuggest.contains(e.target) && e.target !== siSearch) {
      siSuggest.classList.add('hidden');
    }
  });
  siLoadBtn?.addEventListener('click', async () => {
    const id = siLoadId?.value;
    if (!id) return;
    await loadSignatureIntoForm(id);
  });
  async function loadSignatureIntoForm(id) {
    try {
      const r = await fetchSignature(id);
      const setVal = (sel, v) => { const el = document.getElementById(sel); if (el) el.value = v ?? ''; };
      isEditingExisting = true;
      if (siNextBtn) siNextBtn.disabled = true;
      if (siIdInput) { siIdInput.readOnly = true; }
      setVal('si-titolare', r.titolare);
      setVal('si-email', r.email);
      setVal('si-recapito', r.recapito_telefonico);
      if (siReferenceInput) siReferenceInput.value = r.id ?? '';
      setVal('si-emesso', r.emesso_da ?? 'A.F.');
      setVal('si-fnum', r.fattura_numero);
      setVal('si-finvio', r.fattura_tipo_invio);
      setVal('si-costo', typeof r.costo_ie === 'number' ? r.costo_ie : (r.costo_ie ?? ''));
      setVal('si-importo', typeof r.importo_ie === 'number' ? r.importo_ie : (r.importo_ie ?? ''));
      setVal('si-data', r.data_emissione ? String(r.data_emissione).slice(0, 10) : '');
      applyAssetsToCheckboxes(insertAssetCheckboxes, Array.isArray(r.assets) ? r.assets : []);
      const paidEl = document.getElementById('si-paid'); if (paidEl) paidEl.checked = Boolean(r.paid);
      if (siMsg) siMsg.textContent = `Dati precompilati da ID ${r.id}. Modifica se necessario e salva.`;
    } catch (error) {
      console.error(error);
      if (siMsg) siMsg.textContent = error.message || 'Errore caricamento firma.';
    }
  }
  async function openEditModalFor(id) {
    if (!editForm) return;
    editingId = id;
    editForm.reset();
    Object.values(editFields).forEach((el) => { if (el) el.value = ''; });
    if (editMsg) editMsg.textContent = 'Caricamento...';
    try {
      const r = await fetchSignature(id);
      setFieldValue(editFields.titolare, r.titolare);
      setFieldValue(editFields.email, r.email);
      setFieldValue(editFields.recapito, r.recapito_telefonico);
      setFieldValue(editFields.data, r.data_emissione ? String(r.data_emissione).slice(0, 10) : '');
      setFieldValue(editFields.emesso, r.emesso_da ?? '');
      setFieldValue(editFields.fattura, r.fattura_numero);
      setFieldValue(editFields.invio, r.fattura_tipo_invio);
      setFieldValue(editFields.costo, typeof r.costo_ie === 'number' ? r.costo_ie : (r.costo_ie ?? ''));
      setFieldValue(editFields.importo, typeof r.importo_ie === 'number' ? r.importo_ie : (r.importo_ie ?? ''));
      applyAssetsToCheckboxes(editAssetCheckboxes, Array.isArray(r.assets) ? r.assets : []);
      if (editMsg) editMsg.textContent = '';
      openEditModal();
    } catch (error) {
      console.error(error);
      if (editMsg) editMsg.textContent = error.message || 'Errore nel caricamento dei dati.';
      editingId = null;
    }
  }
  editForm?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!editingId) { closeEditModal(); return; }
    if (editMsg) editMsg.textContent = '';
    const titolare = editFields.titolare?.value?.trim() || '';
    if (!titolare) { if (editMsg) editMsg.textContent = 'Il campo Titolare � obbligatorio.'; return; }
    const payload = {
      titolare,
      email: editFields.email?.value?.trim() || null,
      recapito_telefonico: editFields.recapito?.value?.trim() || null,
      data_emissione: editFields.data?.value || null,
      emesso_da: editFields.emesso?.value?.trim() || null,
      fattura_numero: editFields.fattura?.value?.trim() || null,
      fattura_tipo_invio: editFields.invio?.value?.trim() || null,
      costo_ie: editFields.costo?.value === '' ? null : Number(editFields.costo.value),
      importo_ie: editFields.importo?.value === '' ? null : Number(editFields.importo.value),
    };
    if (Number.isNaN(payload.costo_ie)) payload.costo_ie = null;
    if (Number.isNaN(payload.importo_ie)) payload.importo_ie = null;
    payload.assets = collectCheckboxAssets(editAssetCheckboxes);
    try {
      const res = await fetch(`/api/signatures/${encodeURIComponent(editingId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out?.message || 'Errore durante l\'aggiornamento.');
      closeEditModal();
      await loadSignatures(sigPage);
    } catch (error) {
      console.error(error);
      if (editMsg) editMsg.textContent = error.message || 'Errore durante l\'aggiornamento.';
    }
  });

  // Initial Dashboard
  if (insertForm) enterNewMode();
  const initialDays = expDaysSel ? (parseInt(expDaysSel.value, 10) || 15) : 15;
  loadExpiring(initialDays, 1);
  setupLiveReload();
  app.ensureSession();





