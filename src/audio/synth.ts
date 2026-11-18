// Ricette di sintesi: ogni suono del gioco è costruito qui con oscillatori, rumore e filtri.
// Nessun file audio. Le ricette ricevono un contesto minimo (BaseAudioContext) e un nodo di
// uscita, quindi funzionano anche con un contesto finto nei test.
import type { LoopKind, SoundKind, Surface } from '../core/api';
import type { Rng } from '../core/rng';
import { HOSPITAL_LOOPS, HOSPITAL_RECIPES } from './hospitalSfx';
import { elevatorMusic, xmasMusic } from './music';

export type Ctx = BaseAudioContext;

export interface NoiseBank { white: AudioBuffer; pink: AudioBuffer; brown: AudioBuffer }

export interface RecipeParams {
  /** Moltiplicatore di altezza (1 = naturale). */
  pitch: number;
  rng: Rng;
  noise: NoiseBank;
}

/** Programma il suono a partire da `t` dentro `out`; restituisce la durata in secondi. */
export type Recipe = (c: Ctx, out: AudioNode, t: number, p: RecipeParams) => number;

const EPS = 0.0001;

// ---------------------------------------------------------------- rumore

export function createNoiseBank(c: Ctx, rng: Rng, seconds = 3): NoiseBank {
  const sr = c.sampleRate > 0 ? c.sampleRate : 44100;
  const len = Math.max(1024, Math.floor(sr * seconds));
  const make = (kind: 'white' | 'pink' | 'brown'): AudioBuffer => {
    const buf = c.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = rng.next() * 2 - 1;
      if (kind === 'white') {
        d[i] = w;
      } else if (kind === 'pink') {
        // filtro di Paul Kellet
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
        b6 = w * 0.115926;
      } else {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last;
      }
    }
    // toglie la deriva tra inizio e fine (niente clic al punto di loop) e normalizza
    const drift = d[len - 1] - d[0];
    let peak = EPS;
    for (let i = 0; i < len; i++) {
      d[i] -= (drift * i) / (len - 1);
      const a = Math.abs(d[i]);
      if (a > peak) peak = a;
    }
    const k = 0.9 / peak;
    for (let i = 0; i < len; i++) d[i] *= k;
    return buf;
  };
  return { white: make('white'), pink: make('pink'), brown: make('brown') };
}

// ---------------------------------------------------------------- mattoni

function gn(c: Ctx, v: number, out?: AudioNode): GainNode {
  const g = c.createGain();
  g.gain.value = v;
  if (out) g.connect(out);
  return g;
}

function bq(c: Ctx, type: BiquadFilterType, f: number, q: number, out?: AudioNode): BiquadFilterNode {
  const b = c.createBiquadFilter();
  b.type = type;
  b.frequency.value = Math.max(10, f);
  b.Q.value = q;
  if (out) b.connect(out);
  return b;
}

/** Inviluppo: salita lineare, tenuta, decadimento esponenziale fino a t+dur. */
function envAD(g: AudioParam, t: number, dur: number, peak: number, attack = 0.002, hold = 0): void {
  const a = Math.min(attack, dur * 0.5);
  const h = Math.min(hold, Math.max(0, dur - a - 0.005));
  g.setValueAtTime(EPS, t);
  g.linearRampToValueAtTime(Math.max(EPS, peak), t + a);
  if (h > 0) g.setValueAtTime(Math.max(EPS, peak), t + a + h);
  g.exponentialRampToValueAtTime(EPS, t + dur);
}

function sweep(param: AudioParam, t: number, dur: number, f: number, f2?: number): void {
  param.setValueAtTime(Math.max(1, f), t);
  if (f2 !== undefined && f2 !== f) param.exponentialRampToValueAtTime(Math.max(1, f2), t + dur);
}

function noiseSrc(c: Ctx, p: RecipeParams, buf: AudioBuffer, t: number, dur: number, rate = 1): AudioBufferSourceNode {
  const s = c.createBufferSource();
  s.buffer = buf;
  s.loop = true;
  s.playbackRate.value = rate;
  const len = buf.duration > 0 ? buf.duration : 1;
  s.start(t, p.rng.next() * len * 0.9);
  s.stop(t + dur + 0.02);
  return s;
}

interface NzOpts {
  buf?: AudioBuffer; dur: number; peak: number; attack?: number; hold?: number;
  type?: BiquadFilterType; f?: number; f2?: number; q?: number; rate?: number;
}

/** Raffica di rumore filtrato con inviluppo. */
function nz(c: Ctx, out: AudioNode, t: number, p: RecipeParams, o: NzOpts): void {
  const g = gn(c, 0, out);
  envAD(g.gain, t, o.dur, o.peak, o.attack, o.hold);
  const src = noiseSrc(c, p, o.buf ?? p.noise.white, t, o.dur, o.rate);
  if (o.type) {
    const f = bq(c, o.type, o.f ?? 1000, o.q ?? 0.7, g);
    sweep(f.frequency, t, o.dur, o.f ?? 1000, o.f2);
    src.connect(f);
  } else {
    src.connect(g);
  }
}

interface TnOpts {
  type?: OscillatorType; f: number; f2?: number; dur: number; peak: number; attack?: number; hold?: number;
  vibRate?: number; vibDepth?: number;
}

/** Nota di oscillatore con inviluppo e glissando facoltativo. */
function tn(c: Ctx, out: AudioNode, t: number, o: TnOpts): void {
  const g = gn(c, 0, out);
  envAD(g.gain, t, o.dur, o.peak, o.attack ?? 0.004, o.hold);
  const osc = c.createOscillator();
  osc.type = o.type ?? 'sine';
  sweep(osc.frequency, t, o.dur, o.f, o.f2);
  if (o.vibRate && o.vibDepth) {
    const l = c.createOscillator();
    l.frequency.value = o.vibRate;
    const lg = gn(c, o.vibDepth);
    l.connect(lg);
    lg.connect(osc.frequency);
    l.start(t);
    l.stop(t + o.dur + 0.02);
  }
  osc.connect(g);
  osc.start(t);
  osc.stop(t + o.dur + 0.02);
}

/** Nodo di guadagno modulato in ampiezza (tra 1-depth e 1) da un oscillatore lento. */
function am(c: Ctx, out: AudioNode, t: number, dur: number, rate: number, rate2: number, depth = 1, type: OscillatorType = 'square'): GainNode {
  const g = gn(c, 1 - depth / 2, out);
  const l = c.createOscillator();
  l.type = type;
  sweep(l.frequency, t, dur, rate, rate2);
  const lg = gn(c, depth / 2);
  l.connect(lg);
  lg.connect(g.gain);
  l.start(t);
  l.stop(t + dur + 0.02);
  return g;
}

/** Clic secco: transiente di rumore più un piccolo corpo tonale. */
function clickAt(c: Ctx, out: AudioNode, t: number, p: RecipeParams, f: number, peak: number, body = 0): void {
  nz(c, out, t, p, { dur: 0.012, peak, type: 'bandpass', f: f * p.pitch, q: 1.5, attack: 0.0005 });
  if (body > 0) tn(c, out, t, { f: body * p.pitch, f2: body * 0.6 * p.pitch, dur: 0.04, peak: peak * 0.8, attack: 0.001 });
}

/** Tonfo basso: sinusoide che scende più rumore sordo. */
function thud(c: Ctx, out: AudioNode, t: number, p: RecipeParams, f: number, dur: number, peak: number): void {
  tn(c, out, t, { f: f * p.pitch, f2: f * 0.5 * p.pitch, dur, peak, attack: 0.002 });
  nz(c, out, t, p, { buf: p.noise.brown, dur: dur * 0.8, peak: peak * 0.9, type: 'lowpass', f: 500, q: 0.5 });
}

/** Parziali inarmoniche da metallo percosso. */
function metal(c: Ctx, out: AudioNode, t: number, p: RecipeParams, f: number, dur: number, peak: number): void {
  const ratios = [1, 2.76, 5.4, 8.93];
  for (let i = 0; i < ratios.length; i++) {
    tn(c, out, t, {
      f: f * ratios[i] * p.pitch * (1 + (p.rng.next() - 0.5) * 0.02),
      dur: dur / (1 + i * 0.7), peak: peak / (1 + i * 1.3), attack: 0.001,
    });
  }
  nz(c, out, t, p, { dur: 0.02, peak: peak * 0.8, type: 'highpass', f: 2500, attack: 0.0005 });
}

/** Cigolio a strappi (attrito): impulsi bassi attraverso una risonanza che scorre. */
function creak(c: Ctx, out: AudioNode, t: number, p: RecipeParams, dur: number, peak: number, f0: number, f1: number, res: number): void {
  const g = gn(c, 0, out);
  g.gain.setValueAtTime(EPS, t);
  g.gain.linearRampToValueAtTime(peak, t + dur * 0.25);
  g.gain.setValueAtTime(peak, t + dur * 0.7);
  g.gain.exponentialRampToValueAtTime(EPS, t + dur);
  const f = bq(c, 'bandpass', res, 7, g);
  sweep(f.frequency, t, dur, res * p.pitch, res * 1.5 * p.pitch);
  const f2 = bq(c, 'bandpass', res * 2.3 * p.pitch, 9, g);
  const osc = c.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(f0, t);
  // andamento irregolare: l'attrito non è mai uniforme
  const steps = 5;
  for (let i = 1; i <= steps; i++) {
    const k = i / steps;
    osc.frequency.linearRampToValueAtTime((f0 + (f1 - f0) * k) * (0.8 + p.rng.next() * 0.4), t + dur * k);
  }
  osc.connect(f);
  osc.connect(f2);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

/** Motore: dente di sega filtrato con battito, frequenza programmabile a segmenti. */
function engine(c: Ctx, out: AudioNode, t: number, p: RecipeParams, pts: [number, number, number][], lp: number): number {
  // pts: [tempo relativo, frequenza, guadagno]
  const total = pts[pts.length - 1][0];
  const g = gn(c, 0, out);
  const f = bq(c, 'lowpass', lp, 1.2, g);
  const osc = c.createOscillator();
  osc.type = 'sawtooth';
  const sub = c.createOscillator();
  sub.type = 'square';
  const subG = gn(c, 0.5, f);
  g.gain.setValueAtTime(EPS, t);
  osc.frequency.setValueAtTime(pts[0][1] * p.pitch, t);
  sub.frequency.setValueAtTime(pts[0][1] * 0.5 * p.pitch, t);
  for (const [dt, fr, ga] of pts) {
    osc.frequency.linearRampToValueAtTime(fr * p.pitch, t + dt + 0.001);
    sub.frequency.linearRampToValueAtTime(fr * 0.5 * p.pitch, t + dt + 0.001);
    g.gain.linearRampToValueAtTime(Math.max(EPS, ga), t + dt + 0.001);
  }
  osc.connect(f);
  sub.connect(subG);
  const n = noiseSrc(c, p, p.noise.brown, t, total);
  n.connect(gn(c, 0.6, f));
  osc.start(t);
  sub.start(t);
  osc.stop(t + total + 0.05);
  sub.stop(t + total + 0.05);
  return total;
}

/** Fruscio irregolare: più raffiche di rumore acuto. */
function rustleBursts(c: Ctx, out: AudioNode, t: number, p: RecipeParams, n: number, span: number, f: number, peak: number, buf: AudioBuffer): number {
  let end = 0;
  for (let i = 0; i < n; i++) {
    const at = (span * i) / n + p.rng.next() * (span / n) * 0.6;
    const dur = 0.08 + p.rng.next() * 0.16;
    nz(c, out, t + at, p, {
      buf, dur, peak: peak * (0.5 + p.rng.next() * 0.5), attack: 0.02,
      type: 'bandpass', f: f * (0.8 + p.rng.next() * 0.5) * p.pitch, q: 0.8,
    });
    end = Math.max(end, at + dur);
  }
  return end;
}

/** Verso con "voce": dente di sega raschiato attraverso una formante. */
function call(c: Ctx, out: AudioNode, t: number, p: RecipeParams, o: { f: number; fMid?: number; f2: number; dur: number; peak: number; formant: number; q: number; rasp: number; breath?: number }): void {
  const g = gn(c, 0, out);
  envAD(g.gain, t, o.dur, o.peak, o.dur * 0.15, o.dur * 0.3);
  const body = o.rasp > 0 ? am(c, g, t, o.dur, o.rasp, o.rasp * 0.9, 0.8, 'sawtooth') : g;
  const f = bq(c, 'bandpass', o.formant * p.pitch, o.q, body);
  const osc = c.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(o.f * p.pitch, t);
  if (o.fMid !== undefined) osc.frequency.linearRampToValueAtTime(o.fMid * p.pitch, t + o.dur * 0.35);
  osc.frequency.linearRampToValueAtTime(o.f2 * p.pitch, t + o.dur);
  osc.connect(f);
  osc.start(t);
  osc.stop(t + o.dur + 0.02);
  if (o.breath) nz(c, body, t, p, { dur: o.dur, peak: o.breath, attack: o.dur * 0.2, type: 'bandpass', f: o.formant * 1.4 * p.pitch, q: 1 });
}

// ---------------------------------------------------------------- ricette one-shot

export const RECIPES: Record<SoundKind, Recipe> = {
  ...HOSPITAL_RECIPES,
  alien_call(c, out, t, p) {
    const n = p.rng.int(2, 4);
    for (let i = 0; i < n; i++) call(c, out, t + i * 0.32, p, { f: 370 + p.rng.next() * 160, fMid: 1100, f2: 180, dur: 0.27, peak: 0.45, formant: 1900, q: 5, rasp: 33, breath: 0.12 });
    return n * 0.32 + 0.15;
  },
  bigfoot_growl(c, out, t, p) {
    call(c, out, t, p, { f: 78, fMid: 115, f2: 48, dur: 1.8, peak: 0.65, formant: 280, q: 2, rasp: 26, breath: 0.4 });
    return 2;
  },
  cult_chant(c, out, t, p) {
    for (let i = 0; i < 3; i++) call(c, out, t + i * 0.18, p, { f: 95 + i * 14, fMid: 110 + i * 12, f2: 88 + i * 10, dur: 2.7, peak: 0.18, formant: 660, q: 2, rasp: 8, breath: 0.15 });
    return 3.3;
  },
  door_open(c, out, t, p) {
    clickAt(c, out, t, p, 1800, 0.5, 240);
    creak(c, out, t + 0.05, p, 0.85 + p.rng.next() * 0.3, 0.5, 38, 64, 820);
    return 1.25;
  },
  door_close(c, out, t, p) {
    creak(c, out, t, p, 0.32, 0.35, 60, 40, 700);
    thud(c, out, t + 0.33, p, 85, 0.22, 0.9);
    clickAt(c, out, t + 0.36, p, 2200, 0.45, 300);
    return 0.62;
  },
  door_locked(c, out, t, p) {
    // maniglia che fa resistenza: scatti metallici ravvicinati e un colpo sordo del battente
    const n = 3 + p.rng.int(0, 1);
    for (let i = 0; i < n; i++) {
      const at = i * (0.11 + p.rng.next() * 0.04);
      clickAt(c, out, t + at, p, 2600 + p.rng.next() * 800, 0.55, 420);
      tn(c, out, t + at, { f: 3100 * p.pitch, dur: 0.05, peak: 0.08, attack: 0.001 });
    }
    thud(c, out, t + 0.06, p, 110, 0.12, 0.35);
    thud(c, out, t + 0.3, p, 100, 0.12, 0.3);
    return 0.62;
  },
  door_bang(c, out, t, p) {
    thud(c, out, t, p, 70, 0.55, 1);
    nz(c, out, t, p, { dur: 0.09, peak: 0.7, type: 'bandpass', f: 900, q: 0.8, attack: 0.001 });
    clickAt(c, out, t + 0.05, p, 2400, 0.3, 0);
    clickAt(c, out, t + 0.11, p, 2000, 0.18, 0);
    return 0.65;
  },
  switch(c, out, t, p) {
    clickAt(c, out, t, p, 3200, 0.7, 900);
    clickAt(c, out, t + 0.018, p, 2400, 0.35, 0);
    return 0.08;
  },
  generator_start(c, out, t, p) {
    // strappo della fune, due colpi a vuoto, poi il motore prende
    nz(c, out, t, p, { buf: p.noise.pink, dur: 0.35, peak: 0.5, attack: 0.05, type: 'bandpass', f: 500, f2: 1600, q: 1.5 });
    const d = engine(c, out, t + 0.3, p, [[0, 16, 0.2], [0.35, 24, 0.5], [0.6, 15, 0.25], [1.0, 30, 0.6], [1.6, 58, 0.8], [2.3, 52, 0.7], [2.6, 52, 0.0001]], 420);
    return 0.3 + d;
  },
  generator_stop(c, out, t, p) {
    const d = engine(c, out, t, p, [[0, 52, 0.7], [0.5, 40, 0.6], [1.2, 18, 0.4], [1.7, 9, 0.0001]], 380);
    thud(c, out, t + 1.55, p, 90, 0.15, 0.3);
    return d + 0.1;
  },
  drawer(c, out, t, p) {
    nz(c, out, t, p, { buf: p.noise.pink, dur: 0.42, peak: 0.5, attack: 0.06, hold: 0.25, type: 'bandpass', f: 380, f2: 620, q: 1.2 });
    nz(c, out, t, p, { buf: p.noise.brown, dur: 0.42, peak: 0.5, attack: 0.05, hold: 0.25, type: 'lowpass', f: 180 });
    thud(c, out, t + 0.42, p, 150, 0.1, 0.55);
    clickAt(c, out, t + 0.43, p, 1200, 0.25, 0);
    return 0.56;
  },
  tent_zip(c, out, t, p) {
    // dentini della cerniera: rumore acuto spezzato da un'onda quadra che accelera e rallenta
    const dur = 0.75 + p.rng.next() * 0.25;
    const g = gn(c, 0, out);
    g.gain.setValueAtTime(EPS, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.06);
    g.gain.setValueAtTime(0.5, t + dur - 0.1);
    g.gain.exponentialRampToValueAtTime(EPS, t + dur);
    const a = am(c, g, t, dur, 70, 190, 1);
    const f = bq(c, 'bandpass', 3400 * p.pitch, 1.4, a);
    sweep(f.frequency, t, dur, 2600 * p.pitch, 4600 * p.pitch);
    noiseSrc(c, p, p.noise.white, t, dur).connect(f);
    return dur;
  },
  breaker(c, out, t, p) {
    thud(c, out, t, p, 120, 0.16, 0.9);
    nz(c, out, t, p, { dur: 0.03, peak: 0.8, type: 'bandpass', f: 1800, q: 6, attack: 0.0005 });
    tn(c, out, t + 0.005, { f: 640 * p.pitch, dur: 0.14, peak: 0.18, vibRate: 40, vibDepth: 30 });
    return 0.2;
  },
  metal_clank(c, out, t, p) {
    metal(c, out, t, p, 520 + p.rng.next() * 120, 0.7, 0.6);
    if (p.rng.chance(0.5)) metal(c, out, t + 0.09 + p.rng.next() * 0.06, p, 610, 0.4, 0.25);
    return 0.8;
  },
  bin_tip(c, out, t, p) {
    // bidone che si rovescia: colpo cavo, coperchio, rotolio e ultimi rimbalzi
    thud(c, out, t, p, 95, 0.3, 0.9);
    metal(c, out, t, p, 190, 0.6, 0.5);
    metal(c, out, t + 0.16, p, 430, 0.5, 0.35);
    nz(c, out, t + 0.1, p, { buf: p.noise.pink, dur: 0.9, peak: 0.35, attack: 0.1, type: 'bandpass', f: 700, f2: 350, q: 1 });
    let at = 0.35;
    for (let i = 0; i < 4; i++) {
      metal(c, out, t + at, p, 260 + p.rng.next() * 200, 0.3, 0.3 / (1 + i));
      at += 0.12 + p.rng.next() * 0.14;
    }
    return 1.3;
  },
  twig(c, out, t, p) {
    nz(c, out, t, p, { dur: 0.03, peak: 0.9, type: 'highpass', f: 1400 * p.pitch, attack: 0.0005 });
    nz(c, out, t, p, { dur: 0.05, peak: 0.5, type: 'bandpass', f: 850 * p.pitch, q: 3, attack: 0.0005 });
    nz(c, out, t + 0.035 + p.rng.next() * 0.03, p, { dur: 0.025, peak: 0.4, type: 'highpass', f: 1900 * p.pitch, attack: 0.0005 });
    return 0.12;
  },
  owl(c, out, t, p) {
    // "hu… hu-hu… huuu"
    const base = (330 + p.rng.next() * 50) * p.pitch;
    const lp = bq(c, 'lowpass', 900, 0.7, out);
    const notes: [number, number][] = [[0, 0.28], [0.55, 0.16], [0.78, 0.18], [1.2, 0.55]];
    for (const [at, dur] of notes) {
      tn(c, lp, t + at, { type: 'triangle', f: base * 1.04, f2: base * 0.93, dur, peak: 0.6, attack: dur * 0.3, hold: dur * 0.2, vibRate: 5, vibDepth: 4 });
      nz(c, lp, t + at, p, { dur, peak: 0.04, attack: dur * 0.3, type: 'bandpass', f: base, q: 4 });
    }
    return 1.8;
  },
  fox(c, out, t, p) {
    // guaito rauco che sale e ricade; a volte ripetuto
    const n = 1 + p.rng.int(0, 2);
    let at = 0;
    for (let i = 0; i < n; i++) {
      const dur = 0.4 + p.rng.next() * 0.25;
      call(c, out, t + at, p, { f: 650, fMid: 1150 + p.rng.next() * 200, f2: 560, dur, peak: 0.6, formant: 1600, q: 2.5, rasp: 65, breath: 0.15 });
      at += dur + 0.25 + p.rng.next() * 0.5;
    }
    return at;
  },
  deer(c, out, t, p) {
    // abbaio breve e basso del capriolo
    const n = 1 + p.rng.int(0, 1);
    let at = 0;
    for (let i = 0; i < n; i++) {
      call(c, out, t + at, p, { f: 250, f2: 165, dur: 0.24, peak: 0.7, formant: 620, q: 2, rasp: 38, breath: 0.2 });
      at += 0.9 + p.rng.next() * 0.8;
    }
    return at;
  },
  crows(c, out, t, p) {
    const n = 4 + p.rng.int(0, 3);
    let at = 0;
    for (let i = 0; i < n; i++) {
      const dur = 0.17 + p.rng.next() * 0.1;
      const f = 400 + p.rng.next() * 90;
      call(c, out, t + at, p, { f, fMid: f * 1.12, f2: f * 0.8, dur, peak: 0.45 + p.rng.next() * 0.25, formant: 1350 + p.rng.next() * 300, q: 2.2, rasp: 75, breath: 0.12 });
      at += dur + 0.06 + p.rng.next() * 0.3;
    }
    return at;
  },
  screech(c, out, t, p) {
    // strido lungo e rauco (barbagianni): rumore stretto che sale, con raspa
    const dur = 0.9 + p.rng.next() * 0.7;
    call(c, out, t, p, { f: 1500, fMid: 2100 + p.rng.next() * 300, f2: 1700, dur, peak: 0.42, formant: 2600, q: 1.6, rasp: 95, breath: 0.5 });
    nz(c, out, t, p, { dur, peak: 0.16, attack: dur * 0.2, hold: dur * 0.4, type: 'bandpass', f: 3000 * p.pitch, f2: 3900 * p.pitch, q: 2.5 });
    return dur + 0.05;
  },
  nightbird(c, out, t, p) {
    // richiamo che non si riconosce: fischi discendenti con tremolo, a volte chiusi da un trillo secco
    const lp = bq(c, 'lowpass', 2600, 0.7, out);
    const n = 2 + p.rng.int(0, 2), base = (760 + p.rng.next() * 240) * p.pitch;
    let at = 0;
    for (let i = 0; i < n; i++) {
      const dur = 0.42 + p.rng.next() * 0.3, f = base * (1 - i * 0.07);
      tn(c, lp, t + at, { type: 'sine', f: f * 1.22, f2: f * 0.72, dur, peak: 0.5, attack: dur * 0.12, hold: dur * 0.25, vibRate: 17 + p.rng.next() * 6, vibDepth: 28 });
      tn(c, lp, t + at, { type: 'triangle', f: f * 2.44, f2: f * 1.44, dur: dur * 0.8, peak: 0.07, attack: dur * 0.12 });
      at += dur + 0.14 + p.rng.next() * 0.35;
    }
    if (p.rng.next() < 0.45) {
      for (let k = 0; k < 7; k++) tn(c, lp, t + at + k * 0.055, { type: 'triangle', f: base * 0.55, f2: base * 0.5, dur: 0.04, peak: 0.3, attack: 0.004 });
      at += 0.42;
    }
    return at;
  },
  frog(c, out, t, p) {
    const n = 1 + p.rng.int(0, 1);
    const pitch = p.pitch * (0.85 + p.rng.next() * 0.35);
    let at = 0;
    for (let i = 0; i < n; i++) {
      const dur = 0.2 + p.rng.next() * 0.12;
      const g = gn(c, 0, out);
      envAD(g.gain, t + at, dur, 0.6, 0.03, dur * 0.5);
      const a = am(c, g, t + at, dur, 28, 22, 1);
      const f = bq(c, 'bandpass', 1050 * pitch, 5, a);
      const f2 = bq(c, 'bandpass', 2300 * pitch, 6, gn(c, 0.4, a));
      const osc = c.createOscillator();
      osc.type = 'sawtooth';
      sweep(osc.frequency, t + at, dur, 105 * pitch, 92 * pitch);
      osc.connect(f);
      osc.connect(f2);
      osc.start(t + at);
      osc.stop(t + at + dur + 0.02);
      at += dur + 0.12;
    }
    return at;
  },
  splash(c, out, t, p) {
    nz(c, out, t, p, { dur: 0.6, peak: 0.8, attack: 0.008, type: 'lowpass', f: 3200, f2: 500, q: 0.6 });
    nz(c, out, t + 0.03, p, { dur: 0.35, peak: 0.3, attack: 0.02, type: 'highpass', f: 3500 });
    for (let i = 0; i < 5; i++) {
      const at = 0.12 + p.rng.next() * 0.5;
      const f = 380 + p.rng.next() * 500;
      tn(c, out, t + at, { f: f * p.pitch, f2: f * 1.8 * p.pitch, dur: 0.05, peak: 0.12, attack: 0.004 });
    }
    return 0.75;
  },
  vehicle_pass(c, out, t, p) {
    // passaggio lontano: fruscio delle gomme che si apre e si richiude, motore con lieve Doppler
    const dur = 6.5;
    const mid = dur * 0.48;
    const g = gn(c, 0, out);
    g.gain.setValueAtTime(0.008, t);
    g.gain.exponentialRampToValueAtTime(0.7, t + mid);
    g.gain.exponentialRampToValueAtTime(EPS, t + dur);
    const f = bq(c, 'lowpass', 200, 0.6, g);
    f.frequency.setValueAtTime(180, t);
    f.frequency.exponentialRampToValueAtTime(1300, t + mid);
    f.frequency.exponentialRampToValueAtTime(160, t + dur);
    noiseSrc(c, p, p.noise.pink, t, dur).connect(f);
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(78 * p.pitch, t);
    osc.frequency.setValueAtTime(78 * p.pitch, t + mid - 0.5);
    osc.frequency.linearRampToValueAtTime(66 * p.pitch, t + mid + 0.7);
    osc.connect(gn(c, 0.5, bq(c, 'lowpass', 260, 1, g)));
    osc.start(t);
    osc.stop(t + dur + 0.05);
    return dur;
  },
  vehicle_start(c, out, t, p) {
    // motorino d'avviamento che arranca, poi il motore parte e si assesta
    const crank = 0.8;
    const g = gn(c, 0, out);
    envAD(g.gain, t, crank, 0.45, 0.03, crank * 0.75);
    const a = am(c, g, t, crank, 8.5, 10, 0.8, 'sine');
    const f = bq(c, 'bandpass', 520, 1.5, a);
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    sweep(osc.frequency, t, crank, 130 * p.pitch, 150 * p.pitch);
    osc.connect(f);
    osc.start(t);
    osc.stop(t + crank + 0.02);
    const d = engine(c, out, t + crank - 0.1, p, [[0, 30, 0.3], [0.35, 78, 0.85], [0.9, 50, 0.6], [2.0, 44, 0.5], [2.6, 44, 0.0001]], 340);
    return crank - 0.1 + d;
  },
  car_door(c, out, t, p) {
    clickAt(c, out, t, p, 1500, 0.3, 0);
    thud(c, out, t + 0.05, p, 95, 0.2, 1);
    nz(c, out, t + 0.05, p, { dur: 0.05, peak: 0.5, type: 'bandpass', f: 650, q: 1.2, attack: 0.001 });
    return 0.3;
  },
  typing(c, out, t, p) {
    const n = 5 + p.rng.int(0, 3);
    let at = 0;
    for (let i = 0; i < n; i++) {
      clickAt(c, out, t + at, p, 2200 + p.rng.next() * 1300, 0.4 + p.rng.next() * 0.25, 190);
      at += 0.06 + p.rng.next() * 0.08;
    }
    return at + 0.04;
  },
  paper(c, out, t, p) {
    const d = rustleBursts(c, out, t, p, 4, 0.42, 4200, 0.45, p.noise.white);
    nz(c, out, t, p, { dur: 0.4, peak: 0.12, attack: 0.05, type: 'highpass', f: 2500 });
    return Math.max(d, 0.42);
  },
  camera(c, out, t, p) {
    clickAt(c, out, t, p, 3000, 0.7, 500);
    nz(c, out, t + 0.012, p, { dur: 0.06, peak: 0.25, attack: 0.01, type: 'highpass', f: 4000 });
    clickAt(c, out, t + 0.07, p, 2300, 0.55, 380);
    tn(c, out, t + 0.09, { type: 'sawtooth', f: 190 * p.pitch, f2: 230 * p.pitch, dur: 0.09, peak: 0.05, attack: 0.01 });
    return 0.2;
  },
  radio(c, out, t, p) {
    // radio di servizio: scatto del tasto, soffio filtrato e coda di squelch
    clickAt(c, out, t, p, 1600, 0.5, 220);
    nz(c, out, t + 0.01, p, { dur: 0.32, peak: 0.22, attack: 0.01, type: 'bandpass', f: 1900 });
    tn(c, out, t + 0.02, { type: 'square', f: 1450 * p.pitch, dur: 0.05, peak: 0.04, attack: 0.003 });
    nz(c, out, t + 0.34, p, { dur: 0.12, peak: 0.12, attack: 0.004, type: 'highpass', f: 2600 });
    return 0.5;
  },
  sms(c, out, t, p) {
    const notes: [number, number][] = [[0, 880], [0.13, 1318.5]];
    for (const [at, f] of notes) {
      tn(c, out, t + at, { f: f * p.pitch, dur: 0.5, peak: 0.5, attack: 0.004 });
      tn(c, out, t + at, { f: f * 2.01 * p.pitch, dur: 0.22, peak: 0.12, attack: 0.003 });
    }
    return 0.65;
  },
  battery(c, out, t, p) {
    // pila che entra nella sede: scatto di plastica, molla, secondo scatto
    clickAt(c, out, t, p, 1300, 0.6, 260);
    tn(c, out, t + 0.004, { f: 2300 * p.pitch, f2: 2150 * p.pitch, dur: 0.09, peak: 0.09, vibRate: 55, vibDepth: 60 });
    clickAt(c, out, t + 0.09, p, 1700, 0.45, 200);
    return 0.16;
  },
  click(c, out, t, p) {
    clickAt(c, out, t, p, 2600, 0.6, 1000);
    return 0.05;
  },
  steps_far(c, out, t, p) {
    const n = 4 + p.rng.int(0, 2);
    const gap = 0.46 + p.rng.next() * 0.14;
    let at = 0;
    for (let i = 0; i < n; i++) {
      nz(c, out, t + at, p, { buf: p.noise.pink, dur: 0.09, peak: 0.6 * (0.8 + p.rng.next() * 0.4), attack: 0.006, type: 'lowpass', f: 480 + (i % 2) * 70, q: 0.8 });
      nz(c, out, t + at + 0.02, p, { dur: 0.05, peak: 0.08, attack: 0.01, type: 'bandpass', f: 1800, q: 1 });
      at += gap * (0.93 + p.rng.next() * 0.14);
    }
    return at;
  },
  voice_far(c, out, t, p) {
    // voce lontana e incomprensibile: sorgente glottale più fiato, due formanti che cambiano
    // a ogni "sillaba", tutto ovattato. Nessuna parola.
    const syl = 5 + p.rng.int(0, 4);
    const muffle = bq(c, 'lowpass', 1500, 0.5, out);
    const f0 = (105 + p.rng.next() * 70) * p.pitch;
    let at = 0;
    for (let i = 0; i < syl; i++) {
      const dur = 0.11 + p.rng.next() * 0.16;
      const g = gn(c, 0, muffle);
      envAD(g.gain, t + at, dur, 0.5 * (0.6 + p.rng.next() * 0.4), dur * 0.3, dur * 0.3);
      const F1 = 300 + p.rng.next() * 500;
      const F2 = 900 + p.rng.next() * 1300;
      const b1 = bq(c, 'bandpass', F1, 5, g);
      const b2 = bq(c, 'bandpass', F2, 7, gn(c, 0.6, g));
      const osc = c.createOscillator();
      osc.type = 'sawtooth';
      const fa = f0 * (0.9 + p.rng.next() * 0.25);
      sweep(osc.frequency, t + at, dur, fa, fa * (0.88 + p.rng.next() * 0.2));
      osc.connect(b1);
      osc.connect(b2);
      osc.start(t + at);
      osc.stop(t + at + dur + 0.02);
      const n = noiseSrc(c, p, p.noise.pink, t + at, dur);
      const ng = gn(c, 0.25);
      n.connect(ng);
      ng.connect(b1);
      ng.connect(b2);
      at += dur + (p.rng.chance(0.25) ? 0.18 + p.rng.next() * 0.2 : 0.02 + p.rng.next() * 0.05);
    }
    return at;
  },
  knock(c, out, t, p) {
    const n = 3;
    const gap = 0.2 + p.rng.next() * 0.06;
    for (let i = 0; i < n; i++) {
      const at = i * gap;
      tn(c, out, t + at, { f: 190 * p.pitch, f2: 120 * p.pitch, dur: 0.09, peak: 0.9, attack: 0.001 });
      nz(c, out, t + at, p, { dur: 0.05, peak: 0.6, type: 'bandpass', f: 420 * p.pitch, q: 3, attack: 0.001 });
    }
    return gap * (n - 1) + 0.12;
  },
  hum_anom(c, out, t, p) {
    // ronzio basso con parziali non armoniche che battono tra loro
    const dur = 3.6;
    const g = gn(c, 0, out);
    g.gain.setValueAtTime(EPS, t);
    g.gain.linearRampToValueAtTime(0.5, t + 1.3);
    g.gain.setValueAtTime(0.5, t + dur - 1.4);
    g.gain.linearRampToValueAtTime(EPS, t + dur);
    const fs = [55, 82.7, 110.6, 165.3];
    for (let i = 0; i < fs.length; i++) {
      const o = c.createOscillator();
      o.type = i === 0 ? 'triangle' : 'sine';
      o.frequency.value = fs[i] * p.pitch;
      o.connect(gn(c, 0.5 / (1 + i), g));
      o.start(t);
      o.stop(t + dur + 0.05);
    }
    const hi = c.createOscillator();
    hi.frequency.value = 3870 * p.pitch;
    hi.connect(gn(c, 0.012, g));
    hi.start(t);
    hi.stop(t + dur + 0.05);
    return dur;
  },
  whisper_anom(c, out, t, p) {
    // sussurro senza parole: fiato filtrato da formanti in movimento, attacchi lenti e chiusure brusche
    const syl = 6 + p.rng.int(0, 4);
    let at = 0;
    for (let i = 0; i < syl; i++) {
      const dur = 0.16 + p.rng.next() * 0.22;
      const g = gn(c, 0, out);
      g.gain.setValueAtTime(EPS, t + at);
      g.gain.exponentialRampToValueAtTime(0.45 * (0.5 + p.rng.next() * 0.5), t + at + dur * 0.85);
      g.gain.exponentialRampToValueAtTime(EPS, t + at + dur);
      const F = 900 + p.rng.next() * 1700;
      const b = bq(c, 'bandpass', F, 4, g);
      sweep(b.frequency, t + at, dur, F * p.pitch, F * (0.7 + p.rng.next() * 0.8) * p.pitch);
      const b2 = bq(c, 'bandpass', (3000 + p.rng.next() * 1500) * p.pitch, 3, gn(c, 0.5, g));
      const n = noiseSrc(c, p, p.noise.white, t + at, dur);
      n.connect(b);
      n.connect(b2);
      at += dur + p.rng.next() * 0.12;
    }
    return at;
  },
  tone_anom(c, out, t, p) {
    // tono puro con battimento lento che alla fine scivola in basso
    const dur = 3.2;
    const g = gn(c, 0, out);
    g.gain.setValueAtTime(EPS, t);
    g.gain.linearRampToValueAtTime(0.4, t + 0.9);
    g.gain.setValueAtTime(0.4, t + dur - 1.2);
    g.gain.linearRampToValueAtTime(EPS, t + dur);
    const f = 1870 * p.pitch;
    for (const k of [1, 1.0016]) {
      const o = c.createOscillator();
      o.frequency.setValueAtTime(f * k, t);
      o.frequency.setValueAtTime(f * k, t + dur - 1.0);
      o.frequency.exponentialRampToValueAtTime(f * k * 0.667, t + dur);
      o.connect(gn(c, 0.5, g));
      o.start(t);
      o.stop(t + dur + 0.05);
    }
    return dur;
  },
  thunder(c, out, t, p) {
    const dur = 5.5 + p.rng.next() * 2.5;
    // schiocco iniziale (più netto se vicino: ci pensa la distanza ad attenuarlo)
    nz(c, out, t, p, { dur: 0.3, peak: 0.6, attack: 0.004, type: 'lowpass', f: 2600, f2: 500, q: 0.5 });
    nz(c, out, t, p, { buf: p.noise.brown, dur, peak: 1, attack: 0.05, hold: 0.5, type: 'lowpass', f: 320 * p.pitch, f2: 60, q: 0.6 });
    // rotolii successivi
    const rolls = 3 + p.rng.int(0, 2);
    for (let i = 0; i < rolls; i++) {
      const at = 0.4 + p.rng.next() * (dur * 0.55);
      nz(c, out, t + at, p, { buf: p.noise.brown, dur: 0.9 + p.rng.next() * 1.2, peak: 0.6 * p.rng.range(0.4, 1), attack: 0.15, type: 'lowpass', f: 200 + p.rng.next() * 150, f2: 70, q: 0.7 });
    }
    return dur;
  },
  branch_fall(c, out, t, p) {
    // schianto del legno, fruscio della caduta tra le fronde, tonfo a terra
    nz(c, out, t, p, { dur: 0.06, peak: 0.9, type: 'bandpass', f: 700 * p.pitch, q: 1.5, attack: 0.0005 });
    nz(c, out, t + 0.05, p, { dur: 0.05, peak: 0.6, type: 'highpass', f: 1100, attack: 0.0005 });
    creak(c, out, t + 0.02, p, 0.3, 0.3, 45, 90, 520);
    nz(c, out, t + 0.25, p, { buf: p.noise.pink, dur: 0.75, peak: 0.45, attack: 0.2, type: 'highpass', f: 1800 });
    thud(c, out, t + 0.95, p, 75, 0.3, 0.9);
    rustleBursts(c, out, t + 1.0, p, 3, 0.35, 2600, 0.3, p.noise.pink);
    return 1.5;
  },
  fire_douse(c, out, t, p) {
    const dur = 2.0;
    nz(c, out, t, p, { dur, peak: 0.7, attack: 0.03, hold: 0.25, type: 'highpass', f: 2800, f2: 4500 });
    // sfrigolio del vapore
    const g = gn(c, 0, out);
    envAD(g.gain, t, dur * 0.8, 0.35, 0.05, 0.3);
    const a = am(c, g, t, dur * 0.8, 23, 9, 0.9, 'sawtooth');
    noiseSrc(c, p, p.noise.pink, t, dur * 0.8).connect(bq(c, 'bandpass', 1200, 0.8, a));
    for (let i = 0; i < 6; i++) clickAt(c, out, t + 0.1 + p.rng.next() * 1.2, p, 1800 + p.rng.next() * 2000, 0.2, 0);
    return dur;
  },
  ui(c, out, t, p) {
    tn(c, out, t, { f: 680 * p.pitch, dur: 0.045, peak: 0.4, attack: 0.002 });
    nz(c, out, t, p, { dur: 0.008, peak: 0.12, type: 'highpass', f: 3000, attack: 0.0005 });
    return 0.05;
  },
  torch_click(c, out, t, p) {
    clickAt(c, out, t, p, 3400, 0.7, 150);
    clickAt(c, out, t + 0.032, p, 2700, 0.3, 0);
    return 0.08;
  },
  rustle(c, out, t, p) {
    const n = 3 + p.rng.int(0, 3);
    return rustleBursts(c, out, t, p, n, 0.55 + p.rng.next() * 0.4, 2900, 0.5, p.noise.pink);
  },
  chair_scrape(c, out, t, p) {
    const dur = 0.5 + p.rng.next() * 0.25;
    creak(c, out, t, p, dur, 0.45, 58, 76, 460);
    nz(c, out, t, p, { buf: p.noise.pink, dur, peak: 0.25, attack: 0.05, hold: dur * 0.5, type: 'bandpass', f: 1300, q: 1.2 });
    thud(c, out, t + dur, p, 140, 0.06, 0.25);
    return dur + 0.08;
  },
  /** Un passo che non è il tuo: stesso terreno, appena più pesante. */
  mimic_step(c, out, t, p) {
    return footstepRecipe(c, out, t, p, 'dirt', false, p.rng.next() < 0.5);
  },
  report_sent(c, out, t, p) {
    nz(c, out, t, p, { dur: 0.28, peak: 0.25, attack: 0.12, type: 'bandpass', f: 600, f2: 3200, q: 2 });
    tn(c, out, t + 0.24, { f: 659.3 * p.pitch, dur: 0.3, peak: 0.4 });
    tn(c, out, t + 0.36, { f: 987.8 * p.pitch, dur: 0.5, peak: 0.4 });
    return 0.9;
  },
};

/** Suoni interni dell'ambiente (non richiamabili dal gioco). */
export const AMBIENT_RECIPES = {
  /** Goccia singola su foglia o terreno. */
  droplet(c: Ctx, out: AudioNode, t: number, p: RecipeParams): number {
    const f = 1500 + p.rng.next() * 3000;
    if (p.rng.chance(0.5)) {
      tn(c, out, t, { f, f2: f * 1.5, dur: 0.03, peak: 0.3, attack: 0.002 });
    } else {
      nz(c, out, t, p, { dur: 0.025, peak: 0.4, type: 'bandpass', f, q: 3, attack: 0.001 });
    }
    return 0.05;
  },
  /** Breve frase di uccello diurno: poche note acute con glissando. */
  chirp(c: Ctx, out: AudioNode, t: number, p: RecipeParams): number {
    const n = 2 + p.rng.int(0, 4);
    const base = (2200 + p.rng.next() * 2400) * p.pitch;
    const trill = p.rng.chance(0.3);
    let at = 0;
    for (let i = 0; i < n; i++) {
      const dur = trill ? 0.05 : 0.06 + p.rng.next() * 0.1;
      const f = base * (trill ? 1 : 0.8 + p.rng.next() * 0.5);
      tn(c, out, t + at, { f, f2: f * (0.8 + p.rng.next() * 0.5), dur, peak: 0.4, attack: dur * 0.25 });
      at += dur + (trill ? 0.02 : 0.03 + p.rng.next() * 0.09);
    }
    return at;
  },
} satisfies Record<string, Recipe>;

export type AmbientRecipeId = keyof typeof AMBIENT_RECIPES;

// ---------------------------------------------------------------- passi

interface StepSpec { f: number; q: number; dur: number; low: number; type: BiquadFilterType; pink: boolean; peak: number }

const STEP: Record<Surface, StepSpec> = {
  grass: { f: 1100, q: 0.6, dur: 0.11, low: 0.25, type: 'bandpass', pink: true, peak: 0.5 },
  dirt: { f: 560, q: 0.8, dur: 0.09, low: 0.5, type: 'bandpass', pink: true, peak: 0.55 },
  road: { f: 1900, q: 1.2, dur: 0.045, low: 0.55, type: 'bandpass', pink: false, peak: 0.45 },
  wood: { f: 720, q: 3.5, dur: 0.07, low: 0.9, type: 'bandpass', pink: true, peak: 0.5 },
  snow: { f: 1500, q: 0.5, dur: 0.17, low: 0.2, type: 'highpass', pink: false, peak: 0.4 },
  floor: { f: 1400, q: 2, dur: 0.04, low: 0.6, type: 'bandpass', pink: false, peak: 0.4 },
  wet: { f: 900, q: 0.7, dur: 0.12, low: 0.35, type: 'bandpass', pink: true, peak: 0.5 },
};

/** Passo del giocatore: `alt` alterna piede sinistro/destro con piccole differenze. */
export function footstepRecipe(c: Ctx, out: AudioNode, t: number, p: RecipeParams, surface: Surface, running: boolean, alt: boolean): number {
  const s = STEP[surface] ?? STEP.dirt;
  const k = (alt ? 1.06 : 0.95) * (0.94 + p.rng.next() * 0.12) * (running ? 1.12 : 1) * p.pitch;
  const loud = (running ? 1.35 : 1) * (0.85 + p.rng.next() * 0.3);
  const dur = s.dur * (running ? 0.8 : 1);
  // tallone
  nz(c, out, t, p, { buf: s.pink ? p.noise.pink : p.noise.white, dur, peak: s.peak * loud, attack: 0.004, type: s.type, f: s.f * k, q: s.q });
  tn(c, out, t, { f: (surface === 'wood' ? 170 : 105) * k, f2: 60 * k, dur: 0.06, peak: s.low * 0.5 * loud, attack: 0.002 });
  // punta, poco dopo
  nz(c, out, t + dur * 0.55, p, { buf: p.noise.pink, dur: dur * 0.7, peak: s.peak * 0.4 * loud, attack: 0.006, type: s.type, f: s.f * 1.25 * k, q: s.q });
  if (surface === 'snow') {
    // scricchiolio della neve compressa
    const g = gn(c, 0, out);
    envAD(g.gain, t, dur, 0.3 * loud, 0.02, dur * 0.4);
    noiseSrc(c, p, p.noise.white, t, dur).connect(bq(c, 'bandpass', 2600 * k, 2, am(c, g, t, dur, 85, 60, 0.9, 'sawtooth')));
  } else if (surface === 'wet') {
    nz(c, out, t + 0.02, p, { dur: 0.1, peak: 0.25 * loud, attack: 0.01, type: 'highpass', f: 2600 });
    tn(c, out, t + 0.03, { f: 420 * k, f2: 760 * k, dur: 0.04, peak: 0.06 * loud });
  } else if (surface === 'grass') {
    nz(c, out, t + 0.03, p, { dur: 0.09, peak: 0.12 * loud, attack: 0.02, type: 'highpass', f: 3200 });
  } else if (surface === 'dirt' && p.rng.chance(0.3)) {
    // sassolino
    clickAt(c, out, t + 0.03 + p.rng.next() * 0.04, p, 2400, 0.12 * loud, 0);
  }
  return dur * 1.3 + 0.06;
}

// ---------------------------------------------------------------- sorgenti continue

export interface LoopHandle {
  /** Ferma tutte le sorgenti all'istante `t`. */
  stop(t: number): void;
  /** Eventi casuali interni (es. scoppiettii), chiamato dal motore a ogni tick. */
  tick?(t: number, dt: number): void;
}

class Sources {
  private readonly list: AudioScheduledSourceNode[] = [];
  osc(c: Ctx, type: OscillatorType, f: number, out: AudioNode | AudioParam): OscillatorNode {
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = f;
    if (isParam(out)) o.connect(out); else o.connect(out);
    o.start();
    this.list.push(o);
    return o;
  }
  noise(c: Ctx, p: RecipeParams, buf: AudioBuffer, out: AudioNode, rate = 1): AudioBufferSourceNode {
    const s = c.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.playbackRate.value = rate;
    s.connect(out);
    s.start(0, p.rng.next() * (buf.duration > 0 ? buf.duration : 1) * 0.9);
    this.list.push(s);
    return s;
  }
  /** LFO: oscillatore lento collegato a un parametro con una certa profondità. */
  lfo(c: Ctx, rate: number, depth: number, target: AudioParam, type: OscillatorType = 'sine'): void {
    const g = gn(c, depth);
    g.connect(target);
    this.osc(c, type, rate, g);
  }
  stop(t: number): void {
    for (const s of this.list) {
      try { s.stop(t); } catch { /* già fermo */ }
    }
    this.list.length = 0;
  }
}

function isParam(x: AudioNode | AudioParam): x is AudioParam {
  return typeof (x as AudioParam).setValueAtTime === 'function' && typeof (x as AudioNode).connect !== 'function';
}

export type LoopBuilder = (c: Ctx, out: AudioNode, p: RecipeParams) => LoopHandle;

/** Respiro del personaggio: inspirazione ed espirazione di rumore filtrato, programmate a ogni ciclo. */
function breathLoop(cycle: number, depth: number): LoopBuilder {
  return (c, out, p) => {
    const s = new Sources();
    const g = gn(c, 0, out);
    const tone = bq(c, 'bandpass', 1100, 0.9, g);
    s.noise(c, p, p.noise.pink, bq(c, 'highpass', 300, 0.5, tone));
    let next = c.currentTime + 0.1;
    return { stop: (t) => s.stop(t), tick(t) {
      if (t < next - 0.05) return;
      const at = Math.max(t, next);
      const len = cycle * (0.9 + 0.2 * p.rng.next());
      const inh = len * 0.38, exh = len * 0.42;
      const gp = g.gain;
      gp.cancelScheduledValues(at);
      gp.setValueAtTime(0.0001, at);
      // inspirazione: più sottile e acuta
      gp.linearRampToValueAtTime(depth * 0.6, at + inh * 0.55);
      gp.linearRampToValueAtTime(0.0001, at + inh);
      tone.frequency.setValueAtTime(1500, at);
      tone.frequency.setValueAtTime(900, at + inh);
      // espirazione: più piena e grave
      gp.linearRampToValueAtTime(depth, at + inh + exh * 0.25);
      gp.linearRampToValueAtTime(0.0001, at + inh + exh);
      next = at + len;
    } };
  };
}

export const LOOPS: Record<LoopKind, LoopBuilder> = {
  ...HOSPITAL_LOOPS,
  xmas_music: xmasMusic,
  elev_music: elevatorMusic,
  breath_calm: breathLoop(3.6, 0.5),
  breath_fast: breathLoop(1.25, 0.8),
  mystery_music(c, out, p) {
    const s = new Sources();
    // Pedale grave, accordo minore sospeso e note di vetro rade; traccia non spaziale.
    const pad = bq(c, 'lowpass', 1500, 0.6, out);
    for (const [i, f] of [55, 110, 130.813, 155.563, 220.3].entries()) {
      const g = gn(c, i === 0 ? 0.2 : 0.055, pad);
      const o = s.osc(c, i < 2 ? 'sine' : 'triangle', f, g);
      s.lfo(c, 0.045 + i * 0.013, 0.018, g.gain);
      s.lfo(c, 0.08 + i * 0.019, f * 0.003, o.frequency);
    }
    let next = c.currentTime + 0.2, note = 0;
    const notes = [440, 523.251, 622.254, 466.164, 523.251, 415.305];
    return { stop: t => s.stop(t), tick(t) {
      if (t < next) return;
      next = t + 2.8 + p.rng.next() * 2.5;
      tn(c, out, t + 0.02, { f: notes[note++ % notes.length], dur: 2.6, peak: 0.07, attack: 0.08, vibRate: 3.7, vibDepth: 0.8 });
    } };
  },
  generator(c, out, p) {
    const s = new Sources();
    const chug = gn(c, 0.6, out);
    s.lfo(c, 26, 0.35, chug.gain, 'sawtooth');
    const lp = bq(c, 'lowpass', 430, 1.5, chug);
    s.osc(c, 'sawtooth', 52, lp);
    s.osc(c, 'square', 26, gn(c, 0.5, lp));
    s.osc(c, 'sawtooth', 104.6, gn(c, 0.25, lp));
    s.noise(c, p, p.noise.pink, gn(c, 0.22, bq(c, 'bandpass', 900, 0.7, chug)));
    s.lfo(c, 0.31, 1.2, lp.frequency);
    return { stop: (t) => s.stop(t) };
  },
  water(c, out, p) {
    const s = new Sources();
    const a = bq(c, 'bandpass', 1100, 0.5, gn(c, 0.6, out));
    s.noise(c, p, p.noise.pink, a);
    s.lfo(c, 0.23, 260, a.frequency);
    const b = bq(c, 'bandpass', 2700, 1.4, gn(c, 0.22, out));
    s.noise(c, p, p.noise.white, b, 0.9);
    s.lfo(c, 0.61, 700, b.frequency);
    s.noise(c, p, p.noise.brown, gn(c, 0.35, bq(c, 'lowpass', 300, 0.5, out)), 1.1);
    return { stop: (t) => s.stop(t) };
  },
  fire(c, out, p) {
    const s = new Sources();
    const roar = gn(c, 0.4, out);
    s.noise(c, p, p.noise.brown, bq(c, 'lowpass', 520, 0.5, roar));
    s.lfo(c, 0.9, 0.12, roar.gain);
    s.noise(c, p, p.noise.pink, gn(c, 0.05, bq(c, 'highpass', 3000, 0.5, out)));
    return {
      stop: (t) => s.stop(t),
      tick(t, dt) {
        // scoppiettii casuali della legna
        let n = 0;
        const expect = 7 * dt;
        while (n < 6 && p.rng.next() < expect / (n + 1)) n++;
        for (let i = 0; i < n; i++) {
          const at = t + 0.02 + p.rng.next() * dt;
          const big = p.rng.chance(0.12);
          nz(c, out, at, p, {
            dur: big ? 0.04 : 0.012, peak: big ? 0.8 : 0.2 + p.rng.next() * 0.35, attack: 0.0005,
            type: 'bandpass', f: 900 + p.rng.next() * 3500, q: 1.5,
          });
        }
      },
    };
  },
  lamp_buzz(c, out, p) {
    const s = new Sources();
    const g = gn(c, 0.3, out);
    s.osc(c, 'sawtooth', 100, bq(c, 'highpass', 900, 0.7, bq(c, 'bandpass', 2500, 1.2, g)));
    s.osc(c, 'sine', 100, gn(c, 0.3, g));
    s.osc(c, 'sine', 200.3, gn(c, 0.12, g));
    s.lfo(c, 0.37, 0.05, g.gain);
    s.noise(c, p, p.noise.white, gn(c, 0.015, bq(c, 'bandpass', 6000, 3, g)));
    return { stop: (t) => s.stop(t) };
  },
  anom_drone(c, out, p) {
    const s = new Sources();
    const g = gn(c, 0.45, out);
    // modulazione ad anello lenta: il suono "respira" senza un ritmo naturale
    const ring = gn(c, 0.6, g);
    s.lfo(c, 0.13, 0.4, ring.gain);
    s.osc(c, 'sine', 41, ring);
    s.osc(c, 'sine', 61.7, gn(c, 0.7, ring));
    s.osc(c, 'triangle', 87.3, gn(c, 0.4, ring));
    s.osc(c, 'sine', 174.9, gn(c, 0.12, ring));
    const sw = bq(c, 'bandpass', 700, 9, gn(c, 0.25, g));
    s.noise(c, p, p.noise.pink, sw);
    s.lfo(c, 0.071, 450, sw.frequency);
    s.osc(c, 'sine', 5230, gn(c, 0.006, g));
    return { stop: (t) => s.stop(t) };
  },
  engine_idle(c, out, p) {
    const s = new Sources();
    const g = gn(c, 0.6, out);
    s.lfo(c, 14, 0.25, g.gain, 'triangle');
    const lp = bq(c, 'lowpass', 300, 1.2, g);
    s.osc(c, 'sawtooth', 28, lp);
    s.osc(c, 'sawtooth', 56.2, gn(c, 0.5, lp));
    s.lfo(c, 0.4, 1.0, lp.frequency);
    s.noise(c, p, p.noise.brown, gn(c, 0.5, bq(c, 'lowpass', 200, 0.5, g)));
    s.noise(c, p, p.noise.pink, gn(c, 0.06, bq(c, 'bandpass', 1800, 0.8, g)));
    return { stop: (t) => s.stop(t) };
  },
};

// ---------------------------------------------------------------- letto ambientale continuo

export type BedLayer = 'wind' | 'rain' | 'insects' | 'water' | 'leaves' | 'human' | 'room';
export const BED_LAYERS: readonly BedLayer[] = ['wind', 'rain', 'insects', 'water', 'leaves', 'human', 'room'];

/** Pan stereo se disponibile, altrimenti passaggio diretto. */
export function makePan(c: Ctx, pan: number, out: AudioNode): AudioNode {
  const mk = (c as unknown as { createStereoPanner?: () => StereoPannerNode }).createStereoPanner;
  if (typeof mk === 'function') {
    const pn = mk.call(c);
    pn.pan.value = Math.max(-1, Math.min(1, pan));
    pn.connect(out);
    return pn;
  }
  return gn(c, 1, out);
}

/** Costruisce gli strati continui; ogni strato entra nel proprio nodo di livello `outs[layer]`. */
export function buildAmbientBed(c: Ctx, outs: Record<BedLayer, AudioNode>, p: RecipeParams): LoopHandle {
  const s = new Sources();

  // vento: due flussi scorrelati ai lati, con raffiche lente su filtro e ampiezza
  for (const side of [-1, 1]) {
    const g = gn(c, 0.55, makePan(c, side * 0.6, outs.wind));
    const f = bq(c, 'bandpass', side < 0 ? 380 : 470, 0.55, g);
    s.noise(c, p, p.noise.pink, f, side < 0 ? 0.8 : 0.9);
    s.lfo(c, side < 0 ? 0.071 : 0.093, 170, f.frequency);
    s.lfo(c, side < 0 ? 0.113 : 0.167, 0.3, g.gain);
    s.lfo(c, side < 0 ? 0.031 : 0.043, 0.15, g.gain);
  }
  s.noise(c, p, p.noise.brown, gn(c, 0.5, bq(c, 'lowpass', 160, 0.5, outs.wind)));

  // pioggia: fruscio brillante più un corpo medio
  for (const side of [-1, 1]) {
    const pan = makePan(c, side * 0.5, outs.rain);
    s.noise(c, p, p.noise.white, bq(c, 'highpass', 1800, 0.5, bq(c, 'lowpass', 9000, 0.5, gn(c, 0.4, pan))), side < 0 ? 1 : 0.93);
  }
  s.noise(c, p, p.noise.pink, bq(c, 'bandpass', 650, 0.5, gn(c, 0.3, outs.rain)));

  // insetti: grilli come treni di impulsi su portanti acute, leggermente scordati tra loro
  const crickets = 5;
  for (let i = 0; i < crickets; i++) {
    const carrier = 3900 + p.rng.next() * 1500;
    const gate = gn(c, 0.45, makePan(c, (i / (crickets - 1)) * 1.6 - 0.8, gn(c, 0.3 + p.rng.next() * 0.25, outs.insects)));
    // cancello lento (frasi), ammorbidito da un passa-basso per non produrre scatti
    const gateDepth = gn(c, 0.45);
    gateDepth.connect(gate.gain);
    s.osc(c, 'square', 0.45 + p.rng.next() * 0.9, bq(c, 'lowpass', 14, 0.5, gateDepth));
    // impulsi rapidi del frinire
    const pulse = gn(c, 0.5, gate);
    s.lfo(c, 24 + p.rng.next() * 14, 0.5, pulse.gain);
    s.osc(c, 'sine', carrier, pulse);
    s.osc(c, 'sine', carrier * 2.01, gn(c, 0.12, pulse));
  }
  // tappeto continuo e debolissimo di insetti lontani
  const far = bq(c, 'bandpass', 5600, 6, gn(c, 0.1, outs.insects));
  s.noise(c, p, p.noise.white, far);

  // acqua: scorrere basso e gorgoglio
  s.noise(c, p, p.noise.brown, bq(c, 'lowpass', 900, 0.5, gn(c, 0.7, outs.water)));
  const gur = bq(c, 'bandpass', 1500, 1.2, gn(c, 0.2, outs.water));
  s.noise(c, p, p.noise.pink, gur, 1.07);
  s.lfo(c, 0.37, 500, gur.frequency);

  // foglie: fruscio continuo che segue le raffiche
  const lv = gn(c, 0.5, outs.leaves);
  s.noise(c, p, p.noise.pink, bq(c, 'highpass', 2600, 0.5, lv), 1.13);
  s.lfo(c, 0.127, 0.3, lv.gain);
  s.lfo(c, 0.31, 0.15, lv.gain);

  // presenza umana lontana: rombo sordo di strada e impianti
  const hm = bq(c, 'lowpass', 130, 0.7, gn(c, 0.8, outs.human));
  s.noise(c, p, p.noise.brown, hm, 0.7);
  s.lfo(c, 0.05, 35, hm.frequency);
  s.osc(c, 'sine', 50, gn(c, 0.03, outs.human));

  // stanza: tono d'ambiente interno
  s.noise(c, p, p.noise.brown, bq(c, 'lowpass', 240, 0.5, gn(c, 0.6, outs.room)), 0.85);
  s.noise(c, p, p.noise.pink, bq(c, 'bandpass', 420, 2, gn(c, 0.05, outs.room)));

  return { stop: (t) => s.stop(t) };
}

// ---------------------------------------------------------------- distorsione

/** Curva del waveshaper: saturazione con una piega asimmetrica, per un timbro "sbagliato". */
export function distortionCurve(n = 1024): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(3.2 * x) * 0.75 + 0.18 * Math.sin(5 * Math.PI * x) * (1 - Math.abs(x));
  }
  return curve;
}
