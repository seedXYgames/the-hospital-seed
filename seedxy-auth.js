/**
 * SeedXY Games — Unified Account & Cloud Save System
 * GitHub Personal Token (Gist scope) + Private Gist Sync
 * 100% Client-Side, Zero-Backend, No CORS restrictions
 */
(function (global) {
  'use strict';

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
  let panelOpen = false;

  // ── GitHub API (fully supports CORS with access-control-allow-origin: *) ───
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
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || 'Errore GitHub API (' + res.status + ')');
    }
    return res.json();
  }

  // ── Local <-> Cloud Merge Helpers ───────────────────────────────────────
  function mergeProgress(localStr, cloudProg) {
    let local = null;
    try { local = localStr ? JSON.parse(localStr) : null; } catch { local = null; }
    if (!local && !cloudProg) return null;
    if (!local) return cloudProg;
    if (!cloudProg) return local;

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
      showToast('☁️ Sincronizzazione in corso...');
      await loadSave();
      await writeSave();
      showToast('✅ Sincronizzazione completata!');
    },

    async loginWithToken(inputToken) {
      const clean = (inputToken || '').trim();
      if (!clean) {
        showToast('⚠️ Inserisci un token valido');
        return false;
      }
      try {
        const testRes = await fetch('https://api.github.com/user', {
          headers: { 'Authorization': 'token ' + clean, 'Accept': 'application/vnd.github.v3+json' },
        });
        if (!testRes.ok) {
          throw new Error('Token non valido o scaduto (' + testRes.status + ')');
        }
        const u = await testRes.json();
        token = clean;
        user = { login: u.login, name: u.name || u.login, avatar: u.avatar_url };
        localStorage.setItem(LS_TOKEN, token);
        localStorage.setItem(LS_USER, JSON.stringify(user));
        
        await loadSave();
        refreshPanel();
        showToast('✅ Benvenuto, ' + (user.name || user.login) + '!');
        return true;
      } catch (err) {
        showToast('❌ ' + (err.message || 'Errore di autenticazione'));
        return false;
      }
    },

    getSave(gid)  { return saveData ? gameSlot(gid) : null; },
    getRawSave()  { return saveData; },
    getUser()     { return user; },
    isLoggedIn()  { return !!token; },
    login()       { togglePanel(true); },
    logout()      { logout(); },
    togglePanel(force) { togglePanel(force); },
  };

  global.SeedXY = SeedXY;

  function logout() {
    token = null; user = null; gistId = null; saveData = null;
    localStorage.removeItem(LS_TOKEN);
    localStorage.removeItem(LS_USER);
    localStorage.removeItem(LS_GIST);
    panelOpen = false;
    refreshPanel();
    broadcastState();
    showToast('Disconnesso da SeedXY');
  }

  // ── UI Modal & Panel ────────────────────────────────────────────────────
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
      background: rgba(10,10,24,0.97);
      border: 1px solid rgba(255,255,255,0.14);
      border-radius: 20px;
      width: 340px;
      max-height: 80vh;
      overflow-y: auto;
      pointer-events: all;
      backdrop-filter: blur(18px);
      box-shadow: 0 20px 50px rgba(0,0,0,0.7);
      transition: opacity 0.2s, transform 0.2s;
      scrollbar-width: thin;
      scrollbar-color: rgba(255,255,255,0.1) transparent;
    }
    #seedxy-panel.hidden { opacity: 0; transform: translateY(10px) scale(0.96); pointer-events: none; }

    .sx-panel-head {
      padding: 16px 20px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .sx-avatar {
      width: 44px; height: 44px;
      border-radius: 50%;
      border: 2px solid rgba(255,255,255,0.25);
      flex-shrink: 0;
    }
    .sx-avatar-ph {
      width: 44px; height: 44px;
      border-radius: 50%;
      background: linear-gradient(135deg, rgba(124,58,237,0.4), rgba(14,165,233,0.4));
      display: flex; align-items: center; justify-content: center;
      font-size: 22px; flex-shrink: 0;
    }
    .sx-user-name { color: #fff; font-weight: 700; font-size: 1rem; }
    .sx-user-sub  { color: rgba(255,255,255,0.45); font-size: 0.78rem; margin-top: 2px; }
    .sx-panel-head-info { flex: 1; min-width: 0; }

    .sx-section { padding: 16px 20px; }
    .sx-section + .sx-section { border-top: 1px solid rgba(255,255,255,0.06); }
    .sx-section-title {
      color: rgba(255,255,255,0.4);
      font-size: 0.72rem;
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
      font-size: 0.84rem;
      padding: 4px 0;
    }
    .sx-stat-val { color: #fff; font-weight: 600; }

    .sx-login-box { padding: 22px 20px; display: flex; flex-direction: column; gap: 14px; }
    .sx-login-title { color: #fff; font-weight: 800; font-size: 1.15rem; }
    .sx-login-desc  { color: rgba(255,255,255,0.55); font-size: 0.84rem; line-height: 1.5; }
    
    .sx-token-step {
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 12px;
      padding: 12px;
      font-size: 0.8rem;
      color: rgba(255,255,255,0.8);
      line-height: 1.5;
    }

    .sx-input {
      width: 100%;
      background: rgba(0,0,0,0.5);
      border: 1px solid rgba(255,255,255,0.18);
      border-radius: 10px;
      padding: 11px 14px;
      color: #fff;
      font-family: monospace;
      font-size: 0.85rem;
      outline: none;
      transition: border-color 0.2s;
    }
    .sx-input:focus { border-color: #38bdf8; }

    .sx-btn {
      display: flex; align-items: center; justify-content: center; gap: 8px;
      padding: 11px 16px; border-radius: 10px; border: none; cursor: pointer;
      font-size: 0.88rem; font-weight: 700; transition: opacity 0.15s, transform 0.1s;
      text-decoration: none;
      pointer-events: all;
    }
    .sx-btn:hover { opacity: 0.9; }
    .sx-btn:active { transform: scale(0.98); }
    .sx-btn-gen { background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.16); color: #fff; }
    .sx-btn-gen:hover { background: rgba(255,255,255,0.14); }
    .sx-btn-gh  { background: linear-gradient(135deg, #238636, #2ea043); color: #fff; }
    .sx-btn-out { background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.6); width: 100%; }
    .sx-btn-out:hover { background: rgba(255,80,80,0.15); color: #ff6b6b; }

    #seedxy-fab {
      width: 48px; height: 48px; border-radius: 50%;
      background: rgba(10,10,24,0.92);
      border: 1px solid rgba(255,255,255,0.18);
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; pointer-events: all;
      backdrop-filter: blur(12px);
      box-shadow: 0 8px 24px rgba(0,0,0,0.6);
      transition: transform 0.15s, border-color 0.15s;
      flex-shrink: 0;
    }
    #seedxy-fab:hover { transform: scale(1.08); border-color: rgba(255,255,255,0.35); }
    #seedxy-fab img { width: 32px; height: 32px; border-radius: 50%; }
    #seedxy-fab .sx-fab-icon { font-size: 22px; }

    #seedxy-toast {
      position: fixed; bottom: 84px; right: 24px;
      background: rgba(14,14,28,0.97);
      border: 1px solid rgba(255,255,255,0.18);
      border-radius: 12px; padding: 12px 18px;
      color: #fff; font-size: 0.88rem; font-weight: 500;
      z-index: 9999999; pointer-events: none;
      display: flex; align-items: center; gap: 10px;
      backdrop-filter: blur(14px);
      box-shadow: 0 10px 30px rgba(0,0,0,0.7);
      transition: opacity 0.25s, transform 0.25s;
      max-width: 340px;
    }
    #seedxy-toast.hidden { opacity: 0; transform: translateY(6px); }
  `;

  function inject() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.id = 'seedxy-root';

    const panel = document.createElement('div');
    panel.id = 'seedxy-panel';
    panel.className = 'hidden';
    root.appendChild(panel);

    const fab = document.createElement('div');
    fab.id = 'seedxy-fab';
    fab.setAttribute('title', 'SeedXY Passport');
    fab.onclick = () => togglePanel();
    root.appendChild(fab);

    const toast = document.createElement('div');
    toast.id = 'seedxy-toast';
    toast.className = 'hidden';
    document.body.appendChild(toast);

    document.body.appendChild(root);
    refreshPanel();
  }

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
          <div style="display:flex;align-items:center;justify-content:space-between">
            <div class="sx-login-title">SeedXY Passport</div>
            <button onclick="window.SeedXY.togglePanel(false)" style="background:none;border:none;color:rgba(255,255,255,0.4);cursor:pointer;font-size:1.1rem">&times;</button>
          </div>
          <div class="sx-login-desc">Sincronizza i tuoi progressi e sblocchi su tutti i tuoi dispositivi tramite un Gist privato nel tuo account GitHub.</div>
          
          <div class="sx-token-step">
            <strong>1. Genera il token (solo permessi Gist):</strong><br>
            <span style="color:rgba(255,255,255,0.5)">Si aprirà GitHub con la nota e il permesso <code>gist</code> già preselezionati. Scorri in fondo e premi <em>Generate token</em>.</span>
          </div>

          <a class="sx-btn sx-btn-gen" href="https://github.com/settings/tokens/new?description=SeedXY+Games+Passport&scopes=gist" target="_blank" rel="noopener">
            Genera Token su GitHub ↗
          </a>

          <div class="sx-token-step">
            <strong>2. Incolla il token generato:</strong>
            <div style="margin-top:8px">
              <input type="password" id="sx-token-input" class="sx-input" placeholder="ghp_..." autocomplete="off">
            </div>
          </div>

          <button class="sx-btn sx-btn-gh" id="sx-connect-btn">
            Collega Account
          </button>
        </div>`;

      const connectBtn = document.getElementById('sx-connect-btn');
      const input = document.getElementById('sx-token-input');
      
      const doConnect = async () => {
        connectBtn.textContent = 'Verifica in corso…';
        connectBtn.style.opacity = '0.7';
        const ok = await SeedXY.loginWithToken(input.value);
        if (ok) {
          refreshPanel();
        } else {
          connectBtn.textContent = 'Collega Account';
          connectBtn.style.opacity = '1';
        }
      };

      connectBtn.onclick = doConnect;
      input.onkeydown = (e) => { if (e.key === 'Enter') doConnect(); };
      return;
    }

    const tdsProg = saveData?.progress?.[TDS_KEY] || null;
    const thsProg = saveData?.progress?.[THS_KEY] || null;

    const tdsShifts = tdsProg?.completed ?? 0;
    const thsShifts = thsProg?.completed ?? 0;

    panel.innerHTML = `
      <div class="sx-panel-head">
        <img class="sx-avatar" src="${user.avatar}" alt="${user.login}">
        <div class="sx-panel-head-info">
          <div class="sx-user-name">${user.name}</div>
          <div class="sx-user-sub">@${user.login} · Sync Attivo ☁️</div>
        </div>
        <button onclick="window.SeedXY.togglePanel(false)" style="background:none;border:none;color:rgba(255,255,255,0.4);cursor:pointer;font-size:1.1rem">&times;</button>
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
          <span>Pattuglia percorsa:</span>
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

      <div class="sx-section" style="display:flex;gap:8px">
        <button class="sx-btn sx-btn-gen" style="flex:1" onclick="window.SeedXY.syncLocalProgress()">☁️ Sync</button>
        <button class="sx-btn sx-btn-out" style="flex:1" id="sx-logout-btn">Disconnetti</button>
      </div>`;

    document.getElementById('sx-logout-btn').onclick = logout;
  }

  function togglePanel(force) {
    panelOpen = typeof force === 'boolean' ? force : !panelOpen;
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

  async function boot() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
      return;
    }
    inject();
    if (token) {
      await loadSave();
      refreshPanel();
    }
    broadcastState();
  }

  boot();

})(window);
