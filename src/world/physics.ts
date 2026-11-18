// Collisioni e quota del pavimento. Il guardiano è un cilindro di raggio PLAYER_R e altezza 1,8 m.
import type { Aabb } from './geom';
import { BASE_FLOOR, ELEV, FLOORS, H, STAIRS, stairHeights } from './hospital';

export const PLAYER_R = 0.28;
export const PLAYER_H = 1.8;
export const STEP_UP = 0.45;

/** Griglia uniforme sulle scatole solide per interrogazioni veloci. */
export class SolidIndex {
  private readonly cell = 2;
  private readonly map = new Map<number, Aabb[]>();
  constructor(solids: Aabb[]) { for (const s of solids) this.insert(s); }
  private key(ix: number, iz: number): number { return (ix + 2000) * 4096 + (iz + 2000); }
  insert(s: Aabb): void {
    const c = this.cell;
    for (let ix = Math.floor(s.x0 / c); ix <= Math.floor(s.x1 / c); ix++) for (let iz = Math.floor(s.z0 / c); iz <= Math.floor(s.z1 / c); iz++) {
      const k = this.key(ix, iz);
      let l = this.map.get(k);
      if (!l) { l = []; this.map.set(k, l); }
      l.push(s);
    }
  }
  query(x0: number, x1: number, z0: number, z1: number, out: Set<Aabb>): void {
    const c = this.cell;
    for (let ix = Math.floor(x0 / c); ix <= Math.floor(x1 / c); ix++) for (let iz = Math.floor(z0 / c); iz <= Math.floor(z1 / c); iz++) {
      const l = this.map.get(this.key(ix, iz));
      if (l) for (const s of l) out.add(s);
    }
  }
}

export const inStairwell = (x: number, z: number) => x > STAIRS.x0 && x < STAIRS.x1 && z > STAIRS.z0 && z < STAIRS.z1;
export const inShaft = (x: number, z: number) => x > ELEV.x0 && x < ELEV.x1 && z > ELEV.z0 && z < ELEV.z1;

/** Piano logico per una quota. */
export function floorOf(y: number): number {
  const f = Math.round(y / H) + BASE_FLOOR;
  return Math.max(FLOORS[0], Math.min(FLOORS[FLOORS.length - 1], f));
}

/** Quota del pavimento sotto (x, z) per chi si trova a quota y. */
export function groundAt(x: number, z: number, y: number, cabY: number): number {
  if (inShaft(x, z)) return cabY;
  if (inStairwell(x, z)) {
    const c = stairHeights(x, z);
    let best = -Infinity, low = Infinity;
    for (const h of c) { if (h <= y + STEP_UP && h > best) best = h; if (h < low) low = h; }
    return best > -Infinity ? best : low;
  }
  return (floorOf(y + 0.5) - BASE_FLOOR) * H;
}

/** Sposta un cerchio di raggio r da (x, z) di (dx, dz), facendolo scivolare lungo le scatole. */
export function slide(
  index: SolidIndex, extra: Aabb[], x: number, z: number, y: number, dx: number, dz: number, r = PLAYER_R,
): { x: number; z: number } {
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.12));
  const near = new Set<Aabb>();
  let px = x, pz = z;
  for (let s = 0; s < steps; s++) {
    px += dx / steps; pz += dz / steps;
    near.clear();
    index.query(px - r - 0.1, px + r + 0.1, pz - r - 0.1, pz + r + 0.1, near);
    for (const e of extra) near.add(e);
    for (let it = 0; it < 3; it++) {
      let moved = false;
      for (const b of near) {
        // conta solo ciò che sta tra le ginocchia e la testa
        if (b.y1 <= y + STEP_UP - 0.01 || b.y0 >= y + PLAYER_H) continue;
        const cx = Math.max(b.x0, Math.min(px, b.x1)), cz = Math.max(b.z0, Math.min(pz, b.z1));
        const ddx = px - cx, ddz = pz - cz;
        const d2 = ddx * ddx + ddz * ddz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-10) {
          const d = Math.sqrt(d2), push = r - d;
          px += (ddx / d) * push; pz += (ddz / d) * push;
        } else {
          // centro dentro la scatola: esce dal lato più vicino
          const o = [px - b.x0 + r, b.x1 - px + r, pz - b.z0 + r, b.z1 - pz + r];
          const m = Math.min(...o);
          if (m === o[0]) px = b.x0 - r; else if (m === o[1]) px = b.x1 + r; else if (m === o[2]) pz = b.z0 - r; else pz = b.z1 + r;
        }
        moved = true;
      }
      if (!moved) break;
    }
  }
  return { x: px, z: pz };
}

/** Intersezione raggio–scatola: distanza d'ingresso o Infinity. */
export function rayAabb(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, b: Aabb): number {
  let t0 = 0, t1 = Infinity;
  const o = [ox, oy, oz], d = [dx, dy, dz], lo = [b.x0, b.y0, b.z0], hi = [b.x1, b.y1, b.z1];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) { if (o[i] < lo[i] || o[i] > hi[i]) return Infinity; continue; }
    let a = (lo[i] - o[i]) / d[i], c = (hi[i] - o[i]) / d[i];
    if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, c);
    if (t0 > t1) return Infinity;
  }
  return t0;
}

/** Intersezione raggio–sfera: distanza o Infinity. */
export function raySphere(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, cx: number, cy: number, cz: number, r: number): number {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const t = lx * dx + ly * dy + lz * dz;
  if (t < 0) return Infinity;
  const d2 = lx * lx + ly * ly + lz * lz - t * t;
  if (d2 > r * r) return Infinity;
  return t - Math.sqrt(r * r - d2);
}
