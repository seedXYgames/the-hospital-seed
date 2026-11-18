// Il turno di notte: stato, tempo, movimento, interazioni, incarichi, corrente, ascensore, videosorveglianza.
// Logica pura e deterministica: niente Babylon, niente DOM. Stesso seed, stessa notte.
import type { L10n, Lang, Vec3 } from '../core/contracts';
import { Rng, clamp, streamFor } from '../core/rng';
import type { Aabb } from '../world/geom';
import {
  CEIL, ELEV, FLOORS, FLOOR_NAME, H, SPAWN, floorY, generateHospital, roomById, BASE_FLOOR, doorAabb, doorPoint,
  type Cam, type Hospital, type Obj, type Patient, type Room, type Santa, type Win,
} from '../world/hospital';
import { PatientMover } from './patients';
import {
  FALL_INTERCOM, GHOST_TASK_DONE, PATIENT_TALK_LATE, PHANTOM_NAMES, THINK, WALKING_TALK, ghostReveal, phantomAfter, phantomCall, walterCalls,
} from './horror';
import { PLAYER_R, SolidIndex, floorOf, groundAt, inShaft, inStairwell, rayAabb, raySphere, slide } from '../world/physics';
import { EventDirector, type EventHost, type Mood } from './events';
import { AnomalyDirector, type AnomalyEffects, type AnomalyView } from './anomalies';
import { Elevator } from './elevator';
import {
  ASSIST_REQ, COLLEAGUE_LATER, ITEM_NAME, L, LOGBOOK, NURSE_TALK, OPENING, PATIENT_TALK, RELAY_CALL, SENDER, THANKS, TREE_LINES,
  URGENT_REQ, URGENT_RESOLVED, VENDING_LINES, GHOST_LINES, MIDNIGHT_LINES, gL, pName, type Item,
} from './texts';
import { GUARD } from '../world/names';

export const SHIFT_START_H = 22;
export const SHIFT_LEN = 480;
/** Secondi reali per minuto di turno: otto ore in mezz'ora. */
export const REAL_S_PER_MIN = 3.75;
export const EYE = 1.62;
export const REACH = 2.4;
export const WALK = 1.7, RUN = 3.4;

export type Weather = { kind: 'snow' | 'rain' | 'sleet'; base: number };

export interface PlayerInput { forward: number; strafe: number; run: boolean; yaw: number; pitch: number }

export type TaskKind = 'assist' | 'urgent' | 'power' | 'patrol' | 'window' | 'camera' | 'midnight' | 'relay' | 'handover' | 'fall' | 'phantom' | 'batteries';

export interface Task {
  id: string;
  kind: TaskKind;
  issued: number;
  due: number;
  done: number | null;
  missed?: boolean;
  patient?: string;
  item?: Item;
  /** La richiesta è nota (interfono o al letto). */
  known?: boolean;
  floor?: number;
  target?: string;
  stamps?: string[];
  title: L10n;
  place: L10n;
  /** Fatto sul posto: resta da mandare il rapporto dal telefono. */
  reported?: boolean;
  report?: L10n;
}

export interface Message { id: number; from: L10n; text: L10n; at: number; read: boolean }
export interface Line { speaker: L10n; text: L10n; tts?: boolean }
export type CallState = 'off' | 'blink' | 'on';

export type SoundOut = { kind: string; pos?: Vec3; gain?: number };
export type LoopOut = { id: string; kind: string; pos?: Vec3; gain: number };

export interface ChronicleRow { minute: number; place: L10n; text: L10n; seen: boolean; strange: boolean }

export type Action =
  | 'open' | 'close' | 'locked' | 'cctv' | 'radio_on' | 'radio_off' | 'take_water' | 'take_blanket' | 'make_tea'
  | 'breaker_up' | 'breaker_down' | 'stamp' | 'close_window' | 'reset_cam' | 'give' | 'check' | 'tell' | 'talk'
  | 'answer' | 'ack_call' | 'call_elev' | 'floor_btn' | 'greet' | 'sit'
  | 'handover' | 'logbook' | 'vending' | 'tree' | 'take_batteries' | 'help_up' | 'empty_bed' | 'inspect' | 'light_on' | 'light_off';

export interface Focus { obj: Obj; action: Action; params: Record<string, string | number>; dist: number }

interface Ev { at: number; kind: TaskKind | 'colleague' | 'second_power' | 'courtesy' | 'ghost_reveal' | 'santa' | 'whisper_name' | 'walter_calls' | 'phantom_after' | 'lights'; data?: string; n?: number }

const r0 = (r: Rng, a: number, b: number): number => r.range(a, b);

export const fmtClock = (minute: number): string => {
  const m = Math.floor(SHIFT_START_H * 60 + minute) % (24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

export class Shift {
  readonly h: Hospital;
  readonly seed: number;
  lang: Lang;
  readonly index: SolidIndex;
  minute = 0;
  realTime = 0;
  readonly player: { x: number; z: number; y: number; yaw: number; pitch: number; f: number; meters: number } = { x: SPAWN.x, z: SPAWN.z, y: 0, yaw: SPAWN.yaw, pitch: 0, f: BASE_FLOOR, meters: 0 };
  carried: Item | null = null;
  torch = false;
  readonly power = { main: true, fl: { 20: true, 21: true, 22: true } as Record<number, boolean> };
  readonly elevator = new Elevator(BASE_FLOOR);
  readonly doorOpen = new Map<string, number>();
  readonly winOpen = new Map<string, boolean>();
  readonly camOffline = new Set<string>();
  radioOn = true;
  readonly cctv = { active: false, idx: 1 };
  readonly tasks: Task[] = [];
  readonly messages: Message[] = [];
  readonly calls: Record<string, { assist: CallState; urgent: CallState }> = {};
  readonly stamped = new Set<string>();
  phone: { ringing: boolean; since: number; patient: string | null } = { ringing: false, since: 0, patient: null };
  relay: Record<string, L10n> = {};
  readonly ghostCalls = new Set<string>();
  /** Orientamento delle telecamere mosse dal guardiano. */
  readonly camAim: Record<string, { yaw: number; pitch: number }> = {};
  readonly events: EventDirector;
  silentCall = false;
  /** Seduto alla postazione dell'accettazione. */
  seated = false;
  readonly chronicle: ChronicleRow[] = [];
  readonly stats = { cctv: 0, rides: 0, blackouts: 0, calls: 0, late: 0 };
  ended = false;
  endReason: 'handover' | 'timeout' | 'abandoned' | null = null;
  readonly weather: Weather;
  readonly anomalies: AnomalyDirector;
  anomalyFx: AnomalyEffects = { sounds: [], doors: {}, flicker: {}, camNoise: {} };
  /** I pazienti che vanno in bagno da soli. */
  readonly mover: PatientMover;
  /** Il paziente che non c'è più (un seed su tre circa non ce l'ha). */
  readonly ghost: { pid: string | null; revealed: boolean };
  /** Il Babbo Natale di plastica: dove sta adesso. */
  santa: Santa | null;
  private santaNoticed = true;
  /** Luci di cortesia (da mezzanotte). */
  courtesy = false;
  /** Pile della torcia: carica 0..1 e confezioni di ricambio. */
  torchCharge = 0.55;
  spares = 0;
  /** La chiamata dalla stanza vuota. */
  phantom: { room: string | null; name: string; armed: boolean; music: number; flick: number } = { room: null, name: '', armed: false, music: 0, flick: 0 };
  /** Interruttori delle stanze toccati (da te o da qualcos'altro); assente = automatico. */
  readonly switches = new Map<string, 'on' | 'off'>();
  private readonly thought = new Set<string>();
  private lastReact = -99;
  private readonly bedPos = new Map<string, { x: number; y: number; z: number }>();

  private readonly rng: Rng;
  private readonly trng: Rng;
  private readonly plan: Ev[] = [];
  private seq = 0;
  private msgSeq = 0;
  private stepAcc = 0;
  private bangT = 0;
  private colleagueN = 0;
  private readonly outSounds: SoundOut[] = [];
  private readonly outNotices: L10n[] = [];
  private readonly outLines: Line[] = [];
  private readonly outSteps: { surface: string; running: boolean }[] = [];
  private newMsgs = 0;
  private lastInCab = false;
  private readonly objById = new Map<string, Obj>();

  constructor(seed: number, lang: Lang = 'it') {
    this.seed = seed;
    this.lang = lang;
    this.h = generateHospital(seed);
    this.index = new SolidIndex(this.h.solids);
    for (const o of this.h.objs) this.objById.set(o.id, o);
    for (const d of this.h.doors) this.doorOpen.set(d.id, 0);
    for (const w of this.h.windows) this.winOpen.set(w.id, false);
    for (const p of this.h.patients) this.calls[p.id] = { assist: 'off', urgent: 'off' };
    this.rng = streamFor(seed, 'ui');
    this.trng = streamFor(seed, 'tasks');
    const wr = streamFor(seed, 'weather');
    const k = wr.next();
    this.weather = { kind: k < 0.55 ? 'snow' : k < 0.8 ? 'rain' : 'sleet', base: 0.35 + wr.next() * 0.6 };
    this.anomalies = new AnomalyDirector(seed);
    this.events = new EventDirector(seed);
    const grng = streamFor(seed, 'anomaly').fork('ghost');
    this.ghost = { pid: this.h.patients.length >= 2 && grng.chance(0.62) ? grng.pick(this.h.patients).id : null, revealed: false };
    this.mover = new PatientMover(this.h, seed, new Set(this.ghost.pid ? [this.ghost.pid] : []));
    this.santa = this.h.santa ? { ...this.h.santa } : null;
    for (const pt of this.h.patients) { const o = this.objById.get(`obj-${pt.id}`); if (o) this.bedPos.set(pt.id, { x: o.x, y: o.y, z: o.z }); }
    const vac = this.h.rooms.find((r) => r.kind === 'vacant');
    if (vac) this.phantom = { room: vac.id, name: grng.pick(PHANTOM_NAMES), armed: false, music: 0, flick: 0 };
    this.planNight();
    // la sostituzione: i messaggi di Walter e della centrale, con dove trovare le cose stanotte
    for (const m of OPENING) this.message(m.from, m.text, false);
    this.message(SENDER.colleague, this.whereIsText(), false);
    this.think('start', THINK.start, 2);
    // alcune porte di stanze vuote restano socchiuse
    const drng = streamFor(seed, 'decor');
    for (const d of this.h.doors) if (!d.locked && roomById(this.h, d.room)?.kind !== 'patient' && drng.chance(0.3)) this.doorOpen.set(d.id, 1);
    for (const d of this.h.doors) d.open = this.doorOpen.get(d.id)! > 0.5;
  }

  // ------------------------------------------------------------ pianificazione

  private planNight(): void {
    const r = this.trng;
    this.plan.push({ at: 118, kind: 'midnight' });
    this.plan.push({ at: r.range(25, 80), kind: 'patrol', data: String(r.pick([...FLOORS])) });
    this.plan.push({ at: r.range(200, 320), kind: 'patrol', data: String(r.pick([...FLOORS])) });
    // le chiamate dei pazienti
    for (const p of this.h.patients) {
      const n = r.int(1, 3);
      let t = r.range(12, 120);
      for (let i = 0; i < n && t < 450; i++) {
        if (r.chance(0.72)) this.plan.push({ at: t, kind: 'assist', data: `${p.id}|${r.pick(['water', 'blanket', 'tea'])}` });
        else this.plan.push({ at: t, kind: 'urgent', data: p.id });
        t += r.range(70, 160);
      }
    }
    this.plan.push({ at: r.range(150, 330), kind: 'power', data: r.chance(0.6) ? 'main' : String(r.pick([...FLOORS])) });
    if (r.chance(0.3)) this.plan.push({ at: r.range(360, 430), kind: 'power', data: String(r.pick([...FLOORS])) });
    if (r.chance(0.55)) {
      const wins = this.h.windows.filter((w) => this.objById.has(`obj-${w.id}`) && ['patient', 'chapel', 'waiting', 'vacant'].includes(roomById(this.h, w.room)?.kind ?? ''));
      if (wins.length) this.plan.push({ at: r.range(60, 400), kind: 'window', data: r.pick(wins).id });
    }
    if (r.chance(0.55)) {
      const cams = this.h.cams.filter((c) => c.box);
      this.plan.push({ at: r.range(90, 420), kind: 'camera', data: r.pick(cams).id });
    }
    if (this.h.patients.length && r.chance(0.65)) this.plan.push({ at: r.range(122, 200), kind: 'relay', data: r.pick(this.h.patients).id });
    this.plan.push({ at: 95, kind: 'colleague' }, { at: r.range(230, 290), kind: 'colleague' }, { at: 455, kind: 'colleague' });
    this.plan.push({ at: SHIFT_LEN, kind: 'handover' });
    // la notte che si guasta: luci di cortesia, il Babbo Natale che si sposta, il nome sussurrato
    this.plan.push({ at: 120, kind: 'courtesy' });
    if (this.ghost.pid) this.plan.push({ at: r.range(250, 320), kind: 'ghost_reveal' });
    if (this.phantom.room) this.plan.push({ at: r.range(140, 330), kind: 'phantom' });
    if (this.santa) for (let k = 0, n = r.int(2, 3); k < n; k++) this.plan.push({ at: r.range(150 + k * 90, 230 + k * 100), kind: 'santa' });
    this.plan.push({ at: r.range(200, 420), kind: 'whisper_name' });
    for (let k = 0, n = r.int(3, 5); k < n; k++) this.plan.push({ at: r.range(140 + k * 60, 200 + k * 70), kind: 'lights' });
    if (r.chance(0.75)) this.plan.push({ at: r.range(300, 430), kind: 'walter_calls' });
    this.plan.sort((a, b) => a.at - b.at);
  }

  private runPlan(): void {
    while (this.plan.length && this.plan[0].at <= this.minute) {
      const e = this.plan.shift()!;
      const busy = this.activeTasks().filter((t) => t.kind !== 'handover' && t.kind !== 'power').length;
      if (busy >= 3 && ['assist', 'patrol', 'window', 'camera'].includes(e.kind) && e.at < SHIFT_LEN - 30) {
        e.at = this.minute + 8;
        this.plan.push(e); this.plan.sort((a, b) => a.at - b.at);
        continue;
      }
      this.spawn(e);
    }
  }

  private newTask(kind: TaskKind, dueIn: number, title: L10n, place: L10n, extra: Partial<Task> = {}): Task {
    const t: Task = { id: `task-${++this.seq}`, kind, issued: this.minute, due: this.minute + dueIn, done: null, title, place, ...extra };
    this.tasks.push(t);
    return t;
  }

  private spawn(e: Ev): void {
    const h = this.h;
    switch (e.kind) {
      case 'colleague': {
        const txt = COLLEAGUE_LATER[this.colleagueN++];
        if (txt) this.message(SENDER.colleague, txt);
        return;
      }
      case 'midnight': {
        this.message(SENDER.hq, L('È mezzanotte. Walter passa sempre dai pazienti per gli auguri: fallo anche tu, anche se dormono.', 'It\'s midnight. Walter always visits the patients to wish them merry Christmas: do the same, even if they\'re asleep.'));
        this.newTask('midnight', 40, L('Fai gli auguri ai pazienti', 'Wish the patients merry Christmas'), L(`Stanze ${this.h.patients.map((p) => p.roomNumber).join(', ')}`, `Rooms ${this.h.patients.map((p) => p.roomNumber).join(', ')}`), { stamps: [] });
        return;
      }
      case 'patrol': {
        const f = Number(e.data);
        this.message(SENDER.hq, L(`Ronda: timbra i tre punti di controllo del ${FLOOR_NAME[f].it.toLowerCase()}.`, `Round: badge the three checkpoints on the ${FLOOR_NAME[f].en.toLowerCase()}.`));
        this.newTask('patrol', 90, L(`Ronda: ${FLOOR_NAME[f].it}`, `Round: ${FLOOR_NAME[f].en}`), FLOOR_NAME[f], { floor: f, stamps: [] });
        return;
      }
      case 'assist': case 'urgent': {
        const [pid, item] = (e.data ?? '').split('|');
        const p = h.patients.find((x) => x.id === pid);
        if (!p) return;
        if (this.activeTasks().some((t) => t.patient === pid && (t.kind === 'assist' || t.kind === 'urgent' || t.kind === 'fall')) || this.mover.state(pid) !== 'bed') { e.at = this.minute + 15; this.plan.push(e); this.plan.sort((a, b) => a.at - b.at); return; }
        const urgent = e.kind === 'urgent';
        this.calls[pid][urgent ? 'urgent' : 'assist'] = 'blink';
        this.stats.calls++;
        this.sound(urgent ? 'call_urgent' : 'call_buzz', this.panelPos(), 0.8);
        this.notice(L(`Chiamata ${urgent ? 'urgente ' : ''}dalla stanza ${p.roomNumber}`, `${urgent ? 'Urgent call' : 'Call'} from room ${p.roomNumber}`));
        this.newTask(e.kind, urgent ? 15 : 35,
          urgent ? L(`Urgenza nella stanza ${p.roomNumber}`, `Emergency in room ${p.roomNumber}`) : L(`Chiamata dalla stanza ${p.roomNumber}`, `Call from room ${p.roomNumber}`),
          this.placeOfPatient(p), { patient: pid, item: urgent ? undefined : item as Item, known: false });
        this.log(this.placeOfPatient(p), urgent ? L(`${pName(p).it} preme il pulsante rosso.`, `${pName(p).en} presses the red button.`) : L(`${pName(p).it} chiama per assistenza.`, `${pName(p).en} calls for help.`));
        return;
      }
      case 'power': {
        if (e.data === 'main') {
          this.power.main = false;
          const tr = this.trng;
          for (const f of FLOORS) if (tr.chance(0.4)) this.power.fl[f] = false;
        } else this.power.fl[Number(e.data)] = false;
        this.stats.blackouts++;
        this.sound('power_down', undefined, 1);
        if (e.data === 'main') this.think('blackout' + this.stats.blackouts, THINK.blackout, 1.2);
        const what = e.data === 'main' ? L('Blackout in tutto l\'ospedale', 'Blackout across the hospital') : L(`Senza corrente: ${FLOOR_NAME[Number(e.data)].it}`, `No power: ${FLOOR_NAME[Number(e.data)].en}`);
        this.notice(what);
        this.log(L('Quadro elettrico', 'Electrical panel'), e.data === 'main' ? L('Scatta l\'interruttore generale.', 'The main breaker trips.') : L(`Scatta l'interruttore del ${FLOOR_NAME[Number(e.data)].it.toLowerCase()}.`, `The ${FLOOR_NAME[Number(e.data)].en.toLowerCase()} breaker trips.`));
        this.message(SENDER.maint, L('Ho visto l\'allarme dal telefono: è scattato qualcosa al quadro. È nel seminterrato, stanza dei quadri elettrici, in fondo a sinistra uscendo dalle scale. Rialza prima il generale, poi quelli dei piani.', 'Got the alarm on my phone: something tripped at the panel. It\'s in the basement, electrical room, far left as you come off the stairs. Raise the main first, then the floor ones.'));
        if (!this.activeTasks().some((t) => t.kind === 'power')) this.newTask('power', 25, L('Ripristina la corrente', 'Restore the power'), L('Seminterrato · Quadri elettrici', 'Basement · Electrical room'));
        return;
      }
      case 'window': {
        const w = h.windows.find((x) => x.id === e.data);
        if (!w) return;
        this.winOpen.set(w.id, true);
        const r = roomById(h, w.room) as Room;
        this.message(SENDER.hq, L(`Sensore finestra aperta: ${this.placeOf(r).it.toLowerCase()}. Col vento, a quell'altezza, va chiusa subito.`, `Window sensor open: ${this.placeOf(r).en.toLowerCase()}. With this wind, at that height, it must be closed now.`));
        this.newTask('window', 30, L(`Chiudi la finestra: ${r.name.it}`, `Close the window: ${r.name.en}`), this.placeOf(r), { target: w.id });
        this.log(this.placeOf(r), L('Una finestra si apre col vento.', 'A window blows open.'));
        return;
      }
      case 'camera': {
        const c = h.cams.find((x) => x.id === e.data) as Cam;
        this.camOffline.add(c.id);
        this.notice(L(`CAM ${String(c.n).padStart(2, '0')}: segnale perso`, `CAM ${String(c.n).padStart(2, '0')}: signal lost`));
        this.newTask('camera', 60, L(`Riavvia la CAM ${String(c.n).padStart(2, '0')}`, `Reboot CAM ${String(c.n).padStart(2, '0')}`), L(`${c.label.it} · scatola sotto la telecamera`, `${c.label.en} · box under the camera`), { target: c.id, floor: c.f });
        this.log(c.label, L('La telecamera perde il segnale.', 'The camera loses signal.'));
        return;
      }
      case 'relay': {
        this.phone = { ringing: true, since: this.minute, patient: e.data ?? null };
        this.notice(L('Squilla il telefono della reception', 'The reception phone is ringing'));
        return;
      }
      case 'courtesy': {
        this.courtesy = true;
        this.message(SENDER.hq, L('Mezzanotte: si accendono le luci di cortesia in tutti i piani. Se ti serve vedere, usa la torcia.', 'Midnight: the courtesy lights come on across all floors. If you need to see, use the torch.'));
        this.think('courtesy', THINK.courtesy);
        this.sound('power_down', undefined, 0.35);
        return;
      }
      case 'ghost_reveal': {
        const p = h.patients.find((x) => x.id === this.ghost.pid);
        if (!p) return;
        this.ghost.revealed = true;
        this.message(SENDER.colleague, ghostReveal(p, p.roomNumber));
        this.log(this.placeOfPatient(p), L(`Walter racconta di ${pName(p).it}.`, `Walter tells you about ${pName(p).en}.`), true, true);
        // e il campanello continua a suonare
        this.plan.push({ at: this.minute + r0(this.trng, 18, 30), kind: 'urgent', data: p.id }, { at: this.minute + r0(this.trng, 60, 90), kind: 'assist', data: `${p.id}|blanket` });
        this.plan.sort((a, b) => a.at - b.at);
        return;
      }
      case 'phantom': {
        if (this.phone.ringing) { e.at = this.minute + 6; this.plan.push(e); this.plan.sort((a, b) => a.at - b.at); return; }
        this.phone = { ringing: true, since: this.minute, patient: 'phantom' };
        this.silentCall = false;
        this.notice(L('Squilla il telefono interno della reception', 'The internal phone at reception is ringing'));
        return;
      }
      case 'phantom_after': {
        const r = roomById(h, this.phantom.room ?? '');
        if (r) this.message(SENDER.hq, phantomAfter(r.number ?? 0));
        return;
      }
      case 'santa': { this.moveSanta(e); return; }
      case 'lights': {
        // una luce che si accende o si spegne da sola, vicino a te (a volte proprio dove sei)
        const p = this.player;
        if (this.cctv.active || this.seated) { e.at = this.minute + 6; this.plan.push(e); this.plan.sort((a, b) => a.at - b.at); return; }
        const here = this.roomOf(p.f, p.x, p.z);
        const near = h.rooms.filter((x) => x.f === p.f && x.kind !== 'lobby' && Math.hypot((x.x0 + x.x1) / 2 - p.x, (x.z0 + x.z1) / 2 - p.z) < 12);
        const r = here && here.kind !== 'lobby' && this.rng.chance(0.55) ? here : near.length ? this.rng.pick(near) : null;
        if (!r) return;
        const was = this.roomLevel(r.id);
        this.switches.set(r.id, was > 0 ? 'off' : 'on');
        const sw = this.obj(`switch-${r.id}`);
        this.sound('switch', sw ? { x: sw.x, y: sw.y, z: sw.z } : undefined, 0.8);
        const inside = here?.id === r.id;
        if (inside) this.think('lights' + this.minute.toFixed(0), was > 0 ? L('La luce si è spenta. Da sola. L\'interruttore è abbassato.', 'The light went off. By itself. The switch is down.') : L('Si è accesa la luce. Non ho toccato niente.', 'The light came on. I didn\'t touch anything.'), 0.4);
        this.log(this.placeOf(r), was > 0 ? L('La luce della stanza si spegne da sola.', 'The room light switches itself off.') : L('La luce della stanza si accende da sola.', 'The room light switches itself on.'), inside, true);
        return;
      }
      case 'whisper_name': {
        const p = this.player;
        if (this.cctv.active || this.seated) { e.at = this.minute + 5; this.plan.push(e); this.plan.sort((a, b) => a.at - b.at); return; }
        const back = { x: p.x - Math.sin(p.yaw) * 0.8, y: p.y + 1.6, z: p.z - Math.cos(p.yaw) * 0.8 };
        this.sound('whisper_anom', back, 0.9);
        this.line(L('…', '…'), L(`${GUARD.first}…`, `${GUARD.first}…`));
        this.think('whisper', THINK.whisper, 2.5);
        this.log(L(FLOOR_NAME[p.f].it, FLOOR_NAME[p.f].en), L('Una voce sussurra il nome del guardiano.', 'A voice whispers the guard\'s name.'), true, true);
        return;
      }
      case 'walter_calls': {
        this.message(SENDER.colleague, walterCalls(fmtClock(Math.max(10, this.minute - 70))));
        return;
      }
      case 'handover': {
        this.message(SENDER.hq, L('Sono le 6: il collega del turno di giorno è arrivato. Firma il registro in reception per chiudere il turno.', 'It\'s 6 o\'clock: the day shift has arrived. Sign the logbook at reception to close the shift.'));
        this.newTask('handover', 30, L('Firma il registro e passa le consegne', 'Sign the logbook and hand over'), L('Piano terra · Reception', 'Ground floor · Reception'));
        return;
      }
      default: return;
    }
  }

  // ------------------------------------------------------------ interrogazioni

  activeTasks(): Task[] { return this.tasks.filter((t) => t.done === null && !t.missed); }
  powered(f: number): boolean { return this.power.main && this.power.fl[f] !== false; }
  /** Luce di un piano: 1 piena, 0 luci di cortesia (dopo mezzanotte), -1 buio del blackout. */
  lightLevel(f: number): number { return !this.powered(f) ? -1 : this.courtesy ? 0 : 1; }
  /** Luce di una stanza: segue il piano, ma l'interruttore la può accendere o spegnere. */
  roomLevel(id: string): number {
    const r = roomById(this.h, id);
    if (!r) return 1;
    if (!this.powered(r.f)) return -1;
    const sw = this.switches.get(id);
    return sw === 'on' ? 1 : sw === 'off' ? 0 : this.courtesy ? 0 : 1;
  }
  /** Intensità della torcia (trema quando le pile sono quasi scariche). */
  torchPower(): number {
    if (!this.torch) return 0;
    const c = this.torchCharge;
    if (c > 0.15) return 0.75 + 0.25 * c;
    return (0.35 + c * 2) * (Math.sin(this.realTime * 37) > 0.6 - c * 4 ? 0.25 : 1);
  }
  toggleTorch(): boolean {
    if (!this.torch && this.torchCharge <= 0) { this.notice(L('La torcia è scarica: servono pile nuove.', 'The torch is dead: you need new batteries.')); return false; }
    this.torch = !this.torch;
    return true;
  }
  /** Cambia le pile con quelle di ricambio (tasto R). */
  swapBatteries(): boolean {
    if (this.spares <= 0) { this.notice(L('Non hai pile di ricambio.', 'You have no spare batteries.')); return false; }
    this.spares--; this.torchCharge = 1;
    this.sound('battery', undefined, 0.6);
    this.think('swap' + this.minute.toFixed(1), THINK.swap);
    return true;
  }
  /** Quanto la notte pesa addosso (0..1): sale dopo mezzanotte e con gli eventi. */
  dread(): number {
    const m = this.events.mood();
    return clamp(clamp((this.minute - 110) / 300, 0, 1) * 0.6 + (m.active ? m.intensity * 0.4 : 0) + (this.phantom.music > 0 ? 0.25 : 0), 0, 1);
  }
  /** Manda il rapporto di un incarico fatto. */
  report(taskId: string): void {
    const t = this.tasks.find((x) => x.id === taskId);
    if (!t || t.done === null || t.reported) return;
    t.reported = true;
    this.sound('report_sent', undefined, 0.5);
    this.log(L('Telefono', 'Phone'), L(`Rapporto inviato: ${t.title.it}.`, `Report sent: ${t.title.en}.`));
  }
  toReport(): Task[] { return this.tasks.filter((t) => t.done !== null && !t.reported && t.kind !== 'handover'); }
  clock(): string { return fmtClock(this.minute); }
  roomOf(f: number, x: number, z: number): Room | null {
    for (const r of this.h.rooms) if (r.f === f && x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return r;
    return null;
  }
  placeOf(r: Room): L10n { return L(`${FLOOR_NAME[r.f].it} · ${r.name.it}`, `${FLOOR_NAME[r.f].en} · ${r.name.en}`); }
  placeOfPatient(p: Patient): L10n { return this.placeOf(roomById(this.h, p.room) as Room); }
  inCab(): boolean { return inShaft(this.player.x, this.player.z); }
  cam(): Cam { return this.h.cams[this.cctv.idx - 1]; }
  obj(id: string): Obj | undefined { return this.objById.get(id); }

  /** Pulsanti della cabina: si muovono con lei. */
  cabButtons(): Obj[] {
    const y = this.elevator.y;
    return FLOORS.map((f, k) => ({ id: `cabbtn-${f}`, kind: 'elev_btn' as const, f: floorOf(y) as never, x: ELEV.x1 - 0.2, y: y + 1.0 + k * 0.13, z: -2.25, r: 0.05, room: 'cab', data: String(f) }));
  }

  /** Oggetti temporanei: le provette in reception. */
  dynamicObjs(): Obj[] {
    const out = this.cabButtons();
    if (this.santa) out.push({ id: 'santa', kind: 'santa', f: this.santa.f, x: this.santa.x, y: floorY(this.santa.f) + 1.4, z: this.santa.z, r: 0.5, room: 'corr' });
    return out;
  }

  /** Scatole che bloccano: porte chiuse, porte dell'ascensore, ingresso. */
  dynamicSolids(): Aabb[] {
    const out: Aabb[] = [];
    for (const d of this.h.doors) {
      if ((this.doorOpen.get(d.id) ?? 0) > 0.55) continue;
      out.push(doorAabb(d));
    }
    if (this.santa) { const y = floorY(this.santa.f); out.push({ x0: this.santa.x - 0.3, x1: this.santa.x + 0.3, y0: y, y1: y + 2, z0: this.santa.z - 0.3, z1: this.santa.z + 0.3 }); }
    const at = this.elevator.atFloor();
    for (const f of FLOORS) {
      if (at === f && this.elevator.door > 0.7) continue;
      const y = floorY(f);
      out.push({ x0: ELEV.doorX0, x1: ELEV.doorX1, y0: y, y1: y + 2.1, z0: -1.56, z1: -1.44 });
    }
    return out;
  }

  // ------------------------------------------------------------ ciclo

  update(dt: number, input: PlayerInput): void {
    if (this.ended) return;
    this.realTime += dt;
    this.minute += dt / REAL_S_PER_MIN;
    this.runPlan();
    while (this.pendingThoughts.length && this.pendingThoughts[0].at <= this.realTime) this.outLines.push({ speaker: L(GUARD.first, GUARD.first), text: this.pendingThoughts.shift()!.text, tts: true });
    const p = this.player;
    p.yaw = input.yaw; p.pitch = input.pitch;

    // movimento
    if (!this.cctv.active && !this.seated) {
      const sp = input.run ? RUN : WALK;
      let fw = input.forward, st = input.strafe;
      const len = Math.hypot(fw, st);
      if (len > 1) { fw /= len; st /= len; }
      const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
      const dx = (fw * sy + st * cy) * sp * dt, dz = (fw * cy - st * sy) * sp * dt;
      if (dx || dz) {
        const n = slide(this.index, this.dynamicSolids(), p.x, p.z, p.y, dx, dz, PLAYER_R);
        const moved = Math.hypot(n.x - p.x, n.z - p.z);
        p.x = n.x; p.z = n.z;
        p.meters += moved;
        this.stepAcc += moved;
        const stride = input.run ? 1.05 : 0.72;
        if (this.stepAcc > stride) { this.stepAcc = 0; this.outSteps.push({ surface: 'floor', running: input.run }); }
      }
    }
    // quota
    const g = groundAt(p.x, p.z, p.y, this.elevator.y);
    if (this.inCab()) p.y = this.elevator.y;
    else if (g >= p.y - 0.46) p.y = g;
    else p.y = Math.max(g, p.y - 7 * dt);
    p.f = floorOf(p.y);

    // ascensore
    const wasPhase = this.elevator.phase;
    this.elevator.update(dt, this.power.main);
    const inCab = this.inCab();
    if (inCab && !this.lastInCab) this.stats.rides++;
    this.lastInCab = inCab;
    if (Math.abs(p.z + 1.5) < 0.45 && p.x > ELEV.doorX0 && p.x < ELEV.doorX1 && Math.abs(p.y - this.elevator.y) < 0.5) this.elevator.blockDoor();
    for (const ev of this.elevator.drain()) {
      const pos = { x: ELEV.cx, y: floorY(ev.floor) + 1.2, z: -1.8 };
      if (ev.kind === 'ding') this.sound('elev_ding', pos, 0.8);
      else if (ev.kind === 'door_open' || ev.kind === 'door_close') this.sound('elev_door', pos, 0.6);
      else if (ev.kind === 'stall') { this.sound('elev_stop', { x: ELEV.cx, y: this.elevator.y + 1, z: -3 }, 1); if (inCab) this.notice(L('L\'ascensore si è fermato tra due piani.', 'The lift has stopped between floors.')); }
      else if (ev.kind === 'rescue' && inCab) this.notice(L('Le batterie di emergenza riportano la cabina al piano.', 'The emergency batteries bring the car down to a floor.'));
    }
    void wasPhase;

    // i pazienti che si alzano da soli
    this.mover.update(dt, this.minute, this.moverHost);
    for (const pt of this.h.patients) {
      const o = this.objById.get(`obj-${pt.id}`), mv = this.mover.m.get(pt.id), bp = this.bedPos.get(pt.id);
      if (!o || !mv || !bp) continue;
      if (mv.state === 'bed') { o.x = bp.x; o.y = bp.y; o.z = bp.z; }
      else { o.x = mv.x; o.z = mv.z; o.y = floorY(pt.f) + (mv.state === 'fallen' ? 0.3 : 1.25); }
    }
    // la torcia consuma le pile
    if (this.torch && !this.cctv.active) {
      const before = this.torchCharge;
      this.torchCharge = Math.max(0, this.torchCharge - dt / 420);
      if (before >= 0.15 && this.torchCharge < 0.15) this.think('torchLow', THINK.torchLow);
      if (this.torchCharge <= 0) { this.torch = false; this.sound('torch_click', undefined, 0.4); this.think('torchDead' + this.minute.toFixed(0), THINK.torchDead); this.notice(L('Torcia scarica', 'Torch is dead')); }
    }
    // la stanza vuota da cui ha chiamato qualcuno
    const here = this.roomOf(p.f, p.x, p.z);
    if (here && !this.cctv.active) {
      const pt = this.activeTasks().find((t) => t.kind === 'phantom');
      if (pt && here.id === this.phantom.room && !this.phantom.armed) {
        this.phantom.armed = true; this.phantom.music = 70; this.phantom.flick = 5;
        const d = this.h.doors.find((x) => x.room === here.id);
        if (d) { d.open = false; this.sound('door_bang', { ...doorPoint(d), y: p.y + 1.2 }, 1); }
        this.think('vacantArrive', THINK.vacantArrive, 0.5);
        this.complete(pt, L('Hai controllato la stanza. Non c\'è nessuno.', 'You checked the room. Nobody is there.'));
        this.log(this.placeOf(here), L('La porta si chiude da sola alle spalle del guardiano. Un carillon suona.', 'The door slams shut behind the guard. A music box starts playing.'), true, true);
        this.plan.push({ at: this.minute + 3, kind: 'phantom_after' }); this.plan.sort((a, b) => a.at - b.at);
      }
      const k = here.kind === 'patient' && this.ghost.revealed && this.h.patients.find((x) => x.room === here.id)?.id === this.ghost.pid ? 'ghostroom' : here.kind;
      if (k === 'ghostroom') this.think('ghostroom', THINK.emptyBed, 0.3);
      else if (THINK.rooms[k]) this.think(`room-${k}`, THINK.rooms[k], 0.8);
    }
    if (this.phantom.music > 0) this.phantom.music -= dt;
    if (this.phantom.flick > 0) this.phantom.flick -= dt;
    // il Babbo Natale spostato: te ne accorgi quando lo vedi
    if (this.santa && !this.santaNoticed && this.santa.f === p.f && this.canSee({ x: this.santa.x, y: floorY(this.santa.f) + 1.3, z: this.santa.z }, 12)) {
      this.santaNoticed = true;
      this.think('santa' + this.minute.toFixed(0), THINK.santaMoved);
      this.sound('tone_anom', undefined, 0.5);
    }
    // porte che si aprono e si chiudono
    for (const d of this.h.doors) {
      const cur = this.doorOpen.get(d.id) ?? 0, want = d.open ? 1 : 0;
      if (cur !== want) this.doorOpen.set(d.id, clamp(cur + Math.sign(want - cur) * dt * 1.6, 0, 1));
    }
    // finestre che sbattono
    this.bangT -= dt;
    if (this.bangT <= 0) {
      this.bangT = 2.5 + this.rng.next() * 4;
      for (const w of this.h.windows) if (this.winOpen.get(w.id)) this.sound('window_bang', this.winPos(w), 0.9);
    }
    // il telefono smette di squillare dopo un quarto d'ora
    if (this.phone.ringing && this.minute - this.phone.since > 15) {
      this.phone.ringing = false;
      this.log(L('Reception', 'Reception'), L('Il telefono smette di squillare. Nessuno ha risposto.', 'The phone stops ringing. Nobody answered.'));
    }
    // ritardi
    for (const t of this.activeTasks()) if (this.minute > t.due && !(t as { lateNoted?: boolean }).lateNoted) { (t as { lateNoted?: boolean }).lateNoted = true; this.stats.late++; }
    // anomalie
    this.anomalyFx = this.anomalies.update(dt, {
      minute: this.minute, player: { x: p.x, y: p.y, z: p.z, f: p.f, yaw: p.yaw }, cctvCam: this.cctv.active ? this.cam().id : null,
      powered: (f) => this.powered(f), hospital: this.h,
    });
    for (const s of this.anomalyFx.sounds) this.sound(s.kind, s.pos, s.gain);
    // eventi insoliti
    this.events.update(dt, this.eventHost);
    this.events.syncCab(this.elevator.y);
    for (const f of FLOORS) this.anomalyFx.flicker[f] = (this.anomalyFx.flicker[f] ?? 1) * (this.events.flicker[f] ?? 1);
    for (const [k, v] of Object.entries(this.events.camNoise)) this.anomalyFx.camNoise[k] = Math.max(this.anomalyFx.camNoise[k] ?? 0, v);
    if (this.phantom.flick > 0) { const r = roomById(this.h, this.phantom.room ?? ''); if (r) this.anomalyFx.flicker[r.f] = (this.anomalyFx.flicker[r.f] ?? 1) * (this.rng.chance(0.4) ? 0.15 : 1); }
    // fine: se non firmi il registro, alle 6:30 il turno si chiude da solo
    if (this.minute >= SHIFT_LEN + 30) this.finish('timeout');
  }

  winPos(w: Win): Vec3 {
    const c = (w.a0 + w.a1) / 2, y = (w.y0 + w.y1) / 2;
    return w.axis === 'x' ? { x: c, y, z: w.at } : { x: w.at, y, z: c };
  }

  // ------------------------------------------------------------ interazioni

  /** Cosa c'è al centro dello sguardo, entro il braccio. */
  focus(eye: Vec3, dir: Vec3): Focus | null {
    if (this.cctv.active) return null;
    let best: { o: Obj; d: number } | null = null;
    const list = this.h.objs.concat(this.dynamicObjs());
    for (const o of list) {
      if (Math.abs(o.y - eye.y) > 2.6) continue;
      if (Math.abs(o.x - eye.x) > REACH + 2 || Math.abs(o.z - eye.z) > REACH + 2) continue;
      const d = raySphere(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, o.x, o.y, o.z, o.r);
      if (d < (this.seated ? 3.2 : REACH) && (!best || d < best.d)) best = { o, d };
    }
    if (!best) return null;
    // un muro in mezzo?
    const near = new Set<Aabb>();
    const ex = eye.x + dir.x * best.d, ez = eye.z + dir.z * best.d;
    this.index.query(Math.min(eye.x, ex), Math.max(eye.x, ex), Math.min(eye.z, ez), Math.max(eye.z, ez), near);
    for (const s of this.dynamicSolids()) near.add(s);
    for (const s of near) {
      const t = rayAabb(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, s);
      if (t < best.d - 0.18) {
        // la porta stessa non blocca la sua maniglia
        if (best.o.kind === 'door') continue;
        return null;
      }
    }
    const a = this.actionFor(best.o);
    return a ? { obj: best.o, action: a.action, params: a.params ?? {}, dist: best.d } : null;
  }

  actionFor(o: Obj): { action: Action; params?: Record<string, string | number> } | null {
    const h = this.h;
    switch (o.kind) {
      case 'door': {
        const d = h.doors.find((x) => x.id === o.data)!;
        if (d.locked) return { action: 'locked' };
        return { action: d.open ? 'close' : 'open' };
      }
      case 'cctv': return { action: 'cctv' };
      case 'radio': return { action: this.radioOn ? 'radio_off' : 'radio_on' };
      case 'water': return { action: 'take_water' };
      case 'linen': return { action: 'take_blanket' };
      case 'kettle': return { action: 'make_tea' };
      case 'breaker': {
        const up = o.data === 'main' ? this.power.main : this.power.fl[Number(o.data)];
        const label = o.data === 'main' ? (this.lang === 'it' ? 'generale' : 'main') : FLOOR_NAME[Number(o.data)][this.lang].toLowerCase();
        return { action: up ? 'breaker_down' : 'breaker_up', params: { what: label } };
      }
      case 'checkpoint': return { action: 'stamp' };
      case 'window': return this.winOpen.get(o.data ?? '') ? { action: 'close_window' } : null;
      case 'cambox': return this.camOffline.has(o.data ?? '') ? { action: 'reset_cam', params: { n: String(h.cams.find((c) => c.id === o.data)?.n ?? 0).padStart(2, '0') } } : null;
      case 'patient': {
        const p = h.patients.find((x) => x.id === o.data)!;
        if (this.ghost.revealed && this.ghost.pid === p.id) return { action: 'empty_bed' };
        const st = this.mover.state(p.id);
        if (st === 'fallen') return { action: 'help_up', params: { name: pName(p)[this.lang] } };
        if (st !== 'bed') return { action: 'talk', params: { name: pName(p)[this.lang] } };
        const t = this.activeTasks().find((x) => x.patient === p.id);
        if (t?.kind === 'urgent') return { action: 'check', params: { name: pName(p)[this.lang] } };
        if (t?.kind === 'assist' && t.known && this.carried === t.item) return { action: 'give', params: { item: ITEM_NAME[t.item!][this.lang], name: pName(p)[this.lang] } };
        if (this.relay[p.id]) return { action: 'tell', params: { name: pName(p)[this.lang] } };
        const mid = this.activeTasks().find((x) => x.kind === 'midnight');
        if (mid && !mid.stamps!.includes(p.id)) return { action: 'greet', params: { name: pName(p)[this.lang] } };
        return { action: 'talk', params: { name: pName(p)[this.lang] } };
      }
      case 'phone': return o.data === '0' && this.phone.ringing ? { action: 'answer' } : null;
      case 'callbtn': {
        const [pid, kind] = (o.data ?? '').split('|');
        const st = this.calls[pid]?.[kind as 'assist' | 'urgent'];
        const p = h.patients.find((x) => x.id === pid);
        return st === 'blink' ? { action: 'ack_call', params: { room: p?.roomNumber ?? 0 } } : null;
      }
      case 'elev_call': return { action: 'call_elev' };
      case 'elev_btn': return { action: 'floor_btn', params: { floor: FLOOR_NAME[Number(o.data)][this.lang] } };
      case 'logbook': return { action: this.activeTasks().some((t) => t.kind === 'handover') ? 'handover' : 'logbook' };
      case 'vending': return { action: 'vending' };
      case 'tree': return { action: 'tree' };
      case 'chair': return this.seated ? null : { action: 'sit' };
      case 'batteries': return { action: 'take_batteries' };
      case 'switch': return { action: this.roomLevel(o.data ?? '') > 0 ? 'light_off' : 'light_on' };
      case 'presepe': case 'santa': case 'gift': case 'advent': case 'vacantbed': case 'musicbox': return { action: 'inspect' };
      default: return null;
    }
  }

  interact(f: Focus): void {
    const o = f.obj, h = this.h, pos = { x: o.x, y: o.y, z: o.z };
    switch (f.action) {
      case 'open': case 'close': {
        const d = h.doors.find((x) => x.id === o.data)!;
        d.open = f.action === 'open';
        this.sound(d.open ? 'door_open' : 'door_close', pos, 0.7);
        return;
      }
      case 'locked': this.sound('door_locked', pos, 0.6); this.notice(L('Chiusa a chiave.', 'Locked.')); return;
      case 'cctv': this.enterCctv(); return;
      case 'radio_on': case 'radio_off':
        this.radioOn = f.action === 'radio_on';
        this.sound('switch', pos, 0.5);
        this.notice(this.radioOn ? L('Filodiffusione accesa', 'Music system on') : L('Filodiffusione spenta', 'Music system off'));
        return;
      case 'take_water': this.take('water', pos, 'pour'); return;
      case 'take_blanket': this.take('blanket', pos, 'cloth'); return;
      case 'make_tea': this.take('tea', pos, 'kettle'); return;
      case 'breaker_up': case 'breaker_down': {
        const up = f.action === 'breaker_up';
        if (o.data === 'main') this.power.main = up; else this.power.fl[Number(o.data)] = up;
        this.sound('breaker', pos, 0.9);
        if (up) this.checkPower(); else this.sound('power_down', undefined, 0.6);
        return;
      }
      case 'stamp': {
        this.sound('beep', pos, 0.6);
        const t = this.activeTasks().find((x) => x.kind === 'patrol' && x.floor === o.f);
        if (!t) { this.notice(L('Punto di controllo timbrato.', 'Checkpoint badged.')); return; }
        if (!t.stamps!.includes(o.id)) t.stamps!.push(o.id);
        this.notice(L(`Ronda: ${t.stamps!.length} di 3`, `Round: ${t.stamps!.length} of 3`));
        if (t.stamps!.length >= 3) this.complete(t, L('Ronda completata.', 'Round complete.'));
        return;
      }
      case 'close_window': {
        this.winOpen.set(o.data!, false);
        this.sound('window_close', pos, 0.8);
        const t = this.activeTasks().find((x) => x.kind === 'window' && x.target === o.data);
        if (t) this.complete(t, L('Finestra chiusa.', 'Window closed.'));
        return;
      }
      case 'reset_cam': {
        this.camOffline.delete(o.data!);
        this.sound('beep', pos, 0.5);
        const t = this.activeTasks().find((x) => x.kind === 'camera' && x.target === o.data);
        if (t) this.complete(t, L('La telecamera riparte.', 'The camera comes back on.'));
        return;
      }
      case 'ack_call': {
        const [pid, kind] = (o.data ?? '').split('|');
        this.calls[pid][kind as 'assist' | 'urgent'] = 'on';
        this.sound('click', pos, 0.5);
        const p = h.patients.find((x) => x.id === pid)!;
        if (this.ghostCalls.has(pid)) { this.line(L(`Interfono · ${p.roomNumber}`, `Intercom · ${p.roomNumber}`), this.rng.pick(GHOST_LINES.intercom)); return; }
        const t = this.activeTasks().find((x) => x.patient === pid);
        if (t?.kind === 'fall') { this.line(L(`Interfono · ${p.roomNumber}`, `Intercom · ${p.roomNumber}`), gL(FALL_INTERCOM, p.sex)); return; }
        if (t) this.reveal(t, p, true);
        return;
      }
      case 'check': {
        const p = h.patients.find((x) => x.id === o.data)!;
        const t = this.activeTasks().find((x) => x.patient === p.id && x.kind === 'urgent');
        if (t) {
          this.calls[p.id].urgent = 'off';
          this.complete(t, this.rng.pick(URGENT_RESOLVED));
          this.line(pName(p), gL(this.rng.pick(THANKS), p.sex));
        }
        return;
      }
      case 'give': {
        const p = h.patients.find((x) => x.id === o.data)!;
        const t = this.activeTasks().find((x) => x.patient === p.id && x.kind === 'assist');
        this.carried = null;
        if (t) { this.calls[p.id].assist = 'off'; this.complete(t, L(`Consegnato a ${pName(p).it}.`, `Delivered to ${pName(p).en}.`)); }
        this.line(pName(p), gL(this.rng.pick(THANKS), p.sex));
        return;
      }
      case 'tell': {
        const p = h.patients.find((x) => x.id === o.data)!;
        const msg = this.relay[p.id];
        delete this.relay[p.id];
        this.line(L(GUARD.first, GUARD.first), msg);
        this.line(pName(p), L('Davvero? Oh… grazie. Grazie davvero.', 'Really? Oh… thank you. Thank you so much.'));
        const t = this.activeTasks().find((x) => x.kind === 'relay' && x.patient === p.id);
        if (t) this.complete(t, L('Auguri consegnati.', 'Message delivered.'));
        return;
      }
      case 'talk': {
        const p = h.patients.find((x) => x.id === o.data)!;
        const t = this.activeTasks().find((x) => x.patient === p.id && x.kind === 'assist');
        if (this.ghostCalls.has(p.id)) { this.ghostCalls.delete(p.id); this.calls[p.id].assist = 'off'; this.line(pName(p), gL(this.rng.pick(GHOST_LINES.patient), p.sex)); return; }
        if (t && !t.known) { this.reveal(t, p, false); return; }
        if (t && t.known) { this.line(pName(p), gL(this.requestLine(t, p), p.sex)); return; }
        if (this.mover.state(p.id) !== 'bed') { this.line(pName(p), gL(this.rng.pick(WALKING_TALK), p.sex)); return; }
        const late = this.minute > 240 && this.rng.chance(0.6);
        this.line(pName(p), gL(late ? this.rng.pick(PATIENT_TALK_LATE) : this.rng.chance(0.35) ? p.story : this.rng.pick(PATIENT_TALK), p.sex));
        return;
      }
      case 'answer': {
        this.sound('click', pos, 0.5);
        const pid = this.phone.patient;
        this.phone.ringing = false;
        if (this.silentCall) {
          this.silentCall = false;
          this.line(L('Telefono', 'Phone'), this.rng.pick(GHOST_LINES.phone));
          return;
        }
        if (pid === 'phantom') {
          const r = roomById(h, this.phantom.room ?? '');
          if (!r) return;
          this.line(L(`Interno ${r.number}`, `Extension ${r.number}`), phantomCall(this.phantom.name, r.number ?? 0));
          this.newTask('phantom', 30, L(`Controlla la stanza ${r.number}`, `Check room ${r.number}`), this.placeOf(r), { target: r.id });
          this.log(L('Reception', 'Reception'), L(`Una telefonata dalla stanza ${r.number}.`, `A phone call from room ${r.number}.`), true, true);
          return;
        }
        const p = h.patients.find((x) => x.id === pid);
        if (!p) return;
        const c = RELAY_CALL(p, this.trng);
        this.line(c.caller, c.text);
        this.relay[p.id] = c.tell;
        this.newTask('relay', 60, L(`Porta gli auguri alla stanza ${p.roomNumber}`, `Pass the wishes on to room ${p.roomNumber}`), this.placeOfPatient(p), { patient: p.id });
        this.log(L('Reception', 'Reception'), L(`Una telefonata per ${pName(p).it}.`, `A phone call for ${pName(p).en}.`));
        return;
      }
      case 'call_elev': this.sound('click', pos, 0.4); this.elevator.call(o.f); if (!this.power.main) this.notice(L('L\'ascensore non risponde: manca la corrente.', 'The lift does not respond: no power.')); return;
      case 'floor_btn': this.sound('click', pos, 0.4); this.elevator.call(Number(o.data)); return;
      case 'greet': {
        const p = h.patients.find((x) => x.id === o.data)!;
        const t = this.activeTasks().find((x) => x.kind === 'midnight');
        this.line(L(GUARD.first, GUARD.first), L(`Buon Natale, ${pName(p).it}.`, `Merry Christmas, ${pName(p).en}.`), true);
        this.line(pName(p), gL(this.rng.pick(MIDNIGHT_LINES), p.sex));
        if (t && !t.stamps!.includes(p.id)) {
          t.stamps!.push(p.id);
          if (t.stamps!.length >= h.patients.length) this.complete(t, L('Hai fatto gli auguri a tutti.', 'You wished everyone merry Christmas.'));
        }
        return;
      }
      case 'logbook': this.line(L('Registro', 'Logbook'), LOGBOOK); this.sound('paper', pos, 0.5); return;
      case 'handover': {
        const t = this.activeTasks().find((x) => x.kind === 'handover');
        if (t) this.complete(t, L('Turno chiuso.', 'Shift closed.'));
        this.sound('paper', pos, 0.6);
        this.finish('handover');
        return;
      }
      case 'vending': this.sound('vending', pos, 0.7); this.line(L(GUARD.first, GUARD.first), this.rng.pick(VENDING_LINES)); return;
      case 'sit': this.sit(); return;
      case 'light_on': case 'light_off': {
        if (!this.powered(o.f)) { this.sound('switch', pos, 0.6); this.notice(L('Niente: manca la corrente.', 'Nothing: there\'s no power.')); return; }
        this.switches.set(o.data!, f.action === 'light_on' ? 'on' : 'off');
        this.sound('switch', pos, 0.6);
        return;
      }
      case 'take_batteries': {
        this.sound('battery', pos, 0.6);
        if (this.spares >= 2 && this.torchCharge > 0.9) { this.notice(L('Hai già le pile di ricambio.', 'You already have spare batteries.')); return; }
        this.torchCharge = 1; this.spares = 2;
        this.think('batteries' + this.minute.toFixed(0), THINK.batteries);
        const bt = this.activeTasks().find((x) => x.kind === 'batteries');
        if (bt) this.complete(bt, L('Pile prese.', 'Batteries collected.'));
        return;
      }
      case 'help_up': {
        const p = h.patients.find((x) => x.id === o.data)!;
        this.mover.toBed(p.id);
        this.calls[p.id].urgent = 'off';
        this.line(L(GUARD.first, GUARD.first), THINK.helpUp, true);
        this.line(pName(p), gL(L('Grazie… non so cosa mi è successo. Il pavimento si è mosso.', 'Thank you… I don\'t know what happened. The floor moved.'), p.sex));
        const t = this.activeTasks().find((x) => x.patient === p.id && x.kind === 'fall');
        if (t) this.complete(t, L(`Hai riportato ${pName(p).it} a letto.`, `You helped ${pName(p).en} back to bed.`));
        return;
      }
      case 'empty_bed': {
        const p = h.patients.find((x) => x.id === o.data)!;
        this.line(L(GUARD.first, GUARD.first), THINK.emptyBed, true);
        if (this.carried) this.carried = null;
        let any = false;
        for (const t of this.activeTasks().filter((x) => x.patient === p.id)) { this.complete(t, GHOST_TASK_DONE); any = true; }
        this.calls[p.id].assist = 'off'; this.calls[p.id].urgent = 'off';
        if (any || this.rng.chance(0.5)) this.think('emptyBed2', THINK.emptyBed2, 3);
        this.log(this.placeOfPatient(p), L('Il letto è vuoto e rifatto.', 'The bed is empty and made.'), true, true);
        return;
      }
      case 'inspect': {
        const k = o.kind;
        const night = this.minute;
        const text = k === 'presepe' ? THINK.presepe[night < 120 ? 0 : night < 300 ? 1 : 2]
          : k === 'santa' ? THINK.santa[this.santaMoves === 0 ? 0 : this.santaMoves === 1 ? 1 : 2]
          : k === 'gift' ? THINK.gift : k === 'advent' ? THINK.advent : k === 'vacantbed' ? THINK.vacantBed : THINK.musicbox;
        if (k === 'musicbox') this.phantom.music = this.phantom.music > 0 ? 0.01 : 25;
        this.line(L(GUARD.first, GUARD.first), text, true);
        if (k === 'gift' || (k === 'presepe' && night >= 300)) this.log(this.placeOf(roomById(h, o.room) ?? h.rooms[0]), text, true, true);
        return;
      }
      case 'tree': this.line(L(GUARD.first, GUARD.first), this.rng.pick(TREE_LINES)); return;
      default: return;
    }
  }

  private requestLine(t: Task, p: Patient): L10n {
    const r = new Rng(`req/${this.seed}/${t.id}`);
    void p;
    return r.pick(t.kind === 'urgent' ? URGENT_REQ : ASSIST_REQ[t.item as 'water' | 'blanket' | 'tea']);
  }

  /** La richiesta diventa chiara: dall'interfono della reception o al letto del paziente. */
  private reveal(t: Task, p: Patient, intercom: boolean): void {
    this.line(intercom ? L(`Interfono · ${p.roomNumber}`, `Intercom · ${p.roomNumber}`) : pName(p), gL(this.requestLine(t, p), p.sex));
    if (t.kind === 'assist') {
      t.known = true;
      const it = ITEM_NAME[t.item!];
      t.title = L(`Porta ${it.it.startsWith('c') ? 'una ' : 'un '}${it.it} alla ${p.roomNumber}`, `Bring a ${it.en} to room ${p.roomNumber}`);
      const src = this.sourcePlace(t.item!);
      if (src) t.place = L(`${t.place.it} · ${it.it.split(' ')[0] === 'bicchiere' ? 'acqua' : it.it}: ${src.it}`, `${t.place.en} · ${it.en}: ${src.en}`);
    }
  }

  private take(item: Item, pos: Vec3, snd: string): void {
    this.carried = item;
    this.sound(snd, pos, 0.7);
    this.notice(L(`Hai preso: ${ITEM_NAME[item].it}`, `Picked up: ${ITEM_NAME[item].en}`));
  }

  private checkPower(): void {
    if (!this.power.main) { this.notice(L('Il generale è ancora abbassato.', 'The main breaker is still down.')); return; }
    const off = FLOORS.filter((f) => !this.power.fl[f]);
    if (off.length) { this.notice(L(`Ancora senza corrente: ${off.map((f) => FLOOR_NAME[f].it).join(', ')}`, `Still without power: ${off.map((f) => FLOOR_NAME[f].en).join(', ')}`)); return; }
    this.sound('power_up', undefined, 0.9);
    const t = this.activeTasks().find((x) => x.kind === 'power');
    if (t) this.complete(t, L('Corrente ripristinata in tutto l\'ospedale.', 'Power restored throughout the hospital.'));
  }

  private complete(t: Task, text: L10n): void {
    t.done = this.minute;
    t.reported = t.kind === 'handover' || t.kind === 'midnight' ? true : false;
    t.report = text;
    this.notice(text);
    if (!t.reported) this.notice(L('Fai rapporto dal telefono (T)', 'Send the report from your phone (T)'));
    this.log(t.place, L(`Fatto: ${t.title.it}.`, `Done: ${t.title.en}.`));
  }

  // ------------------------------------------------------------ videosorveglianza

  /** Si siede alla postazione: da lì segue la notte sul terminale. */
  sit(): void {
    const c = this.obj('chair');
    if (!c) return;
    this.seated = true;
    this.player.x = c.x; this.player.z = c.z - 0.05; this.player.y = floorY(c.f);
    this.sound('chair_scrape', { x: c.x, y: 0.5, z: c.z }, 0.6);
  }
  stand(): void {
    if (!this.seated) return;
    this.seated = false;
    this.player.z += 0.7;
    this.sound('chair_scrape', { x: this.player.x, y: 0.5, z: this.player.z }, 0.5);
  }
  /** Altezza degli occhi: più bassa da seduti. */
  eye(): number { return this.seated ? 1.2 : EYE; }

  enterCctv(): void { this.cctv.active = true; this.stats.cctv++; this.sound('click', { x: -3, y: 1, z: 6.2 }, 0.4); }
  exitCctv(): void { this.cctv.active = false; }
  cctvStep(d: number): void { const n = this.h.cams.length; this.cctv.idx = ((this.cctv.idx - 1 + d + n) % n) + 1; this.sound('click', { x: -3, y: 1, z: 6.2 }, 0.25); }
  cctvSelect(n: number): void { if (n >= 1 && n <= this.h.cams.length) { this.cctv.idx = n; this.sound('click', { x: -3, y: 1, z: 6.2 }, 0.25); } }

  /** Posizione di una telecamera (quella in cabina segue l'ascensore). */
  camPose(c: Cam): { pos: Vec3; target: Vec3 } {
    const dy = c.inCab ? this.elevator.y : 0;
    // direzione di base più l'orientamento scelto dal guardiano
    const bx = c.tx - c.x, by = c.ty - c.y, bz = c.tz - c.z, bl = Math.hypot(bx, by, bz) || 1;
    const aim = this.camAim[c.id] ?? { yaw: 0, pitch: 0 };
    const yaw0 = Math.atan2(bx, bz) + aim.yaw, pitch0 = Math.asin(by / bl) + aim.pitch;
    const dx = Math.sin(yaw0) * Math.cos(pitch0) * bl, dyy = Math.sin(pitch0) * bl, dz = Math.cos(yaw0) * Math.cos(pitch0) * bl, l = bl;
    const o = c.inCab ? 0 : 0.26;
    const pos = { x: c.x + (dx / l) * o, y: c.y + dy + (dyy / l) * o, z: c.z + (dz / l) * o };
    return { pos, target: { x: pos.x + dx, y: pos.y + dyy, z: pos.z + dz } };
  }

  /** Il guardiano gira la telecamera attiva (radianti), entro i limiti del supporto. */
  aimCam(dyaw: number, dpitch: number): void {
    const c = this.cam();
    const a = this.camAim[c.id] ?? { yaw: 0, pitch: 0 };
    a.yaw = clamp(a.yaw + dyaw, -1.2, 1.2);
    a.pitch = clamp(a.pitch + dpitch, -0.55, 0.45);
    this.camAim[c.id] = a;
  }

  /** Piano buio: la telecamera passa all'infrarosso. */
  camDark(c: Cam): boolean { return c.inCab ? !this.power.main : c.label.en.startsWith('Outside') ? false : !this.powered(c.f); }

  // ------------------------------------------------------------ uscite per audio e interfaccia

  private sound(kind: string, pos?: Vec3, gain = 1): void { this.outSounds.push({ kind, pos, gain }); }
  private notice(t: L10n): void { this.outNotices.push(t); }
  private line(speaker: L10n, text: L10n, tts = false): void { this.outLines.push({ speaker, text, tts }); }
  /** Un pensiero del guardiano, una volta sola per chiave (lo legge il narratore). */
  private think(key: string, text: L10n, delay = 0): void {
    if (this.thought.has(key)) return;
    this.thought.add(key);
    if (delay > 0) { this.pendingThoughts.push({ at: this.realTime + delay, text }); return; }
    this.outLines.push({ speaker: L(GUARD.first, GUARD.first), text, tts: true });
  }
  private readonly pendingThoughts: { at: number; text: L10n }[] = [];
  private santaMoves = 0;

  /** Il Babbo Natale cambia posto quando nessuno lo guarda. */
  private moveSanta(e: Ev): void {
    const sa = this.santa, p = this.player;
    if (!sa) return;
    if (this.cctv.active || this.canSee({ x: sa.x, y: floorY(sa.f) + 1.3, z: sa.z }, 25)) { e.at = this.minute + 4; this.plan.push(e); this.plan.sort((a, b) => a.at - b.at); return; }
    const f = this.seated ? BASE_FLOOR : p.f;
    const cs = this.h.corridors.filter((c) => c.f === f);
    for (let k = 0; k < 30 && cs.length; k++) {
      const c = this.rng.pick(cs);
      const x = this.rng.range(c.x0 + 0.5, c.x1 - 0.5), z = this.rng.range(c.z0 + 0.5, c.z1 - 0.5);
      // contro un muro, lontano dal guardiano, fuori dalla sua vista
      const alongX = c.x1 - c.x0 >= c.z1 - c.z0;
      const wx = alongX ? x : (this.rng.chance(0.5) ? c.x0 + 0.35 : c.x1 - 0.35), wz = alongX ? (this.rng.chance(0.5) ? c.z0 + 0.35 : c.z1 - 0.35) : z;
      const d = Math.hypot(wx - p.x, wz - p.z);
      if (d < 5 || d > 16 || (f === p.f && this.canSee({ x: wx, y: floorY(f) + 1.3, z: wz }, 30))) continue;
      if (this.h.doors.some((dd) => dd.f === f && Math.hypot(doorPoint(dd).x - wx, doorPoint(dd).z - wz) < 1.4)) continue;
      if (wz < -1.1 && wx < -2.6) continue;
      sa.f = f as never; sa.x = wx; sa.z = wz; sa.yaw = Math.atan2(p.x - wx, p.z - wz);
      this.santaNoticed = false; this.santaMoves++;
      this.log(L(FLOOR_NAME[f].it, FLOOR_NAME[f].en), L('Il Babbo Natale di plastica non è più dove stava.', 'The plastic Father Christmas is no longer where it was.'), false, true);
      return;
    }
  }

  private readonly moverHost = ((self: Shift) => ({
    busy: (pid: string) => self.activeTasks().some((t) => t.patient === pid && (t.kind === 'assist' || t.kind === 'urgent' || t.kind === 'fall')) || self.calls[pid]?.urgent === 'blink',
    openDoor: (d: { id: string; open: boolean }) => { d.open = true; },
    fell: (pt: Patient, pos: Vec3) => {
      self.calls[pt.id].urgent = 'blink';
      self.stats.calls++;
      self.sound('call_urgent', self.panelPos(), 0.8);
      const r = self.roomOf(pt.f, pos.x, pos.z);
      const place = r ? self.placeOf(r) : L(`${FLOOR_NAME[pt.f].it} · corridoio`, `${FLOOR_NAME[pt.f].en} · corridor`);
      self.newTask('fall', 12, L(`${pName(pt).it} è caduto/a`.replace('caduto/a', pt.sex === 'm' ? 'caduto' : 'caduta'), `${pName(pt).en} has fallen`), place, { patient: pt.id });
      self.notice(L(`Chiamata urgente: ${pName(pt).it} è a terra`, `Urgent: ${pName(pt).en} is on the floor`));
      self.log(place, L(`${pName(pt).it} cade andando in bagno.`, `${pName(pt).en} falls on the way to the toilet.`));
      if (self.player.f === pt.f && Math.hypot(self.player.x - pos.x, self.player.z - pos.z) < 14) self.think('fall' + self.minute.toFixed(0), THINK.fallHeard, 0.6);
    },
    sound: (k: string, pos?: Vec3, g?: number) => self.sound(k, pos, g),
    log: (pt: Patient, it: string, en: string) => self.log(self.placeOfPatient(pt), L(it, en), false),
  }))(this);
  log(place: L10n, text: L10n, seen = true, strange = false): void {
    this.chronicle.push({ minute: this.minute, place, text, seen, strange });
    // davanti a una cosa strana il guardiano prova a calmarsi, ad alta voce
    if (strange && seen && this.realTime - this.lastReact > 45 && this.rng.chance(0.6)) { this.lastReact = this.realTime; this.think('react' + this.minute.toFixed(1), this.rng.pick(THINK.react), 2.2); }
  }
  private message(from: L10n, text: L10n, ping = true): void {
    this.messages.push({ id: ++this.msgSeq, from, text, at: this.minute, read: false });
    if (ping) { this.newMsgs++; this.sound('sms', undefined, 0.6); }
  }

  drain(): { sounds: SoundOut[]; notices: L10n[]; lines: Line[]; steps: { surface: string; running: boolean }[]; newMessages: number } {
    const n = this.newMsgs; this.newMsgs = 0;
    return { sounds: this.outSounds.splice(0), notices: this.outNotices.splice(0), lines: this.outLines.splice(0), steps: this.outSteps.splice(0), newMessages: n };
  }

  markAllRead(): void { for (const m of this.messages) m.read = true; }
  unread(): number { return this.messages.filter((m) => !m.read).length; }

  /** Suoni continui: musica, ascensore, telefono, finestre, monitor. */
  loops(): LoopOut[] {
    const p = this.player, out: LoopOut[] = [];
    const inCab = this.inCab();
    const lit = this.powered(p.f);
    if (this.radioOn && !this.events.radioCut && this.power.main && this.powered(BASE_FLOOR)) {
      // filodiffusione: più forte all'atrio, appena percepibile nel seminterrato, muta in ascensore
      const g = inCab ? 0 : !lit ? 0 : p.f === BASE_FLOOR ? (p.z > 1.5 && p.x < 3 ? 0.6 : 0.4) : 0.28;
      if (g > 0) out.push({ id: 'xmas', kind: 'xmas_music', gain: Math.min(1, g * this.events.radioBlast) });
    }
    if (this.power.main) {
      if (inCab) out.push({ id: 'elev-music-in', kind: 'elev_music', gain: 0.55 });
      else if (this.elevator.atFloor() === p.f && this.elevator.door > 0.05) out.push({ id: 'elev-music', kind: 'elev_music', pos: { x: ELEV.cx, y: this.elevator.y + 2, z: -3 }, gain: 0.35 * this.elevator.door });
      if (this.elevator.phase === 'moving') out.push({ id: 'elev-motor', kind: 'elev_motor', pos: { x: ELEV.cx, y: this.elevator.y + 1.5, z: -3 }, gain: 0.5 });
    }
    if (this.phone.ringing) { const ph = this.obj('phone-0')!; out.push({ id: 'phone', kind: 'phone_ring', pos: { x: ph.x, y: ph.y, z: ph.z }, gain: 0.8 }); }
    const buzz = Object.values(this.calls).some((c) => c.assist === 'blink' || c.urgent === 'blink');
    if (buzz) out.push({ id: 'buzz', kind: 'call_loop', pos: this.panelPos(), gain: Object.values(this.calls).some((c) => c.urgent === 'blink') ? 0.7 : 0.4 });
    for (const w of this.h.windows) if (this.winOpen.get(w.id) && Math.abs(w.f - p.f) < 1) out.push({ id: `wind-${w.id}`, kind: 'wind_gap', pos: this.winPos(w), gain: 0.7 });
    if (!this.power.main) { const br = this.obj('breaker-main'); if (br) out.push({ id: 'gen', kind: 'generator', pos: { x: br.x, y: br.y, z: br.z }, gain: 0.6 }); }
    const mood = this.events.mood();
    if (mood.active && !this.ended) out.push({ id: 'mystery', kind: 'mystery_music', gain: 0.2 + mood.intensity * 0.65 });
    if (this.lightLevel(p.f) > 0) out.push({ id: 'hum', kind: 'lamp_buzz', gain: 0.3 });
    // il corpo che reagisce: un fondo grave che cresce con la notte, il cuore quando qualcosa non torna
    const dr = this.dread();
    if (dr > 0.12) out.push({ id: 'dread', kind: 'anom_drone', gain: dr * 0.28 });
    if (mood.active && mood.intensity > 0.45 || this.phantom.music > 0 || (dr > 0.7 && this.lightLevel(p.f) < 1 && !this.torch)) out.push({ id: 'heart', kind: 'heartbeat', gain: 0.25 + 0.35 * Math.max(mood.intensity, this.phantom.music > 0 ? 0.8 : 0.3) });
    if (this.phantom.music > 0) { const mb = this.h.objs.find((o) => o.kind === 'musicbox'); if (mb) out.push({ id: 'musicbox', kind: 'music_box', pos: { x: mb.x, y: mb.y, z: mb.z }, gain: 0.55 }); }
    // monitor dei pazienti: un bip lieve nelle stanze vicine
    for (const pt of this.h.patients) if (pt.f === p.f && Math.hypot(pt.x - p.x, pt.z - p.z) < 12) out.push({ id: `mon-${pt.id}`, kind: 'monitor_beep', pos: { x: pt.x + 0.9, y: floorY(pt.f) + 1.5, z: pt.z - 0.6 }, gain: 0.35 });
    return out.slice(0, 11);
  }

  /** Livelli del letto sonoro ambientale. */
  ambience(): { wind: number; rain: number; insects: number; frogs: number; birds: number; water: number; leaves: number; human: number; room: number; hush: number } {
    const p = this.player;
    const outside = false;
    const nearWin = this.h.windows.some((w) => w.f === p.f && Math.hypot(this.winPos(w).x - p.x, this.winPos(w).z - p.z) < 4);
    const prec = this.precip();
    const exposure = outside ? 1 : nearWin ? 0.25 : p.f === -1 ? 0.02 : 0.08;
    return {
      wind: (0.25 + 0.5 * prec) * exposure, rain: (this.weather.kind === 'snow' ? 0.05 : prec) * exposure, insects: 0, frogs: 0, birds: 0, water: 0, leaves: 0,
      human: 0, room: outside ? 0 : this.powered(p.f) ? 0.55 : 0.2, hush: 0,
    };
  }

  /** Intensità delle precipitazioni 0..1 (evolve durante la notte). */
  precip(): number {
    const m = this.minute / 60;
    return clamp(this.weather.base * (0.65 + 0.35 * Math.sin(m * 0.9 + this.seed * 0.37)) , 0.05, 1);
  }

  anomalyViews(): AnomalyView[] { return this.anomalies.views().concat(this.events.views()); }
  mood(): Mood { return this.events.mood(); }
  /** Solo sviluppo: forza un evento insolito. */
  devEvent(kind: string): boolean { return this.events.force(kind as never, this.eventHost); }

  // ------------------------------------------------------------ percezione (per gli eventi)

  /** Il guardiano vede il punto con i suoi occhi? */
  canSee(q: Vec3, maxDist = 20): boolean {
    if (this.cctv.active) return false;
    const p = this.player, ey = p.y + EYE;
    const dx = q.x - p.x, dy = q.y - ey, dz = q.z - p.z, d = Math.hypot(dx, dy, dz);
    if (d > maxDist || Math.abs(q.y - p.y) > 1.9) return false;
    const fx = Math.sin(p.yaw) * Math.cos(p.pitch), fy = -Math.sin(p.pitch), fz = Math.cos(p.yaw) * Math.cos(p.pitch);
    if ((dx * fx + dy * fy + dz * fz) / d < 0.82) return false;
    return this.clearLine({ x: p.x, y: ey, z: p.z }, q);
  }

  /** La telecamera attiva inquadra il punto? */
  camSees(q: Vec3): boolean {
    if (!this.cctv.active) return false;
    const c = this.cam(), pose = this.camPose(c);
    const dx = q.x - pose.pos.x, dy = q.y - pose.pos.y, dz = q.z - pose.pos.z, d = Math.hypot(dx, dy, dz);
    if (d > 30) return false;
    const tx = pose.target.x - pose.pos.x, ty = pose.target.y - pose.pos.y, tz = pose.target.z - pose.pos.z, tl = Math.hypot(tx, ty, tz) || 1;
    if ((dx * tx + dy * ty + dz * tz) / (d * tl) < Math.cos(c.fov * 0.55)) return false;
    return this.clearLine(pose.pos, q);
  }

  private clearLine(a: Vec3, q: Vec3): boolean {
    const dx = q.x - a.x, dy = q.y - a.y, dz = q.z - a.z, d = Math.hypot(dx, dy, dz) || 1;
    const near = new Set<Aabb>();
    this.index.query(Math.min(a.x, q.x), Math.max(a.x, q.x), Math.min(a.z, q.z), Math.max(a.z, q.z), near);
    for (const s of this.dynamicSolids()) near.add(s);
    for (const b of near) if (rayAabb(a.x, a.y, a.z, dx / d, dy / d, dz / d, b) < d - 0.3) return false;
    return true;
  }

  private readonly eventHost: EventHost = ((self: Shift): EventHost => ({
    get h() { return self.h; },
    get minute() { return self.minute; }, set minute(v: number) { self.minute = v; },
    get player() { return self.player; },
    get doorOpen() { return self.doorOpen; },
    get calls() { return self.calls; },
    get ghostCalls() { return self.ghostCalls; },
    get cctv() { return self.cctv; },
    get radioOn() { return self.radioOn; }, set radioOn(v: boolean) { self.radioOn = v; },
    powered: (f) => self.powered(f),
    callElevator: (f) => self.elevator.call(f),
    elevatorAt: () => self.elevator.atFloor(),
    elevatorY: () => self.elevator.y,
    inCab: () => self.inCab(),
    ringSilent: () => { self.phone = { ringing: true, since: self.minute, patient: null }; self.silentCall = true; },
    canSee: (q, m) => self.canSee(q, m),
    camSees: (q) => self.camSees(q),
    camId: () => (self.cctv.active ? self.cam().id : null),
    sound: (k, pos, g) => self.sound(k, pos, g),
    log: (place, text, seen, strange) => self.log(place, text, seen, strange),
  }))(this);

  /** Posizione della pulsantiera delle chiamate. */
  panelPos(): Vec3 { const o = this.h.objs.find((x) => x.kind === 'callbtn'); return o ? { x: o.x, y: o.y, z: o.z } : { x: -5.5, y: 0.9, z: 6.2 }; }

  /** Dove trovare le cose stanotte (la pianta cambia a ogni seed). */
  whereIsText(): L10n {
    const at = (k: string) => { const r = this.h.rooms.find((x) => x.kind === k); return r ? r : null; };
    const w = (k: string, it: string, en: string) => { const r = at(k); return r ? [`${it}: ${r.name.it.toLowerCase()}, ${FLOOR_NAME[r.f].it}`, `${en}: ${r.name.en.toLowerCase()}, ${FLOOR_NAME[r.f].en}`] : null; };
    const parts = [w('linen', 'coperte', 'blankets'), w('staff', 'acqua e camomilla', 'water and chamomile'), w('electrical', 'quadro elettrico', 'electrical panel')].filter(Boolean) as string[][];
    return L(`Dove trovi le cose stanotte. ${parts.map((x) => x[0]).join('; ')}. Le stanze cambiano spesso, controlla la mappa (M).`, `Where things are tonight. ${parts.map((x) => x[1]).join('; ')}. Rooms move around a lot, check the map (M).`);
  }

  /** Dove si prende un oggetto, per i testi degli incarichi. */
  sourcePlace(item: Item): L10n | null {
    const kind = item === 'blanket' ? 'linen' : item === 'water' || item === 'tea' ? 'staff' : null;
    const r = kind ? this.h.rooms.find((x) => x.kind === kind) : null;
    return r ? this.placeOf(r) : null;
  }

  // ------------------------------------------------------------ fine turno

  finish(reason: 'handover' | 'timeout' | 'abandoned'): void {
    if (this.ended) return;
    this.ended = true;
    this.endReason = reason;
    for (const t of this.activeTasks()) t.missed = true;
  }

  summary(): {
    seed: number; reason: string; durationSeconds: number; done: number; late: number; missed: number; tasks: { title: L10n; place: L10n; issued: string; done: string | null; late: boolean }[];
    chronicle: { time: string; place: L10n; text: L10n; seen: boolean; strange: boolean }[]; patients: Patient[];
  } {
    const rows = this.tasks.map((t) => ({ title: t.title, place: t.place, issued: fmtClock(t.issued), done: t.done === null ? null : fmtClock(t.done), late: t.done !== null ? t.done > t.due : true }));
    return {
      seed: this.seed, reason: this.endReason ?? 'abandoned', durationSeconds: this.realTime,
      done: this.tasks.filter((t) => t.done !== null).length,
      late: this.tasks.filter((t) => t.done !== null && t.done > t.due).length,
      missed: this.tasks.filter((t) => t.done === null).length,
      tasks: rows,
      chronicle: [...this.chronicle].sort((a, b) => a.minute - b.minute).map((c) => ({ time: fmtClock(c.minute), place: c.place, text: c.text, seen: c.seen, strange: c.strange })),
      patients: this.h.patients,
    };
  }
}

export { CEIL, H };
