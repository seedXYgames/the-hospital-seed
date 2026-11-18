import { describe, expect, it } from 'vitest';
import { Shift } from '../src/game/shift';
import { corridorPath } from '../src/game/patients';
import { ELEV, FLOORS, doorPoint, floorY, generateHospital, inCorridor } from '../src/world/hospital';
import { PLAYER_R, SolidIndex } from '../src/world/physics';
import type { Aabb } from '../src/world/geom';

function reach(s: Shift, f: number) {
  for (const d of s.h.doors) { d.open = true; s.doorOpen.set(d.id, 1); }
  const idx = new SolidIndex(s.h.solids.concat(s.dynamicSolids().filter((b) => !(b.x0 >= ELEV.doorX0 - 0.1 && b.x1 <= ELEV.doorX1 + 0.1))));
  const y = floorY(f), step = 0.25, x0 = -10, z0 = -10.5, nx = 80, nz = 84;
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
  const seen = new Uint8Array(nx * nz), q: number[] = [];
  const push = (i: number, j: number) => { if (i < 0 || j < 0 || i >= nx || j >= nz) return; const k = j * nx + i; if (seen[k]) return; if (!free(x0 + i * step, z0 + j * step)) { seen[k] = 2; return; } seen[k] = 1; q.push(k); };
  push(Math.round((-5.2 - x0) / step), Math.round((-2.5 - z0) / step));
  while (q.length) { const k = q.pop()!; const i = k % nx, j = Math.floor(k / nx); push(i + 1, j); push(i - 1, j); push(i, j + 1); push(i, j - 1); }
  return (x: number, z: number, r = 1.6) => {
    for (let i = Math.floor((x - r - x0) / step); i <= Math.ceil((x + r - x0) / step); i++) for (let j = Math.floor((z - r - z0) / step); j <= Math.ceil((z + r - z0) / step); j++) {
      if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
      if (seen[j * nx + i] === 1 && Math.hypot(x0 + i * step - x, z0 + j * step - z) <= r) return true;
    }
    return false;
  };
}

describe('topologia dei piani', () => {
  it('cambia davvero: tutte le forme compaiono e i due piani di degenza sono diversi', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      const h = generateHospital(seed);
      for (const f of FLOORS) seen.add(h.topology[f]);
      expect(h.topology[21]).not.toBe(h.topology[22]);
      expect(h.patients.length).toBeGreaterThanOrEqual(2);
      expect(h.patients.length).toBeLessThanOrEqual(4);
    }
    expect([...seen].sort()).toEqual(['atrium', 'ell', 'gallery', 'hall', 'spine', 'tee']);
  });

  it('ogni seed genera un ospedale valido (200 seed)', () => {
    for (let seed = 100; seed < 300; seed++) {
      const h = generateHospital(seed * 7919);
      expect(new Set([h.topology[20], h.topology[21], h.topology[22]]).size).toBe(3);
      for (const r of h.rooms) expect(Math.min(r.x1 - r.x0, r.z1 - r.z0), `${seed} ${r.kind}`).toBeGreaterThan(2.2);
      expect(h.objs.some((o) => o.kind === 'breaker' && o.data === 'main')).toBe(true);
      expect(h.sources.batteries.length).toBeGreaterThan(0);
      expect(h.objs.filter((o) => o.kind === 'switch').length).toBe(h.rooms.length - 1);
    }
  });

  for (const seed of [1, 3, 5, 11, 23, 58, 77, 101, 314, 2026]) it(`tutto ciò che serve è raggiungibile (seed ${seed})`, () => {
    const s = new Shift(seed);
    for (const f of FLOORS) {
      const ok = reach(s, f);
      const need = s.h.objs.filter((o) => o.f === f && ['patient', 'water', 'linen', 'kettle', 'breaker', 'checkpoint', 'cambox', 'batteries', 'elev_call', 'logbook', 'phone', 'window'].includes(o.kind) && (o.kind !== 'window' || ['patient', 'vacant', 'chapel', 'waiting'].includes(s.h.rooms.find((r) => r.id === o.room)?.kind ?? '')));
      for (const o of need) expect(ok(o.x, o.z), `${o.kind} ${o.id} piano ${f}`).toBe(true);
      for (const d of s.h.doors.filter((x) => x.f === f)) { const q = doorPoint(d, -0.6); expect(inCorridor(s.h, f, q.x, q.z, 0.05), `porta ${d.id}`).toBe(true); }
    }
  });

  it('i numeri dei piani sono nel vano scale', () => {
    const h = generateHospital(9);
    for (const f of FLOORS) expect(h.signs.some((x) => x.f === f && x.style === 'floor' && x.x > -6.2 && x.x < -2.8 && x.z < -1.5)).toBe(true);
  });
});

describe('pazienti che vanno in bagno', () => {
  it('il percorso nei corridoi collega la stanza ai servizi', () => {
    for (const seed of [2, 7, 42, 99]) {
      const s = new Shift(seed);
      for (const mv of s.mover.m.values()) {
        if (!mv.path.length) continue;
        expect(mv.len).toBeGreaterThan(3);
        for (const q of mv.path.slice(5, -4)) expect(inCorridor(s.h, s.h.patients[0].f, q.x, q.z, 0.5) || s.h.corridors.some((c) => q.x >= c.x0 - 0.5 && q.x <= c.x1 + 0.5 && q.z >= c.z0 - 0.5 && q.z <= c.z1 + 0.5)).toBe(true);
      }
    }
    expect(corridorPath(generateHospital(1), 21, { x: -8, z: 0 }, { x: -4, z: 0 }).length).toBeGreaterThan(0);
  });

  it('chi cade chiama col pulsante rosso e si rialza con un aiuto', () => {
    let fell = false;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      const s = new Shift(seed);
      const inp = { forward: 0, strafe: 0, run: false, yaw: 0, pitch: 0 };
      for (let i = 0; i < 9000 && !s.activeTasks().some((t) => t.kind === 'fall'); i++) s.update(0.25, inp);
      const t = s.activeTasks().find((x) => x.kind === 'fall');
      if (!t) continue;
      fell = true;
      expect(s.calls[t.patient!].urgent).toBe('blink');
      const o = s.obj(`obj-${t.patient}`)!;
      expect(o.y).toBeLessThan(floorY(o.f) + 0.5);
      const a = s.actionFor(o)!;
      expect(a.action).toBe('help_up');
      s.interact({ obj: o, action: a.action, params: {}, dist: 1 });
      expect(s.mover.state(t.patient!)).toBe('bed');
      expect(t.done).not.toBeNull();
      expect(s.toReport().some((x) => x.id === t.id)).toBe(true);
      s.report(t.id);
      expect(t.reported).toBe(true);
      break;
    }
    expect(fell).toBe(true);
  });

  it('qualcuno arriva in bagno e torna a letto', () => {
    let back = false;
    for (const seed of [3, 8, 13, 21]) {
      const s = new Shift(seed);
      const inp = { forward: 0, strafe: 0, run: false, yaw: 0, pitch: 0 };
      const seenBath = new Set<string>();
      for (let i = 0; i < 14000; i++) {
        s.update(0.25, inp);
        for (const [pid, mv] of s.mover.m) { if (mv.state === 'bath') seenBath.add(pid); if (mv.state === 'bed' && seenBath.has(pid)) back = true; }
        for (const t of s.activeTasks()) if (t.kind === 'fall') { const o = s.obj(`obj-${t.patient}`)!; s.interact({ obj: o, action: 'help_up', params: {}, dist: 1 }); }
        if (back) break;
      }
      if (back) break;
    }
    expect(back).toBe(true);
  });
});

describe('la notte', () => {
  it('a mezzanotte le luci di cortesia, col blackout il buio', () => {
    const s = new Shift(12);
    const inp = { forward: 0, strafe: 0, run: false, yaw: 0, pitch: 0 };
    expect(s.lightLevel(21)).toBe(1);
    while (s.minute < 121) s.update(0.5, inp);
    expect(s.lightLevel(21)).toBe(0);
    s.power.main = false;
    expect(s.lightLevel(21)).toBe(-1);
  });

  it('la torcia si scarica e le pile la ricaricano', () => {
    const s = new Shift(12);
    const inp = { forward: 0, strafe: 0, run: false, yaw: 0, pitch: 0 };
    s.toggleTorch();
    for (let i = 0; i < 600 && s.torch; i++) s.update(1, inp);
    expect(s.torch).toBe(false);
    expect(s.toggleTorch()).toBe(false);
    const b = s.h.objs.find((o) => o.kind === 'batteries')!;
    s.interact({ obj: b, action: 'take_batteries', params: {}, dist: 1 });
    expect(s.torchCharge).toBe(1);
    expect(s.spares).toBe(2);
    expect(s.toggleTorch()).toBe(true);
  });

  it('la chiamata dalla stanza vuota porta lì e lì succede qualcosa', () => {
    for (const seed of [4, 9, 16, 25, 36]) {
      const s = new Shift(seed);
      if (!s.phantom.room) continue;
      const inp = { forward: 0, strafe: 0, run: false, yaw: 0, pitch: 0 };
      for (let i = 0; i < 9000 && s.phone.patient !== 'phantom'; i++) s.update(0.25, inp);
      expect(s.phone.patient).toBe('phantom');
      const ph = s.obj('phone-0')!;
      s.interact({ obj: ph, action: 'answer', params: {}, dist: 1 });
      const t = s.activeTasks().find((x) => x.kind === 'phantom')!;
      expect(t).toBeTruthy();
      const r = s.h.rooms.find((x) => x.id === s.phantom.room)!;
      s.player.x = (r.x0 + r.x1) / 2; s.player.z = (r.z0 + r.z1) / 2; s.player.y = floorY(r.f); s.player.f = r.f;
      s.update(0.1, inp);
      expect(t.done).not.toBeNull();
      expect(s.phantom.music).toBeGreaterThan(0);
      expect(s.chronicle.some((c) => c.strange && c.text.it.includes('carillon'))).toBe(true);
      return;
    }
    throw new Error('nessun seed con stanza vuota');
  });

  it('il paziente che non c\'è: dopo il racconto di Walter il letto è vuoto', () => {
    for (let seed = 1; seed < 30; seed++) {
      const s = new Shift(seed);
      if (!s.ghost.pid) continue;
      const inp = { forward: 0, strafe: 0, run: false, yaw: 0, pitch: 0 };
      for (let i = 0; i < 9000 && !s.ghost.revealed; i++) s.update(0.25, inp);
      expect(s.ghost.revealed).toBe(true);
      const o = s.obj(`obj-${s.ghost.pid}`)!;
      expect(s.actionFor(o)!.action).toBe('empty_bed');
      expect(s.mover.m.get(s.ghost.pid)!.trips.length).toBe(0);
      return;
    }
    throw new Error('nessun seed col paziente fantasma');
  });
});

describe('porte libere', () => {
  it('davanti e dietro ogni porta non c\'è niente che blocchi il passaggio (30 seed)', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const s = new Shift(seed);
      for (const d of s.h.doors) { d.open = true; s.doorOpen.set(d.id, 1); }
      const idx = new SolidIndex(s.h.solids.concat(s.dynamicSolids().filter((b) => !(b.x0 >= ELEV.doorX0 - 0.1 && b.x1 <= ELEV.doorX1 + 0.1))));
      for (const d of s.h.doors) {
        const y = floorY(d.f), a = doorPoint(d, -1.2), c = doorPoint(d, 1.2);
        for (let t = 0; t <= 1; t += 0.05) {
          const x = a.x + (c.x - a.x) * t, z = a.z + (c.z - a.z) * t;
          const near = new Set<Aabb>(); idx.query(x - PLAYER_R, x + PLAYER_R, z - PLAYER_R, z + PLAYER_R, near);
          for (const b of near) {
            if (b.y1 <= y + 0.46 || b.y0 >= y + 1.8) continue;
            const cx = Math.max(b.x0, Math.min(x, b.x1)), cz = Math.max(b.z0, Math.min(z, b.z1));
            expect((x - cx) ** 2 + (z - cz) ** 2 >= PLAYER_R * PLAYER_R, `seed ${seed} porta ${d.id} a ${t.toFixed(2)}`).toBe(true);
          }
        }
      }
    }
  });
});
