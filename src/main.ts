// Punto d'ingresso: collega interfaccia, turno, rendering, audio e input.
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import '@babylonjs/core/Rendering/renderingManager';
import './render/shaders';
import { AudioEngine } from './audio/engine';
import { NeuralTts } from './audio/neuralTts';
import { Tts } from './audio/tts';
import type { LoopKind, SoundKind, Surface, UiCallbacks } from './core/api';
import type { L10n, Settings } from './core/contracts';
import { clamp } from './core/rng';
import { shareUrl } from './core/seed';
import { ACHIEVEMENTS, loadProgress, recordOf, recordShift, saveProgress } from './game/achievements';
import { EYE, Shift, fmtClock, type Focus } from './game/shift';
import { ITEM_NAME } from './game/texts';
import { t } from './i18n/strings';
import { HospitalRenderer } from './render/hospitalRenderer';
import { ELEV, FLOORS, FLOOR_NAME, FLOOR_SHORT, MAP_KINDS, SPAWN, TERM_SCREEN, roomById } from './world/hospital';
import { ghostNote } from './game/horror';
import { GUARD } from './world/names';
import { loadSettings } from './ui/settingsStore';
import { Ui, type Dossier, type MapView, type PhoneView, type TerminalView } from './ui/ui';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const root = document.getElementById('ui-root') as HTMLElement;
const engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: false, powerPreference: 'high-performance' }, false);
let settings: Settings = loadSettings();
const audio = new AudioEngine();
// la voce del narratore: neurale e offline (Piper), con la voce del browser come riserva
const tts = new NeuralTts(new Tts(), () => audio.voiceOutput());
let flash = 0, lastMood = 0;

interface View { scene: Scene; camera: UniversalCamera; shift: Shift; r: HospitalRenderer }
let view: View | null = null;
let mode: 'boot' | 'menu' | 'game' | 'summary' = 'boot';
let paused = false;
let yaw = 0, pitch = 0;
const keys = new Set<string>();
let focus: Focus | null = null;
let wantLock = false;
let frame = 0;
let menuAngle = 0;
let devTimeScale = 1;
const loopIds = new Set<string>();
let lastPhone = 0;

const L = () => settings.lang;
const tx = (l: L10n) => l[L()];

for (const ev of ['pointerdown', 'keydown'] as const) window.addEventListener(ev, () => void audio.resume(), { capture: true, once: false });

function buildView(seed: number): View {
  const scene = new Scene(engine);
  scene.skipPointerMovePicking = true;
  const camera = new UniversalCamera('cam', new Vector3(SPAWN.x, EYE, SPAWN.z), scene);
  camera.minZ = 0.05; camera.maxZ = 900; camera.fov = 1.12;
  camera.inputs.clear();
  scene.activeCamera = camera;
  const shift = new Shift(seed, L());
  const r = new HospitalRenderer(scene, shift, camera, L());
  return { scene, camera, shift, r };
}

function disposeView(): void {
  if (!view) return;
  for (const id of loopIds) audio.setLoop(id, null);
  loopIds.clear();
  view.r.dispose();
  view.scene.dispose();
  view = null;
}

function later(fn: () => void) { requestAnimationFrame(() => setTimeout(fn, 30)); }

function showMenu(): void {
  mode = 'boot';
  tts.cancel();
  ui.show('loading'); ui.setLoadingProgress(0.3);
  if (document.pointerLockElement) document.exitPointerLock();
  later(() => {
    disposeView();
    view = buildView(Math.floor(Math.random() * 1_000_001));
    menuAngle = 0;
    ui.setLoadingProgress(1);
    mode = 'menu';
    ui.show('menu');
    audio.setAmbient({ wind: 0.35, rain: 0.1, insects: 0, frogs: 0, birds: 0, water: 0, leaves: 0, human: 0, room: 0, hush: 0 });
    audio.setLoop('menu-music', 'xmas_music', undefined, 0.35); loopIds.add('menu-music');
  });
}

function startGame(seed: number): void {
  mode = 'boot';
  ui.show('loading'); ui.setLoadingProgress(0.2);
  void audio.resume();
  later(() => {
    disposeView();
    ui.setLoadingProgress(0.6);
    later(() => {
      view = buildView(seed);
      tts.preload(L());
      yaw = view.shift.player.yaw; pitch = 0.15;
      paused = false; mode = 'game';
      ui.setPauseInfo(seed);
      ui.show('game');
      ui.setHints(['hint.move', 'hint.run', 'hint.interact', 'hint.torch', 'hint.phone', 'hint.map', 'hint.pause'].map((k) => t(L(), k)));
      ui.notify(t(L(), 'hud.unread', { n: view.shift.unread() }));
      lockPointer();
      if (import.meta.env.DEV) exposeDev();
    });
  });
}

function lockPointer(): void {
  wantLock = true;
  try { const p = canvas.requestPointerLock() as unknown; if (p && typeof (p as Promise<void>).catch === 'function') (p as Promise<void>).catch(() => {}); } catch { /* serve un gesto */ }
}
function unlockPointer(): void { wantLock = false; if (document.pointerLockElement) document.exitPointerLock(); }

const callbacks: UiCallbacks & { onMapFloor(f: number): void; onTerminal(a: string): void; onReport(id: string): void } = {
  onStartGame: (seed) => startGame(seed),
  onSettingsChanged: (s) => { settings = s; if (view) { view.shift.lang = s.lang; view.r.relabel(s.lang); } },
  onResume: () => { paused = false; ui.show('game'); if (!view?.shift.cctv.active) lockPointer(); void audio.resume(); },
  onAbandon: () => { view?.shift.finish('abandoned'); tts.cancel(); showMenu(); },
  onReport: (id: string) => { view?.shift.report(id); refreshPhone(true); },
  onBackToMenu: () => showMenu(),
  onExit: () => audio.suspend(),
  onExitCancelled: () => void audio.resume(),
  onPhoneClosed: () => { if (mode === 'game' && !paused) lockPointer(); },
  onUiSound: (kind) => audio.playOneShot(kind, { gain: 0.45 }),
  onMapFloor: () => refreshPhone(true),
  onTerminal: (a) => {
    if (!view) return;
    const s = view.shift;
    if (a === 'cctv') { s.enterCctv(); ui.closeTerminal(); }
    else if (a === 'stand') standUp();
    else if (a.startsWith('ack:')) {
      const [pid, kind] = a.slice(4).split('|');
      const o = s.obj(`callbtn-${pid}-${kind}`);
      const act = o ? s.actionFor(o) : null;
      if (o && act) s.interact({ obj: o, action: act.action, params: act.params ?? {}, dist: 1 });
    }
  },
};
const ui = new Ui(root, callbacks, settings);

// ---------------------------------------------------------------- telefono

function phoneView(s: Shift): PhoneView {
  const lang = L();
  const tasks = s.tasks.filter((x) => !x.missed || x.done !== null).map((x) => ({
    id: x.id, title: tx(x.title), place: tx(x.place), due: fmtClock(x.due), done: x.done === null ? null : fmtClock(x.done), late: x.done === null && s.minute > x.due,
    report: x.report ? tx(x.report) : null, reported: x.reported !== false,
  }));
  const patients = s.h.patients.map((p) => {
    const c = s.calls[p.id];
    return {
      name: `${p.first} ${p.last}`, room: p.roomNumber, floor: tx(FLOOR_NAME[p.f]), age: t(lang, 'phone.age', { n: p.age }),
      reason: t(lang, 'phone.reason', { r: tx(p.reason) }).replace('{o}', p.sex === 'm' ? 'o' : 'a'), story: tx(p.story),
      call: (c.urgent !== 'off' ? 'urgent' : c.assist !== 'off' ? 'assist' : 'off') as 'off' | 'assist' | 'urgent',
    };
  });
  return {
    clock: s.clock(),
    messages: s.messages.map((m) => ({ id: m.id, from: tx(m.from), text: tx(m.text), at: fmtClock(m.at), read: m.read })),
    tasks, patients, map: mapView(s),
  };
}

function mapView(s: Shift): MapView {
  const f = ui.mapFloorShown(s.player.f);
  const rooms = s.h.rooms.filter((r) => r.f === f && MAP_KINDS.has(r.kind)).map((r) => ({ x0: r.x0, x1: r.x1, z0: r.z0, z1: r.z1, label: r.number ? String(r.number) : tx(r.name), kind: r.kind, locked: r.locked }));
  const targets: MapView['targets'] = [];
  s.activeTasks().forEach((task, i) => {
    for (const p of taskTargets(s, task)) if (p.f === f) targets.push({ x: p.x, z: p.z, n: i + 1 });
  });
  const marks: MapView['marks'] = [{ x: ELEV.cx, z: -3, kind: 'elev' }, { x: -4.5, z: -6, kind: 'stairs' }];
  if (f === 20) marks.push({ x: -3, z: 6, kind: 'desk' });
  const br = s.obj('breaker-main');
  if (br && br.f === f) marks.push({ x: br.x, z: br.z, kind: 'panel' });
  return {
    floor: s.player.f, floors: FLOORS.map((id) => ({ id, label: FLOOR_SHORT[id] })),
    rooms, corridors: s.h.corridors.filter((c) => c.f === f), player: { x: s.player.x, z: s.player.z, yaw: s.player.yaw }, targets, marks,
  };
}

function taskTargets(s: Shift, task: Shift['tasks'][number]): { f: number; x: number; z: number }[] {
  const h = s.h;
  const o = (id: string) => { const x = s.obj(id); return x ? [{ f: x.f, x: x.x, z: x.z }] : []; };
  switch (task.kind) {
    case 'assist': case 'urgent': case 'relay': {
      const p = h.patients.find((x) => x.id === task.patient);
      const out = p ? [{ f: p.f, x: p.x, z: p.z }] : [];
      // anche dove si prende l'oggetto richiesto, finché non lo hai in mano
      if (task.kind === 'assist' && task.known && s.carried !== task.item) {
        const src = task.item === 'blanket' ? h.sources.linen[0] : h.sources.water[0];
        const so = src ? s.obj(task.item === 'tea' ? h.sources.kettle[0] : src) : undefined;
        if (so) out.push({ f: so.f, x: so.x, z: so.z });
      }
      return out;
    }
    case 'power': return o('breaker-main');
    case 'patrol': return (h.checkpoints[task.floor ?? 0] ?? []).filter((id) => !task.stamps?.includes(id)).flatMap(o);
    case 'window': { const w = h.windows.find((x) => x.id === task.target); return w ? [{ f: w.f, ...((p) => ({ x: p.x, z: p.z }))(s.winPos(w)) }] : []; }
    case 'camera': return o(`cambox-${task.target}`);
    case 'midnight': return h.patients.filter((p) => !task.stamps?.includes(p.id)).map((p) => ({ f: p.f, x: p.x, z: p.z }));
    case 'handover': return o('logbook');
    case 'fall': { const pt = s.obj(`obj-${task.patient}`); return pt ? [{ f: pt.f, x: pt.x, z: pt.z }] : []; }
    case 'phantom': { const r = roomById(h, task.target ?? ''); return r ? [{ f: r.f, x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 }] : []; }
    default: return [];
  }
}

function refreshPhone(force = false): void {
  if (!view || !ui.isPhoneOpen()) return;
  const now = performance.now();
  if (!force && now - lastPhone < 350) return;
  lastPhone = now;
  if (ui.currentTab() === 'messages') view.shift.markAllRead();
  ui.updatePhone(phoneView(view.shift));
}

function openPhone(tab?: 'messages' | 'tasks' | 'patients' | 'map'): void {
  if (!view) return;
  unlockPointer();
  ui.resetMapFloor();
  ui.openPhone(tab);
  refreshPhone(true);
}

// ---------------------------------------------------------------- input

function standUp(): void {
  if (!view) return;
  view.shift.stand();
  ui.closeTerminal();
  lockPointer();
}

function terminalView(s: Shift): TerminalView {
  const lang = L();
  const W: Record<string, L10n> = { snow: { it: 'neve', en: 'snow' }, rain: { it: 'pioggia', en: 'rain' }, sleet: { it: 'nevischio', en: 'sleet' } };
  const e = s.elevator;
  const lf = Math.round(e.y / 3.6) + 20;
  const liftState = !s.power.main ? t(lang, 'term.lift.nopower') : e.phase === 'stalled' || e.phase === 'rescue' ? t(lang, 'term.lift.stalled') : e.phase === 'moving' ? t(lang, 'term.lift.moving') : t(lang, 'term.lift.idle');
  return {
    clock: s.clock(), weather: `${tx(W[s.weather.kind])} · ${s.weather.kind === 'rain' ? '3' : '-2'} °C`,
    power: [{ label: t(lang, 'term.main'), on: s.power.main }, ...FLOORS.map((f) => ({ label: tx(FLOOR_NAME[f]), on: s.power.fl[f] }))],
    lift: `${e.phase === 'moving' ? (e.dir > 0 ? '▲ ' : '▼ ') : ''}${lf}°  ·  ${liftState}`,
    calls: s.h.patients.map((p) => ({ id: p.id, room: p.roomNumber, name: `${p.first} ${p.last}`, assist: s.calls[p.id].assist, urgent: s.calls[p.id].urgent })),
    tasks: s.activeTasks().map((x) => ({ title: tx(x.title), place: tx(x.place), due: fmtClock(x.due), late: s.minute > x.due })),
    patients: s.h.patients.map((p) => {
      const c = s.calls[p.id];
      return {
        id: p.id, name: `${p.first} ${p.last}`, room: p.roomNumber, floor: tx(FLOOR_NAME[p.f]), age: p.age, sex: p.sex,
        born: `${String(p.born.d).padStart(2, '0')}/${String(p.born.m).padStart(2, '0')}/${p.born.y}`,
        reason: tx(p.reason), character: tx(p.character), curiosities: p.curiosities.map(tx), story: tx(p.story), face: p.face,
        call: (c.urgent !== 'off' ? 'urgent' : c.assist !== 'off' ? 'assist' : 'off') as Dossier['call'], callBlink: c.urgent === 'blink' || c.assist === 'blink',
        dead: s.ghost.revealed && s.ghost.pid === p.id ? tx(ghostNote(p)) : undefined,
        where: ((st) => st === 'fallen' ? (lang === 'it' ? 'A TERRA' : 'ON THE FLOOR') : st === 'bath' ? (lang === 'it' ? 'in bagno' : 'in the toilet') : st === 'bed' ? undefined : (lang === 'it' ? 'nel corridoio' : 'in the corridor'))(s.mover.state(p.id)),
      };
    }),
    log: s.chronicle.filter((c) => c.seen).slice(-40).reverse().map((c) => ({ time: fmtClock(c.minute), place: tx(c.place), text: tx(c.text) })),
  };
}

function doInteract(): void {
  if (!view || mode !== 'game' || paused || ui.isPhoneOpen()) return;
  const s = view.shift;
  if (s.cctv.active) return;
  if (focus) {
    s.interact(focus);
    if (s.cctv.active) unlockPointer();
    if (s.seated && !ui.isTerminalOpen()) { unlockPointer(); yaw = Math.PI; pitch = 0.1; ui.openTerminal(); ui.updateTerminal(terminalView(s)); ui.setHints([t(L(), 'hint.sit')]); }
  }
}

window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (mode !== 'game' || !view || e.repeat || paused) return;
  const s = view.shift;
  if (ui.isPhoneOpen()) return;
  if (s.cctv.active) {
    if (e.key === 'Escape' || e.code === 'Backspace' || e.code === 'KeyE') {
      e.preventDefault(); s.exitCctv();
      if (s.seated) { ui.openTerminal(); ui.updateTerminal(terminalView(s)); } else lockPointer();
    }
    else if (e.code === 'KeyQ' || e.code === 'PageUp') s.cctvStep(-1);
    else if (e.code === 'Tab' || e.code === 'PageDown' || e.code === 'KeyR') { e.preventDefault(); s.cctvStep(1); }
    else if (/^Digit\d$/.test(e.code)) { const n = Number(e.code.slice(5)); s.cctvSelect(n === 0 ? 10 : n); }
    return;
  }
  if (s.seated) {
    if (e.key === 'Escape' || e.code === 'Space') { e.preventDefault(); standUp(); }
    else if (e.code === 'KeyC') { s.enterCctv(); ui.closeTerminal(); }
    else if (/^Digit[123]$/.test(e.code)) ui.terminalTab(Number(e.code.slice(5)) - 1);
    else if (e.code === 'KeyE') doInteract();
    else if (e.code === 'KeyT') openPhone();
    return;
  }
  switch (e.code) {
    case 'KeyE': doInteract(); break;
    case 'KeyF': if (s.toggleTorch()) audio.playOneShot('torch_click', { gain: 0.4 }); break;
    case 'KeyR': s.swapBatteries(); break;
    case 'KeyT': openPhone(); break;
    case 'KeyM': ui.setMinimap(!ui.isMinimapOn()); break;
    default: break;
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());
canvas.addEventListener('mousedown', (e) => {
  if (mode !== 'game' || paused || ui.isPhoneOpen() || view?.shift.cctv.active) return;
  void audio.resume();
  if (view?.shift.seated) return;
  if (document.pointerLockElement !== canvas) { lockPointer(); return; }
  if (e.button === 0) doInteract();
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('mousemove', (e) => {
  if (mode === 'game' && view?.shift.cctv.active && !paused && e.buttons) { view.shift.aimCam(e.movementX * 0.003, -e.movementY * 0.003); return; }
  // seduto alla postazione: si guarda intorno trascinando sulla scena
  if (mode === 'game' && view?.shift.seated && !paused && e.buttons && e.target === canvas) { yaw += e.movementX * 0.003; pitch = clamp(pitch + e.movementY * 0.003, -1.2, 1.2); return; }
  if (mode !== 'game' || document.pointerLockElement !== canvas) return;
  yaw += e.movementX * 0.0022;
  pitch = clamp(pitch + e.movementY * 0.0022, -1.45, 1.45);
});
document.addEventListener('pointerlockchange', () => {
  if (mode !== 'game' || !view) return;
  if (document.pointerLockElement === canvas) return;
  if (wantLock && !ui.isPhoneOpen() && !view.shift.ended && !view.shift.cctv.active) { paused = true; wantLock = false; ui.show('pause'); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden && mode === 'game' && !paused && view && !ui.isPhoneOpen()) { paused = true; unlockPointer(); ui.show('pause'); } });
window.addEventListener('resize', () => engine.resize());

// ---------------------------------------------------------------- ciclo

function gameFrame(v: View, dt: number): void {
  const s = v.shift;
  if (!paused) {
    const active = document.activeElement;
    const typing = active instanceof HTMLElement && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
    const can = !typing && !s.seated && (ui.isPhoneOpen() || document.pointerLockElement === canvas);
    const k = (a: string, b: string) => (keys.has(a) || keys.has(b) ? 1 : 0);
    const input = {
      forward: can ? k('KeyW', 'ArrowUp') - k('KeyS', 'ArrowDown') : 0,
      strafe: can ? k('KeyD', 'ArrowRight') - k('KeyA', 'ArrowLeft') : 0,
      run: keys.has('ShiftLeft') || keys.has('ShiftRight'), yaw, pitch,
    };
    for (let i = 0; i < devTimeScale; i++) s.update(dt, input);
    // telecamera: si gira con WASD o le frecce, finché il supporto lo permette
    if (s.cctv.active) {
      const k2 = (a: string, b: string) => (keys.has(a) || keys.has(b) ? 1 : 0);
      const ay = k2('KeyD', 'ArrowRight') - k2('KeyA', 'ArrowLeft'), ap = k2('KeyS', 'ArrowDown') - k2('KeyW', 'ArrowUp');
      if (ay || ap) s.aimCam(ay * dt * 0.8, -ap * dt * 0.6);
    }
  }
  flash = Math.max(0, flash - dt * 1.8);
  ui.setDread(s.ended ? 0 : s.dread(), flash);
  const p = s.player;
  const bob = Math.sin(p.meters * 4.2) * 0.025;
  // seduti ci si avvicina allo schermo: il campo visivo si stringe sul monitor
  const wantFov = s.seated && !s.cctv.active ? 0.52 : 1.12;
  v.camera.fov += (wantFov - v.camera.fov) * Math.min(1, dt * 5);
  v.camera.position.set(p.x, p.y + s.eye() + (s.seated ? 0 : bob), p.z);
  v.camera.rotation.set(pitch, yaw, 0);
  const look = v.camera.getDirection(Vector3.Forward());
  v.r.sync(dt, v.camera.position, look, settings.gfx.brightness);

  // cosa sto guardando
  if (frame % 3 === 0) {
    focus = paused || ui.isPhoneOpen() || ui.isTerminalOpen() ? null : s.focus({ x: v.camera.position.x, y: v.camera.position.y, z: v.camera.position.z }, { x: look.x, y: look.y, z: look.z });
    ui.setPrompt(focus ? `[E]  ${t(L(), `action.${focus.action}`, focus.params)}` : null);
  }
  // HUD
  if (frame % 5 === 0) {
    const room = s.inCab() ? null : roomById(s.h, s.roomOf(p.f, p.x, p.z)?.id ?? '');
    const where = s.inCab() ? (L() === 'it' ? 'Ascensore' : 'Lift') : `${tx(FLOOR_NAME[p.f])}${room ? ` · ${tx(room.name)}` : ''}`;
    ui.setStatus(s.clock(), where, s.carried ? tx(ITEM_NAME[s.carried]) : null, s.unread());
    if (s.cctv.active) {
      const c = s.cam();
      ui.setCctv({ n: c.n, total: s.h.cams.length, label: tx(c.label), clock: `${s.clock()}:${String(Math.floor((s.minute % 1) * 60)).padStart(2, '0')}`, ir: s.camDark(c), noSignal: s.camOffline.has(c.id), list: s.h.cams.map((x) => ({ n: x.n, label: tx(x.label), off: s.camOffline.has(x.id) })) });
    } else ui.setCctv(null);
  }
  // audio
  audio.setListener({ x: p.x, y: p.y + EYE, z: p.z }, { x: Math.sin(yaw), y: 0, z: Math.cos(yaw) });
  if (frame % 6 === 0) {
    audio.setAmbient(s.ambience());
    const mood = s.mood();
    ui.setMystery(s.ended ? { active: false, intensity: 0, watched: false } : mood);
    // un lampo di disturbo quando qualcosa di strano si fa vicino
    if (mood.active && mood.intensity - lastMood > 0.25) flash = 1;
    lastMood = mood.active ? mood.intensity : 0;
    ui.setTorch(s.torchCharge, s.torch, s.spares);
    audio.setDistortion(clamp(s.events.radioWarp * 0.5, 0, 1));
    const seen = new Set<string>();
    if (!paused) for (const l of s.loops()) { seen.add(l.id); loopIds.add(l.id); audio.setLoop(l.id, l.kind as LoopKind, l.pos, l.gain); }
    for (const id of [...loopIds]) if (!seen.has(id)) { audio.setLoop(id, null); loopIds.delete(id); }
  }
  const out = s.drain();
  for (const sd of out.sounds) audio.playOneShot(sd.kind as SoundKind, { pos: sd.pos, gain: sd.gain });
  for (const st of out.steps) audio.footstep(st.surface as Surface, st.running);
  for (const n of out.notices) ui.notify(tx(n));
  for (const line of out.lines) {
    ui.setSubtitle(tx(line.text), tx(line.speaker));
    if (line.tts) tts.speak(tx(line.text), L(), { rate: 0.96, pitch: 0.92 });
  }
  if (out.newMessages) ui.notify(`✉ ${tx(s.messages[s.messages.length - 1].from)}: ${tx(s.messages[s.messages.length - 1].text).slice(0, 70)}${tx(s.messages[s.messages.length - 1].text).length > 70 ? '…' : ''}`);
  refreshPhone();
  if (s.seated && !s.cctv.active && !ui.isTerminalOpen()) { ui.openTerminal(); ui.updateTerminal(terminalView(s)); }
  if (s.cctv.active && ui.isTerminalOpen()) ui.closeTerminal();
  if (!s.seated && ui.isTerminalOpen()) ui.closeTerminal();
  if (s.seated && !s.cctv.active && frame % 20 === 0) ui.updateTerminal(terminalView(s));
  if (ui.isMinimapOn() && frame % 4 === 0 && !s.cctv.active) ui.drawMinimap(mapView(s));
  if (ui.isTerminalOpen()) ui.placeTerminal(terminalMatrix(v));

  if (s.ended && mode === 'game') {
    mode = 'summary';
    unlockPointer();
    ui.closePhone(); ui.setPrompt(null); ui.setCctv(null); tts.cancel(); ui.setDread(0, 0);
    let fresh: string[] = [];
    try { const prog = loadProgress(); fresh = recordShift(recordOf(s), prog); saveProgress(prog); } catch { /* niente memoria */ }
    const sum = s.summary();
    ui.showSummary({
      seed: sum.seed, guard: `${GUARD.first} ${GUARD.last}`, reason: sum.reason as 'handover', durationSeconds: sum.durationSeconds,
      done: sum.done, late: sum.late, missed: sum.missed,
      tasks: sum.tasks.map((r) => ({ title: tx(r.title), place: tx(r.place), issued: r.issued, done: r.done, late: r.late })),
      patients: sum.patients.map((pt) => ({ name: `${pt.first} ${pt.last}`, room: pt.roomNumber, age: pt.age, story: tx(pt.story) })),
      chronicle: sum.chronicle.map((c) => ({ time: c.time, place: tx(c.place), text: tx(c.text), seen: c.seen, strange: c.strange })),
      shareUrl: shareUrl(location.href, s.seed), achievements: fresh.filter((id) => ACHIEVEMENTS.some((a) => a.id === id)),
    });
    for (const id of [...loopIds]) { audio.setLoop(id, null); loopIds.delete(id); }
  }
}

/** Proietta lo schermo 3D del terminale sulla finestra e restituisce la matrice CSS che ci adagia sopra il DOM. */
function terminalMatrix(v: View): string | null {
  const w = engine.getRenderWidth(), h = engine.getRenderHeight();
  const cw = canvas.clientWidth || w, ch = canvas.clientHeight || h;
  const vm = v.scene.getTransformMatrix();
  const vp = v.camera.viewport.toGlobal(w, h);
  const S = TERM_SCREEN;
  const corners = [[S.x1, S.y1], [S.x0, S.y1], [S.x0, S.y0], [S.x1, S.y0]].map(([x, y]) => {
    const q = Vector3.Project(new Vector3(x, y, S.z), Matrix.IdentityReadOnly, vm, vp);
    return { x: (q.x * cw) / w, y: (q.y * ch) / h, z: q.z };
  });
  if (corners.some((c) => c.z < 0 || c.z > 1 || !Number.isFinite(c.x))) return null;
  return quadMatrix(960, 600, corners);
}

/** Omografia dal rettangolo w×h al quadrilatero dato, come matrix3d CSS. */
function quadMatrix(w: number, h: number, d: { x: number; y: number }[]): string | null {
  const src = [[0, 0], [w, 0], [w, h], [0, h]];
  const A: number[][] = [], bv: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], X = d[i].x, Y = d[i].y;
    A.push([x, y, 1, 0, 0, 0, -X * x, -X * y]); bv.push(X);
    A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y]); bv.push(Y);
  }
  // eliminazione di Gauss con pivot parziale
  for (let c = 0; c < 8; c++) {
    let piv = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    if (Math.abs(A[piv][c]) < 1e-9) return null;
    [A[c], A[piv]] = [A[piv], A[c]]; [bv[c], bv[piv]] = [bv[piv], bv[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      bv[r] -= f * bv[c];
    }
  }
  const hh = bv.map((x, i) => x / A[i][i]);
  const m = [hh[0], hh[3], 0, hh[6], hh[1], hh[4], 0, hh[7], 0, 0, 1, 0, hh[2], hh[5], 0, 1];
  return `matrix3d(${m.map((x) => x.toFixed(8)).join(',')})`;
}

function menuFrame(v: View, dt: number): void {
  menuAngle += dt * 0.03;
  const sw = Math.sin(menuAngle);
  // il tetto con la bandiera in primo piano, la città nella foschia laggiù
  v.camera.position.set(-9 + sw * 2, 16.5 + Math.sin(menuAngle * 0.7) * 0.8, -19 + sw * 1.5);
  v.camera.setTarget(new Vector3(11, 6, 6));
  v.r.sync(dt, v.camera.position, v.camera.getDirection(Vector3.Forward()), settings.gfx.brightness);
}

let last = performance.now();
engine.runRenderLoop(() => {
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  frame++;
  if (!view || mode === 'boot') return;
  if (mode === 'menu' && ui.current() === 'intro') return;
  if (mode === 'menu') menuFrame(view, dt);
  else if (mode === 'game') gameFrame(view, dt);
  view.scene.render();
});

function exposeDev(): void {
  (window as unknown as Record<string, unknown>).__ths = {
    get shift() { return view?.shift; },
    get view() { return view; },
    setTimeScale: (n: number) => { devTimeScale = Math.max(1, Math.min(60, Math.round(n))); },
    look: (y: number, p: number) => { yaw = y; pitch = p; },
    teleport: (x: number, z: number, y = 0) => { if (view) { const pl = view.shift.player; pl.x = x; pl.z = z; pl.y = y; } },
    skip: (minutes: number) => { if (view) view.shift.minute += minutes; },
    event: (k: string) => view?.shift.devEvent(k),
  };
}

showMenu();
