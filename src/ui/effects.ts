// Effetti a schermo intero, sopra il canvas 3D e sotto i menu. Non intercettano mai il puntatore.
// Con 'none' ogni elemento è nascosto e nessun ciclo di animazione resta attivo.

export type ScreenEffectKind = 'none' | 'code_rain' | 'white' | 'static' | 'flash';

const GLYPHS = 48;
const CELL = 28;

/** Generatore locale per la sola resa visiva (non tocca la logica di gioco). */
function makeRand(seed: number): () => number {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

interface Column {
  x: number;
  head: number; // riga (frazionaria) della testa
  speed: number; // righe al secondo
  len: number;
  size: number; // scala del glifo
  sway: number;
  phase: number;
  glyphs: Uint8Array;
}

export class ScreenEffects {
  readonly el: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly veil: HTMLElement;
  private readonly flashEl: HTMLElement;
  private ctx: CanvasRenderingContext2D | null = null;
  private kind: ScreenEffectKind = 'none';
  private intensity = 0;
  private raf = 0;
  private last = 0;
  private lastStatic = 0;
  private atlas: HTMLCanvasElement[] | null = null; // [corpo, testa]
  private columns: Column[] = [];
  private noise: HTMLCanvasElement | null = null;
  private readonly rand = makeRand((Date.now() ^ 0x5eed) >>> 0);
  private flashTimer = 0;
  private flashBusy = false;
  private lastFlashCall = -1e9;
  private width = 0;
  private height = 0;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'tds-fx';
    this.el.setAttribute('aria-hidden', 'true');
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'tds-fx-canvas';
    this.veil = document.createElement('div');
    this.veil.className = 'tds-fx-veil';
    this.flashEl = document.createElement('div');
    this.flashEl.className = 'tds-fx-flash';
    this.el.append(this.canvas, this.veil, this.flashEl);
    this.reset();
  }

  /** Vero se un ciclo di animazione è in corso (diagnostica e test manuali). */
  isAnimating(): boolean {
    return this.raf !== 0;
  }

  set(kind: ScreenEffectKind, intensity: number): void {
    const k: ScreenEffectKind =
      kind === 'code_rain' || kind === 'white' || kind === 'static' || kind === 'flash' ? kind : 'none';
    const v = Math.min(1, Math.max(0, Number.isFinite(intensity) ? intensity : 0));
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();

    if (k === 'flash') {
      const fresh = this.kind !== 'flash' || now - this.lastFlashCall > 500;
      this.lastFlashCall = now;
      if (this.kind !== 'flash') this.reset();
      this.kind = 'flash';
      this.intensity = v;
      this.el.hidden = false;
      if (fresh && !this.flashBusy && v > 0) this.fireFlash(v);
      return;
    }

    if (k !== this.kind) {
      this.reset();
      this.kind = k;
    }
    this.intensity = v;
    if (k === 'none' || v <= 0) {
      this.stopLoop();
      this.canvas.hidden = true;
      this.veil.style.opacity = '0';
      this.veil.hidden = true;
      this.el.hidden = true;
      return;
    }
    this.el.hidden = false;
    if (k === 'white') {
      this.veil.hidden = false;
      this.veil.style.opacity = String(v);
      return;
    }
    // code_rain / static: canvas animato
    this.canvas.hidden = false;
    this.el.classList.toggle('is-static', k === 'static');
    if (!this.raf) {
      this.last = 0;
      this.raf = requestAnimationFrame(this.frame);
    }
  }

  dispose(): void {
    this.reset();
    this.el.remove();
  }

  // ------------------------------------------------------------ interni

  private reset(): void {
    this.stopLoop();
    window.clearTimeout(this.flashTimer);
    this.flashBusy = false;
    this.flashEl.style.transition = 'none';
    this.flashEl.style.opacity = '0';
    this.flashEl.hidden = true;
    this.veil.style.opacity = '0';
    this.veil.hidden = true;
    this.canvas.hidden = true;
    this.el.classList.remove('is-static');
    this.el.hidden = true;
    this.columns = [];
    if (this.ctx && this.canvas.width > 0) this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.kind = 'none';
    this.intensity = 0;
  }

  private stopLoop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private fireFlash(v: number): void {
    this.flashBusy = true;
    const f = this.flashEl;
    f.hidden = false;
    f.style.transition = 'none';
    f.style.opacity = String(v);
    void f.offsetWidth; // forza il ricalcolo: la dissolvenza parte dal valore pieno
    f.style.transition = 'opacity 320ms ease-out';
    f.style.opacity = '0';
    window.clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => {
      this.flashBusy = false;
      f.hidden = true;
    }, 360);
  }

  private fit(scale: number): boolean {
    const w = Math.max(1, Math.round((this.el.clientWidth || window.innerWidth) * scale));
    const h = Math.max(1, Math.round((this.el.clientHeight || window.innerHeight) * scale));
    if (w !== this.width || h !== this.height || this.canvas.width !== w || this.canvas.height !== h) {
      this.width = w;
      this.height = h;
      this.canvas.width = w;
      this.canvas.height = h;
      return true;
    }
    return false;
  }

  private readonly frame = (now: number): void => {
    this.raf = 0;
    if (this.kind !== 'code_rain' && this.kind !== 'static') return;
    if (!this.ctx) this.ctx = this.canvas.getContext('2d');
    const ctx = this.ctx;
    if (!ctx) return;
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0.016;
    this.last = now;
    if (this.kind === 'code_rain') this.drawRain(ctx, dt, now / 1000);
    else if (now - this.lastStatic > 55) {
      this.lastStatic = now;
      this.drawStatic(ctx);
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  /** ~48 glifi astratti originali: tratti e archi casuali su un reticolo 3×4, in due tinte. */
  private buildAtlas(): HTMLCanvasElement[] {
    const rnd = this.rand;
    const strokes: { kind: number; a: number[]; b: number[]; c: number[] }[][] = [];
    const pt = () => [1 + Math.floor(rnd() * 3), 1 + Math.floor(rnd() * 4)];
    for (let g = 0; g < GLYPHS; g++) {
      const n = 2 + Math.floor(rnd() * 3);
      const list: { kind: number; a: number[]; b: number[]; c: number[] }[] = [];
      let prev = pt();
      for (let i = 0; i < n; i++) {
        const next = pt();
        const r = rnd();
        list.push({ kind: r < 0.55 ? 0 : r < 0.85 ? 1 : 2, a: rnd() < 0.6 ? prev : pt(), b: next, c: pt() });
        prev = next;
      }
      strokes.push(list);
    }
    const tints = ['rgba(176,214,222,1)', 'rgba(244,250,252,1)'];
    return tints.map((tint) => {
      const c = document.createElement('canvas');
      c.width = CELL * GLYPHS;
      c.height = CELL;
      const x = c.getContext('2d');
      if (!x) return c;
      x.strokeStyle = tint;
      x.fillStyle = tint;
      x.lineWidth = 1.7;
      x.lineCap = 'round';
      x.lineJoin = 'round';
      const sx = CELL / 4.6;
      const sy = CELL / 5.4;
      strokes.forEach((list, g) => {
        const ox = g * CELL + CELL * 0.07;
        const oy = CELL * 0.04;
        for (const s of list) {
          const ax = ox + s.a[0] * sx;
          const ay = oy + s.a[1] * sy;
          const bx = ox + s.b[0] * sx;
          const by = oy + s.b[1] * sy;
          x.beginPath();
          if (s.kind === 0) {
            x.moveTo(ax, ay);
            x.lineTo(bx, by);
            x.stroke();
          } else if (s.kind === 1) {
            x.moveTo(ax, ay);
            x.quadraticCurveTo(ox + s.c[0] * sx, oy + s.c[1] * sy, bx, by);
            x.stroke();
          } else {
            x.arc(bx, by, 1.6, 0, Math.PI * 2);
            x.fill();
          }
        }
      });
      return c;
    });
  }

  private makeColumn(x: number, rows: number, scatter: boolean): Column {
    const rnd = this.rand;
    const len = 6 + Math.floor(rnd() * 16);
    const glyphs = new Uint8Array(64);
    for (let i = 0; i < glyphs.length; i++) glyphs[i] = Math.floor(rnd() * GLYPHS);
    return {
      x,
      head: scatter ? rnd() * (rows + len) - len : -rnd() * rows * 0.6,
      speed: 5 + rnd() * 16,
      len,
      size: 0.62 + rnd() * 0.5,
      sway: rnd() * 5,
      phase: rnd() * 6.28,
      glyphs,
    };
  }

  private drawRain(ctx: CanvasRenderingContext2D, dt: number, time: number): void {
    const resized = this.fit(1);
    if (!this.atlas) this.atlas = this.buildAtlas();
    const w = this.width;
    const h = this.height;
    const pitch = 26;
    const rowH = 22;
    const rows = Math.ceil(h / rowH) + 1;
    const slots = Math.ceil(w / pitch);
    if (resized || this.columns.length !== slots) {
      this.columns = [];
      for (let i = 0; i < slots; i++) this.columns.push(this.makeColumn(i * pitch + pitch * 0.5, rows, true));
    }
    ctx.clearRect(0, 0, w, h);
    const k = this.intensity;
    const active = Math.max(1, Math.round(slots * (0.18 + 0.82 * k)));
    const stride = slots / active;
    const rnd = this.rand;
    const [body, headImg] = this.atlas;
    for (let n = 0; n < active; n++) {
      const col = this.columns[Math.min(slots - 1, Math.floor(n * stride))];
      col.head += col.speed * dt;
      if (col.head - col.len > rows) {
        const fresh = this.makeColumn(col.x, rows, false);
        Object.assign(col, fresh);
      }
      if (rnd() < 0.08) col.glyphs[Math.floor(rnd() * col.glyphs.length)] = Math.floor(rnd() * GLYPHS);
      const size = CELL * col.size;
      const x = col.x + Math.sin(time * 0.6 + col.phase) * col.sway - size / 2;
      const headRow = Math.floor(col.head);
      for (let i = 0; i < col.len; i++) {
        const row = headRow - i;
        if (row < -1 || row > rows) continue;
        const fade = 1 - i / col.len;
        const alpha = (i === 0 ? 0.95 : 0.6 * fade * fade + 0.04) * (0.25 + 0.75 * k);
        ctx.globalAlpha = alpha;
        const gi = col.glyphs[row & 63];
        ctx.drawImage(i === 0 ? headImg : body, gi * CELL, 0, CELL, CELL, x, row * rowH * (0.9 + col.size * 0.1), size, size);
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawStatic(ctx: CanvasRenderingContext2D): void {
    this.fit(0.25);
    const w = this.width;
    const h = this.height;
    if (!this.noise) {
      this.noise = document.createElement('canvas');
      this.noise.width = 128;
      this.noise.height = 128;
    }
    const nctx = this.noise.getContext('2d');
    if (!nctx) return;
    const img = nctx.createImageData(128, 128);
    const d = img.data;
    const rnd = this.rand;
    const k = this.intensity;
    for (let i = 0; i < d.length; i += 4) {
      const v = 120 + rnd() * 135;
      d[i] = v;
      d[i + 1] = v;
      d[i + 2] = v + 6;
      d[i + 3] = rnd() < 0.5 ? rnd() * 110 * k : 0;
    }
    nctx.putImageData(img, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const ox = Math.floor(rnd() * 128);
    const oy = Math.floor(rnd() * 128);
    for (let y = -oy; y < h; y += 128) for (let x = -ox; x < w; x += 128) ctx.drawImage(this.noise, x, y);
    // bande di interferenza orizzontali
    const bands = 1 + Math.floor(k * 3);
    for (let b = 0; b < bands; b++) {
      const y = Math.floor(rnd() * h);
      const bh = 1 + Math.floor(rnd() * Math.max(2, h * 0.04 * k));
      ctx.fillStyle = `rgba(230,236,240,${(0.05 + rnd() * 0.16) * k})`;
      ctx.fillRect(0, y, w, bh);
    }
  }
}
