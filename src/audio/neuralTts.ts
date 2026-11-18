// Voce narrante neurale offline (Piper). I modelli ONNX stanno in public/voices, il motore
// onnxruntime-web e il fonemizzatore espeak-ng (WebAssembly) in public/piper: tutto è servito dal
// gioco stesso, nessun servizio esterno. Se un file manca o qualcosa fallisce, si passa alla voce
// del browser (Tts) e il gioco continua. Mai eccezioni verso il chiamante.
import type { ITts, TtsStatus } from '../core/api';
import type { Lang } from '../core/contracts';
import { clamp } from '../core/rng';

export interface PiperVoice {
  label: string;
  /** Percorso relativo alla pagina. */
  file: string;
  /** Voce espeak-ng usata per la fonemizzazione (dal .onnx.json del modello). */
  espeak: string;
  sampleRate: number;
  noiseScale: number;
  lengthScale: number;
  noiseW: number;
}

/** Parametri copiati dai file .onnx.json dei modelli (che restano in public/voices come riferimento). */
export const PIPER_VOICES: Record<Lang, PiperVoice> = {
  it: { label: 'Riccardo (Piper)', file: 'voices/it-riccardo_fasol-x-low.onnx', espeak: 'it', sampleRate: 16000, noiseScale: 0.667, lengthScale: 1.04, noiseW: 0.8 },
  en: { label: 'Alan (Piper)', file: 'voices/en-gb-alan-low.onnx', espeak: 'en-gb-x-rp', sampleRate: 16000, noiseScale: 0.667, lengthScale: 1.04, noiseW: 0.8 },
};

import type { WorkerReply, WorkerRequest } from './piperWorker';

// Tipo minimo del fonemizzatore caricato a runtime da public/piper.
interface PhonemizeModule { callMain(args: string[]): void }
type CreatePhonemize = (m: object) => Promise<PhonemizeModule>;
type Phonemize = (espeakVoice: string, text: string) => number[];

export interface VoiceOut { ctx: BaseAudioContext; node: AudioNode }

interface Item { text: string; lang: Lang; rate: number; pitch: number }

const MAX_QUEUE = 2;
const MAX_CHUNK = 280;

function assetUrl(path: string): string {
  const base = typeof document !== 'undefined' ? document.baseURI : String(globalThis.location?.href ?? '');
  return new URL(path, base).href;
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('script ' + src));
    document.head.appendChild(s);
  });
}

/** Divide un testo lungo in pezzi sui confini di frase (Piper rende meglio frasi brevi). */
export function splitText(text: string, max = MAX_CHUNK): string[] {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t ? [t] : [];
  const sentences = t.match(/[^.!?…;:]+[.!?…;:]*\s*/g) ?? [t];
  const out: string[] = [];
  let cur = '';
  for (const s of sentences) {
    if (cur && cur.length + s.length > max) {
      out.push(cur.trim());
      cur = '';
    }
    if (s.length > max) {
      // frase lunghissima: si spezza sulle virgole o sugli spazi
      for (const w of s.split(/(?<=,)\s+|\s+/)) {
        if (cur && cur.length + w.length + 1 > max) { out.push(cur.trim()); cur = ''; }
        cur += w + ' ';
      }
    } else cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Unisce i pezzi, normalizza il volume e ammorbidisce gli estremi (niente click). */
export function finishPcm(parts: Float32Array[], sampleRate: number, gapSec = 0.12): Float32Array {
  const gap = Math.round(sampleRate * gapSec);
  const n = parts.reduce((a, p) => a + p.length, 0) + gap * Math.max(0, parts.length - 1);
  const out = new Float32Array(n);
  let o = 0;
  let peak = 0;
  parts.forEach((p, i) => {
    if (i > 0) o += gap;
    out.set(p, o);
    o += p.length;
  });
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  const g = peak > 1e-4 ? Math.min(0.85 / peak, 4) : 1;
  const fade = Math.min(Math.round(sampleRate * 0.01), n >> 1);
  for (let i = 0; i < n; i++) {
    const f = i < fade ? i / fade : i >= n - fade ? (n - 1 - i) / fade : 1;
    out[i] *= g * f;
  }
  return out;
}

export class NeuralTts implements ITts {
  private worker: Worker | null = null;
  private seq = 0;
  private readonly calls = new Map<number, { resolve: (r: WorkerReply) => void; reject: (e: Error) => void }>();
  private phon: Promise<Phonemize> | null = null;
  private readonly sessions: Partial<Record<Lang, Promise<void>>> = {};
  private readonly state: Record<Lang, 'idle' | 'loading' | 'ready' | 'failed'> = { it: 'idle', en: 'idle' };
  private queue: Item[] = [];
  private busy = false;
  private src: AudioBufferSourceNode | null = null;
  private gen = 0;
  private enabled = true;

  constructor(
    private readonly fallback: ITts,
    private readonly output: () => VoiceOut | null,
    private readonly voices: Record<Lang, PiperVoice> = PIPER_VOICES,
  ) {}

  /** Comincia a caricare il modello della lingua (da chiamare all'avvio di un turno). */
  preload(lang: Lang): void {
    try {
      void this.session(lang).catch(() => undefined);
      void this.loadPhonemizer().catch(() => undefined);
    } catch { /* si riproverà alla prima frase */ }
  }

  status(): TtsStatus {
    const fb = this.fallback.status();
    const voice = (l: Lang): string | null => (this.state[l] === 'failed' ? fb.voice[l] : this.voices[l].label);
    const local = (l: Lang): boolean => (this.state[l] === 'failed' ? fb.local[l] : true);
    return { supported: true, voice: { it: voice('it'), en: voice('en') }, local: { it: local('it'), en: local('en') } };
  }

  speak(text: string, lang: Lang, style?: { rate?: number; pitch?: number; interrupt?: boolean }): boolean {
    try {
      if (!this.enabled) return false;
      const clean = typeof text === 'string' ? text.trim() : '';
      if (!clean) return false;
      if (this.state[lang] === 'failed' || !this.output()) return this.fallback.speak(clean, lang, style);
      const item: Item = {
        text: clean,
        lang,
        rate: clamp(num(style?.rate, 0.95), 0.8, 1.1),
        pitch: clamp(num(style?.pitch, 1), 0.7, 1.2),
      };
      if (style?.interrupt) this.cancel();
      this.queue.push(item);
      while (this.queue.length > MAX_QUEUE) this.queue.shift();
      this.pump();
      return true;
    } catch {
      return false;
    }
  }

  cancel(): void {
    this.gen++;
    this.queue = [];
    this.busy = false;
    const s = this.src;
    this.src = null;
    if (s) {
      try { s.onended = null; s.stop(); } catch { /* già fermo */ }
      try { s.disconnect(); } catch { /* ignorato */ }
    }
    try { this.fallback.cancel(); } catch { /* ignorato */ }
  }

  setEnabled(on: boolean): void {
    this.enabled = !!on;
    this.fallback.setEnabled(on);
    if (!this.enabled) this.cancel();
  }

  // ------------------------------------------------------------ interno

  private pump(): void {
    if (this.busy || this.queue.length === 0) return;
    const item = this.queue.shift() as Item;
    this.busy = true;
    const gen = this.gen;
    this.render(item).then(
      (r) => {
        if (gen !== this.gen) return;
        if (r) this.play(r.buf, r.playback);
        else this.next();
      },
      () => {
        if (gen !== this.gen) return;
        // modello non disponibile: questa frase e le prossime passano alla voce del browser
        this.state[item.lang] = 'failed';
        const rest = [item, ...this.queue.filter((q) => q.lang === item.lang)];
        this.queue = this.queue.filter((q) => q.lang !== item.lang);
        for (const q of rest) this.fallback.speak(q.text, q.lang, { rate: q.rate, pitch: q.pitch });
        this.next();
      },
    );
  }

  private next(): void {
    this.busy = false;
    this.pump();
  }

  private play(buf: AudioBuffer, playback: number): void {
    const out = this.output();
    if (!out) return this.next();
    let s: AudioBufferSourceNode;
    try {
      s = out.ctx.createBufferSource();
      s.buffer = buf;
      s.playbackRate.value = playback;
      s.connect(out.node);
      s.onended = () => {
        if (this.src !== s) return;
        this.src = null;
        try { s.disconnect(); } catch { /* ignorato */ }
        this.next();
      };
      this.src = s;
      s.start();
    } catch {
      this.src = null;
      this.next();
    }
  }

  private async render(item: Item): Promise<{ buf: AudioBuffer; playback: number } | null> {
    const v = this.voices[item.lang];
    const [, phonemize] = await Promise.all([this.session(item.lang), this.loadPhonemizer()]);
    // L'altezza si ottiene accelerando/rallentando la riproduzione; la durata del modello compensa,
    // così il ritmo resta quello voluto. Escursione ridotta: oltre suona artificiale.
    const playback = clamp(1 + (item.pitch - 1) * 0.5, 0.92, 1.06);
    const lengthScale = (v.lengthScale * playback) / item.rate;
    const parts: Float32Array[] = [];
    for (const chunk of splitText(item.text)) {
      const ids = phonemize(v.espeak, chunk);
      if (ids.length === 0) continue;
      const r = await this.call({ type: 'run', id: 0, model: assetUrl(v.file), ids, scales: [v.noiseScale, lengthScale, v.noiseW] });
      if (r.type === 'pcm' && r.pcm.length > 0) parts.push(r.pcm);
    }
    const out = this.output();
    if (!out || parts.length === 0) return null;
    const data = finishPcm(parts, v.sampleRate);
    const buf = out.ctx.createBuffer(1, data.length, v.sampleRate);
    buf.getChannelData(0).set(data);
    return { buf, playback };
  }

  private session(lang: Lang): Promise<void> {
    let p = this.sessions[lang];
    if (!p) {
      this.state[lang] = 'loading';
      p = this.call({
        type: 'load',
        id: 0,
        ortUrl: assetUrl('piper/ort.wasm.bundle.min.mjs'),
        wasmBase: assetUrl('piper/'),
        model: assetUrl(this.voices[lang].file),
      }).then(
        () => {
          this.state[lang] = 'ready';
        },
        (e: unknown) => {
          this.state[lang] = 'failed';
          throw e;
        },
      );
      this.sessions[lang] = p;
    }
    return p;
  }

  /** Il modello gira in un worker: la sintesi non blocca i fotogrammi del gioco. */
  private call(req: WorkerRequest): Promise<WorkerReply> {
    return new Promise((resolve, reject) => {
      try {
        if (!this.worker) {
          const w = new Worker(new URL('./piperWorker.ts', import.meta.url), { type: 'module' });
          w.onmessage = (ev: MessageEvent<WorkerReply>) => {
            const c = this.calls.get(ev.data.id);
            if (!c) return;
            this.calls.delete(ev.data.id);
            if (ev.data.type === 'error') c.reject(new Error(ev.data.message));
            else c.resolve(ev.data);
          };
          w.onerror = () => {
            for (const c of this.calls.values()) c.reject(new Error('voice worker failed'));
            this.calls.clear();
          };
          this.worker = w;
        }
        const id = ++this.seq;
        this.calls.set(id, { resolve, reject });
        this.worker.postMessage({ ...req, id });
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  private loadPhonemizer(): Promise<Phonemize> {
    if (!this.phon) {
      this.phon = (async () => {
        const g = globalThis as unknown as { createPiperPhonemize?: CreatePhonemize };
        if (typeof g.createPiperPhonemize !== 'function') await loadScript(assetUrl('piper/piper_phonemize.js'));
        const create = g.createPiperPhonemize;
        if (typeof create !== 'function') throw new Error('phonemizer missing');
        let sink: number[] = [];
        const mod = await create({
          print: (line: string) => {
            try {
              const ids = (JSON.parse(line) as { phoneme_ids?: unknown }).phoneme_ids;
              if (Array.isArray(ids)) sink = sink.concat(ids as number[]);
            } catch { /* riga non JSON */ }
          },
          printErr: () => undefined,
          locateFile: (f: string) => assetUrl('piper/' + f),
        });
        return (voice: string, text: string): number[] => {
          sink = [];
          mod.callMain(['-l', voice, '--input', JSON.stringify([{ text }]), '--espeak_data', '/espeak-ng-data']);
          return sink;
        };
      })();
      this.phon.catch(() => {
        this.phon = null; // un errore di rete passeggero non deve spegnere la voce per sempre
      });
    }
    return this.phon;
  }
}

function num(v: number | undefined, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
