// Trasforma scatole e cilindri in array di vertici con la luce precalcolata per zona.
// Due set di luce per vertice: con corrente (bakeOn) e senza (bakeOff, solo luci d'emergenza e finestre).
// Modulo puro: nessuna dipendenza da Babylon, testabile.
import type { Box, Cyl, Lamp, RGB } from '../world/geom';

export interface MeshArrays {
  pos: number[]; nrm: number[]; col: number[]; on: number[]; off: number[]; pidx: number[]; idx: number[];
}
export const emptyArrays = (): MeshArrays => ({ pos: [], nrm: [], col: [], on: [], off: [], pidx: [], idx: [] });

const OUT_AMB_ON: RGB = [0.17, 0.19, 0.27];

export class Baker {
  private readonly byZone = new Map<string, Lamp[]>();
  private readonly amb = new Map<string, { on: RGB; off: RGB }>();
  constructor(lamps: Lamp[]) {
    for (const l of lamps) {
      let a = this.byZone.get(l.zone);
      if (!a) { a = []; this.byZone.set(l.zone, a); }
      a.push(l);
    }
    for (const [z, list] of this.byZone) {
      let sOn = 0, sOff = 0;
      const cOn: RGB = [0, 0, 0], cOff: RGB = [0, 0, 0];
      for (const l of list) {
        if (l.mode !== 'emerg') { sOn += l.i; for (let k = 0; k < 3; k++) cOn[k] += l.col[k] * l.i; }
        if (l.mode !== 'main') { sOff += l.i; for (let k = 0; k < 3; k++) cOff[k] += l.col[k] * l.i; }
      }
      const norm = (c: RGB, s: number, k: number, base: number): RGB => s > 0 ? [base + (c[0] / s) * k, base + (c[1] / s) * k, base + (c[2] / s) * k] : [base, base, base];
      this.amb.set(z, { on: norm(cOn, sOn, 0.05 + 0.1 * Math.min(1, sOn / 2.5), 0.02), off: norm(cOff, sOff, 0.03 + 0.07 * Math.min(1, sOff / 1.5), 0.012) });
    }
  }

  /** Luce (con e senza corrente) in un punto con una normale, per una zona. */
  light(zone: string, x: number, y: number, z: number, nx: number, ny: number, nz: number, out: { on: RGB; off: RGB }): void {
    const a = zone === 'out' ? { on: OUT_AMB_ON, off: OUT_AMB_ON } : this.amb.get(zone) ?? { on: [0.025, 0.025, 0.03] as RGB, off: [0.012, 0.012, 0.015] as RGB };
    out.on[0] = a.on[0]; out.on[1] = a.on[1]; out.on[2] = a.on[2];
    out.off[0] = a.off[0]; out.off[1] = a.off[1]; out.off[2] = a.off[2];
    const list = this.byZone.get(zone);
    if (!list) return;
    for (const l of list) {
      const dx = l.x - x, dy = l.y - y, dz = l.z - z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-4;
      if (d > l.r * 4) continue;
      const lam = Math.max(0, (dx * nx + dy * ny + dz * nz) / d);
      const diff = lam * 0.85 + 0.15 * Math.max(0, (dx * nx + dy * ny + dz * nz) / d + 0.6) / 1.6;
      const att = l.i / (1 + (d / l.r) * (d / l.r)) * Math.max(0, 1 - d / (l.r * 4));
      const v = diff * att;
      if (l.mode !== 'emerg') { out.on[0] += l.col[0] * v; out.on[1] += l.col[1] * v; out.on[2] += l.col[2] * v; }
      if (l.mode !== 'main') { out.off[0] += l.col[0] * v; out.off[1] += l.col[1] * v; out.off[2] += l.col[2] * v; }
    }
  }
}

const tmp = { on: [0, 0, 0] as RGB, off: [0, 0, 0] as RGB };

/** Codifica del tipo di superficie nel canale alfa del colore. */
const alphaOf = (emit?: 0 | 1 | 2): number => (emit === 1 ? 0 : emit === 2 ? 0.5 : 1);

/** Aggiunge un quadrilatero suddiviso (p0 origine, u e v lati) con la sua normale. */
function quad(
  m: MeshArrays, baker: Baker | null, zone: string, p: number, c: RGB, a: number,
  o: [number, number, number], u: [number, number, number], v: [number, number, number], n: [number, number, number],
  nu: number, nv: number, fixed?: { on: RGB; off: RGB },
): void {
  const base = m.pos.length / 3;
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const s = i / nu, t = j / nv;
    const x = o[0] + u[0] * s + v[0] * t, y = o[1] + u[1] * s + v[1] * t, z = o[2] + u[2] * s + v[2] * t;
    m.pos.push(x, y, z); m.nrm.push(n[0], n[1], n[2]); m.col.push(c[0], c[1], c[2], a); m.pidx.push(p);
    if (fixed) { m.on.push(...fixed.on); m.off.push(...fixed.off); }
    else if (a < 1 || !baker) { m.on.push(1, 1, 1); m.off.push(a === 0.5 ? 1 : 0.06, a === 0.5 ? 1 : 0.06, a === 0.5 ? 1 : 0.06); }
    else { baker.light(zone, x + n[0] * 0.02, y + n[1] * 0.02, z + n[2] * 0.02, n[0], n[1], n[2], tmp); m.on.push(...tmp.on); m.off.push(...tmp.off); }
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const k = base + j * (nu + 1) + i;
    m.idx.push(k, k + 1, k + nu + 2, k, k + nu + 2, k + nu + 1);
  }
}

export function addBox(m: MeshArrays, b: Box, baker: Baker | null, fixed?: { on: RGB; off: RGB }): void {
  const a = alphaOf(b.emit);
  const step = b.tess ?? (a < 1 ? 99 : 1.6);
  const div = (len: number) => Math.max(1, Math.min(40, Math.ceil(len / step)));
  const W = b.x1 - b.x0, Hh = b.y1 - b.y0, D = b.z1 - b.z0;
  const skip = b.skip ?? 0;
  const z = (k: keyof NonNullable<Box['zones']>) => b.zones?.[k] ?? b.zone;
  // -x
  if (!(skip & 1)) quad(m, baker, z('nx'), b.p, b.c, a, [b.x0, b.y0, b.z0], [0, 0, D], [0, Hh, 0], [-1, 0, 0], div(D), div(Hh), fixed);
  if (!(skip & 2)) quad(m, baker, z('px'), b.p, b.c, a, [b.x1, b.y0, b.z1], [0, 0, -D], [0, Hh, 0], [1, 0, 0], div(D), div(Hh), fixed);
  if (!(skip & 4)) quad(m, baker, z('ny'), b.p, b.c, a, [b.x0, b.y0, b.z1], [W, 0, 0], [0, 0, -D], [0, -1, 0], div(W), div(D), fixed);
  if (!(skip & 8)) quad(m, baker, z('py'), b.p, b.c, a, [b.x0, b.y1, b.z0], [W, 0, 0], [0, 0, D], [0, 1, 0], div(W), div(D), fixed);
  if (!(skip & 16)) quad(m, baker, z('nz'), b.p, b.c, a, [b.x1, b.y0, b.z0], [-W, 0, 0], [0, Hh, 0], [0, 0, -1], div(W), div(Hh), fixed);
  if (!(skip & 32)) quad(m, baker, z('pz'), b.p, b.c, a, [b.x0, b.y0, b.z1], [W, 0, 0], [0, Hh, 0], [0, 0, 1], div(W), div(Hh), fixed);
}

export function addCyl(m: MeshArrays, c: Cyl, baker: Baker | null, fixed?: { on: RGB; off: RGB }): void {
  const a = alphaOf(c.emit);
  const n = c.seg;
  const slope = (c.r0 - c.r1) / Math.max(1e-3, c.y1 - c.y0);
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2, am = (a0 + a1) / 2;
    const p0: [number, number, number] = [c.x + Math.cos(a0) * c.r0, c.y0, c.z + Math.sin(a0) * c.r0];
    const p1: [number, number, number] = [c.x + Math.cos(a1) * c.r0, c.y0, c.z + Math.sin(a1) * c.r0];
    const q0: [number, number, number] = [c.x + Math.cos(a0) * c.r1, c.y1, c.z + Math.sin(a0) * c.r1];
    const q1: [number, number, number] = [c.x + Math.cos(a1) * c.r1, c.y1, c.z + Math.sin(a1) * c.r1];
    const len = Math.hypot(1, slope);
    const nrm: [number, number, number] = [Math.cos(am) / len, slope / len, Math.sin(am) / len];
    // lato come due triangoli (quadrilatero non planare per i coni: va bene in low-poly)
    const base = m.pos.length / 3;
    for (const p of [p0, p1, q1, q0]) {
      m.pos.push(...p); m.nrm.push(...nrm); m.col.push(c.c[0], c.c[1], c.c[2], a); m.pidx.push(c.p);
      if (fixed) { m.on.push(...fixed.on); m.off.push(...fixed.off); }
      else if (a < 1 || !baker) { m.on.push(1, 1, 1); m.off.push(a === 0.5 ? 1 : 0.06, a === 0.5 ? 1 : 0.06, a === 0.5 ? 1 : 0.06); }
      else { baker.light(c.zone, p[0] + nrm[0] * 0.02, p[1], p[2] + nrm[2] * 0.02, nrm[0], nrm[1], nrm[2], tmp); m.on.push(...tmp.on); m.off.push(...tmp.off); }
    }
    m.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  // tappo superiore
  if (c.r1 > 0.01) {
    const base = m.pos.length / 3;
    const pts: [number, number, number][] = [[c.x, c.y1, c.z]];
    for (let i = 0; i <= n; i++) { const t = (i / n) * Math.PI * 2; pts.push([c.x + Math.cos(t) * c.r1, c.y1, c.z + Math.sin(t) * c.r1]); }
    for (const p of pts) {
      m.pos.push(...p); m.nrm.push(0, 1, 0); m.col.push(c.c[0], c.c[1], c.c[2], a); m.pidx.push(c.p);
      if (fixed) { m.on.push(...fixed.on); m.off.push(...fixed.off); }
      else if (a < 1 || !baker) { m.on.push(1, 1, 1); m.off.push(0.06, 0.06, 0.06); }
      else { baker.light(c.zone, p[0], p[1] + 0.02, p[2], 0, 1, 0, tmp); m.on.push(...tmp.on); m.off.push(...tmp.off); }
    }
    for (let i = 1; i <= n; i++) m.idx.push(base, base + i, base + i + 1);
  }
}

/** Luce costante per un oggetto mobile: campionata al suo centro, verso l'alto e di lato. */
export function bakeAt(baker: Baker, zone: string, x: number, y: number, z: number): { on: RGB; off: RGB } {
  const acc = { on: [0, 0, 0] as RGB, off: [0, 0, 0] as RGB };
  const dirs: [number, number, number][] = [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
  for (const d of dirs) {
    baker.light(zone, x, y, z, d[0], d[1], d[2], tmp);
    for (let k = 0; k < 3; k++) { acc.on[k] += tmp.on[k] / dirs.length; acc.off[k] += tmp.off[k] / dirs.length; }
  }
  return acc;
}
