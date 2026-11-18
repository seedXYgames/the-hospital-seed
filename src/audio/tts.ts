// Sintesi vocale del browser (Web Speech API), best-effort: se manca una voce per la lingua
// `speak` restituisce false e il gioco continua con i soli sottotitoli. Mai eccezioni.
import type { ITts, TtsStatus } from '../core/api';
import type { Lang } from '../core/contracts';
import { clamp } from '../core/rng';

export interface VoiceInfo { name: string; lang: string; localService: boolean; default: boolean }

const CANONICAL: Record<Lang, string[]> = { it: ['it-it'], en: ['en-gb', 'en-us'] };

function normLang(l: string): string {
  return String(l ?? '').toLowerCase().replace(/_/g, '-');
}

function matches(voiceLang: string, lang: Lang): boolean {
  const l = normLang(voiceLang);
  return l === lang || l.startsWith(lang + '-');
}

// Il narratore è l'agente, un uomo. Le API vocali non dichiarano il genere: si riconosce dal nome,
// usando i nomi delle voci di macOS/iOS, Windows/Edge, Chrome e Android.
const MALE = /\b(luca|cosimo|diego|giuseppe|benigno|calimero|gianni|lorenzo|rinaldo|alex|daniel|fred|tom|aaron|arthur|evan|nathan|oliver|reed|rishi|ralph|gordon|lee|guy|andrew|brian|christopher|eric|roger|steffan|ryan|thomas|david|mark|george|james|liam|william|davis|tony|jason|male|uomo|maschile)\b/;
const FEMALE = /\b(alice|federica|paola|elsa|isabella|fiammetta|elena|palmira|pierina|imelda|samantha|karen|moira|tessa|fiona|victoria|ava|allison|susan|zira|hazel|aria|jenny|emma|libby|sonia|serena|kate|martha|nicky|zoe|joanna|salli|kimberly|ivy|female|donna|femminile)\b/;
// Voci di qualità più umana: neurali o scaricate in alta qualità dal sistema (gratuite).
const NATURAL = /natural|neural|premium|enhanced|avanzat|migliorat|siri|wavenet|studio/;

export function voiceGender(name: string): 'male' | 'female' | 'unknown' {
  const n = String(name ?? '').toLowerCase();
  if (FEMALE.test(n) && !/\bmale\b/.test(n)) return 'female';
  if (MALE.test(n)) return 'male';
  return 'unknown';
}

/**
 * Sceglie la voce per la lingua: maschile prima di tutto, poi la più naturale, poi locale,
 * poi la variante regionale più comune. Una voce femminile si usa solo se non c'è altro.
 */
export function chooseVoice<V extends VoiceInfo>(voices: readonly V[], lang: Lang): V | null {
  let best: V | null = null;
  let bestScore = -1e9;
  for (const v of voices) {
    if (!v || !matches(v.lang, lang)) continue;
    const g = voiceGender(v.name);
    const score =
      (g === 'male' ? 100 : g === 'unknown' ? 0 : -100) +
      (NATURAL.test(String(v.name ?? '').toLowerCase()) ? 40 : 0) +
      (v.localService === true ? 8 : 0) + (v.default === true ? 4 : 0) +
      (CANONICAL[lang].includes(normLang(v.lang)) ? 2 : 0);
    if (score > bestScore) {
      best = v;
      bestScore = score;
    }
  }
  return best;
}

/** Sottoinsieme di SpeechSynthesis realmente usato (iniettabile nei test). */
export interface SpeechSynthLike {
  getVoices(): VoiceInfo[];
  speak(u: UtteranceLike): void;
  cancel(): void;
  addEventListener?(type: 'voiceschanged', cb: () => void): void;
  removeEventListener?(type: 'voiceschanged', cb: () => void): void;
  onvoiceschanged?: unknown;
}

export interface UtteranceLike {
  text: string;
  lang: string;
  voice: unknown;
  rate: number;
  pitch: number;
  volume: number;
  onend: unknown;
  onerror: unknown;
}

export interface TtsDeps {
  synth?: SpeechSynthLike | null;
  makeUtterance?: (text: string) => UtteranceLike;
}

interface Pending { text: string; lang: Lang; rate: number; pitch: number }

const MAX_QUEUE = 2;

export class Tts implements ITts {
  private readonly synth: SpeechSynthLike | null;
  private readonly makeUtterance: ((text: string) => UtteranceLike) | null;
  private voices: VoiceInfo[] = [];
  private chosen: Record<Lang, VoiceInfo | null> = { it: null, en: null };
  private enabled = true;
  private queue: Pending[] = [];
  /** Riferimento forte all'enunciato in corso (alcuni browser lo perdono e non chiamano onend). */
  private current: UtteranceLike | null = null;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private readonly onVoices = (): void => this.refreshVoices();

  constructor(deps: TtsDeps = {}) {
    let synth: SpeechSynthLike | null = null;
    let make: ((text: string) => UtteranceLike) | null = null;
    try {
      const g = globalThis as unknown as {
        speechSynthesis?: SpeechSynthLike;
        SpeechSynthesisUtterance?: new (text: string) => UtteranceLike;
      };
      synth = deps.synth !== undefined ? deps.synth : g.speechSynthesis ?? null;
      const Ctor = g.SpeechSynthesisUtterance;
      make = deps.makeUtterance ?? (typeof Ctor === 'function' ? (t: string) => new Ctor(t) : null);
      if (synth && typeof synth.getVoices !== 'function') synth = null;
    } catch {
      synth = null;
    }
    this.synth = synth;
    this.makeUtterance = make;
    if (this.synth) {
      try {
        if (typeof this.synth.addEventListener === 'function') {
          this.synth.addEventListener('voiceschanged', this.onVoices);
        } else {
          this.synth.onvoiceschanged = this.onVoices;
        }
      } catch { /* l'elenco verrà riletto alla prima richiesta */ }
      this.refreshVoices();
    }
  }

  private get supported(): boolean {
    return this.synth !== null && this.makeUtterance !== null;
  }

  private refreshVoices(): void {
    if (!this.synth) return;
    try {
      const list = this.synth.getVoices();
      this.voices = Array.isArray(list) ? list.slice() : Array.from(list ?? []);
    } catch {
      this.voices = [];
    }
    this.chosen = { it: chooseVoice(this.voices, 'it'), en: chooseVoice(this.voices, 'en') };
  }

  status(): TtsStatus {
    if (this.supported && this.voices.length === 0) this.refreshVoices();
    return {
      supported: this.supported,
      voice: { it: this.chosen.it?.name ?? null, en: this.chosen.en?.name ?? null },
      local: { it: this.chosen.it?.localService === true, en: this.chosen.en?.localService === true },
    };
  }

  speak(text: string, lang: Lang, style?: { rate?: number; pitch?: number; interrupt?: boolean }): boolean {
    try {
      if (!this.supported || !this.enabled) return false;
      const clean = typeof text === 'string' ? text.trim() : '';
      if (!clean) return false;
      if (this.voices.length === 0) this.refreshVoices();
      if (!this.chosen[lang]) return false;
      const item: Pending = {
        text: clean,
        lang,
        rate: clamp(num(style?.rate, 0.95), 0.8, 1.1),
        pitch: clamp(num(style?.pitch, 1), 0.7, 1.2),
      };
      if (style?.interrupt) {
        this.queue = [];
        this.stopCurrent();
        return this.start(item);
      }
      if (this.current) {
        // sovrapposizione: si accoda, scartando le frasi più vecchie non ancora iniziate
        this.queue.push(item);
        while (this.queue.length > MAX_QUEUE) this.queue.shift();
        return true;
      }
      return this.start(item);
    } catch {
      return false;
    }
  }

  cancel(): void {
    this.queue = [];
    this.stopCurrent();
  }

  setEnabled(on: boolean): void {
    this.enabled = !!on;
    if (!this.enabled) this.cancel();
  }

  /** Rilascia l'ascoltatore delle voci e ferma tutto. */
  dispose(): void {
    this.cancel();
    try {
      if (this.synth && typeof this.synth.removeEventListener === 'function') {
        this.synth.removeEventListener('voiceschanged', this.onVoices);
      } else if (this.synth && this.synth.onvoiceschanged === this.onVoices) {
        this.synth.onvoiceschanged = null;
      }
    } catch { /* niente da rilasciare */ }
  }

  private stopCurrent(): void {
    this.current = null;
    if (this.watchdog !== null) {
      clearTimeout(this.watchdog);
      this.watchdog = null;
    }
    try {
      this.synth?.cancel();
    } catch { /* ignorato */ }
  }

  private start(item: Pending): boolean {
    const voice = this.chosen[item.lang];
    if (!this.synth || !this.makeUtterance || !voice) return false;
    let u: UtteranceLike;
    try {
      u = this.makeUtterance(item.text);
      u.voice = voice;
      u.lang = voice.lang;
      u.rate = item.rate;
      u.pitch = item.pitch;
      u.volume = 1;
      const done = (): void => {
        if (this.current !== u) return; // già interrotto o sostituito
        this.finish();
      };
      u.onend = done;
      u.onerror = done;
      this.current = u;
      this.synth.speak(u);
    } catch {
      this.current = null;
      return false;
    }
    // se il browser non notifica mai la fine, la coda non deve restare bloccata
    if (typeof setTimeout === 'function') {
      const ms = 4000 + (item.text.length * 110) / item.rate;
      this.watchdog = setTimeout(() => {
        this.watchdog = null;
        if (this.current === u) {
          try {
            this.synth?.cancel();
          } catch { /* ignorato */ }
          this.finish();
        }
      }, ms);
      (this.watchdog as unknown as { unref?: () => void }).unref?.();
    }
    return true;
  }

  private finish(): void {
    this.current = null;
    if (this.watchdog !== null) {
      clearTimeout(this.watchdog);
      this.watchdog = null;
    }
    while (this.queue.length > 0 && !this.current) {
      const next = this.queue.shift() as Pending;
      if (this.enabled) this.start(next);
    }
  }
}

function num(v: number | undefined, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
