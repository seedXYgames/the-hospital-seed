/**
 * SeedXY Games — Unified Account & Cloud Save System
 * GitHub Device Flow OAuth + Private Gist Sync
 * Shared across SeedXY Portal, The Dark Seed & The Hospital Seed
 */
(function (global) {
  'use strict';

  const CLIENT_ID   = 'Ov23lifPUyIXcBbrLEYf';
  const GIST_DESC   = 'seedxygames-saves';
  const LS_TOKEN    = 'seedxy.token';
  const LS_USER     = 'seedxy.user';
  const LS_GIST     = 'seedxy.gist_id';

  const TDS_KEY     = 'tds.progress.v1';
  const THS_KEY     = 'ths.progress.v1';

  const GAME_ID = (() => {
    const p = (location.pathname + location.hostname + document.title).toLowerCase();
    if (p.includes('dark')) return 'the-dark-seed';
    if (p.includes('hospital')) return 'the-hospital-seed';
    return 'portal';
  })();

  const GAME_LABEL = {
    'the-dark-seed':     '🌲 The Dark Seed',
    'the-hospital-seed': '🏥 The Hospital Seed',
    'portal':            '🌱 SeedXY Games Hub',
  };

  // ── State ───────────────────────────────────────────────────────────────
  let token     = localStorage.getItem(LS_TOKEN);
  let user      = JSON.parse(localStorage.getItem(LS_USER) || 'null');
  let gistId    = localStorage.getItem(LS_GIST);
  let saveData  = null;
  let pollTimer = null;
  let panelOpen = false;

  // ── GitHub API helpers ──────────────────────────────────────────────────
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

  // ── Local <-> Cloud Merge Helpers ───────────────────────────────────────
  function mergeProgress(localStr, cloudProg) {
    let local = null;
    try { local = localStr ? JSON.parse(localStr) : null; } catch { local = null; }
    if (!local && !cloudProg) return null;
    if (!local) return cloudProg;
    if (!cloudProg) return local;

    // Merge logic: take maximum counters, union unlocked achievements & seeds
    const merged = { ...local };
    merged.shifts = Math.max(local.shifts || 0, cloudProg.shifts || 0);
    merged.completed = Math.max(local.completed || 0, cloudProg.completed || 0);
    
    // Union unlocked
    merged.unlocked = { ...(cloudProg.unlocked || {}), ...(local.unlocked || {}) };

    // Union seeds & plays
    const seedSet = new Set([...(local.seeds || []), ...(cloudProg.seeds || [])]);
    merged.seeds = Array.from(seedSet).slice(-500);

    merged.seedPlays = { ...(cloudProg.seedPlays || {}) };
    for (const [k, v] of Object.entries(local.seedPlays || {})) {
      merged.seedPlays[k] = Math.max(merged.seedPlays[k] || 0, v);
    }

    // Totals
    const lt = local.totals || {};
    const ct = cloudProg.totals || {};
    merged.totals = {
      seconds: Math.max(lt.seconds || 0, ct.seconds || 0),
      meters: Math.max(lt.meters || 0, ct.meters || 0),
      longest: Math.max(lt.longest || 0, ct.longest || 0),
      tasks: Math.max(lt.tasks || 0, ct.tasks || 0),
      calls: Math.max(lt.calls || 0, ct.calls || 0),
      blackouts: Math.max(lt.blackouts || 0, ct.blackouts || 0),
      cctv: Math.max(lt.cctv || 0, ct.cctv || 0),
      rides: Math.max(lt.rides || 0, ct.rides || 0),
      deaths: Math.max(lt.deaths || 0, ct.deaths || 0),
      clues: Math.max(lt.clues || 0, ct.clues || 0),
      photos: Math.max(lt.photos || 0, ct.photos || 0),
      radio: Math.max(lt.radio || 0, ct.radio || 0),
      reports: Math.max(lt.reports || 0, ct.reports || 0),
      houses: Math.max(lt.houses || 0, ct.houses || 0),
    };

    return merged;
  }

  // ── Gist Storage & Sync ──────────────────────────────────────────────────
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
        catch { saveData = { v: 2, games: {}, progress: {} }; }
      } else {
        saveData = { v: 2, games: {}, progress: {} };
      }
    } catch {
      saveData = { v: 2, games: {}, progress: {} };
    }

    if (!saveData.progress) saveData.progress = {};
    if (!saveData.games) saveData.games = {};

    // Bidirectional sync with local progress
    let needSync = false;

    // Dark seed sync
    const mergedTDS = mergeProgress(localStorage.getItem(TDS_KEY), saveData.progress[TDS_KEY]);
    if (mergedTDS) {
      localStorage.setItem(TDS_KEY, JSON.stringify(mergedTDS));
      if (JSON.stringify(saveData.progress[TDS_KEY]) !== JSON.stringify(mergedTDS)) {
        saveData.progress[TDS_KEY] = mergedTDS;
        needSync = true;
      }
    }

    // Hospital seed sync
    const mergedTHS = mergeProgress(localStorage.getItem(THS_KEY), saveData.progress[THS_KEY]);
    if (mergedTHS) {
      localStorage.setItem(THS_KEY, JSON.stringify(mergedTHS));
      if (JSON.stringify(saveData.progress[THS_KEY]) !== JSON.stringify(mergedTHS)) {
        saveData.progress[THS_KEY] = mergedTHS;
        needSync = true;
      }
    }

    if (needSync) {
      await writeSave();
    }

    broadcastState();
    return saveData;
  }

  async function writeSave() {
    if (!token || !saveData) return;
    
    // Always refresh cloud progress copy with current localStorage
    try {
      const tdsLocal = localStorage.getItem(TDS_KEY);
      if (tdsLocal) saveData.progress[TDS_KEY] = JSON.parse(tdsLocal);
      const thsLocal = localStorage.getItem(THS_KEY);
      if (thsLocal) saveData.progress[THS_KEY] = JSON.parse(thsLocal);
    } catch {}

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
    broadcastState();
  }

  function gameSlot(gid = GAME_ID) {
    if (!saveData) return { achievements: [], stats: {} };
    return saveData.games[gid] || (saveData.games[gid] = { achievements: [], stats: {} });
  }

  function broadcastState() {
    const detail = {
      isLoggedIn: !!token,
      user,
      saveData,
      tdsProgress: saveData?.progress?.[TDS_KEY] || null,
      thsProgress: saveData?.progress?.[THS_KEY] || null,
    };
    window.dispatchEvent(new CustomEvent('seedxy:state-changed', { detail }));
  }

  // Hook localStorage updates from game engines
  window.addEventListener('storage', (e) => {
    if (e.key === TDS_KEY || e.key === THS_KEY) {
      if (saveData && token) {
        try {
          saveData.progress[e.key] = JSON.parse(e.newValue || '{}');
          writeSave();
        } catch {}
      }
    }
  });

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

    async syncLocalProgress() {
      if (!token) return;
      await loadSave();
      await writeSave();
    },

    getSave(gid) { return saveData ? gameSlot(gid) : null; },
    getRawSave() { return saveData; },
    getUser()    { return user; },
    isLoggedIn() { return !!token; },
    login()      { startLogin(); },
    logout()     { logout(); },
    togglePanel() { togglePanel(); },
  };

  global.SeedXY = SeedXY;

  // ── Auth Flow (GitHub Device Code) ──────────────────────────────────────
  async function startLogin() {
    setWidgetState('loading');
    let data;
    try {
      data = await ghDevice({ client_id: CLIENT_ID, scope: 'gist' });
    } catch {
      setWidgetState('error');
      showToast('⚠️ Errore connessione a GitHub');
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
        showToast('✅ Benvenuto, ' + (user?.name || user?.login) + '!');
      } else if (result.error === 'expired_token' || result.error === 'access_denied') {
        clearInterval(pollTimer); pollTimer = null;
        hideCodePanel();
        setWidgetState('idle');
        showToast('❌ Accesso annullato o scaduto');
      }
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
    broadcastState();
    showToast('Disconnesso da SeedXY');
  }

  // ── UI (FAB & Floating Panel) ────────────────────────────────────────────
  const CSS = `
    #seedxy-root * { box-sizing: border-box; margin: 0; padding: 0; font-family: system-ui, -apple-system, sans-serif; }

    #seedxy-root {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 999999;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 12px;
      pointer-events: none;
    }

    #seedxy-panel {
      background: rgba(10,10,22,0.96);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 18px;
      width: 320px;
      max-height: 75vh;
      overflow-y: auto;
      pointer-events: all;
      backdrop-filter: blur(16px);
      box-shadow: 0 16px 40px rgba(0,0,0,0.6);
      transition: opacity 0.2s, transform 0.2s;
      scrollbar-width: thin;
      scrollbar-color: rgba(255,255,255,0.1) transparent;
    }
    #seedxy-panel.hidden { opacity: 0; transform: translateY(8px) scale(0.97); pointer-events: none; }

    .sx-panel-head {
      padding: 16px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .sx-avatar {
      width: 44px; height: 44px;
      border-radius: 50%;
      border: 2px solid rgba(255,255,255,0.2);
      flex-shrink: 0;
    }
    .sx-avatar-ph {
      width: 44px; height: 44px;
      border-radius: 50%;
      background: linear-gradient(135deg, rgba(124,58,237,0.3), rgba(14,165,233,0.3));
      display: flex; align-items: center; justify-content: center;
      font-size: 22px; flex-shrink: 0;
    }
    .sx-user-name { color: #fff; font-weight: 700; font-size: 0.95rem; }
    .sx-user-sub  { color: rgba(255,255,255,0.45); font-size: 0.75rem; margin-top: 2px; }
    .sx-panel-head-info { flex: 1; min-width: 0; }

    .sx-section { padding: 14px 16px; }
    .sx-section + .sx-section { border-top: 1px solid rgba(255,255,255,0.06); }
    .sx-section-title {
      color: rgba(255,255,255,0.4);
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      margin-bottom: 10px;
      display: flex;
      justify-content: space-between;
    }

    .sx-stat-row {
      display: flex;
      justify-content: space-between;
      color: rgba(255,255,255,0.7);
      font-size: 0.82rem;
      padding: 3px 0;
    }
    .sx-stat-val { color: #fff; font-weight: 600; }

    .sx-ach {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 10px; border-radius: 10px;
      background: rgba(255,255,255,0.04);
      margin-bottom: 6px;
    }
    .sx-ach-icon { font-size: 20px; flex-shrink: 0; }
    .sx-ach-name { color: #e0e0f0; font-size: 0.82rem; font-weight: 500; }
    .sx-ach-date { color: rgba(255,255,255,0.3); font-size: 0.7rem; margin-top: 1px; }
    .sx-empty    { color: rgba(255,255,255,0.35); font-size: 0.82rem; }

    .sx-login-box { padding: 20px 16px; display: flex; flex-direction: column; gap: 12px; }
    .sx-login-title { color: #fff; font-weight: 800; font-size: 1.05rem; }
    .sx-login-desc  { color: rgba(255,255,255,0.5); font-size: 0.82rem; line-height: 1.5; }
    
    .sx-btn {
      display: flex; align-items: center; justify-content: center; gap: 8px;
      padding: 11px 16px; border-radius: 10px; border: none; cursor: pointer;
      font-size: 0.88rem; font-weight: 600; transition: opacity 0.15s, transform 0.1s;
      pointer-events: all;
    }
    .sx-btn:hover { opacity: 0.9; }
    .sx-btn:active { transform: scale(0.98); }
    .sx-btn-gh  { background: #238636; color: #fff; box-shadow: 0 4px 14px rgba(35,134,54,0.3); }
    .sx-btn-out { background: rgba(255,255,255,0.07); color: rgba(255,255,255,0.6); width: 100%; }
    .sx-btn-out:hover { background: rgba(255,80,80,0.15); color: #ff6b6b; }

    #seedxy-code-panel {
      background: rgba(10,10,22,0.98);
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 18px;
      padding: 22px;
      width: 320px;
      pointer-events: all;
      backdrop-filter: blur(16px);
      box-shadow: 0 16px 40px rgba(0,0,0,0.7);
    }
    #seedxy-code-panel.hidden { display: none; }
    .sx-code-title { color: #fff; font-weight: 800; font-size: 1.05rem; margin-bottom: 6px; }
    .sx-code-desc  { color: rgba(255,255,255,0.5); font-size: 0.82rem; line-height: 1.5; margin-bottom: 14px; }
    .sx-code-box {
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 12px;
      padding: 14px;
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 14px;
    }
    .sx-code { color: #fff; font-family: ui-monospace, monospace; font-size: 1.35rem; font-weight: 800; letter-spacing: 0.15em; }
    .sx-copy-btn {
      background: rgba(255,255,255,0.12); border: none; border-radius: 8px;
      color: rgba(255,255,255,0.8); font-size: 0.8rem; font-weight: 600; padding: 6px 10px;
      cursor: pointer; transition: background 0.15s;
    }
    .sx-copy-btn:hover { background: rgba(255,255,255,0.25); color: #fff; }
    .sx-open-btn {
      display: block; width: 100%; padding: 12px;
      background: #1f6feb; color: #fff; border: none;
      border-radius: 10px; font-size: 0.9rem; font-weight: 700;
      cursor: pointer; text-align: center; text-decoration: none;
      transition: opacity 0.15s; margin-bottom: 8px;
    }
    .sx-open-btn:hover { opacity: 0.9; }
    .sx-cancel-btn {
      display: block; width: 100%; padding: 8px;
      background: none; color: rgba(255,255,255,0.35); border: none;
      font-size: 0.82rem; cursor: pointer; text-align: center;
    }
    .sx-cancel-btn:hover { color: rgba(255,255,255,0.7); }
    .sx-pulse { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #3fb950; margin-right: 6px; animation: sx-blink 1.2s infinite; }
    @keyframes sx-blink { 0%,100%{opacity:1} 50%{opacity:.2} }

    #seedxy-fab {
      width: 48px; height: 48px; border-radius: 50%;
      background: rgba(10,10,22,0.92);
      border: 1px solid rgba(255,255,255,0.18);
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; pointer-events: all;
      backdrop-filter: blur(12px);
      box-shadow: 0 8px 24px rgba(0,0,0,0.5);
      transition: transform 0.15s, border-color 0.15s;
      flex-shrink: 0;
    }
    #seedxy-fab:hover { transform: scale(1.08); border-color: rgba(255,255,255,0.35); }
    #seedxy-fab img { width: 32px; height: 32px; border-radius: 50%; }
    #seedxy-fab .sx-fab-icon { font-size: 22px; }

    #seedxy-toast {
      position: fixed; bottom: 84px; right: 24px;
      background: rgba(12,12,24,0.96);
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 12px; padding: 12px 18px;
      color: #fff; font-size: 0.88rem; font-weight: 500;
      z-index: 9999999; pointer-events: none;
      display: flex; align-items: center; gap: 10px;
      backdrop-filter: blur(12px);
      box-shadow: 0 10px 30px rgba(0,0,0,0.6);
      transition: opacity 0.25s, transform 0.25s;
      max-width: 320px;
    }
    #seedxy-toast.hidden { opacity: 0; transform: translateY(6px); }
  `;

  function inject() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.id = 'seedxy-root';

    const codePanel = document.createElement('div');
    codePanel.id = 'seedxy-code-panel';
    codePanel.className = 'hidden';
    root.appendChild(codePanel);

    const panel = document.createElement('div');
    panel.id = 'seedxy-panel';
    panel.className = 'hidden';
    root.appendChild(panel);

    const fab = document.createElement('div');
    fab.id = 'seedxy-fab';
    fab.setAttribute('title', 'SeedXY Passport');
    fab.onclick = togglePanel;
    root.appendChild(fab);

    const toast = document.createElement('div');
    toast.id = 'seedxy-toast';
    toast.className = 'hidden';
    document.body.appendChild(toast);

    document.body.appendChild(root);
    refreshPanel();
  }

  let widgetState = 'idle';
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
          <div class="sx-login-title">SeedXY Passport</div>
          <div class="sx-login-desc">Accedi con GitHub per sincronizzare i salvataggi e gli obiettivi dei tuoi giochi tra tutti i browser e dispositivi.</div>
          <button class="sx-btn sx-btn-gh" id="sx-login-btn">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
            Accedi con GitHub
          </button>
        </div>`;
      document.getElementById('sx-login-btn').onclick = startLogin;
      return;
    }

    const tdsProg = saveData?.progress?.[TDS_KEY] || null;
    const thsProg = saveData?.progress?.[THS_KEY] || null;
    const slot = gameSlot();

    const tdsShifts = tdsProg?.completed ?? 0;
    const thsShifts = thsProg?.completed ?? 0;
    const totalAch = (Object.keys(tdsProg?.unlocked || {}).length) +
                     (Object.keys(thsProg?.unlocked || {}).length) +
                     (slot.achievements?.length || 0);

    panel.innerHTML = `
      <div class="sx-panel-head">
        <img class="sx-avatar" src="${user.avatar}" alt="${user.login}">
        <div class="sx-panel-head-info">
          <div class="sx-user-name">${user.name}</div>
          <div class="sx-user-sub">@${user.login} · Cloud Sync Attivo ☁️</div>
        </div>
      </div>

      <div class="sx-section">
        <div class="sx-section-title">
          <span>🌲 The Dark Seed</span>
          <span>${tdsShifts} turni</span>
        </div>
        <div class="sx-stat-row">
          <span>Trofei sbloccati:</span>
          <span class="sx-stat-val">${Object.keys(tdsProg?.unlocked || {}).length}</span>
        </div>
        <div class="sx-stat-row">
          <span>Distanza percorsa:</span>
          <span class="sx-stat-val">${((tdsProg?.totals?.meters || 0) / 1000).toFixed(1)} km</span>
        </div>
      </div>

      <div class="sx-section">
        <div class="sx-section-title">
          <span>🏥 The Hospital Seed</span>
          <span>${thsShifts} turni</span>
        </div>
        <div class="sx-stat-row">
          <span>Trofei sbloccati:</span>
          <span class="sx-stat-val">${Object.keys(thsProg?.unlocked || {}).length}</span>
        </div>
        <div class="sx-stat-row">
          <span>Pazienti curati:</span>
          <span class="sx-stat-val">${thsProg?.totals?.tasks || 0}</span>
        </div>
      </div>

      <div class="sx-section">
        <button class="sx-btn sx-btn-out" id="sx-logout-btn">Disconnetti Account</button>
      </div>`;

    document.getElementById('sx-logout-btn').onclick = logout;
  }

  function showCodePanel(code, url) {
    const panel = document.getElementById('seedxy-code-panel');
    if (!panel) return;
    panel.className = '';
    panel.innerHTML = `
      <div class="sx-code-title">Accedi a SeedXY</div>
      <div class="sx-code-desc">Inserisci il codice di verifica su GitHub per autorizzare il salvataggio sul tuo Gist privato.</div>
      <div class="sx-code-box">
        <span class="sx-code">${code}</span>
        <button class="sx-copy-btn" id="sx-copy-btn">Copia</button>
      </div>
      <a class="sx-open-btn" href="${url}" target="_blank" rel="noopener" id="sx-open-gh">
        Apri GitHub Device →
      </a>
      <div style="color:rgba(255,255,255,0.45);font-size:0.78rem;text-align:center;margin-bottom:12px;">
        <span class="sx-pulse"></span>In ascolto dell'autorizzazione…
      </div>
      <button class="sx-cancel-btn" id="sx-cancel-btn">Annulla</button>`;

    document.getElementById('sx-copy-btn').onclick = () => {
      navigator.clipboard.writeText(code).then(() => {
        document.getElementById('sx-copy-btn').textContent = 'Copiato!';
        setTimeout(() => {
          const b = document.getElementById('sx-copy-btn');
          if (b) b.textContent = 'Copia';
        }, 2000);
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

  // ── Auto Boot ───────────────────────────────────────────────────────────
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
    broadcastState();
  }

  boot();

})(window);
