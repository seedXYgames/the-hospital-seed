// Struttura delle anomalie. Il catalogo è volutamente vuoto: le anomalie si decidono insieme a Ivan.
//
// Un'anomalia può manifestarsi:
//  - 'live'  solo dal vivo (il guardiano la vede con i suoi occhi, le telecamere no);
//  - 'cctv'  solo dalle telecamere (dal vivo non c'è nulla);
//  - 'both'  ovunque.
// Il renderer disegna ogni AnomalyView con la fabbrica registrata per il suo `kind` e la mette nello strato
// giusto (LAYER_LIVE, LAYER_CCTV o entrambi), così una stessa scena può mostrare cose diverse a schermi diversi.
import type { L10n, Vec3 } from '../core/contracts';
import { Rng, streamFor } from '../core/rng';
import type { Hospital } from '../world/hospital';

export type AnomalyVisibility = 'live' | 'cctv' | 'both';

/** Ciò che serve all'anomalia per decidere: dove sei, che ore sono, cosa guardi. */
export interface AnomalyContext {
  minute: number;
  player: { x: number; y: number; z: number; f: number; yaw: number };
  /** Telecamera attiva nella videosorveglianza, o null se il guardiano guarda con i suoi occhi. */
  cctvCam: string | null;
  powered(f: number): boolean;
  hospital: Hospital;
}

/** Una cosa da disegnare per conto di un'anomalia. */
export interface AnomalyView {
  id: string;
  /** Archetipo grafico: chiave della fabbrica di mesh nel renderer. */
  kind: string;
  pos: Vec3;
  yaw: number;
  visibility: AnomalyVisibility;
  params?: Record<string, number | string | boolean>;
}

/** Effetti globali che un'anomalia può chiedere (luci, suoni, porte…). */
export interface AnomalyEffects {
  sounds: { kind: string; pos?: Vec3; gain?: number }[];
  /** Porte da aprire o chiudere (id → stato). */
  doors: Record<string, boolean>;
  /** Moltiplicatore della luce per piano (1 normale). */
  flicker: Record<number, number>;
  /** Telecamere disturbate (id → 0..1). */
  camNoise: Record<string, number>;
}

export interface AnomalyInstance {
  readonly id: string;
  readonly def: string;
  readonly startedAt: number;
  ended: boolean;
  seenLive: boolean;
  seenCctv: boolean;
  update(dt: number, ctx: AnomalyContext, fx: AnomalyEffects): void;
  views(): AnomalyView[];
  /** Riga per il registro di fine turno. */
  chronicle(): { place: L10n; text: L10n };
}

export interface AnomalyDef {
  id: string;
  /** Peso relativo nell'estrazione. */
  weight: number;
  visibility: AnomalyVisibility;
  /** Finestra oraria in minuti dall'inizio del turno (0 = 22:00, 480 = 06:00). */
  window: [number, number];
  canStart(ctx: AnomalyContext): boolean;
  start(ctx: AnomalyContext, rng: Rng, id: string): AnomalyInstance;
}

/** Catalogo delle anomalie: vuoto finché non le definiamo. */
export const ANOMALY_CATALOG: AnomalyDef[] = [];

/** Decide quando e quali anomalie partono, in modo deterministico per seed. */
export class AnomalyDirector {
  private readonly rng: Rng;
  readonly active: AnomalyInstance[] = [];
  readonly past: AnomalyInstance[] = [];
  private readonly plan: { at: number; def: AnomalyDef }[] = [];
  private seq = 0;

  constructor(seed: number, catalog: AnomalyDef[] = ANOMALY_CATALOG) {
    this.rng = streamFor(seed, 'anomaly');
    if (!catalog.length) return;
    const n = this.rng.int(2, 5);
    for (let i = 0; i < n; i++) {
      const def = this.rng.weighted(catalog, (d) => d.weight);
      this.plan.push({ at: this.rng.range(def.window[0], def.window[1]), def });
    }
    this.plan.sort((a, b) => a.at - b.at);
  }

  update(dt: number, ctx: AnomalyContext): AnomalyEffects {
    const fx: AnomalyEffects = { sounds: [], doors: {}, flicker: {}, camNoise: {} };
    while (this.plan.length && this.plan[0].at <= ctx.minute) {
      const p = this.plan.shift()!;
      if (!p.def.canStart(ctx)) { p.at = ctx.minute + 10; if (p.at < p.def.window[1]) this.plan.push(p); this.plan.sort((a, b) => a.at - b.at); continue; }
      this.active.push(p.def.start(ctx, this.rng.fork(`a${this.seq}`), `anom-${++this.seq}`));
    }
    for (const a of this.active) a.update(dt, ctx, fx);
    for (let i = this.active.length - 1; i >= 0; i--) if (this.active[i].ended) this.past.push(...this.active.splice(i, 1));
    return fx;
  }

  views(): AnomalyView[] { return this.active.flatMap((a) => a.views()); }
  all(): AnomalyInstance[] { return [...this.past, ...this.active]; }
}
