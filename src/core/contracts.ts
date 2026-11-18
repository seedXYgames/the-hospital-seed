// Tipi condivisi di The Hospital Seed. Nessuna dipendenza da Babylon o dal DOM.

/** Entra nella chiave degli stream casuali: cambiarlo cambia le notti generate. */
export const GENERATOR_VERSION = 1;

export const SEED_MIN = 0;
export const SEED_MAX = 1_000_000;

export type Lang = 'it' | 'en';
export type L10n = Record<Lang, string>;

export type StreamName =
  | 'layout' | 'patients' | 'staff' | 'decor' | 'tasks' | 'power' | 'music' | 'weather' | 'names' | 'anomaly'
  | 'cctv' | 'ui' | 'audio';

export interface Vec2 { x: number; z: number }
export interface Vec3 { x: number; y: number; z: number }

export interface GraphicsSettings {
  brightness: number; // 0.8..1.25 calibrazione display
  quality: 'low' | 'medium' | 'high';
  renderScale: number; // 0.5..1
  shadows: boolean;
  antialias: boolean;
  drawDistance: number; // metri
  fogEffects: boolean;
}

export interface Settings { lang: Lang; gfx: GraphicsSettings }

export const DEFAULT_SETTINGS: Settings = {
  lang: 'it',
  gfx: { brightness: 1, quality: 'high', renderScale: 1, shadows: true, antialias: true, drawDistance: 700, fogEffects: true },
};
