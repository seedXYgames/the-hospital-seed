// Interfacce tra moduli: audio, interfaccia, schermate.
import type { Lang, Settings } from './contracts';

// ---------------------------------------------------------------- audio

export interface SoundscapeLevels {
  wind: number; rain: number; insects: number; frogs: number; birds: number;
  water: number; leaves: number; human: number; room: number;
  hush: number;
}

/** Suoni puntuali. I primi vengono da The Dark Seed, gli altri sono dell'ospedale. */
export type SoundKind =
  | 'door_open' | 'door_close' | 'door_locked' | 'door_bang' | 'switch' | 'generator_start' | 'generator_stop'
  | 'drawer' | 'tent_zip' | 'breaker' | 'metal_clank' | 'bin_tip' | 'twig' | 'owl' | 'fox' | 'deer' | 'crows'
  | 'frog' | 'splash' | 'vehicle_pass' | 'vehicle_start' | 'car_door' | 'typing' | 'paper' | 'camera' | 'sms'
  | 'battery' | 'click' | 'steps_far' | 'voice_far' | 'knock' | 'hum_anom' | 'whisper_anom' | 'tone_anom'
  | 'thunder' | 'branch_fall' | 'fire_douse' | 'ui' | 'torch_click' | 'rustle' | 'chair_scrape' | 'report_sent' | 'screech' | 'nightbird'
  | 'alien_call' | 'bigfoot_growl' | 'cult_chant' | 'mimic_step' | 'radio'
  | 'elev_ding' | 'elev_door' | 'elev_stop' | 'power_down' | 'power_up' | 'call_buzz' | 'call_urgent' | 'beep'
  | 'pour' | 'cloth' | 'kettle' | 'window_bang' | 'window_close' | 'vending' | 'keys' | 'slide_door';

export type LoopKind =
  | 'generator' | 'water' | 'fire' | 'lamp_buzz' | 'anom_drone' | 'engine_idle' | 'mystery_music' | 'breath_calm' | 'breath_fast'
  | 'xmas_music' | 'elev_music' | 'elev_motor' | 'phone_ring' | 'call_loop' | 'wind_gap' | 'monitor_beep' | 'heartbeat' | 'music_box';

export type Surface = 'grass' | 'dirt' | 'road' | 'wood' | 'snow' | 'floor' | 'wet';

export interface Vec3Like { x: number; y: number; z: number }

export interface IAudioEngine {
  resume(): Promise<void>;
  suspend(): void;
  setMuted(muted: boolean): void;
  setListener(pos: Vec3Like, forward: Vec3Like): void;
  setAmbient(levels: SoundscapeLevels): void;
  playOneShot(kind: SoundKind, opts?: { pos?: Vec3Like; gain?: number; pitch?: number }): void;
  setLoop(id: string, kind: LoopKind | null, pos?: Vec3Like, gain?: number): void;
  footstep(surface: Surface, running: boolean): void;
  setDistortion(amount: number): void;
  dispose(): void;
}

export interface TtsStatus { supported: boolean; voice: Record<Lang, string | null>; local: Record<Lang, boolean> }
export interface ITts {
  status(): TtsStatus;
  speak(text: string, lang: Lang, style?: { rate?: number; pitch?: number; interrupt?: boolean }): boolean;
  cancel(): void;
  setEnabled(on: boolean): void;
}

// ---------------------------------------------------------------- interfaccia

export interface SummaryView {
  seed: number;
  guard: string;
  reason: 'handover' | 'timeout' | 'abandoned';
  durationSeconds: number;
  done: number;
  late: number;
  missed: number;
  tasks: { title: string; place: string; issued: string; done: string | null; late: boolean }[];
  patients: { name: string; room: number; age: number; story: string }[];
  chronicle: { time: string; place: string; text: string; seen: boolean; strange: boolean }[];
  shareUrl: string;
  achievements?: string[];
}

export interface UiCallbacks {
  onStartGame(seed: number): void;
  onSettingsChanged(settings: Settings): void;
  onResume(): void;
  onAbandon(): void;
  onBackToMenu(): void;
  onExit?(): void;
  onExitCancelled?(): void;
  onPhoneClosed(): void;
  onUiSound(kind: 'ui' | 'typing' | 'paper'): void;
}

export type ScreenId = 'loading' | 'menu' | 'settings' | 'intro' | 'game' | 'pause' | 'summary' | 'achievements';
export type PhoneTab = 'messages' | 'tasks' | 'patients' | 'map';
