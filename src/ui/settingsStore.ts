// Persistenza locale delle preferenze (solo lingua e grafica). Non lancia mai eccezioni.
import { DEFAULT_SETTINGS } from '../core/contracts';
import type { GraphicsSettings, Lang, Settings } from '../core/contracts';

export const SETTINGS_KEY = 'ths.settings.v1';

export const LIMITS = {
  brightness: { min: 0.8, max: 1.25, step: 0.01 },
  renderScale: { min: 0.5, max: 1, step: 0.05 },
  drawDistance: { min: 200, max: 700, step: 10 },
} as const;

function num(v: unknown, lo: number, hi: number, def: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return def;
  return v < lo ? lo : v > hi ? hi : v;
}

/** Lingua predefinita dal browser: 'it*' → italiano, altrimenti inglese. */
export function detectLang(navLang?: string | null): Lang {
  return typeof navLang === 'string' && navLang.trim().toLowerCase().startsWith('it') ? 'it' : 'en';
}

function browserLang(): Lang {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.language === 'string') return detectLang(navigator.language);
  } catch {
    /* ambiente senza navigator */
  }
  return DEFAULT_SETTINGS.lang;
}

/** Valida qualsiasi valore e restituisce impostazioni complete e nei limiti. */
export function sanitizeSettings(raw: unknown, fallbackLang: Lang = DEFAULT_SETTINGS.lang): Settings {
  const d = DEFAULT_SETTINGS;
  const o = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const g = o.gfx !== null && typeof o.gfx === 'object' && !Array.isArray(o.gfx) ? (o.gfx as Record<string, unknown>) : {};
  const lang: Lang = o.lang === 'it' || o.lang === 'en' ? o.lang : fallbackLang;
  // Solo lingua e luminosità sono regolabili: tutto il resto è sempre al massimo, anche se in memoria
  // c'erano valori salvati da versioni precedenti.
  return {
    lang,
    gfx: {
      ...d.gfx,
      brightness: num(g.brightness, LIMITS.brightness.min, LIMITS.brightness.max, d.gfx.brightness),
    },
  };
}

/** Valori grafici associati a un preset; luminosità e nebbia restano quelle scelte dall'utente. */
export function applyQualityPreset(gfx: GraphicsSettings, quality: GraphicsSettings['quality']): GraphicsSettings {
  const p =
    quality === 'low'
      ? { renderScale: 0.6, shadows: false, antialias: false, drawDistance: 280 }
      : quality === 'high'
        ? { renderScale: 1, shadows: true, antialias: true, drawDistance: 600 }
        : { renderScale: 0.85, shadows: true, antialias: true, drawDistance: 420 };
  return { ...gfx, quality, ...p };
}

export function loadSettings(): Settings {
  const lang = browserLang();
  try {
    if (typeof localStorage === 'undefined') return sanitizeSettings(null, lang);
    const txt = localStorage.getItem(SETTINGS_KEY);
    if (!txt) return sanitizeSettings(null, lang);
    return sanitizeSettings(JSON.parse(txt), lang);
  } catch {
    return sanitizeSettings(null, lang);
  }
}

export function saveSettings(s: Settings): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(sanitizeSettings(s, s?.lang === 'en' ? 'en' : 'it')));
  } catch {
    /* storage non disponibile o pieno: le preferenze valgono solo per la sessione */
  }
}
