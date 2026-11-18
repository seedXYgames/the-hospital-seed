// Suoni dell'ospedale, sintetizzati: ascensore, corrente, chiamate, telefono, monitor, finestre.
import type { SoundKind } from '../core/api';
import type { Ctx, LoopHandle, Recipe, RecipeParams } from './synth';

type HospitalSound = Extract<SoundKind, 'elev_ding' | 'elev_door' | 'elev_stop' | 'power_down' | 'power_up' | 'call_buzz' | 'call_urgent' | 'beep' | 'pour' | 'cloth' | 'kettle' | 'window_bang' | 'window_close' | 'vending' | 'keys' | 'slide_door'>;

const E = 0.0001;
function g(c: Ctx, v: number, out: AudioNode): GainNode { const n = c.createGain(); n.gain.value = v; n.connect(out); return n; }
function env(c: Ctx, out: AudioNode, t: number, peak: number, a: number, d: number): GainNode {
  const n = c.createGain();
  n.gain.setValueAtTime(E, t); n.gain.linearRampToValueAtTime(peak, t + a); n.gain.exponentialRampToValueAtTime(E, t + a + d);
  n.connect(out); return n;
}
function o(c: Ctx, type: OscillatorType, f: number, out: AudioNode, t: number, len: number, f2?: number): OscillatorNode {
  const x = c.createOscillator(); x.type = type; x.frequency.setValueAtTime(f, t);
  if (f2) x.frequency.exponentialRampToValueAtTime(f2, t + len);
  x.connect(out); x.start(t); x.stop(t + len + 0.05); return x;
}
function filt(c: Ctx, type: BiquadFilterType, f: number, q: number, out: AudioNode): BiquadFilterNode {
  const b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; b.connect(out); return b;
}
function nz(c: Ctx, p: RecipeParams, out: AudioNode, t: number, len: number, buf?: AudioBuffer): AudioBufferSourceNode {
  const s = c.createBufferSource(); s.buffer = buf ?? p.noise.white; s.loop = true;
  s.connect(out); s.start(t, p.rng.next() * 1.5); s.stop(t + len + 0.05); return s;
}
function burst(c: Ctx, p: RecipeParams, out: AudioNode, t: number, peak: number, len: number, type: BiquadFilterType, f: number, q = 0.8, buf?: AudioBuffer): BiquadFilterNode {
  const b = filt(c, type, f, q, env(c, out, t, peak, 0.003, len));
  nz(c, p, b, t, len + 0.05, buf);
  return b;
}
function bell(c: Ctx, out: AudioNode, t: number, f: number, peak: number, len: number): void {
  o(c, 'sine', f, env(c, out, t, peak, 0.003, len), t, len);
  o(c, 'sine', f * 2.76, env(c, out, t, peak * 0.25, 0.002, len * 0.4), t, len);
  o(c, 'sine', f * 5.4, env(c, out, t, peak * 0.08, 0.001, len * 0.15), t, len);
}
function clunk(c: Ctx, p: RecipeParams, out: AudioNode, t: number, peak: number): void {
  o(c, 'sine', 120, env(c, out, t, peak, 0.002, 0.18), t, 0.2, 55);
  burst(c, p, out, t, peak * 0.6, 0.08, 'bandpass', 900, 1.2);
}

export const HOSPITAL_RECIPES: Record<HospitalSound, Recipe> = {
  elev_ding(c, out, t) { bell(c, out, t, 1318.5, 0.35, 1.4); bell(c, out, t + 0.42, 1046.5, 0.35, 1.8); return 2.4; },
  elev_door(c, out, t, p) {
    const m = env(c, out, t, 0.12, 0.15, 1.0);
    o(c, 'sawtooth', 180, filt(c, 'lowpass', 600, 1, m), t, 1.1, 210);
    burst(c, p, out, t, 0.12, 1.1, 'bandpass', 500, 0.6, p.noise.pink);
    clunk(c, p, out, t + 1.1, 0.35);
    return 1.4;
  },
  elev_stop(c, out, t, p) { clunk(c, p, out, t, 0.9); burst(c, p, out, t + 0.05, 0.4, 0.6, 'bandpass', 2200, 3); o(c, 'sawtooth', 90, env(c, filt(c, 'lowpass', 300, 1, out), t, 0.3, 0.01, 0.9), t, 0.9, 30); return 1.2; },
  power_down(c, out, t, p) {
    clunk(c, p, out, t, 0.8);
    o(c, 'sawtooth', 120, env(c, filt(c, 'lowpass', 700, 1, out), t, 0.35, 0.01, 1.6), t, 1.6, 28);
    o(c, 'sine', 60, env(c, out, t, 0.3, 0.01, 1.4), t, 1.4, 20);
    return 1.8;
  },
  power_up(c, out, t, p) {
    clunk(c, p, out, t, 0.7);
    o(c, 'sawtooth', 40, env(c, filt(c, 'lowpass', 600, 1, out), t + 0.1, 0.25, 0.6, 0.8), t + 0.1, 1.5, 120);
    for (let k = 0; k < 6; k++) burst(c, p, out, t + 0.4 + k * 0.11 + p.rng.next() * 0.08, 0.25, 0.03, 'bandpass', 3000 + p.rng.next() * 2000, 4);
    return 1.8;
  },
  call_buzz(c, out, t) {
    o(c, 'triangle', 659, env(c, out, t, 0.3, 0.01, 0.7), t, 0.8);
    o(c, 'triangle', 523, env(c, out, t + 0.45, 0.3, 0.01, 0.9), t + 0.45, 1.0);
    return 1.5;
  },
  call_urgent(c, out, t) {
    for (let k = 0; k < 3; k++) o(c, 'square', 880, env(c, filt(c, 'lowpass', 2500, 0.7, out), t + k * 0.22, 0.18, 0.005, 0.15), t + k * 0.22, 0.18);
    return 0.8;
  },
  beep(c, out, t) { o(c, 'sine', 1760, env(c, out, t, 0.3, 0.003, 0.12), t, 0.14); o(c, 'sine', 2349, env(c, out, t + 0.12, 0.25, 0.003, 0.1), t + 0.12, 0.12); return 0.3; },
  pour(c, out, t, p) {
    const b = filt(c, 'bandpass', 700, 3, env(c, out, t, 0.3, 0.1, 1.2));
    b.frequency.setValueAtTime(500, t); b.frequency.linearRampToValueAtTime(1500, t + 1.2);
    nz(c, p, b, t, 1.3, p.noise.pink);
    for (let k = 0; k < 8; k++) o(c, 'sine', 600 + p.rng.next() * 800, env(c, out, t + 0.1 + k * 0.13, 0.05, 0.002, 0.05), t + 0.1 + k * 0.13, 0.08);
    return 1.4;
  },
  cloth(c, out, t, p) { for (let k = 0; k < 3; k++) burst(c, p, out, t + k * 0.18, 0.18, 0.25, 'bandpass', 1800 - k * 300, 0.6, p.noise.pink); return 0.8; },
  kettle(c, out, t, p) {
    burst(c, p, out, t, 0.4, 0.02, 'bandpass', 2500, 2);
    const b = filt(c, 'bandpass', 1200, 0.7, env(c, out, t + 0.1, 0.2, 1.0, 0.8));
    nz(c, p, b, t + 0.1, 2, p.noise.pink);
    return 2.0;
  },
  window_bang(c, out, t, p) {
    o(c, 'sine', 140, env(c, out, t, 0.6, 0.002, 0.25), t, 0.3, 60);
    burst(c, p, out, t, 0.5, 0.15, 'lowpass', 900, 0.6, p.noise.brown);
    for (let k = 0; k < 4; k++) burst(c, p, out, t + 0.02 + k * 0.03, 0.15, 0.05, 'bandpass', 4200, 6);
    return 0.5;
  },
  window_close(c, out, t, p) { clunk(c, p, out, t, 0.6); burst(c, p, out, t + 0.2, 0.3, 0.03, 'bandpass', 3000, 3); return 0.4; },
  vending(c, out, t, p) {
    o(c, 'sawtooth', 70, env(c, filt(c, 'lowpass', 500, 1, out), t, 0.2, 0.05, 1.2), t, 1.3, 75);
    clunk(c, p, out, t + 1.3, 0.6);
    return 1.7;
  },
  keys(c, out, t, p) { for (let k = 0; k < 7; k++) o(c, 'sine', 3200 + p.rng.next() * 3000, env(c, out, t + k * 0.04 + p.rng.next() * 0.03, 0.08, 0.001, 0.09), t + k * 0.05, 0.12); clunk(c, p, out, t + 0.4, 0.4); return 0.7; },
  slide_door(c, out, t, p) { o(c, 'sawtooth', 110, env(c, filt(c, 'lowpass', 400, 1, out), t, 0.12, 0.2, 0.9), t, 1.1, 130); burst(c, p, out, t, 0.12, 1.0, 'bandpass', 700, 0.5, p.noise.pink); return 1.2; },
};

// ---------------------------------------------------------------- sorgenti continue

function periodic(period: number, fn: (c: Ctx, out: AudioNode, t: number, p: RecipeParams, k: number) => void) {
  return (c: Ctx, out: AudioNode, p: RecipeParams): LoopHandle => {
    let next = c.currentTime + 0.1 + p.rng.next() * period, k = 0, stopped = Infinity;
    return { stop(t) { stopped = t; }, tick(t) { while (next < t + 0.4 && next < stopped) { fn(c, out, Math.max(t, next), p, k++); next += period; } } };
  };
}

export const HOSPITAL_LOOPS = {
  elev_motor(c: Ctx, out: AudioNode, p: RecipeParams): LoopHandle {
    const t = c.currentTime;
    const m = g(c, 0.5, out);
    const a = o(c, 'sawtooth', 50, filt(c, 'lowpass', 220, 1, m), t, 3600);
    const b = o(c, 'sine', 420, g(c, 0.05, m), t, 3600);
    const n = nz(c, p, filt(c, 'bandpass', 300, 0.6, g(c, 0.3, m)), t, 3600, p.noise.brown);
    return { stop(s) { for (const x of [a, b, n]) try { x.stop(s); } catch { /* */ } } };
  },
  phone_ring: periodic(4, (c, out, t) => {
    for (let k = 0; k < 2; k++) {
      const at = t + k * 0.5;
      const amp = env(c, out, at, 0.25, 0.01, 0.42);
      o(c, 'sine', 440, amp, at, 0.45); o(c, 'sine', 480, amp, at, 0.45);
    }
  }),
  call_loop: periodic(1.6, (c, out, t) => { o(c, 'triangle', 988, env(c, out, t, 0.12, 0.005, 0.25), t, 0.3); }),
  // battito del cuore, nelle orecchie: due colpi sordi
  heartbeat: periodic(0.86, (c, out, t) => {
    o(c, 'sine', 58, env(c, filt(c, 'lowpass', 160, 1, out), t, 0.55, 0.008, 0.16), t, 0.2, 38);
    o(c, 'sine', 52, env(c, filt(c, 'lowpass', 150, 1, out), t + 0.24, 0.38, 0.008, 0.18), t + 0.24, 0.22, 34);
  }),
  // carillon: «Stille Nacht», lento, una nota stonata ogni tanto
  music_box: periodic(0.62, (c, out, t, p, k) => {
    const mel = [784, 880, 784, 659, 0, 0, 784, 880, 784, 659, 0, 0, 1175, 0, 1175, 988, 0, 0, 1047, 0, 1047, 784, 0, 0, 880, 0, 880, 1047, 988, 880, 784, 880, 784, 659, 0, 0];
    const f = mel[k % mel.length];
    if (!f) return;
    const det = p.rng.chance(0.08) ? 0.94 : 1;
    o(c, 'sine', f * det, env(c, out, t, 0.18, 0.002, 1.1), t, 1.2);
    o(c, 'sine', f * 2 * det, env(c, out, t, 0.05, 0.002, 0.4), t, 0.45);
  }),
  monitor_beep: periodic(0.95, (c, out, t) => { o(c, 'sine', 1046, env(c, out, t, 0.08, 0.003, 0.09), t, 0.1); }),
  wind_gap(c: Ctx, out: AudioNode, p: RecipeParams): LoopHandle {
    const t = c.currentTime;
    const b = filt(c, 'bandpass', 900, 6, g(c, 0.5, out));
    const n = nz(c, p, b, t, 3600, p.noise.pink);
    const l = c.createOscillator(); l.frequency.value = 0.17; const lg = g(c, 400, b.frequency as unknown as AudioNode);
    l.disconnect(); l.connect(lg); l.start(t);
    return { stop(s) { try { n.stop(s); l.stop(s); } catch { /* */ } } };
  },
};
