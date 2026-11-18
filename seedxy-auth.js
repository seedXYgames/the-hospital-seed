/**
 * SeedXY Games — Account System
 * GitHub Device Flow OAuth + private Gist storage
 * Shared across The Dark Seed & The Hospital Seed
 */
(function (global) {
  'use strict';

  const CLIENT_ID   = 'Ov23lifPUyIXcBbrLEYf';
  const GIST_DESC   = 'seedxygames-saves';
  const LS_TOKEN    = 'seedxy.token';
  const LS_USER     = 'seedxy.user';
  const LS_GIST     = 'seedxy.gist_id';

  const GAME_ID = (() => {
    const p = location.pathname + location.hostname + document.title;
    if (p.includes('dark') || p.includes('DARK')) return 'the-dark-seed';
    if (p.includes('hospital') || p.includes('HOSPITAL')) return 'the-hospital-seed';
    return 'the-dark-seed';
  })();

  const GAME_LABEL = {
    'the-dark-seed':     '🌲 The Dark Seed',
    'the-hospital-seed': '🏥 The Hospital Seed',
  };

  // ── State ───────────────────────────────────────────────────────────────
  let token    = localStorage.getItem(LS_TOKEN);
  let user     = JSON.parse(localStorage.getItem(LS_USER) || 'null');
  let gistId   = localStorage.getItem(LS_GIST);
  let saveData = null;
  let pollTimer = null;
  let panelOpen = false;

  // ── GitHub helpers ──────────────────────────────────────────────────────
  async function ghOAuth(body) {
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
    });
    return res.json();
  }

  async function ghDevice(body) {
    const res = await fetch('https://github.com/login/device/code', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
    });
    return res.json();
  }

  async function ghAPI(path, opts = {}) {
    const res = await fetch('https://api.github.com' + path, {
      method: opts.method || 'GET',
      headers: {
        'Authorization': 'token ' + token,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 204) return null;
    return res.json();
  }

  // ── Gist storage ────────────────────────────────────────────────────────
  async function loadSave() {
    if (!token) return null;
    try {
      if (!gistId) {
        const gists = await ghAPI('/gists?per_page=100');
        const found = Array.isArray(gists) && gists.find(g => g.description === GIST_DESC);
        if (found) { gistId = found.id; localStorage.setItem(LS_GIST, gistId); }
      }
      if (gistId) {
        const gist = await ghAPI('/gists/' + gistId);
        try { saveData = JSON.parse(gist.files['saves.json'].content); }
        catch { saveData = { v: 1, games: {} }; }
      } else {
        saveData = { v: 1, games: {} };
      }
    } catch { saveData = { v: 1, games: {} }; }
    return saveData;
  }

  async function writeSave() {
    if (!token || !saveData) return;
    const content = JSON.stringify(saveData, null, 2);
    if (gistId) {
      await ghAPI('/gists/' + gistId, { method: 'PATCH', body: { files: { 'saves.json': { content } } } });
    } else {
      const res = await ghAPI('/gists', {
        method: 'POST',
        body: { description: GIST_DESC, public: false, files: { 'saves.json': { content } } },
      });
      if (res && res.id) { gistId = res.id; localStorage.setItem(LS_GIST, gistId); }
    }
  }

  function gameSlot() {
    if (!saveData) return { achievements: [], stats: {} };
    return saveData.games[GAME_ID] || (saveData.games[GAME_ID] = { achievements: [], stats: {} });
  }

  // ── Public API ──────────────────────────────────────────────────────────
  const SeedXY = {
    async unlock(id, label, icon = '🏆') {
      if (!token || !saveData) return false;
      const slot = gameSlot();
      if (slot.achievements.find(a => a.id === id)) return false;
      slot.achievements.push({ id, label, icon, ts: Date.now() });
      await writeSave();
      showToast(icon + '  ' + label);
      refreshPanel();
      return true;
    },

    async saveStats(stats) {
      if (!token || !saveData) return;
      Object.assign(gameSlot().stats, stats);
      await writeSave();
    },

    getSave()    { return saveData ? gameSlot() : null; },
    getUser()    { return user; },
    isLoggedIn() { return !!token; },
  };

  global.SeedXY = SeedXY;

  // ── Auth flow ───────────────────────────────────────────────────────────
  async function startLogin() {
    setWidgetState('loading');
    let data;
    try {
      data = await ghDevice({ client_id: CLIENT_ID, scope: 'gist' });
    } catch {
      setWidgetState('error');
      return;
    }
    if (!data.device_code) { setWidgetState('error'); return; }

    showCodePanel(data.user_code, data.verification_uri);

    const ms = (data.interval || 5) * 1000;
    pollTimer = setInterval(async () => {
      let result;
      try {
        result = await ghOAuth({
          client_id: CLIENT_ID,
          device_code: data.device_code,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        });
      } catch { return; }

      if (result.access_token) {
        clearInterval(pollTimer); pollTimer = null;
        token = result.access_token;
        localStorage.setItem(LS_TOKEN, token);
        hideCodePanel();
        setWidgetState('loading');
        await fetchUser();
        await loadSave();
        setWidgetState('idle');
        refreshPanel();
      } else if (result.error === 'expired_token' || result.error === 'access_denied') {
        clearInterval(pollTimer); pollTimer = null;
        hideCodePanel();
        setWidgetState('idle');
      }
      // authorization_pending → keep polling
    }, ms);
  }

  async function fetchUser() {
    const u = await ghAPI('/user');
    user = { login: u.login, name: u.name || u.login, avatar: u.avatar_url };
    localStorage.setItem(LS_USER, JSON.stringify(user));
  }

  function logout() {
    clearInterval(pollTimer);
    token = null; user = null; gistId = null; saveData = null;
    localStorage.removeItem(LS_TOKEN);
    localStorage.removeItem(LS_USER);
    localStorage.removeItem(LS_GIST);
    panelOpen = false;
    refreshPanel();
  }

  // ── UI ──────────────────────────────────────────────────────────────────
  const CSS = `
    #seedxy-root * { box-sizing: border-box; margin: 0; padding: 0; font-family: system-ui, -apple-system, sans-serif; }

    #seedxy-root {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 999999;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 10px;
      pointer-events: none;
    }

    /* ── Panel ── */
    #seedxy-panel {
      background: rgba(10,10,20,0.97);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 16px;
      width: 280px;
      max-height: 70vh;
      overflow-y: auto;
      pointer-events: all;
      backdrop-filter: blur(12px);
      transition: opacity 0.2s, transform 0.2s;
      scrollbar-width: thin;
      scrollbar-color: rgba(255,255,255,0.1) transparent;
    }
    #seedxy-panel.hidden { opacity: 0; transform: translateY(8px) scale(0.97); pointer-events: none; }

    .sx-panel-head {
      padding: 16px;
      border-bottom: 1px solid rgba(255,255,255,0.07);
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .sx-avatar {
      width: 40px; height: 40px;
      border-radius: 50%;
      border: 2px solid rgba(255,255,255,0.15);
      flex-shrink: 0;
    }
    .sx-avatar-ph {
      width: 40px; height: 40px;
      border-radius: 50%;
      background: rgba(255,255,255,0.08);
      display: flex; align-items: center; justify-content: center;
      font-size: 20px; flex-shrink: 0;
    }
    .sx-user-name { color: #fff; font-weight: 600; font-size: 0.9rem; }
    .sx-user-sub  { color: rgba(255,255,255,0.4); font-size: 0.75rem; margin-top: 2px; }
    .sx-panel-head-info { flex: 1; min-width: 0; }

    .sx-section { padding: 12px 16px; }
    .sx-section + .sx-section { border-top: 1px solid rgba(255,255,255,0.06); }
    .sx-section-title { color: rgba(255,255,255,0.4); font-size: 0.7rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 10px; }

    .sx-ach {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 10px; border-radius: 10px;
      background: rgba(255,255,255,0.04);
      margin-bottom: 6px;
    }
    .sx-ach-icon { font-size: 20px; flex-shrink: 0; }
    .sx-ach-name { color: #e0e0f0; font-size: 0.82rem; font-weight: 500; }
    .sx-ach-date { color: rgba(255,255,255,0.3); font-size: 0.7rem; margin-top: 1px; }
    .sx-empty    { color: rgba(255,255,255,0.3); font-size: 0.82rem; }

    /* ── Login section ── */
    .sx-login-box { padding: 16px; display: flex; flex-direction: column; gap: 10px; }
    .sx-login-title { color: #fff; font-weight: 700; font-size: 0.95rem; }
    .sx-login-desc  { color: rgba(255,255,255,0.4); font-size: 0.8rem; line-height: 1.5; }
    .sx-btn {
      display: flex; align-items: center; justify-content: center; gap: 8px;
      padding: 10px 16px; border-radius: 10px; border: none; cursor: pointer;
      font-size: 0.88rem; font-weight: 600; transition: opacity 0.15s;
      pointer-events: all;
    }
    .sx-btn:hover { opacity: 0.85; }
    .sx-btn-gh  { background: #238636; color: #fff; }
    .sx-btn-out { background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.6); width: 100%; }
    .sx-btn-out:hover { background: rgba(255,80,80,0.15); color: #ff6b6b; }

    /* ── Code panel ── */
    #seedxy-code-panel {
      background: rgba(10,10,20,0.98);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 16px;
      padding: 20px;
      width: 280px;
      pointer-events: all;
      backdrop-filter: blur(12px);
    }
    #seedxy-code-panel.hidden { display: none; }
    .sx-code-title { color: #fff; font-weight: 700; font-size: 0.95rem; margin-bottom: 6px; }
    .sx-code-desc  { color: rgba(255,255,255,0.45); font-size: 0.8rem; line-height: 1.5; margin-bottom: 14px; }
    .sx-code-box {
      background: rgba(255,255,255,0.07);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 10px;
      padding: 12px;
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 12px;
    }
    .sx-code { color: #fff; font-family: monospace; font-size: 1.3rem; font-weight: 700; letter-spacing: 0.15em; }
    .sx-copy-btn {
      background: rgba(255,255,255,0.1); border: none; border-radius: 6px;
      color: rgba(255,255,255,0.6); font-size: 0.75rem; padding: 4px 8px;
      cursor: pointer; transition: background 0.15s;
    }
    .sx-copy-btn:hover { background: rgba(255,255,255,0.2); }
    .sx-open-btn {
      display: block; width: 100%; padding: 10px;
      background: #1f6feb; color: #fff; border: none;
      border-radius: 10px; font-size: 0.88rem; font-weight: 600;
      cursor: pointer; text-align: center; text-decoration: none;
      transition: opacity 0.15s; margin-bottom: 8px;
    }
    .sx-open-btn:hover { opacity: 0.85; }
    .sx-cancel-btn {
      display: block; width: 100%; padding: 8px;
      background: none; color: rgba(255,255,255,0.3); border: none;
      font-size: 0.8rem; cursor: pointer; text-align: center;
    }
    .sx-cancel-btn:hover { color: rgba(255,255,255,0.6); }
    .sx-pulse { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #3fb950; margin-right: 6px; animation: sx-blink 1.2s infinite; }
    @keyframes sx-blink { 0%,100%{opacity:1} 50%{opacity:.3} }

    /* ── FAB ── */
    #seedxy-fab {
      width: 44px; height: 44px; border-radius: 50%;
      background: rgba(10,10,20,0.92);
      border: 1px solid rgba(255,255,255,0.15);
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; pointer-events: all;
      backdrop-filter: blur(10px);
      transition: transform 0.15s, border-color 0.15s;
      flex-shrink: 0;
    }
    #seedxy-fab:hover { transform: scale(1.08); border-color: rgba(255,255,255,0.3); }
    #seedxy-fab img { width: 28px; height: 28px; border-radius: 50%; }
    #seedxy-fab .sx-fab-icon { font-size: 20px; }

    /* ── Toast ── */
    #seedxy-toast {
      position: fixed; bottom: 80px; right: 20px;
      background: rgba(10,10,20,0.95);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 12px; padding: 12px 16px;
      color: #fff; font-size: 0.88rem; font-weight: 500;
      z-index: 9999999; pointer-events: none;
      display: flex; align-items: center; gap: 10px;
      backdrop-filter: blur(10px);
      transition: opacity 0.3s, transform 0.3s;
      max-width: 280px;
    }
    #seedxy-toast.hidden { opacity: 0; transform: translateY(6px); }
  `;

  function inject() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.id = 'seedxy-root';

    // Code panel (hidden by default)
    const codePanel = document.createElement('div');
    codePanel.id = 'seedxy-code-panel';
    codePanel.className = 'hidden';
    root.appendChild(codePanel);

    // Main panel (hidden by default)
    const panel = document.createElement('div');
    panel.id = 'seedxy-panel';
    panel.className = 'hidden';
    root.appendChild(panel);

    // FAB button
    const fab = document.createElement('div');
    fab.id = 'seedxy-fab';
    fab.setAttribute('title', 'SeedXY Account');
    fab.onclick = togglePanel;
    root.appendChild(fab);

    // Toast
    const toast = document.createElement('div');
    toast.id = 'seedxy-toast';
    toast.className = 'hidden';
    document.body.appendChild(toast);

    document.body.appendChild(root);
    refreshPanel();
  }

  // ── Render helpers ───────────────────────────────────────────────────────
  let widgetState = 'idle'; // idle | loading | error
  function setWidgetState(s) { widgetState = s; }

  function refreshPanel() {
    renderFAB();
    renderMainPanel();
  }

  function renderFAB() {
    const fab = document.getElementById('seedxy-fab');
    if (!fab) return;
    if (user && user.avatar) {
      fab.innerHTML = `<img src="${user.avatar}" alt="${user.login}">`;
    } else {
      fab.innerHTML = `<span class="sx-fab-icon">🌱</span>`;
    }
  }

  function renderMainPanel() {
    const panel = document.getElementById('seedxy-panel');
    if (!panel) return;
    panel.className = panelOpen ? '' : 'hidden';
    if (!panelOpen) return;

    if (!token || !user) {
      panel.innerHTML = `
        <div class="sx-login-box">
          <div class="sx-avatar-ph">🌱</div>
          <div class="sx-login-title">Account SeedXY</div>
          <div class="sx-login-desc">Accedi con GitHub per salvare progressi e sblocchi su tutti i tuoi dispositivi. Gratuito.</div>
          <button class="sx-btn sx-btn-gh" id="sx-login-btn">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
            Accedi con GitHub
          </button>
        </div>`;
      document.getElementById('sx-login-btn').onclick = startLogin;
      return;
    }

    const slot = gameSlot();
    const allGames = saveData ? Object.entries(saveData.games) : [];
    const totalAch = allGames.reduce((n, [, g]) => n + (g.achievements?.length || 0), 0);

    const achHTML = slot.achievements.length
      ? slot.achievements.slice().reverse().map(a => `
          <div class="sx-ach">
            <span class="sx-ach-icon">${a.icon}</span>
            <div>
              <div class="sx-ach-name">${a.label}</div>
              <div class="sx-ach-date">${new Date(a.ts).toLocaleDateString('it-IT')}</div>
            </div>
          </div>`).join('')
      : `<div class="sx-empty">Nessuno sblocco ancora.</div>`;

    panel.innerHTML = `
      <div class="sx-panel-head">
        <img class="sx-avatar" src="${user.avatar}" alt="${user.login}">
        <div class="sx-panel-head-info">
          <div class="sx-user-name">${user.name}</div>
          <div class="sx-user-sub">@${user.login} · ${totalAch} sblocchi totali</div>
        </div>
      </div>
      <div class="sx-section">
        <div class="sx-section-title">${GAME_LABEL[GAME_ID]}</div>
        ${achHTML}
      </div>
      <div class="sx-section">
        <button class="sx-btn sx-btn-out" id="sx-logout-btn">Disconnetti</button>
      </div>`;

    document.getElementById('sx-logout-btn').onclick = logout;
  }

  function showCodePanel(code, url) {
    const panel = document.getElementById('seedxy-code-panel');
    if (!panel) return;
    panel.className = '';
    panel.innerHTML = `
      <div class="sx-code-title">Accedi con GitHub</div>
      <div class="sx-code-desc">Inserisci questo codice su GitHub per autorizzare l'accesso.</div>
      <div class="sx-code-box">
        <span class="sx-code">${code}</span>
        <button class="sx-copy-btn" id="sx-copy-btn">Copia</button>
      </div>
      <a class="sx-open-btn" href="${url}" target="_blank" rel="noopener" id="sx-open-gh">
        Apri GitHub →
      </a>
      <div style="color:rgba(255,255,255,0.4);font-size:0.78rem;text-align:center;margin-bottom:10px;">
        <span class="sx-pulse"></span>In attesa di autorizzazione…
      </div>
      <button class="sx-cancel-btn" id="sx-cancel-btn">Annulla</button>`;

    document.getElementById('sx-copy-btn').onclick = () => {
      navigator.clipboard.writeText(code).then(() => {
        document.getElementById('sx-copy-btn').textContent = '✓';
      });
    };
    document.getElementById('sx-open-gh').onclick = () => {
      navigator.clipboard.writeText(code);
    };
    document.getElementById('sx-cancel-btn').onclick = () => {
      clearInterval(pollTimer); pollTimer = null;
      hideCodePanel();
      setWidgetState('idle');
    };
  }

  function hideCodePanel() {
    const panel = document.getElementById('seedxy-code-panel');
    if (panel) panel.className = 'hidden';
  }

  function togglePanel() {
    panelOpen = !panelOpen;
    renderMainPanel();
  }

  let toastTimer = null;
  function showToast(msg) {
    const t = document.getElementById('seedxy-toast');
    if (!t) return;
    t.textContent = msg;
    t.className = '';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'hidden'; }, 4000);
  }

  // ── Boot ────────────────────────────────────────────────────────────────
  async function boot() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
      return;
    }
    inject();
    if (token) {
      if (!user) await fetchUser();
      await loadSave();
      refreshPanel();
    }
  }

  boot();

})(window);
