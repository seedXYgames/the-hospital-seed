// Schermate a tutto schermo (caricamento, menu, impostazioni, introduzione, pausa, riepilogo)
// e piccoli strumenti DOM condivisi dall'interfaccia. Nessun accesso al DOM a livello di modulo.
import type { ScreenId, SummaryView, UiCallbacks } from '../core/api';
import { ACHIEVEMENTS, favouriteSeed, loadProgress, rankOf } from '../game/achievements';
import { currentAccount } from '../game/account';
import type { GraphicsSettings, Lang, Settings } from '../core/contracts';
import { parseSeed, randomSeed, seedFromUrl } from '../core/seed';
import { GAME_TITLE, t } from '../i18n/strings';
import { LIMITS, applyQualityPreset } from './settingsStore';

// ---------------------------------------------------------------- strumenti

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Associa una chiave i18n al testo dell'elemento; `applyI18n` lo aggiorna al cambio lingua. */
export function i18n<T extends HTMLElement>(e: T, key: string, params?: Record<string, string | number>): T {
  e.dataset.i18n = key;
  if (params) e.dataset.i18nParams = JSON.stringify(params);
  else delete e.dataset.i18nParams;
  return e;
}

/** Come `i18n`, ma per l'attributo aria-label. */
export function i18nAria<T extends Element>(e: T, key: string, params?: Record<string, string | number>): T {
  e.setAttribute('data-i18n-aria', key);
  if (params) e.setAttribute('data-i18n-aria-params', JSON.stringify(params));
  else e.removeAttribute('data-i18n-aria-params');
  return e;
}

function parseParams(raw: string | null | undefined): Record<string, string | number> | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as Record<string, string | number>;
  } catch {
    return undefined;
  }
}

export function applyI18n(root: Element, lang: Lang): void {
  const texts = root.querySelectorAll<HTMLElement>('[data-i18n]');
  texts.forEach((e) => {
    const v = t(lang, e.dataset.i18n as string, parseParams(e.dataset.i18nParams));
    if (e.textContent !== v) e.textContent = v;
  });
  root.querySelectorAll('[data-i18n-aria]').forEach((e) => {
    e.setAttribute('aria-label', t(lang, e.getAttribute('data-i18n-aria') as string, parseParams(e.getAttribute('data-i18n-aria-params'))));
  });
}

/** Durata come mm:ss, oppure h:mm:ss da un'ora in su. */
export function formatDuration(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const p2 = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p2(m)}:${p2(s)}` : `${p2(m)}:${p2(s)}`;
}

/** Copia negli appunti; in mancanza dell'API usa la selezione di un campo e execCommand. */
export async function copyText(text: string, field?: HTMLInputElement): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* permesso negato o contesto non sicuro: si prova il ripiego */
  }
  let temp: HTMLInputElement | null = null;
  let target = field;
  if (!target) {
    temp = document.createElement('input');
    temp.value = text;
    temp.readOnly = true;
    temp.style.position = 'fixed';
    temp.style.opacity = '0';
    temp.style.pointerEvents = 'none';
    document.body.appendChild(temp);
    target = temp;
  }
  let ok = false;
  try {
    target.focus();
    target.select();
    target.setSelectionRange(0, target.value.length);
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  if (temp) temp.remove();
  return ok;
}

// ---------------------------------------------------------------- controlli

interface Segmented<T extends string> { el: HTMLElement; set(value: T): void }

function segmented<T extends string>(
  options: { value: T; key?: string; text?: string }[],
  labelledBy: string,
  onPick: (v: T) => void,
): Segmented<T> {
  const box = el('div', 'tds-seg');
  box.setAttribute('role', 'radiogroup');
  box.setAttribute('aria-labelledby', labelledBy);
  const buttons = options.map((o) => {
    const b = el('button', 'tds-seg-btn');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.dataset.nav = '';
    if (o.key) i18n(b, o.key);
    else b.textContent = o.text ?? o.value;
    b.addEventListener('click', () => onPick(o.value));
    box.appendChild(b);
    return b;
  });
  return {
    el: box,
    set(value: T) {
      options.forEach((o, i) => {
        const on = o.value === value;
        buttons[i].setAttribute('aria-checked', on ? 'true' : 'false');
        buttons[i].classList.toggle('is-on', on);
      });
    },
  };
}

interface Slider { el: HTMLElement; set(value: number): void }

function slider(
  lim: { min: number; max: number; step: number },
  labelledBy: string,
  format: (v: number) => string,
  onInput: (v: number) => void,
): Slider {
  const box = el('div', 'tds-slider');
  const input = el('input', 'tds-range');
  input.type = 'range';
  input.min = String(lim.min);
  input.max = String(lim.max);
  input.step = String(lim.step);
  input.dataset.nav = '';
  input.setAttribute('aria-labelledby', labelledBy);
  const out = el('output', 'tds-slider-val');
  const paint = () => {
    const v = Number(input.value);
    out.textContent = format(v);
    input.style.setProperty('--fill', `${((v - lim.min) / (lim.max - lim.min)) * 100}%`);
  };
  input.addEventListener('input', () => {
    paint();
    onInput(Number(input.value));
  });
  box.append(input, out);
  return {
    el: box,
    set(value: number) {
      if (Number(input.value) !== value) input.value = String(value);
      paint();
    },
  };
}

// ---------------------------------------------------------------- schermate

export interface ScreensHost {
  callbacks: UiCallbacks;
  lang(): Lang;
  settings(): Settings;
  /** Applica, salva e notifica nuove impostazioni scelte dall'utente. */
  changeSettings(next: Settings): void;
  go(screen: ScreenId): void;
}

type OverlayId = Exclude<ScreenId, 'game'>;

export class Screens {
  readonly el: HTMLElement;
  private readonly panels: Record<OverlayId, HTMLElement>;
  private active: OverlayId | null = null;

  private loadBar!: HTMLElement;
  private loadLabel!: HTMLElement;
  private loadCustomLabel = false;

  private setLang!: Segmented<Lang>;
  private setQuality!: Segmented<GraphicsSettings['quality']>;
  private setShadows!: Segmented<'on' | 'off'>;
  private setAa!: Segmented<'on' | 'off'>;
  private setFog!: Segmented<'on' | 'off'>;
  private sBrightness!: Slider;
  private sScale!: Slider;
  private sDistance!: Slider;

  private seedInput!: HTMLInputElement;
  private seedError!: HTMLElement;
  private playBtn!: HTMLButtonElement;
  private seedDirty = false;

  private pauseSeed!: HTMLElement;
  private pauseMain!: HTMLElement;
  private pauseConfirm!: HTMLElement;

  private summaryBody!: HTMLElement;
  private idSeq = 0;

  constructor(private readonly host: ScreensHost) {
    this.el = el('div', 'tds-screens');
    this.panels = {
      loading: this.buildLoading(),
      menu: this.buildMenu(),
      settings: this.buildSettings(),
      intro: this.buildIntro(),
      pause: this.buildPause(),
      summary: this.buildSummary(),
      achievements: this.buildAchievements(),
    };
    for (const p of Object.values(this.panels)) {
      p.hidden = true;
      this.el.appendChild(p);
    }
    this.syncSettings();
    this.relabel();
  }

  private uid(prefix: string): string {
    this.idSeq += 1;
    return `tds-${prefix}-${this.idSeq}`;
  }

  // ------------------------------------------------------------ API

  show(screen: ScreenId): void {
    const next: OverlayId | null = screen === 'game' ? null : screen;
    (Object.keys(this.panels) as OverlayId[]).forEach((id) => {
      this.panels[id].hidden = id !== next;
    });
    this.active = next;
    this.el.dataset.screen = screen;
    if (next === 'pause') this.setConfirm(false);
    if (next === 'intro') this.validateSeed();
    if (next === 'achievements') this.renderAchievements();
    if (next) {
      const target = this.panels[next].querySelector<HTMLElement>('[data-autofocus]');
      if (target) target.focus({ preventScroll: true });
      this.panels[next].scrollTop = 0;
    } else if (document.activeElement instanceof HTMLElement && this.el.contains(document.activeElement)) {
      document.activeElement.blur();
    }
  }

  isConfirmOpen(): boolean {
    return this.active === 'pause' && !this.pauseConfirm.hidden;
  }

  cancelConfirm(): void {
    this.setConfirm(false);
  }

  /** Sposta il fuoco tra i controlli della schermata attiva (frecce su/giù). */
  navigate(dir: 1 | -1): boolean {
    if (!this.active) return false;
    const items = Array.from(this.panels[this.active].querySelectorAll<HTMLElement>('[data-nav]')).filter(
      (e) => !(e as HTMLButtonElement).disabled && e.offsetParent !== null,
    );
    if (items.length === 0) return false;
    const cur = items.indexOf(document.activeElement as HTMLElement);
    const idx = cur < 0 ? (dir > 0 ? 0 : items.length - 1) : (cur + dir + items.length) % items.length;
    items[idx].focus();
    return true;
  }

  relabel(): void {
    const lang = this.host.lang();
    applyI18n(this.el, lang);
    if (!this.loadCustomLabel) this.loadLabel.textContent = t(lang, 'loading.label');
    this.syncSettings();
    this.validateSeed();
  }

  syncSettings(): void {
    const s = this.host.settings();
    this.setLang.set(s.lang);
    this.setQuality.set(s.gfx.quality);
    this.setShadows.set(s.gfx.shadows ? 'on' : 'off');
    this.setAa.set(s.gfx.antialias ? 'on' : 'off');
    this.setFog.set(s.gfx.fogEffects ? 'on' : 'off');
    this.sBrightness.set(s.gfx.brightness);
    this.sScale.set(s.gfx.renderScale);
    this.sDistance.set(s.gfx.drawDistance);
  }

  setLoadingProgress(p: number, label?: string): void {
    const v = Math.min(1, Math.max(0, Number.isFinite(p) ? p : 0));
    this.loadBar.style.transform = `scaleX(${v})`;
    this.loadBar.parentElement?.setAttribute('aria-valuenow', String(Math.round(v * 100)));
    this.loadCustomLabel = typeof label === 'string' && label.length > 0;
    this.loadLabel.textContent = this.loadCustomLabel ? (label as string) : t(this.host.lang(), 'loading.label');
  }

  setPauseInfo(seed: number): void {
    i18n(this.pauseSeed, 'pause.seed', { seed });
    this.pauseSeed.textContent = t(this.host.lang(), 'pause.seed', { seed });
  }

  // ------------------------------------------------------------ caricamento

  private buildLoading(): HTMLElement {
    const p = el('section', 'tds-screen tds-loading');
    const title = el('h1', 'tds-title tds-title-small', GAME_TITLE);
    const track = el('div', 'tds-load-track');
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    this.loadBar = el('div', 'tds-load-bar');
    track.appendChild(this.loadBar);
    this.loadLabel = el('p', 'tds-load-label');
    p.append(title, track, this.loadLabel);
    return p;
  }

  // ------------------------------------------------------------ menu

  private buildMenu(): HTMLElement {
    const p = el('section', 'tds-screen tds-menu');
    const inner = el('div', 'tds-menu-inner');
    const title = el('h1', 'tds-title', GAME_TITLE);
    const nav = el('nav', 'tds-menu-nav');
    i18nAria(nav, 'menu.nav');
    const start = i18n(el('button', 'tds-menu-item'), 'menu.start');
    start.type = 'button';
    start.dataset.nav = '';
    start.dataset.autofocus = '';
    start.addEventListener('click', () => this.host.go('intro'));
    const goals = i18n(el('button', 'tds-menu-item'), 'menu.achievements');
    goals.type = 'button';
    goals.dataset.nav = '';
    goals.addEventListener('click', () => this.host.go('achievements'));
    const settings = i18n(el('button', 'tds-menu-item'), 'menu.settings');
    settings.type = 'button';
    settings.dataset.nav = '';
    settings.addEventListener('click', () => this.host.go('settings'));
    const exit = i18n(el('button', 'tds-menu-item'), 'menu.exit');
    exit.type = 'button';
    exit.dataset.nav = '';
    nav.append(start, goals, settings, exit);
    inner.append(title, nav);
    // un browser chiude solo le schede aperte da uno script: altrimenti resta uno schermo nero di congedo
    const bye = el('div', 'tds-exit');
    bye.hidden = true;
    const back = i18n(el('button', 'tds-btn tds-btn-quiet'), 'menu.exitBack');
    back.type = 'button';
    back.dataset.nav = '';
    bye.append(i18n(el('p', 'tds-exit-text'), 'menu.exitDone'), back);
    exit.addEventListener('click', () => {
      this.host.callbacks.onExit?.();
      try { window.close(); } catch { /* ignorato */ }
      window.setTimeout(() => { inner.hidden = true; bye.hidden = false; back.focus(); }, 200);
    });
    back.addEventListener('click', () => { bye.hidden = true; inner.hidden = false; this.host.callbacks.onExitCancelled?.(); exit.focus(); });
    p.append(inner, bye);
    return p;
  }

  // ------------------------------------------------------------ impostazioni

  private buildSettings(): HTMLElement {
    const p = el('section', 'tds-screen tds-settings');
    const panel = el('div', 'tds-panel');
    panel.appendChild(i18n(el('h2', 'tds-h2'), 'settings.title'));

    const row = (labelKey: string, control: HTMLElement, id: string, hintKey?: string) => {
      const r = el('div', 'tds-row');
      const lab = i18n(el('span', 'tds-row-label'), labelKey);
      lab.id = id;
      r.append(lab, control);
      if (hintKey) r.appendChild(i18n(el('p', 'tds-row-hint'), hintKey));
      return r;
    };
    const change = (patch: Partial<GraphicsSettings>) => {
      const s = this.host.settings();
      this.host.changeSettings({ lang: s.lang, gfx: { ...s.gfx, ...patch } });
    };
    const onOff = (id: string, pick: (on: boolean) => void) =>
      segmented<'on' | 'off'>(
        [{ value: 'on', key: 'settings.on' }, { value: 'off', key: 'settings.off' }],
        id,
        (v) => pick(v === 'on'),
      );

    const idLang = this.uid('lang');
    this.setLang = segmented<Lang>(
      [{ value: 'it', text: 'Italiano' }, { value: 'en', text: 'English' }],
      idLang,
      (lang) => {
        const s = this.host.settings();
        if (s.lang !== lang) this.host.changeSettings({ lang, gfx: { ...s.gfx } });
      },
    );
    const firstLang = this.setLang.el.querySelector<HTMLElement>('button');
    if (firstLang) firstLang.dataset.autofocus = '';
    panel.appendChild(row('settings.language', this.setLang.el, idLang));

    panel.appendChild(i18n(el('h3', 'tds-h3'), 'settings.graphics'));
    // Si regolano solo lingua e luminosità: il resto della grafica è sempre al massimo (scelta di Ivan).
    // I controlli sotto restano costruiti ma non vengono mostrati.

    const idB = this.uid('bright');
    this.sBrightness = slider(LIMITS.brightness, idB, (v) => v.toFixed(2), (v) => change({ brightness: v }));
    panel.appendChild(row('settings.brightness', this.sBrightness.el, idB, 'settings.brightnessHint'));

    const idQ = this.uid('quality');
    this.setQuality = segmented<GraphicsSettings['quality']>(
      [
        { value: 'low', key: 'settings.quality.low' },
        { value: 'medium', key: 'settings.quality.medium' },
        { value: 'high', key: 'settings.quality.high' },
      ],
      idQ,
      (q) => {
        const s = this.host.settings();
        this.host.changeSettings({ lang: s.lang, gfx: applyQualityPreset(s.gfx, q) });
      },
    );

    const idS = this.uid('scale');
    this.sScale = slider(LIMITS.renderScale, idS, (v) => `${Math.round(v * 100)}%`, (v) => change({ renderScale: v }));

    const idSh = this.uid('shadows');
    this.setShadows = onOff(idSh, (on) => change({ shadows: on }));

    const idAa = this.uid('aa');
    this.setAa = onOff(idAa, (on) => change({ antialias: on }));

    const idD = this.uid('dist');
    this.sDistance = slider(
      LIMITS.drawDistance,
      idD,
      (v) => t(this.host.lang(), 'settings.meters', { n: Math.round(v) }),
      (v) => change({ drawDistance: v }),
    );
    // il mondo è sempre disegnato per intero: la distanza di disegno non è più un'impostazione

    const idF = this.uid('fog');
    this.setFog = onOff(idF, (on) => change({ fogEffects: on }));

    const back = i18n(el('button', 'tds-btn tds-btn-quiet tds-back'), 'settings.back');
    back.type = 'button';
    back.dataset.nav = '';
    back.addEventListener('click', () => this.host.go('menu'));
    panel.appendChild(back);

    p.appendChild(panel);
    return p;
  }

  // ------------------------------------------------------------ introduzione

  private buildIntro(): HTMLElement {
    const p = el('section', 'tds-screen tds-intro');
    const col = el('div', 'tds-intro-col');
    for (const k of ['intro.p1', 'intro.p2', 'intro.p3', 'intro.p4']) col.appendChild(i18n(el('p', 'tds-intro-p'), k));

    const form = el('form', 'tds-seed-form');
    form.noValidate = true;
    const idInput = this.uid('seed');
    const idErr = this.uid('seed-err');
    const idHelp = this.uid('seed-help');
    const label = i18n(el('label', 'tds-seed-label'), 'intro.seedLabel');
    label.htmlFor = idInput;
    const line = el('div', 'tds-seed-line');
    this.seedInput = el('input', 'tds-seed-input');
    this.seedInput.id = idInput;
    this.seedInput.type = 'text';
    this.seedInput.inputMode = 'numeric';
    this.seedInput.autocomplete = 'off';
    this.seedInput.spellcheck = false;
    this.seedInput.maxLength = 16;
    this.seedInput.dataset.nav = '';
    this.seedInput.dataset.autofocus = '';
    this.seedInput.setAttribute('aria-describedby', `${idHelp} ${idErr}`);
    const urlSeed = seedFromUrl(typeof location !== 'undefined' ? location.search : '');
    if (urlSeed !== null) this.seedInput.value = String(urlSeed);
    this.seedInput.addEventListener('input', () => {
      this.seedDirty = true;
      this.validateSeed();
    });
    const random = i18n(el('button', 'tds-btn tds-btn-quiet'), 'intro.random');
    random.type = 'button';
    random.dataset.nav = '';
    random.addEventListener('click', () => {
      this.seedInput.value = String(randomSeed());
      this.seedDirty = true;
      this.validateSeed();
    });
    line.append(this.seedInput, random);
    const help = i18n(el('p', 'tds-seed-help'), 'intro.seedHelp');
    help.id = idHelp;
    this.seedError = el('p', 'tds-seed-error');
    this.seedError.id = idErr;
    this.seedError.setAttribute('role', 'alert');

    const actions = el('div', 'tds-intro-actions');
    this.playBtn = i18n(el('button', 'tds-btn tds-btn-primary'), 'intro.play');
    this.playBtn.type = 'submit';
    this.playBtn.dataset.nav = '';
    const back = i18n(el('button', 'tds-btn tds-btn-ghost'), 'intro.back');
    back.type = 'button';
    back.dataset.nav = '';
    back.addEventListener('click', () => this.host.go('menu'));
    actions.append(this.playBtn, back);

    form.append(label, line, help, this.seedError, actions);
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      this.seedDirty = true;
      const r = this.validateSeed();
      if (r.ok) this.host.callbacks.onStartGame(r.seed);
    });
    col.appendChild(form);
    p.appendChild(col);
    return p;
  }

  private validateSeed(): ReturnType<typeof parseSeed> {
    const r = parseSeed(this.seedInput.value);
    this.playBtn.disabled = !r.ok;
    const showError = !r.ok && this.seedDirty;
    this.seedError.textContent = showError ? t(this.host.lang(), `intro.err.${r.reason}`) : '';
    this.seedInput.classList.toggle('is-invalid', showError);
    this.seedInput.setAttribute('aria-invalid', showError ? 'true' : 'false');
    return r;
  }

  // ------------------------------------------------------------ pausa

  private buildPause(): HTMLElement {
    const p = el('section', 'tds-screen tds-pause');
    const panel = el('div', 'tds-panel tds-panel-narrow');
    panel.appendChild(i18n(el('h2', 'tds-h2'), 'pause.title'));

    this.pauseMain = el('div', 'tds-pause-main');
    const resume = i18n(el('button', 'tds-btn tds-btn-primary'), 'pause.resume');
    resume.type = 'button';
    resume.dataset.nav = '';
    resume.dataset.autofocus = '';
    resume.addEventListener('click', () => this.host.callbacks.onResume());
    const toMenu = i18n(el('button', 'tds-btn tds-btn-quiet'), 'pause.toMenu');
    toMenu.type = 'button';
    toMenu.dataset.nav = '';
    toMenu.addEventListener('click', () => this.setConfirm(true));
    const controls = el('div', 'tds-controls');
    controls.appendChild(i18n(el('h3', 'tds-h3'), 'pause.controls'));
    const list = el('ul', 'tds-controls-list');
    for (const k of ['hint.move', 'hint.run', 'hint.interact', 'hint.torch', 'hint.phone', 'hint.map', 'hint.cctv', 'hint.pause']) {
      list.appendChild(i18n(el('li'), k));
    }
    controls.appendChild(list);
    this.pauseMain.append(resume, toMenu, controls);

    this.pauseConfirm = el('div', 'tds-pause-confirm');
    this.pauseConfirm.hidden = true;
    this.pauseConfirm.setAttribute('role', 'alertdialog');
    const idT = this.uid('confirm');
    const ct = i18n(el('h3', 'tds-confirm-title'), 'pause.confirmTitle');
    ct.id = idT;
    this.pauseConfirm.setAttribute('aria-labelledby', idT);
    const text = i18n(el('p', 'tds-confirm-text'), 'pause.confirmText');
    const no = i18n(el('button', 'tds-btn tds-btn-primary'), 'pause.confirmNo');
    no.type = 'button';
    no.dataset.nav = '';
    no.addEventListener('click', () => this.setConfirm(false));
    const yes = i18n(el('button', 'tds-btn tds-btn-danger'), 'pause.confirmYes');
    yes.type = 'button';
    yes.dataset.nav = '';
    yes.addEventListener('click', () => {
      this.setConfirm(false);
      this.host.callbacks.onAbandon();
    });
    this.pauseConfirm.append(ct, text, no, yes);

    this.pauseSeed = el('p', 'tds-pause-seed');
    panel.append(this.pauseMain, this.pauseConfirm, this.pauseSeed);
    p.appendChild(panel);
    return p;
  }

  private setConfirm(open: boolean): void {
    this.pauseConfirm.hidden = !open;
    this.pauseMain.hidden = open;
    if (this.active !== 'pause') return;
    const target = (open ? this.pauseConfirm : this.pauseMain).querySelector<HTMLElement>('button');
    if (target) target.focus({ preventScroll: true });
  }

  // ------------------------------------------------------------ obiettivi

  private achBody!: HTMLElement;

  private buildAchievements(): HTMLElement {
    const p = el('section', 'tds-screen tds-achievements');
    const panel = el('div', 'tds-panel tds-profile');
    const back = i18n(el('button', 'tds-btn tds-btn-quiet tds-profile-back'), 'profile.back');
    back.type = 'button';
    back.dataset.nav = '';
    back.dataset.autofocus = '';
    back.addEventListener('click', () => this.host.go('menu'));
    this.achBody = el('div', 'tds-ach-body');
    panel.append(back, i18n(el('h2', 'tds-h2'), 'profile.title'), this.achBody);
    p.appendChild(panel);
    return p;
  }

  private renderAchievements(): void {
    const lang = this.host.lang();
    const prog = loadProgress();
    const account = currentAccount();
    const body = this.achBody;
    body.textContent = '';
    const got = ACHIEVEMENTS.filter((a) => prog.unlocked[a.id]).length;
    const pct = Math.round((got / ACHIEVEMENTS.length) * 100);

    // intestazione: chi sei e a che punto sei
    const head = el('div', 'tds-profile-head');
    const who = el('div', 'tds-profile-who');
    who.append(
      el('div', 'tds-profile-avatar', account.name.slice(0, 1).toUpperCase()),
      el('div', 'tds-profile-id'),
    );
    const id = who.lastElementChild as HTMLElement;
    id.append(
      el('div', 'tds-profile-username', account.name),
      el('div', 'tds-profile-rank', t(lang, `profile.rank.${rankOf(prog)}`)),
      el('div', 'tds-profile-note', t(lang, 'profile.localNote')),
    );
    const done = el('div', 'tds-profile-progress');
    done.append(
      el('div', 'tds-profile-big', String(got)),
      el('div', 'tds-profile-caption', t(lang, 'profile.stat.achievements')),
    );
    const big = done.firstElementChild as HTMLElement;
    big.appendChild(el('small', undefined, ` / ${ACHIEVEMENTS.length}`));
    const bar = el('div', 'tds-profile-bar');
    const fill = el('i');
    fill.style.width = `${pct}%`;
    bar.appendChild(fill);
    done.appendChild(bar);
    head.append(who, done);
    body.appendChild(head);

    // statistiche in due gruppi
    const tt = prog.totals;
    const hours = Math.floor(tt.seconds / 3600), mins = Math.round((tt.seconds % 3600) / 60);
    const fav = favouriteSeed(prog);
    const groups: [string, [string, string][]][] = [
      ['profile.career', [
        ['profile.stat.shifts', String(prog.shifts)],
        ['profile.stat.completed', String(prog.completed)],
        ['profile.stat.seeds', String(prog.seeds.length)],
        ['profile.stat.favourite', fav === null ? '–' : String(fav)],
        ['profile.stat.time', hours ? `${hours} h ${mins} min` : `${mins} min`],
        ['profile.stat.longest', tt.longest ? formatDuration(tt.longest) : '–'],
      ]],
      ['profile.field', [
        ['profile.stat.distance', `${(tt.meters / 1000).toFixed(1)} km`],
        ['profile.stat.tasks', String(tt.tasks)],
        ['profile.stat.calls', String(tt.calls)],
        ['profile.stat.blackouts', String(tt.blackouts)],
        ['profile.stat.cctv', String(tt.cctv)],
        ['profile.stat.rides', String(tt.rides)],
      ]],
    ];
    const cols = el('div', 'tds-profile-cols');
    for (const [title, rows] of groups) {
      const card = el('div', 'tds-profile-card');
      card.appendChild(el('h3', 'tds-h3', t(lang, title)));
      const dl = el('dl', 'tds-profile-rows');
      for (const [k, v] of rows) { const r = el('div', 'tds-profile-row'); r.append(el('dt', undefined, t(lang, k)), el('dd', undefined, v)); dl.appendChild(r); }
      card.appendChild(dl);
      cols.appendChild(card);
    }
    body.appendChild(cols);

    // seed recenti: un clic li gioca di nuovo
    body.appendChild(el('h3', 'tds-h3', t(lang, 'profile.recent')));
    if (prog.recent.length) {
      const chips = el('div', 'tds-profile-seeds');
      for (const sd of prog.recent) {
        const b = el('button', `tds-seed-chip${sd === fav ? ' is-fav' : ''}`, String(sd));
        b.type = 'button'; b.dataset.nav = '';
        b.title = t(lang, 'profile.playSeed', { seed: sd, n: prog.seedPlays[String(sd)] ?? 1 });
        b.addEventListener('click', () => this.host.callbacks.onStartGame(sd));
        chips.appendChild(b);
      }
      body.appendChild(chips);
    } else body.appendChild(el('p', 'tds-muted tds-profile-empty', t(lang, 'profile.noSeeds')));

    // obiettivi: sbloccati, poi da sbloccare
    const unlocked = ACHIEVEMENTS.filter((a) => prog.unlocked[a.id]);
    const locked = ACHIEVEMENTS.filter((a) => !prog.unlocked[a.id]);
    const section = (key: string, defs: typeof ACHIEVEMENTS) => {
      body.appendChild(el('h3', 'tds-h3', t(lang, key, { n: defs.length })));
      if (!defs.length) { body.appendChild(el('p', 'tds-muted tds-profile-empty', t(lang, 'profile.noneYet'))); return; }
      const list = el('ul', 'tds-ach-list tds-ach-grid');
      for (const a of defs) {
        const u = prog.unlocked[a.id];
        const li = el('li', `tds-ach${u ? ' is-unlocked' : ''}`);
        const hidden = !u && a.secret;
        li.append(el('span', 'tds-ach-name', hidden ? '???' : a.name[lang]), el('span', 'tds-ach-desc', hidden ? t(lang, 'achievements.secret') : a.desc[lang]));
        if (u) li.appendChild(el('span', 'tds-ach-seed', t(lang, 'achievements.seed', { seed: u.seed })));
        list.appendChild(li);
      }
      body.appendChild(list);
    };
    section('profile.unlocked', unlocked);
    section('profile.locked', locked);
  }

  // ------------------------------------------------------------ riepilogo

  private buildSummary(): HTMLElement {
    const p = el('section', 'tds-screen tds-summary');
    this.summaryBody = el('div', 'tds-summary-col');
    p.appendChild(this.summaryBody);
    return p;
  }

  showSummary(view: SummaryView): void {
    const lang = this.host.lang();
    const body = this.summaryBody;
    body.textContent = '';
    body.appendChild(i18n(el('h2', 'tds-summary-title'), 'summary.title'));
    if (view.reason !== 'handover') body.appendChild(i18n(el('p', 'tds-muted'), view.reason === 'timeout' ? 'summary.timeout' : 'summary.abandoned'));

    const facts = el('dl', 'tds-facts');
    const fact = (key: string, value: string) => {
      const d = el('div', 'tds-fact');
      d.append(i18n(el('dt'), key), el('dd', undefined, value));
      facts.appendChild(d);
    };
    fact('summary.seed', String(view.seed));
    fact('summary.guard', view.guard);
    fact('summary.duration', formatDuration(view.durationSeconds));
    fact('summary.tasks', `${view.done} · ${view.late} ${t(lang, 'summary.late')} · ${view.missed} ${t(lang, 'summary.missed')}`);
    body.appendChild(facts);

    const copyRow = (value: string, btnKey: string, labelKey: string, wide: boolean) => {
      const r = el('div', `tds-copy-row${wide ? ' is-wide' : ''}`);
      const field = el('input', 'tds-copy-field');
      field.type = 'text'; field.readOnly = true; field.value = value;
      i18nAria(field, labelKey);
      field.addEventListener('focus', () => field.select());
      const btn = i18n(el('button', 'tds-btn tds-btn-quiet'), btnKey);
      btn.type = 'button'; btn.dataset.nav = '';
      const status = el('span', 'tds-copy-status');
      status.setAttribute('role', 'status');
      let timer = 0;
      btn.addEventListener('click', () => {
        void copyText(value, field).then((ok) => {
          status.textContent = t(this.host.lang(), ok ? 'summary.copied' : 'summary.copyManual');
          if (!ok) field.select();
          window.clearTimeout(timer);
          timer = window.setTimeout(() => { status.textContent = ''; }, 3200);
        });
      });
      r.append(field, btn, status);
      return r;
    };
    body.appendChild(copyRow(String(view.seed), 'summary.copySeed', 'summary.seed', false));
    if (view.shareUrl) {
      body.appendChild(i18n(el('p', 'tds-summary-sub'), 'summary.shareLink'));
      body.appendChild(copyRow(view.shareUrl, 'summary.copyLink', 'summary.shareLink', true));
    }

    if (view.achievements && view.achievements.length) {
      body.appendChild(i18n(el('h3', 'tds-h3'), 'summary.achievements'));
      const list = el('ul', 'tds-ach-list is-new');
      for (const id of view.achievements) {
        const a = ACHIEVEMENTS.find((x) => x.id === id);
        if (!a) continue;
        const li = el('li', 'tds-ach is-unlocked');
        li.append(el('span', 'tds-ach-name', a.name[lang]), el('span', 'tds-ach-desc', a.desc[lang]));
        list.appendChild(li);
      }
      body.appendChild(list);
    }

    body.appendChild(i18n(el('h3', 'tds-h3'), 'summary.log'));
    const tl = el('ol', 'tds-chronicle');
    for (const r of view.tasks) {
      const li = el('li', `tds-chronicle-row${r.done ? '' : ' is-unseen'}`);
      li.append(el('span', 'tds-chronicle-time', r.issued), el('span', 'tds-chronicle-place', r.place),
        el('span', 'tds-chronicle-text', `${r.title} · ${r.done ? `${r.done}${r.late ? ` (${t(lang, 'summary.late')})` : ''}` : t(lang, 'summary.notDone')}`));
      tl.appendChild(li);
    }
    body.appendChild(tl);

    if (view.patients.length) {
      body.appendChild(i18n(el('h3', 'tds-h3'), 'summary.patients'));
      for (const p of view.patients) {
        const d = el('div', 'tds-story');
        d.append(el('h4', 'tds-story-title', `${p.name} · ${t(lang, 'summary.room', { n: p.room })}`), el('p', 'tds-story-text', p.story));
        body.appendChild(d);
      }
    }

    if (view.chronicle.length) {
      body.appendChild(i18n(el('h3', 'tds-h3'), 'summary.chronicle'));
      body.appendChild(i18n(el('p', 'tds-muted tds-chronicle-note'), 'summary.chronicleNote'));
      const list = el('ol', 'tds-chronicle');
      for (const c of view.chronicle) {
        const li = el('li', `tds-chronicle-row${c.strange ? ' is-rare' : ''}${c.seen ? '' : ' is-unseen'}`);
        li.append(el('span', 'tds-chronicle-time', c.time), el('span', 'tds-chronicle-place', c.place), el('span', 'tds-chronicle-text', c.text));
        if (!c.seen) li.appendChild(i18n(el('span', 'tds-chronicle-tag'), 'summary.unseen'));
        list.appendChild(li);
      }
      body.appendChild(list);
      const text = view.chronicle.map((c) => `${c.time}  ${c.place}  ${c.text}`).join('\n');
      const dl = i18n(el('button', 'tds-btn tds-btn-quiet tds-chronicle-dl'), 'summary.downloadLog');
      dl.type = 'button'; dl.dataset.nav = '';
      dl.addEventListener('click', () => {
        try {
          const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
          const a = document.createElement('a');
          a.href = url; a.download = `the-hospital-seed-${view.seed}.txt`;
          document.body.appendChild(a); a.click(); a.remove();
          window.setTimeout(() => URL.revokeObjectURL(url), 2000);
        } catch { /* il registro resta leggibile a schermo */ }
      });
      body.appendChild(dl);
    }

    const back = i18n(el('button', 'tds-btn tds-btn-primary tds-summary-back'), 'summary.toMenu');
    back.type = 'button'; back.dataset.nav = ''; back.dataset.autofocus = '';
    back.addEventListener('click', () => this.host.callbacks.onBackToMenu());
    body.appendChild(back);
    applyI18n(body, lang);
  }
}
