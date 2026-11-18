// Musica procedurale: canti di Natale tradizionali (di pubblico dominio, XIX secolo o più antichi)
// suonati come in una vecchia filodiffusione, e una musichetta d'attesa originale per l'ascensore.
import type { Ctx, LoopHandle, RecipeParams } from './synth';

type Song = { name: string; beat: number; bar: number; mel: string; chords: string[]; bells?: boolean };

// Melodie: NOTA:durata in battiti, R = pausa, | separa le battute (solo per leggibilità).
const SONGS: Song[] = [
  { name: 'Jingle Bells (J. Pierpont, 1857)', beat: 0.42, bar: 4, bells: true,
    mel: 'B4:1 B4:1 B4:2 | B4:1 B4:1 B4:2 | B4:1 D5:1 G4:1.5 A4:0.5 | B4:4 | C5:1 C5:1 C5:1.5 C5:0.5 | C5:1 B4:1 B4:1 B4:0.5 B4:0.5 | B4:1 A4:1 A4:1 B4:1 | A4:2 D5:2 | B4:1 B4:1 B4:2 | B4:1 B4:1 B4:2 | B4:1 D5:1 G4:1.5 A4:0.5 | B4:4 | C5:1 C5:1 C5:1.5 C5:0.5 | C5:1 B4:1 B4:1 B4:0.5 B4:0.5 | D5:1 D5:1 C5:1 A4:1 | G4:4',
    chords: ['G', 'G', 'G', 'G', 'C', 'G', 'A7', 'D7', 'G', 'G', 'G', 'G', 'C', 'G', 'D7', 'G'] },
  { name: 'Stille Nacht (F. X. Gruber, 1818)', beat: 0.26, bar: 6,
    mel: 'G4:3 A4:1 G4:2 | E4:6 | G4:3 A4:1 G4:2 | E4:6 | D5:4 D5:2 | B4:6 | C5:4 C5:2 | G4:6 | A4:4 A4:2 | C5:3 B4:1 A4:2 | G4:3 A4:1 G4:2 | E4:6 | A4:4 A4:2 | C5:3 B4:1 A4:2 | G4:3 A4:1 G4:2 | E4:6 | D5:4 D5:2 | F5:3 D5:1 B4:2 | C5:6 | E5:6 | C5:3 G4:1 E4:2 | G4:3 F4:1 D4:2 | C4:6 | R:6',
    chords: ['C', 'C', 'C', 'C', 'G', 'G', 'C', 'C', 'F', 'F', 'C', 'C', 'F', 'F', 'C', 'C', 'G', 'G7', 'C', 'C', 'C', 'G7', 'C', 'C'] },
  { name: 'We Wish You a Merry Christmas (trad.)', beat: 0.4, bar: 3,
    mel: 'R:2 D4:1 | G4:1 G4:0.5 A4:0.5 G4:0.5 F#4:0.5 | E4:1 E4:1 E4:1 | A4:1 A4:0.5 B4:0.5 A4:0.5 G4:0.5 | F#4:1 D4:1 D4:1 | B4:1 B4:0.5 C5:0.5 B4:0.5 A4:0.5 | G4:1 E4:1 D4:0.5 D4:0.5 | E4:1 A4:1 F#4:1 | G4:2 D4:1 | G4:1 G4:1 G4:1 | F#4:2 F#4:1 | G4:1 F#4:1 E4:1 | D4:2 A4:1 | B4:1 A4:0.5 A4:0.5 G4:0.5 G4:0.5 | D5:1 D4:1 D4:0.5 D4:0.5 | E4:1 A4:1 F#4:1 | G4:3',
    chords: ['G', 'G', 'C', 'A7', 'D', 'B7', 'Em', 'D7', 'G', 'G', 'D', 'Em', 'D', 'G', 'D', 'D7', 'G'], bells: true },
  { name: 'Deck the Halls (trad. gallese)', beat: 0.38, bar: 4,
    mel: 'C5:1.5 Bb4:0.5 A4:1 G4:1 | F4:1 G4:1 A4:1 F4:1 | G4:0.5 A4:0.5 Bb4:0.5 G4:0.5 A4:1.5 G4:0.5 | F4:1 E4:1 F4:2 | C5:1.5 Bb4:0.5 A4:1 G4:1 | F4:1 G4:1 A4:1 F4:1 | G4:0.5 A4:0.5 Bb4:0.5 G4:0.5 A4:1.5 G4:0.5 | F4:1 E4:1 F4:2 | G4:1.5 A4:0.5 Bb4:1 G4:1 | A4:1.5 Bb4:0.5 C5:1 G4:1 | A4:0.5 B4:0.5 C5:1 D5:0.5 E5:0.5 F5:1 | E5:1 D5:1 C5:2 | C5:1.5 Bb4:0.5 A4:1 G4:1 | F4:1 G4:1 A4:1 F4:1 | D5:0.5 D5:0.5 D5:0.5 D5:0.5 C5:1.5 Bb4:0.5 | A4:1 G4:1 F4:2',
    chords: ['F', 'F', 'C7', 'F', 'F', 'F', 'C7', 'F', 'C', 'F', 'G7', 'C', 'F', 'F', 'Bb', 'F'] },
  { name: 'O Tannenbaum (trad. tedesco)', beat: 0.42, bar: 3,
    mel: 'R:2 C4:1 | F4:0.75 F4:0.25 F4:1.5 G4:0.5 | A4:0.75 A4:0.25 A4:1.5 A4:0.5 | G4:0.5 A4:0.5 Bb4:1 E4:1 | G4:1 F4:1 R:1 | C5:0.5 C5:0.5 A4:0.5 D5:1.5 | C5:0.5 C5:0.5 Bb4:0.5 Bb4:1.5 | Bb4:0.5 Bb4:0.5 G4:0.5 C5:1.5 | Bb4:0.5 Bb4:0.5 A4:0.5 A4:1 C4:0.5 | F4:0.75 F4:0.25 F4:1.5 G4:0.5 | A4:0.75 A4:0.25 A4:1.5 A4:0.5 | G4:0.5 A4:0.5 Bb4:1 E4:1 | G4:1 F4:2',
    chords: ['F', 'F', 'F', 'C7', 'F', 'F', 'Bb', 'C', 'F', 'F', 'F', 'C7', 'F'] },
];

// Musica d'attesa dell'ascensore: composizione originale, bossa lenta e un po' stucchevole.
const MUZAK: Song = {
  name: 'Ascensore (originale)', beat: 0.62, bar: 4,
  mel: 'A4:1.5 C5:0.5 E5:1 C5:1 | B4:1.5 G4:0.5 D5:2 | F4:1 A4:1 C5:1 A4:1 | B4:2 R:1 G4:1 | E5:1.5 D5:0.5 C5:1 B4:1 | C5:2 A4:2 | D5:1 C5:1 A4:1 F4:1 | G4:3 R:1',
  chords: ['Fmaj7', 'Em7', 'Dm7', 'G7', 'Cmaj7', 'Am7', 'Dm7', 'G7'],
};

const NOTE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export function midiOf(n: string): number {
  const m = /^([A-G])(#|b)?(\d)$/.exec(n);
  if (!m) return 0;
  return 12 * (Number(m[3]) + 1) + NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}
const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

const CHORD: Record<string, number[]> = { '': [0, 4, 7], '7': [0, 4, 7, 10], m: [0, 3, 7], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10] };
export function chordNotes(name: string): { root: number; tones: number[] } {
  const m = /^([A-G])(#|b)?(.*)$/.exec(name)!;
  const root = 48 + NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return { root, tones: (CHORD[m[3]] ?? CHORD['']).map((s) => root + s) };
}

export interface ParsedSong { beat: number; bar: number; notes: { midi: number; at: number; dur: number }[]; chords: { root: number; tones: number[]; at: number }[]; length: number; bells: boolean }

export function parseSong(s: Song): ParsedSong {
  const notes: ParsedSong['notes'] = [];
  let at = 0;
  for (const tok of s.mel.replace(/\|/g, ' ').split(/\s+/).filter(Boolean)) {
    const [n, d] = tok.split(':');
    const dur = Number(d);
    if (n !== 'R') notes.push({ midi: midiOf(n), at, dur });
    at += dur;
  }
  const chords = s.chords.map((c, i) => ({ ...chordNotes(c), at: i * s.bar }));
  return { beat: s.beat, bar: s.bar, notes, chords, length: Math.max(at, s.chords.length * s.bar), bells: !!s.bells };
}

export const CAROLS = SONGS.map(parseSong);
export const ELEVATOR_SONG = parseSong(MUZAK);
export const CAROL_TITLES = SONGS.map((s) => s.name);

// ---------------------------------------------------------------- strumenti

function env(c: Ctx, out: AudioNode, t: number, peak: number, a: number, d: number): GainNode {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  g.connect(out);
  return g;
}
function osc(c: Ctx, type: OscillatorType, f: number, out: AudioNode, t: number, len: number): OscillatorNode {
  const o = c.createOscillator();
  o.type = type; o.frequency.value = f;
  o.connect(out); o.start(t); o.stop(t + len + 0.05);
  return o;
}

/** Celesta / carillon: fondamentale più armoniche che si spengono in fretta. */
function celesta(c: Ctx, out: AudioNode, t: number, midi: number, dur: number, peak: number): void {
  const f = hz(midi), len = Math.max(0.7, dur * 1.3);
  osc(c, 'sine', f, env(c, out, t, peak, 0.004, len), t, len);
  osc(c, 'sine', f * 2, env(c, out, t, peak * 0.35, 0.002, len * 0.5), t, len);
  osc(c, 'sine', f * 4.01, env(c, out, t, peak * 0.12, 0.001, 0.25), t, 0.3);
}

/** Pianoforte elettrico: tremolo leggero, attacco morbido. */
function rhodes(c: Ctx, out: AudioNode, t: number, midi: number, dur: number, peak: number): void {
  const f = hz(midi);
  const g = env(c, out, t, peak, 0.01, dur + 0.6);
  osc(c, 'sine', f, g, t, dur + 0.6);
  osc(c, 'triangle', f * 2.001, env(c, g, t, 0.18, 0.003, 0.4), t, 0.45);
}

function pad(c: Ctx, out: AudioNode, t: number, tones: number[], len: number, peak: number): void {
  for (const m of tones) {
    const f = hz(m + 12);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.18);
    g.gain.setValueAtTime(peak, t + len - 0.15);
    g.gain.linearRampToValueAtTime(0.0001, t + len + 0.1);
    g.connect(out);
    osc(c, 'triangle', f, g, t, len + 0.15);
  }
}

function bass(c: Ctx, out: AudioNode, t: number, midi: number, peak: number, len = 0.5): void {
  const f = hz(midi - 12);
  osc(c, 'sine', f, env(c, out, t, peak, 0.005, len), t, len);
  osc(c, 'triangle', f, env(c, out, t, peak * 0.4, 0.003, len * 0.4), t, len);
}

function noiseHit(c: Ctx, p: RecipeParams, out: AudioNode, t: number, peak: number, f: number, len: number): void {
  const s = c.createBufferSource();
  s.buffer = p.noise.white;
  const hp = c.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = f;
  s.connect(hp);
  hp.connect(env(c, out, t, peak, 0.002, len));
  s.start(t, p.rng.next() * 1.5);
  s.stop(t + len + 0.05);
}

// ---------------------------------------------------------------- sequenziatore

type Voice = 'carol' | 'muzak';

function sequencer(songs: ParsedSong[], voice: Voice, startIdx: number): (c: Ctx, out: AudioNode, p: RecipeParams) => LoopHandle {
  return (c, out, p) => {
    // timbro da altoparlante: banda stretta e un filo di saturazione
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = voice === 'carol' ? 220 : 160;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = voice === 'carol' ? 4200 : 3400;
    const bus = c.createGain(); bus.gain.value = 0.9;
    bus.connect(hp); hp.connect(lp); lp.connect(out);
    let song = startIdx % songs.length;
    let songStart = c.currentTime + 0.3;
    let ni = 0, ci = 0, beatI = 0;
    let rep = 0;
    const stopAt = { t: Infinity };
    return {
      stop(t) { stopAt.t = t; try { bus.gain.setValueAtTime(bus.gain.value, t); bus.gain.linearRampToValueAtTime(0.0001, t + 0.05); } catch { /* chiuso */ } },
      tick(t) {
        if (t >= stopAt.t) return;
        const ahead = t + 0.45;
        const s = songs[song];
        const B = s.beat;
        // melodia
        while (ni < s.notes.length && songStart + s.notes[ni].at * B < ahead) {
          const n = s.notes[ni++];
          const at = Math.max(t, songStart + n.at * B);
          if (voice === 'carol') celesta(c, bus, at, n.midi + (rep % 2 ? 12 : 0), n.dur * B, 0.16);
          else rhodes(c, bus, at, n.midi + (rep % 2 ? 12 : 0), n.dur * B, 0.13);
        }
        // accordi e basso
        while (ci < s.chords.length && songStart + s.chords[ci].at * B < ahead) {
          const ch = s.chords[ci++];
          const at = Math.max(t, songStart + ch.at * B);
          pad(c, bus, at, ch.tones, s.bar * B, voice === 'carol' ? 0.022 : 0.03);
          bass(c, bus, at, ch.root, 0.2, voice === 'carol' ? 0.45 : 0.55);
          if (voice === 'muzak') bass(c, bus, at + 1.5 * B, ch.root + 7, 0.14, 0.4);
          else if (s.bar >= 4) bass(c, bus, at + 2 * B, ch.root + 7, 0.14, 0.4);
          else if (s.bar === 6) bass(c, bus, at + 3 * B, ch.root + 7, 0.12, 0.4);
        }
        // percussioni leggere
        while (songStart + beatI * B * (voice === 'muzak' ? 0.5 : 1) < ahead && beatI * (voice === 'muzak' ? 0.5 : 1) < s.length) {
          const at = Math.max(t, songStart + beatI * B * (voice === 'muzak' ? 0.5 : 1));
          if (voice === 'muzak') noiseHit(c, p, bus, at, beatI % 2 ? 0.018 : 0.03, 7000, 0.05);
          else if (s.bells) noiseHit(c, p, bus, at, 0.035, 6500, 0.12);
          beatI++;
        }
        // fine del brano: piccola pausa e il successivo
        if (ni >= s.notes.length && ci >= s.chords.length && songStart + s.length * B + (voice === 'carol' ? 3.5 : 0) < ahead) {
          songStart += s.length * B + (voice === 'carol' ? 3.5 : 0);
          ni = 0; ci = 0; beatI = 0;
          if (voice === 'carol') song = (song + 1) % songs.length; else rep++;
        }
      },
    };
  };
}

export const xmasMusic = (c: Ctx, out: AudioNode, p: RecipeParams): LoopHandle => sequencer(CAROLS, 'carol', p.rng.int(0, CAROLS.length - 1))(c, out, p);
export const elevatorMusic = (c: Ctx, out: AudioNode, p: RecipeParams): LoopHandle => sequencer([ELEVATOR_SONG], 'muzak', 0)(c, out, p);
