// Validazione e condivisione del seed. Modulo puro: nessun accesso a DOM o storage.
import { SEED_MAX, SEED_MIN } from './contracts';

export type SeedParseResult =
  | { ok: true; seed: number }
  | { ok: false; reason: 'empty' | 'not_integer' | 'out_of_range' };

/**
 * Accetta soltanto interi in base 10 compresi tra 0 e 1.000.000 (estremi inclusi).
 * Gli spazi esterni vengono ignorati; segni, decimali, esponenti e testo sono rifiutati.
 */
export function parseSeed(input: string): SeedParseResult {
  const s = String(input ?? '').trim();
  if (s === '') return { ok: false, reason: 'empty' };
  if (/^-\d+$/.test(s)) return { ok: false, reason: 'out_of_range' };
  if (!/^[0-9]+$/.test(s)) return { ok: false, reason: 'not_integer' };
  const digits = s.replace(/^0+(?=\d)/, '');
  if (digits.length > String(SEED_MAX).length) return { ok: false, reason: 'out_of_range' };
  const seed = Number(digits);
  if (seed < SEED_MIN || seed > SEED_MAX) return { ok: false, reason: 'out_of_range' };
  return { ok: true, seed };
}

/** Intero uniforme in [0, 1.000.000]. `rand` deve restituire valori in [0, 1). */
export function randomSeed(rand: () => number = Math.random): number {
  const r = rand();
  const u = Number.isFinite(r) ? Math.min(Math.max(r, 0), 0.9999999999999999) : 0;
  return SEED_MIN + Math.floor(u * (SEED_MAX - SEED_MIN + 1));
}

/** Legge `?seed=NNN` da una query string; null se assente o non valido. */
export function seedFromUrl(search: string): number | null {
  const q = String(search ?? '');
  const i = q.indexOf('?');
  const query = (i >= 0 ? q.slice(i + 1) : q).split('#')[0];
  let raw: string | null = null;
  try {
    raw = new URLSearchParams(query).get('seed');
  } catch {
    raw = null;
  }
  if (raw === null) return null;
  const r = parseSeed(raw);
  return r.ok ? r.seed : null;
}

/** Link che precompila il seed nella schermata introduttiva, senza avviare la partita. */
export function shareUrl(base: string, seed: number): string {
  const clean = String(base ?? '').split('#')[0].split('?')[0];
  const n = Math.min(SEED_MAX, Math.max(SEED_MIN, Math.trunc(Number.isFinite(seed) ? seed : 0)));
  return `${clean}?seed=${n}`;
}
