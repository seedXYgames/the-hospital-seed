// Interfaccia DOM di The Hospital Seed: schermate, HUD, telefono, videosorveglianza. Mai il pointer lock.
import './ui.css';
import './hospital.css';
import type { PhoneTab, ScreenId, SummaryView, UiCallbacks } from '../core/api';
import type { Lang, Settings } from '../core/contracts';
import { t } from '../i18n/strings';
import { ScreenEffects, type ScreenEffectKind } from './effects';
import { Screens, applyI18n, el, i18n, i18nAria } from './screens';
import { sanitizeSettings, saveSettings } from './settingsStore';

const NOTICE_MS = 4200, NOTICE_MAX = 3, SUBTITLE_MS = 7500, HINTS_MS = 14000;
const SCREEN_IDS: readonly ScreenId[] = ['loading', 'menu', 'settings', 'intro', 'game', 'pause', 'summary', 'achievements'];

export interface PhoneView {
  clock: string;
  messages: { id: number; from: string; text: string; at: string; read: boolean }[];
  tasks: { id: string; title: string; place: string; due: string; done: string | null; late: boolean; report: string | null; reported: boolean }[];
  patients: { name: string; room: number; floor: string; age: string; reason: string; story: string; call: 'off' | 'assist' | 'urgent' }[];
  map: MapView;
}

export interface MapRoom { x0: number; x1: number; z0: number; z1: number; label: string; kind: string; locked: boolean }
export interface MapView {
  floor: number;
  floors: { id: number; label: string }[];
  rooms: MapRoom[];
  corridors: { x0: number; x1: number; z0: number; z1: number }[];
  player: { x: number; z: number; yaw: number } | null;
  targets: { x: number; z: number; n: number }[];
  marks: { x: number; z: number; kind: 'elev' | 'stairs' | 'desk' | 'panel' }[];
}

export interface Dossier {
  id: string; name: string; room: number; floor: string; born: string; age: number; sex: 'm' | 'f'; reason: string;
  character: string; curiosities: string[]; story: string; face: number; call: 'off' | 'assist' | 'urgent'; callBlink: boolean;
  /** Nota di decesso: c'è solo per il paziente che non c'è più. */
  dead?: string;
  /** Dove si trova ora (in bagno, a terra…). */
  where?: string;
}
export interface TerminalView {
  clock: string; weather: string;
  power: { label: string; on: boolean }[];
  lift: string;
  calls: { id: string; room: number; name: string; assist: string; urgent: string }[];
  tasks: { title: string; place: string; due: string; late: boolean }[];
  patients: Dossier[];
  log: { time: string; place: string; text: string }[];
}

export interface CctvView { n: number; total: number; label: string; clock: string; ir: boolean; noSignal: boolean; list: { n: number; label: string; off: boolean }[] }

const ICONS: Record<PhoneTab | 'close', string> = {
  messages: '<path d="M4 5h16v11H9l-4 3.5V16H4z"/>',
  tasks: '<path d="M7 4h10v16H7z"/><path d="M9.5 9.5l1.5 1.5 3-3M9.5 15h5"/>',
  patients: '<path d="M4 18v-5h16v5M4 13V8M6 11h4v2H6z"/><path d="M20 13v-2a2 2 0 0 0-2-2h-6v4"/>',
  map: '<path d="M4 6l5-2 6 2 5-2v14l-5 2-6-2-5 2z"/><path d="M9 4v14M15 6v14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
};
function icon(name: keyof typeof ICONS): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'tds-ico');
  svg.innerHTML = ICONS[name];
  return svg;
}

export class Ui {
  private settings: Settings;
  private screen: ScreenId = 'loading';
  private readonly screens: Screens;
  private readonly effects = new ScreenEffects();
  private readonly hud: HTMLElement;
  private readonly promptEl: HTMLElement;
  private readonly subtitleEl: HTMLElement;
  private readonly subSpeaker: HTMLElement;
  private readonly subText: HTMLElement;
  private readonly noticesEl: HTMLElement;
  private readonly hintsEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly clockEl: HTMLElement;
  private readonly floorEl: HTMLElement;
  private readonly carryEl: HTMLElement;
  private readonly unreadEl: HTMLElement;
  private readonly cctvEl: HTMLElement;
  private readonly cctvTop: HTMLElement;
  private readonly cctvClock: HTMLElement;
  private readonly cctvNo: HTMLElement;
  private readonly cctvList: HTMLElement;
  private readonly dot: HTMLElement;
  private readonly eventEl: HTMLElement;
  private readonly eventLabel: HTMLElement;
  private readonly miniEl: HTMLElement;
  private readonly miniCanvas: HTMLCanvasElement;
  private miniOn = false;
  private readonly termEl: HTMLElement;
  private readonly torchEl: HTMLElement;
  private readonly torchFill: HTMLElement;
  private readonly torchSpare: HTMLElement;
  private readonly termBody: HTMLElement;
  private readonly termClock: HTMLElement;
  private readonly termTabs: HTMLButtonElement[] = [];
  private termTab: 'status' | 'patients' | 'log' = 'status';
  private termOpen = false;
  private termSig = '';
  private termView: TerminalView | null = null;
  private readonly portraits = new Map<string, string>();
  private subtitleTimer = 0;
  private hintsTimer = 0;
  private noticeActive = 0;
  private readonly noticeQueue: string[] = [];
  private promptText: string | null = null;
  // telefono
  private readonly phoneEl: HTMLElement;
  private readonly panes: Record<PhoneTab, HTMLElement>;
  private readonly tabBtns: Record<PhoneTab, HTMLButtonElement>;
  private readonly phoneClock: HTMLElement;
  private readonly badge: HTMLElement;
  private tab: PhoneTab = 'messages';
  private phoneOpen = false;
  private openedAt = -1e9;
  private readonly sig: Record<PhoneTab, string> = { messages: '', tasks: '', patients: '', map: '' };
  private view: PhoneView | null = null;
  private mapFloor: number | null = null;
  private readonly mapCanvas: HTMLCanvasElement;
  private readonly mapTabs: HTMLElement;

  constructor(private readonly root: HTMLElement, private readonly cb: UiCallbacks & { onMapFloor?(f: number): void; onTerminal?(action: string): void; onReport?(id: string): void }, settings: Settings) {
    this.settings = sanitizeSettings(settings, settings?.lang === 'en' ? 'en' : 'it');
    root.classList.add('tds-ui', 'ths-ui');
    root.lang = this.settings.lang;

    this.hud = el('div', 'tds-hud'); this.hud.hidden = true;
    this.dot = el('div', 'tds-dot');
    this.promptEl = el('div', 'tds-prompt'); this.promptEl.hidden = true;
    const bottom = el('div', 'tds-bottom');
    this.subtitleEl = el('div', 'tds-subtitle'); this.subtitleEl.hidden = true;
    this.subSpeaker = el('span', 'tds-sub-speaker'); this.subText = el('span', 'tds-sub-text');
    this.subtitleEl.append(this.subSpeaker, this.subText);
    bottom.append(this.subtitleEl);
    this.noticesEl = el('div', 'tds-notices');
    this.hintsEl = el('ul', 'tds-hints'); this.hintsEl.hidden = true;
    this.statusEl = el('div', 'ths-status');
    this.clockEl = el('div', 'ths-clock', '22:00');
    this.floorEl = el('div', 'ths-floor', '');
    this.carryEl = el('div', 'ths-carry'); this.carryEl.hidden = true;
    this.unreadEl = el('div', 'ths-unread'); this.unreadEl.hidden = true;
    this.statusEl.append(this.clockEl, this.floorEl, this.unreadEl);
    this.torchEl = el('div', 'ths-torch');
    const tb = el('div', 'ths-torch-bar'); this.torchFill = el('div', 'ths-torch-fill'); tb.appendChild(this.torchFill);
    this.torchSpare = el('span', 'ths-torch-spare');
    this.torchEl.append(el('span', 'ths-torch-ico', '🔦'), tb, this.torchSpare);
    this.statusEl.appendChild(this.torchEl);
    const vignette = el('div', 'ths-vignette');
    // videosorveglianza
    this.cctvEl = el('div', 'ths-cctv'); this.cctvEl.hidden = true;
    this.cctvTop = el('div', 'ths-cctv-top');
    this.cctvClock = el('div', 'ths-cctv-clock');
    this.cctvNo = el('div', 'ths-cctv-nosig'); this.cctvNo.hidden = true;
    this.cctvList = el('div', 'ths-cctv-list');
    const help = i18n(el('div', 'ths-cctv-help'), 'hud.cctv.help');
    this.cctvEl.append(this.cctvTop, this.cctvClock, this.cctvNo, this.cctvList, help);
    this.eventEl = el('div', 'tds-event ths-event'); this.eventEl.hidden = true;
    const evDot = el('span', 'tds-event-dot');
    this.eventLabel = el('span');
    this.eventEl.append(evDot, this.eventLabel);
    this.miniEl = el('div', 'ths-mini'); this.miniEl.hidden = true;
    this.miniCanvas = el('canvas', 'ths-mini-map');
    this.miniEl.appendChild(this.miniCanvas);
    // terminale della postazione
    this.termEl = el('div', 'ths-term'); this.termEl.hidden = true;
    const thead = el('div', 'ths-term-head');
    const ttitle = el('div', 'ths-term-title', 'SAN NICOLA · VIGILANZA NOTTURNA');
    this.termClock = el('div', 'ths-term-clock');
    thead.append(ttitle, this.termClock);
    const tnav = el('div', 'ths-term-nav');
    (['status', 'patients', 'log'] as const).forEach((id, i) => {
      const b = el('button', 'ths-term-tab'); b.type = 'button';
      i18n(b, `term.tab.${id}`);
      b.dataset.key = String(i + 1);
      b.addEventListener('click', () => { this.termTab = id; this.termSig = ''; this.renderTerminal(); });
      this.termTabs.push(b); tnav.appendChild(b);
    });
    const cams = i18n(el('button', 'ths-term-act'), 'term.cctv'); cams.type = 'button';
    cams.addEventListener('click', () => this.cb.onTerminal?.('cctv'));
    const up = i18n(el('button', 'ths-term-act'), 'term.stand'); up.type = 'button';
    up.addEventListener('click', () => this.cb.onTerminal?.('stand'));
    tnav.append(cams, up);
    this.termBody = el('div', 'ths-term-body');
    this.termEl.append(thead, tnav, this.termBody);
    this.hud.append(vignette, this.dot, this.promptEl, bottom, this.noticesEl, this.hintsEl, this.statusEl, this.carryEl, this.cctvEl, this.eventEl, this.miniEl, this.termEl);

    // telefono
    this.phoneEl = el('aside', 'tds-phone'); this.phoneEl.hidden = true;
    i18nAria(this.phoneEl, 'phone.label');
    const body = el('div', 'tds-phone-body');
    const close = el('button', 'tds-phone-close'); close.type = 'button'; close.appendChild(icon('close'));
    i18nAria(close, 'phone.close');
    close.addEventListener('click', () => this.userClosePhone());
    const scr = el('div', 'tds-phone-screen');
    const status = el('div', 'tds-status');
    this.phoneClock = el('span', 'tds-status-clock', '--:--');
    status.append(this.phoneClock, el('span', 'tds-status-right', 'SAN NICOLA · VIG'));
    const content = el('div', 'tds-phone-content');
    const tabs = el('nav', 'tds-tabs');
    this.badge = el('span', 'tds-tab-badge'); this.badge.hidden = true;
    const panes = {} as Record<PhoneTab, HTMLElement>, btns = {} as Record<PhoneTab, HTMLButtonElement>;
    for (const id of ['messages', 'tasks', 'patients', 'map'] as PhoneTab[]) {
      const pane = el('section', `tds-pane tds-pane-${id}`); pane.hidden = true; panes[id] = pane; content.appendChild(pane);
      const b = el('button', 'tds-tab'); b.type = 'button';
      b.append(icon(id), i18n(el('span', 'tds-tab-label'), `phone.tab.${id}`));
      if (id === 'messages') b.appendChild(this.badge);
      b.addEventListener('click', () => this.selectTab(id));
      btns[id] = b; tabs.appendChild(b);
    }
    this.panes = panes; this.tabBtns = btns;
    this.mapTabs = el('div', 'ths-map-floors');
    this.mapCanvas = el('canvas', 'ths-map');
    panes.map.append(this.mapTabs, this.mapCanvas);
    scr.append(status, content, tabs);
    body.append(close, scr);
    this.phoneEl.appendChild(body);

    this.screens = new Screens({ callbacks: cb, lang: () => this.settings.lang, settings: () => this.settings, changeSettings: (n) => this.changeSettings(n), go: (s) => this.show(s) });
    root.append(this.effects.el, this.hud, this.phoneEl, this.screens.el);
    applyI18n(this.hud, this.settings.lang);
    applyI18n(this.phoneEl, this.settings.lang);
    root.addEventListener('click', (ev) => {
      const tg = ev.target instanceof Element ? ev.target.closest('button, summary') : null;
      if (tg && root.contains(tg) && !(tg as HTMLButtonElement).disabled) this.cb.onUiSound('ui');
    });
    window.addEventListener('keydown', (ev) => this.handleKey(ev), true);
    this.show('loading');
  }

  // ------------------------------------------------------------ schermate e impostazioni

  get lang(): Lang { return this.settings.lang; }

  private changeSettings(next: Settings): void {
    const clean = sanitizeSettings(next, this.settings.lang);
    const lc = clean.lang !== this.settings.lang;
    this.settings = clean;
    saveSettings(clean);
    if (lc) { this.root.lang = clean.lang; this.termSig = ''; applyI18n(this.hud, clean.lang); applyI18n(this.phoneEl, clean.lang); this.screens.relabel(); this.sig.messages = this.sig.tasks = this.sig.patients = ''; }
    else this.screens.syncSettings();
    this.cb.onSettingsChanged({ lang: clean.lang, gfx: { ...clean.gfx } });
  }

  show(screen: ScreenId): void {
    if (!SCREEN_IDS.includes(screen)) return;
    this.screen = screen;
    this.root.dataset.screen = screen;
    this.hud.hidden = screen !== 'game';
    if (screen !== 'game' && screen !== 'pause') {
      this.closePhone();
      if (screen !== 'summary') { this.setPrompt(null); this.setSubtitle(null); this.setHints([]); this.noticesEl.textContent = ''; this.noticeQueue.length = 0; this.noticeActive = 0; this.setCctv(null); }
    }
    this.phoneEl.classList.toggle('is-suspended', screen !== 'game');
    this.screens.show(screen);
  }
  current(): ScreenId { return this.screen; }
  setPauseInfo(seed: number): void { this.screens.setPauseInfo(seed); }
  setLoadingProgress(p: number, label?: string): void { this.screens.setLoadingProgress(p, label); }
  showSummary(v: SummaryView): void { this.screens.showSummary(v); this.show('summary'); }
  setScreenEffect(kind: ScreenEffectKind, intensity: number): void { this.effects.set(kind, intensity); }

  // ------------------------------------------------------------ HUD

  setPrompt(text: string | null): void {
    const v = text || null;
    if (v === this.promptText) return;
    this.promptText = v;
    this.promptEl.hidden = v === null;
    this.promptEl.textContent = v ?? '';
  }

  setSubtitle(text: string | null, speaker?: string): void {
    window.clearTimeout(this.subtitleTimer);
    if (!text) { this.subtitleEl.hidden = true; return; }
    this.subSpeaker.textContent = speaker ?? ''; this.subSpeaker.hidden = !speaker;
    this.subText.textContent = text;
    this.subtitleEl.classList.remove('is-fading'); this.subtitleEl.hidden = false;
    this.subtitleTimer = window.setTimeout(() => {
      this.subtitleEl.classList.add('is-fading');
      this.subtitleTimer = window.setTimeout(() => { this.subtitleEl.hidden = true; }, 700);
    }, SUBTITLE_MS + text.length * 25);
  }

  notify(text: string): void { if (text) { this.noticeQueue.push(text); this.pump(); } }
  private pump(): void {
    while (this.noticeActive < NOTICE_MAX && this.noticeQueue.length) {
      const n = el('div', 'tds-notice', this.noticeQueue.shift()!);
      this.noticesEl.appendChild(n); this.noticeActive++;
      window.setTimeout(() => { n.classList.add('is-leaving'); window.setTimeout(() => { n.remove(); this.noticeActive--; this.pump(); }, 420); }, NOTICE_MS);
    }
  }

  setHints(lines: string[]): void {
    window.clearTimeout(this.hintsTimer);
    this.hintsEl.textContent = '';
    if (!lines.length) { this.hintsEl.hidden = true; return; }
    for (const l of lines) this.hintsEl.appendChild(el('li', undefined, l));
    this.hintsEl.hidden = false; this.hintsEl.classList.remove('is-fading');
    this.hintsTimer = window.setTimeout(() => { this.hintsEl.classList.add('is-fading'); this.hintsTimer = window.setTimeout(() => { this.hintsEl.hidden = true; }, 1200); }, HINTS_MS);
  }

  setStatus(clock: string, floor: string, carry: string | null, unread: number): void {
    if (this.clockEl.textContent !== clock) this.clockEl.textContent = clock;
    if (this.floorEl.textContent !== floor) this.floorEl.textContent = floor;
    this.carryEl.hidden = !carry;
    if (carry) { const c = t(this.lang, 'hud.carry', { item: carry }); if (this.carryEl.textContent !== c) this.carryEl.textContent = c; }
    this.unreadEl.hidden = unread === 0;
    this.unreadEl.textContent = unread > 9 ? '✉ 9+' : `✉ ${unread}`;
    this.badge.hidden = unread === 0;
    this.badge.textContent = String(unread);
  }

  setCctv(v: CctvView | null): void {
    this.cctvEl.hidden = !v;
    this.root.classList.toggle('is-cctv', !!v);
    this.dot.hidden = !!v;
    if (!v) return;
    const top = `CAM ${String(v.n).padStart(2, '0')}  ·  ${v.label.toUpperCase()}${v.ir ? `  ·  ${t(this.lang, 'hud.cctv.ir')}` : ''}`;
    if (this.cctvTop.textContent !== top) this.cctvTop.textContent = top;
    const ck = `● ${t(this.lang, 'hud.cctv.rec')}   25/12   ${v.clock}`;
    if (this.cctvClock.textContent !== ck) this.cctvClock.textContent = ck;
    this.cctvNo.hidden = !v.noSignal;
    this.cctvNo.textContent = t(this.lang, 'hud.cctv.nosignal');
    const sig = v.list.map((c) => `${c.n}${c.off ? 'x' : ''}`).join(',') + `|${v.n}`;
    if (this.cctvList.dataset.sig !== sig) {
      this.cctvList.dataset.sig = sig;
      this.cctvList.textContent = '';
      for (const c of v.list) this.cctvList.appendChild(el('span', `ths-cctv-chip${c.n === v.n ? ' is-on' : ''}${c.off ? ' is-off' : ''}`, String(c.n).padStart(2, '0')));
    }
  }

  /** Indicatore degli eventi insoliti, come in The Dark Seed. */
  setMystery(m: { active: boolean; intensity: number; watched: boolean }): void {
    this.eventEl.hidden = !m.active;
    const key = m.watched ? 'hud.watched' : 'hud.strangeEvent';
    if (this.eventLabel.dataset.k !== key + this.lang) { this.eventLabel.dataset.k = key + this.lang; this.eventLabel.textContent = t(this.lang, key); }
  }

  /** Il terminale disegnato sullo schermo del monitor della scrivania (matrice CSS, o null per il riquadro normale). */
  placeTerminal(matrix: string | null): void {
    const e = this.termEl;
    if (matrix) {
      if (!e.classList.contains('is-screen')) { e.classList.add('is-screen'); this.root.classList.add('is-screen-term'); }
      if (e.style.transform !== matrix) e.style.transform = matrix;
    } else if (e.classList.contains('is-screen')) { e.classList.remove('is-screen'); this.root.classList.remove('is-screen-term'); e.style.transform = ''; }
  }

  /** Pile della torcia. */
  setTorch(charge: number, on: boolean, spares: number): void {
    const w = `${Math.round(charge * 100)}%`;
    if (this.torchFill.style.width !== w) this.torchFill.style.width = w;
    this.torchEl.classList.toggle('is-on', on);
    this.torchEl.classList.toggle('is-low', charge < 0.15);
    const sp = spares > 0 ? `+${spares}` : '';
    if (this.torchSpare.textContent !== sp) this.torchSpare.textContent = sp;
  }

  /** Il peso della notte: bordi dello schermo che si chiudono, un velo di grana. */
  setDread(d: number, flash: number): void {
    this.root.style.setProperty('--dread', d.toFixed(3));
    this.root.style.setProperty('--flash', flash.toFixed(3));
  }

  setMinimap(on: boolean): void { this.miniOn = on; this.miniEl.hidden = !on; }
  isMinimapOn(): boolean { return this.miniOn; }
  drawMinimap(m: MapView): void { if (this.miniOn) drawFloorMap(this.miniCanvas, m, m.floor, true); }

  // ------------------------------------------------------------ terminale

  openTerminal(): void { this.termOpen = true; this.termEl.hidden = false; this.root.classList.add('is-term'); this.termSig = ''; applyI18n(this.termEl, this.lang); }
  closeTerminal(): void { this.termOpen = false; this.termEl.hidden = true; this.root.classList.remove('is-term'); }
  isTerminalOpen(): boolean { return this.termOpen; }
  terminalTab(n: number): void { const ids = ['status', 'patients', 'log'] as const; if (ids[n]) { this.termTab = ids[n]; this.termSig = ''; this.renderTerminal(); } }

  updateTerminal(v: TerminalView): void { this.termView = v; if (this.termOpen) this.renderTerminal(); }

  private renderTerminal(): void {
    const v = this.termView;
    if (!v) return;
    const lang = this.lang;
    this.termClock.textContent = `${v.clock} · ${v.weather}`;
    this.termTabs.forEach((b, i) => b.classList.toggle('is-on', ['status', 'patients', 'log'][i] === this.termTab));
    const sig = this.termTab + JSON.stringify(this.termTab === 'patients' ? v.patients : this.termTab === 'log' ? v.log : [v.power, v.lift, v.calls, v.tasks]) + lang;
    if (sig === this.termSig) return;
    this.termSig = sig;
    const body = this.termBody;
    const keepScroll = body.scrollTop;
    body.textContent = '';
    if (this.termTab === 'status') {
      const grid = el('div', 'ths-term-grid');
      const box = (title: string) => { const d = el('section', 'ths-term-box'); d.appendChild(el('h4', undefined, title)); grid.appendChild(d); return d; };
      const pw = box(t(lang, 'term.power'));
      for (const p of v.power) { const r = el('div', 'ths-term-row'); r.append(el('span', `ths-led${p.on ? ' is-on' : ' is-off'}`), el('span', undefined, p.label), el('span', 'ths-term-dim', t(lang, p.on ? 'term.on' : 'term.off'))); pw.appendChild(r); }
      const lf = box(t(lang, 'term.lift'));
      lf.appendChild(el('div', 'ths-term-big', v.lift));
      const cl = box(t(lang, 'term.calls'));
      if (!v.calls.length) cl.appendChild(el('div', 'ths-term-dim', '–'));
      for (const c of v.calls) {
        const r = el('div', 'ths-term-row');
        const st = c.urgent !== 'off' ? 'urgent' : c.assist !== 'off' ? 'assist' : 'off';
        const led = st === 'off' ? 'quiet' : st;
        const blink = c.urgent === 'blink' || c.assist === 'blink';
        r.append(el('span', `ths-led is-${led}${blink ? ' is-blink' : ''}`), el('span', undefined, `${c.room} · ${c.name}`), el('span', 'ths-term-dim', t(lang, `term.call.${st}`)));
        if (blink) {
          const b = el('button', 'ths-term-mini', t(lang, 'term.answer')); b.type = 'button';
          b.addEventListener('click', () => this.cb.onTerminal?.(`ack:${c.id}|${c.urgent === 'blink' ? 'urgent' : 'assist'}`));
          r.appendChild(b);
        }
        cl.appendChild(r);
      }
      const tk = box(t(lang, 'term.tasks'));
      if (!v.tasks.length) tk.appendChild(el('div', 'ths-term-dim', t(lang, 'phone.noTasks')));
      v.tasks.forEach((x, i) => { const r = el('div', 'ths-term-task'); r.append(el('div', undefined, `${i + 1}. ${x.title}`), el('div', `ths-term-dim${x.late ? ' is-late' : ''}`, `${x.place} · ${x.late ? t(lang, 'phone.late') : t(lang, 'phone.due', { t: x.due })}`)); tk.appendChild(r); });
      body.appendChild(grid);
    } else if (this.termTab === 'patients') {
      for (const p of v.patients) {
        const card = el('article', `ths-dossier${p.call !== 'off' ? ` is-${p.call}` : ''}`);
        const img = el('img', 'ths-photo');
        img.alt = p.name;
        img.src = this.portrait(p);
        const info = el('div', 'ths-dossier-info');
        info.append(el('h4', undefined, p.name), el('div', 'ths-term-dim', `${t(lang, 'term.room')} ${p.room} · ${p.floor}${p.where ? ` · ${p.where}` : ''}`));
        if (p.dead) { card.classList.add('is-dead'); info.append(el('div', 'ths-dossier-dead', `✝ ${p.dead}`)); }
        const dl = el('dl', 'ths-dossier-dl');
        const row = (k: string, val: string) => { dl.append(el('dt', undefined, t(lang, k)), el('dd', undefined, val)); };
        row('term.born', `${p.born} (${t(lang, 'phone.age', { n: p.age })})`);
        row('term.reason', p.reason);
        row('term.character', p.character);
        row('term.curious', p.curiosities.join(' '));
        info.append(dl, el('p', 'ths-dossier-story', p.story));
        card.append(img, info);
        body.appendChild(card);
      }
    } else {
      body.appendChild(el('p', 'ths-term-dim', t(lang, 'term.logNote')));
      const ol = el('ol', 'ths-term-log');
      for (const r of v.log) { const li = el('li'); li.append(el('span', 'ths-term-dim', r.time), el('span', 'ths-term-place', r.place), el('span', undefined, r.text)); ol.appendChild(li); }
      body.appendChild(ol);
    }
    body.scrollTop = keepScroll;
  }

  /** Foto tessera procedurale in bianco e nero, sempre uguale per lo stesso paziente. */
  private portrait(p: Dossier): string {
    const key = p.id + p.face + (p.dead ? 'd' : '');
    const cached = this.portraits.get(key);
    if (cached) return cached;
    const c = document.createElement('canvas');
    c.width = 120; c.height = 150;
    const g = c.getContext('2d')!;
    let x = p.face >>> 0;
    const r = () => { x = (Math.imul(x ^ (x >>> 15), 2246822507) + 0x9e3779b9) >>> 0; return (x % 10000) / 10000; };
    const grad = g.createLinearGradient(0, 0, 0, 150);
    grad.addColorStop(0, '#8b8a86'); grad.addColorStop(1, '#5d5c59');
    g.fillStyle = grad; g.fillRect(0, 0, 120, 150);
    const skin = 150 + r() * 40, hair = p.age > 80 ? 225 : 170 + r() * 50;
    const shade = (v: number) => `rgb(${v | 0},${v | 0},${(v * 0.96) | 0})`;
    // spalle
    g.fillStyle = shade(70 + r() * 60);
    g.beginPath(); g.ellipse(60, 150, 52, 30, 0, Math.PI, 0); g.fill();
    g.fillStyle = shade(skin - 20); g.fillRect(52, 104, 16, 18);
    // viso
    const fw = 25 + r() * 6, fh = 33 + r() * 5;
    g.fillStyle = shade(skin); g.beginPath(); g.ellipse(60, 72, fw, fh, 0, 0, Math.PI * 2); g.fill();
    // capelli
    g.fillStyle = shade(hair);
    const bald = p.sex === 'm' && r() < 0.45;
    if (bald) { g.beginPath(); g.ellipse(60 - fw + 3, 66, 6, 14, 0, 0, Math.PI * 2); g.ellipse(60 + fw - 3, 66, 6, 14, 0, 0, Math.PI * 2); g.fill(); }
    else { g.beginPath(); g.ellipse(60, 52, fw + 3, p.sex === 'f' ? 22 : 16, 0, Math.PI, 0); g.fill(); if (p.sex === 'f') { g.fillRect(60 - fw - 3, 50, 8, 34); g.fillRect(60 + fw - 5, 50, 8, 34); } }
    // occhi, sopracciglia, rughe
    g.fillStyle = shade(40); const ey = 70;
    g.beginPath(); g.ellipse(50, ey, 3.2, 2.2, 0, 0, Math.PI * 2); g.ellipse(70, ey, 3.2, 2.2, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = shade(hair - 60); g.lineWidth = 2;
    g.beginPath(); g.moveTo(44, ey - 7); g.lineTo(55, ey - 8 + r() * 2); g.moveTo(65, ey - 8 + r() * 2); g.lineTo(76, ey - 7); g.stroke();
    g.strokeStyle = shade(skin - 45); g.lineWidth = 1;
    for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(48, 54 + k * 4); g.lineTo(72, 54 + k * 4 + r()); g.stroke(); }
    g.beginPath(); g.moveTo(60, 74); g.lineTo(57, 86); g.lineTo(62, 87); g.stroke();
    g.beginPath(); g.moveTo(52, 95); g.quadraticCurveTo(60, 95 + (r() - 0.6) * 6, 68, 95); g.stroke();
    if (r() < 0.5) { g.strokeStyle = shade(30); g.lineWidth = 1.6; g.strokeRect(42, ey - 6, 15, 11); g.strokeRect(63, ey - 6, 15, 11); g.beginPath(); g.moveTo(57, ey - 1); g.lineTo(63, ey - 1); g.stroke(); }
    // grana e angoli consumati, come una vecchia fototessera
    const img = g.getImageData(0, 0, 120, 150);
    for (let i = 0; i < img.data.length; i += 4) { const n = (r() - 0.5) * 26; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n; }
    g.putImageData(img, 0, 0);
    if (p.dead) {
      // la stessa foto, ma gli occhi sono due buchi neri e la carta si è annerita ai bordi
      g.fillStyle = '#000'; g.beginPath(); g.ellipse(50, 70, 5.5, 4.5, 0, 0, Math.PI * 2); g.ellipse(70, 70, 5.5, 4.5, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(48, 74, 3, 16); g.fillRect(69, 74, 2, 12);
      const vg = g.createRadialGradient(60, 75, 30, 60, 75, 95); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(10,0,0,0.85)');
      g.fillStyle = vg; g.fillRect(0, 0, 120, 150);
    }
    const url = c.toDataURL('image/png');
    this.portraits.set(key, url);
    return url;
  }

  // ------------------------------------------------------------ telefono

  isPhoneOpen(): boolean { return this.phoneOpen; }
  openPhone(tab?: PhoneTab): void {
    this.phoneOpen = true; this.openedAt = performance.now();
    this.phoneEl.hidden = false;
    this.root.classList.add('is-phone-open');
    this.selectTab(tab ?? this.tab);
  }
  closePhone(): void { this.phoneOpen = false; this.phoneEl.hidden = true; this.root.classList.remove('is-phone-open'); }
  private userClosePhone(): void { if (!this.phoneOpen) return; this.closePhone(); this.cb.onPhoneClosed(); }

  private selectTab(id: PhoneTab): void {
    this.tab = id;
    for (const k of Object.keys(this.panes) as PhoneTab[]) { this.panes[k].hidden = k !== id; this.tabBtns[k].classList.toggle('is-on', k === id); }
    this.sig[id] = '';
    if (this.view) this.updatePhone(this.view);
  }

  currentTab(): PhoneTab { return this.tab; }

  updatePhone(v: PhoneView): void {
    this.view = v;
    if (!this.phoneOpen) return;
    this.phoneClock.textContent = v.clock;
    const lang = this.lang;
    const pane = this.panes[this.tab];
    if (this.tab === 'messages') {
      const sig = v.messages.map((m) => `${m.id}${m.read ? 'r' : ''}`).join(',') + lang;
      if (sig === this.sig.messages) return;
      this.sig.messages = sig;
      pane.textContent = '';
      const th = el('div', 'tds-thread');
      let last = '';
      for (const m of v.messages) {
        if (m.from !== last) { th.appendChild(el('div', 'tds-sender', `${m.from} · ${m.at}`)); last = m.from; }
        th.appendChild(el('div', `tds-bubble${m.read ? '' : ' is-unread'}`, m.text));
      }
      pane.appendChild(th);
      window.setTimeout(() => { pane.scrollTop = pane.scrollHeight; }, 0);
    } else if (this.tab === 'tasks') {
      const sig = JSON.stringify(v.tasks) + lang;
      if (sig === this.sig.tasks) return;
      this.sig.tasks = sig;
      pane.textContent = '';
      const open = v.tasks.filter((x) => !x.done), done = v.tasks.filter((x) => x.done);
      if (!open.length) pane.appendChild(el('div', 'tds-all-done', t(lang, 'phone.noTasks')));
      open.forEach((x, i) => {
        const card = el('div', 'tds-task');
        const head = el('div', 'tds-task-head');
        head.append(el('div', 'tds-task-title', `${i + 1}. ${x.title}`), el('span', `tds-chip${x.late ? ' ths-chip-late' : ''}`, x.late ? t(lang, 'phone.late') : t(lang, 'phone.due', { t: x.due })));
        card.append(head, el('div', 'tds-task-place', x.place));
        pane.appendChild(card);
      });
      // incarichi fatti: il rapporto si manda da qui
      const pending = done.filter((x) => !x.reported);
      if (pending.length) pane.appendChild(el('div', 'ths-report-head', t(lang, 'phone.toReport', { n: pending.length })));
      for (const x of pending) {
        const card = el('div', 'tds-task ths-task-report');
        card.append(el('div', 'tds-task-title', x.title), el('div', 'tds-task-place', x.report ?? ''));
        const b = el('button', 'ths-report-btn', t(lang, 'phone.report')); b.type = 'button';
        b.addEventListener('click', () => { this.cb.onReport?.(x.id); this.sig.tasks = ''; });
        card.appendChild(b);
        pane.appendChild(card);
      }
      for (const x of done.filter((y) => y.reported).slice(-5).reverse()) {
        const card = el('div', 'tds-task ths-task-done');
        card.append(el('div', 'tds-task-title', x.title), el('div', 'tds-task-place', t(lang, 'phone.done', { t: x.done! })));
        pane.appendChild(card);
      }
    } else if (this.tab === 'patients') {
      const sig = JSON.stringify(v.patients) + lang;
      if (sig === this.sig.patients) return;
      this.sig.patients = sig;
      pane.textContent = '';
      pane.appendChild(el('div', 'tds-sender', t(lang, 'phone.patientsNote', { n: v.patients.length })));
      for (const p of v.patients) {
        const card = el('div', `tds-task ths-patient${p.call !== 'off' ? ` is-${p.call}` : ''}`);
        const head = el('div', 'tds-task-head');
        head.append(el('div', 'tds-task-title', p.name), el('span', 'tds-chip', `${p.room}`));
        card.append(head, el('div', 'tds-task-place', `${p.floor} · ${p.age} · ${p.reason}`), el('div', 'tds-task-note', p.story));
        pane.appendChild(card);
      }
    } else this.drawMap(v.map);
  }

  /** Mappa del piano: nord a destra, l'atrio in basso. */
  private drawMap(m: MapView): void {
    const floor = this.mapFloor ?? m.floor;
    const sig = m.floors.map((f) => f.id).join(',') + floor + this.lang;
    if (this.mapTabs.dataset.sig !== sig) {
      this.mapTabs.dataset.sig = sig;
      this.mapTabs.textContent = '';
      for (const f of m.floors) {
        const b = el('button', `ths-map-floor${f.id === floor ? ' is-on' : ''}`, f.label); b.type = 'button';
        b.addEventListener('click', () => { this.mapFloor = f.id; this.cb.onMapFloor?.(f.id); this.mapTabs.dataset.sig = ''; });
        this.mapTabs.appendChild(b);
      }
    }
    drawFloorMap(this.mapCanvas, m, floor, false);
  }

  resetMapFloor(): void { this.mapFloor = null; }
  mapFloorShown(fallback: number): number { return this.mapFloor ?? fallback; }

  // ------------------------------------------------------------ tastiera

  private handleKey(ev: KeyboardEvent): void {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (this.screen === 'game') {
      if (!this.phoneOpen) return;
      if ((ev.code === 'KeyT' || ev.key === 'Escape') && !ev.repeat && performance.now() - this.openedAt > 150) {
        ev.preventDefault(); ev.stopImmediatePropagation(); this.userClosePhone();
      } else if (ev.code === 'KeyM') { ev.preventDefault(); ev.stopImmediatePropagation(); this.selectTab('map'); }
      return;
    }
    if (this.screen === 'pause' && ev.key === 'Escape' && this.screens.isConfirmOpen()) { ev.preventDefault(); ev.stopImmediatePropagation(); this.screens.cancelConfirm(); return; }
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { if (this.screens.navigate(ev.key === 'ArrowDown' ? 1 : -1)) ev.preventDefault(); return; }
    if ((this.screen === 'settings' || this.screen === 'intro' || this.screen === 'achievements') && ev.key === 'Escape') { ev.preventDefault(); this.show('menu'); }
  }
}

/** Pianta del piano: nord a destra, est in alto. Solo le stanze utili, i segnalini degli incarichi e il guardiano. */
export function drawFloorMap(c: HTMLCanvasElement, m: MapView, floor: number, mini: boolean): void {
  const w = Math.max(60, c.clientWidth), hgt = Math.max(60, c.clientHeight);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(hgt * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(hgt * dpr); }
  const g = c.getContext('2d');
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, hgt);
  g.fillStyle = mini ? 'rgba(8,11,12,0.82)' : '#0d1113'; g.fillRect(0, 0, w, hgt);
  const k = Math.min((w - 12) / 20.5, (hgt - 12) / 18.5);
  const ox = w / 2, oy = hgt / 2;
  const P = (x: number, z: number): [number, number] => [ox + z * k, oy - x * k];
  const rect = (x0: number, x1: number, z0: number, z1: number) => { const [a, b] = P(x1, z0), [cc, d] = P(x0, z1); return [a, b, cc - a, d - b] as const; };
  // sagoma dell'edificio e corridoio
  const [bx, by, bw, bh] = rect(-9, 9, -10, 10);
  g.strokeStyle = '#2a3236'; g.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
  g.fillStyle = '#20282b';
  for (const c of m.corridors) { const [cx, cy, cw, ch] = rect(c.x0, c.x1, c.z0, c.z1); g.fillRect(cx, cy, cw, ch); }
  g.font = `${mini ? 8 : 10}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const r of m.rooms) {
    const [x, y, rw, rh] = rect(r.x0, r.x1, r.z0, r.z1);
    g.fillStyle = r.kind === 'lobby' ? '#2a2620' : r.kind === 'patient' ? '#1b2c31' : '#1b2124';
    g.fillRect(x + 1, y + 1, rw - 2, rh - 2);
    g.strokeStyle = '#3a4448'; g.strokeRect(x + 0.5, y + 0.5, rw - 1, rh - 1);
    g.fillStyle = r.kind === 'patient' ? '#e3d6b5' : '#c9cdc6';
    const lab = r.label.length > 13 ? r.label.slice(0, 12) + '…' : r.label;
    g.fillText(lab, x + rw / 2, y + rh / 2);
  }
  for (const mk of m.marks) {
    const [x, y] = P(mk.x, mk.z);
    g.fillStyle = mk.kind === 'elev' ? '#d9a85c' : mk.kind === 'stairs' ? '#9fc3bd' : mk.kind === 'panel' ? '#ff8a5a' : '#ffffff';
    g.fillRect(x - 3, y - 3, 6, 6);
  }
  for (const tg of m.targets) {
    const [x, y] = P(tg.x, tg.z);
    g.fillStyle = '#d9a85c'; g.beginPath(); g.arc(x, y, mini ? 5 : 7, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#14110a'; g.font = `bold ${mini ? 7 : 9}px system-ui`; g.fillText(String(tg.n), x, y + 0.5);
  }
  if (m.player && floor === m.floor) {
    const [x, y] = P(m.player.x, m.player.z);
    const a = m.player.yaw;
    g.save(); g.translate(x, y); g.rotate(Math.atan2(-Math.sin(a), Math.cos(a)));
    g.fillStyle = '#9fc3bd'; g.beginPath(); g.moveTo(8, 0); g.lineTo(-5, 5); g.lineTo(-2, 0); g.lineTo(-5, -5); g.closePath(); g.fill();
    g.restore();
  }
  if (mini) { g.fillStyle = 'rgba(233,230,223,0.7)'; g.font = '600 10px system-ui'; g.textAlign = 'left'; g.fillText(`${m.floors.find((f) => f.id === m.floor)?.label ?? ''}°`, 6, 10); }
}
