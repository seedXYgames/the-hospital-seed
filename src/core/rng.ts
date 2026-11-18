// PRNG deterministico con stream indipendenti. Nessuna dipendenza da Math.random().
import { GENERATOR_VERSION, type StreamName } from './contracts';

/** Hash FNV-1a a 32 bit di una stringa, con avalanche finale. */
export function hashString(s: string, h = 2166136261): number {
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return mix32(h);
}

export function mix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;
  constructor(readonly key: string) {
    // sfc32 inizializzato da quattro hash della chiave
    this.a = hashString(key + '/a');
    this.b = hashString(key + '/b');
    this.c = hashString(key + '/c');
    this.d = 1;
    for (let i = 0; i < 12; i++) this.u32();
  }
  u32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }
  /** float in [0,1) */
  next(): number {
    return this.u32() / 4294967296;
  }
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }
  /** intero in [min,max] inclusi */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  weighted<T>(items: readonly T[], weight: (t: T) => number): T {
    let tot = 0;
    for (const it of items) tot += Math.max(0, weight(it));
    let r = this.next() * tot;
    for (const it of items) {
      r -= Math.max(0, weight(it));
      if (r <= 0) return it;
    }
    return items[items.length - 1];
  }
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  gauss(): number {
    const u = Math.max(1e-9, this.next());
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  /** Sotto-stream indipendente: non consuma numeri da questo stream. */
  fork(name: string): Rng {
    return new Rng(this.key + '>' + name);
  }
}

/** Radice degli stream di una partita: ogni sottosistema ottiene uno stream che dipende solo da seed, versione e nome. */
export function streamFor(seed: number, name: StreamName, version = GENERATOR_VERSION): Rng {
  return new Rng(`ths:v${version}:s${seed}:${name}`);
}

/** Rumore 2D value-noise deterministico con hash intero (nessuno stato). */
export function hash2(ix: number, iz: number, salt: number): number {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263) ^ Math.imul(salt | 0, 2147483647);
  return mix32(h) / 4294967296;
}

function smooth(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export function valueNoise2(x: number, z: number, salt: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = smooth(x - ix);
  const fz = smooth(z - iz);
  const a = hash2(ix, iz, salt);
  const b = hash2(ix + 1, iz, salt);
  const c = hash2(ix, iz + 1, salt);
  const d = hash2(ix + 1, iz + 1, salt);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

export function fbm2(x: number, z: number, salt: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
  let amp = 1;
  let f = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise2(x * f, z * f, salt + o * 101);
    norm += amp;
    amp *= gain;
    f *= lacunarity;
  }
  return sum / norm;
}

/** Rumore 1D liscio, usato per l'evoluzione meteo in funzione del tempo simulato. */
export function noise1(t: number, salt: number): number {
  const i = Math.floor(t);
  const f = smooth(t - i);
  const a = hash2(i, 7, salt);
  const b = hash2(i + 1, 7, salt);
  return a + (b - a) * f;
}

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
