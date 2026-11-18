// Ascensore: una cabina sola che serve i quattro piani. Lento, con la musichetta.
import { BASE_FLOOR, FLOORS, H, floorY } from '../world/hospital';

export type ElevPhase = 'idle' | 'opening' | 'open' | 'closing' | 'moving' | 'stalled' | 'rescue';

export const ELEV_SPEED = 0.62; // m/s: circa sei secondi per piano
export const DOOR_OPEN_S = 1.3;
export const DOOR_HOLD_S = 5.5;

export interface ElevEvent { kind: 'ding' | 'door_open' | 'door_close' | 'start' | 'stop' | 'stall' | 'rescue'; floor: number }

export class Elevator {
  phase: ElevPhase = 'idle';
  y = 0;
  floor = 0;
  dir: -1 | 0 | 1 = 0;
  /** 0 chiuse … 1 aperte. */
  door = 0;
  private hold = 0;
  private stallT = 0;
  readonly calls = new Set<number>();
  readonly events: ElevEvent[] = [];

  constructor(startFloor = BASE_FLOOR) { this.floor = startFloor; this.y = floorY(startFloor); }

  /** Piano a cui è ferma la cabina (null se è in corsa o tra due piani). */
  atFloor(): number | null {
    const f = Math.round(this.y / H) + BASE_FLOOR;
    return Math.abs(this.y - floorY(f)) < 0.02 && this.phase !== 'moving' && this.phase !== 'stalled' && this.phase !== 'rescue' ? f : null;
  }

  call(f: number): void {
    if (!FLOORS.includes(f as never)) return;
    if (this.phase === 'stalled' || this.phase === 'rescue') return;
    if (this.atFloor() === f) {
      if (this.phase === 'closing' || this.phase === 'idle') { this.phase = 'opening'; this.events.push({ kind: 'door_open', floor: f }); }
      else if (this.phase === 'open') this.hold = DOOR_HOLD_S;
      return;
    }
    this.calls.add(f);
  }

  /** Riapre le porte se qualcuno è sulla soglia mentre si chiudono. */
  blockDoor(): void {
    if (this.phase === 'closing') { this.phase = 'opening'; this.events.push({ kind: 'door_open', floor: this.floor }); }
    if (this.phase === 'open') this.hold = Math.max(this.hold, 2);
  }

  update(dt: number, powered: boolean): void {
    if (!powered) {
      if (this.phase === 'moving') { this.phase = 'stalled'; this.stallT = 0; this.events.push({ kind: 'stall', floor: this.floor }); }
      else if (this.phase !== 'stalled' && this.phase !== 'rescue') {
        // senza corrente le porte si chiudono e la cabina resta ferma
        this.door = Math.max(0, this.door - dt / DOOR_OPEN_S);
        if (this.door === 0) this.phase = 'idle';
        return;
      }
    }
    switch (this.phase) {
      case 'stalled': {
        // dopo venti secondi le batterie di emergenza portano la cabina al piano più vicino
        this.stallT += dt;
        if (powered) { this.phase = 'moving'; break; }
        if (this.stallT > 20) { this.phase = 'rescue'; this.floor = Math.round(this.y / H) + BASE_FLOOR; this.events.push({ kind: 'rescue', floor: this.floor }); }
        break;
      }
      case 'rescue': {
        const target = floorY(this.floor);
        const step = 0.25 * dt;
        if (Math.abs(target - this.y) <= step) {
          this.y = target; this.calls.clear();
          this.phase = 'opening'; this.events.push({ kind: 'ding', floor: this.floor }, { kind: 'door_open', floor: this.floor });
        } else this.y += Math.sign(target - this.y) * step;
        break;
      }
      case 'idle': {
        if (this.calls.size === 0) { this.dir = 0; break; }
        const cur = Math.round(this.y / H) + BASE_FLOOR;
        const list = [...this.calls].sort((a, b) => a - b);
        const up = list.filter((f) => f > cur), down = list.filter((f) => f < cur).reverse();
        const pick = this.dir >= 0 ? (up[0] ?? down[0]) : (down[0] ?? up[0]);
        if (pick === undefined) { this.calls.clear(); break; }
        this.dir = pick > cur ? 1 : -1;
        this.phase = 'moving';
        this.events.push({ kind: 'start', floor: cur });
        break;
      }
      case 'moving': {
        // si ferma al primo piano chiamato nella direzione di marcia
        const next = (this.dir > 0 ? Math.floor(this.y / H + 1e-6) + 1 : Math.ceil(this.y / H - 1e-6) - 1) + BASE_FLOOR;
        const targetF = [...this.calls].filter((f) => (this.dir > 0 ? f >= next : f <= next)).sort((a, b) => (this.dir > 0 ? a - b : b - a))[0];
        if (targetF === undefined) { this.phase = 'idle'; break; }
        const ty = floorY(targetF);
        const dist = Math.abs(ty - this.y);
        // rallenta in arrivo
        const v = ELEV_SPEED * Math.min(1, 0.25 + dist / 1.2);
        if (dist <= v * dt) {
          this.y = ty; this.floor = targetF; this.calls.delete(targetF);
          this.phase = 'opening';
          this.events.push({ kind: 'stop', floor: targetF }, { kind: 'ding', floor: targetF }, { kind: 'door_open', floor: targetF });
        } else { this.y += this.dir * v * dt; this.floor = Math.round(this.y / H) + BASE_FLOOR; }
        break;
      }
      case 'opening':
        this.door = Math.min(1, this.door + dt / DOOR_OPEN_S);
        if (this.door >= 1) { this.phase = 'open'; this.hold = DOOR_HOLD_S; }
        break;
      case 'open':
        this.hold -= dt;
        if (this.hold <= 0 || this.calls.size > 0 && this.hold < DOOR_HOLD_S - 2.5) { this.phase = 'closing'; this.events.push({ kind: 'door_close', floor: this.floor }); }
        break;
      case 'closing':
        this.door = Math.max(0, this.door - dt / (DOOR_OPEN_S * 1.2));
        if (this.door <= 0) this.phase = 'idle';
        break;
    }
  }

  drain(): ElevEvent[] { return this.events.splice(0); }
}
