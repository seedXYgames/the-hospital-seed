// Progressi e obiettivi, salvati nel browser.
import type { L10n } from '../core/contracts';
import type { Shift } from './shift';

export interface Achievement { id: string; name: L10n; desc: L10n; secret?: boolean; test(r: ShiftRecord, p: Progress): boolean }

export interface ShiftRecord {
  seed: number; completed: boolean; seconds: number; meters: number; done: number; late: number; missed: number;
  calls: number; blackouts: number; powerFixed: boolean; cctv: number; rides: number; radioOff: boolean; entranceLocked: boolean; patients: number;
}

export interface Progress {
  shifts: number; completed: number; seeds: number[]; seedPlays: Record<string, number>; recent: number[];
  unlocked: Record<string, { seed: number }>;
  totals: { seconds: number; longest: number; meters: number; tasks: number; calls: number; blackouts: number; cctv: number; rides: number };
}

const L = (it: string, en: string): L10n => ({ it, en });

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first', name: L('Solo per stanotte', 'Just for tonight'), desc: L('Completa il tuo primo turno.', 'Complete your first shift.'), test: (r) => r.completed },
  { id: 'perfect', name: L('Puntuale', 'Punctual'), desc: L('Completa un turno senza incarichi in ritardo o mancati.', 'Finish a shift with no late or missed tasks.'), test: (r) => r.completed && r.late === 0 && r.missed === 0 },
  { id: 'power', name: L('Sia la luce', 'Let there be light'), desc: L('Ripristina la corrente dopo un blackout.', 'Restore the power after a blackout.'), test: (r) => r.powerFixed },
  { id: 'eyes', name: L('Occhi ovunque', 'Eyes everywhere'), desc: L('Torna alle telecamere 25 volte in un turno.', 'Go back to the cameras 25 times in one shift.'), test: (r) => r.cctv >= 25 },
  { id: 'lift', name: L('Musica d\'attesa', 'Hold music'), desc: L('Prendi l\'ascensore 15 volte in un turno.', 'Ride the lift 15 times in one shift.'), test: (r) => r.rides >= 15 },
  { id: 'stairs', name: L('Fa bene al cuore', 'Good for the heart'), desc: L('Completa un turno senza mai prendere l\'ascensore.', 'Complete a shift without ever taking the lift.'), test: (r) => r.completed && r.rides === 0 },
  { id: 'silent', name: L('Silenzio, prego', 'Quiet, please'), desc: L('Spegni la filodiffusione.', 'Turn the music off.'), secret: true, test: (r) => r.radioOff },
  { id: 'walker', name: L('Diecimila passi', 'Ten thousand steps'), desc: L('Percorri 3 km in un turno.', 'Walk 3 km in one shift.'), test: (r) => r.meters >= 3000 },
  { id: 'full', name: L('Corsia piena', 'Full ward'), desc: L('Completa un turno con quattro ricoverati.', 'Complete a shift with four patients.'), test: (r) => r.completed && r.patients >= 4 },
  { id: 'veteran', name: L('Come Walter', 'Just like Walter'), desc: L('Completa dieci turni.', 'Complete ten shifts.'), test: (_r, p) => p.completed >= 10 },
];

const KEY = 'ths.progress.v1';

const fresh = (): Progress => ({
  shifts: 0, completed: 0, seeds: [], seedPlays: {}, recent: [], unlocked: {},
  totals: { seconds: 0, longest: 0, meters: 0, tasks: 0, calls: 0, blackouts: 0, cctv: 0, rides: 0 },
});

function store(): Storage | null { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } }

export function loadProgress(storage: Storage | null = store()): Progress {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return fresh();
    const p = JSON.parse(raw) as Progress;
    const f = fresh();
    return { ...f, ...p, totals: { ...f.totals, ...(p.totals ?? {}) } };
  } catch { return fresh(); }
}

export function saveProgress(p: Progress, storage: Storage | null = store()): void {
  try {
    storage?.setItem(KEY, JSON.stringify(p));
    if (typeof window !== 'undefined' && (window as any).SeedXY?.syncLocalProgress) {
      (window as any).SeedXY.syncLocalProgress().catch(() => {});
    }
  } catch { /* memoria del browser non disponibile */ }
}

export function recordOf(s: Shift): ShiftRecord {
  return {
    seed: s.seed, completed: s.endReason === 'handover', seconds: s.realTime, meters: s.player.meters,
    done: s.tasks.filter((t) => t.done !== null).length, late: s.tasks.filter((t) => t.done !== null && t.done > t.due).length,
    missed: s.tasks.filter((t) => t.done === null).length, calls: s.stats.calls, blackouts: s.stats.blackouts,
    powerFixed: s.tasks.some((t) => t.kind === 'power' && t.done !== null), cctv: s.stats.cctv, rides: s.stats.rides,
    radioOff: !s.radioOn, entranceLocked: true, patients: s.h.patients.length,
  };
}

/** Aggiorna i progressi con un turno e restituisce gli obiettivi sbloccati per la prima volta. */
export function recordShift(r: ShiftRecord, p: Progress): string[] {
  p.shifts++;
  if (r.completed) p.completed++;
  if (!p.seeds.includes(r.seed)) p.seeds.push(r.seed);
  p.seedPlays[String(r.seed)] = (p.seedPlays[String(r.seed)] ?? 0) + 1;
  p.recent = [r.seed, ...p.recent.filter((x) => x !== r.seed)].slice(0, 12);
  const t = p.totals;
  t.seconds += r.seconds; t.longest = Math.max(t.longest, r.seconds); t.meters += r.meters; t.tasks += r.done;
  t.calls += r.calls; t.blackouts += r.blackouts; t.cctv += r.cctv; t.rides += r.rides;
  const out: string[] = [];
  for (const a of ACHIEVEMENTS) if (!p.unlocked[a.id] && a.test(r, p)) { p.unlocked[a.id] = { seed: r.seed }; out.push(a.id); }
  return out;
}

export function rankOf(p: Progress): number { return p.completed >= 20 ? 4 : p.completed >= 10 ? 3 : p.completed >= 4 ? 2 : p.completed >= 1 ? 1 : 0; }

export function favouriteSeed(p: Progress): number | null {
  let best: number | null = null, n = 0;
  for (const [k, v] of Object.entries(p.seedPlays)) if (v > n) { n = v; best = Number(k); }
  return n > 1 ? best : null;
}
