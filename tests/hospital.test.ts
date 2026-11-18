import { describe, expect, it } from 'vitest';
import { Shift } from '../src/game/shift';
import { ELEV, FLOORS, SPAWN, floorY, generateHospital, stairHeights } from '../src/world/hospital';
import { PLAYER_R, SolidIndex } from '../src/world/physics';
import type { Aabb } from '../src/world/geom';

/** Celle libere di un piano raggiungibili a piedi da un punto (porte non chiuse a chiave considerate aperte). */
function reachable(seed: number, f: number, sx: number, sz: number) {
  const s = new Shift(seed);
  for (const d of s.h.doors) if (!d.locked) d.open = true;
  for (const d of s.h.doors) s.doorOpen.set(d.id, d.open ? 1 : 0);
  const idx = new SolidIndex(s.h.solids.concat(s.dynamicSolids().filter((b) => !(b.x0 >= ELEV.doorX0 - 0.1 && b.x1 <= ELEV.doorX1 + 0.1))));
  const y = floorY(f);
  const step = 0.25, x0 = -10, z0 = -10.5, nx = Math.ceil(20 / step), nz = Math.ceil(21 / step);
  const free = (x: number, z: number) => {
    const near = new Set<Aabb>();
    idx.query(x - PLAYER_R, x + PLAYER_R, z - PLAYER_R, z + PLAYER_R, near);
    for (const b of near) {
      if (b.y1 <= y + 0.46 || b.y0 >= y + 1.8) continue;
      const cx = Math.max(b.x0, Math.min(x, b.x1)), cz = Math.max(b.z0, Math.min(z, b.z1));
      if ((x - cx) ** 2 + (z - cz) ** 2 < PLAYER_R * PLAYER_R) return false;
    }
    return true;
  };
  const seen = new Uint8Array(nx * nz);
  const q: number[] = [];
  const push = (i: number, j: number) => { if (i < 0 || j < 0 || i >= nx || j >= nz) return; const k = j * nx + i; if (seen[k]) return; if (!free(x0 + i * step, z0 + j * step)) { seen[k] = 2; return; } seen[k] = 1; q.push(k); };
  push(Math.round((sx - x0) / step), Math.round((sz - z0) / step));
  while (q.length) { const k = q.pop()!; const i = k % nx, j = Math.floor(k / nx); push(i + 1, j); push(i - 1, j); push(i, j + 1); push(i, j - 1); }
  return { shift: s, ok: (x: number, z: number, r = 1.6) => {
    for (let i = Math.floor((x - r - x0) / step); i <= Math.ceil((x + r - x0) / step); i++) for (let j = Math.floor((z - r - z0) / step); j <= Math.ceil((z + r - z0) / step); j++) {
      if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
      if (seen[j * nx + i] === 1 && Math.hypot(x0 + i * step - x, z0 + j * step - z) <= r) return true;
    }
    return false;
  } };
}

describe('ospedale', () => {
  it('è deterministico per seed', () => {
    const a = generateHospital(1234), b = generateHospital(1234);
    expect(a.boxes.length).toBe(b.boxes.length);
    expect(a.patients.map((p) => p.first + p.last + p.age)).toEqual(b.patients.map((p) => p.first + p.last + p.age));
  });

  it('ha da 1 a 4 pazienti, ognuno con storia e due pulsanti in reception', () => {
    const counts = new Set<number>();
    for (let seed = 0; seed < 60; seed++) {
      const h = generateHospital(seed);
      expect(h.patients.length).toBeGreaterThanOrEqual(1);
      expect(h.patients.length).toBeLessThanOrEqual(4);
      counts.add(h.patients.length);
      for (const p of h.patients) {
        expect(p.age).toBeGreaterThanOrEqual(68);
        expect(p.story.it.length).toBeGreaterThan(20);
        expect(h.objs.filter((o) => o.kind === 'callbtn' && o.data?.startsWith(p.id + '|')).length).toBe(2);
      }
    }
    expect(counts.size).toBe(3);
    expect(Math.min(...counts)).toBe(2);
  });

  it('le rampe collegano i piani senza salti', () => {
    for (let z = -1.6; z > -9.9; z -= 0.05) {
      const hs = stairHeights(-5.2, z);
      expect(hs.length).toBeGreaterThan(0);
    }
    expect(Math.max(...stairHeights(-5.2, -9))).toBeCloseTo(floorY(21) + 1.8, 5);
  });

  for (const seed of [0, 7, 42, 999]) it(`ogni oggetto utile è raggiungibile (seed ${seed})`, () => {
    for (const f of FLOORS) {
      const r = reachable(seed, f, -5.2, -2.5);
      const h = r.shift.h;
      const needed = h.objs.filter((o) => o.f === f && ['patient', 'water', 'linen', 'kettle', 'breaker', 'checkpoint', 'cambox', 'elev_call', 'logbook', 'cctv', 'callbtn', 'radio', 'phone'].includes(o.kind));
      for (const o of needed) expect(r.ok(o.x, o.z), `${o.kind} ${o.id} piano ${f}`).toBe(true);
      for (const w of h.windows.filter((x) => x.f === f && x.room !== `${f}:corr`)) {
        const room = h.rooms.find((x) => x.id === w.room)!;
        if (!room || room.locked || !['patient', 'chapel', 'waiting'].includes(room.kind) || !r.shift.obj(`obj-${w.id}`)) continue;
        const p = r.shift.winPos(w);
        expect(r.ok(p.x, p.z), `finestra ${w.id}`).toBe(true);
      }
      if (f === 20) expect(r.ok(SPAWN.x, SPAWN.z, 0.4)).toBe(true);
    }
  });
});

describe('ascensore', () => {
  it('porta il guardiano dal 20° al 22° piano', () => {
    const s = new Shift(5);
    const inp = (fw: number, yaw: number) => ({ forward: fw, strafe: 0, run: false, yaw, pitch: 0 });
    s.player.x = ELEV.cx; s.player.z = 0;
    s.elevator.call(20);
    for (let i = 0; i < 30; i++) s.update(0.1, inp(0, Math.PI));
    for (let i = 0; i < 20; i++) s.update(0.1, inp(1, Math.PI));
    expect(s.inCab()).toBe(true);
    s.elevator.call(22);
    for (let i = 0; i < 200 && s.elevator.atFloor() !== 22; i++) s.update(0.1, inp(0, 0));
    for (let i = 0; i < 20; i++) s.update(0.1, inp(0, 0));
    expect(s.player.y).toBeCloseTo(7.2, 3);
    for (let i = 0; i < 25; i++) s.update(0.1, inp(1, 0));
    expect(s.player.z).toBeGreaterThan(-1);
    expect(s.player.f).toBe(22);
  });

  it('senza corrente si ferma e le batterie lo riportano al piano', () => {
    const s = new Shift(5);
    s.elevator.call(22);
    const inp = { forward: 0, strafe: 0, run: false, yaw: 0, pitch: 0 };
    for (let i = 0; i < 40; i++) s.update(0.1, inp);
    s.power.main = false;
    for (let i = 0; i < 400; i++) s.update(0.1, inp);
    expect(s.elevator.atFloor()).not.toBeNull();
  });
});

describe('turno', () => {
  it('stesso seed, stessi incarichi', () => {
    const run = () => {
      const s = new Shift(77);
      const inp = { forward: 0, strafe: 0, run: false, yaw: 0, pitch: 0 };
      for (let i = 0; i < 6000; i++) s.update(0.5, inp);
      return s.tasks.map((t) => `${t.kind}@${t.issued.toFixed(2)}`);
    };
    expect(run()).toEqual(run());
  });

  it('un turno si può completare interagendo con gli oggetti giusti', () => {
    for (const seed of [3, 42, 2025]) {
      const s = new Shift(seed);
      const idle = { forward: 0, strafe: 0, run: false, yaw: 0, pitch: 0 };
      const act = (id: string) => {
        const o = s.obj(id) ?? s.dynamicObjs().find((x) => x.id === id);
        if (!o) return;
        const a = s.actionFor(o);
        if (a) s.interact({ obj: o, action: a.action, params: a.params ?? {}, dist: 1 });
      };
      for (let step = 0; step < 4000 && !s.ended; step++) {
        s.update(0.5, idle);
        for (const t of s.activeTasks()) {
          switch (t.kind) {
            case 'midnight': for (const p of s.h.patients) act(`obj-${p.id}`); break;
            case 'patrol': for (const id of s.h.checkpoints[t.floor!]) act(id); break;
            case 'power': act('breaker-main'); for (const f of FLOORS) if (!s.power.fl[f]) act(`breaker-${f}`); break;
            case 'window': act(`obj-${t.target}`); break;
            case 'camera': act(`cambox-${t.target}`); break;
            case 'urgent': act(`obj-${t.patient}`); break;
            case 'assist': {
              if (!t.known) act(`callbtn-${t.patient}-assist`);
              const src = t.item === 'water' ? s.h.sources.water[0] : t.item === 'blanket' ? s.h.sources.linen[0] : s.h.sources.kettle[0];
              act(src); act(`obj-${t.patient}`); break;
            }
            case 'relay': case 'fall': act(`obj-${t.patient}`); break;
            case 'phantom': { const r = s.h.rooms.find((x) => x.id === t.target)!; s.player.x = (r.x0 + r.x1) / 2; s.player.z = (r.z0 + r.z1) / 2; s.player.y = floorY(r.f); s.player.f = r.f; break; }
            case 'handover': act('logbook'); break;
          }
        }
        if (s.phone.ringing) act('phone-0');
        for (const p of s.h.patients) if (s.ghostCalls.has(p.id)) act(`callbtn-${p.id}-assist`);
      }
      expect(s.ended).toBe(true);
      expect(s.endReason).toBe('handover');
      expect(s.tasks.filter((t) => t.done === null).map((t) => `${seed}:${t.kind}:${t.target ?? t.patient ?? ''}`)).toEqual([]);
    }
  });
});

describe('pianta ed eventi', () => {
  it('la pianta cambia col seed e la mappa contiene solo le stanze utili', () => {
    const sig = (seed: number) => generateHospital(seed).rooms.map((r) => `${r.f}${r.kind}${r.x0}${r.side}`).join('|');
    expect(sig(1)).not.toBe(sig(2));
    const h = generateHospital(9);
    for (const k of ['linen', 'staff', 'electrical']) expect(h.rooms.some((r) => r.kind === k)).toBe(true);
    expect(h.patients.every((p) => p.f !== 20)).toBe(true);
  });

  it('nessun infermiere: solo il guardiano e i pazienti', () => {
    const h = generateHospital(4);
    expect(h.staff.length).toBe(0);
    expect(h.objs.some((o) => o.kind === 'nurse')).toBe(false);
  });

  it('gli eventi insoliti accadono durante la notte', () => {
    const s = new Shift(31);
    const inp = { forward: 0, strafe: 0, run: false, yaw: 0, pitch: 0 };
    for (let i = 0; i < 4000; i++) s.update(0.5, inp);
    expect(s.events.done.length).toBeGreaterThan(3);
    expect(s.chronicle.some((c) => c.strange)).toBe(true);
  });
});
