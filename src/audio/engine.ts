// Motore audio interamente procedurale (Web Audio API). Nessun file audio.
// Ogni metodo pubblico è un no-op sicuro prima di resume() o se Web Audio non esiste.
import type { IAudioEngine, LoopKind, SoundKind, SoundscapeLevels, Surface, Vec3Like } from '../core/api';
import { Rng, clamp } from '../core/rng';
import {
  AMBIENT_RECIPES, BED_LAYERS, LOOPS, RECIPES, buildAmbientBed, createNoiseBank, distortionCurve, footstepRecipe,
  type AmbientRecipeId, type BedLayer, type LoopHandle, type NoiseBank, type Recipe, type RecipeParams,
} from './synth';

export interface AudioEngineOptions {
  /** Fabbrica del contesto (test o integrazioni particolari). Predefinito: AudioContext del browser. */
  createContext?: () => AudioContext;
  /** Chiave del generatore casuale usato per la sola programmazione sonora. */
  rngKey?: string;
}

/** Volume di base e distanza di riferimento (m) per ogni suono: più è alta, più lontano si sente. */
const META: Record<SoundKind, readonly [gain: number, ref: number]> = {
  mimic_step: [0.3, 2], radio: [0.45, 1],
  elev_ding: [0.6, 4], elev_door: [0.5, 3], elev_stop: [0.9, 6], power_down: [0.9, 1], power_up: [0.8, 1], call_buzz: [0.55, 4],
  call_urgent: [0.6, 5], beep: [0.4, 1.5], pour: [0.45, 1.5], cloth: [0.4, 1.5], kettle: [0.45, 2], window_bang: [0.8, 6],
  window_close: [0.6, 3], vending: [0.55, 3], keys: [0.4, 1.5], slide_door: [0.45, 4],
  alien_call: [0.7, 20], bigfoot_growl: [0.85, 24], cult_chant: [0.6, 18],
  door_open: [0.5, 3], door_close: [0.6, 4], door_locked: [0.5, 3], door_bang: [0.65, 8], switch: [0.35, 1.5],
  generator_start: [0.4, 6], generator_stop: [0.35, 5], drawer: [0.4, 2], tent_zip: [0.4, 2.5], breaker: [0.6, 3],
  metal_clank: [0.7, 6], bin_tip: [0.8, 7], twig: [0.5, 4], owl: [0.85, 24], fox: [0.8, 20], deer: [0.7, 12],
  crows: [0.8, 18], screech: [0.8, 22], nightbird: [0.75, 20], frog: [0.4, 4], splash: [0.6, 5], vehicle_pass: [0.8, 12], vehicle_start: [0.4, 10],
  car_door: [0.7, 6], typing: [0.3, 1], paper: [0.3, 1], camera: [0.35, 1], sms: [0.4, 1], battery: [0.35, 1],
  click: [0.3, 1], steps_far: [0.5, 5], voice_far: [0.5, 7], knock: [0.7, 5], hum_anom: [0.5, 8],
  whisper_anom: [0.4, 4], tone_anom: [0.35, 8], thunder: [1, 40], branch_fall: [0.8, 8], fire_douse: [0.5, 3],
  ui: [0.2, 1], torch_click: [0.3, 1], rustle: [0.45, 4], chair_scrape: [0.5, 3], report_sent: [0.35, 1],
};

const AMBIENT_META: Record<AmbientRecipeId, readonly [number, number]> = { droplet: [0.25, 1.5], chirp: [0.35, 5] };

const LOOP_META: Record<LoopKind, readonly [gain: number, ref: number]> = {
  mystery_music: [0.35, 1],
  xmas_music: [0.55, 1], elev_music: [0.6, 3], elev_motor: [0.25, 3], phone_ring: [0.55, 4], call_loop: [0.4, 3],
  wind_gap: [0.25, 3], monitor_beep: [0.18, 1.5], heartbeat: [0.6, 1], music_box: [0.5, 2.5],
  breath_calm: [0.16, 1], breath_fast: [0.2, 1],
  generator: [0.2, 5], water: [0.32, 5], fire: [0.32, 3], lamp_buzz: [0.1, 1.5], anom_drone: [0.18, 7], engine_idle: [0.16, 5],
};

/** Guadagno a livello 1 e costante di tempo (s) di ogni strato continuo. */
const BED: Record<BedLayer, readonly [gain: number, tau: number]> = {
  wind: [0.24, 3], rain: [0.26, 4], insects: [0.05, 2], water: [0.2, 3], leaves: [0.13, 2.5], human: [0.13, 5.5], room: [0.1, 2],
};

/** Costanti di tempo degli strati a eventi (rane, uccelli). */
const EVENT_TAU = { frogs: 2.5, birds: 3, rain: 4, leaves: 2.5 } as const;

export const MAX_ONE_SHOTS = 24;
export const MAX_LOOPS = 14;
const TICK_MS = 100;
const ZERO_LEVELS: SoundscapeLevels = { wind: 0, rain: 0, insects: 0, frogs: 0, birds: 0, water: 0, leaves: 0, human: 0, room: 0, hush: 0 };

interface Voice { out: GainNode; panner: PannerNode | null; end: number; loud: number }

interface LoopWanted { kind: LoopKind; pos?: Vec3Like; gain: number }
interface LoopVoice { kind: LoopKind; out: GainNode; panner: PannerNode | null; handle: LoopHandle; gain: number; pos?: Vec3Like }
interface Dying { out: GainNode; panner: PannerNode | null; handle: LoopHandle; at: number }

const fin = (v: number | undefined, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export class AudioEngine implements IAudioEngine {
  private readonly opts: AudioEngineOptions;
  private readonly rng: Rng;
  private ctx: AudioContext | null = null;
  private disposed = false;
  private unavailable = false;
  private userSuspended = false;
  private hiddenSuspended = false;
  private muted = false;
  private distortion = 0;
  private levels: SoundscapeLevels = { ...ZERO_LEVELS };
  private readonly smooth = { frogs: 0, birds: 0, rain: 0, leaves: 0 };
  private listenerPos: Vec3Like = { x: 0, y: 1.7, z: 0 };
  private listenerFwd: Vec3Like = { x: 0, y: 0, z: 1 };

  // grafo
  private noise: NoiseBank | null = null;
  private bus: GainNode | null = null;
  private dry: GainNode | null = null;
  private wetIn: GainNode | null = null;
  private wet: GainNode | null = null;
  private wetConnected = false;
  private wetOffAt = -1;
  private wetSources: OscillatorNode[] = [];
  private muteGain: GainNode | null = null;
  private voiceBus: GainNode | null = null;
  private graphNodes: AudioNode[] = [];
  private bedGains: Record<BedLayer, GainNode> | null = null;
  private bed: LoopHandle | null = null;

  private voices: Voice[] = [];
  private readonly wanted = new Map<string, LoopWanted>();
  private readonly loops = new Map<string, LoopVoice>();
  private dying: Dying[] = [];
  private stepAlt = false;
  private lastTick = -1;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly onVisibility = (): void => this.handleVisibility();

  constructor(opts: AudioEngineOptions = {}) {
    this.opts = opts;
    this.rng = new Rng(opts.rngKey ?? 'audio');
  }

  // ------------------------------------------------------------ ciclo di vita

  async resume(): Promise<void> {
    try {
      if (this.disposed || this.unavailable) return;
      this.userSuspended = false;
      if (!this.ctx) this.build();
      const c = this.ctx;
      if (c && c.state !== 'running' && !this.isHidden()) await c.resume();
    } catch {
      /* il browser può rifiutare senza gesto utente: si riproverà alla prossima chiamata */
    }
  }

  /** Contesto e nodo d'ingresso per la voce narrante; null prima di resume() o senza Web Audio. */
  voiceOutput(): { ctx: AudioContext; node: AudioNode } | null {
    if (this.disposed || !this.ctx || !this.voiceBus) return null;
    return { ctx: this.ctx, node: this.voiceBus };
  }

  suspend(): void {
    this.userSuspended = true;
    this.safe(() => {
      void this.ctx?.suspend()?.catch?.(() => undefined);
    });
  }

  setMuted(muted: boolean): void {
    this.muted = !!muted;
    this.safe(() => {
      const c = this.ctx;
      if (c && this.muteGain) this.muteGain.gain.setTargetAtTime(this.muted ? 0 : 1, c.currentTime, 0.04);
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.safe(() => {
      if (this.timer !== null) clearInterval(this.timer);
      this.timer = null;
    });
    this.safe(() => {
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
    });
    const c = this.ctx;
    if (c) {
      const now = this.safe(() => c.currentTime) ?? 0;
      this.safe(() => this.bed?.stop(now));
      for (const l of this.loops.values()) this.killLoop(l, now);
      for (const d of this.dying) this.killLoop(d, now);
      for (const v of this.voices) this.dropVoice(v);
      for (const o of this.wetSources) this.safe(() => o.stop(now));
      for (const n of this.graphNodes) this.safe(() => n.disconnect());
      this.safe(() => {
        void c.close()?.catch?.(() => undefined);
      });
    }
    this.loops.clear();
    this.wanted.clear();
    this.dying = [];
    this.voices = [];
    this.wetSources = [];
    this.graphNodes = [];
    this.bed = null;
    this.bedGains = null;
    this.bus = this.dry = this.wet = this.wetIn = this.muteGain = this.voiceBus = null;
    this.noise = null;
    this.ctx = null;
  }

  // ------------------------------------------------------------ stato esterno

  setListener(pos: Vec3Like, forward: Vec3Like): void {
    this.safe(() => {
      this.listenerPos = { x: fin(pos.x, 0), y: fin(pos.y, 0), z: fin(pos.z, 0) };
      const len = Math.hypot(fin(forward.x, 0), fin(forward.y, 0), fin(forward.z, 0));
      this.listenerFwd = len > 1e-6
        ? { x: forward.x / len, y: forward.y / len, z: forward.z / len }
        : { x: 0, y: 0, z: 1 };
      const c = this.ctx;
      if (!c) return;
      const l = c.listener;
      const p = this.listenerPos;
      const f = this.listenerFwd;
      // Il mondo di gioco è sinistrorso (x est, z nord), Web Audio è destrorso: si specchia z.
      const t = c.currentTime;
      if (l.positionX && l.forwardX) {
        l.positionX.setTargetAtTime(p.x, t, 0.03);
        l.positionY.setTargetAtTime(p.y, t, 0.03);
        l.positionZ.setTargetAtTime(-p.z, t, 0.03);
        l.forwardX.setTargetAtTime(f.x, t, 0.03);
        l.forwardY.setTargetAtTime(f.y, t, 0.03);
        l.forwardZ.setTargetAtTime(-f.z, t, 0.03);
        l.upX.setTargetAtTime(0, t, 0.03);
        l.upY.setTargetAtTime(1, t, 0.03);
        l.upZ.setTargetAtTime(0, t, 0.03);
      } else {
        l.setPosition(p.x, p.y, -p.z);
        l.setOrientation(f.x, f.y, -f.z, 0, 1, 0);
      }
    });
  }

  setAmbient(levels: SoundscapeLevels): void {
    this.safe(() => {
      const L = { ...ZERO_LEVELS };
      for (const k of Object.keys(L) as (keyof SoundscapeLevels)[]) L[k] = clamp(fin(levels?.[k], 0), 0, 1);
      this.levels = L;
      this.applyBed();
    });
  }

  setDistortion(amount: number): void {
    this.safe(() => {
      this.distortion = clamp(fin(amount, 0), 0, 1);
      this.applyDistortion();
    });
  }

  // ------------------------------------------------------------ suoni

  playOneShot(kind: SoundKind, opts?: { pos?: Vec3Like; gain?: number; pitch?: number }): void {
    this.safe(() => {
      const recipe = RECIPES[kind];
      const meta = META[kind];
      if (!recipe || !meta) return;
      this.spawn(recipe, meta, opts);
    });
  }

  footstep(surface: Surface, running: boolean): void {
    this.safe(() => {
      this.stepAlt = !this.stepAlt;
      const alt = this.stepAlt;
      this.spawn((c, out, t, p) => footstepRecipe(c, out, t, p, surface, running, alt), [running ? 0.3 : 0.22, 1], undefined);
    });
  }

  setLoop(id: string, kind: LoopKind | null, pos?: Vec3Like, gain?: number): void {
    this.safe(() => {
      if (kind === null || !LOOPS[kind]) {
        this.wanted.delete(id);
      } else {
        const prev = this.wanted.get(id);
        this.wanted.set(id, {
          kind,
          pos: pos ? { x: fin(pos.x, 0), y: fin(pos.y, 0), z: fin(pos.z, 0) } : prev?.kind === kind ? prev.pos : undefined,
          gain: clamp(fin(gain, prev?.kind === kind ? prev.gain : 1), 0, 2),
        });
      }
      this.syncLoop(id);
    });
  }

  /**
   * Avanza la programmazione degli eventi ambientali e la pulizia delle voci.
   * Chiamato da un timer interno; esposto per i test e per chi volesse pilotarlo dal ciclo di gioco.
   */
  tick(): void {
    this.safe(() => {
      const c = this.ctx;
      if (!c || this.disposed || c.state !== 'running') return;
      const now = c.currentTime;
      // dopo una sospensione o un throttling del browser non si recupera il tempo perso
      const dt = this.lastTick < 0 ? TICK_MS / 1000 : clamp(now - this.lastTick, 0, 0.5);
      this.lastTick = now;
      if (dt <= 0) return;
      this.reap(now);
      this.finishDistortionFade(now);
      for (const l of this.loops.values()) l.handle.tick?.(now, dt);
      this.scheduleAmbientEvents(now, dt);
    });
  }

  // ------------------------------------------------------------ interni: grafo

  private safe<T>(fn: () => T): T | undefined {
    try {
      return fn();
    } catch {
      return undefined;
    }
  }

  private isHidden(): boolean {
    return typeof document !== 'undefined' && document.visibilityState === 'hidden';
  }

  private build(): void {
    let c: AudioContext;
    try {
      if (this.opts.createContext) {
        c = this.opts.createContext();
      } else {
        const g = globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
        const Ctor = g.AudioContext ?? g.webkitAudioContext;
        if (typeof Ctor !== 'function') {
          this.unavailable = true;
          return;
        }
        c = new Ctor({ latencyHint: 'interactive' });
      }
    } catch {
      this.unavailable = true;
      return;
    }
    if (!c) {
      this.unavailable = true;
      return;
    }
    try {
      this.ctx = c;
      const keep = <N extends AudioNode>(n: N): N => {
        this.graphNodes.push(n);
        return n;
      };
      this.noise = createNoiseBank(c, this.rng.fork('noise'));

      // catena master: bus → (pulito ‖ distorto) → pre → compressore → limitatore → mute → uscita
      const mute = keep(c.createGain());
      mute.gain.value = this.muted ? 0 : 1;
      mute.connect(c.destination);
      const limiter = keep(c.createDynamicsCompressor());
      limiter.threshold.value = -6;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.12;
      limiter.connect(mute);
      const comp = keep(c.createDynamicsCompressor());
      comp.threshold.value = -20;
      comp.knee.value = 14;
      comp.ratio.value = 3.5;
      comp.attack.value = 0.012;
      comp.release.value = 0.3;
      comp.connect(limiter);
      const pre = keep(c.createGain());
      pre.gain.value = 0.7;
      pre.connect(comp);
      // voce del narratore: salta la distorsione, passa da compressore, limitatore e muto
      const voiceBus = keep(c.createGain());
      voiceBus.gain.value = 0.9;
      voiceBus.connect(comp);
      this.voiceBus = voiceBus;

      const bus = keep(c.createGain());
      const dry = keep(c.createGain());
      dry.gain.value = 1;
      bus.connect(dry);
      dry.connect(pre);

      // ramo innaturale: modulazione ad anello → saturazione → passa-basso oscillante → ritardo
      // modulato (stonatura). Resta scollegato finché la distorsione è a zero.
      const wetIn = keep(c.createGain());
      const ring = keep(c.createGain());
      ring.gain.value = 0.35;
      const ringOsc = c.createOscillator();
      ringOsc.frequency.value = 57;
      const ringDepth = keep(c.createGain());
      ringDepth.gain.value = 0.65;
      ringOsc.connect(ringDepth);
      ringDepth.connect(ring.gain);
      const shaper = keep(c.createWaveShaper());
      shaper.curve = distortionCurve();
      shaper.oversample = '2x';
      const lp = keep(c.createBiquadFilter());
      lp.type = 'lowpass';
      lp.frequency.value = 1700;
      lp.Q.value = 4;
      const lpLfo = c.createOscillator();
      lpLfo.frequency.value = 0.37;
      const lpDepth = keep(c.createGain());
      lpDepth.gain.value = 1100;
      lpLfo.connect(lpDepth);
      lpDepth.connect(lp.frequency);
      const delay = keep(c.createDelay(0.1));
      delay.delayTime.value = 0.03;
      const dLfo = c.createOscillator();
      dLfo.frequency.value = 0.23;
      const dDepth = keep(c.createGain());
      dDepth.gain.value = 0.012;
      dLfo.connect(dDepth);
      dDepth.connect(delay.delayTime);
      const wet = keep(c.createGain());
      wet.gain.value = 0;
      wetIn.connect(ring);
      ring.connect(shaper);
      shaper.connect(lp);
      lp.connect(delay);
      delay.connect(wet);
      wet.connect(pre);
      for (const o of [ringOsc, lpLfo, dLfo]) {
        o.start();
        this.wetSources.push(o);
      }

      this.bus = bus;
      this.dry = dry;
      this.wetIn = wetIn;
      this.wet = wet;
      this.muteGain = mute;

      // letto ambientale: parte da zero e sale con le costanti di tempo degli strati
      const gains = {} as Record<BedLayer, GainNode>;
      for (const layer of BED_LAYERS) {
        const g = keep(c.createGain());
        g.gain.value = 0;
        g.connect(bus);
        gains[layer] = g;
      }
      this.bedGains = gains;
      this.bed = buildAmbientBed(c, gains, this.params(1, 'bed'));

      this.setListener(this.listenerPos, this.listenerFwd);
      this.applyBed();
      this.applyDistortion();
      for (const id of this.wanted.keys()) this.syncLoop(id);

      if (typeof setInterval === 'function') {
        this.timer = setInterval(() => this.tick(), TICK_MS);
        (this.timer as unknown as { unref?: () => void }).unref?.();
      }
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility);
    } catch {
      // contesto inutilizzabile: si resta in modalità silenziosa senza mai sollevare eccezioni
      this.safe(() => {
        void c.close()?.catch?.(() => undefined);
      });
      this.ctx = null;
      this.bus = null;
      this.bedGains = null;
      this.unavailable = true;
    }
  }

  private handleVisibility(): void {
    this.safe(() => {
      const c = this.ctx;
      if (!c || this.disposed) return;
      if (this.isHidden()) {
        if (c.state === 'running') {
          this.hiddenSuspended = true;
          void c.suspend()?.catch?.(() => undefined);
        }
      } else if (this.hiddenSuspended || c.state !== 'running') {
        this.hiddenSuspended = false;
        this.lastTick = -1;
        if (!this.userSuspended) void c.resume()?.catch?.(() => undefined);
      }
    });
  }

  private params(pitch: number, fork?: string): RecipeParams {
    return { pitch, rng: fork ? this.rng.fork(fork) : this.rng, noise: this.noise as NoiseBank };
  }

  private applyBed(): void {
    const c = this.ctx;
    const g = this.bedGains;
    if (!c || !g) return;
    const t = c.currentTime;
    for (const layer of BED_LAYERS) {
      const [gain, tau] = BED[layer];
      g[layer].gain.setTargetAtTime(this.levels[layer] * gain, t, tau);
    }
  }

  private applyDistortion(): void {
    const c = this.ctx;
    if (!c || !this.bus || !this.dry || !this.wet || !this.wetIn) return;
    const t = c.currentTime;
    const a = this.distortion;
    if (a > 0) {
      if (!this.wetConnected) {
        this.bus.connect(this.wetIn);
        this.wetConnected = true;
      }
      this.wetOffAt = -1;
      this.dry.gain.setTargetAtTime(1 - 0.75 * a, t, 0.12);
      this.wet.gain.setTargetAtTime(0.9 * a, t, 0.12);
    } else if (this.wetConnected) {
      this.dry.gain.setTargetAtTime(1, t, 0.12);
      this.wet.gain.setTargetAtTime(0, t, 0.12);
      if (this.wetOffAt < 0) this.wetOffAt = t + 1;
    }
  }

  /** A dissolvenza conclusa il ramo distorto viene scollegato: il percorso torna esattamente pulito. */
  private finishDistortionFade(now: number): void {
    if (this.wetOffAt < 0 || now < this.wetOffAt || this.distortion > 0) return;
    this.wetOffAt = -1;
    if (!this.bus || !this.dry || !this.wet || !this.wetIn) return;
    this.safe(() => this.bus?.disconnect(this.wetIn as GainNode));
    this.wetConnected = false;
    this.dry.gain.cancelScheduledValues(now);
    this.dry.gain.setValueAtTime(1, now);
    this.wet.gain.cancelScheduledValues(now);
    this.wet.gain.setValueAtTime(0, now);
  }

  // ------------------------------------------------------------ interni: spazializzazione

  private makePanner(c: AudioContext, pos: Vec3Like, ref: number): PannerNode {
    const pn = c.createPanner();
    pn.panningModel = 'HRTF';
    pn.distanceModel = 'inverse';
    pn.refDistance = ref;
    pn.rolloffFactor = 1;
    pn.maxDistance = 10000;
    this.movePanner(c, pn, pos, false);
    return pn;
  }

  private movePanner(c: AudioContext, pn: PannerNode, pos: Vec3Like, smooth: boolean): void {
    const x = fin(pos.x, 0), y = fin(pos.y, 0), z = -fin(pos.z, 0);
    if (pn.positionX) {
      if (smooth) {
        const t = c.currentTime;
        pn.positionX.setTargetAtTime(x, t, 0.08);
        pn.positionY.setTargetAtTime(y, t, 0.08);
        pn.positionZ.setTargetAtTime(z, t, 0.08);
      } else {
        pn.positionX.value = x;
        pn.positionY.value = y;
        pn.positionZ.value = z;
      }
    } else {
      pn.setPosition(x, y, z);
    }
  }

  /** Stima dell'attenuazione per distanza (stesso modello "inverse" del PannerNode). */
  private attenuation(pos: Vec3Like | undefined, ref: number): number {
    if (!pos) return 1;
    const p = this.listenerPos;
    const d = Math.hypot(fin(pos.x, 0) - p.x, fin(pos.y, 0) - p.y, fin(pos.z, 0) - p.z);
    return ref / (ref + Math.max(0, d - ref));
  }

  // ------------------------------------------------------------ interni: one-shot

  private spawn(recipe: Recipe, meta: readonly [number, number], opts?: { pos?: Vec3Like; gain?: number; pitch?: number }): void {
    const c = this.ctx;
    if (!c || !this.bus || !this.noise || this.disposed || c.state !== 'running') return;
    const gain = clamp(fin(opts?.gain, 1), 0, 2) * meta[0];
    if (gain <= 0) return;
    const loud = gain * this.attenuation(opts?.pos, meta[1]);
    const now = c.currentTime;
    if (this.voices.length >= MAX_ONE_SHOTS) {
      this.reap(now);
      if (this.voices.length >= MAX_ONE_SHOTS) {
        // si sacrifica la voce più debole; se la più debole è la nuova, non parte
        let qi = 0;
        for (let i = 1; i < this.voices.length; i++) if (this.voices[i].loud < this.voices[qi].loud) qi = i;
        if (this.voices[qi].loud >= loud) return;
        const q = this.voices.splice(qi, 1)[0];
        q.out.gain.cancelScheduledValues(now);
        q.out.gain.setTargetAtTime(0, now, 0.015);
        this.dying.push({ out: q.out, panner: q.panner, handle: { stop: () => undefined }, at: now + 0.12 });
      }
    }
    const out = c.createGain();
    out.gain.value = gain;
    let panner: PannerNode | null = null;
    if (opts?.pos) {
      panner = this.makePanner(c, opts.pos, meta[1]);
      out.connect(panner);
      panner.connect(this.bus);
    } else {
      out.connect(this.bus);
    }
    const voice: Voice = { out, panner, end: now + 1, loud };
    this.voices.push(voice);
    try {
      const dur = recipe(c, out, now + 0.01, this.params(clamp(fin(opts?.pitch, 1), 0.5, 2)));
      voice.end = now + 0.01 + (Number.isFinite(dur) ? Math.max(0.05, dur) : 1) + 0.25;
    } catch {
      this.voices.splice(this.voices.indexOf(voice), 1);
      this.dropVoice(voice);
    }
  }

  private dropVoice(v: { out: GainNode; panner: PannerNode | null }): void {
    this.safe(() => v.out.disconnect());
    this.safe(() => v.panner?.disconnect());
  }

  /** Rilascia le voci terminate e le sorgenti continue in dissolvenza giunte a fine corsa. */
  private reap(now: number): void {
    if (this.voices.length > 0) {
      const alive: Voice[] = [];
      for (const v of this.voices) {
        if (v.end <= now) this.dropVoice(v);
        else alive.push(v);
      }
      this.voices = alive;
    }
    if (this.dying.length > 0) {
      const rest: Dying[] = [];
      for (const d of this.dying) {
        if (d.at <= now) this.killLoop(d, now);
        else rest.push(d);
      }
      this.dying = rest;
    }
  }

  // ------------------------------------------------------------ interni: sorgenti continue

  private killLoop(l: { out: GainNode; panner: PannerNode | null; handle: LoopHandle }, now: number): void {
    this.safe(() => l.handle.stop(now));
    this.dropVoice(l);
  }

  private fadeOutLoop(id: string, now: number): void {
    const l = this.loops.get(id);
    if (!l) return;
    this.loops.delete(id);
    l.out.gain.cancelScheduledValues(now);
    l.out.gain.setTargetAtTime(0, now, 0.3);
    this.dying.push({ out: l.out, panner: l.panner, handle: l.handle, at: now + 1.8 });
  }

  private syncLoop(id: string): void {
    const c = this.ctx;
    if (!c || !this.bus || !this.noise || this.disposed) return;
    const now = c.currentTime;
    const want = this.wanted.get(id);
    const cur = this.loops.get(id);
    if (!want) {
      this.fadeOutLoop(id, now);
      return;
    }
    const [base, ref] = LOOP_META[want.kind];
    // una sorgente esistente cambia natura (tipo o posizionale/non posizionale): si sostituisce in dissolvenza
    if (cur && (cur.kind !== want.kind || (cur.panner === null) !== (want.pos === undefined))) {
      this.fadeOutLoop(id, now);
    }
    const live = this.loops.get(id);
    if (live) {
      live.gain = want.gain;
      live.pos = want.pos;
      live.out.gain.setTargetAtTime(want.gain * base, now, 0.35);
      if (live.panner && want.pos) this.movePanner(c, live.panner, want.pos, true);
      return;
    }
    if (this.loops.size >= MAX_LOOPS) {
      const loudNew = want.gain * base * this.attenuation(want.pos, ref);
      let qid: string | null = null;
      let ql = Infinity;
      for (const [lid, l] of this.loops) {
        const lm = LOOP_META[l.kind];
        const ld = l.gain * lm[0] * this.attenuation(l.pos, lm[1]);
        if (ld < ql) {
          ql = ld;
          qid = lid;
        }
      }
      if (qid === null || ql >= loudNew) return; // resta "desiderata": ripartirà a una chiamata successiva
      this.fadeOutLoop(qid, now);
    }
    const out = c.createGain();
    out.gain.value = 0;
    out.gain.setTargetAtTime(want.gain * base, now, 0.5);
    let panner: PannerNode | null = null;
    if (want.pos) {
      panner = this.makePanner(c, want.pos, ref);
      out.connect(panner);
      panner.connect(this.bus);
    } else {
      out.connect(this.bus);
    }
    try {
      const handle = LOOPS[want.kind](c, out, this.params(1, 'loop/' + id));
      this.loops.set(id, { kind: want.kind, out, panner, handle, gain: want.gain, pos: want.pos });
    } catch {
      this.dropVoice({ out, panner });
    }
  }

  // ------------------------------------------------------------ interni: eventi ambientali

  private around(minDist: number, maxDist: number, up: number): Vec3Like {
    const a = this.rng.range(0, Math.PI * 2);
    const d = this.rng.range(minDist, maxDist);
    const p = this.listenerPos;
    return { x: p.x + Math.sin(a) * d, y: p.y + this.rng.range(-0.5, up), z: p.z + Math.cos(a) * d };
  }

  /** Numero di eventi in questo intervallo per un processo di Poisson (limitato). */
  private poisson(rate: number, dt: number): number {
    const expect = rate * dt;
    if (expect <= 0) return 0;
    const limit = Math.exp(-expect);
    let n = 0;
    let acc = this.rng.next();
    while (acc > limit && n < 4) {
      n++;
      acc *= this.rng.next();
    }
    return n;
  }

  private scheduleAmbientEvents(now: number, dt: number): void {
    const s = this.smooth;
    const L = this.levels;
    for (const k of ['frogs', 'birds', 'rain', 'leaves'] as const) {
      s[k] += (L[k] - s[k]) * (1 - Math.exp(-dt / EVENT_TAU[k]));
    }
    // rane: gracidii sparsi, più fitti col livello
    for (let i = this.poisson(s.frogs * 1.1, dt); i > 0; i--) {
      this.spawn(RECIPES.frog, META.frog, { pos: this.around(12, 60, 0), gain: 0.7 + 0.8 * s.frogs, pitch: this.rng.range(0.85, 1.2) });
    }
    // uccelli: di notte rari richiami di rapaci, verso l'alba brevi frasi sempre più frequenti
    if (s.birds > 0.004) {
      // di notte: un richiamo ogni mezzo minuto circa nel bosco quieto (gufi, più di rado uccelli meno riconoscibili)
      const owlRate = Math.min(s.birds, 0.25) * 0.42 * (1 - clamp((s.birds - 0.2) / 0.3, 0, 1));
      for (let i = Math.min(1, this.poisson(owlRate, dt)); i > 0; i--) {
        const u = this.rng.next(), kind = u < 0.62 ? 'owl' : u < 0.82 ? 'nightbird' : 'screech';
        this.spawn(RECIPES[kind], META[kind], { pos: this.around(30, 110, 12), gain: kind === 'owl' ? 1 : 0.8, pitch: this.rng.range(0.9, 1.12) });
      }
      const chirpRate = Math.max(0, s.birds - 0.16) * 3;
      for (let i = this.poisson(chirpRate, dt); i > 0; i--) {
        this.spawn(AMBIENT_RECIPES.chirp, AMBIENT_META.chirp, { pos: this.around(8, 45, 10), gain: 0.6 + 0.6 * s.birds, pitch: this.rng.range(0.8, 1.3) });
      }
    }
    // gocce singole in primo piano sopra il fruscio della pioggia
    for (let i = this.poisson(s.rain * 7, dt); i > 0; i--) {
      this.spawn(AMBIENT_RECIPES.droplet, AMBIENT_META.droplet, { pos: this.around(0.6, 5, 2), gain: 0.4 + 0.6 * s.rain });
    }
    // fronde mosse dalle raffiche
    for (let i = this.poisson(s.leaves * 0.7, dt); i > 0; i--) {
      this.spawn(RECIPES.rustle, META.rustle, { pos: this.around(4, 18, 6), gain: 0.35 + 0.5 * s.leaves, pitch: this.rng.range(0.8, 1.25) });
    }
  }
}
