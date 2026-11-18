// I pazienti si alzano da soli per andare in bagno: lenti, incerti, appoggiandosi ai muri.
// Ogni tanto cadono. Allora premono il pulsante rosso, se ci arrivano, e qualcuno deve correre.
import type { Vec3 } from '../core/contracts';
import { Rng, clamp, streamFor } from '../core/rng';
import { doorPoint, floorY, type Door, type Hospital, type Patient, type Room } from '../world/hospital';

export type PState = 'bed' | 'walk_to' | 'bath' | 'walk_back' | 'fallen';

export interface PMove {
  state: PState;
  x: number; z: number; yaw: number;
  /** Percorso fino al bagno (il ritorno lo fa al contrario). */
  path: { x: number; z: number }[];
  /** Distanza percorsa lungo il percorso. */
  s: number;
  len: number;
  wait: number;
  /** Punto (in metri lungo il percorso) in cui cadrà, se cadrà. */
  fallAt: number | null;
  trips: number[];
  doors: Door[];
  sway: number;
}

export const PATIENT_SPEED = 0.33;

export interface MoverHost {
  busy(pid: string): boolean;
  openDoor(d: Door): void;
  fell(p: Patient, pos: Vec3): void;
  sound(kind: string, pos?: Vec3, gain?: number): void;
  log(p: Patient, it: string, en: string): void;
}

export class PatientMover {
  readonly m = new Map<string, PMove>();
  private readonly rng: Rng;

  constructor(private readonly h: Hospital, seed: number, skip: Set<string>) {
    this.rng = streamFor(seed, 'patients').fork('walks');
    for (const p of h.patients) {
      const room = h.rooms.find((r) => r.id === p.room) as Room;
      const bath = h.rooms.find((r) => r.f === p.f && r.kind === 'bath');
      const path = bath ? this.route(p, room, bath) : [];
      const len = path.slice(1).reduce((a, q, i) => a + Math.hypot(q.x - path[i].x, q.z - path[i].z), 0);
      const trips: number[] = [];
      if (bath && !skip.has(p.id)) {
        const n = this.rng.int(1, 2);
        for (let i = 0; i < n; i++) trips.push(this.rng.range(40 + i * 180, 220 + i * 200));
      }
      const doors = h.doors.filter((d) => d.room === p.room || (bath && d.room === bath.id));
      this.m.set(p.id, { state: 'bed', x: p.x, z: p.z, yaw: p.yaw, path, s: 0, len, wait: 0, fallAt: null, trips: trips.sort((a, b) => a - b), doors, sway: this.rng.next() * 6 });
    }
  }

  /** Dal letto alla porta, lungo i corridoi (qualunque forma abbiano), fino al lavandino dei servizi. */
  private route(p: Patient, room: Room, bath: Room): { x: number; z: number }[] {
    const dr = this.h.doors.find((d) => d.room === room.id)!, db = this.h.doors.find((d) => d.room === bath.id)!;
    const a = doorPoint(dr, -0.7), c = doorPoint(db, -0.7);
    return [
      { x: p.x, z: p.z }, p.side, doorPoint(dr, 0.8), doorPoint(dr, -0.1), a,
      ...corridorPath(this.h, p.f, a, c),
      c, doorPoint(db, 0.1), doorPoint(db, 0.9), doorPoint(db, 1.7),
    ];
  }

  private at(mv: PMove, dist: number): { x: number; z: number; yaw: number } {
    let d = clamp(dist, 0, mv.len);
    for (let i = 1; i < mv.path.length; i++) {
      const a = mv.path[i - 1], b = mv.path[i];
      const l = Math.hypot(b.x - a.x, b.z - a.z);
      if (d <= l || i === mv.path.length - 1) {
        const t = l > 0 ? clamp(d / l, 0, 1) : 1;
        return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, yaw: Math.atan2(b.x - a.x, b.z - a.z) };
      }
      d -= l;
    }
    const last = mv.path[mv.path.length - 1];
    return { x: last.x, z: last.z, yaw: 0 };
  }

  update(dt: number, minute: number, host: MoverHost): void {
    for (const p of this.h.patients) {
      const mv = this.m.get(p.id)!;
      switch (mv.state) {
        case 'bed': {
          if (!mv.trips.length || mv.trips[0] > minute) break;
          if (host.busy(p.id)) { mv.trips[0] = minute + 12; break; }
          mv.trips.shift();
          mv.state = 'walk_to'; mv.s = 0;
          // le gambe non reggono come una volta: una volta su tre si cade
          mv.fallAt = this.rng.chance(0.38) ? this.rng.range(0.35, 1.85) * mv.len : null;
          host.log(p, `${p.first} ${p.last} si alza per andare in bagno.`, `${p.first} ${p.last} gets up to go to the toilet.`);
          break;
        }
        case 'walk_to': case 'walk_back': {
          mv.sway += dt;
          // passo incerto: rallenta, si ferma un attimo, riparte
          const hesit = Math.sin(mv.sway * 1.7) > 0.85 ? 0.25 : 1;
          const step = PATIENT_SPEED * hesit * dt;
          mv.s += step;
          const total = mv.state === 'walk_to' ? mv.s : mv.len + mv.s;
          const pos = mv.state === 'walk_to' ? this.at(mv, mv.s) : this.at(mv, mv.len - mv.s);
          mv.x = pos.x + Math.sin(mv.sway * 2.3) * 0.05; mv.z = pos.z;
          mv.yaw = mv.state === 'walk_to' ? pos.yaw : pos.yaw + Math.PI;
          for (const d of mv.doors) { const q = doorPoint(d); if (Math.hypot(q.x - mv.x, q.z - mv.z) < 1.2 && !d.open) host.openDoor(d); }
          if (Math.floor(mv.sway / 0.9) !== Math.floor((mv.sway - dt) / 0.9)) host.sound('mimic_step', { x: mv.x, y: floorY(p.f) + 0.1, z: mv.z }, 0.35);
          if (mv.fallAt !== null && total >= mv.fallAt) {
            mv.state = 'fallen'; mv.fallAt = null;
            const fp = { x: mv.x, y: floorY(p.f), z: mv.z };
            host.sound('branch_fall', fp, 0.9);
            host.fell(p, fp);
            break;
          }
          if (mv.s >= mv.len) {
            if (mv.state === 'walk_to') { mv.state = 'bath'; mv.wait = this.rng.range(25, 55); }
            else { mv.state = 'bed'; mv.x = p.x; mv.z = p.z; mv.yaw = p.yaw; }
            mv.s = 0;
          }
          break;
        }
        case 'bath': {
          mv.wait -= dt;
          if (mv.wait <= 0) { mv.state = 'walk_back'; mv.s = 0; }
          break;
        }
        case 'fallen': break;
      }
    }
  }

  /** Il guardiano lo rimette a letto. */
  toBed(pid: string): void {
    const p = this.h.patients.find((x) => x.id === pid);
    const mv = this.m.get(pid);
    if (!p || !mv) return;
    mv.state = 'bed'; mv.x = p.x; mv.z = p.z; mv.yaw = p.yaw; mv.s = 0; mv.fallAt = null;
  }

  state(pid: string): PState { return this.m.get(pid)?.state ?? 'bed'; }
}

/** Percorso a griglia dentro i corridoi di un piano, ridotto ai punti in cui cambia direzione. */
export function corridorPath(h: Hospital, f: number, a: { x: number; z: number }, b: { x: number; z: number }): { x: number; z: number }[] {
  const cs = h.corridors.filter((c) => c.f === f);
  const S = 0.5, X0 = -9, Z0 = -10, NX = 36, NZ = 40;
  const inside = (x: number, z: number) => cs.some((c) => x > c.x0 + 0.35 && x < c.x1 - 0.35 && z > c.z0 + 0.35 && z < c.z1 - 0.35);
  const cell = (q: { x: number; z: number }) => {
    let best = -1, bd = 1e9;
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
      const x = X0 + (i + 0.5) * S, z = Z0 + (j + 0.5) * S;
      if (!inside(x, z)) continue;
      const d = Math.hypot(x - q.x, z - q.z);
      if (d < bd) { bd = d; best = j * NX + i; }
    }
    return best;
  };
  const s0 = cell(a), s1 = cell(b);
  if (s0 < 0 || s1 < 0) return [];
  const prev = new Int32Array(NX * NZ).fill(-2);
  prev[s0] = -1;
  const q = [s0];
  for (let k = 0; k < q.length && prev[s1] === -2; k++) {
    const c = q[k], i = c % NX, j = Math.floor(c / NX);
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= NX || nj >= NZ) continue;
      const n = nj * NX + ni;
      if (prev[n] !== -2 || !inside(X0 + (ni + 0.5) * S, Z0 + (nj + 0.5) * S)) continue;
      prev[n] = c; q.push(n);
    }
  }
  if (prev[s1] === -2) return [];
  const cells: number[] = [];
  for (let c = s1; c >= 0; c = prev[c]) cells.push(c);
  cells.reverse();
  const pts = cells.map((c) => ({ x: X0 + ((c % NX) + 0.5) * S, z: Z0 + (Math.floor(c / NX) + 0.5) * S }));
  // solo gli angoli
  const out: { x: number; z: number }[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1];
    if (!p0 || !p2 || Math.sign(p1.x - p0.x) !== Math.sign(p2.x - p1.x) || Math.sign(p1.z - p0.z) !== Math.sign(p2.z - p1.z)) out.push(p1);
  }
  return out;
}
