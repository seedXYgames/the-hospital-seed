// Eventi insoliti della notte, come in The Dark Seed: piccole cose che non tornano.
// Il seed decide quante, quali e quando; la prima arriva dopo un'ora tranquilla.
// Quando il guardiano ne percepisce una (la vede, la sente o la coglie dalle telecamere) si accende
// l'indicatore «Evento insolito» e parte la musica inquietante, che poi sfuma.
import type { L10n, Vec3 } from '../core/contracts';
import { Rng, clamp, streamFor } from '../core/rng';
import { BX0, BX1, ELEV, FLOORS, FLOOR_NAME, H, floorY, type Hospital } from '../world/hospital';
import type { AnomalyView } from './anomalies';

export type EventKind =
  | 'flicker' | 'door' | 'elevator' | 'ghost_call' | 'figure_cctv' | 'figure_live' | 'cab_figure'
  | 'steps' | 'whisper' | 'radio' | 'radio_cut' | 'silent_call' | 'knock' | 'cam_glitch';

const WEIGHTS: Record<EventKind, number> = {
  flicker: 3, door: 3, elevator: 2.5, ghost_call: 2, figure_cctv: 2.5, figure_live: 1.6, cab_figure: 1.2,
  steps: 2.5, whisper: 1.5, radio: 1.5, radio_cut: 2.2, silent_call: 1.2, knock: 2, cam_glitch: 1.5,
};

/** Ciò che serve agli eventi per agire sul turno, senza dipendere da tutta la classe Shift. */
export interface EventHost {
  readonly h: Hospital;
  minute: number;
  readonly player: { x: number; y: number; z: number; f: number; yaw: number; pitch: number };
  readonly doorOpen: Map<string, number>;
  readonly calls: Record<string, { assist: string; urgent: string }>;
  readonly ghostCalls: Set<string>;
  readonly cctv: { active: boolean; idx: number };
  radioOn: boolean;
  powered(f: number): boolean;
  callElevator(f: number): void;
  elevatorAt(): number | null;
  elevatorY(): number;
  inCab(): boolean;
  ringSilent(): void;
  canSee(p: Vec3, maxDist?: number): boolean;
  camSees(p: Vec3): boolean;
  camId(): string | null;
  sound(kind: string, pos?: Vec3, gain?: number): void;
  log(place: L10n, text: L10n, seen: boolean, strange: boolean): void;
}

interface Planned { at: number; kind: EventKind }
interface Live {
  id: number; kind: EventKind; start: number; end: number; f: number; pos: Vec3; seen: boolean; data?: string;
  t: number; step: number; place: L10n; text: L10n;
}

const L = (it: string, en: string): L10n => ({ it, en });

export interface Mood { active: boolean; intensity: number; watched: boolean; reason?: string }

export class EventDirector {
  private readonly rng: Rng;
  private readonly plan: Planned[] = [];
  private readonly live: Live[] = [];
  private seq = 0;
  private moodLevel = 0;
  private watchedT = 0;
  private reason = '';
  /** Sfarfallio delle luci per piano (1 normale). */
  readonly flicker: Record<number, number> = {};
  /** Disturbo per telecamera. */
  readonly camNoise: Record<string, number> = {};
  /** Distorsione della filodiffusione 0..1. */
  radioWarp = 0;
  /** La filodiffusione si zittisce da sola… */
  radioCut = false;
  /** …e poi riparte all'improvviso, più forte (moltiplicatore del volume). */
  radioBlast = 1;
  readonly done: { kind: EventKind; minute: number; seen: boolean }[] = [];

  constructor(seed: number) {
    this.rng = streamFor(seed, 'anomaly');
    const n = this.rng.int(7, 12);
    const kinds = Object.keys(WEIGHTS) as EventKind[];
    for (let i = 0; i < n; i++) {
      // più fitti dopo mezzanotte
      const u = this.rng.next();
      const at = 45 + Math.pow(u, 0.75) * 420;
      this.plan.push({ at, kind: this.rng.weighted(kinds, (k) => WEIGHTS[k]) });
    }
    this.plan.sort((a, b) => a.at - b.at);
  }

  update(dt: number, s: EventHost): void {
    while (this.plan.length && this.plan[0].at <= s.minute) {
      const p = this.plan.shift()!;
      if (!this.begin(p.kind, s)) { p.at = s.minute + 6; if (p.at < 470) { this.plan.push(p); this.plan.sort((a, b) => a.at - b.at); } }
    }
    for (const f of FLOORS) this.flicker[f] = 1;
    for (const k of Object.keys(this.camNoise)) this.camNoise[k] = 0;
    this.radioWarp = 0;
    this.radioCut = false;
    this.radioBlast = 1;
    for (const e of this.live) this.tick(e, dt, s);
    for (let i = this.live.length - 1; i >= 0; i--) {
      const e = this.live[i];
      if (s.minute >= e.end) {
        this.live.splice(i, 1);
        if (e.kind === 'ghost_call') { s.ghostCalls.delete(e.data!); if (s.calls[e.data!]) s.calls[e.data!].assist = 'off'; }
        this.done.push({ kind: e.kind, minute: e.start, seen: e.seen });
        s.log(e.place, e.text, e.seen, true);
      }
    }
    this.moodLevel = Math.max(0, this.moodLevel - dt / 26);
    this.watchedT = Math.max(0, this.watchedT - dt);
  }

  /** L'evento è stato percepito: si accende l'indicatore. */
  private perceive(e: Live, how: 'live' | 'cctv' | 'heard', watched = false): void {
    if (!e.seen) { e.seen = true; this.reason = `${e.kind} · ${how}`; }
    this.moodLevel = Math.min(1, Math.max(this.moodLevel, how === 'heard' ? 0.6 : 0.85) + 0.1);
    if (watched) this.watchedT = Math.max(this.watchedT, 6);
  }

  mood(): Mood {
    return { active: this.moodLevel > 0.04, intensity: clamp(this.moodLevel, 0, 1), watched: this.watchedT > 0, reason: this.reason };
  }

  views(): AnomalyView[] {
    const out: AnomalyView[] = [];
    for (const e of this.live) {
      if (e.kind === 'figure_cctv' || e.kind === 'figure_live' || e.kind === 'cab_figure') {
        if (e.kind === 'figure_live' && e.step >= 2) continue;
        out.push({ id: `ev-${e.id}`, kind: 'figure', pos: e.kind === 'cab_figure' ? { ...e.pos, y: e.pos.y } : e.pos, yaw: e.kind === 'cab_figure' ? Math.PI : e.pos.x > 0 ? -Math.PI / 2 : Math.PI / 2, visibility: e.kind === 'figure_live' ? 'live' : 'cctv' });
      }
    }
    return out;
  }

  /** Posizione della figura nella cabina (segue l'ascensore). */
  syncCab(y: number): void { for (const e of this.live) if (e.kind === 'cab_figure') e.pos = { x: ELEV.cx + 0.4, y, z: -4.0 }; }

  // ------------------------------------------------------------ avvio

  /** Solo sviluppo: fa partire subito un evento. */
  force(kind: EventKind, s: EventHost): boolean { return this.begin(kind, s); }

  private begin(kind: EventKind, s: EventHost): boolean {
    const r = this.rng, p = s.player, h = s.h;
    const mk = (f: number, pos: Vec3, minutes: number, place: L10n, text: L10n, data?: string): Live => {
      const e: Live = { id: ++this.seq, kind, start: s.minute, end: s.minute + minutes, f, pos, seen: false, data, t: 0, step: 0, place, text };
      this.live.push(e);
      return e;
    };
    const fName = (f: number) => FLOOR_NAME[f];
    const other = (): number => { const o = FLOORS.filter((f) => f !== p.f); return r.pick(o.length ? o : [...FLOORS]); };
    switch (kind) {
      case 'flicker': {
        const f = r.chance(0.65) ? p.f : other();
        if (!s.powered(f)) return false;
        mk(f, { x: 0, y: floorY(f) + 2.8, z: 0 }, 0.6 + r.next() * 0.6, fName(f), L('Le luci del corridoio sfarfallano.', 'The corridor lights flicker.'));
        return true;
      }
      case 'door': {
        const doors = h.doors.filter((d) => !d.locked && d.f === (r.chance(0.7) ? p.f : other()));
        if (!doors.length) return false;
        const d = r.pick(doors);
        const room = h.rooms.find((x) => x.id === d.room)!;
        const cur = (s.doorOpen.get(d.id) ?? 0) > 0.5;
        d.open = !cur;
        const pos = { x: (d.x0 + d.x1) / 2, y: floorY(d.f) + 1.2, z: d.z };
        s.sound(cur ? 'door_bang' : 'door_open', pos, 1);
        const e = mk(d.f, pos, 0.3, L(`${fName(d.f).it} · ${room.name.it}`, `${fName(d.f).en} · ${room.name.en}`), cur ? L('La porta sbatte. Non c\'è corrente d\'aria.', 'The door slams shut. There is no draught.') : L('La porta si apre da sola.', 'The door swings open by itself.'));
        if (p.f === d.f && Math.hypot(pos.x - p.x, pos.z - p.z) < 16) this.perceive(e, 'heard');
        return true;
      }
      case 'elevator': {
        if (!s.powered(FLOORS[0]) || s.inCab()) return false;
        const target = r.chance(0.6) ? p.f : other();
        if (s.elevatorAt() === target) return false;
        s.callElevator(target);
        mk(target, { x: ELEV.cx, y: floorY(target) + 1, z: -1.8 }, 2.5, L('Ascensore', 'Lift'), L(`L'ascensore sale al ${fName(target).it.toLowerCase()} senza che nessuno lo chiami.`, `The lift goes to the ${fName(target).en.toLowerCase()} with nobody calling it.`), String(target));
        return true;
      }
      case 'ghost_call': {
        const free = h.patients.filter((pt) => s.calls[pt.id].assist === 'off' && s.calls[pt.id].urgent === 'off');
        if (!free.length) return false;
        const pt = r.pick(free);
        s.calls[pt.id].assist = 'blink';
        s.ghostCalls.add(pt.id);
        s.sound('call_buzz', { x: -5.5, y: 0.9, z: 6.2 }, 0.8);
        mk(20, { x: -5.5, y: 0.9, z: 6.2 }, 4 + r.next() * 3, L(`Stanza ${pt.roomNumber}`, `Room ${pt.roomNumber}`), L('Il campanello suona. Il paziente dorme.', 'The call bell rings. The patient is asleep.'), pt.id);
        return true;
      }
      case 'figure_cctv': {
        const f = other();
        const x = r.range(BX0 + 2, BX1 - 1.5);
        mk(f, { x, y: floorY(f), z: r.range(-0.6, 0.6) }, 2 + r.next() * 2.5, L(`${fName(f).it} · corridoio`, `${fName(f).en} · corridor`), L('Una figura immobile in fondo al corridoio. Solo sulle telecamere.', 'A still figure at the end of the corridor. Only on the cameras.'));
        return true;
      }
      case 'figure_live': {
        if (s.inCab() || p.z < -1.6 || p.z > 1.6 && p.f !== 20) return false;
        // in fondo al corridoio, dalla parte opposta
        const x = p.x < 0 ? BX1 - 0.8 : BX0 + 0.8;
        if (Math.abs(x - p.x) < 8) return false;
        mk(p.f, { x, y: floorY(p.f), z: 0 }, 1.2, L(`${fName(p.f).it} · corridoio`, `${fName(p.f).en} · corridor`), L('Qualcuno in fondo al corridoio. Poi più nessuno.', 'Someone at the end of the corridor. Then nobody.'));
        return true;
      }
      case 'cab_figure': {
        if (s.inCab()) return false;
        mk(0, { x: ELEV.cx + 0.4, y: s.elevatorY(), z: -4.0 }, 1.5 + r.next() * 2, L('Ascensore', 'Lift'), L('Nella telecamera dell\'ascensore c\'è qualcuno. La cabina è vuota.', 'There is someone on the lift camera. The car is empty.'));
        return true;
      }
      case 'steps': {
        if (s.inCab()) return false;
        mk(p.f, { x: p.x, y: p.y, z: p.z }, 0.4, fName(p.f), L('Passi alle tue spalle.', 'Footsteps behind you.'));
        return true;
      }
      case 'whisper': {
        mk(p.f, { x: p.x, y: p.y + 1.6, z: p.z }, 0.2, fName(p.f), L('Un sussurro, vicinissimo.', 'A whisper, very close.'));
        return true;
      }
      case 'radio': {
        if (!s.radioOn || !s.powered(20)) return false;
        mk(20, { x: -0.25, y: 1.2, z: 7.1 }, 0.5, L('Filodiffusione', 'Music system'), L('La musica rallenta e si deforma, poi torna normale.', 'The music slows and warps, then goes back to normal.'));
        return true;
      }
      case 'radio_cut': {
        if (!s.radioOn || !s.powered(20)) return false;
        mk(20, { x: -0.25, y: 1.2, z: 7.1 }, 3 + r.next() * 3, L('Filodiffusione', 'Music system'), L('La musica si interrompe di colpo. Poi riparte, fortissima.', 'The music cuts out. Then it comes back, very loud.'));
        return true;
      }
      case 'silent_call': {
        s.ringSilent();
        mk(20, { x: -1, y: 0.9, z: 6.4 }, 3, L('Accettazione', 'Reception'), L('Il telefono squilla. Dall\'altra parte, solo un respiro.', 'The phone rings. On the other end, only breathing.'));
        return true;
      }
      case 'knock': {
        const closed = h.doors.filter((d) => d.locked);
        if (!closed.length) return false;
        const d = r.pick(closed);
        const room = h.rooms.find((x) => x.id === d.room)!;
        mk(d.f, { x: (d.x0 + d.x1) / 2, y: floorY(d.f) + 1.3, z: d.z }, 0.35, L(`${fName(d.f).it} · ${room.name.it}`, `${fName(d.f).en} · ${room.name.en}`), L('Qualcuno bussa dall\'interno di una stanza chiusa.', 'Someone knocks from inside a locked room.'));
        return true;
      }
      case 'cam_glitch': {
        const cams = h.cams.filter((c) => !c.inCab);
        const c = r.pick(cams);
        mk(c.f, { x: c.x, y: c.y, z: c.z }, 1.2, c.label, L('La telecamera si riempie di disturbi. L\'orario fa un salto.', 'The camera fills with static. The timestamp jumps.'), c.id);
        return true;
      }
    }
  }

  // ------------------------------------------------------------ svolgimento

  private tick(e: Live, dt: number, s: EventHost): void {
    e.t += dt;
    const p = s.player, near = (d: number) => p.f === e.f && Math.hypot(e.pos.x - p.x, e.pos.z - p.z) < d;
    switch (e.kind) {
      case 'flicker': {
        this.flicker[e.f] = Math.sin(e.t * 31) > 0.2 || Math.sin(e.t * 7.3) > 0.85 ? 0.15 : 1;
        if (p.f === e.f && !s.inCab() || s.cctv.active && s.camSees({ x: 0, y: floorY(e.f) + 1, z: 0 })) this.perceive(e, s.cctv.active ? 'cctv' : 'live');
        break;
      }
      case 'elevator': {
        if (s.elevatorAt() === Number(e.data) && near(9)) this.perceive(e, 'live');
        break;
      }
      case 'ghost_call': {
        if (p.f === 20 && Math.hypot(p.x + 3, p.z - 6) < 6) this.perceive(e, 'live');
        break;
      }
      case 'figure_cctv': {
        if (s.cctv.active && s.camSees({ x: e.pos.x, y: e.pos.y + 1.2, z: e.pos.z })) this.perceive(e, 'cctv', true);
        break;
      }
      case 'figure_live': {
        const head = { x: e.pos.x, y: e.pos.y + 1.4, z: e.pos.z };
        if (e.step === 0 && s.canSee(head, 22)) { e.step = 1; e.t = 0; this.perceive(e, 'live', true); }
        // sparisce appena distogli lo sguardo, o se ti avvicini
        if (e.step === 1 && (e.t > 1.2 && !s.canSee(head, 22) || near(6) || e.t > 9)) { e.step = 2; e.end = Math.min(e.end, s.minute + 0.05); }
        break;
      }
      case 'cab_figure': {
        if (s.cctv.active && s.camId() === s.h.cams.find((c) => c.inCab)?.id) this.perceive(e, 'cctv', true);
        break;
      }
      case 'steps': {
        // tre o quattro passi dietro di te, sempre alla stessa distanza
        if (e.step < 4 && e.t > 0.55 * e.step) {
          const bx = p.x - Math.sin(p.yaw) * 4, bz = p.z - Math.cos(p.yaw) * 4;
          s.sound('steps_far', { x: bx, y: p.y + 0.1, z: bz }, 0.9);
          e.step++;
          if (e.step === 2) this.perceive(e, 'heard');
        }
        break;
      }
      case 'whisper': {
        if (e.step === 0) { s.sound('whisper_anom', { x: p.x - Math.sin(p.yaw) * 0.8, y: p.y + 1.6, z: p.z - Math.cos(p.yaw) * 0.8 }, 1); e.step = 1; this.perceive(e, 'heard'); }
        break;
      }
      case 'radio': {
        this.radioWarp = Math.min(1, e.t / 3) * (0.6 + 0.4 * Math.sin(e.t * 2));
        if (s.radioOn && s.powered(p.f) && !s.inCab()) this.perceive(e, 'heard');
        break;
      }
      case 'radio_cut': {
        // silenzio per quasi tutto l'evento, poi qualche secondo a tutto volume
        const len = (e.end - e.start) * 3.75;
        if (e.t < len - 4) { this.radioCut = true; if (e.t > 1 && s.powered(p.f) && !s.inCab()) this.perceive(e, 'heard'); }
        else { this.radioBlast = 2.2; if (e.step === 0) { e.step = 1; s.sound('click', { x: -0.25, y: 1.2, z: 7.1 }, 1); } }
        break;
      }
      case 'silent_call': {
        if (p.f === 20 && Math.hypot(p.x + 1, p.z - 6.4) < 10) this.perceive(e, 'heard');
        break;
      }
      case 'knock': {
        if (e.step < 3 && e.t > e.step * 0.45) { s.sound('knock', e.pos, 1); e.step++; }
        if (near(14)) this.perceive(e, 'heard');
        break;
      }
      case 'cam_glitch': {
        this.camNoise[e.data!] = 0.8 + 0.2 * Math.sin(e.t * 9);
        if (s.cctv.active && s.camId() === e.data) this.perceive(e, 'cctv');
        break;
      }
      default: break;
    }
    void H;
  }
}
