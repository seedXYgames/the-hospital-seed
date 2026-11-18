// Primitive geometriche pure dell'ospedale: scatole e cilindri con colore, zona di luce e piano.
// Il rendering le trasforma in mesh; la logica usa le stesse scatole per le collisioni.

export type RGB = [number, number, number];

/** Indice di alimentazione: 0..2 = piani 20..22, 3 libero, 4 = rete principale (scale, ascensore), 5 = sempre acceso. */
/** 0..2 piani, 3 libero, 4 rete principale, 5 sempre acceso, 6.. una per stanza (interruttori). */
export type PowerIdx = number;
export const MAX_PW = 64;
export const PWR_MAIN: PowerIdx = 4;
export const PWR_ALWAYS: PowerIdx = 5;
export const powerOfFloor = (f: number): PowerIdx => Math.max(0, Math.min(3, f - 20)) as PowerIdx;

/** Facce da non generare: -x, +x, -y, +y, -z, +z. */
export const F_NX = 1, F_PX = 2, F_NY = 4, F_PY = 8, F_NZ = 16, F_PZ = 32;

export interface Box {
  x0: number; x1: number; y0: number; y1: number; z0: number; z1: number;
  c: RGB;
  zone: string;
  /** Zona per singola faccia (muri che separano due ambienti). */
  zones?: Partial<Record<'nx' | 'px' | 'ny' | 'py' | 'nz' | 'pz', string>>;
  p: PowerIdx;
  solid?: boolean;
  /** 0 superficie illuminata, 1 emissiva legata alla corrente, 2 emissiva sempre accesa. */
  emit?: 0 | 1 | 2;
  skip?: number;
  /** Passo massimo della suddivisione delle facce (m): più fitto = luce precalcolata più morbida. */
  tess?: number;
}

export interface Cyl {
  x: number; z: number; y0: number; y1: number; r0: number; r1: number; seg: number;
  c: RGB; zone: string; p: PowerIdx; emit?: 0 | 1 | 2;
}

export interface Lamp {
  x: number; y: number; z: number;
  zone: string;
  p: PowerIdx;
  col: RGB;
  i: number;
  r: number;
  /** main: solo con corrente; emerg: solo a corrente assente; both: sempre. */
  mode: 'main' | 'emerg' | 'both';
}

export interface Aabb { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }

export function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c: RGB, zone: string, p: PowerIdx, extra: Partial<Box> = {}): Box {
  return { x0: Math.min(x0, x1), x1: Math.max(x0, x1), y0: Math.min(y0, y1), y1: Math.max(y0, y1), z0: Math.min(z0, z1), z1: Math.max(z0, z1), c, zone, p, ...extra };
}

/** Scatola centrata in (x, z) con base a quota y. */
export function cbox(x: number, z: number, y: number, w: number, d: number, h: number, c: RGB, zone: string, p: PowerIdx, extra: Partial<Box> = {}): Box {
  return box(x - w / 2, x + w / 2, y, y + h, z - d / 2, z + d / 2, c, zone, p, extra);
}

export const shade = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];

export const COL = {
  floor: [0.52, 0.58, 0.56] as RGB,
  floorLobby: [0.62, 0.6, 0.55] as RGB,
  floorBase: [0.42, 0.42, 0.4] as RGB,
  wall: [0.84, 0.82, 0.74] as RGB,
  wallLow: [0.46, 0.62, 0.64] as RGB,
  wallBase: [0.55, 0.55, 0.52] as RGB,
  ceiling: [0.86, 0.86, 0.84] as RGB,
  ceilBase: [0.5, 0.5, 0.48] as RGB,
  door: [0.62, 0.72, 0.76] as RGB,
  doorWood: [0.55, 0.4, 0.27] as RGB,
  frame: [0.7, 0.7, 0.68] as RGB,
  metal: [0.62, 0.64, 0.66] as RGB,
  dark: [0.16, 0.17, 0.18] as RGB,
  white: [0.92, 0.92, 0.9] as RGB,
  sheet: [0.88, 0.9, 0.92] as RGB,
  blanket: [0.55, 0.68, 0.82] as RGB,
  wood: [0.6, 0.45, 0.3] as RGB,
  woodDark: [0.38, 0.26, 0.17] as RGB,
  red: [0.72, 0.1, 0.1] as RGB,
  green: [0.12, 0.42, 0.16] as RGB,
  pine: [0.08, 0.3, 0.14] as RGB,
  gold: [0.85, 0.66, 0.2] as RGB,
  blue: [0.25, 0.42, 0.7] as RGB,
  orange: [0.85, 0.45, 0.15] as RGB,
  concrete: [0.48, 0.48, 0.46] as RGB,
  snow: [0.9, 0.93, 0.98] as RGB,
  skin: [0.86, 0.68, 0.56] as RGB,
  scrubs: [0.35, 0.6, 0.62] as RGB,
  gown: [0.7, 0.8, 0.86] as RGB,
  glassDark: [0.06, 0.08, 0.1] as RGB,
} as const;
