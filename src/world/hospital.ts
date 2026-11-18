// Generazione dell'ospedale: il reparto notturno ai piani 20, 21 e 22 di una torre sopra la città.
// La pianta cambia davvero a ogni seed: ogni piano sceglie una sua topologia (corridoio passante, a T,
// a L, con una sala enorme in fondo) e divide le ali in stanze di larghezza diversa. Restano fissi solo
// il vano scale, l'ascensore e l'accettazione al 20°. Fuori, la città dall'alto.
// Modulo puro: niente Babylon, niente DOM.
import type { L10n, Vec3 } from '../core/contracts';
import { Rng, streamFor } from '../core/rng';
import {
  COL, F_NY, F_PY, PWR_ALWAYS, PWR_MAIN, box, cbox, powerOfFloor, shade,
  type Aabb, type Box, type Cyl, type Lamp, type PowerIdx, type RGB,
} from './geom';
import { FEMALE_FIRST, LAST_NAMES, MALE_FIRST, patientDossier, patientStory } from './names';

// ---------------------------------------------------------------- costanti

export const H = 3.6;
export const CEIL = 3.0;
/** Piani accessibili: il reparto notturno occupa il 20°, il 21° e il 22° piano. */
export const FLOORS = [20, 21, 22] as const;
export type FloorId = (typeof FLOORS)[number];
export const BASE_FLOOR = 20;
export const BX0 = -9, BX1 = 9, BZ0 = -10, BZ1 = 10, CZ = 1.5, WT = 0.16;
export const ELEV = { x0: -9, x1: -6, z0: -4.6, z1: -1.5, doorX0: -8.1, doorX1: -6.9, cx: -7.5 } as const;
export const STAIRS = { x0: -6, x1: -3, z0: -10, z1: -1.5, landZ: -3.5, midZ: -8, divX: -4.5, doorX0: -5.75, doorX1: -4.65 } as const;
/** Quota della strada, venti piani più sotto. */
export const GROUND = -BASE_FLOOR * H;
export const SPAWN = { x: -3, z: 8.1, yaw: Math.PI } as const;

export const floorY = (f: number): number => (f - BASE_FLOOR) * H;

// ---------------------------------------------------------------- tipi

export type RoomKind =
  | 'lobby' | 'patient' | 'vacant' | 'nurse' | 'staff' | 'linen' | 'bath' | 'office' | 'er' | 'radiology' | 'bar' | 'chapel'
  | 'pharmacy' | 'lockers' | 'waiting' | 'storage' | 'electrical' | 'generator' | 'laundry' | 'morgue' | 'boiler'
  | 'archive' | 'workshop' | 'waste' | 'oldlockers' | 'closed';

/** Muro della porta di una stanza: lungo x (a quota z = at) o lungo z (a x = at); s è il verso verso l'interno. */
export interface DoorWall { axis: 'x' | 'z'; at: number; a0: number; a1: number; s: 1 | -1 }

export interface Room {
  id: string;
  f: FloorId;
  kind: RoomKind;
  x0: number; x1: number; z0: number; z1: number;
  /** Verso dell'interno rispetto al muro della porta (vedi dw). */
  side: 1 | -1 | 0;
  dw: DoorWall;
  /** Varco senza porta (sale aperte sul corridoio). */
  arch?: boolean;
  /** Indice di alimentazione proprio: l'interruttore della stanza. */
  pw: number;
  /** Arredo specchiato (letto a sinistra invece che a destra, e così via). */
  mirror?: boolean;
  number?: number;
  name: L10n;
  zone: string;
  locked: boolean;
  windows: boolean;
}

export interface Door {
  id: string;
  f: FloorId;
  room: string;
  /** Muro della porta: lungo x a quota z (axis 'x') oppure lungo z a x = z (axis 'z'). */
  axis: 'x' | 'z';
  z: number;
  /** Estensione lungo il muro (x per axis 'x', z per axis 'z'). */
  x0: number; x1: number;
  /** Verso della stanza: la porta si apre verso di lei. */
  side: 1 | -1;
  locked: boolean;
  open: boolean;
  zoneIn: string; zoneOut: string;
  /** Ghirlanda appesa sul lato del corridoio (si muove con l'anta). */
  wreath?: boolean;
}

/** Centro di una porta, spostato di `off` metri verso la stanza (negativo: verso il corridoio). */
export function doorPoint(d: Door, off = 0): { x: number; z: number } {
  const c = (d.x0 + d.x1) / 2, n = d.z + d.side * off;
  return d.axis === 'x' ? { x: c, z: n } : { x: n, z: c };
}
/** Scatola dell'anta chiusa. */
export function doorAabb(d: Door): Aabb {
  const y = floorY(d.f);
  return d.axis === 'x'
    ? { x0: d.x0, x1: d.x1, y0: y, y1: y + 2.15, z0: d.z - 0.06, z1: d.z + 0.06 }
    : { x0: d.z - 0.06, x1: d.z + 0.06, y0: y, y1: y + 2.15, z0: d.x0, z1: d.x1 };
}

/** Tratto di corridoio (rettangolo percorribile). */
export interface Corridor { id: string; f: FloorId; x0: number; x1: number; z0: number; z1: number }

export interface Win {
  id: string; f: FloorId; room: string;
  axis: 'x' | 'z';
  /** Coordinata del muro (z per muri lungo x, x per muri lungo z). */
  at: number;
  a0: number; a1: number; y0: number; y1: number;
  /** Verso l'esterno: +1 o -1 lungo la normale del muro. */
  out: 1 | -1;
  zone: string;
  open: boolean;
}

export type ObjKind =
  | 'door' | 'cctv' | 'radio' | 'water' | 'linen' | 'kettle' | 'breaker' | 'checkpoint' | 'window' | 'cambox'
  | 'patient' | 'nurse' | 'phone' | 'callbtn' | 'chair' | 'elev_call' | 'elev_btn' | 'entrance' | 'samples' | 'logbook' | 'vending' | 'tree'
  | 'batteries' | 'presepe' | 'santa' | 'gift' | 'advent' | 'vacantbed' | 'musicbox' | 'switch';

export interface Obj {
  id: string;
  kind: ObjKind;
  f: FloorId;
  x: number; y: number; z: number;
  /** Raggio della sfera di selezione. */
  r: number;
  room: string;
  data?: string;
}

export interface Patient {
  id: string; first: string; last: string; sex: 'm' | 'f'; age: number;
  /** Breve storia del paziente, generata dal seed. */
  story: L10n;
  /** Perché è ricoverato. */
  reason: L10n;
  born: { d: number; m: number; y: number };
  character: L10n;
  curiosities: L10n[];
  /** Seme del ritratto nella cartella. */
  face: number;
  f: FloorId; room: string; roomNumber: number; bed: 1 | 2;
  x: number; z: number; yaw: number;
  /** Punto accanto al letto da cui si alza. */
  side: { x: number; z: number };
}

export interface Staff {
  id: string; first: string; last: string; role: 'nurse'; f: FloorId;
  x: number; z: number; yaw: number;
}

export interface Cam {
  id: string; n: number; label: L10n; f: FloorId;
  x: number; y: number; z: number; tx: number; ty: number; tz: number; fov: number;
  inCab?: boolean;
  /** Scatola di derivazione dove si resetta la telecamera (null se non raggiungibile). */
  box: Vec3 | null;
}

export interface Sign { f: FloorId; x: number; y: number; z: number; nx: number; nz: number; w: number; h: number; text: L10n; style: 'room' | 'exit' | 'floor' | 'ward' }

export interface Garland { f: FloorId; pts: Vec3[] }
export interface XmasTree { f: FloorId; x: number; z: number; y: number; h: number; zone: string }

/** Il Babbo Natale di plastica del soggiorno (si sposta, di notte). */
export interface Santa { f: FloorId; x: number; z: number; yaw: number }

export type Topology = 'spine' | 'tee' | 'hall' | 'ell' | 'gallery' | 'atrium';

export interface Hospital {
  seed: number;
  rooms: Room[];
  doors: Door[];
  windows: Win[];
  objs: Obj[];
  patients: Patient[];
  staff: Staff[];
  cams: Cam[];
  signs: Sign[];
  garlands: Garland[];
  trees: XmasTree[];
  boxes: Box[];
  cyls: Cyl[];
  lamps: Lamp[];
  /** Scatole solide per le collisioni (statiche). */
  solids: Aabb[];
  /** Punti di controllo della ronda, per piano. */
  checkpoints: Record<number, string[]>;
  /** Fonti di oggetti: id degli interattivi. */
  sources: { water: string[]; linen: string[]; kettle: string[]; batteries: string[] };
  corridors: Corridor[];
  topology: Record<number, Topology>;
  santa: Santa | null;
}

// ---------------------------------------------------------------- nomi delle stanze


const RN: Record<RoomKind, L10n> = {
  lobby: { it: 'Accettazione notturna', en: 'Night reception' },
  patient: { it: 'Stanza', en: 'Room' },
  vacant: { it: 'Stanza', en: 'Room' },
  nurse: { it: 'Guardiola', en: 'Nurses\' station' },
  staff: { it: 'Cucinino', en: 'Kitchenette' },
  linen: { it: 'Biancheria', en: 'Linen room' },
  bath: { it: 'Servizi', en: 'Toilets' },
  office: { it: 'Studio medico', en: 'Doctor\'s office' },
  er: { it: 'Ambulatorio', en: 'Treatment room' },
  radiology: { it: 'Radiologia', en: 'Radiology' },
  bar: { it: 'Bar', en: 'Café' },
  chapel: { it: 'Cappellina', en: 'Chapel' },
  pharmacy: { it: 'Farmacia', en: 'Pharmacy' },
  lockers: { it: 'Spogliatoio', en: 'Lockers' },
  waiting: { it: 'Soggiorno', en: 'Day room' },
  storage: { it: 'Deposito strumentazione', en: 'Equipment store' },
  electrical: { it: 'Locale tecnico', en: 'Plant room' },
  generator: { it: 'Gruppo elettrogeno', en: 'Generator room' },
  laundry: { it: 'Lavanderia', en: 'Laundry' },
  morgue: { it: 'Camera mortuaria', en: 'Mortuary' },
  boiler: { it: 'Centrale termica', en: 'Boiler room' },
  archive: { it: 'Archivio', en: 'Records' },
  workshop: { it: 'Officina', en: 'Workshop' },
  waste: { it: 'Deposito rifiuti', en: 'Waste store' },
  oldlockers: { it: 'Vecchi spogliatoi', en: 'Old locker rooms' },
  closed: { it: 'Chiuso', en: 'Closed' },
};

export const FLOOR_NAME: Record<number, L10n> = {
  20: { it: '20° piano', en: '20th floor' },
  21: { it: '21° piano', en: '21st floor' },
  22: { it: '22° piano', en: '22nd floor' },
};
export const FLOOR_SHORT: Record<number, string> = { 20: '20', 21: '21', 22: '22' };

/** Stanze che compaiono sulla mappa: quelle dei pazienti e i luoghi che servono. */
export const MAP_KINDS = new Set<RoomKind>(['lobby', 'patient', 'vacant', 'er', 'staff', 'linen', 'bath', 'chapel', 'storage', 'electrical', 'waiting']);

// ---------------------------------------------------------------- costruttore

interface BedSlot { r: Room; k: number; x: number; z: number; px: number; py: number; pz: number; yaw: number; side: { x: number; z: number } }

class Builder {
  readonly h: Hospital;
  readonly beds: BedSlot[] = [];
  private oid = 0;
  constructor(seed: number) {
    this.h = {
      seed, rooms: [], doors: [], windows: [], objs: [], patients: [], staff: [], cams: [], signs: [], garlands: [], trees: [],
      boxes: [], cyls: [], lamps: [], solids: [], checkpoints: {}, sources: { water: [], linen: [], kettle: [], batteries: [] },
      corridors: [], topology: {}, santa: null,
    };
  }
  add(b: Box): Box {
    this.h.boxes.push(b);
    if (b.solid) this.h.solids.push({ x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1, z0: b.z0, z1: b.z1 });
    return b;
  }
  solid(a: Aabb): void { this.h.solids.push(a); }
  cyl(c: Cyl): void { this.h.cyls.push(c); }
  lamp(l: Lamp): void { this.h.lamps.push(l); }
  obj(kind: ObjKind, f: FloorId, x: number, y: number, z: number, r: number, room: string, data?: string, id?: string): Obj {
    const o: Obj = { id: id ?? `${kind}-${++this.oid}`, kind, f, x, y, z, r, room, data };
    this.h.objs.push(o);
    return o;
  }
}

/**
 * Sistema di riferimento locale di una stanza: u lungo il muro della porta (da a0), d in profondità
 * dal muro della porta verso l'interno. Vale per porte su muri lungo x e lungo z.
 */
class Local {
  readonly W: number; readonly D: number; readonly y: number; readonly s: 1 | -1; readonly dw: DoorWall;
  constructor(readonly b: Builder, readonly r: Room) {
    this.dw = r.dw;
    this.s = r.dw.s;
    this.W = r.dw.a1 - r.dw.a0;
    this.D = r.dw.axis === 'x' ? r.z1 - r.z0 : r.x1 - r.x0;
    this.y = floorY(r.f);
  }
  get p(): PowerIdx { return this.r.pw; }
  pt(u: number, d: number): { x: number; z: number } {
    const w = this.dw;
    if (this.r.mirror) u = this.W - u;
    return w.axis === 'x' ? { x: w.a0 + u, z: w.at + w.s * d } : { x: w.at + w.s * d, z: w.a0 + u };
  }
  aabb(u0: number, u1: number, y0: number, y1: number, d0: number, d1: number): Aabb {
    const a = this.pt(u0, d0), c = this.pt(u1, d1);
    return { x0: Math.min(a.x, c.x), x1: Math.max(a.x, c.x), y0: this.y + y0, y1: this.y + y1, z0: Math.min(a.z, c.z), z1: Math.max(a.z, c.z) };
  }
  box(u0: number, u1: number, y0: number, y1: number, d0: number, d1: number, c: RGB, extra: Partial<Box> = {}): Box {
    const a = this.aabb(u0, u1, y0, y1, d0, d1);
    return this.b.add(box(a.x0, a.x1, a.y0, a.y1, a.z0, a.z1, c, this.r.zone, this.p, extra));
  }
  sbox(u0: number, u1: number, y0: number, y1: number, d0: number, d1: number, c: RGB, extra: Partial<Box> = {}): Box {
    return this.box(u0, u1, y0, y1, d0, d1, c, { solid: true, ...extra });
  }
  solid(u0: number, u1: number, y0: number, y1: number, d0: number, d1: number): void { this.b.solid(this.aabb(u0, u1, y0, y1, d0, d1)); }
  cyl(u: number, d: number, y0: number, y1: number, r0: number, r1: number, c: RGB, seg = 10, emit?: 0 | 1 | 2): void {
    const q = this.pt(u, d);
    this.b.cyl({ x: q.x, z: q.z, y0: this.y + y0, y1: this.y + y1, r0, r1, seg, c, zone: this.r.zone, p: this.p, emit });
  }
  lamp(u: number, d: number, yy: number, col: RGB, i: number, r: number, mode: Lamp['mode'] = 'main'): void {
    const q = this.pt(u, d);
    this.b.lamp({ x: q.x, y: this.y + yy, z: q.z, zone: this.r.zone, p: mode === 'emerg' ? PWR_ALWAYS : this.p, col, i, r, mode });
  }
  obj(kind: ObjKind, u: number, yy: number, d: number, r: number, data?: string, id?: string): Obj {
    const q = this.pt(u, d);
    return this.b.obj(kind, this.r.f, q.x, this.y + yy, q.z, r, this.r.id, data, id);
  }
  /** Normale che punta verso +d (k = 1) o verso il muro della porta (k = -1). */
  nD(k: 1 | -1): { nx: number; nz: number } { return this.dw.axis === 'x' ? { nx: 0, nz: this.s * k } : { nx: this.s * k, nz: 0 }; }
  /** Normale verso +u (k = 1) o verso -u. */
  nU(k: 1 | -1): { nx: number; nz: number } { const kk = this.r.mirror ? -k : k; return this.dw.axis === 'x' ? { nx: kk, nz: 0 } : { nx: 0, nz: kk }; }
  /** Il muro dà sulla città (facciata)? */
  isExt(w: 'far' | 'left' | 'right' | 'near'): boolean {
    const q = w === 'far' ? this.pt(this.W / 2, this.D + 0.2) : w === 'near' ? this.pt(this.W / 2, -0.2) : w === 'left' ? this.pt(-0.2, this.D / 2) : this.pt(this.W + 0.2, this.D / 2);
    return q.x < BX0 || q.x > BX1 || q.z < BZ0 || q.z > BZ1;
  }
  /** Imbardata che guarda verso +d (lontano dal corridoio). */
  get yawIn(): number { const n = this.nD(1); return Math.atan2(n.nx, n.nz); }
  /** Imbardata che guarda verso +u. */
  get yawU(): number { const n = this.nU(1); return Math.atan2(n.nx, n.nz); }
  sign(u: number, yy: number, d: number, n: { nx: number; nz: number }, w: number, h: number, text: L10n, style: Sign['style'] = 'room'): void {
    const q = this.pt(u, d);
    this.b.h.signs.push({ f: this.r.f, x: q.x, y: this.y + yy, z: q.z, nx: n.nx, nz: n.nz, w, h, text, style });
  }
  /** Plafoniera: pannello luminoso a soffitto e luce precalcolata. */
  ceilingLamp(u: number, d: number, i: number, mode: Lamp['mode'] = 'main', col: RGB = [1, 0.96, 0.88], r = 3.2): void {
    this.box(u - 0.55, u + 0.55, CEIL - 0.04, CEIL - 0.005, d - 0.28, d + 0.28, [1, 0.97, 0.9], { emit: 1 });
    this.lamp(u, d, CEIL - 0.25, col, i, r, mode);
  }
  /** Plafoniere distribuite su tutta la stanza. */
  lamps(i: number, col: RGB = [1, 0.96, 0.88], step = 3.6): void {
    const nu = Math.max(1, Math.round(this.W / step)), nd = Math.max(1, Math.round(this.D / step));
    for (let a = 0; a < nu; a++) for (let c = 0; c < nd; c++) this.ceilingLamp(((a + 0.5) * this.W) / nu, ((c + 0.5) * this.D) / nd, i, 'main', col, step * 0.95);
  }
}

// ---------------------------------------------------------------- pianta dei piani

interface Rect { x0: number; x1: number; z0: number; z1: number }
interface Opening { f: FloorId; axis: 'x' | 'z'; at: number; a0: number; a1: number; top: number; y0?: number }
interface Piece { f: FloorId; dw: DoorWall; depth: number; door: [number, number]; arch?: boolean; big?: boolean; prefer?: RoomKind }
interface FloorPlan { f: FloorId; topo: Topology; corrs: Rect[]; pieces: Piece[]; junctions: Opening[] }

const rectOf = (dw: DoorWall, depth: number): Rect => dw.axis === 'x'
  ? { x0: dw.a0, x1: dw.a1, z0: dw.s === 1 ? dw.at : dw.at - depth, z1: dw.s === 1 ? dw.at + depth : dw.at }
  : { x0: dw.s === 1 ? dw.at : dw.at - depth, x1: dw.s === 1 ? dw.at + depth : dw.at, z0: dw.a0, z1: dw.a1 };

/** Divide un'ala lunga un muro in stanze di larghezza diversa (qualche volta una sola, enorme). */
function partition(rng: Rng, f: FloorId, axis: 'x' | 'z', at: number, a0: number, a1: number, s: 1 | -1, depth: number, door?: [number, number]): Piece[] {
  const out: Piece[] = [];
  let cur = a0;
  const len = a1 - a0;
  const minW = depth < 4.5 ? 2.6 : 3.2;
  if (len < minW + 0.01) {
    out.push({ f, dw: { axis, at, a0, a1, s }, depth, door: door ?? [a0, a1] });
    return out;
  }
  const wide = rng.chance(0.22);
  while (a1 - cur > 0.01) {
    let w = wide && !out.length ? rng.range(Math.min(len, 7), Math.min(len > 10.4 ? len - minW : len, 10)) : rng.range(minW, Math.max(minW, Math.min(6.8, len)));
    if (a1 - cur - w < minW) w = a1 - cur;
    w = Math.round(w * 10) / 10;
    if (cur + w > a1 - 0.3 || w < 0.3) w = a1 - cur;
    const lo = door ? Math.max(cur, door[0]) : cur, hi = door ? Math.min(cur + w, door[1]) : cur + w;
    out.push({ f, dw: { axis, at, a0: cur, a1: cur + w, s }, depth, door: [lo, hi], big: w * depth > 55 });
    cur += w;
  }
  // un pezzo senza tratto di corridoio davanti si fonde col vicino
  for (let i = out.length - 1; i >= 0; i--) {
    const p = out[i];
    if (p.door[1] - p.door[0] >= 1.4) continue;
    const n = out[i - 1] ?? out[i + 1];
    if (!n || n === p) continue;
    n.dw = { ...n.dw, a0: Math.min(n.dw.a0, p.dw.a0), a1: Math.max(n.dw.a1, p.dw.a1) };
    n.door = [Math.min(n.door[0], p.door[0]), Math.max(n.door[1], p.door[1])];
    n.big = (n.dw.a1 - n.dw.a0) * depth > 55;
    out.splice(i, 1);
  }
  return out;
}

const C0 = (x1: number): Rect => ({ x0: BX0, x1, z0: -CZ, z1: CZ });

function planFloor(f: FloorId, topo: Topology, rng: Rng): FloorPlan {
  const corrs: Rect[] = [], pieces: Piece[] = [], junctions: Opening[] = [];
  const nx0 = f === 20 ? 3 : BX0;
  const north = (x1: number) => { if (x1 - nx0 > 1) pieces.push(...partition(rng, f, 'x', CZ, nx0, x1, 1, BZ1 - CZ)); };
  const south = (x1: number) => { if (x1 - STAIRS.x1 > 1) pieces.push(...partition(rng, f, 'x', -CZ, STAIRS.x1, x1, -1, -CZ - BZ0)); };
  switch (topo) {
    case 'spine': {
      corrs.push(C0(BX1));
      north(BX1); south(BX1);
      break;
    }
    case 'tee': {
      // il corridoio finisce contro un corridoio trasversale che va da una facciata all'altra
      const xT = f === 20 ? 3 : rng.pick([0.5, 1.5, 2.5]);
      const xc = xT + 2.4;
      corrs.push(C0(xT), { x0: xT, x1: xc, z0: BZ0, z1: BZ1 });
      junctions.push({ f, axis: 'z', at: xT, a0: -CZ, a1: CZ, top: CEIL });
      north(xT); south(xT);
      pieces.push(...partition(rng, f, 'z', xc, BZ0, BZ1, 1, BX1 - xc));
      break;
    }
    case 'hall': {
      // in fondo al corridoio si apre una sala grande quanto mezzo piano
      const xH = f === 20 ? 3 : rng.pick([-0.5, 1, 2.5]);
      corrs.push(C0(xH));
      north(xH); south(xH);
      pieces.push({ f, dw: { axis: 'z', at: xH, a0: BZ0, a1: BZ1, s: 1 }, depth: BX1 - xH, door: [-CZ, CZ], arch: true, big: true, prefer: 'waiting' });
      break;
    }
    case 'gallery': {
      // una galleria vetrata lungo la facciata nord, collegata al corridoio da un passaggio
      const xc = rng.pick([-3.5, -1, 1.5, 4]), gz = 7.6;
      corrs.push(C0(BX1), { x0: xc, x1: xc + 2.4, z0: CZ, z1: gz }, { x0: BX0, x1: BX1, z0: gz, z1: BZ1 });
      junctions.push({ f, axis: 'x', at: CZ, a0: xc, a1: xc + 2.4, top: CEIL }, { f, axis: 'x', at: gz, a0: xc, a1: xc + 2.4, top: CEIL });
      pieces.push(...partition(rng, f, 'x', CZ, BX0, xc, 1, gz - CZ), ...partition(rng, f, 'x', CZ, xc + 2.4, BX1, 1, gz - CZ));
      south(BX1);
      break;
    }
    case 'atrium': {
      // a metà corridoio il muro si apre su una sala d'attesa
      let w = rng.range(4.5, 6.5), xa = f === 20 ? 3 : rng.range(BX0 + 3.4, BX1 - w - 3.2);
      if (BX1 - xa - w < 3.2) w = BX1 - xa;
      if (xa - nx0 > 0 && xa - nx0 < 3.2) { w += xa - nx0; xa = nx0; }
      corrs.push(C0(BX1));
      if (xa - nx0 > 1) pieces.push(...partition(rng, f, 'x', CZ, nx0, xa, 1, BZ1 - CZ));
      pieces.push({ f, dw: { axis: 'x', at: CZ, a0: xa, a1: xa + w, s: 1 }, depth: BZ1 - CZ, door: [xa, xa + w], arch: true, big: true, prefer: 'waiting' });
      if (BX1 - xa - w > 1) pieces.push(...partition(rng, f, 'x', CZ, xa + w, BX1, 1, BZ1 - CZ));
      south(BX1);
      break;
    }
    case 'ell': {
      // il corridoio piega verso nord fino alla facciata; a sud-est un'ala intera
      const xL = f === 20 ? rng.pick([3, 4]) : rng.pick([-1.5, 0, 1.5, 3]);
      const xc = xL + 2.4;
      corrs.push(C0(xc), { x0: xL, x1: xc, z0: CZ, z1: BZ1 });
      junctions.push({ f, axis: 'x', at: CZ, a0: xL, a1: xc, top: CEIL });
      if (xL - nx0 > 6.5) north(xL);
      else if (xL - nx0 > 2.4) pieces.push(...partition(rng, f, 'z', xL, CZ, BZ1, -1, xL - nx0));
      if (BX1 - xc > 2.4) pieces.push(...partition(rng, f, 'z', xc, CZ, BZ1, 1, BX1 - xc));
      south(xc);
      pieces.push({ f, dw: { axis: 'z', at: xc, a0: BZ0, a1: CZ, s: 1 }, depth: BX1 - xc, door: [-CZ, CZ], big: (BX1 - xc) * (CZ - BZ0) > 55 });
      break;
    }
  }
  return { f, topo, corrs, pieces, junctions };
}

// ---------------------------------------------------------------- generazione

/** Tipi di stanza che possono riempire lo spazio avanzato. */
const EXTRAS: RoomKind[] = ['office', 'er', 'lockers', 'archive', 'pharmacy', 'bath', 'storage', 'laundry'];

export function generateHospital(seed: number): Hospital {
  const b = new Builder(seed);
  const rng = streamFor(seed, 'layout');
  const prng = streamFor(seed, 'patients');
  const drng = streamFor(seed, 'decor');

  // ogni piano con la sua forma: mai la stessa per i due piani di degenza
  const topos: Topology[] = ['spine', 'tee', 'hall', 'ell', 'gallery', 'atrium'];
  const plans: FloorPlan[] = [];
  // tre forme diverse per i tre piani (al 20° niente galleria: a nord c'è l'atrio dell'accettazione)
  const t21 = rng.pick(topos), t22 = rng.pick(topos.filter((t) => t !== t21)), t20 = rng.pick(topos.filter((t) => t !== 'gallery' && t !== t21 && t !== t22));
  for (const [f, t] of [[20, t20], [21, t21], [22, t22]] as [FloorId, Topology][]) { plans.push(planFloor(f, t, rng)); b.h.topology[f] = t; }

  // quali stanze esistono stanotte e dove stanno
  const nPatients = prng.int(2, 4);
  const all = plans.flatMap((p) => p.pieces);
  const kinds = new Map<Piece, RoomKind>();
  const free = (pred: (p: Piece) => boolean) => rng.shuffle(all.filter((p) => !kinds.has(p) && pred(p)));
  const W = (p: Piece) => p.dw.a1 - p.dw.a0;
  const okPatient = (p: Piece) => p.f !== 20 && !p.arch && W(p) >= 3.2 && W(p) <= 8 && p.depth >= 4.4;
  // prima i servizi dei due piani di degenza (i pazienti ci vanno da soli), poi le stanze
  for (const f of [21, 22] as FloorId[]) {
    const cand = free((p) => p.f === f && !p.arch && W(p) >= 2.4);
    if (cand.length < 2) continue;
    const bp = cand.sort((a, c) => W(a) * a.depth - W(c) * c.depth)[0];
    kinds.set(bp, 'bath');
  }
  // pazienti ai piani 21 e 22, una stanza ciascuno; poi una stanza vuota con il numero
  let pRooms = free(okPatient).filter((p) => W(p) >= 3.8).slice(0, nPatients);
  if (pRooms.length < nPatients) pRooms = pRooms.concat(free((p) => okPatient(p) && !pRooms.includes(p)).slice(0, nPatients - pRooms.length));
  for (const p of pRooms) kinds.set(p, 'patient');
  const vac = free((p) => okPatient(p) && W(p) >= 3.8)[0] ?? free(okPatient)[0];
  if (vac) kinds.set(vac, 'vacant');
  // le sale grandi diventano soggiorno o cappella
  const halls = free((p) => !!p.arch || p.prefer === 'waiting');
  halls.forEach((p) => kinds.set(p, p.arch ? 'waiting' : [...kinds.values()].includes('waiting') ? 'chapel' : 'waiting'));
  const need: RoomKind[] = ['electrical', 'linen', 'staff', 'storage', 'chapel', 'waiting', 'er'];
  for (const k of need) {
    if ([...kinds.values()].includes(k)) continue;
    const fit = (p: Piece) => !p.arch && (k === 'electrical' ? W(p) >= 3.6 : k === 'staff' || k === 'er' ? W(p) >= 3.2 && p.depth >= 3.5 : k === 'waiting' || k === 'chapel' ? W(p) * p.depth >= 28 : W(p) >= 2.6);
    const c = free(fit).sort((a, c2) => (k === 'waiting' || k === 'chapel' ? W(c2) * c2.depth - W(a) * a.depth : W(a) - W(c2)))[0] ?? free(() => true)[0];
    if (c) kinds.set(c, k);
  }
  let bag: RoomKind[] = [];
  for (const p of free(() => true)) {
    const big = W(p) * p.depth > 45;
    if (!bag.length) bag = rng.shuffle([...EXTRAS]);
    const small = W(p) < 3.1 || p.depth < 3.4;
    const i = bag.findIndex((k) => (big ? k !== 'bath' && k !== 'pharmacy' : small ? ['bath', 'storage', 'archive', 'pharmacy', 'laundry'].includes(k) : true));
    kinds.set(p, bag.splice(Math.max(0, i), 1)[0]);
  }

  const numbers = new Map<number, number>();
  for (const plan of plans) {
    const f = plan.f;
    const rooms: Room[] = [];
    plan.corrs.forEach((c, i) => b.h.corridors.push({ id: `${f}c${i}`, f, ...c }));
    const ordered = [...plan.pieces].sort((a, c) => (a.dw.axis === c.dw.axis ? a.dw.at - c.dw.at || a.dw.a0 - c.dw.a0 : a.dw.axis < c.dw.axis ? -1 : 1));
    for (const p of ordered) {
      const kind = kinds.get(p)!;
      const rc = rectOf(p.dw, p.depth);
      const id = `${f}r${Math.round((rc.x0 + 9) * 10)}_${Math.round((rc.z0 + 10) * 10)}`;
      let number: number | undefined;
      if (kind === 'patient' || kind === 'vacant') { const n = (numbers.get(f) ?? 0) + 1; numbers.set(f, n); number = f * 100 + n; }
      const r: Room = {
        id, f, kind, ...rc, side: p.dw.s, dw: p.dw, arch: p.arch, number,
        name: number ? { it: `${RN.patient.it} ${number}`, en: `${RN.patient.en} ${number}` } : RN[kind],
        zone: `${f}:${id}`, locked: false, windows: true, pw: 0, mirror: drng.chance(0.5),
      };
      rooms.push(r);
      b.h.rooms.push(r);
      (r as Room & { _door?: [number, number] })._door = p.door;
    }
    if (f === 20) {
      const lobby: Room = { id: 'lobby', f: 20, kind: 'lobby', x0: BX0, x1: 3, z0: CZ, z1: BZ1, side: 1, dw: { axis: 'x', at: CZ, a0: BX0, a1: 3, s: 1 }, arch: true, name: RN.lobby, zone: '20:lobby', locked: false, windows: true, pw: 0 };
      b.h.rooms.push(lobby);
    }
    buildFloor(b, plan, rooms, drng);
    for (const r of rooms) furnish(b, r, prng, drng);
    if (f === 20) buildReception(b, b.h.rooms.find((r) => r.id === 'lobby') as Room, drng);
    dressCorridors(b, f, drng);
  }
  buildCore(b);
  admitPatients(b, prng, nPatients);
  // ogni stanza ha il suo interruttore: le sue luci seguono un indice di alimentazione proprio
  b.h.rooms.forEach((r, k) => { r.pw = 6 + k; });
  const pwOf = new Map(b.h.rooms.map((r) => [r.zone, r.pw]));
  for (const bx of b.h.boxes) if (bx.p !== PWR_ALWAYS && bx.p !== PWR_MAIN) { const q = pwOf.get(bx.zone); if (q !== undefined) bx.p = q; }
  for (const c of b.h.cyls) if (c.p !== PWR_ALWAYS && c.p !== PWR_MAIN) { const q = pwOf.get(c.zone); if (q !== undefined) c.p = q; }
  for (const l of b.h.lamps) if (l.p !== PWR_ALWAYS && l.p !== PWR_MAIN) { const q = pwOf.get(l.zone); if (q !== undefined) l.p = q; }
  placeSwitches(b);
  // se nessun soggiorno ha accolto il Babbo Natale, sta in accettazione accanto all'albero
  if (!b.h.santa) b.h.santa = { f: 20, x: -5.9, z: 9.1, yaw: Math.PI };
  buildTower(b, drng);
  buildCity(b, drng);
  placeCams(b);
  return b.h;
}

// ---------------------------------------------------------------- muri, porte, finestre

function corrZone(f: number): string { return `${f}:corr`; }

interface Space extends Rect { zone: string; corr: boolean; room?: Room; lobby?: boolean }

/** Zona di luce nel punto (per la faccia nascosta dei muri). */
function zoneAt(spaces: Space[], x: number, z: number): string {
  if (x > STAIRS.x0 && x < STAIRS.x1 && z > STAIRS.z0 && z < STAIRS.z1) return 'stairs';
  if (x > ELEV.x0 && x < ELEV.x1 && z > ELEV.z0 && z < ELEV.z1) return 'shaft';
  for (const s of spaces) if (x > s.x0 && x < s.x1 && z > s.z0 && z < s.z1) return s.zone;
  return 'void';
}

function buildFloor(b: Builder, plan: FloorPlan, rooms: Room[], drng: Rng): void {
  const f = plan.f, y = floorY(f), p = powerOfFloor(f), cz = corrZone(f);
  const spaces: Space[] = [
    ...plan.corrs.map((c) => ({ ...c, zone: cz, corr: true })),
    ...rooms.map((r) => ({ x0: r.x0, x1: r.x1, z0: r.z0, z1: r.z1, zone: r.zone, corr: false, room: r })),
  ];
  if (f === 20) spaces.push({ x0: BX0, x1: 3, z0: CZ, z1: BZ1, zone: '20:lobby', corr: false, lobby: true });
  const ops: Opening[] = [...plan.junctions];
  if (f === 20) ops.push({ f, axis: 'x', at: CZ, a0: -8.4, a1: 2.4, top: 2.4 });
  // porte delle stanze, dentro il tratto di muro che dà sul corridoio
  for (const r of rooms) {
    const dr = (r as Room & { _door?: [number, number] })._door ?? [r.dw.a0, r.dw.a1];
    if (r.arch) {
      const a = Math.max(dr[0] + 0.3, r.dw.a0 + 0.3), c = Math.min(dr[1] - 0.3, r.dw.a1 - 0.3);
      ops.push({ f, axis: r.dw.axis, at: r.dw.at, a0: a, a1: c, top: 2.5 });
      continue;
    }
    const w = r.kind === 'patient' || r.kind === 'vacant' ? 1.3 : 1.1;
    const lo = Math.max(dr[0] + 0.25, r.dw.a0 + 0.35), hi = Math.min(dr[1] - 0.25, r.dw.a1 - 0.35);
    const a = hi - lo > w ? lo + (hi - lo - w) * (r.dw.a1 - r.dw.a0 > 5 ? drng.range(0, 0.25) : 0) : (lo + hi) / 2 - w / 2;
    const bb = a + w;
    const s = r.dw.s;
    const door: Door = { id: `door-${r.id}`, f, room: r.id, axis: r.dw.axis, z: r.dw.at, x0: a, x1: bb, side: s, locked: false, open: false, zoneIn: r.zone, zoneOut: cz };
    b.h.doors.push(door);
    ops.push({ f, axis: r.dw.axis, at: r.dw.at, a0: a, a1: bb, top: 2.15 });
    const out = doorPoint(door, -0.1), inn = doorPoint(door, 0.1), sg = doorPoint(door, -0.09);
    b.obj('door', f, out.x, y + 1.1, out.z, 0.6, r.id, door.id, `obj-${door.id}`);
    b.obj('door', f, inn.x, y + 1.1, inn.z, 0.6, r.id, door.id, `obj-${door.id}-in`);
    const n = r.dw.axis === 'x' ? { nx: 0, nz: -s } : { nx: -s, nz: 0 };
    b.h.signs.push({ f, x: sg.x, y: y + 2.42, z: sg.z, nx: n.nx, nz: n.nz, w: r.number ? 0.6 : Math.min(1.2, 0.3 + r.name.it.length * 0.075), h: 0.2, text: r.number ? { it: String(r.number), en: String(r.number) } : r.name, style: 'room' });
  }
  // pavimenti e soffitti
  for (const s of spaces) {
    if (s.lobby) continue;
    const k = s.room?.kind;
    const fc = k === 'chapel' ? COL.woodDark : k === 'bath' ? [0.8, 0.82, 0.83] as RGB : k === 'waiting' ? [0.55, 0.47, 0.38] as RGB : k === 'storage' || k === 'electrical' || k === 'laundry' ? shade(COL.floor, 0.78) : COL.floor;
    b.add(box(s.x0, s.x1, y - 0.3, y, s.z0, s.z1, fc, s.zone, p, { skip: F_NY, tess: 1.2 }));
    b.add(box(s.x0, s.x1, y + CEIL, y + CEIL + 0.3, s.z0, s.z1, COL.ceiling, s.zone, p, { skip: F_PY, tess: 1.2 }));
  }
  // i quattro lati di ogni ambiente: facciata se sta sul bordo dell'edificio, altrimenti mezzo muro verso l'interno
  for (const s of spaces) {
    const sides: { axis: 'x' | 'z'; at: number; a0: number; a1: number; inward: 1 | -1 }[] = [
      { axis: 'x', at: s.z0, a0: s.x0, a1: s.x1, inward: 1 }, { axis: 'x', at: s.z1, a0: s.x0, a1: s.x1, inward: -1 },
      { axis: 'z', at: s.x0, a0: s.z0, a1: s.z1, inward: 1 }, { axis: 'z', at: s.x1, a0: s.z0, a1: s.z1, inward: -1 },
    ];
    for (const sd of sides) {
      const ext = sd.axis === 'x' ? (sd.at <= BZ0 + 0.01 || sd.at >= BZ1 - 0.01) : (sd.at <= BX0 + 0.01 || sd.at >= BX1 - 0.01);
      if (s.lobby && (ext || (sd.axis === 'x' && Math.abs(sd.at - CZ) < 0.01))) {
        // l'atrio ha le sue vetrate (le costruisce l'accettazione), ma il varco sul corridoio è comune
        if (!ext) halfWall(b, f, sd, ops, s, spaces, true);
        continue;
      }
      // il fronte del vano scale e dell'ascensore lo costruisce il nucleo
      if (s.corr && sd.axis === 'x' && Math.abs(sd.at + CZ) < 0.01) {
        const a1 = Math.min(sd.a1, STAIRS.x1);
        if (sd.a0 < STAIRS.x1) { if (sd.a1 > STAIRS.x1) halfWall(b, f, { ...sd, a0: STAIRS.x1 }, ops, s, spaces, true); continue; }
        void a1;
      }
      if (ext) exteriorWall(b, f, sd, s, ops);
      else halfWall(b, f, sd, ops, s, spaces, s.corr || !!s.room?.kind.match(/patient|vacant|staff|waiting|office/));
    }
  }
}

/** Mezzo muro (spessore WT/2) appoggiato al confine, dalla parte dell'ambiente; con le aperture di quel confine. */
function halfWall(b: Builder, f: FloorId, sd: { axis: 'x' | 'z'; at: number; a0: number; a1: number; inward: 1 | -1 }, ops: Opening[], s: Space, spaces: Space[], wainscot: boolean): void {
  const y = floorY(f), p = powerOfFloor(f);
  const mine = ops.filter((o) => o.f === f && o.axis === sd.axis && Math.abs(o.at - sd.at) < 0.01 && o.a1 > sd.a0 && o.a0 < sd.a1).sort((a, c) => a.a0 - c.a0);
  const t0 = sd.at, t1 = sd.at + sd.inward * (WT / 2);
  const mid = (sd.a0 + sd.a1) / 2;
  const other = sd.axis === 'x' ? zoneAt(spaces, mid, sd.at - sd.inward * 0.2) : zoneAt(spaces, sd.at - sd.inward * 0.2, mid);
  const inF = sd.axis === 'x' ? (sd.inward === 1 ? 'pz' : 'nz') : (sd.inward === 1 ? 'px' : 'nx');
  const outF = sd.axis === 'x' ? (sd.inward === 1 ? 'nz' : 'pz') : (sd.inward === 1 ? 'nx' : 'px');
  const zones = { [inF]: s.zone, [outF]: other };
  const low = s.corr ? COL.wallLow : s.room?.kind === 'bath' ? [0.78, 0.84, 0.86] as RGB : s.room?.kind === 'chapel' ? COL.woodDark : COL.wallLow;
  const wall = s.room?.kind === 'bath' ? [0.86, 0.9, 0.9] as RGB : s.room?.kind === 'chapel' ? [0.78, 0.72, 0.6] as RGB : COL.wall;
  const piece = (a: number, c: number, y0: number, y1: number) => {
    if (c - a < 0.005 || y1 - y0 < 0.005) return;
    const mk = (yy0: number, yy1: number, col: RGB) => {
      const bx = sd.axis === 'x' ? box(a, c, y + yy0, y + yy1, t0, t1, col, s.zone, p, { zones, solid: true, tess: 1.2 }) : box(t0, t1, y + yy0, y + yy1, a, c, col, s.zone, p, { zones, solid: true, tess: 1.2 });
      b.add(bx);
    };
    if (wainscot && y0 < 1.0) { mk(y0, Math.min(1.0, y1), low); if (y1 > 1.0) mk(1.0, y1, wall); } else mk(y0, y1, wall);
    // corrimano lungo i muri pieni del corridoio
    if (s.corr && y0 === 0 && y1 >= CEIL - 0.01 && c - a > 0.5) {
      const r0 = sd.at + sd.inward * 0.08, r1 = sd.at + sd.inward * 0.13;
      const hb = sd.axis === 'x' ? box(a + 0.12, c - 0.12, y + 0.88, y + 0.94, r0, r1, COL.wood, s.zone, p) : box(r0, r1, y + 0.88, y + 0.94, a + 0.12, c - 0.12, COL.wood, s.zone, p);
      b.add(hb);
    }
  };
  let cur = sd.a0;
  for (const o of mine) {
    const a = Math.max(o.a0, sd.a0), c = Math.min(o.a1, sd.a1);
    piece(cur, a, 0, CEIL);
    piece(a, c, o.top, CEIL);
    if (o.y0 && o.y0 > 0) piece(a, c, 0, o.y0);
    cur = Math.max(cur, c);
  }
  piece(cur, sd.a1, 0, CEIL);
}

/** Facciata: muro intero con le finestre sulla città. */
function exteriorWall(b: Builder, f: FloorId, sd: { axis: 'x' | 'z'; at: number; a0: number; a1: number; inward: 1 | -1 }, s: Space, ops: Opening[]): void {
  const y = floorY(f), len = sd.a1 - sd.a0;
  const n = len < 3.4 ? 1 : Math.max(1, Math.floor(len / 3.6));
  const w = Math.min(2.2, len / n - 0.7);
  const winOps: { a: number; b: number; y0: number; top: number }[] = [];
  const room = s.room?.id ?? s.zone;
  const outN = (-sd.inward) as 1 | -1;
  const closet = s.room && ['bath', 'electrical', 'storage', 'linen', 'archive'].includes(s.room.kind) && len < 3.5;
  for (let k = 0; k < n && w > 0.6; k++) {
    const c = sd.a0 + ((k + 0.5) * len) / n;
    const y0 = closet ? 1.5 : 0.7;
    winOps.push({ a: c - w / 2, b: c + w / 2, y0, top: 2.5 });
    const win: Win = { id: `win-${room}-${sd.axis}${k}`, f, room, axis: sd.axis, at: sd.at, a0: c - w / 2, a1: c + w / 2, y0: y + y0, y1: y + 2.5, out: outN, zone: s.zone, open: false };
    b.h.windows.push(win);
    const ip = sd.at + sd.inward * 0.25, lp = sd.at + sd.inward * 0.6;
    if (k === 0 && !s.corr) b.obj('window', f, sd.axis === 'x' ? c : ip, y + 1.5, sd.axis === 'x' ? ip : c, 0.7, room, win.id, `obj-${win.id}`);
    b.lamp({ x: sd.axis === 'x' ? c : lp, y: y + 1.9, z: sd.axis === 'x' ? lp : c, zone: s.zone, p: PWR_ALWAYS, col: [0.55, 0.62, 0.85], i: 0.3, r: 2.4, mode: 'both' });
    // davanzale e termosifone sotto la finestra
    const sill = (a: number, c2: number, yy0: number, yy1: number, d0: number, d1: number, col: RGB) => b.add(sd.axis === 'x'
      ? box(a, c2, y + yy0, y + yy1, sd.at + sd.inward * d0, sd.at + sd.inward * d1, col, s.zone, powerOfFloor(f))
      : box(sd.at + sd.inward * d0, sd.at + sd.inward * d1, y + yy0, y + yy1, a, c2, col, s.zone, powerOfFloor(f)));
    sill(c - w / 2 - 0.05, c + w / 2 + 0.05, y0 - 0.04, y0, 0.08, 0.3, [0.85, 0.84, 0.8]);
    if (!closet) {
      sill(c - w / 2 + 0.1, c + w / 2 - 0.1, 0.15, 0.6, 0.1, 0.18, [0.9, 0.9, 0.88]);
      for (let q = c - w / 2 + 0.15; q < c + w / 2 - 0.12; q += 0.09) sill(q, q + 0.04, 0.15, 0.6, 0.18, 0.2, [0.82, 0.82, 0.8]);
    }
  }
  void ops;
  const zoneNeg = sd.inward === 1 ? 'out' : s.zone, zonePos = sd.inward === 1 ? s.zone : 'out';
  if (sd.axis === 'x') wallAlongX(b, f, sd.at, sd.a0, sd.a1, winOps, zoneNeg, zonePos, COL.wall, COL.wallLow, false);
  else wallAlongZ(b, f, sd.at, sd.a0, sd.a1, winOps, zoneNeg, zonePos, COL.wall, COL.wallLow, false);
}


function wallAlongX(
  b: Builder, f: FloorId, z: number, x0: number, x1: number,
  openings: { a: number; b: number; top: number; y0?: number }[],
  zoneNeg: string, zonePos: string, c: RGB, low: RGB, wainscot: boolean,
): void {
  const y = floorY(f), p = powerOfFloor(f);
  const ops = [...openings].sort((a, bb) => a.a - bb.a);
  let cur = x0;
  const piece = (a: number, bb: number, y0: number, y1: number) => {
    if (bb - a < 0.005 || y1 - y0 < 0.005) return;
    const zones = { nz: zoneNeg, pz: zonePos };
    const zone = zoneNeg === 'out' || zoneNeg === 'void' ? zonePos : zoneNeg;
    if (wainscot && y0 < 1.0) {
      b.add(box(a, bb, y + y0, y + Math.min(1.0, y1), z - WT / 2, z + WT / 2, low, zone, p, { zones, solid: true, tess: 1.2 }));
      if (y1 > 1.0) b.add(box(a, bb, y + 1.0, y + y1, z - WT / 2, z + WT / 2, c, zone, p, { zones, solid: true, tess: 1.2 }));
    } else b.add(box(a, bb, y + y0, y + y1, z - WT / 2, z + WT / 2, c, zone, p, { zones, solid: true, tess: 1.2 }));
  };
  for (const o of ops) {
    piece(cur, o.a, 0, CEIL);
    piece(o.a, o.b, o.top, CEIL);
    if (o.y0 && o.y0 > 0) piece(o.a, o.b, 0, o.y0);
    cur = o.b;
  }
  piece(cur, x1, 0, CEIL);
}

function wallAlongZ(
  b: Builder, f: FloorId, x: number, z0: number, z1: number,
  openings: { a: number; b: number; top: number; y0?: number }[],
  zoneNeg: string, zonePos: string, c: RGB, low: RGB, wainscot: boolean,
): void {
  const y = floorY(f), p = powerOfFloor(f);
  const ops = [...openings].sort((a, bb) => a.a - bb.a);
  let cur = z0;
  const piece = (a: number, bb: number, y0: number, y1: number) => {
    if (bb - a < 0.005 || y1 - y0 < 0.005) return;
    const zones = { nx: zoneNeg, px: zonePos };
    const zone = zoneNeg === 'out' || zoneNeg === 'void' ? zonePos : zoneNeg;
    if (wainscot && y0 < 1.0) {
      b.add(box(x - WT / 2, x + WT / 2, y + y0, y + Math.min(1.0, y1), a, bb, low, zone, p, { zones, solid: true, tess: 1.2 }));
      if (y1 > 1.0) b.add(box(x - WT / 2, x + WT / 2, y + 1.0, y + y1, a, bb, c, zone, p, { zones, solid: true, tess: 1.2 }));
    } else b.add(box(x - WT / 2, x + WT / 2, y + y0, y + y1, a, bb, c, zone, p, { zones, solid: true, tess: 1.2 }));
  };
  for (const o of ops) {
    piece(cur, o.a, 0, CEIL);
    piece(o.a, o.b, o.top, CEIL);
    if (o.y0 && o.y0 > 0) piece(o.a, o.b, 0, o.y0);
    cur = o.b;
  }
  piece(cur, z1, 0, CEIL);
}



// ---------------------------------------------------------------- arredi delle stanze
// Riferimenti: una degenza italiana (letto articolato con sponde, trave testaletto con ossigeno e vuoto,
// comodino con servitore, asta per flebo, lavabo con dispenser, crocifisso sopra la porta), i servizi
// con maniglioni e tirante d'allarme, la biancheria con scaffali a griglia e carrelli, il deposito
// della strumentazione con carrozzine, aste e bombole.

type WallName = 'far' | 'left' | 'right' | 'near';

/** Riferimento appoggiato a un muro: a lungo il muro, b distanza dal muro verso il centro della stanza. */
class WallFrame {
  readonly len: number;
  constructor(readonly L: Local, readonly w: WallName) { this.len = w === 'far' || w === 'near' ? L.W : L.D; }
  ud(a: number, bb: number): [number, number] {
    const L = this.L;
    bb += WT / 2; // la faccia interna del muro sta a mezzo spessore dal confine della stanza
    switch (this.w) {
      case 'far': return [a, L.D - bb];
      case 'near': return [a, bb];
      case 'left': return [bb, a];
      default: return [L.W - bb, a];
    }
  }
  box(a0: number, a1: number, y0: number, y1: number, b0: number, b1: number, c: RGB, extra: Partial<Box> = {}): Box {
    const [u0, d0] = this.ud(a0, b0), [u1, d1] = this.ud(a1, b1);
    return this.L.box(Math.min(u0, u1), Math.max(u0, u1), y0, y1, Math.min(d0, d1), Math.max(d0, d1), c, extra);
  }
  sbox(a0: number, a1: number, y0: number, y1: number, b0: number, b1: number, c: RGB, extra: Partial<Box> = {}): Box { return this.box(a0, a1, y0, y1, b0, b1, c, { solid: true, ...extra }); }
  cyl(a: number, bb: number, y0: number, y1: number, r0: number, r1: number, c: RGB, seg = 10, emit?: 0 | 1 | 2): void { const [u, d] = this.ud(a, bb); this.L.cyl(u, d, y0, y1, r0, r1, c, seg, emit); }
  obj(kind: ObjKind, a: number, yy: number, bb: number, r: number, data?: string, id?: string): Obj { const [u, d] = this.ud(a, bb); return this.L.obj(kind, u, yy, d, r, data, id); }
  lamp(a: number, bb: number, yy: number, col: RGB, i: number, r: number, mode: Lamp['mode'] = 'main'): void { const [u, d] = this.ud(a, bb); this.L.lamp(u, d, yy, col, i, r, mode); }
  /** Normale del muro verso la stanza. */
  n(): { nx: number; nz: number } { const L = this.L; return this.w === 'far' ? L.nD(-1) : this.w === 'near' ? L.nD(1) : this.w === 'left' ? L.nU(1) : L.nU(-1); }
  sign(a: number, yy: number, w: number, h: number, text: L10n, style: Sign['style'] = 'room'): void { const [u, d] = this.ud(a, 0.03); this.L.sign(u, yy, d, this.n(), w, h, text, style); }
}

const C = {
  steel: [0.7, 0.72, 0.74] as RGB, grey: [0.55, 0.57, 0.58] as RGB, cream: [0.86, 0.83, 0.74] as RGB, laminate: [0.78, 0.74, 0.66] as RGB,
  green2: [0.25, 0.55, 0.35] as RGB, yellow: [0.85, 0.72, 0.2] as RGB, o2: [0.2, 0.6, 0.3] as RGB, vinyl: [0.36, 0.42, 0.5] as RGB,
  bag: [0.9, 0.85, 0.3] as RGB, bagW: [0.88, 0.88, 0.86] as RGB, box: [0.72, 0.6, 0.42] as RGB, blueBox: [0.35, 0.45, 0.6] as RGB,
  sofa: [0.42, 0.28, 0.24] as RGB, sofa2: [0.3, 0.38, 0.35] as RGB, rug: [0.45, 0.16, 0.14] as RGB, mirror: [0.55, 0.65, 0.72] as RGB,
};

// ---- pezzi d'arredo (in coordinate di un muro)

function table(fr: WallFrame, a0: number, a1: number, b0: number, b1: number, h = 0.74, top: RGB = C.laminate): void {
  fr.box(a0, a1, h - 0.04, h, b0, b1, top);
  for (const [a, bb] of [[a0 + 0.05, b0 + 0.05], [a1 - 0.08, b0 + 0.05], [a0 + 0.05, b1 - 0.08], [a1 - 0.08, b1 - 0.08]]) fr.box(a, a + 0.04, 0, h - 0.04, bb, bb + 0.04, C.steel);
  const [u0, d0] = fr.ud(a0, b0), [u1, d1] = fr.ud(a1, b1);
  fr.L.solid(Math.min(u0, u1), Math.max(u0, u1), 0, h, Math.min(d0, d1), Math.max(d0, d1));
}
function chair(fr: WallFrame, a: number, bb: number, backToWall: boolean, col: RGB = C.vinyl): void {
  fr.box(a - 0.22, a + 0.22, 0.44, 0.5, bb - 0.22, bb + 0.22, col);
  const bk = backToWall ? bb - 0.22 : bb + 0.18;
  fr.box(a - 0.22, a + 0.22, 0.5, 0.95, bk, bk + 0.05, col);
  for (const [da, db] of [[-0.2, -0.2], [0.17, -0.2], [-0.2, 0.17], [0.17, 0.17]]) fr.box(a + da, a + da + 0.03, 0, 0.44, bb + db, bb + db + 0.03, C.steel);
}
function shelving(fr: WallFrame, a0: number, a1: number, depth: number, levels: number, fill: (k: number, j: number, a: number, aa: number) => void, h = 2.0, col: RGB = C.steel): void {
  for (const a of [a0, a1 - 0.04]) for (const bb of [0.04, depth - 0.04]) fr.box(a, a + 0.04, 0, h, bb - 0.02, bb + 0.02, col);
  for (let k = 0; k < levels; k++) {
    const y = 0.12 + (k * (h - 0.2)) / (levels - 1 || 1);
    fr.box(a0, a1, y, y + 0.03, 0.02, depth, col);
    if (k < levels - 1) {
      const n = Math.max(1, Math.floor((a1 - a0) / 0.45));
      for (let j = 0; j < n; j++) fill(k, j, a0 + 0.03 + (j * (a1 - a0 - 0.06)) / n, a0 + 0.03 + ((j + 1) * (a1 - a0 - 0.06)) / n - 0.04);
    }
  }
  const [u0, d0] = fr.ud(a0, 0), [u1, d1] = fr.ud(a1, depth);
  fr.L.solid(Math.min(u0, u1), Math.max(u0, u1), 0, h, Math.min(d0, d1), Math.max(d0, d1));
}
function cabinet(fr: WallFrame, a0: number, a1: number, depth: number, h: number, col: RGB = C.cream, doors = 2): void {
  fr.sbox(a0, a1, 0, h, 0, depth, col);
  for (let k = 1; k < doors; k++) { const a = a0 + ((a1 - a0) * k) / doors; fr.box(a - 0.005, a + 0.005, 0.05, h - 0.05, depth, depth + 0.005, shade(col, 0.7)); }
  for (let k = 0; k < doors; k++) { const a = a0 + ((a1 - a0) * (k + 0.5)) / doors + (k % 2 ? -0.08 : 0.08); fr.box(a - 0.01, a + 0.01, h * 0.55, h * 0.55 + 0.12, depth, depth + 0.02, C.steel); }
}
function sink(fr: WallFrame, a: number, mirror = true): void {
  fr.box(a - 0.3, a + 0.3, 0.78, 0.86, 0, 0.48, COL.white);
  fr.box(a - 0.22, a + 0.22, 0.6, 0.78, 0.05, 0.4, COL.white);
  fr.cyl(a, 0.08, 0.86, 1.0, 0.02, 0.02, C.steel, 6);
  if (mirror) fr.box(a - 0.3, a + 0.3, 1.15, 1.75, 0, 0.015, C.mirror);
  fr.box(a + 0.4, a + 0.52, 1.15, 1.4, 0, 0.08, COL.white); // dispenser
  fr.box(a - 0.55, a - 0.4, 1.2, 1.45, 0, 0.09, [0.85, 0.85, 0.85]); // salviette
  const [u0, d0] = fr.ud(a - 0.3, 0), [u1, d1] = fr.ud(a + 0.3, 0.48);
  fr.L.solid(Math.min(u0, u1), Math.max(u0, u1), 0.55, 0.9, Math.min(d0, d1), Math.max(d0, d1));
}
function toilet(fr: WallFrame, a: number, grab = true): void {
  fr.sbox(a - 0.19, a + 0.19, 0, 0.42, 0.1, 0.68, COL.white);
  fr.box(a - 0.2, a + 0.2, 0.42, 0.45, 0.1, 0.7, [0.95, 0.95, 0.93]);
  fr.box(a - 0.22, a + 0.22, 0.42, 0.8, 0, 0.18, COL.white);
  if (grab) {
    fr.box(a + 0.38, a + 0.42, 0.75, 0.79, 0.05, 0.75, C.steel);
    fr.box(a - 0.42, a - 0.38, 0.75, 0.79, 0.05, 0.75, C.steel);
    fr.box(a + 0.38, a + 0.42, 0.3, 0.79, 0.73, 0.77, C.steel);
  }
  fr.cyl(a + 0.55, 0.06, 0.6, 0.72, 0.07, 0.07, COL.white, 8); // portarotolo
}
function alarmCord(fr: WallFrame, a: number): void {
  fr.box(a - 0.05, a + 0.05, 2.2, 2.3, 0, 0.05, COL.white);
  fr.box(a - 0.006, a + 0.006, 0.3, 2.2, 0.03, 0.04, [0.9, 0.15, 0.1]);
  fr.box(a - 0.03, a + 0.03, 0.3, 0.38, 0.02, 0.06, [0.9, 0.15, 0.1]);
}
function ivPole(L: Local, u: number, d: number): void {
  L.cyl(u, d, 0, 0.06, 0.25, 0.25, C.steel, 5);
  L.cyl(u, d, 0.06, 1.95, 0.015, 0.015, C.steel, 5);
  L.box(u - 0.15, u + 0.15, 1.93, 1.95, d - 0.01, d + 0.01, C.steel);
  L.box(u - 0.12, u - 0.04, 1.6, 1.85, d - 0.02, d + 0.02, [0.85, 0.92, 0.95]);
}
function wheelchair(L: Local, u: number, d: number): void {
  for (const du of [-0.3, 0.3]) L.cyl(u + du, d, 0, 0.6, 0.3, 0.3, COL.dark, 10);
  L.box(u - 0.27, u + 0.27, 0.45, 0.5, d - 0.25, d + 0.2, COL.dark);
  L.box(u - 0.27, u + 0.27, 0.5, 0.95, d + 0.18, d + 0.22, COL.dark);
  L.box(u - 0.3, u + 0.3, 0.62, 0.66, d - 0.25, d + 0.2, C.steel);
  L.solid(u - 0.35, u + 0.35, 0, 0.9, d - 0.3, d + 0.25);
}
function cylinder(L: Local, u: number, d: number): void {
  L.cyl(u, d, 0, 1.25, 0.11, 0.11, COL.white, 8);
  L.cyl(u, d, 1.25, 1.38, 0.11, 0.05, C.o2, 8);
  L.cyl(u, d, 1.38, 1.46, 0.03, 0.03, C.steel, 5);
}
function plant(L: Local, u: number, d: number): void {
  L.cyl(u, d, 0, 0.4, 0.2, 0.25, C.cream, 8);
  L.cyl(u, d, 0.4, 1.2, 0.35, 0.05, COL.green, 7);
}
function clock(fr: WallFrame, a: number, y = 2.25): void { fr.cyl(a, 0.03, y, y + 0.01, 0.15, 0.15, COL.white, 12); fr.box(a - 0.005, a + 0.005, y - 0.1, y + 0.1, 0.03, 0.045, COL.dark); }
function crucifix(fr: WallFrame, a: number, y = 2.35): void { fr.box(a - 0.02, a + 0.02, y - 0.22, y + 0.12, 0, 0.03, COL.woodDark); fr.box(a - 0.1, a + 0.1, y - 0.01, y + 0.03, 0, 0.03, COL.woodDark); }
function tv(fr: WallFrame, a: number, y = 1.95, w = 0.7): void { fr.box(a - w / 2, a + w / 2, y - w * 0.29, y + w * 0.29, 0.02, 0.07, COL.dark); fr.box(a - w / 2 + 0.03, a + w / 2 - 0.03, y - w * 0.29 + 0.03, y + w * 0.29 - 0.03, 0.07, 0.072, [0.05, 0.06, 0.07]); }
function noticeBoard(fr: WallFrame, a: number, rng: Rng): void {
  fr.box(a - 0.5, a + 0.5, 1.3, 1.95, 0, 0.02, [0.62, 0.48, 0.32]);
  for (let k = 0; k < 6; k++) { const x = a - 0.4 + rng.next() * 0.7, y = 1.38 + rng.next() * 0.45; fr.box(x, x + 0.15, y, y + 0.18, 0.02, 0.025, rng.pick([COL.white, [0.95, 0.9, 0.5] as RGB, [0.9, 0.7, 0.7] as RGB])); }
}
function radiatorCover(fr: WallFrame, a0: number, a1: number): void { fr.box(a0, a1, 0.12, 0.6, 0, 0.12, [0.9, 0.9, 0.88]); }

/** Il letto articolato di degenza, con la testata contro il muro di destra (+u). */
function bedUnit(L: Local, d: number, made: boolean, rng: Rng): void {
  const W = L.W, u = W - 1.15;
  const right = new WallFrame(L, 'right');
  L.sbox(u - 1.0, u + 1.05, 0.2, 0.55, d - 0.46, d + 0.46, C.steel);
  for (const [du, dd] of [[-0.95, -0.4], [0.95, -0.4], [-0.95, 0.4], [0.95, 0.4]]) { L.box(u + du - 0.03, u + du + 0.03, 0.08, 0.2, d + dd - 0.03, d + dd + 0.03, C.steel); L.cyl(u + du, d + dd, 0, 0.08, 0.05, 0.05, COL.dark, 6); }
  L.box(u - 0.98, u + 1.0, 0.55, 0.68, d - 0.45, d + 0.45, COL.sheet);
  L.box(u + 0.7, u + 0.98, 0.68, 0.8, d - 0.3, d + 0.3, COL.white);
  if (made) L.box(u - 0.98, u + 0.55, 0.68, 0.72, d - 0.47, d + 0.47, COL.blanket);
  else { L.box(u - 0.98, u + 0.2, 0.68, 0.74, d - 0.47, d + 0.47, COL.blanket); L.box(u - 0.6, u + 0.5, 0.68, 0.72, d - 0.2, d + 0.5, shade(COL.blanket, 0.9)); }
  L.box(u + 1.0, u + 1.08, 0.2, 1.05, d - 0.48, d + 0.48, C.steel);
  L.box(u - 1.05, u - 0.98, 0.2, 0.85, d - 0.48, d + 0.48, C.steel);
  // sponde
  for (const s of [-1, 1]) L.box(u - 0.3, u + 0.75, 0.72, 0.76, d + s * 0.47 - 0.01, d + s * 0.47 + 0.01, C.steel);
  // trave testaletto: ossigeno, vuoto, luce di lettura, pera di chiamata
  right.box(d - 0.85, d + 0.85, 1.35, 1.6, 0, 0.12, [0.86, 0.86, 0.82]);
  right.box(d - 0.6, d - 0.5, 1.42, 1.52, 0.12, 0.15, C.o2);
  right.box(d - 0.4, d - 0.3, 1.42, 1.52, 0.12, 0.15, C.yellow);
  right.box(d + 0.35, d + 0.75, 1.5, 1.58, 0.12, 0.14, [1, 0.9, 0.7], { emit: 1 });
  right.lamp(d + 0.55, 0.4, 1.45, [1, 0.85, 0.6], 0.25, 1.4, 'main');
  right.box(d + 0.15, d + 0.2, 0.75, 1.35, 0.1, 0.12, COL.white);
  right.box(d + 0.12, d + 0.23, 0.68, 0.78, 0.09, 0.13, COL.white);
  // flussimetro dell'ossigeno con il gorgogliatore
  right.cyl(d - 0.55, 0.2, 1.2, 1.4, 0.04, 0.04, [0.8, 0.95, 1], 6);
  // comodino con il servitore, monitor sull'asta, sedia per i parenti
  L.sbox(W - 0.55, W - 0.08, 0, 0.78, d + 0.58, d + 1.05, C.cream);
  L.box(W - 0.5, W - 0.13, 0.4, 0.42, d + 1.05, d + 1.06, C.steel);
  L.cyl(W - 0.3, d + 0.8, 0.78, 0.92, 0.04, 0.035, [0.75, 0.85, 0.95], 8);
  L.box(u - 0.55, u - 0.5, 0, 0.9, d + 0.6, d + 0.65, C.steel);
  L.box(u - 0.9, u - 0.1, 0.9, 0.93, d + 0.55, d + 0.95, C.laminate);
  ivPole(L, W - 0.35, d - 0.72);
  L.box(W - 0.48, W - 0.22, 1.35, 1.6, d - 0.76, d - 0.68, COL.dark);
  L.box(W - 0.46, W - 0.24, 1.38, 1.57, d - 0.681, d - 0.679, [0.25, 0.85, 0.45], { emit: 1 });
  L.lamp(W - 0.35, d - 0.55, 1.5, [0.35, 0.9, 0.55], 0.12, 1.2, 'main');
  // binario della tenda separé, tenda raccolta
  L.box(u - 1.3, u + 1.15, 2.6, 2.63, d + 1.15, d + 1.18, C.steel);
  L.box(u - 1.3, u - 1.1, 0.4, 2.6, d + 1.1, d + 1.22, rng.pick([[0.62, 0.72, 0.68], [0.7, 0.68, 0.55]] as RGB[]));
  void made;
}

/** Tappeto: bordo scuro e campo, appena sopra il pavimento (non blocca). */
function rug(L: Local, u0: number, u1: number, d0: number, d1: number, field: RGB, border: RGB = shade(field, 0.55)): void {
  L.box(u0, u1, 0.004, 0.014, d0, d1, border);
  L.box(u0 + 0.12, u1 - 0.12, 0.014, 0.018, d0 + 0.12, d1 - 0.12, field);
  if (u1 - u0 > 1.6 && d1 - d0 > 1.2) L.box(u0 + 0.3, u1 - 0.3, 0.018, 0.021, d0 + 0.3, d1 - 0.3, shade(field, 1.18));
}
const RUGS: RGB[] = [[0.5, 0.14, 0.12], [0.2, 0.28, 0.4], [0.32, 0.36, 0.22], [0.55, 0.42, 0.25], [0.35, 0.18, 0.3]];

/** Un armadio, una libreria: in piedi contro un muro, a b = 0. */
function wallsFree(L: Local): WallName[] { return (['left', 'right', 'far'] as WallName[]).filter((w) => !L.isExt(w)); }
/** Tratto utile di un muro (lontano dalla porta sul muro vicino). */
function usable(L: Local, w: WallName): [number, number] { return w === 'far' || w === 'near' ? [0.2, L.W - 0.2] : [1.45, L.D - 0.2]; }

function furnish(b: Builder, r: Room, prng: Rng, drng: Rng): void {
  void prng;
  // il letto ha la testata contro un muro interno, mai contro la facciata
  if (r.kind === 'patient' || r.kind === 'vacant') {
    const L0 = new Local(b, r);
    if (L0.isExt('right') && !L0.isExt('left')) r.mirror = !r.mirror;
  }
  const L = new Local(b, r);
  const W = L.W, D = L.D;
  const door = b.h.doors.find((d) => d.room === r.id);
  const rd = (r as Room & { _door?: [number, number] })._door;
  let du: [number, number] = door ? [door.x0 - r.dw.a0, door.x1 - r.dw.a0] : rd ? [rd[0] - r.dw.a0, rd[1] - r.dw.a0] : [-1, -1];
  if (r.mirror) du = [W - du[1], W - du[0]];
  const F = (w: WallName) => new WallFrame(L, w);
  const far = F('far'), left = F('left'), right = F('right'), near = F('near');
  const inner = wallsFree(L);
  // tratti liberi del muro della porta
  const nearSpans: [number, number][] = [[0.2, du[0] - 0.35], [du[1] + 0.35, W - 0.2]].filter(([a, c]) => c - a > 0.5) as [number, number][];
  switch (r.kind) {
    case 'patient': case 'vacant': return patientRoom(b, L, drng, du, r.kind === 'vacant');
    case 'staff': {
      // cucinino: piano di lavoro con lavello e bollitore su un muro interno, frigo e acqua su un altro
      const cw = inner.includes('far') ? 'far' : inner[0] ?? 'far';
      const fr = F(cw), [a0, a1] = usable(L, cw);
      const run = Math.min(a1 - a0, 3.2);
      cabinet(fr, a0, a0 + run, 0.6, 0.86, C.cream, 4);
      fr.box(a0 - 0.02, a0 + run + 0.02, 0.86, 0.9, 0, 0.62, [0.4, 0.4, 0.42]);
      fr.box(a0 + 0.3, a0 + 0.9, 0.87, 0.91, 0.1, 0.5, C.steel);
      fr.cyl(a0 + 0.6, 0.08, 0.9, 1.15, 0.02, 0.02, C.steel, 6);
      fr.box(a0, a0 + run, 1.5, 2.2, 0, 0.35, C.cream);
      fr.box(a0 + 1.2, a0 + 1.7, 0.9, 1.2, 0.05, 0.4, COL.dark);
      fr.box(a0 + 1.22, a0 + 1.55, 0.95, 1.15, 0.4, 0.401, [0.1, 0.1, 0.1]);
      const ka = Math.min(a0 + run - 0.3, a0 + 2.1);
      fr.cyl(ka, 0.25, 0.9, 1.12, 0.09, 0.08, C.steel, 8);
      const k = fr.obj('kettle', ka, 1.02, 0.25, 0.25);
      b.h.sources.kettle.push(k.id);
      if (run > 2.6) fr.box(a0 + 2.5, a0 + 2.9, 0.9, 1.0, 0.1, 0.35, [0.7, 0.2, 0.15]);
      // frigo e distributore: sull'altro muro interno, o accanto al piano di lavoro
      const ow = inner.find((w) => w !== cw);
      const fw = ow ? F(ow) : fr;
      const fa = ow ? usable(L, ow)[0] + 0.1 : Math.min(a1 - 1.3, a0 + run + 0.1);
      fw.sbox(fa, fa + 0.65, 0, 1.85, 0, 0.65, COL.white);
      fw.box(fa + 0.05, fa + 0.6, 1.0, 1.02, 0.65, 0.66, C.grey);
      fw.sbox(fa + 0.75, fa + 1.2, 0, 1.0, 0, 0.4, COL.white);
      fw.cyl(fa + 0.975, 0.2, 1.0, 1.42, 0.16, 0.16, [0.45, 0.65, 0.95], 10);
      const w = fw.obj('water', fa + 0.975, 1.1, 0.2, 0.35);
      b.h.sources.water.push(w.id);
      // tavolo con le sedie e la stella di Natale
      if (D >= 4.6 && W >= 3.4) {
        const tc = W / 2, td = D / 2 + 0.2;
        table(near, tc - 0.6, tc + 0.6, td - 0.4, td + 0.4);
        for (const [a, bb, back] of [[tc - 0.35, td - 0.65, false], [tc + 0.35, td - 0.65, false], [tc - 0.35, td + 0.65, true], [tc + 0.35, td + 0.65, true]] as const) chair(near, a, bb, !back);
        near.box(tc - 0.1, tc + 0.1, 0.74, 0.9, td - 0.1, td + 0.1, [0.8, 0.2, 0.15]);
        near.box(tc - 0.14, tc + 0.14, 0.88, 1.0, td - 0.14, td + 0.14, [0.75, 0.1, 0.1]);
      }
      // bacheca e calendario dell'Avvento accanto alla porta
      const sp = nearSpans.sort((x, y) => (y[1] - y[0]) - (x[1] - x[0]))[0];
      if (sp) {
        const c = (sp[0] + sp[1]) / 2;
        noticeBoard(near, c - 0.3, drng);
        near.box(c + 0.35, c + 0.85, 1.3, 1.95, 0, 0.03, [0.6, 0.12, 0.1]);
        for (let i = 0; i < 24; i++) near.box(c + 0.39 + (i % 4) * 0.11, c + 0.47 + (i % 4) * 0.11, 1.36 + Math.floor(i / 4) * 0.095, 1.42 + Math.floor(i / 4) * 0.095, 0.03, 0.035, i === 23 ? COL.gold : [0.15, 0.1, 0.08]);
        near.obj('advent', c + 0.6, 1.62, 0.1, 0.3);
      }
      L.lamps(0.75);
      return;
    }
    case 'linen': {
      // biancheria pulita: scaffali a griglia con le pile di lenzuola, carrello dei sacchi
      const piles: RGB[] = [COL.sheet, COL.blanket, [0.88, 0.86, 0.78], [0.62, 0.72, 0.68], COL.white];
      const walls = inner.length ? inner : ['far' as WallName];
      let first: Obj | null = null;
      for (const w of walls) {
        const fr = F(w);
        let [a0, a1] = usable(L, w);
        if (w === 'far') { if (walls.includes('left')) a0 = Math.max(a0, 0.75); if (walls.includes('right')) a1 = Math.min(a1, W - 0.75); }
        if (a1 - a0 < 0.8) continue;
        shelving(fr, a0, a1, 0.55, 4, (k, _j, a, aa) => {
          if (drng.chance(0.15)) return;
          const y0 = 0.15 + k * 0.6, n = drng.int(2, 5);
          for (let q = 0; q < n; q++) fr.box(a, aa, y0 + q * 0.08, y0 + q * 0.08 + 0.075, 0.06, 0.5, drng.pick(piles));
        });
        const o = fr.obj('linen', (a0 + a1) / 2, 1.1, 0.4, 0.6);
        if (!first) { first = o; b.h.sources.linen.push(o.id); }
      }
      if (W > 2.4 && D > 3.6) {
        const cu = W / 2, cd = Math.min(D - 1.6, D / 2 + 0.4);
        L.box(cu - 0.45, cu + 0.45, 0.85, 0.88, cd - 0.4, cd + 0.4, C.steel);
        for (const sx of [-0.4, 0.4]) L.box(cu + sx - 0.02, cu + sx + 0.02, 0, 0.88, cd - 0.4, cd + 0.4, C.steel);
        L.box(cu - 0.4, cu - 0.02, 0.2, 0.85, cd - 0.35, cd + 0.35, C.bag);
        L.box(cu + 0.02, cu + 0.4, 0.2, 0.85, cd - 0.35, cd + 0.35, C.bagW);
        L.solid(cu - 0.45, cu + 0.45, 0, 0.9, cd - 0.4, cd + 0.4);
      }
      L.lamps(0.7, [0.95, 0.98, 1]);
      return;
    }
    case 'bath': {
      const tiles: RGB = [0.8, 0.86, 0.88];
      // piastrelle sul muro della porta, interrotte dalla porta
      for (const [a, c] of [[0, du[0]], [du[1], W]] as [number, number][]) if (c - a > 0.05) near.box(a, c, 0, 1.5, 0, 0.02, tiles);
      const cabinsOn: WallName | null = W >= 4.0 && D >= 4.5 && !L.isExt('far') ? 'far' : D >= 5 && W >= 2.8 ? (inner.find((w) => w === 'right' || w === 'left') ?? null) : null;
      const sinkWall: WallName | undefined = inner.find((w) => w !== cabinsOn && w !== 'far') ?? inner.find((w) => w !== cabinsOn);
      if (cabinsOn === 'far') {
        const cab = Math.min(1.6, (W - 0.4) / 2);
        for (let k = 0; k < 2; k++) {
          const a0 = 0.2 + k * cab, a1 = a0 + cab;
          far.sbox(a1 - 0.04, a1, 0, 2.1, 0, 1.75, [0.75, 0.8, 0.82]);
          far.sbox(a0, a0 + 0.25, 0, 2.1, 1.71, 1.75, [0.75, 0.8, 0.82]);
          far.box(a0 + 0.25, a1 - 0.04, 1.95, 2.1, 1.71, 1.75, [0.75, 0.8, 0.82]);
          toilet(far, a0 + cab / 2, true);
          alarmCord(far, a1 - 0.15);
        }
      } else if (cabinsOn) {
        const fr = F(cabinsOn);
        const n = Math.max(1, Math.min(3, Math.floor((D - 2.6) / 1.5)));
        for (let k = 0; k < n; k++) {
          const a0 = D - 0.2 - (k + 1) * 1.5, a1 = a0 + 1.5;
          fr.sbox(a0, a0 + 0.04, 0, 2.1, 0, 1.6, [0.75, 0.8, 0.82]);
          fr.sbox(a1 - 0.25, a1, 0, 2.1, 1.56, 1.6, [0.75, 0.8, 0.82]);
          fr.box(a0 + 0.04, a1 - 0.25, 1.95, 2.1, 1.56, 1.6, [0.75, 0.8, 0.82]);
          toilet(fr, a0 + 0.75, true);
          alarmCord(fr, a0 + 0.2);
        }
      } else {
        // bagno piccolo: wc accessibile contro un muro interno
        const tw = inner.includes('far') ? 'far' : inner[0] ?? 'far';
        const fr = F(tw), [a0, a1] = usable(L, tw);
        toilet(fr, tw === 'far' ? W / 2 : Math.max(a0 + 0.6, a1 - 0.7), true);
        alarmCord(fr, tw === 'far' ? Math.min(W - 0.2, W / 2 + 0.7) : Math.max(a0 + 0.2, a1 - 1.4));
      }
      if (sinkWall) {
        const fr = F(sinkWall), [a0, a1] = usable(L, sinkWall);
        const n = Math.max(1, Math.min(3, Math.floor((a1 - a0) / 0.95)));
        for (let k = 0; k < n && k < (cabinsOn ? 3 : 1); k++) sink(fr, a0 + 0.45 + k * 0.95);
      } else if (nearSpans.length) sink(near, (nearSpans[0][0] + nearSpans[0][1]) / 2);
      // doccia con il seggiolino nell'angolo di fondo, se c'è spazio
      if (D > 4 && W > 2.6 && cabinsOn !== 'far') {
        far.box(0.15, 1.35, 0.005, 0.02, 0, 1.1, [0.7, 0.75, 0.78]);
        far.box(0.15, 1.35, 2.2, 2.22, 1.08, 1.1, C.steel);
        far.box(0.15, 0.45, 0.3, 2.2, 1.07, 1.11, [0.8, 0.86, 0.9]);
        far.box(0.5, 0.9, 0.45, 0.5, 0, 0.4, COL.white);
        far.cyl(0.8, 0.08, 1.2, 2.1, 0.015, 0.015, C.steel, 5);
      }
      L.lamps(0.75, [0.95, 0.98, 1]);
      return;
    }
    case 'storage': {
      // deposito della strumentazione: scaffalature sui muri interni, l'armadio delle pile accanto alla porta
      const sp = nearSpans.sort((x, y) => (y[1] - y[0]) - (x[1] - x[0]))[0];
      let batWall: WallName = 'near', batA = 0;
      if (sp && sp[1] - sp[0] >= 0.9) batA = (sp[0] + sp[1]) / 2;
      else { batWall = inner[0] ?? 'far'; batA = usable(L, batWall)[0] + 0.45; }
      const bw = F(batWall);
      const bb0 = 0;
      bw.sbox(batA - 0.4, batA + 0.4, 0, 1.25, bb0, bb0 + 0.5, [0.48, 0.5, 0.52]);
      for (let k = 0; k < 5; k++) bw.box(batA - 0.35, batA + 0.35, 0.1 + k * 0.23, 0.3 + k * 0.23, bb0 + 0.5, bb0 + 0.51, [0.4, 0.42, 0.44]);
      bw.sign(batA, 1.42, 0.6, 0.14, { it: 'Pile e batterie', en: 'Batteries' }, 'ward');
      const bt = bw.obj('batteries', batA, 1.0, bb0 + 0.45, 0.4);
      b.h.sources.batteries.push(bt.id);
      for (const w of inner) {
        const fr = F(w);
        let [a0, a1] = usable(L, w);
        if (w === batWall) a0 = batA + 0.55;
        if (w === 'far') { if (inner.includes('left')) a0 = Math.max(a0, 0.8); if (inner.includes('right')) a1 = Math.min(a1, W - 0.8); }
        if (a1 - a0 < 0.8) continue;
        shelving(fr, a0, a1, 0.6, 4, (k, _j, a, aa) => {
          if (drng.chance(0.2)) return;
          const y0 = 0.16 + k * 0.6;
          fr.box(a, aa, y0, y0 + drng.range(0.18, 0.42), 0.05, drng.range(0.35, 0.55), drng.pick([C.box, C.box, C.blueBox, COL.white, [0.75, 0.3, 0.25] as RGB]));
        }, 2.1);
      }
      // al centro: carrozzine in fila, aste per flebo, bombole su un carrello
      if (W > 2.8 && D > 4) {
        const cu = W / 2;
        wheelchair(L, cu - 0.4, D - 1.4);
        if (W > 3.6) wheelchair(L, cu + 0.45, D - 1.45);
        for (let k = 0; k < 3; k++) ivPole(L, cu - 0.6 + k * 0.18, Math.max(2.2, D / 2 - 0.4));
        for (let k = 0; k < 4; k++) cylinder(L, cu - 0.4 + k * 0.26, Math.max(2.6, D / 2 + 0.3));
        L.box(cu - 0.55, cu + 0.55, 0.6, 0.64, Math.max(2.45, D / 2 + 0.15), Math.max(2.75, D / 2 + 0.45), C.steel);
      }
      L.lamps(0.6, [0.95, 0.98, 1]);
      return;
    }
    case 'er': {
      // ambulatorio: lettino al centro, lampada scialitica, armadi a vetri, carrello delle urgenze
      const cu = W / 2, cd = D / 2 + 0.3;
      L.sbox(cu - 0.35, cu + 0.35, 0, 0.75, cd - 1.0, cd + 1.0, C.steel);
      L.box(cu - 0.35, cu + 0.35, 0.75, 0.85, cd - 1.0, cd + 1.0, [0.35, 0.45, 0.55]);
      L.box(cu - 0.32, cu + 0.32, 0.85, 0.86, cd - 0.8, cd + 1.0, COL.white);
      L.cyl(cu, cd, CEIL - 0.6, CEIL - 0.42, 0.4, 0.3, COL.white, 12);
      L.cyl(cu, cd, CEIL - 0.42, CEIL, 0.02, 0.02, C.steel, 5);
      const cw = inner.find((w) => w !== 'far') ?? inner[0];
      if (cw) {
        const fr = F(cw), [a0, a1] = usable(L, cw);
        const e = Math.min(a1, a0 + 2.2);
        cabinet(fr, a0, e, 0.45, 2.0, [0.85, 0.88, 0.9], 3);
        for (let k = 0; k < 3; k++) fr.box(a0 + 0.1, e - 0.1, 1.1 + k * 0.3, 1.3 + k * 0.3, 0.46, 0.47, [0.7, 0.85, 0.9]);
      }
      const spn = nearSpans.find((x) => x[1] - x[0] >= 1.6);
      const ow: WallName = inner.find((w) => w !== cw) ?? (spn ? 'near' : 'far');
      const fr2 = F(ow);
      const a2 = ow === 'near' ? spn![0] : ow === 'far' ? 0.3 : usable(L, ow)[0];
      const o2 = 0;
      fr2.sbox(a2, a2 + 0.6, 0, 1.0, o2, o2 + 0.5, [0.75, 0.12, 0.1]);
      for (let k = 0; k < 4; k++) fr2.box(a2 + 0.02, a2 + 0.58, 0.12 + k * 0.22, 0.3 + k * 0.22, o2 + 0.5, o2 + 0.51, [0.6, 0.1, 0.08]);
      fr2.box(a2 + 0.1, a2 + 0.5, 1.0, 1.2, o2 + 0.05, o2 + 0.4, [0.85, 0.7, 0.15]);
      fr2.box(a2 + 0.12, a2 + 0.28, 1.08, 1.18, o2 + 0.4, o2 + 0.401, [0.2, 0.9, 0.4], { emit: 1 });
      fr2.sbox(a2 + 0.8, a2 + 1.5, 0, 0.9, o2, o2 + 0.5, C.cream);
      const bt = fr2.obj('batteries', a2 + 1.15, 0.95, o2 + 0.4, 0.35);
      b.h.sources.batteries.push(bt.id);
      fr2.sign(a2 + 1.15, 1.2, 0.5, 0.1, { it: 'Pile', en: 'Batteries' }, 'ward');
      if (!L.isExt('far') && D > 4.5) sink(far, Math.min(W - 0.6, 0.8));
      L.lamps(0.85, [0.95, 0.98, 1]);
      return;
    }
    case 'office': {
      // studio medico: scrivania rivolta alla porta, libreria su un muro interno, tappeto, diafanoscopio
      const cu = W / 2, cd = Math.min(D - 1.4, D * 0.6);
      rug(L, cu - 1.3, cu + 1.3, cd - 1.6, cd + 1.1, drng.pick(RUGS));
      table(near, cu - 0.8, cu + 0.8, cd - 0.4, cd + 0.4, 0.75, COL.woodDark);
      near.box(cu - 0.25, cu + 0.25, 0.75, 1.1, cd + 0.2, cd + 0.25, COL.dark);
      near.box(cu - 0.22, cu + 0.22, 0.78, 1.07, cd + 0.19, cd + 0.2, [0.4, 0.55, 0.65], { emit: 1 });
      chair(near, cu, cd + 0.75, false, COL.dark);
      chair(near, cu - 0.4, cd - 0.75, true);
      chair(near, cu + 0.4, cd - 0.75, true);
      const bw2 = inner.find((w) => w !== 'far') ?? inner[0];
      if (bw2) {
        const fr = F(bw2), [a0, a1] = usable(L, bw2);
        shelving(fr, a0, Math.min(a1, a0 + 2.6), 0.4, 5, (k, _j, a, aa) => { if (drng.chance(0.7)) fr.box(a, aa, 0.16 + k * 0.46, 0.16 + k * 0.46 + drng.range(0.22, 0.32), 0.03, 0.3, drng.pick([COL.woodDark, COL.blue, COL.red, [0.3, 0.3, 0.32] as RGB])); }, 2.1, COL.woodDark);
      }
      const lw = inner.find((w) => w !== bw2);
      if (lw) { const fr = F(lw), [a0, a1] = usable(L, lw); fr.box((a0 + a1) / 2 - 0.6, (a0 + a1) / 2 + 0.6, 1.3, 1.8, 0, 0.05, [0.85, 0.9, 0.95], { emit: 1 }); }
      crucifix(near, (du[0] + du[1]) / 2);
      plant(L, W - 0.4, D - 0.4);
      L.lamps(0.7);
      return;
    }
    case 'chapel': {
      // cappellina: banchi in file, passatoia rossa, altare in fondo, ceri, presepe
      const rows = Math.max(2, Math.min(7, Math.floor((D - 2.6) / 1.05)));
      const bw = Math.min(1.9, (W - 1.6) / 2);
      for (let k = 0; k < rows; k++) for (const u of [0.5, W - 0.5 - bw]) {
        const d = 1.6 + k * 1.05;
        L.sbox(u, u + bw, 0, 0.45, d, d + 0.42, COL.woodDark);
        L.box(u, u + bw, 0.45, 0.9, d + 0.38, d + 0.43, COL.woodDark);
        L.box(u, u + bw, 0.15, 0.22, d + 0.55, d + 0.7, COL.woodDark);
      }
      rug(L, W / 2 - 0.45, W / 2 + 0.45, 1.0, D - 1.2, [0.55, 0.1, 0.1], [0.75, 0.6, 0.2]);
      far.sbox(W / 2 - 0.9, W / 2 + 0.9, 0, 1.0, 0.5, 1.1, COL.white);
      far.box(W / 2 - 0.95, W / 2 + 0.95, 0.95, 1.0, 0.45, 1.15, [0.85, 0.78, 0.55]);
      // il crocifisso appeso sopra l'altare, staccato dal muro (davanti a un'eventuale finestra)
      far.box(W / 2 - 0.05, W / 2 + 0.05, 1.5, 2.6, 0.25, 0.29, COL.woodDark);
      far.box(W / 2 - 0.35, W / 2 + 0.35, 2.2, 2.3, 0.25, 0.29, COL.woodDark);
      far.box(W / 2 - 0.01, W / 2 + 0.01, 2.6, CEIL, 0.26, 0.28, C.steel);
      for (const du2 of [-0.7, 0.7]) {
        far.cyl(W / 2 + du2, 0.8, 1.0, 1.25, 0.03, 0.03, COL.white, 6);
        far.cyl(W / 2 + du2, 0.8, 1.25, 1.3, 0.012, 0.005, [1, 0.75, 0.3], 5, 2);
        far.lamp(W / 2 + du2, 0.8, 1.4, [1, 0.65, 0.3], 0.35, 1.8, 'both');
      }
      const cw = inner.find((w) => w === 'left' || w === 'right');
      if (cw) {
        const fr = F(cw), a = usable(L, cw)[1] - 1.2;
        fr.sbox(a - 0.4, a + 0.4, 0, 0.9, 0.1, 0.5, COL.woodDark);
        for (let k = 0; k < 8; k++) fr.cyl(a - 0.25 + (k % 4) * 0.16, 0.22 + Math.floor(k / 4) * 0.14, 0.9, 0.98, 0.025, 0.025, [0.85, 0.2, 0.15], 5, 2);
        fr.lamp(a, 0.4, 1.1, [1, 0.6, 0.3], 0.4, 1.6, 'both');
      }
      // presepe su un tavolo nell'angolo di fondo
      const pa = W - 0.9, pb = 0.9;
      far.sbox(pa - 0.6, pa + 0.6, 0, 0.5, pb - 0.5, pb + 0.5, COL.woodDark);
      far.box(pa - 0.5, pa + 0.5, 0.5, 1.1, pb - 0.45, pb - 0.35, COL.wood);
      far.box(pa - 0.55, pa + 0.55, 1.1, 1.16, pb - 0.45, pb + 0.3, [0.75, 0.62, 0.35]);
      for (const [da, h, c] of [[-0.25, 0.32, COL.blue], [0.22, 0.36, [0.55, 0.35, 0.2] as RGB], [-0.4, 0.22, [0.85, 0.85, 0.8] as RGB], [0.42, 0.2, [0.5, 0.4, 0.3] as RGB]] as const) far.box(pa + da - 0.06, pa + da + 0.06, 0.5, 0.5 + h, pb - 0.05, pb + 0.07, c);
      far.box(pa - 0.12, pa + 0.12, 0.5, 0.58, pb + 0.05, pb + 0.2, [0.75, 0.62, 0.35]);
      far.box(pa - 0.06, pa + 0.06, 1.25, 1.37, pb - 0.2, pb - 0.16, [1, 0.9, 0.5], { emit: 1 });
      far.lamp(pa, pb + 0.2, 1.2, [1, 0.75, 0.45], 0.45, 1.4, 'both');
      far.obj('presepe', pa, 0.8, pb + 0.3, 0.55);
      L.lamps(0.3, [1, 0.85, 0.65]);
      return;
    }
    case 'pharmacy': case 'archive': {
      // file di scaffali perpendicolari alla porta, con un corridoio libero davanti
      const wood = r.kind === 'archive';
      const col: RGB = wood ? COL.woodDark : C.steel;
      const d0 = 1.5, d1 = D - (L.isExt('far') ? 1.1 : 0.3);
      for (let u = 0.7; u + 0.5 < W - 0.5 && d1 - d0 > 1; u += 1.6) {
        L.sbox(u, u + 0.5, 0, 0.04, d0, d1, col);
        for (const uu of [u, u + 0.46]) for (const dd of [d0, d1 - 0.04]) L.box(uu, uu + 0.04, 0, 2.1, dd, dd + 0.04, col);
        for (let k = 0; k < 5; k++) L.box(u, u + 0.5, 0.12 + k * 0.48, 0.15 + k * 0.48, d0, d1, col);
        for (let k = 0; k < 4; k++) for (let dd = d0 + 0.1; dd < d1 - 0.15; dd += 0.32) if (drng.chance(0.8)) L.box(u + 0.04, u + 0.46, 0.15 + k * 0.48, 0.15 + k * 0.48 + drng.range(0.25, 0.33), dd, dd + 0.08, wood ? drng.pick([[0.75, 0.62, 0.42], [0.3, 0.4, 0.6], [0.55, 0.2, 0.18]] as RGB[]) : drng.pick([COL.white, [0.9, 0.85, 0.6] as RGB, [0.6, 0.75, 0.85] as RGB]));
        L.solid(u, u + 0.5, 0, 2.1, d0, d1);
      }
      if (!wood && nearSpans[0]) { const a = nearSpans[0][0] + 0.1; near.sbox(a, a + 0.6, 0, 1.8, 0, 0.6, COL.white); near.box(a + 0.05, a + 0.55, 1.0, 1.75, 0.6, 0.61, [0.7, 0.85, 0.95]); }
      L.lamps(wood ? 0.5 : 0.75);
      return;
    }
    case 'lockers': {
      const c: RGB = drng.pick([[0.5, 0.6, 0.7], [0.55, 0.62, 0.5], [0.65, 0.6, 0.55]] as RGB[]);
      for (const w of inner.filter((x) => x !== 'far')) {
        const fr = F(w), [a0, a1] = usable(L, w);
        fr.sbox(a0, a1, 0, 1.95, 0, 0.5, c);
        for (let a = a0; a < a1; a += 0.4) { fr.box(a + 0.005, a + 0.01, 0.08, 1.88, 0.5, 0.505, shade(c, 0.55)); fr.box(a + 0.15, a + 0.25, 1.6, 1.64, 0.5, 0.505, shade(c, 0.4)); }
        if (drng.chance(0.5)) { const a = a0 + 0.4 * drng.int(0, Math.max(0, Math.floor((a1 - a0) / 0.4) - 1)); fr.box(a + 0.02, a + 0.38, 0.1, 1.85, 0.5, 0.9, shade(c, 0.85)); }
      }
      if (D > 3.5) L.sbox(W / 2 - 0.2, W / 2 + 0.2, 0, 0.45, 1.8, D - 1.2, COL.wood);
      L.lamps(0.65, [0.95, 0.98, 1]);
      return;
    }
    case 'laundry': {
      const mw = inner.includes('far') ? 'far' : inner[0] ?? 'far';
      const fr = F(mw), [a0, a1] = usable(L, mw);
      const n = Math.max(1, Math.min(4, Math.floor((a1 - a0) / 0.9)));
      for (let k = 0; k < n; k++) {
        const a = a0 + k * 0.9;
        fr.sbox(a, a + 0.8, 0, 1.1, 0, 0.8, COL.white);
        fr.cyl(a + 0.4, 0.81, 0.35, 0.37, 0.27, 0.27, COL.dark, 12);
        fr.box(a + 0.1, a + 0.7, 0.95, 1.05, 0.8, 0.81, [0.3, 0.6, 0.9], { emit: 1 });
      }
      const tw = inner.find((w) => w !== mw);
      const tf = tw ? F(tw) : near;
      const [t0, t1] = tw ? usable(L, tw) : (nearSpans[0] ?? [0.2, 1.4]);
      table(tf, t0 + 0.1, Math.min(t1, t0 + 2.0), tw ? 0.1 : 0.2, tw ? 0.8 : 0.9, 0.9, C.steel);
      for (let k = 0; k < 4; k++) tf.box(t0 + 0.2 + k * 0.4, t0 + 0.5 + k * 0.4, 0.9, 0.98 + (k % 2) * 0.06, tw ? 0.2 : 0.3, tw ? 0.6 : 0.7, drng.pick([COL.sheet, COL.blanket]));
      const o = tf.obj('linen', t0 + 0.9, 1.1, tw ? 0.5 : 0.6, 0.6);
      b.h.sources.linen.push(o.id);
      for (let k = 0; k < 3; k++) L.box(W / 2 - 0.3, W / 2 + 0.3, 0, 0.75, D / 2 - 0.9 + k * 0.6, D / 2 - 0.35 + k * 0.6, k % 2 ? C.bag : C.bagW);
      L.solid(W / 2 - 0.3, W / 2 + 0.3, 0, 0.75, D / 2 - 0.9, D / 2 + 0.85);
      L.lamps(0.75, [0.95, 0.98, 1]);
      return;
    }
    case 'waiting': return dayRoom(b, L, drng, du, inner);
    case 'electrical': {
      const pw2 = inner.includes('far') ? 'far' : inner[0] ?? 'far';
      const fr = F(pw2), [u0, u1] = usable(L, pw2);
      const a0 = pw2 === 'far' ? Math.max(0.3, (W - 3.4) / 2) : Math.max(u0, Math.min(u1 - 3.4, u0));
      fr.sbox(a0, a0 + 3.4, 0.3, 2.3, 0, 0.38, [0.62, 0.64, 0.6]);
      fr.box(a0 + 0.05, a0 + 3.35, 0.35, 2.25, 0.38, 0.4, [0.55, 0.57, 0.53]);
      fr.obj('breaker', a0 + 0.5, 1.45, 0.5, 0.16, 'main', 'breaker-main');
      FLOORS.forEach((ff, k) => fr.obj('breaker', a0 + 1.4 + k * 0.65, 1.45, 0.5, 0.14, String(ff), `breaker-${ff}`));
      fr.sign(a0 + 1.7, 2.5, 1.8, 0.24, { it: 'Quadro generale', en: 'Main panel' });
      const uw = inner.find((w) => w !== pw2);
      if (uw) {
        const f2 = F(uw), [b0, b1] = usable(L, uw);
        for (let k = 0; k < 3 && b0 + (k + 1) * 0.95 < b1; k++) {
          f2.sbox(b0 + k * 0.95, b0 + k * 0.95 + 0.85, 0, 2.0, 0, 0.7, COL.dark);
          f2.box(b0 + k * 0.95 + 0.3, b0 + k * 0.95 + 0.36, 1.6, 1.66, 0.7, 0.71, [0.2, 1, 0.3], { emit: 2 });
        }
      }
      // la cassetta delle pile per le torce, accanto alla porta
      {
        const sp = nearSpans[0];
        const bf = sp ? near : fr, ba = sp ? (sp[0] + sp[1]) / 2 : Math.min(W - 0.4, a0 + 3.8), bo = 0;
        bf.box(ba - 0.25, ba + 0.25, 1.1, 1.55, bo, bo + 0.18, [0.8, 0.15, 0.1]);
        bf.box(ba - 0.2, ba + 0.2, 1.15, 1.5, bo + 0.18, bo + 0.19, [0.9, 0.9, 0.85]);
        bf.sign(ba, 1.65, 0.5, 0.1, { it: 'Pile torce', en: 'Torch batteries' }, 'ward');
        const bt = bf.obj('batteries', ba, 1.3, bo + 0.2, 0.3);
        b.h.sources.batteries.push(bt.id);
      }
      fr.lamp(Math.min(W - 0.5, a0 + 1.7), 1.2, 2.6, [1, 0.45, 0.35], 0.7, 4, 'emerg');
      L.lamps(0.85, [0.9, 0.97, 1]);
      return;
    }
    default:
      L.lamps(0.6);
  }
}

/**
 * Soggiorno dei degenti, diviso in angoli come quelli veri: il salotto con la TV, i tavoli da pranzo, l'angolo
 * della lettura, l'albero. Una sola TV; gli angoli in più compaiono solo se la sala è grande.
 */
function dayRoom(b: Builder, L: Local, drng: Rng, du: [number, number], inner: WallName[]): void {
  const r = L.r, W = L.W, D = L.D;
  const far = new WallFrame(L, 'far'), near = new WallFrame(L, 'near');
  const farExt = L.isExt('far');
  type Zone = 'tv' | 'dining' | 'reading' | 'tree' | 'piano' | 'games';
  const want: Zone[] = ['tv', 'tree'];
  const extra = drng.shuffle(['dining', 'reading', 'piano', 'games'] as Zone[]);
  const widths: Record<Zone, number> = { tv: 5.2, dining: 3.0, reading: 3.0, tree: 2.6, piano: 2.4, games: 2.8 };
  let used = widths.tv + widths.tree;
  for (const z of extra) if (used + widths[z] <= W) { want.push(z); used += widths[z]; }
  const order = drng.shuffle(want.filter((z) => z !== 'tv' && z !== 'tree'));
  // la TV non contro la facciata: il salotto va al centro, l'albero in un angolo
  const seq: Zone[] = drng.chance(0.5) ? ['tree', ...order.slice(0, 1), 'tv', ...order.slice(1)] : [...order.slice(0, 1), 'tv', ...order.slice(1), 'tree'];
  const fitted = seq.filter((z) => want.includes(z));
  const scale = W / fitted.reduce((a, z) => a + widths[z], 0);
  let cur = 0;
  const d0 = 1.7; // davanti al muro della porta si passa
  const rugCol = drng.pick(RUGS);
  for (const z of fitted) {
    const u0 = cur, u1 = cur + widths[z] * scale, cu = (u0 + u1) / 2;
    cur = u1;
    const atLeft = u0 < 0.1, atRight = u1 > W - 0.1;
    switch (z) {
      case 'tv': {
        // salotto: divano rivolto alla TV, due poltrone di lato, tavolino, tappeto
        const tvFar = !farExt;
        const tvD = tvFar ? D - 0.45 : d0 + 0.25, sofaD = tvFar ? Math.max(d0 + 0.6, D - 3.6) : Math.min(D - 0.9, d0 + 3.2);
        const sgn = tvFar ? 1 : -1; // verso della TV rispetto al divano
        const mid = (tvD + sofaD) / 2;
        rug(L, cu - 1.5, cu + 1.5, Math.min(tvD, sofaD) + 0.5, Math.max(tvD, sofaD) - 0.4, rugCol);
        L.sbox(cu - 0.8, cu + 0.8, 0, 0.5, tvD - 0.2, tvD + 0.2, COL.woodDark);
        L.box(cu - 0.6, cu + 0.6, 0.5, 1.2, tvD - sgn * 0.02 - 0.03, tvD - sgn * 0.02 + 0.03, COL.dark);
        L.box(cu - 0.56, cu + 0.56, 0.54, 1.16, tvD - sgn * 0.06 - 0.002, tvD - sgn * 0.06, [0.05, 0.06, 0.08]);
        const back = sofaD - sgn * 0.35;
        L.sbox(cu - 1.15, cu + 1.15, 0.2, 0.45, Math.min(sofaD, back), Math.max(sofaD, back) + 0.0, C.sofa);
        L.box(cu - 1.15, cu + 1.15, 0.45, 0.92, Math.min(back, back - sgn * 0.18), Math.max(back, back - sgn * 0.18), C.sofa);
        for (const s of [-1, 1]) L.box(cu + s * 1.15 - 0.12, cu + s * 1.15 + 0.12, 0.2, 0.62, Math.min(sofaD, back) - 0.05, Math.max(sofaD, back) + 0.05, C.sofa);
        for (const s of (u1 - u0 >= 4.6 ? [-1, 1] : [1])) {
          const ax = cu + s * Math.min(1.75, (u1 - u0) / 2 - 0.45);
          L.sbox(ax - 0.38, ax + 0.38, 0.2, 0.45, mid - 0.38, mid + 0.38, C.sofa2);
          L.box(ax + s * 0.3 - 0.08, ax + s * 0.3 + 0.08, 0.45, 0.95, mid - 0.38, mid + 0.38, C.sofa2);
        }
        L.sbox(cu - 0.5, cu + 0.5, 0, 0.42, mid - 0.3, mid + 0.3, COL.wood);
        L.box(cu - 0.3, cu + 0.05, 0.42, 0.46, mid - 0.15, mid + 0.12, [0.2, 0.4, 0.25]);
        break;
      }
      case 'dining': {
        // tavoli da pranzo vicino alle finestre
        const n = Math.max(1, Math.floor((D - d0 - 0.8) / 2.3));
        for (let k = 0; k < n; k++) {
          const dd = D - 1.4 - k * 2.3;
          L.sbox(cu - 0.55, cu + 0.55, 0.7, 0.74, dd - 0.4, dd + 0.4, COL.wood);
          L.cyl(cu, dd, 0, 0.7, 0.05, 0.05, C.steel, 6);
          for (const [da, db] of [[-0.3, -0.7], [0.3, -0.7], [-0.3, 0.7], [0.3, 0.7]]) {
            L.box(cu + da - 0.2, cu + da + 0.2, 0.44, 0.48, dd + db - 0.2, dd + db + 0.2, C.sofa2);
            L.box(cu + da - 0.2, cu + da + 0.2, 0.48, 0.9, dd + db + Math.sign(db) * 0.17, dd + db + Math.sign(db) * 0.21, C.sofa2);
          }
          L.box(cu - 0.4, cu + 0.4, 0.74, 0.75, dd - 0.25, dd + 0.25, COL.white);
          L.cyl(cu, dd, 0.75, 0.95, 0.04, 0.03, [0.8, 0.2, 0.15], 6);
        }
        break;
      }
      case 'reading': {
        // angolo della lettura: libreria contro il muro, due poltrone, lampada a stelo, tappeto
        const side = atLeft ? 'left' : atRight ? 'right' : null;
        if (side && inner.includes(side as WallName)) {
          const fr = new WallFrame(L, side as WallName);
          const a0 = Math.max(1.6, D / 2 - 1.2), a1 = Math.min(D - 0.3, a0 + 2.4);
          shelving(fr, a0, a1, 0.35, 5, (k, _j, a, aa) => { if (drng.chance(0.75)) fr.box(a, aa, 0.16 + k * 0.46, 0.16 + k * 0.46 + drng.range(0.18, 0.3), 0.03, 0.28, drng.pick([COL.red, COL.blue, COL.green, COL.woodDark, [0.85, 0.8, 0.6] as RGB])); }, 2.0, COL.woodDark);
        } else {
          far.sbox(cu - 0.9, cu + 0.9, 0, 1.0, 0.05, 0.4, COL.woodDark);
        }
        const dd = Math.min(D - 1.6, D / 2 + 0.4);
        rug(L, cu - 1.1, cu + 1.1, dd - 1.0, dd + 1.0, drng.pick(RUGS));
        for (const s of [-1, 1]) { L.sbox(cu + s * 0.6 - 0.36, cu + s * 0.6 + 0.36, 0.2, 0.45, dd - 0.36, dd + 0.36, [0.5, 0.3, 0.22]); L.box(cu + s * 0.6 - 0.36, cu + s * 0.6 + 0.36, 0.45, 1.05, dd + 0.28, dd + 0.36, [0.5, 0.3, 0.22]); }
        L.cyl(cu, dd + 0.2, 0, 1.55, 0.02, 0.02, C.steel, 5);
        L.cyl(cu, dd + 0.2, 1.4, 1.6, 0.08, 0.18, [0.9, 0.8, 0.6], 8, 1);
        L.lamp(cu, dd + 0.2, 1.4, [1, 0.8, 0.55], 0.35, 1.8, 'main');
        break;
      }
      case 'piano': {
        // un vecchio pianoforte verticale con lo sgabello
        const pd = farExt ? Math.max(d0 + 1, D / 2) : D - 0.4;
        L.sbox(cu - 0.75, cu + 0.75, 0, 1.25, pd - 0.32, pd + 0.32, [0.12, 0.08, 0.06]);
        L.box(cu - 0.72, cu + 0.72, 0.72, 0.76, pd - 0.52, pd - 0.3, [0.12, 0.08, 0.06]);
        L.box(cu - 0.7, cu + 0.7, 0.76, 0.78, pd - 0.5, pd - 0.36, COL.white);
        L.box(cu - 0.3, cu + 0.3, 0.45, 0.5, pd - 1.0, pd - 0.7, [0.12, 0.08, 0.06]);
        L.cyl(cu + 0.4, pd, 1.25, 1.45, 0.06, 0.04, [0.85, 0.75, 0.2], 6, 1);
        break;
      }
      case 'games': {
        // tavolino quadrato con le carte e la tombola di Natale lasciata a metà
        const dd = Math.min(D - 1.5, D / 2 + 0.6);
        L.sbox(cu - 0.45, cu + 0.45, 0.7, 0.74, dd - 0.45, dd + 0.45, COL.green);
        L.cyl(cu, dd, 0, 0.7, 0.05, 0.05, C.steel, 6);
        L.box(cu - 0.3, cu + 0.1, 0.74, 0.75, dd - 0.2, dd + 0.05, COL.white);
        for (let k = 0; k < 6; k++) L.cyl(cu - 0.2 + (k % 3) * 0.1, dd + 0.15 + Math.floor(k / 3) * 0.08, 0.74, 0.76, 0.02, 0.02, COL.red, 5);
        for (const [da, db] of [[0, -0.7], [0, 0.7], [-0.7, 0], [0.7, 0]]) L.box(cu + da - 0.2, cu + da + 0.2, 0.44, 0.48, dd + db - 0.2, dd + db + 0.2, C.sofa2);
        break;
      }
      case 'tree': {
        // l'albero coi regali (uno col nome del guardiano), e lì accanto il Babbo Natale di plastica
        const tu = atRight ? u1 - 1.1 : atLeft ? u0 + 1.1 : cu, td = Math.max(d0 + 1.0, Math.min(D - 1.2, D - 1.3));
        b.h.trees.push({ f: r.f, ...L.pt(tu, td), y: L.y, h: 2.5, zone: r.zone });
        L.solid(tu - 0.8, tu + 0.8, 0, 2.0, td - 0.8, td + 0.8);
        L.obj('tree', tu, 1.0, td, 0.85);
        for (let k = 0; k < 5; k++) { const a = k * 1.25 + 0.3; L.box(tu + Math.cos(a) * 0.95 - 0.15, tu + Math.cos(a) * 0.95 + 0.15, 0, 0.26, td + Math.sin(a) * 0.95 - 0.15, td + Math.sin(a) * 0.95 + 0.15, drng.pick([COL.red, COL.gold, COL.blue, COL.green])); }
        L.box(tu - 0.2, tu + 0.15, 0, 0.22, td - 1.15, td - 0.85, [0.85, 0.85, 0.8]);
        L.box(tu - 0.21, tu + 0.16, 0.1, 0.12, td - 1.16, td - 0.84, COL.red);
        L.obj('gift', tu - 0.02, 0.3, td - 1.0, 0.3);
        if (!b.h.santa) { const sp = L.pt(Math.max(0.6, Math.min(W - 0.6, tu + (atRight ? -1.5 : 1.5))), td); b.h.santa = { f: r.f, x: sp.x, z: sp.z, yaw: L.yawIn + Math.PI }; }
        break;
      }
    }
  }
  // piante negli angoli liberi, orologio sopra la porta, luci di Natale lungo il fondo
  plant(L, 0.4, D - 0.4); plant(L, W - 0.4, D - 0.4);
  clock(near, du[0] > 1 ? du[0] / 2 : Math.min(W - 0.5, du[1] + 1));
  for (let a = 0.3; a < W - 0.2; a += 0.35) far.box(a, a + 0.05, 2.55 - Math.abs(Math.sin(a * 2.1)) * 0.12, 2.6 - Math.abs(Math.sin(a * 2.1)) * 0.12, 0.03, 0.06, [[1, 0.2, 0.15], [0.2, 1, 0.35], [1, 0.8, 0.25], [0.35, 0.5, 1]][Math.round(a / 0.35) % 4] as RGB, { emit: 2 });
  far.lamp(W / 2, 0.6, 2.4, [1, 0.55, 0.35], 0.35, Math.max(3, W / 2), 'both');
  L.lamps(0.55, [1, 0.88, 0.7], 4.2);
}

function patientRoom(b: Builder, L: Local, drng: Rng, du: [number, number], vacant: boolean): void {
  const r = L.r, W = L.W, D = L.D;
  const left = new WallFrame(L, 'left'), near = new WallFrame(L, 'near'), far = new WallFrame(L, 'far');
  const narrow = W < 3.8;
  const leftExt = L.isExt('left'), farExt = L.isExt('far');
  // armadio accanto alla porta, lavabo e TV su un muro interno
  if (du[0] > 0.9) cabinet(near, 0.1, Math.min(du[0] - 0.2, 0.9), 0.55, 2.0, [0.82, 0.8, 0.72], 1);
  else if (!narrow && !leftExt) left.box(1.3, 2.2, 0, 2.0, 0, 0.55, [0.82, 0.8, 0.72], { solid: true });
  if (!narrow && !leftExt) sink(left, Math.min(D - 0.9, Math.max(2.8, D - 2.2)));
  else if (W - du[1] > 1.1) sink(near, Math.min(W - 0.4, du[1] + 0.6));
  if (!leftExt) tv(left, Math.min(D - 1.0, D / 2), 2.0, 0.6);
  else if (!farExt) tv(far, W / 2 - 0.6, 2.0, 0.6);
  crucifix(near, (du[0] + du[1]) / 2, 2.45);
  clock(near, Math.min(W - 0.4, du[1] + 0.7));
  near.box(Math.min(W - 0.4, du[1] + 0.3), Math.min(W - 0.1, du[1] + 0.6), 0.35, 0.45, 0, 0.03, [1, 0.8, 0.5], { emit: 2 });
  near.lamp(Math.min(W - 0.25, du[1] + 0.45), 0.3, 0.45, [1, 0.75, 0.45], 0.22, 2.2, 'both');
  L.ceilingLamp(W / 2, D / 2, 0.75);
  // uno o due letti, a seconda della profondità, con un tappetino accanto
  const beds = D >= 7.2 ? [3.3, Math.min(D - 1.6, 6.4)] : [Math.max(2.3, D - 1.7)];
  beds.forEach((d) => { bedUnit(L, d, vacant, drng); rug(L, W - 2.05, W - 0.95, d - 1.12, d - 0.58, drng.pick(RUGS)); });
  beds.forEach((d, k) => {
    const u = W - 1.15;
    const q = L.pt(u, d), pq = L.pt(u + 0.3, d), sq = L.pt(u - 0.6, d - 0.85);
    b.beds.push({ r, k, x: q.x, z: q.z, px: pq.x, py: L.y + 0.85, pz: pq.z, yaw: L.yawU, side: sq });
  });
  // la poltrona per chi assiste, vicino alla finestra
  const ca = Math.max(0.5, W - 2.9);
  chair(far, ca, 0.5, true, [0.55, 0.42, 0.3]);
  if (drng.chance(0.5)) far.cyl(W / 2 + 0.5, 0.2, 0.7, 1.0, 0.12, 0.02, COL.pine, 6);
  if (vacant) {
    far.obj('musicbox', ca, 0.55, 0.5, 0.3);
    far.box(ca - 0.2, ca + 0.2, 0.5, 0.62, 0.3, 0.7, [0.55, 0.35, 0.2]);
  }
}

/** L'interruttore di ogni stanza, accanto alla porta dalla parte interna, con la spia per trovarlo al buio. */
function placeSwitches(b: Builder): void {
  for (const r of b.h.rooms) {
    if (r.kind === 'lobby') continue;
    const L = new Local(b, r);
    const door = b.h.doors.find((d) => d.room === r.id);
    const rd = (r as Room & { _door?: [number, number] })._door;
    let d0 = door ? door.x0 - r.dw.a0 : rd ? rd[0] - r.dw.a0 + 0.3 : 0.4, d1 = door ? door.x1 - r.dw.a0 : rd ? rd[1] - r.dw.a0 - 0.3 : 0.4;
    if (r.mirror) [d0, d1] = [L.W - d1, L.W - d0];
    const u = d1 + 0.22 < L.W - 0.15 ? d1 + 0.22 : d0 - 0.22;
    const fr = new WallFrame(L, 'near');
    fr.box(u - 0.045, u + 0.045, 1.05, 1.17, 0, 0.02, [0.92, 0.92, 0.88]);
    fr.box(u - 0.025, u + 0.025, 1.08, 1.14, 0.02, 0.03, [0.85, 0.85, 0.8]);
    const led = fr.box(u - 0.008, u + 0.008, 1.155, 1.165, 0.025, 0.035, [1, 0.55, 0.15], { emit: 2 });
    led.p = PWR_ALWAYS;
    fr.obj('switch', u, 1.11, 0.07, 0.13, r.id, `switch-${r.id}`);
  }
}

// ---------------------------------------------------------------- corridoi: luci, corrimano, addobbi, ronda

function dressCorridors(b: Builder, f: FloorId, drng: Rng): void {
  const y = floorY(f), p = powerOfFloor(f), cz = corrZone(f);
  const corrs = b.h.corridors.filter((c) => c.f === f);
  const doors = b.h.doors.filter((d) => d.f === f);
  for (const c of corrs) {
    const alongX = c.x1 - c.x0 >= c.z1 - c.z0;
    const len = alongX ? c.x1 - c.x0 : c.z1 - c.z0;
    const n = Math.max(1, Math.round(len / 4.2));
    const mx = (c.x0 + c.x1) / 2, mz = (c.z0 + c.z1) / 2;
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const x = alongX ? c.x0 + t * len : mx, z = alongX ? mz : c.z0 + t * len;
      b.add(box(x - (alongX ? 0.6 : 0.3), x + (alongX ? 0.6 : 0.3), y + CEIL - 0.04, y + CEIL - 0.005, z - (alongX ? 0.3 : 0.6), z + (alongX ? 0.3 : 0.6), [1, 0.97, 0.9], cz, p, { emit: 1 }));
      b.lamp({ x, y: y + CEIL - 0.3, z, zone: cz, p, col: [1, 0.95, 0.86], i: 0.55, r: 3.4, mode: 'main' });
      // luce di cortesia segnapasso, bassa sul muro
      if (k % 2 === 0) {
        const wx = alongX ? x + 0.8 : c.x0 + 0.03, wz = alongX ? c.z0 + 0.03 : z + 0.8;
        b.add(box(wx - (alongX ? 0.12 : 0.01), wx + (alongX ? 0.12 : 0.01), y + 0.3, y + 0.38, wz - (alongX ? 0.01 : 0.12), wz + (alongX ? 0.01 : 0.12), [1, 0.75, 0.45], cz, PWR_ALWAYS, { emit: 2 }));
        b.lamp({ x: wx + (alongX ? 0 : 0.3), y: y + 0.4, z: wz + (alongX ? 0.3 : 0), zone: cz, p: PWR_ALWAYS, col: [1, 0.7, 0.42], i: 0.28, r: 2.4, mode: 'emerg' });
      }
    }
    // ghirlande sotto il soffitto, lungo i due muri lunghi
    for (const s of [0, 1]) {
      const pts: Vec3[] = [];
      for (let q = 0.5; q <= len - 0.5; q += 1.5) {
        const sag = (Math.round(q / 1.5) % 2) ? 0.28 : 0.05;
        const off = s ? -0.12 : 0.12;
        pts.push(alongX ? { x: c.x0 + q, y: y + CEIL - 0.08 - sag, z: (s ? c.z1 : c.z0) + off } : { x: (s ? c.x1 : c.x0) + off, y: y + CEIL - 0.08 - sag, z: c.z0 + q });
      }
      if (pts.length > 1) b.h.garlands.push({ f, pts });
    }
  }
  // luci verdi d'uscita e rosse d'emergenza vicino al vano scale
  b.add(box(-3.4, -3.1, y + 2.55, y + 2.72, -CZ + 0.07, -CZ + 0.1, [0.2, 1, 0.45], cz, PWR_ALWAYS, { emit: 2 }));
  b.lamp({ x: -3.25, y: y + 2.5, z: -CZ + 0.3, zone: cz, p: PWR_ALWAYS, col: [0.3, 1, 0.5], i: 0.3, r: 2.2, mode: 'both' });
  b.lamp({ x: -6, y: y + 2.8, z: -CZ + 0.4, zone: cz, p: PWR_ALWAYS, col: [1, 0.45, 0.35], i: 0.45, r: 3.0, mode: 'emerg' });
  for (const d of doors) if (drng.chance(0.5)) d.wreath = true;

  // punti liberi lungo i muri dei corridoi: lontani da porte, varchi e dal nucleo
  const spots: { x: number; z: number; nx: number; nz: number; c: Corridor }[] = [];
  const free = (x: number, z: number) => {
    if (z < -CZ + 0.3 && x < STAIRS.x1 + 0.4) return false;
    if (f === 20 && z > CZ - 0.3 && x < 3) return false;
    for (const d of doors) { const q = doorPoint(d); if (Math.hypot(q.x - x, q.z - z) < 1.25) return false; }
    // dove il muro manca (incroci tra corridoi o varchi delle sale) non c'è niente su cui appendere
    for (const o of corrs) if (x > o.x0 - 0.05 && x < o.x1 + 0.05 && z > o.z0 - 0.05 && z < o.z1 + 0.05 && !(Math.abs(x - o.x0) < 0.2 || Math.abs(x - o.x1) < 0.2 || Math.abs(z - o.z0) < 0.2 || Math.abs(z - o.z1) < 0.2)) return false;
    for (const r of b.h.rooms) if (r.f === f && r.arch && x > r.x0 - 0.5 && x < r.x1 + 0.5 && z > r.z0 - 0.5 && z < r.z1 + 0.5) return false;
    return true;
  };
  for (const c of corrs) {
    const alongX = c.x1 - c.x0 >= c.z1 - c.z0;
    const len = alongX ? c.x1 - c.x0 : c.z1 - c.z0;
    for (let q = 0.8; q < len - 0.8; q += 0.5) for (const s of [0, 1]) {
      const pt = alongX ? { x: c.x0 + q, z: s ? c.z1 - 0.02 : c.z0 + 0.02, nx: 0, nz: s ? -1 : 1 } : { x: s ? c.x1 - 0.02 : c.x0 + 0.02, z: c.z0 + q, nx: s ? -1 : 1, nz: 0 };
      // il muro c'è davvero? fuori dal corridoio ci dev'essere una stanza o una facciata, non un altro corridoio
      const ox = pt.x - pt.nx * 0.3, oz = pt.z - pt.nz * 0.3;
      if (corrs.some((o) => o !== c && ox > o.x0 && ox < o.x1 && oz > o.z0 && oz < o.z1)) continue;
      if (free(pt.x, pt.z)) spots.push({ ...pt, c });
    }
  }
  // tre punti della ronda, il più distanti possibile tra loro
  const cps: typeof spots = [];
  if (spots.length) cps.push(spots.reduce((a, s) => (s.x - s.z * 0.1 < a.x - a.z * 0.1 ? s : a)));
  while (cps.length < 3 && spots.length > cps.length) {
    let best = spots[0], bd = -1;
    for (const s of spots) { const d = Math.min(...cps.map((c) => Math.hypot(c.x - s.x, c.z - s.z))); if (d > bd) { bd = d; best = s; } }
    cps.push(best);
  }
  b.h.checkpoints[f] = [];
  const used: typeof spots = [];
  cps.forEach((c, k) => {
    const o = b.obj('checkpoint', f, c.x + c.nx * 0.1, y + 1.3, c.z + c.nz * 0.1, 0.25, cz, `${f}:${k}`, `cp-${f}-${k}`);
    b.h.checkpoints[f].push(o.id);
    b.add(cbox(c.x + c.nx * 0.03, c.z + c.nz * 0.03, y + 1.18, c.nx ? 0.05 : 0.16, c.nz ? 0.05 : 0.16, 0.24, COL.dark, cz, p));
    used.push(c);
  });
  // barelle e carrozzine lasciate lungo i muri, estintori, dispenser
  const away = (s: (typeof spots)[number], d: number) => used.every((u) => Math.hypot(u.x - s.x, u.z - s.z) > d);
  const pickSpot = (d: number) => { const cand = spots.filter((s) => away(s, d)); return cand.length ? drng.pick(cand) : null; };
  const nStretch = drng.int(0, 2);
  const wide = (sp: (typeof spots)[number]) => Math.min(sp.c.x1 - sp.c.x0, sp.c.z1 - sp.c.z0) >= 2.9;
  const farFromDoors = (sp: (typeof spots)[number]) => doors.every((d) => { const q = doorPoint(d); return Math.hypot(q.x - sp.x, q.z - sp.z) > 2.4; });
  for (let k = 0; k < nStretch; k++) {
    const cand = spots.filter((sp) => away(sp, 3.4) && farFromDoors(sp) && wide(sp));
    const s = cand.length ? drng.pick(cand) : null;
    if (!s) break;
    used.push(s);
    const ax = s.nz !== 0; // lungo x
    const cx = s.x + s.nx * 0.45, czz = s.z + s.nz * 0.45;
    const [hx, hz] = ax ? [1.0, 0.35] : [0.35, 1.0];
    b.add(box(cx - hx, cx + hx, y + 0.62, y + 0.72, czz - hz, czz + hz, [0.85, 0.87, 0.9], cz, p, { solid: true }));
    b.add(box(cx - hx + 0.05, cx + hx - 0.05, y + 0.72, y + 0.76, czz - hz + 0.03, czz + hz - 0.03, COL.sheet, cz, p));
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.add(box(cx + sx * (hx - 0.08) - 0.02, cx + sx * (hx - 0.08) + 0.02, y + 0.08, y + 0.62, czz + sz * (hz - 0.06) - 0.02, czz + sz * (hz - 0.06) + 0.02, COL.metal, cz, p));
    b.solid({ x0: cx - hx, x1: cx + hx, y0: y, y1: y + 0.8, z0: czz - hz, z1: czz + hz });
    // un lenzuolo sopra, con una forma sotto che non dovrebbe esserci
    if (drng.chance(0.35)) b.add(box(cx - hx * 0.7, cx + hx * 0.7, y + 0.76, y + 0.92, czz - hz * 0.6, czz + hz * 0.6, [0.9, 0.9, 0.88], cz, p));
  }
  for (let k = 0; k < 2; k++) {
    const s = pickSpot(1.6);
    if (!s) break;
    used.push(s);
    b.cyl({ x: s.x + s.nx * 0.12, z: s.z + s.nz * 0.12, y0: y + 0.25, y1: y + 0.85, r0: 0.09, r1: 0.09, seg: 8, c: COL.red, zone: cz, p });
    b.add(cbox(s.x + s.nx * 0.02, s.z + s.nz * 0.02, y + 1.7, s.nx ? 0.03 : 0.3, s.nz ? 0.03 : 0.3, 0.3, COL.red, cz, p));
  }
  for (const d of doors) {
    const q = doorPoint(d, -0.03), dx = d.axis === 'x' ? 1 : 0, dz = d.axis === 'z' ? 1 : 0;
    const off = (d.x1 - d.x0) / 2 + 0.25;
    b.add(cbox(q.x + dx * off, q.z + dz * off, y + 1.2, dx ? 0.1 : 0.05, dz ? 0.1 : 0.05, 0.2, COL.white, cz, p));
  }
  b.h.signs.push({ f, x: ELEV.cx, y: y + 2.5, z: -CZ + 0.09, nx: 0, nz: 1, w: 0.7, h: 0.32, text: { it: FLOOR_SHORT[f], en: FLOOR_SHORT[f] }, style: 'floor' });
  b.h.signs.push({ f, x: (STAIRS.doorX0 + STAIRS.doorX1) / 2, y: y + 2.42, z: -CZ + 0.09, nx: 0, nz: 1, w: 0.95, h: 0.2, text: { it: 'Scale', en: 'Stairs' }, style: 'room' });
  if (drng.chance(0.5)) {
    const tc = spots.filter((sp) => away(sp, 3.4) && wide(sp) && farFromDoors(sp));
    const s = tc.length ? drng.pick(tc) : null;
    if (s) {
      used.push(s);
      const tx = s.x + s.nx * 0.5, tz = s.z + s.nz * 0.5;
      b.h.trees.push({ f, x: tx, z: tz, y, h: 1.7, zone: cz });
      b.solid({ x0: tx - 0.4, x1: tx + 0.4, y0: y, y1: y + 1.5, z0: tz - 0.4, z1: tz + 0.4 });
    }
  }
}

// ---------------------------------------------------------------- pazienti

/** Lo schermo del terminale sulla scrivania (in metri, rivolto verso +z). */
export const TERM_SCREEN = { x0: -3.46, x1: -2.54, y0: 0.84, y1: 1.4, z: 5.955 } as const;

/** Pulsantiera delle chiamate sul bancone. */
export const CALL_PANEL = { x0: -5.5, step: 0.235 } as const;

/** Un paziente per stanza di degenza (da 2 a 4 in tutto); la stanza vuota ha il letto rifatto. */
function admitPatients(b: Builder, prng: Rng, n: number): void {
  const used = new Set<string>();
  void n;
  const rooms = b.h.rooms.filter((r) => r.kind === 'patient').sort((a, c) => (a.number ?? 0) - (c.number ?? 0));
  for (const r of rooms) {
    const beds = b.beds.filter((s) => s.r === r);
    const s = prng.pick(beds);
    const sex = prng.chance(0.5) ? 'm' : 'f';
    const first = prng.pick(sex === 'm' ? MALE_FIRST : FEMALE_FIRST);
    let last = prng.pick(LAST_NAMES);
    for (let i = 0; i < 6 && used.has(last); i++) last = prng.pick(LAST_NAMES);
    used.add(last);
    const age = prng.int(68, 96);
    const bio = patientStory(prng, sex, age);
    const dos = patientDossier(prng, sex, age);
    const pt: Patient = {
      id: `pt-${r.id}`, first, last, sex, age, story: bio.story, reason: bio.reason, ...dos,
      f: r.f, room: r.id, roomNumber: r.number ?? 0, bed: (s.k + 1) as 1 | 2, x: s.x, z: s.z, yaw: s.yaw, side: s.side,
    };
    b.h.patients.push(pt);
    b.obj('patient', r.f, s.px, s.py, s.pz, 0.6, r.id, pt.id, `obj-${pt.id}`);
  }
  for (const r of b.h.rooms.filter((x) => x.kind === 'vacant')) {
    const s = b.beds.find((q) => q.r === r);
    if (s) b.obj('vacantbed', r.f, s.px, s.py, s.pz, 0.6, r.id, r.id, `vacantbed-${r.id}`);
  }
  b.h.patients.forEach((pt, i) => {
    const x = CALL_PANEL.x0 + 0.12 + i * CALL_PANEL.step;
    b.obj('callbtn', 20, x, 0.84, 6.45, 0.06, 'lobby', `${pt.id}|assist`, `callbtn-${pt.id}-assist`);
    b.obj('callbtn', 20, x, 0.84, 6.68, 0.06, 'lobby', `${pt.id}|urgent`, `callbtn-${pt.id}-urgent`);
    b.h.signs.push({ f: 20, x, y: 0.93, z: 6.265, nx: 0, nz: 1, w: 0.21, h: 0.1, text: { it: String(pt.roomNumber), en: String(pt.roomNumber) }, style: 'room' });
  });
}



/** Quota delle rampe nel vano scale: candidati per un punto (x, z). */
export function stairHeights(x: number, z: number): number[] {
  const out: number[] = [];
  if (x < STAIRS.x0 || x > STAIRS.x1 || z < STAIRS.z0 || z > STAIRS.z1) return out;
  for (const f of FLOORS) if (z >= STAIRS.landZ) out.push(floorY(f));
  for (let s = FLOORS[0]; s < FLOORS[FLOORS.length - 1]; s++) {
    const y0 = floorY(s);
    if (z <= STAIRS.midZ) out.push(y0 + H / 2);
    else if (z < STAIRS.landZ) {
      const t = (STAIRS.landZ - z) / (STAIRS.landZ - STAIRS.midZ);
      if (x <= STAIRS.divX) out.push(y0 + (t * H) / 2);
      else out.push(y0 + H / 2 + ((1 - t) * H) / 2);
    }
  }
  return out;
}

function buildCore(b: Builder): void {
  const sc: RGB = [0.7, 0.7, 0.66];
  const stepC: RGB = [0.58, 0.58, 0.56];
  const top = FLOORS[FLOORS.length - 1], bottom = FLOORS[0];
  for (const f of FLOORS) {
    const y = floorY(f), p = powerOfFloor(f), cz = corrZone(f);
    wallAlongX(b, f, -CZ, STAIRS.x0, STAIRS.x1, [{ a: STAIRS.doorX0, b: STAIRS.doorX1, top: 2.15 }], 'stairs', cz, COL.wall, COL.wallLow, true);
    b.add(box(STAIRS.x0, STAIRS.x1, y - 0.3, y, STAIRS.landZ, -CZ, sc, 'stairs', PWR_MAIN, { skip: F_NY }));
    b.add(box(STAIRS.x0, STAIRS.x1, y - 0.6, y - 0.3, STAIRS.landZ, -CZ, sc, 'stairs', PWR_MAIN, { skip: F_PY }));
    b.add(box(-4.8, -4.2, y + CEIL - 0.04, y + CEIL, -2.8, -2.2, [1, 0.97, 0.9], 'stairs', PWR_MAIN, { emit: 1 }));
    b.lamp({ x: -4.5, y: y + CEIL - 0.3, z: -2.5, zone: 'stairs', p: PWR_MAIN, col: [1, 0.95, 0.86], i: 0.7, r: 3.2, mode: 'main' });
    b.lamp({ x: -4.5, y: y + 2.4, z: -3.0, zone: 'stairs', p: PWR_ALWAYS, col: [1, 0.45, 0.35], i: 0.35, r: 3, mode: 'emerg' });
    b.add(box(-3.4, -3.1, y + 2.1, y + 2.26, -2.0, -1.97, [0.2, 1, 0.45], 'stairs', PWR_ALWAYS, { emit: 2 }));
    // il numero del piano: uno solo, grande, sopra la porta del pianerottolo (lo vedi arrivando dalla rampa)
    b.h.signs.push({ f, x: (STAIRS.doorX0 + STAIRS.doorX1) / 2, y: y + 2.5, z: -CZ - 0.1, nx: 0, nz: -1, w: 0.62, h: 0.42, text: { it: FLOOR_SHORT[f], en: FLOOR_SHORT[f] }, style: 'floor' });
    // in cima ringhiera, in fondo un cancello: i piani di sotto sono chiusi di notte
    if (f === top) b.add(box(STAIRS.x0, STAIRS.divX, y, y + 1.05, STAIRS.landZ - 0.05, STAIRS.landZ + 0.02, COL.metal, 'stairs', PWR_MAIN, { solid: true }));
    if (f === bottom) {
      b.add(box(STAIRS.divX, STAIRS.x1, y, y + 2.1, STAIRS.landZ - 0.05, STAIRS.landZ + 0.02, COL.metal, 'stairs', PWR_MAIN, { solid: true }));
      for (let x = STAIRS.divX + 0.15; x < STAIRS.x1; x += 0.15) b.add(box(x - 0.015, x + 0.015, y, y + 2.1, STAIRS.landZ - 0.08, STAIRS.landZ - 0.05, COL.dark, 'stairs', PWR_MAIN));
      b.h.signs.push({ f, x: -3.75, y: y + 2.25, z: STAIRS.landZ + 0.03, nx: 0, nz: 1, w: 1.3, h: 0.2, text: { it: 'Piani inferiori chiusi', en: 'Lower floors closed' }, style: 'exit' });
      // le rampe verso il basso si vedono oltre il cancello
      b.add(box(STAIRS.divX + 0.05, STAIRS.x1, y - 1.8, y - 1.5, STAIRS.z0, STAIRS.landZ - 0.1, sc, 'stairs', PWR_MAIN));
    }
    if (f === top) b.add(box(STAIRS.x0, STAIRS.x1, y + CEIL, y + CEIL + 0.6, BZ0, -CZ, COL.ceiling, 'stairs', PWR_MAIN, { skip: F_PY }));

    // ascensore: porta di piano, cornice in acciaio e pulsante di chiamata
    wallAlongX(b, f, -CZ, ELEV.x0, ELEV.x1, [{ a: ELEV.doorX0, b: ELEV.doorX1, top: 2.1 }], 'shaft', cz, COL.wall, COL.wallLow, true);
    b.add(box(ELEV.doorX0 - 0.12, ELEV.doorX0, y, y + 2.22, -CZ - 0.02, -CZ + 0.1, COL.metal, cz, p));
    b.add(box(ELEV.doorX1, ELEV.doorX1 + 0.12, y, y + 2.22, -CZ - 0.02, -CZ + 0.1, COL.metal, cz, p));
    b.add(box(ELEV.doorX0 - 0.12, ELEV.doorX1 + 0.12, y + 2.1, y + 2.22, -CZ - 0.02, -CZ + 0.1, COL.metal, cz, p));
    b.add(box(ELEV.x1 - 0.62, ELEV.x1 - 0.38, y + 0.95, y + 1.3, -CZ + 0.08, -CZ + 0.11, COL.metal, cz, p));
    b.obj('elev_call', f, ELEV.x1 - 0.5, y + 1.12, -CZ + 0.14, 0.12, cz, String(f), `call-${f}`);
    // muri del vano corsa
    b.add(box(ELEV.x0 - WT / 2, ELEV.x0 + WT / 2, y, y + H, BZ0, -CZ, COL.wall, 'out', p, { solid: true, zones: { nx: 'out', px: 'shaft' }, tess: 1.2 }));
    b.add(box(ELEV.x1 - WT / 2, ELEV.x1 + WT / 2, y, y + H, BZ0, -CZ, COL.wall, 'stairs', PWR_MAIN, { solid: true, zones: { nx: 'shaft', px: 'stairs' }, tess: 1.2 }));
    b.add(box(ELEV.x0, ELEV.x1, y, y + H, ELEV.z0 - WT, ELEV.z0, shade(COL.concrete, 0.7), 'shaft', PWR_MAIN, { solid: true }));
    b.solid({ x0: ELEV.x0, x1: ELEV.x1, y0: y, y1: y + H, z0: BZ0, z1: ELEV.z0 });
    b.add(box(ELEV.x0, ELEV.x1, y, y + H, BZ0, ELEV.z0 - WT, shade(COL.concrete, 0.6), 'out', PWR_ALWAYS));
  }
  b.add(box(ELEV.x0, ELEV.x1, floorY(bottom) - 0.8, floorY(bottom) - 0.5, ELEV.z0, ELEV.z1, COL.dark, 'shaft', PWR_MAIN));
  b.add(box(ELEV.x0, ELEV.x1, floorY(top) + H - 0.1, floorY(top) + H + 0.2, ELEV.z0, ELEV.z1, COL.dark, 'shaft', PWR_MAIN));

  // rampe in pietra chiara: alzata più scura, striscia antiscivolo nera sul bordo di ogni gradino,
  // corrimano in legno su supporti d'acciaio, muri pieni fino al piano di sopra
  const STEPS = 12;
  const tread: RGB = [0.74, 0.72, 0.68], riser: RGB = [0.6, 0.59, 0.56], nose: RGB = [0.12, 0.12, 0.13], rail: RGB = [0.5, 0.36, 0.22];
  const P = PWR_MAIN, Z = 'stairs';
  const add = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c: RGB, extra: Partial<Box> = {}) => b.add(box(x0, x1, y0, y1, z0, z1, c, Z, P, extra));
  const run = STAIRS.landZ - STAIRS.midZ, sd = run / STEPS;
  for (let s = bottom; s < top; s++) {
    const y0 = floorY(s);
    for (let k = 0; k < STEPS; k++) {
      // rampa A: dal pianerottolo verso sud, sale di mezzo piano
      const za1 = STAIRS.landZ - k * sd, za0 = za1 - sd, ha = y0 + ((k + 1) / STEPS) * (H / 2);
      add(STAIRS.x0, STAIRS.divX - 0.05, ha - 0.04, ha, za0, za1, tread);
      add(STAIRS.x0, STAIRS.divX - 0.05, ha - 0.45, ha - 0.04, za0, za1, riser);
      add(STAIRS.x0 + 0.05, STAIRS.divX - 0.1, ha - 0.035, ha + 0.005, za1 - 0.05, za1 - 0.01, nose);
      // rampa B: dal pianerottolo intermedio torna verso nord fino al piano di sopra
      const zb0 = STAIRS.midZ + k * sd, zb1 = zb0 + sd, hb = y0 + H / 2 + ((k + 1) / STEPS) * (H / 2);
      add(STAIRS.divX + 0.05, STAIRS.x1, hb - 0.04, hb, zb0, zb1, tread);
      add(STAIRS.divX + 0.05, STAIRS.x1, hb - 0.45, hb - 0.04, zb0, zb1, riser);
      add(STAIRS.divX + 0.1, STAIRS.x1 - 0.05, hb - 0.035, hb + 0.005, zb0 + 0.01, zb0 + 0.05, nose);
      // corrimano: tanti tratti corti che seguono la pendenza, a 90 cm dal bordo dei gradini
      const rise = H / 2 / STEPS;
      for (let q = 0; q < 4; q++) {
        const ya = ha - rise + (q + 0.5) * rise / 4, za = za1 - (q + 1) * sd / 4;
        for (const xr of [STAIRS.x0 + 0.06, STAIRS.divX - 0.11]) add(xr, xr + 0.05, ya + 0.86, ya + 0.92, za - 0.005, za + sd / 4 + 0.005, rail);
        const yb2 = hb - rise + (q + 0.5) * rise / 4, zb = zb0 + q * sd / 4;
        for (const xr of [STAIRS.divX + 0.06, STAIRS.x1 - 0.17]) add(xr, xr + 0.05, yb2 + 0.86, yb2 + 0.92, zb - 0.005, zb + sd / 4 + 0.005, rail);
      }
      if (k % 3 === 1) {
        add(STAIRS.x0 + 0.02, STAIRS.x0 + 0.06, ha + 0.6, ha + 0.89, (za0 + za1) / 2 - 0.01, (za0 + za1) / 2 + 0.01, COL.metal);
        add(STAIRS.x1 - 0.12, STAIRS.x1 - 0.08, hb + 0.6, hb + 0.89, (zb0 + zb1) / 2 - 0.01, (zb0 + zb1) / 2 + 0.01, COL.metal);
      }
    }
    // pianerottolo intermedio con la finestra sulla città
    add(STAIRS.x0, STAIRS.x1, y0 + H / 2 - 0.3, y0 + H / 2, STAIRS.z0, STAIRS.midZ, tread);
    add(STAIRS.x0, STAIRS.x1, y0 + H / 2, y0 + H / 2 + 0.01, STAIRS.midZ - 0.05, STAIRS.midZ, nose);
    add(-5.0, -4.0, y0 + H / 2 + 2.6, y0 + H / 2 + 2.64, -9.6, -9.0, [1, 0.97, 0.9], { emit: 1 });
    b.lamp({ x: -4.5, y: y0 + H / 2 + 2.3, z: -9.2, zone: Z, p: P, col: [1, 0.95, 0.86], i: 0.6, r: 3, mode: 'main' });
    b.lamp({ x: -4.5, y: y0 + H / 2 + 1.6, z: -9.4, zone: Z, p: PWR_ALWAYS, col: [0.55, 0.62, 0.85], i: 0.3, r: 2.6, mode: 'both' });
    b.h.windows.push({ id: `win-stairs-${s}`, f: s as FloorId, room: 'stairs', axis: 'x', at: BZ0, a0: -5.3, a1: -3.7, y0: y0 + H / 2 + 0.75, y1: y0 + H / 2 + 2.2, out: -1, zone: Z, open: false });
    // cartello del pianerottolo: dove porta ogni rampa
    b.h.signs.push({ f: s as FloorId, x: -4.5, y: y0 + H / 2 + 0.55, z: BZ0 + 0.1, nx: 0, nz: 1, w: 1.5, h: 0.24, text: { it: `▲ ${s + 1}      ▼ ${s}`, en: `▲ ${s + 1}      ▼ ${s}` }, style: 'ward' });
    // muro divisorio
    add(STAIRS.divX - 0.05, STAIRS.divX + 0.05, y0 - 0.3, y0 + H + 1.1, STAIRS.midZ, STAIRS.landZ, [0.78, 0.76, 0.7], { solid: true });
  }
  // muri del vano, pieni da cima a fondo: a est e la facciata con le finestre dei pianerottoli
  const yb = floorY(bottom) - 0.6, yt = floorY(top) + H;
  b.add(box(STAIRS.x1 - 0.1, STAIRS.x1, yb, yt, STAIRS.z0, -CZ, COL.wall, Z, P, { zones: { nx: Z, px: 'void' }, tess: 1.2 }));
  let ycur = yb;
  for (let s = bottom; s < top; s++) {
    const y0 = floorY(s), w0 = y0 + H / 2 + 0.75, w1 = y0 + H / 2 + 2.2;
    b.add(box(STAIRS.x0, STAIRS.x1, ycur, w0, BZ0 - WT / 2, BZ0 + WT / 2, COL.wall, Z, P, { zones: { nz: 'out', pz: Z }, solid: true, tess: 1.2 }));
    b.add(box(STAIRS.x0, -5.3, w0, w1, BZ0 - WT / 2, BZ0 + WT / 2, COL.wall, Z, P, { zones: { nz: 'out', pz: Z }, solid: true }));
    b.add(box(-3.7, STAIRS.x1, w0, w1, BZ0 - WT / 2, BZ0 + WT / 2, COL.wall, Z, P, { zones: { nz: 'out', pz: Z }, solid: true }));
    ycur = w1;
  }
  b.add(box(STAIRS.x0, STAIRS.x1, ycur, yt, BZ0 - WT / 2, BZ0 + WT / 2, COL.wall, Z, P, { zones: { nz: 'out', pz: Z }, solid: true, tess: 1.2 }));
}

// ---------------------------------------------------------------- accettazione notturna
function buildReception(b: Builder, r: Room, drng: Rng): void {
  const y = 0, p = powerOfFloor(20), zn = r.zone;
  const add = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c: RGB, extra: Partial<Box> = {}) => b.add(box(x0, x1, y + y0, y + y1, z0, z1, c, zn, p, extra));
  add(r.x0, r.x1, -0.3, 0, r.z0, r.z1, COL.floorLobby, { skip: F_NY, tess: 1.2 });
  add(r.x0, r.x1, CEIL, CEIL + 0.3, r.z0, r.z1, COL.ceiling, { skip: F_PY, tess: 1.2 });
  // vetrate sulla città, muro verso il corridoio con un varco largo
  const ops = [{ a: -8.2, b: -4.6, y0: 0.6, top: 2.6 }, { a: -2.6, b: 1.8, y0: 0.6, top: 2.6 }];
  wallAlongX(b, 20, BZ1, r.x0, r.x1, ops, zn, 'out', COL.wall, COL.wallLow, false);
  ops.forEach((o, k) => {
    b.h.windows.push({ id: `win-lobby-${k}`, f: 20, room: 'lobby', axis: 'x', at: BZ1, a0: o.a, a1: o.b, y0: 0.6, y1: 2.6, out: 1, zone: zn, open: false });
    b.lamp({ x: (o.a + o.b) / 2, y: 1.9, z: BZ1 - 0.8, zone: zn, p: PWR_ALWAYS, col: [0.55, 0.62, 0.85], i: 0.35, r: 3, mode: 'both' });
  });
  wallAlongZ(b, 20, BX0, CZ, BZ1, [{ a: 3.5, b: 7.5, y0: 0.6, top: 2.6 }], 'out', zn, COL.wall, COL.wallLow, false);
  b.h.windows.push({ id: 'win-lobby-w', f: 20, room: 'lobby', axis: 'z', at: BX0, a0: 3.5, a1: 7.5, y0: 0.6, y1: 2.6, out: -1, zone: zn, open: false });
  for (let x = -7; x <= 1; x += 4) for (const z of [3.8, 7.6]) {
    add(x - 0.5, x + 0.5, CEIL - 0.04, CEIL - 0.005, z - 0.5, z + 0.5, [1, 0.96, 0.86], { emit: 1 });
    b.lamp({ x, y: CEIL - 0.3, z, zone: zn, p, col: [1, 0.9, 0.75], i: 0.6, r: 3.4, mode: 'main' });
  }
  b.lamp({ x: -3, y: 2.6, z: 5, zone: zn, p: PWR_ALWAYS, col: [1, 0.45, 0.35], i: 0.5, r: 5, mode: 'emerg' });

  // la postazione del guardiano: bancone alto verso il corridoio, piano di lavoro profondo, due ali laterali
  const wood = COL.wood;
  add(-6, 0, 0, 1.1, 5.4, 5.8, wood, { solid: true });
  add(-6.1, 0.1, 1.1, 1.16, 5.3, 5.9, COL.white);
  add(-5.6, -0.4, 0.74, 0.78, 5.8, 7.0, [0.8, 0.78, 0.72]);
  add(-5.6, -0.4, 0.3, 0.74, 5.8, 5.95, shade(wood, 0.75), { solid: true });
  for (const x of [-5.55, -0.5]) add(x, x + 0.05, 0, 0.74, 5.85, 6.95, shade(wood, 0.6));
  add(-6, -5.6, 0, 1.1, 5.4, 8.6, wood, { solid: true });
  add(-0.4, 0, 0, 1.1, 5.4, 8.6, wood, { solid: true });
  b.solid({ x0: -5.6, x1: -0.4, y0: 0.7, y1: 0.8, z0: 5.8, z1: 7.0 });
  // tre monitor: al centro il terminale della vigilanza (grande), a sinistra la videosorveglianza dal vivo
  for (const [x, w, h0, h1] of [[-4.4, 0.6, 0.82, 1.3], [-3, 1.0, 0.8, 1.42], [-1.6, 0.6, 0.82, 1.3]] as const) {
    add(x - w / 2, x + w / 2, h0, h1, 5.85, 5.95, COL.dark);
    add(x - 0.05, x + 0.05, 0.78, h0 + 0.04, 5.95, 6.1, COL.dark);
    if (x === -1.6) add(x - w / 2 + 0.03, x + w / 2 - 0.03, h0 + 0.03, h1 - 0.03, 5.95, 5.953, [0.3, 0.38, 0.42], { emit: 1 });
  }
  add(TERM_SCREEN.x0, TERM_SCREEN.x1, TERM_SCREEN.y0, TERM_SCREEN.y1, 5.95, TERM_SCREEN.z - 0.001, [0.05, 0.16, 0.12], { emit: 1 });
  b.obj('cctv', 20, -4.4, 1.06, 6.046, 0.36, 'lobby', undefined, 'cctv-console');
  add(-3.3, -2.7, 0.78, 0.8, 6.3, 6.5, COL.dark); // tastiera
  add(-2.5, -2.4, 0.78, 0.8, 6.4, 6.5, COL.dark); // mouse
  // pulsantiera delle chiamate dei pazienti, a sinistra, inclinata verso il guardiano
  add(CALL_PANEL.x0, CALL_PANEL.x0 + 0.98, 0.78, 0.82, 6.2, 6.82, [0.3, 0.32, 0.34]);
  add(CALL_PANEL.x0, CALL_PANEL.x0 + 0.98, 0.82, 1.0, 6.2, 6.26, [0.3, 0.32, 0.34]);
  b.h.signs.push({ f: 20, x: CALL_PANEL.x0 + 0.49, y: 1.07, z: 6.2, nx: 0, nz: 1, w: 0.98, h: 0.11, text: { it: 'Chiamate pazienti', en: 'Patient calls' }, style: 'ward' });
  // quadretto di stato: corrente generale e dei tre piani (le spie le disegna il renderer)
  add(-1.55, -0.55, 0.78, 1.04, 6.2, 6.26, [0.2, 0.22, 0.24]);
  b.h.signs.push({ f: 20, x: -1.05, y: 1.1, z: 6.2, nx: 0, nz: 1, w: 1.0, h: 0.11, text: { it: 'Corrente · Ascensore', en: 'Power · Lift' }, style: 'ward' });
  // telefono, registro, tazza, lampada e un piccolo albero
  add(-1.0, -0.6, 0.78, 0.81, 6.45, 6.85, [0.15, 0.25, 0.45]);
  b.obj('logbook', 20, -0.8, 0.84, 6.65, 0.22, 'lobby', undefined, 'logbook');
  add(-1.55, -1.25, 0.78, 0.86, 6.5, 6.7, COL.dark);
  b.obj('phone', 20, -1.4, 0.88, 6.6, 0.16, 'lobby', '0', 'phone-0');
  b.cyl({ x: -2.1, z: 6.7, y0: 0.78, y1: 0.88, r0: 0.04, r1: 0.04, seg: 8, c: COL.red, zone: zn, p });
  b.cyl({ x: -5.2, z: 6.95, y0: 0.78, y1: 1.2, r0: 0.02, r1: 0.02, seg: 5, c: COL.dark, zone: zn, p });
  add(-5.32, -5.08, 1.15, 1.25, 6.85, 7.0, [0.2, 0.3, 0.25]);
  b.lamp({ x: -5.1, y: 1.1, z: 6.7, zone: zn, p, col: [1, 0.85, 0.6], i: 0.5, r: 1.2, mode: 'main' });
  b.cyl({ x: -0.75, z: 6.95, y0: 0.78, y1: 1.05, r0: 0.13, r1: 0.01, seg: 6, c: COL.pine, zone: zn, p });
  b.add(cbox(-0.75, 6.95, 1.05, 0.04, 0.02, 0.04, COL.gold, zn, p, { emit: 1 }));
  // radio della filodiffusione sull'ala destra
  add(-0.38, -0.02, 1.16, 1.36, 6.9, 7.35, [0.25, 0.12, 0.1]);
  add(-0.385, -0.383, 1.2, 1.24, 6.95, 7.3, [1, 0.7, 0.3], { emit: 1 });
  b.obj('radio', 20, -0.25, 1.26, 7.1, 0.24, 'lobby', undefined, 'radio');
  // la sedia: ci si siede per seguire la notte dal terminale
  add(-3.3, -2.7, 0.45, 0.5, 7.1, 7.7, COL.dark);
  add(-3.3, -2.7, 0.5, 1.15, 7.7, 7.78, COL.dark);
  b.cyl({ x: -3, z: 7.4, y0: 0, y1: 0.45, r0: 0.04, r1: 0.04, seg: 6, c: COL.metal, zone: zn, p });
  b.obj('chair', 20, -3, 0.6, 7.4, 0.4, 'lobby', undefined, 'chair');
  b.h.signs.push({ f: 20, x: -3, y: 0.8, z: 5.38, nx: 0, nz: -1, w: 1.6, h: 0.22, text: { it: 'Accettazione', en: 'Reception' }, style: 'room' });
  // armadio delle chiavi alle spalle, poltroncine, albero, piante
  add(-5, -1, 0, 2.1, 9.5, 9.9, shade(wood, 0.7), { solid: true });
  for (let k = 0; k < 7; k++) add(-4.8 + k * 0.52, -4.5 + k * 0.52, 0.83, 1.15, 9.25, 9.48, drng.pick([COL.blue, COL.red, COL.green, [0.8, 0.75, 0.6] as RGB]));
  for (let k = 0; k < 4; k++) {
    const x = 0.4 + k * 0.62, z = 2.4;
    add(x - 0.26, x + 0.26, 0.42, 0.48, z - 0.24, z + 0.24, COL.blue);
    add(x - 0.26, x + 0.26, 0.48, 0.92, z + 0.2, z + 0.26, COL.blue);
  }
  b.solid({ x0: 0.1, x1: 2.6, y0: 0, y1: 0.9, z0: 2.1, z1: 2.7 });
  b.h.trees.push({ f: 20, x: -7.6, z: 8.4, y: 0, h: 2.9, zone: zn });
  b.solid({ x0: -8.7, x1: -6.5, y0: 0, y1: 3, z0: 7.3, z1: 9.5 });
  b.obj('tree', 20, -7.6, 1.3, 8.4, 0.9, 'lobby', undefined, 'tree');
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + 0.4;
    b.add(cbox(-7.6 + Math.cos(a) * 0.95, 8.4 + Math.sin(a) * 0.95, 0, 0.3, 0.3, 0.25, drng.pick([COL.red, COL.gold, COL.blue, COL.green]), zn, p));
  }
  b.cyl({ x: 2.4, z: 9.3, y0: 0, y1: 0.5, r0: 0.25, r1: 0.3, seg: 8, c: COL.woodDark, zone: zn, p });
  b.cyl({ x: 2.4, z: 9.3, y0: 0.5, y1: 1.6, r0: 0.45, r1: 0.1, seg: 7, c: COL.green, zone: zn, p });
  add(1.6, 2.4, 0, 1.85, 4.5, 5.2, [0.6, 0.12, 0.12], { solid: true });
  add(1.58, 1.6, 0.7, 1.7, 4.6, 5.1, [0.9, 0.85, 0.7], { emit: 1 });
  b.obj('vending', 20, 1.45, 1.2, 4.85, 0.45, 'lobby', undefined, 'vending');
  const pts: Vec3[] = [];
  for (let x = -6; x <= 0; x += 0.5) pts.push({ x, y: 1.28 + 0.06 * Math.sin((x + 6) * 1.8), z: 5.38 });
  b.h.garlands.push({ f: 20, pts });
}

// ---------------------------------------------------------------- la torre e la città

/** I venti piani sotto il reparto: facciate con le finestre, qualcuna accesa. */
function buildTower(b: Builder, rng: Rng): void {
  const P = PWR_ALWAYS, zn = 'out';
  const add = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c: RGB, extra: Partial<Box> = {}) => b.add(box(x0, x1, y0, y1, z0, z1, c, zn, P, extra));
  add(BX0 - 0.2, BX1 + 0.2, GROUND, -0.32, BZ0 - 0.2, BZ1 + 0.2, [0.32, 0.33, 0.36], { tess: 12 });
  const top = floorY(FLOORS[FLOORS.length - 1]) + H;
  add(BX0 - 0.3, BX1 + 0.3, top, top + 0.3, BZ0 - 0.3, BZ1 + 0.3, [0.4, 0.4, 0.42]);
  add(BX0 - 0.3, BX1 + 0.3, top + 0.3, top + 0.42, BZ0 - 0.3, BZ1 + 0.3, COL.snow);
  // finestre dei piani di sotto: quasi tutte buie, di notte
  for (let fl = 0; fl < BASE_FLOOR; fl++) {
    const y = GROUND + fl * H + 1.0;
    for (const side of [1, -1] as const) for (let x = BX0 + 1; x < BX1 - 0.5; x += 2.4) {
      const lit = rng.chance(fl < 2 ? 0.6 : 0.12);
      const zz = side * (BZ1 + 0.21);
      add(x - 0.7, x + 0.7, y, y + 1.4, zz - 0.01, zz + 0.01, lit ? [0.95, 0.88, 0.7] : [0.08, 0.09, 0.12], lit ? { emit: 2 } : {});
    }
    for (const sx of [1, -1] as const) for (let z = BZ0 + 1; z < BZ1 - 0.5; z += 2.4) {
      const lit = rng.chance(fl < 2 ? 0.6 : 0.12);
      const xx = sx * (BX1 + 0.21);
      add(xx - 0.01, xx + 0.01, y, y + 1.4, z - 0.7, z + 0.7, lit ? [0.95, 0.88, 0.7] : [0.08, 0.09, 0.12], lit ? { emit: 2 } : {});
    }
  }
  // la croce rossa dell'ospedale sul tetto
  add(-0.25, 0.25, top + 0.4, top + 2.4, BZ1 - 0.4, BZ1 - 0.2, [1, 0.15, 0.12], { emit: 2 });
  add(-1.0, 1.0, top + 1.15, top + 1.65, BZ1 - 0.4, BZ1 - 0.2, [1, 0.15, 0.12], { emit: 2 });
}

/** La città vista dall'alto: isolati, strade illuminate, luci di Natale, la piazza con l'albero, il campanile. */
function buildCity(b: Builder, rng: Rng): void {
  const zn = 'out', P = PWR_ALWAYS, G = GROUND;
  const add = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c: RGB, extra: Partial<Box> = {}) => b.add(box(x0, x1, G + y0, G + y1, z0, z1, c, zn, P, { tess: 9, ...extra }));
  const facades: RGB[] = [[0.42, 0.36, 0.3], [0.5, 0.42, 0.33], [0.36, 0.33, 0.32], [0.55, 0.47, 0.38], [0.4, 0.38, 0.42], [0.58, 0.4, 0.3]];
  const warm: RGB[] = [[1, 0.78, 0.45], [1, 0.85, 0.6], [1, 0.7, 0.4], [0.95, 0.9, 0.75]];
  const xmas: RGB[] = [[1, 0.2, 0.15], [0.2, 1, 0.35], [1, 0.8, 0.25], [0.35, 0.5, 1]];
  // neve per terra
  add(-400, 400, -0.5, -0.02, -400, 400, COL.snow, { skip: F_NY, tess: 40 });
  const GRID = 34, R = 7;
  // la piazza e la chiesa occupano un isolato scelto dal seed
  const plaza = { gx: rng.pick([-2, 2, 3]), gz: rng.pick([2, -2, 3]) };
  const wheel = { gx: plaza.gx > 0 ? plaza.gx - 4 : plaza.gx + 4, gz: plaza.gz };
  for (let gx = -R; gx <= R; gx++) for (let gz = -R; gz <= R; gz++) {
    if (Math.abs(gx) <= 0 && Math.abs(gz) <= 0) continue;
    const cx = gx * GRID, cz = gz * GRID;
    const dist = Math.hypot(cx, cz);
    // strade con i lampioni sul lato sud e ovest dell'isolato
    add(cx - GRID / 2, cx + GRID / 2, -0.01, 0.0, cz - GRID / 2, cz - GRID / 2 + 7, [0.28, 0.28, 0.31], { tess: 40 });
    add(cx - GRID / 2, cx - GRID / 2 + 7, -0.01, 0.0, cz - GRID / 2, cz + GRID / 2, [0.28, 0.28, 0.31], { tess: 40 });
    if (dist < 160) {
      for (const [lx, lz] of [[cx - GRID / 2 + 3.5, cz], [cx, cz - GRID / 2 + 3.5]] as const) {
        add(lx - 0.25, lx + 0.25, 5, 5.3, lz - 0.25, lz + 0.25, [1, 0.8, 0.5], { emit: 2, tess: 99 });
        b.lamp({ x: lx, y: G + 4.5, z: lz, zone: zn, p: P, col: [1, 0.72, 0.42], i: 2.2, r: 6, mode: 'both' });
      }
      // lucine appese di traverso sulla strada
      if (rng.chance(0.85)) for (let k = 0; k < 12; k++) {
        const t = k / 11, x = cx - GRID / 2 + 3.5, z = cz - GRID / 2 + 6 + t * (GRID - 12);
        add(x - 0.12 + Math.sin(t * Math.PI) * 0.0, x + 0.12, 6.2 - Math.sin(t * 7) * 0.3, 6.45 - Math.sin(t * 7) * 0.3, z - 0.12, z + 0.12, xmas[k % 4], { emit: 2, tess: 99 });
      }
    }
    if (gx === wheel.gx && gz === wheel.gz) {
      // la ruota panoramica del mercatino, tutta accesa: la si vede da ogni finestra
      add(cx - 15, cx + 15, -0.01, 0.02, cz - 15, cz + 15, [0.5, 0.5, 0.55]);
      const len = Math.hypot(cx, cz) || 1, nx = -cx / len, nz = -cz / len, tx = -nz, tz = nx;
      const R = 13, hy = R + 3;
      const cols: RGB[] = [[1, 0.25, 0.2], [1, 0.85, 0.3], [0.35, 0.6, 1], [0.3, 1, 0.45], [1, 0.4, 0.85]];
      for (let k = 0; k < 64; k++) {
        const a = (k / 64) * Math.PI * 2, px = cx + tx * Math.cos(a) * R, pz = cz + tz * Math.cos(a) * R, py = hy + Math.sin(a) * R;
        add(px - 0.3, px + 0.3, py - 0.3, py + 0.3, pz - 0.3, pz + 0.3, cols[k % cols.length], { emit: 2, tess: 99 });
      }
      for (let sp = 0; sp < 8; sp++) for (let k = 1; k < 10; k++) {
        const a = (sp / 8) * Math.PI * 2, rr = (k / 10) * R, px = cx + tx * Math.cos(a) * rr, pz = cz + tz * Math.cos(a) * rr, py = hy + Math.sin(a) * rr;
        add(px - 0.16, px + 0.16, py - 0.16, py + 0.16, pz - 0.16, pz + 0.16, k % 2 ? [1, 0.9, 0.7] : [0.9, 0.85, 0.8], { emit: 2, tess: 99 });
      }
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2, px = cx + tx * Math.cos(a) * R, pz = cz + tz * Math.cos(a) * R, py = hy + Math.sin(a) * R - 1.6;
        add(px - 0.7, px + 0.7, py - 0.6, py + 0.6, pz - 0.7, pz + 0.7, cols[(k + 2) % cols.length], { tess: 99 });
        add(px - 0.5, px + 0.5, py - 0.2, py + 0.3, pz - 0.72, pz + 0.72, [1, 0.85, 0.55], { emit: 2, tess: 99 });
      }
      for (const s of [-1, 1]) for (let k = 0; k < 8; k++) {
        const t = k / 8, px = cx + tx * s * (5 - t * 5), pz = cz + tz * s * (5 - t * 5), py = t * hy;
        add(px - 0.35, px + 0.35, py, py + hy / 8 + 0.1, pz - 0.35, pz + 0.35, [0.55, 0.55, 0.6]);
      }
      add(cx - 1, cx + 1, hy - 1, hy + 1, cz - 1, cz + 1, [1, 0.95, 0.8], { emit: 2, tess: 99 });
      b.lamp({ x: cx, y: G + 4, z: cz, zone: zn, p: P, col: [1, 0.6, 0.5], i: 2.2, r: 14, mode: 'both' });
      continue;
    }
    if (gx === plaza.gx && gz === plaza.gz) {
      // il mercatino di Natale attorno all'albero: casette di legno con il fronte acceso
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2 + 0.2, sx = cx + Math.cos(a) * 8.5, sz = cz + Math.sin(a) * 8.5;
        add(sx - 1.3, sx + 1.3, 0, 2.2, sz - 1.0, sz + 1.0, [0.45, 0.3, 0.18]);
        add(sx - 1.5, sx + 1.5, 2.2, 2.6, sz - 1.2, sz + 1.2, COL.snow);
        add(sx - 1.1, sx + 1.1, 0.9, 1.9, sz - 1.02, sz + 1.02, rng.pick(warm), { emit: 2, tess: 99 });
      }
      for (let k = 0; k < 40; k++) {
        const a = (k / 40) * Math.PI * 2, rr = 10.5, px = cx + Math.cos(a) * rr, pz = cz + Math.sin(a) * rr;
        add(px - 0.12, px + 0.12, 3.8 + Math.sin(k * 0.9) * 0.3, 4.05 + Math.sin(k * 0.9) * 0.3, pz - 0.12, pz + 0.12, xmas[k % 4], { emit: 2, tess: 99 });
      }
      add(cx - 12, cx + 12, -0.01, 0.02, cz - 12, cz + 12, [0.62, 0.62, 0.66]);
      b.h.trees.push({ f: 20, x: cx, z: cz, y: G, h: 12, zone: zn });
      b.lamp({ x: cx, y: G + 6, z: cz - 3, zone: zn, p: P, col: [1, 0.75, 0.45], i: 1.6, r: 10, mode: 'both' });
      add(cx + 4, cx + 12, 0, 12, cz + 4, cz + 13, [0.62, 0.55, 0.45]);
      add(cx + 3.7, cx + 12.3, 12, 12.5, cz + 3.7, cz + 13.3, COL.snow);
      add(cx - 12, cx - 7, 0, 30, cz + 7, cz + 12, [0.6, 0.53, 0.43]);
      add(cx - 11.4, cx - 7.6, 23, 25.4, cz + 6.98, cz + 7.0, [0.95, 0.92, 0.8], { emit: 2 });
      b.cyl({ x: cx - 9.5, z: cz + 9.5, y0: G + 30, y1: G + 38, r0: 3.2, r1: 0.05, seg: 4, c: [0.35, 0.3, 0.28], zone: zn, p: P });
      b.lamp({ x: cx - 9.5, y: G + 20, z: cz + 3, zone: zn, p: P, col: [1, 0.8, 0.55], i: 2, r: 10, mode: 'both' });
      continue;
    }
    // due o tre palazzi per isolato, più bassi della torre
    const n = rng.int(2, 3);
    for (let i = 0; i < n; i++) {
      const w = 7 + rng.next() * 6, d = 7 + rng.next() * 6;
      const bx = cx - GRID / 2 + 9 + (i % 2) * 12 + rng.next() * 2, bz = cz - GRID / 2 + 9 + Math.floor(i / 2) * 12 + rng.next() * 2;
      const floors = rng.int(3, dist < 80 ? 9 : 14);
      const hh = floors * 3.1 + 0.6;
      add(bx - w / 2, bx + w / 2, 0, hh, bz - d / 2, bz + d / 2, rng.pick(facades));
      add(bx - w / 2 - 0.25, bx + w / 2 + 0.25, hh, hh + 0.4, bz - d / 2 - 0.25, bz + d / 2 + 0.25, COL.snow);
      // finestre accese sui due lati rivolti verso la torre
      const sx = bx > 0 ? -1 : 1, sz = bz > 0 ? -1 : 1;
      for (let fl = 0; fl < floors; fl++) {
        const yy = 1.4 + fl * 3.1;
        for (let c = 0; c < 3; c++) {
          const tw = -w / 2 + ((c + 0.5) * w) / 3, td = -d / 2 + ((c + 0.5) * d) / 3;
          if (rng.chance(0.38)) { const z = bz + sz * (d / 2 + 0.02); add(bx + tw - 0.6, bx + tw + 0.6, yy, yy + 1.4, z - 0.01, z + 0.01, rng.pick(warm), { emit: 2, tess: 99 }); }
          if (rng.chance(0.38)) { const x = bx + sx * (w / 2 + 0.02); add(x - 0.01, x + 0.01, yy, yy + 1.4, bz + td - 0.6, bz + td + 0.6, rng.pick(warm), { emit: 2, tess: 99 }); }
        }
      }
      // luci di Natale sul bordo del tetto
      if (rng.chance(0.6)) for (let k = 0; k < Math.floor(w / 0.8); k++) {
        const x = bx - w / 2 + (k + 0.5) * 0.8, z = bz + sz * (d / 2 + 0.06);
        add(x - 0.08, x + 0.08, hh - 0.1, hh + 0.05, z - 0.08, z + 0.08, xmas[k % 4], { emit: 2, tess: 99 });
      }
    }
  }
  // colline lontane con i paesi accesi
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const Rr = 330 + rng.next() * 60;
    const x = Math.cos(a) * Rr, z = Math.sin(a) * Rr;
    const hh = 40 + rng.next() * 80;
    b.cyl({ x, z, y0: G - 2, y1: G + hh, r0: 100 + rng.next() * 40, r1: 8, seg: 7, c: [0.16, 0.18, 0.24], zone: zn, p: P });
    for (let j = 0; j < 10; j++) {
      const t = rng.next() * 0.4, aa = a + (rng.next() - 0.5) * 0.35, rr = Rr - 50 - rng.next() * 30;
      const lx = Math.cos(aa) * rr, lz = Math.sin(aa) * rr, ly = G + hh * t;
      b.add(box(lx - 0.7, lx + 0.7, ly, ly + 0.8, lz - 0.7, lz + 0.7, rng.pick(warm), zn, P, { emit: 2, tess: 99 }));
    }
  }
}

// ---------------------------------------------------------------- telecamere

// ---------------------------------------------------------------- telecamere

function placeCams(b: Builder): void {
  const L = (it: string, en: string): L10n => ({ it, en });
  const list: Omit<Cam, 'id' | 'n'>[] = [
    { label: L('Accettazione', 'Reception'), f: 20, x: 2.6, y: 2.85, z: 9.5, tx: -3, ty: 0.7, tz: 6, fov: 1.05, box: { x: 2.85, y: 1.4, z: 9.2 } },
  ];
  for (const f of FLOORS) {
    const y = floorY(f);
    b.h.corridors.filter((c) => c.f === f).forEach((c, i) => {
      const alongX = c.x1 - c.x0 >= c.z1 - c.z0;
      // la telecamera sta sulla testata che dà sulla facciata (c'è sempre un muro lì)
      let cx: number, czz: number, tx: number, tz: number, bx: number, bz: number;
      if (alongX) {
        const atEast = c.x1 >= BX1 - 0.01 && !(c.x0 <= BX0 + 0.01 && i === 0);
        cx = atEast ? c.x1 - 0.5 : c.x0 + 0.5; tx = atEast ? c.x0 : c.x1;
        czz = (c.z0 + c.z1) / 2 + 0.4; tz = (c.z0 + c.z1) / 2;
        bx = atEast ? c.x1 - 0.12 : c.x0 + 0.12; bz = c.z1 - 0.25;
      } else {
        const atNorth = c.z1 >= BZ1 - 0.01;
        czz = atNorth ? c.z1 - 0.5 : c.z0 + 0.5; tz = atNorth ? c.z0 : c.z1;
        cx = (c.x0 + c.x1) / 2 + 0.3; tx = (c.x0 + c.x1) / 2;
        bz = atNorth ? c.z1 - 0.12 : c.z0 + 0.12; bx = c.x1 - 0.25;
      }
      const lab = i === 0 ? L(`${FLOOR_NAME[f].it}, corridoio`, `${FLOOR_NAME[f].en}, corridor`) : L(`${FLOOR_NAME[f].it}, corridoio ${alongX ? 'est' : 'nord'}`, `${FLOOR_NAME[f].en}, ${alongX ? 'east' : 'north'} corridor`);
      list.push({ label: lab, f, x: cx, y: y + 2.7, z: czz, tx, ty: y + 0.9, tz, fov: 0.95, box: { x: bx, y: y + 1.4, z: bz } });
    });
  }
  list.push({ label: L('Vano scale', 'Stairwell'), f: 21, x: -3.3, y: floorY(21) + 2.85, z: -1.8, tx: -5.4, ty: floorY(21) - 0.5, tz: -8.5, fov: 1.25, box: { x: -3.2, y: floorY(21) + 1.4, z: -2.6 } });
  list.push({ label: L('Ascensore', 'Lift'), f: 20, x: ELEV.x1 - 0.3, y: 2.45, z: -4.35, tx: ELEV.cx - 0.6, ty: 0.9, tz: -1.6, fov: 1.35, inCab: true, box: null });
  // una telecamera in alcuni dei luoghi del reparto, nell'angolo sopra la porta
  for (const r of b.h.rooms) {
    if (!['chapel', 'storage', 'electrical', 'waiting', 'linen', 'vacant'].includes(r.kind)) continue;
    const Lc = new Local(b, r);
    const p0 = Lc.pt(Lc.W - 0.35, 0.35), p1 = Lc.pt(Lc.W * 0.25, Lc.D * 0.85);
    const y = floorY(r.f);
    list.push({ label: L(`${FLOOR_NAME[r.f].it}, ${r.name.it.toLowerCase()}`, `${FLOOR_NAME[r.f].en}, ${r.name.en.toLowerCase()}`), f: r.f, x: p0.x, y: y + 2.8, z: p0.z, tx: p1.x, ty: y + 0.6, tz: p1.z, fov: 1.2, box: null });
  }
  list.push({ label: L('Esterno, tetto', 'Outside, roof'), f: 22, x: BX1 + 0.6, y: floorY(22) + H + 1.2, z: BZ1 + 0.6, tx: 60, ty: GROUND + 10, tz: 70, fov: 1.0, box: null });
  list.forEach((c, k) => {
    const cam: Cam = { ...c, id: `cam-${k + 1}`, n: k + 1 };
    b.h.cams.push(cam);
    if (cam.box) b.obj('cambox', cam.f, cam.box.x, cam.box.y, cam.box.z, 0.22, `${cam.f}:corr`, cam.id, `cambox-${cam.id}`);
  });
}

// ---------------------------------------------------------------- interrogazioni

export function roomAt(h: Hospital, f: number, x: number, z: number): Room | null {
  for (const r of h.rooms) if (r.f === f && x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return r;
  return null;
}

export function roomById(h: Hospital, id: string): Room | undefined {
  return h.rooms.find((r) => r.id === id);
}

/** Il punto sta in un corridoio del piano? */
export function inCorridor(h: Hospital, f: number, x: number, z: number, pad = 0): boolean {
  return h.corridors.some((c) => c.f === f && x >= c.x0 - pad && x <= c.x1 + pad && z >= c.z0 - pad && z <= c.z1 + pad);
}
