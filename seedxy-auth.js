/**
 * SeedXY Games — Unified Account & Cloud Save System
 * Powered by Google Firebase (Auth + Cloud Firestore)
 * 1-Click Google Sign-In & GitHub Sign-In with Realtime Cloud Sync
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  GithubAuthProvider, 
  signOut, 
  onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { 
  getFirestore, 
  doc, 
  getDoc, 
  setDoc, 
  onSnapshot 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCqjKORWUioWuX308pgjl3UcYHFcDoKqWA",
  authDomain: "seedxy-games.firebaseapp.com",
  projectId: "seedxy-games",
  storageBucket: "seedxy-games.firebasestorage.app",
  messagingSenderId: "729097052879",
  appId: "1:729097052879:web:a1959498df0eb988a60dba"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const googleProvider = new GoogleAuthProvider();
const githubProvider = new GithubAuthProvider();

const TDS_KEY = 'tds.progress.v1';
const THS_KEY = 'ths.progress.v1';
const LS_USER = 'seedxy.user';

const GAME_ID = (() => {
  const p = (location.pathname + location.hostname + document.title).toLowerCase();
  if (p.includes('dark')) return 'the-dark-seed';
  if (p.includes('hospital')) return 'the-hospital-seed';
  return 'portal';
})();

// State
let currentUser = null;
let cloudData = null;
let panelOpen = false;
let unsubscribeFirestore = null;

// Helpers to merge local progress with cloud
function mergeProgress(localStr, cloudProg) {
  let local = null;
  try { local = localStr ? JSON.parse(localStr) : null; } catch { local = null; }
  if (!local && !cloudProg) return null;
  if (!local) return cloudProg;
  if (!cloudProg) return local;

  const merged = { ...local };
  merged.shifts = Math.max(local.shifts || 0, cloudProg.shifts || 0);
  merged.completed = Math.max(local.completed || 0, cloudProg.completed || 0);
  merged.unlocked = { ...(cloudProg.unlocked || {}), ...(local.unlocked || {}) };

  const seedSet = new Set([...(local.seeds || []), ...(cloudProg.seeds || [])]);
  merged.seeds = Array.from(seedSet).slice(-500);

  merged.seedPlays = { ...(cloudProg.seedPlays || {}) };
  for (const [k, v] of Object.entries(local.seedPlays || {})) {
    merged.seedPlays[k] = Math.max(merged.seedPlays[k] || 0, v);
  }

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

async function syncLocalWithCloud(docData) {
  if (!docData) return;
  cloudData = docData;

  // Dark Seed
  const mergedTDS = mergeProgress(localStorage.getItem(TDS_KEY), docData.tds);
  if (mergedTDS) {
    localStorage.setItem(TDS_KEY, JSON.stringify(mergedTDS));
  }

  // Hospital Seed
  const mergedTHS = mergeProgress(localStorage.getItem(THS_KEY), docData.ths);
  if (mergedTHS) {
    localStorage.setItem(THS_KEY, JSON.stringify(mergedTHS));
  }

  broadcastState();
}

async function uploadLocalToCloud() {
  if (!currentUser) return;
  try {
    let tds = null;
    let ths = null;
    try { tds = JSON.parse(localStorage.getItem(TDS_KEY) || 'null'); } catch {}
    try { ths = JSON.parse(localStorage.getItem(THS_KEY) || 'null'); } catch {}

    const payload = {
      user: {
        uid: currentUser.uid,
        name: currentUser.displayName || currentUser.email || 'Giocatore',
        email: currentUser.email || '',
        avatar: currentUser.photoURL || '',
      },
      updatedAt: Date.now(),
    };
    if (tds) payload.tds = tds;
    if (ths) payload.ths = ths;

    await setDoc(doc(db, "users", currentUser.uid), payload, { merge: true });
  } catch (err) {
    console.warn("SeedXY sync warning:", err);
  }
}

function broadcastState() {
  const detail = {
    isLoggedIn: !!currentUser,
    user: currentUser ? {
      uid: currentUser.uid,
      name: currentUser.displayName || currentUser.email || 'Giocatore',
      email: currentUser.email || '',
      avatar: currentUser.photoURL || '',
    } : null,
    tdsProgress: cloudData?.tds || (() => { try { return JSON.parse(localStorage.getItem(TDS_KEY)); } catch { return null; } })(),
    thsProgress: cloudData?.ths || (() => { try { return JSON.parse(localStorage.getItem(THS_KEY)); } catch { return null; } })(),
  };
  window.dispatchEvent(new CustomEvent('seedxy:state-changed', { detail }));
}

// Global API
const SeedXY = {
  async loginWithGoogle() {
    try {
      showToast('Autenticazione con Google…');
      const res = await signInWithPopup(auth, googleProvider);
      showToast('Benvenuto, ' + (res.user.displayName || res.user.email) + '!');
      togglePanel(false);
    } catch (err) {
      if (err.code === 'auth/unauthorized-domain') {
        showToast('⚠️ Dominio non autorizzato in Firebase Console');
      } else if (err.code !== 'auth/popup-closed-by-user') {
        showToast('⚠️ Errore: ' + (err.message || err.code));
      }
    }
  },

  async loginWithGithub() {
    try {
      showToast('Autenticazione con GitHub…');
      const res = await signInWithPopup(auth, githubProvider);
      showToast('Benvenuto, ' + (res.user.displayName || res.user.email) + '!');
      togglePanel(false);
    } catch (err) {
      if (err.code === 'auth/unauthorized-domain') {
        showToast('⚠️ Dominio non autorizzato in Firebase Console');
      } else if (err.code !== 'auth/popup-closed-by-user') {
        showToast('⚠️ Errore: ' + (err.message || err.code));
      }
    }
  },

  async logout() {
    try {
      await signOut(auth);
      localStorage.removeItem(LS_USER);
      showToast('Disconnesso da SeedXY');
      togglePanel(false);
    } catch (err) {
      console.error(err);
    }
  },

  async syncLocalProgress() {
    if (!currentUser) return;
    showToast('☁️ Sincronizzazione in corso…');
    await uploadLocalToCloud();
    showToast('✅ Sincronizzato con il Cloud Google!');
  },

  getUser() {
    return currentUser ? {
      name: currentUser.displayName || currentUser.email || 'Giocatore',
      avatar: currentUser.photoURL,
      email: currentUser.email
    } : null;
  },

  isLoggedIn() { return !!currentUser; },
  togglePanel(force) { togglePanel(force); },
};

window.SeedXY = SeedXY;

// Listen to Auth State
onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (user) {
    const uObj = {
      name: user.displayName || user.email || 'Giocatore',
      avatar: user.photoURL || '',
      email: user.email || ''
    };
    localStorage.setItem(LS_USER, JSON.stringify(uObj));

    // Listen to user document in Firestore
    if (unsubscribeFirestore) unsubscribeFirestore();
    try {
      const userDocRef = doc(db, "users", user.uid);
      unsubscribeFirestore = onSnapshot(userDocRef, async (snap) => {
        if (snap.exists()) {
          await syncLocalWithCloud(snap.data());
        } else {
          await uploadLocalToCloud();
        }
        refreshPanel();
      }, (err) => {
        console.warn("Firestore snapshot error:", err);
      });
    } catch (e) {
      console.warn("Firestore attach error:", e);
    }
  } else {
    localStorage.removeItem(LS_USER);
    if (unsubscribeFirestore) {
      unsubscribeFirestore();
      unsubscribeFirestore = null;
    }
    cloudData = null;
  }
  refreshPanel();
  broadcastState();
});

// Sync triggers on local game storage changes
window.addEventListener('storage', (e) => {
  if (e.key === TDS_KEY || e.key === THS_KEY) {
    if (currentUser) uploadLocalToCloud();
  }
});

// ── UI Modal & Panel ────────────────────────────────────────────────────────
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
    object-fit: cover;
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

  .sx-btn {
    display: flex; align-items: center; justify-content: center; gap: 10px;
    padding: 12px 16px; border-radius: 12px; border: none; cursor: pointer;
    font-size: 0.9rem; font-weight: 700; transition: opacity 0.15s, transform 0.1s;
    text-decoration: none; pointer-events: all; width: 100%;
  }
  .sx-btn:hover { opacity: 0.9; }
  .sx-btn:active { transform: scale(0.98); }
  
  .sx-btn-google {
    background: #ffffff;
    color: #1f1f1f;
    box-shadow: 0 4px 14px rgba(255,255,255,0.15);
  }
  
  .sx-btn-github {
    background: #24292f;
    color: #ffffff;
    border: 1px solid rgba(255,255,255,0.15);
  }

  .sx-btn-gen { background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.16); color: #fff; }
  .sx-btn-out { background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.6); }
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
  #seedxy-fab img { width: 32px; height: 32px; border-radius: 50%; object-fit: cover; }
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
  if (currentUser && currentUser.photoURL) {
    fab.innerHTML = `<img src="${currentUser.photoURL}" alt="User">`;
  } else {
    fab.innerHTML = `<span class="sx-fab-icon">🌱</span>`;
  }
}

function renderMainPanel() {
  const panel = document.getElementById('seedxy-panel');
  if (!panel) return;
  panel.className = panelOpen ? '' : 'hidden';
  if (!panelOpen) return;

  if (!currentUser) {
    panel.innerHTML = `
      <div class="sx-login-box">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div class="sx-login-title">SeedXY Passport</div>
          <button onclick="window.SeedXY.togglePanel(false)" style="background:none;border:none;color:rgba(255,255,255,0.4);cursor:pointer;font-size:1.2rem">&times;</button>
        </div>
        <div class="sx-login-desc">Sincronizza turni, record e trofei tra The Dark Seed e The Hospital Seed su qualsiasi dispositivo.</div>
        
        <button class="sx-btn sx-btn-google" onclick="window.SeedXY.loginWithGoogle()">
          <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/></svg>
          Accedi con Google
        </button>

        <button class="sx-btn sx-btn-github" onclick="window.SeedXY.loginWithGithub()">
          <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
          Accedi con GitHub
        </button>
      </div>`;
    return;
  }

  const tdsProg = cloudData?.tds || (() => { try { return JSON.parse(localStorage.getItem(TDS_KEY)); } catch { return null; } })();
  const thsProg = cloudData?.ths || (() => { try { return JSON.parse(localStorage.getItem(THS_KEY)); } catch { return null; } })();

  const tdsShifts = tdsProg?.completed ?? 0;
  const thsShifts = thsProg?.completed ?? 0;

  panel.innerHTML = `
    <div class="sx-panel-head">
      ${currentUser.photoURL ? `<img class="sx-avatar" src="${currentUser.photoURL}" alt="User">` : `<div class="sx-avatar-ph">👤</div>`}
      <div class="sx-panel-head-info">
        <div class="sx-user-name">${currentUser.displayName || currentUser.email}</div>
        <div class="sx-user-sub">${currentUser.email || 'Cloud Google Attivo ☁️'}</div>
      </div>
      <button onclick="window.SeedXY.togglePanel(false)" style="background:none;border:none;color:rgba(255,255,255,0.4);cursor:pointer;font-size:1.2rem">&times;</button>
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
        <span>Pattuglia a piedi:</span>
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
      <button class="sx-btn sx-btn-out" style="flex:1" onclick="window.SeedXY.logout()">Disconnetti</button>
    </div>`;
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

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', inject);
} else {
  inject();
}
