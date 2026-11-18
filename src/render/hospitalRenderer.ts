// Rendering dell'ospedale con Babylon.js: geometria statica con luce precalcolata, oggetti mobili,
// addobbi, cartelli, precipitazioni, videosorveglianza (telecamera fissa, post-elaborazione e monitor in reception).
import { Camera } from '@babylonjs/core/Cameras/camera';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { Constants } from '@babylonjs/core/Engines/constants';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3, Vector4 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { PostProcess } from '@babylonjs/core/PostProcesses/postProcess';
import type { Scene } from '@babylonjs/core/scene';
import type { Lang } from '../core/contracts';
import { Rng } from '../core/rng';
import type { Shift } from '../game/shift';
import { COL, MAX_PW, PWR_ALWAYS, PWR_MAIN, box, cbox, powerOfFloor, shade, type Box, type PowerIdx, type RGB } from '../world/geom';
import { BX0, CEIL, ELEV, FLOORS, H, doorPoint, floorY, type Cam, type Obj, type Sign } from '../world/hospital';
import { Baker, addBox, addCyl, bakeAt, emptyArrays, type MeshArrays } from './bake';
import { HAIR, personBoxes } from './people';
import { MAX_DYN } from './shaders';

export const LAYER_BASE = 0x1, LAYER_LIVE = 0x2, LAYER_CCTV = 0x4;
const FLAG = { x: 4.5, z: -7.5 };
export const MASK_MAIN = LAYER_BASE | LAYER_LIVE, MASK_CCTV = LAYER_BASE | LAYER_CCTV;

const FIXED_DIM = { on: [0.55, 0.55, 0.55] as RGB, off: [0.12, 0.12, 0.14] as RGB };

interface Bulb { mat: StandardMaterial; col: Color3; phase: number; p: PowerIdx; speed: number }

export class HospitalRenderer {
  readonly mat: ShaderMaterial;
  private readonly baker: Baker;
  private readonly meshes: Mesh[] = [];
  private readonly doorNodes = new Map<string, TransformNode>();
  private readonly cab: TransformNode;
  private readonly landing: { l: TransformNode; r: TransformNode }[] = [];
  private readonly figures: { node: TransformNode; mesh: Mesh }[] = [];
  private readonly winNodes = new Map<string, TransformNode>();
  private readonly breakerNodes = new Map<string, { lever: TransformNode; led: StandardMaterial }>();
  private readonly callLamps = new Map<string, StandardMaterial>();
  private readonly panelBtns = new Map<string, StandardMaterial>();
  private readonly cabBtns: StandardMaterial[] = [];
  private readonly patientNodes = new Map<string, { lie: TransformNode; sit: TransformNode; walk: TransformNode; floor: TransformNode; meshes: Mesh[] }>();
  private santaNode: TransformNode | null = null;
  private readonly flag: TransformNode[] = [];
  private readonly camLeds = new Map<string, StandardMaterial>();
  private readonly avatar: TransformNode;
  private readonly hand: TransformNode;
  private readonly handItems: Record<string, Mesh> = {};
  private readonly bulbs: Bulb[] = [];
  private readonly signMats = new Map<number, ShaderMaterial>();
  private readonly signTex: CanvasTex;
  private readonly signs: Sign[];
  private readonly displays: { tex: CanvasTex; f: number | 'cab'; last: string }[] = [];
  private readonly phoneLed: StandardMaterial;
  private readonly statusLeds: StandardMaterial[] = [];
  private readonly precip: Mesh;
  private readonly precipMat: ShaderMaterial;
  readonly cctvCam: UniversalCamera;
  private readonly cctvPP: PostProcess;
  private readonly deskCam: UniversalCamera;
  private readonly rtt: RenderTargetTexture;
  private readonly monitorMat: ShaderMaterial;
  private deskIdx = 0;
  private deskT = 0;
  private time = 0;
  private cctvState = { ir: 0, noSignal: 0, glitch: 0 };
  private readonly dyn = new Float32Array(MAX_DYN * 4);
  private readonly dynC = new Float32Array(MAX_DYN * 4);

  constructor(private readonly scene: Scene, private readonly shift: Shift, private readonly mainCam: Camera, private lang: Lang) {
    const h = shift.h;
    scene.clearColor = new Color4(0.035, 0.045, 0.08, 1);
    this.baker = new Baker(h.lamps);
    this.mat = new ShaderMaterial('ths', scene, { vertex: 'ths', fragment: 'ths' }, {
      attributes: ['position', 'normal', 'color', 'bakeOn', 'bakeOff', 'pidx'],
      uniforms: ['world', 'viewProjection', 'power', 'camPos', 'spotPos', 'spotDir', 'dlPos', 'dlCol', 'fogColor', 'fogDensity', 'exposure', 'irLight', 'time'],
    });
    this.mat.backFaceCulling = false;
    mainCam.layerMask = MASK_MAIN;

    // ---- geometria statica, divisa in blocchi per piano
    const chunks = new Map<string, MeshArrays>();
    const chunkOf = (b: { y0: number; zone: string; x0?: number }) => {
      const k = b.zone === 'out' ? 'out' : b.zone === 'stairs' || b.zone === 'shaft' ? 'core' : `f${Math.max(-1, Math.min(2, Math.floor((b.y0 + 0.4) / H)))}`;
      let m = chunks.get(k);
      if (!m) { m = emptyArrays(); chunks.set(k, m); }
      return m;
    };
    for (const b of h.boxes) addBox(chunkOf(b), b, this.baker);
    for (const c of h.cyls) addCyl(chunkOf(c), c, this.baker);
    // cornici delle finestre e alberi di Natale
    for (const w of h.windows) for (const b of windowFrame(w)) addBox(chunkOf(b), b, this.baker);
    const rng = new Rng(`render/${shift.seed}`);
    for (const t of h.trees) this.buildTree(chunkOf({ y0: t.y, zone: t.zone }), t, rng);
    for (const g of h.garlands) this.buildGarland(chunkOf({ y0: g.pts[0].y - 2, zone: `${g.f}:corr` }), g.f, g.pts, rng);
    for (const c of h.cams) this.buildCamModel(c, chunkOf({ y0: c.y - 2.5, zone: `${c.f}:corr` }));
    for (const [k, m] of chunks) this.meshes.push(this.toMesh(`static-${k}`, m));

    // ---- porte delle stanze
    for (const d of h.doors) {
      const node = new TransformNode(`door-${d.id}`, scene);
      if (d.axis === 'x') node.position.set(d.x0, floorY(d.f), d.z);
      else node.position.set(d.z, floorY(d.f), d.x0);
      const m = emptyArrays();
      const w = d.x1 - d.x0;
      const lp = doorPoint(d, -0.4);
      const lit = bakeAt(this.baker, d.zoneOut, lp.x, floorY(d.f) + 1.2, lp.z);
      const col = d.locked ? COL.doorWood : COL.door;
      addBox(m, box(0.02, w - 0.02, 0, 2.12, -0.025, 0.025, col, 'x', powerOfFloor(d.f)), null, lit);
      addBox(m, box(w - 0.18, w - 0.1, 1.0, 1.06, -0.07, 0.07, COL.metal, 'x', powerOfFloor(d.f)), null, lit);
      addBox(m, box(w * 0.3, w * 0.7, 1.4, 1.85, -0.03, 0.03, shade(col, 1.15), 'x', powerOfFloor(d.f)), null, lit);
      if (d.wreath) {
        // la ghirlanda è appesa all'anta, sul lato del corridoio: si muove con la porta
        const zs = (d.axis === 'x' ? -d.side : d.side) * 0.06;
        addCyl(m, { x: w / 2, z: zs, y0: 1.5, y1: 1.58, r0: 0.18, r1: 0.18, seg: 10, c: COL.pine, zone: 'x', p: powerOfFloor(d.f) }, null, lit);
        addBox(m, cbox(w / 2, zs, 1.38, 0.09, 0.04, 0.12, COL.red, 'x', powerOfFloor(d.f)), null, lit);
      }
      const mesh = this.toMesh(`doorleaf-${d.id}`, m);
      mesh.parent = node;
      (node as unknown as { side: number }).side = d.side;
      this.doorNodes.set(d.id, node);
    }

    // ---- ascensore: cabina mobile e porte di piano
    this.cab = new TransformNode('cab', scene);
    this.buildCab();
    for (const f of FLOORS) {
      const y = floorY(f);
      const mk = (x0: number, x1: number) => {
        const n = new TransformNode(`land-${f}`, scene);
        const m = emptyArrays();
        const lit = bakeAt(this.baker, `${f}:corr`, ELEV.cx, y + 1.2, -0.8);
        addBox(m, box(x0, x1, y, y + 2.1, -1.56, -1.5, [0.68, 0.7, 0.72], 'x', powerOfFloor(f)), null, lit);
        const mesh = this.toMesh(`landdoor-${f}`, m); mesh.parent = n;
        return n;
      };
      const mid = (ELEV.doorX0 + ELEV.doorX1) / 2;
      this.landing.push({ l: mk(ELEV.doorX0, mid), r: mk(mid, ELEV.doorX1) });
      this.displays.push({ tex: this.displayPlane(`disp-${f}`, ELEV.cx, y + 2.32, -1.405, 0, 1, 0.42, 0.16), f, last: '' });
    }

    // ---- vetro
    const glass = new StandardMaterial('glass', scene);
    glass.diffuseColor = new Color3(0.4, 0.5, 0.6); glass.alpha = 0.16; glass.specularColor = new Color3(0.4, 0.4, 0.4);
    glass.emissiveColor = new Color3(0.05, 0.06, 0.09); glass.backFaceCulling = false; glass.disableLighting = true;
    // ---- vetri delle finestre (si aprono a battente verso l'interno)
    for (const w of h.windows) {
      const n = new TransformNode(`win-${w.id}`, scene);
      const len = w.a1 - w.a0, inward = -w.out * 0.04;
      if (w.axis === 'x') { n.position.set(w.a0, 0, w.at + inward); this.simpleBox(0, len, w.y0, w.y1, -0.01, 0.01, glass).parent = n; }
      else { n.position.set(w.at + inward, 0, w.a0); this.simpleBox(-0.01, 0.01, w.y0, w.y1, 0, len, glass).parent = n; }
      (n as unknown as { win: typeof w }).win = w;
      this.winNodes.set(w.id, n);
    }

    // ---- quadro elettrico: leve e spie
    for (const o of h.objs.filter((x) => x.kind === 'breaker')) {
      const n = new TransformNode(`brk-${o.id}`, scene);
      n.position.set(o.x, o.y, o.z);
      const m = emptyArrays();
      const big = o.data === 'main';
      addBox(m, box(-0.04, 0.04, -0.02, big ? 0.22 : 0.16, -0.05, 0.05, big ? COL.red : COL.dark, 'x', PWR_ALWAYS), null, FIXED_DIM);
      const lever = new TransformNode('lever', scene); lever.parent = n;
      this.toMesh(`lever-${o.id}`, m).parent = lever;
      const led = this.emissive(`led-${o.id}`, new Color3(0.2, 1, 0.3));
      const ledMesh = this.simpleBox(-0.03, 0.03, 0.3, 0.36, -0.07, -0.05, led); ledMesh.parent = n;
      this.breakerNodes.set(o.id, { lever, led });
    }

    // ---- spie delle chiamate sopra le porte e pulsantiera della reception
    for (const pt of h.patients) {
      const d = h.doors.find((x) => x.room === pt.room)!;
      if (!this.callLamps.has(pt.room)) {
        const m = this.emissive(`call-${pt.room}`, new Color3(1, 0.25, 0.15));
        const q = doorPoint(d, -0.09), ax = d.axis === 'x';
        this.simpleBox(q.x - (ax ? 0.12 : 0.04), q.x + (ax ? 0.12 : 0.04), floorY(d.f) + 2.22, floorY(d.f) + 2.34, q.z - (ax ? 0.04 : 0.12), q.z + (ax ? 0.04 : 0.12), m);
        this.callLamps.set(pt.room, m);
      }
    }
    for (const o of h.objs.filter((x) => x.kind === 'callbtn')) {
      const urgent = o.data?.endsWith('urgent');
      const m = this.emissive(`btn-${o.id}`, urgent ? new Color3(1, 0.15, 0.1) : new Color3(1, 0.72, 0.15));
      this.simpleBox(o.x - 0.05, o.x + 0.05, o.y - 0.02, o.y + 0.01, o.z - 0.05, o.z + 0.05, m);
      this.panelBtns.set(o.id, m);
    }
    // quadretto di stato sulla scrivania: generale e tre piani, più il piano dell'ascensore
    for (let k = 0; k < 4; k++) {
      const m = this.emissive(`stled-${k}`, new Color3(0.2, 1, 0.35));
      const x = -1.45 + k * 0.13;
      this.simpleBox(x - 0.025, x + 0.025, 0.96, 1.0, 6.26, 6.275, m);
      this.statusLeds.push(m);
    }
    this.displays.push({ tex: this.displayPlane('disp-status', -0.82, 0.88, 6.27, 0, 1, 0.42, 0.13), f: 'cab', last: '' });
    this.phoneLed = this.emissive('phoneLed', new Color3(1, 0.1, 0.1));
    const ph = h.objs.find((o) => o.id === 'phone-0')!;
    this.simpleBox(ph.x + 0.07, ph.x + 0.11, ph.y, ph.y + 0.02, ph.z - 0.06, ph.z - 0.02, this.phoneLed);

    // ---- persone
    for (const pt of h.patients) {
      const room = h.rooms.find((r) => r.id === pt.room)!;
      const lit = bakeAt(this.baker, room.zone, pt.x, floorY(pt.f) + 1.0, pt.z);
      const body: RGB = COL.gown;
      const hair = HAIR[Math.abs(pt.age) % HAIR.length];
      const meshes: Mesh[] = [];
      const walkLit = { on: [0.5, 0.5, 0.5] as RGB, off: [0.2, 0.2, 0.22] as RGB };
      const mk = (pose: 'lie' | 'sitbed' | 'walk' | 'floor') => {
        const n = new TransformNode(`pt-${pt.id}-${pose}`, scene);
        n.position.set(pt.x, floorY(pt.f), pt.z);
        // il letto è lungo +u: la sagoma distesa ha la testa verso +x locale
        n.rotation.y = pt.yaw - Math.PI / 2;
        const m = emptyArrays();
        for (const b of personBoxes(pose, body, hair, powerOfFloor(pt.f))) addBox(m, b, null, pose === 'walk' || pose === 'floor' ? walkLit : lit);
        const mesh = this.toMesh(`ptm-${pt.id}-${pose}`, m);
        mesh.parent = n;
        meshes.push(mesh);
        if (pose === 'walk' || pose === 'floor') n.setEnabled(false);
        return n;
      };
      this.patientNodes.set(pt.id, { lie: mk('lie'), sit: mk('sitbed'), walk: mk('walk'), floor: mk('floor'), meshes });
    }
    for (const s of h.staff) {
      const room = h.rooms.find((r) => r.f === s.f && r.kind === 'nurse')!;
      const lit = bakeAt(this.baker, room.zone, s.x, floorY(s.f) + 1.0, s.z);
      const n = new TransformNode(`nurse-${s.id}`, scene);
      n.position.set(s.x, floorY(s.f), s.z); n.rotation.y = s.yaw;
      const m = emptyArrays();
      for (const b of personBoxes('sit', COL.scrubs, s.first.length % 2 ? [0.3, 0.2, 0.12] : [0.12, 0.1, 0.08], powerOfFloor(s.f), [0.8, 0.62, 0.5])) addBox(m, b, null, lit);
      addBox(m, box(-0.25, 0.25, 0, 0.45, -0.25, 0.25, COL.dark, 'x', powerOfFloor(s.f)), null, lit);
      this.toMesh(`nm-${s.id}`, m).parent = n;
    }
    // il Babbo Natale di plastica del soggiorno: di notte cambia posto
    if (h.santa) {
      this.santaNode = new TransformNode('santa', scene);
      const sm = emptyArrays();
      for (const b of personBoxes('santa', COL.red, COL.white, PWR_ALWAYS)) addBox(sm, b, null, { on: [0.62, 0.6, 0.58], off: [0.3, 0.28, 0.28] });
      this.toMesh('santa-m', sm).parent = this.santaNode;
    }
    // il guardiano, visto solo dalle telecamere
    this.avatar = new TransformNode('avatar', scene);
    const am = emptyArrays();
    for (const b of personBoxes('stand', [0.14, 0.18, 0.3], [0.08, 0.09, 0.14], PWR_ALWAYS)) addBox(am, b, null, { on: [0.5, 0.5, 0.5], off: [0.22, 0.22, 0.24] });
    const avMesh = this.toMesh('avatar-m', am);
    avMesh.parent = this.avatar; avMesh.layerMask = LAYER_CCTV;

    // ---- oggetto in mano (solo dal vivo)
    this.hand = new TransformNode('hand', scene);
    this.hand.parent = mainCam;
    this.hand.position.set(0.24, -0.27, 0.52);
    const handMat = (c: Color3) => { const m = new StandardMaterial('hm', scene); m.disableLighting = true; m.emissiveColor = c; return m; };
    const mkHand = (k: string, w: number, hh: number, d: number, c: Color3) => {
      const m = this.simpleBox(-w / 2, w / 2, -hh / 2, hh / 2, -d / 2, d / 2, handMat(c));
      m.parent = this.hand; m.layerMask = LAYER_LIVE; m.renderingGroupId = 1; m.setEnabled(false);
      this.handItems[k] = m;
    };
    mkHand('water', 0.07, 0.1, 0.07, new Color3(0.55, 0.7, 0.85));
    mkHand('tea', 0.08, 0.08, 0.08, new Color3(0.85, 0.82, 0.75));
    mkHand('blanket', 0.3, 0.12, 0.22, new Color3(0.35, 0.48, 0.65));
    mkHand('samples', 0.18, 0.12, 0.08, new Color3(0.75, 0.75, 0.8));
    scene.setRenderingAutoClearDepthStencil(1, true);
    // ---- figure degli eventi insoliti: sagome scure, visibili dal vivo o solo dalle telecamere
    const dark = new StandardMaterial('figure', scene);
    dark.disableLighting = true; dark.emissiveColor = new Color3(0.012, 0.012, 0.016); dark.diffuseColor = Color3.Black(); dark.specularColor = Color3.Black();
    for (let k = 0; k < 4; k++) {
      const node = new TransformNode(`fig-${k}`, scene);
      const fm = emptyArrays();
      for (const b of personBoxes('stand', [0.02, 0.02, 0.025], [0.01, 0.01, 0.01], PWR_ALWAYS, [0.03, 0.03, 0.035])) addBox(fm, { ...b, y0: b.y0 * 1.1, y1: b.y1 * 1.1 }, null, FIXED_DIM);
      const mesh = new Mesh(`figm-${k}`, scene);
      const vd = new VertexData(); vd.positions = fm.pos; vd.normals = fm.nrm; vd.indices = fm.idx; vd.applyToMesh(mesh, false);
      mesh.material = dark; mesh.isPickable = false; mesh.parent = node;
      node.setEnabled(false);
      this.figures.push({ node, mesh });
    }

    // ---- cartelli
    this.signs = h.signs;
    this.signTex = new CanvasTex(scene, 2048, 2048, true);
    this.buildSigns();

    // ---- precipitazioni
    this.precipMat = new ShaderMaterial('precip', scene, { vertex: 'thsPrecip', fragment: 'thsPrecip' }, {
      attributes: ['position', 'uv'], uniforms: ['viewProjection', 'camPos', 'camRight', 'camUp', 'time', 'params', 'tint'], needAlphaBlending: true,
    });
    this.precipMat.backFaceCulling = false; this.precipMat.disableDepthWrite = true;
    this.precip = this.buildPrecip(shift.weather.kind === 'rain' ? 2600 : 3200);
    // la bandiera sul tetto, illuminata dal basso: sventola, e dal menu si vede
    {
      const top = floorY(FLOORS[FLOORS.length - 1]) + H + 0.42;
      const pole = new StandardMaterial('pole', scene); pole.disableLighting = true; pole.emissiveColor = new Color3(0.45, 0.46, 0.5);
      const pm = this.simpleBox(FLAG.x - 0.07, FLAG.x + 0.07, top, top + 7.5, FLAG.z - 0.07, FLAG.z + 0.07, pole); void pm;
      this.simpleBox(FLAG.x - 0.12, FLAG.x + 0.12, top + 7.5, top + 7.72, FLAG.z - 0.12, FLAG.z + 0.12, pole);
      const cols = [new Color3(0.05, 0.42, 0.2), new Color3(0.86, 0.86, 0.84), new Color3(0.72, 0.08, 0.1)];
      for (let i = 0; i < 15; i++) {
        const n = new TransformNode(`flag-${i}`, scene);
        n.position.set(FLAG.x + 0.06 + i * 0.24, top + 5.2, FLAG.z);
        const m = new StandardMaterial(`flagm-${i}`, scene); m.disableLighting = true; m.backFaceCulling = false;
        m.emissiveColor = cols[Math.floor(i / 5)].scale(0.8);
        const mesh = this.simpleBox(0, 0.25, 0, 2.2, -0.015, 0.015, m); mesh.parent = n;
        this.flag.push(n);
      }
    }

    // ---- videosorveglianza
    this.cctvCam = new UniversalCamera('cctv', new Vector3(0, 2, 0), scene);
    this.cctvCam.inputs.clear(); this.cctvCam.minZ = 0.05; this.cctvCam.maxZ = 900; this.cctvCam.layerMask = MASK_CCTV;
    this.cctvPP = new PostProcess('cctvPP', 'thsCctv', ['time', 'ir', 'noSignal', 'glitch'], null, 1, this.cctvCam);
    this.cctvPP.onApply = (e) => { e.setFloat('time', this.time); e.setFloat('ir', this.cctvState.ir); e.setFloat('noSignal', this.cctvState.noSignal); e.setFloat('glitch', this.cctvState.glitch); };
    this.deskCam = new UniversalCamera('deskCam', new Vector3(0, 2, 0), scene);
    this.deskCam.inputs.clear(); this.deskCam.minZ = 0.05; this.deskCam.maxZ = 600; this.deskCam.layerMask = MASK_CCTV;
    this.rtt = new RenderTargetTexture('deskFeed', { width: 384, height: 256 }, scene, false);
    this.rtt.activeCamera = this.deskCam;
    this.rtt.refreshRate = 3;
    this.rtt.renderList = [];
    scene.customRenderTargets.push(this.rtt);
    this.monitorMat = new ShaderMaterial('monitor', scene, { vertex: 'thsMonitor', fragment: 'thsMonitor' }, { attributes: ['position', 'uv'], uniforms: ['worldViewProjection', 'time', 'power', 'noSignal'], samplers: ['feed'] });
    this.monitorMat.setTexture('feed', this.rtt);
    const con = h.objs.find((o) => o.id === 'cctv-console')!;
    const scr = this.plane('deskScreen', con.x, 1.06, con.z - 0.094, 0, 1, 0.54, 0.42);
    scr.material = this.monitorMat;
    for (const m of scene.meshes) if (m !== scr && m.layerMask & LAYER_CCTV) this.rtt.renderList.push(m);
  }

  // ------------------------------------------------------------ costruzione

  private toMesh(name: string, m: MeshArrays): Mesh {
    const mesh = new Mesh(name, this.scene);
    const vd = new VertexData();
    vd.positions = m.pos; vd.normals = m.nrm; vd.indices = m.idx; vd.colors = m.col;
    vd.applyToMesh(mesh, false);
    mesh.setVerticesData('bakeOn', m.on, false, 3);
    mesh.setVerticesData('bakeOff', m.off, false, 3);
    mesh.setVerticesData('pidx', m.pidx, false, 1);
    mesh.material = this.mat;
    mesh.isPickable = false;
    mesh.hasVertexAlpha = false;
    return mesh;
  }

  private simpleBox(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, mat: StandardMaterial): Mesh {
    const m = emptyArrays();
    addBox(m, box(x0, x1, y0, y1, z0, z1, [1, 1, 1], 'x', PWR_ALWAYS), null, FIXED_DIM);
    const mesh = new Mesh('sb', this.scene);
    const vd = new VertexData(); vd.positions = m.pos; vd.normals = m.nrm; vd.indices = m.idx; vd.applyToMesh(mesh, false);
    mesh.material = mat; mesh.isPickable = false;
    return mesh;
  }

  private emissive(name: string, c: Color3): StandardMaterial {
    const m = new StandardMaterial(name, this.scene);
    m.disableLighting = true; m.emissiveColor = c.clone(); m.diffuseColor = Color3.Black(); m.specularColor = Color3.Black(); m.backFaceCulling = false;
    (m as unknown as { base: Color3 }).base = c.clone();
    return m;
  }

  /** Piano rettangolare con UV, rivolto verso (nx, nz). */
  private plane(name: string, x: number, y: number, z: number, nx: number, nz: number, w: number, hh: number, uv?: [number, number, number, number]): Mesh {
    const [u0, v0, u1, v1] = uv ?? [0, 0, 1, 1];
    // la faccia guarda verso n; "destra" per chi la guarda
    const rx = -nz, rz = nx;
    const pts = [
      [x - rx * w / 2, y - hh / 2, z - rz * w / 2], [x + rx * w / 2, y - hh / 2, z + rz * w / 2],
      [x + rx * w / 2, y + hh / 2, z + rz * w / 2], [x - rx * w / 2, y + hh / 2, z - rz * w / 2],
    ];
    const mesh = new Mesh(name, this.scene);
    const vd = new VertexData();
    vd.positions = pts.flat();
    vd.normals = [nx, 0, nz, nx, 0, nz, nx, 0, nz, nx, 0, nz];
    vd.uvs = [u0, v0, u1, v0, u1, v1, u0, v1];
    vd.indices = [0, 1, 2, 0, 2, 3];
    vd.applyToMesh(mesh, false);
    mesh.isPickable = false;
    return mesh;
  }

  private texMat(name: string, t: CanvasTex): ShaderMaterial {
    const m = new ShaderMaterial(name, this.scene, { vertex: 'thsTex', fragment: 'thsTex' }, { attributes: ['position', 'uv'], uniforms: ['worldViewProjection', 'level'], samplers: ['tex'] });
    m.setTexture('tex', t.tex); m.setFloat('level', 1); m.backFaceCulling = false;
    return m;
  }

  private displayPlane(name: string, x: number, y: number, z: number, nx: number, nz: number, w: number, hh: number): CanvasTex {
    const tex = new CanvasTex(this.scene, 128, 48, false);
    const pl = this.plane(name, x, y, z, nx, nz, w, hh);
    pl.material = this.texMat(name, tex);
    return tex;
  }

  private buildTree(m: MeshArrays, t: { f: number; x: number; z: number; y: number; h: number; zone: string }, rng: Rng): void {
    const p = t.zone === 'out' ? PWR_ALWAYS : powerOfFloor(t.f);
    const s = t.h / 3.6;
    addCyl(m, { x: t.x, z: t.z, y0: t.y, y1: t.y + 0.5 * s, r0: 0.12 * s, r1: 0.1 * s, seg: 6, c: COL.woodDark, zone: t.zone, p }, this.baker);
    if (t.zone !== 'out') addCyl(m, { x: t.x, z: t.z, y0: t.y, y1: t.y + 0.35, r0: 0.35, r1: 0.3, seg: 8, c: COL.red, zone: t.zone, p }, this.baker);
    const tiers = 4;
    for (let k = 0; k < tiers; k++) {
      const y0 = t.y + (0.4 + k * 0.72) * s, y1 = y0 + 1.15 * s, r = (1.25 - k * 0.27) * s;
      addCyl(m, { x: t.x, z: t.z, y0, y1, r0: r, r1: 0.05, seg: 9, c: shade(COL.pine, 1 + k * 0.08), zone: t.zone, p }, this.baker);
    }
    // stella
    addBox(m, cbox(t.x, t.z, t.y + 3.35 * s, 0.24 * s, 0.06 * s, 0.24 * s, COL.gold, t.zone, p, { emit: 1 }), null);
    // lucine colorate a gruppi che lampeggiano
    const cols: Color3[] = [new Color3(1, 0.2, 0.15), new Color3(0.25, 1, 0.35), new Color3(1, 0.8, 0.25), new Color3(0.35, 0.5, 1)];
    const groups = cols.map(() => emptyArrays());
    const n = Math.round(70 * s);
    for (let i = 0; i < n; i++) {
      const u = rng.next(), a = rng.next() * Math.PI * 2;
      const y = t.y + (0.55 + u * 2.6) * s;
      const r = (1.25 * (1 - u * 0.92)) * s;
      const bx = t.x + Math.cos(a) * r, bz = t.z + Math.sin(a) * r;
      const sz = 0.045 * Math.max(1, s * 0.6);
      addBox(groups[i % 4], box(bx - sz, bx + sz, y - sz, y + sz, bz - sz, bz + sz, [1, 1, 1], 'x', p), null, FIXED_DIM);
    }
    groups.forEach((g, k) => this.bulbMesh(`tree-${t.x}-${k}`, g, cols[k], p, k * 1.7, 1.3));
  }

  private bulbMesh(name: string, g: MeshArrays, col: Color3, p: PowerIdx, phase: number, speed: number): void {
    if (!g.pos.length) return;
    const mesh = new Mesh(name, this.scene);
    const vd = new VertexData(); vd.positions = g.pos; vd.normals = g.nrm; vd.indices = g.idx; vd.applyToMesh(mesh, false);
    const mat = this.emissive(name, col);
    mesh.material = mat; mesh.isPickable = false;
    this.bulbs.push({ mat, col, phase, p, speed });
  }

  private buildGarland(m: MeshArrays, f: number, pts: { x: number; y: number; z: number }[], rng: Rng): void {
    const p = powerOfFloor(f);
    const cols: Color3[] = [new Color3(1, 0.2, 0.15), new Color3(1, 0.8, 0.3), new Color3(0.3, 1, 0.4), new Color3(0.4, 0.5, 1)];
    const groups = cols.map(() => emptyArrays());
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const steps = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / 0.25));
      for (let k = 0; k < steps; k++) {
        const t = k / steps;
        const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t - Math.sin(t * Math.PI) * 0.06, z = a.z + (b.z - a.z) * t;
        addBox(m, box(x - 0.09, x + 0.09, y - 0.06, y + 0.06, z - 0.06, z + 0.06, k % 2 ? COL.pine : shade(COL.pine, 1.3), `${f}:corr`, p), null, { on: [0.6, 0.62, 0.55], off: [0.08, 0.08, 0.1] });
        if (k % 2 === 0) {
          const g = groups[(i + k) % 4];
          addBox(g, box(x - 0.03, x + 0.03, y - 0.1, y - 0.04, z - 0.03, z + 0.03, [1, 1, 1], 'x', p), null, FIXED_DIM);
        }
      }
      void rng;
    }
    groups.forEach((g, k) => this.bulbMesh(`garl-${f}-${pts[0].x}-${pts[0].z}-${k}`, g, cols[k], p, k * 0.9 + pts[0].z, 0.8));
  }

  private buildCamModel(c: Cam, m: MeshArrays): void {
    if (c.inCab) return;
    const dir = new Vector3(c.tx - c.x, c.ty - c.y, c.tz - c.z).normalize();
    const zone = c.label.en.startsWith('Outside') ? 'out' : `${c.f}:corr`;
    const p = PWR_ALWAYS;
    addBox(m, box(c.x - 0.06, c.x + 0.06, c.y + 0.05, c.y + 0.2, c.z - 0.06, c.z + 0.06, COL.dark, zone, p), null, FIXED_DIM);
    const hx = c.x + dir.x * 0.08, hz = c.z + dir.z * 0.08;
    addBox(m, box(hx - 0.07, hx + 0.07, c.y - 0.04, c.y + 0.06, hz - 0.07, hz + 0.07, [0.85, 0.85, 0.82], zone, p), null, FIXED_DIM);
    const led = this.emissive(`camled-${c.id}`, new Color3(1, 0.1, 0.1));
    const lx = c.x + dir.x * 0.17, lz = c.z + dir.z * 0.17;
    this.simpleBox(lx - 0.012, lx + 0.012, c.y - 0.03, c.y - 0.006, lz - 0.012, lz + 0.012, led);
    this.camLeds.set(c.id, led);
    if (c.box) addBox(m, cbox(c.box.x, c.box.z, c.box.y - 0.15, 0.2, 0.2, 0.28, [0.55, 0.55, 0.5], zone, p), null, FIXED_DIM);
  }

  private buildCab(): void {
    const m = emptyArrays();
    const lamp = { x: ELEV.cx, y: 2.25, z: -3.05, zone: 'cab', p: PWR_MAIN, col: [1, 0.96, 0.88] as RGB, i: 1.2, r: 2.2, mode: 'main' as const };
    const em = { x: ELEV.cx, y: 2.2, z: -3.05, zone: 'cab', p: PWR_ALWAYS, col: [1, 0.5, 0.4] as RGB, i: 0.25, r: 2, mode: 'emerg' as const };
    const cb = new Baker([lamp, em]);
    const X0 = ELEV.x0 + 0.15, X1 = ELEV.x1 - 0.15, Z0 = -4.45, Z1 = -1.62;
    const steel: RGB = [0.7, 0.72, 0.74], wood: RGB = [0.55, 0.42, 0.3];
    const add = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c: RGB, extra: Partial<Box> = {}) => addBox(m, box(x0, x1, y0, y1, z0, z1, c, 'cab', PWR_MAIN, { tess: 0.5, ...extra }), cb);
    add(X0, X1, -0.15, 0, Z0, Z1, [0.3, 0.3, 0.32]);
    add(X0, X1, 2.35, 2.45, Z0, Z1, steel);
    add(X0, X0 + 0.04, 0, 2.35, Z0, Z1, wood);
    add(X1 - 0.04, X1, 0, 2.35, Z0, Z1, wood);
    add(X0, X1, 0, 2.35, Z0, Z0 + 0.04, [0.82, 0.85, 0.88]);
    add(X0, ELEV.doorX0, 0, 2.35, Z1 - 0.04, Z1, steel);
    add(ELEV.doorX1, X1, 0, 2.35, Z1 - 0.04, Z1, steel);
    add(ELEV.doorX0, ELEV.doorX1, 2.1, 2.35, Z1 - 0.04, Z1, steel);
    add(X0 + 0.05, X0 + 0.09, 0.9, 0.95, Z0 + 0.2, Z1 - 0.2, COL.metal);
    add(X0 + 0.2, X1 - 0.2, 0.9, 0.95, Z0 + 0.05, Z0 + 0.09, COL.metal);
    add(ELEV.cx - 0.4, ELEV.cx + 0.4, 2.33, 2.35, -3.4, -2.7, [1, 0.97, 0.9], { emit: 1 });
    add(X1 - 0.05, X1 - 0.04, 0.85, 1.5, -2.38, -2.12, [0.5, 0.5, 0.52]);
    // un fiocco di Natale, anche qui
    add(X0 + 0.05, X0 + 0.07, 1.7, 1.95, -3.2, -2.9, COL.red);
    const mesh = this.toMesh('cab-m', m);
    mesh.parent = this.cab;
    // pulsanti dei piani
    FLOORS.forEach((f, k) => {
      const mat = this.emissive(`cabbtn-${f}`, new Color3(1, 0.85, 0.5));
      const b = this.simpleBox(X1 - 0.07, X1 - 0.055, 1.0 + k * 0.13 - 0.03, 1.0 + k * 0.13 + 0.03, -2.28, -2.22, mat);
      b.parent = this.cab;
      this.cabBtns.push(mat);
    });
    const dt = new CanvasTex(this.scene, 128, 48, false);
    const pl = this.plane('disp-cab', ELEV.cx, 2.22, -1.685, 0, -1, 0.36, 0.13);
    pl.material = this.texMat('disp-cab', dt); pl.parent = this.cab;
    this.displays.push({ tex: dt, f: 'cab', last: '' });
  }

  private buildSigns(): void {
    for (const m of this.signMats.values()) m.dispose();
    this.signMats.clear();
    for (const m of this.scene.meshes.filter((x) => x.name.startsWith('sign-'))) m.dispose();
    const ctx = this.signTex.ctx;
    ctx.clearRect(0, 0, 2048, 2048);
    const CW = 256, CH = 64, cols = 8;
    this.signs.forEach((s, i) => {
      const cx = (i % cols) * CW, cy = Math.floor(i / cols) * CH;
      const bg = s.style === 'exit' ? '#1f7a3a' : s.style === 'ward' ? '#1d3f73' : s.style === 'floor' ? '#202428' : '#244b4d';
      ctx.fillStyle = bg; ctx.fillRect(cx, cy, CW, CH);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 3; ctx.strokeRect(cx + 4, cy + 4, CW - 8, CH - 8);
      const text = s.text[this.lang];
      ctx.fillStyle = '#f4f2ea';
      let size = s.style === 'floor' ? 44 : 30;
      ctx.font = `600 ${size}px system-ui, sans-serif`;
      while (ctx.measureText(text).width > CW - 24 && size > 12) { size -= 2; ctx.font = `600 ${size}px system-ui, sans-serif`; }
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(text, cx + CW / 2, cy + CH / 2 + 2);
    });
    this.signTex.update(true);
    this.signs.forEach((s, i) => {
      const key = s.f;
      let mat = this.signMats.get(key);
      if (!mat) {
        mat = this.texMat(`signmat-${key}`, this.signTex);
        this.signMats.set(key, mat);
      }
      const u0 = ((i % cols) * CW) / 2048, u1 = u0 + CW / 2048;
      const v1 = 1 - (Math.floor(i / cols) * CH) / 2048, v0 = v1 - CH / 2048;
      const pl = this.plane(`sign-${i}`, s.x, s.y, s.z, s.nx, s.nz, s.w, s.h, [u0, v0, u1, v1]);
      pl.material = mat;
      if (this.rtt) this.rtt.renderList?.push(pl);
    });
  }

  private buildPrecip(n: number): Mesh {
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    const r = new Rng(`precip/${this.shift.seed}`);
    for (let i = 0; i < n; i++) {
      const x = r.range(-18, 18), y = r.range(-9, 9), z = r.range(-18, 18);
      const b = pos.length / 3;
      for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) { pos.push(x, y, z); uv.push(u, v); }
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    const mesh = new Mesh('precip', this.scene);
    const vd = new VertexData(); vd.positions = pos; vd.uvs = uv; vd.indices = idx; vd.applyToMesh(mesh, false);
    mesh.material = this.precipMat; mesh.isPickable = false; mesh.alwaysSelectAsActiveMesh = true;
    mesh.renderingGroupId = 0;
    return mesh;
  }

  // ------------------------------------------------------------ aggiornamento

  relabel(lang: Lang): void {
    if (lang === this.lang) return;
    this.lang = lang;
    this.buildSigns();
  }

  sync(dt: number, eye: Vector3, look: Vector3, gfxBrightness: number): void {
    const s = this.shift, h = s.h, t = (this.time += dt);
    const cctv = s.cctv.active;
    // corrente
    const fl = s.anomalyFx.flicker;
    // 1 luce piena, 0 luci di cortesia, -1 buio del blackout (solo emergenza, molto fioca)
    const pw = new Array<number>(MAX_PW).fill(1);
    FLOORS.forEach((f, k) => { const l = s.lightLevel(f); pw[k] = l > 0 ? l * (fl[f] ?? 1) : l; });
    pw[4] = s.power.main ? 1 : -1;
    for (const r of h.rooms) if (r.pw < MAX_PW) { const l = s.roomLevel(r.id); pw[r.pw] = l > 0 ? l * (fl[r.f] ?? 1) : l; }
    this.mat.setFloats('power', pw);
    this.mat.setFloat('time', t);
    // la bandiera: un'onda che corre dall'asta verso la punta, più ampia in fondo
    {
      let x = 0, z = 0, ang = 0;
      const wind = 1 + 0.35 * Math.sin(t * 0.37);
      this.flag.forEach((n, i) => {
        const a = Math.sin(t * 3.4 * wind - i * 0.55) * (0.12 + i * 0.045);
        n.position.x = FLAG.x + 0.06 + x; n.position.z = FLAG.z + z;
        n.rotation.y = -ang - a;
        ang += a * 0.5;
        x += Math.cos(ang + a) * 0.24; z += Math.sin(ang + a) * 0.24;
        n.position.y = floorY(FLOORS[FLOORS.length - 1]) + H + 0.42 + 5.2 - i * 0.015 + Math.sin(t * 2.1 - i * 0.4) * 0.03;
      });
    }

    // porte
    for (const d of h.doors) {
      const n = this.doorNodes.get(d.id)!;
      const a = s.doorOpen.get(d.id) ?? 0;
      n.rotation.y = d.axis === 'x' ? -d.side * a * 1.62 : -Math.PI / 2 - d.side * a * 1.62;
    }
    // ascensore
    this.cab.position.y = s.elevator.y;
    const at = s.elevator.atFloor();
    FLOORS.forEach((f, k) => {
      const o = at === f ? s.elevator.door : 0;
      this.landing[k].l.position.x = -o * 0.58;
      this.landing[k].r.position.x = o * 0.58;
    });
    FLOORS.forEach((f, k) => {
      const m = this.cabBtns[k], base = (m as unknown as { base: Color3 }).base;
      m.emissiveColor = s.power.main ? base.scale(s.elevator.calls.has(f) ? 1 : 0.18) : base.scale(0.03);
    });
    for (const d of this.displays) {
      const fl2 = Math.round(s.elevator.y / H) + FLOORS[0];
      const arrow = s.elevator.phase === 'moving' ? (s.elevator.dir > 0 ? '▲' : '▼') : '';
      const txt = s.power.main ? `${arrow}${fl2}` : '';
      if (txt !== d.last) {
        d.last = txt;
        const c = d.tex.ctx;
        c.fillStyle = '#050505'; c.fillRect(0, 0, 128, 48);
        c.fillStyle = '#ff5a2a'; c.font = 'bold 34px monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(txt, 64, 26);
        d.tex.update(true);
      }
    }
    // ingresso
    // finestre
    for (const [id, n] of this.winNodes) {
      const open = s.winOpen.get(id);
      const tgt = open ? 0.9 + Math.sin(t * 2.3 + id.length) * 0.25 : 0;
      n.rotation.y += (tgt - n.rotation.y) * Math.min(1, dt * 4);
    }
    // quadro
    for (const [id, b] of this.breakerNodes) {
      const o = h.objs.find((x) => x.id === id) as Obj;
      const up = o.data === 'main' ? s.power.main : s.power.fl[Number(o.data)];
      b.lever.rotation.x = up ? -0.5 : 0.6;
      b.led.emissiveColor = up ? new Color3(0.2, 1, 0.3) : new Color3(1, 0.15, 0.1);
    }
    // chiamate
    const blink = Math.sin(t * 7) > 0;
    for (const [room, m] of this.callLamps) {
      const pts = h.patients.filter((p) => p.room === room);
      const st = pts.map((p) => s.calls[p.id]);
      const any = st.some((c) => c.assist !== 'off' || c.urgent !== 'off');
      const bl = st.some((c) => c.assist === 'blink' || c.urgent === 'blink');
      const base = (m as unknown as { base: Color3 }).base;
      m.emissiveColor = base.scale(any ? (bl && !blink ? 0.25 : 1) : 0.05);
    }
    for (const [id, m] of this.panelBtns) {
      const o = h.objs.find((x) => x.id === id) as Obj;
      const [pid, kind] = (o.data ?? '').split('|');
      const st = s.calls[pid]?.[kind as 'assist' | 'urgent'];
      const base = (m as unknown as { base: Color3 }).base;
      m.emissiveColor = base.scale(st === 'blink' ? (blink ? 1.1 : 0.15) : st === 'on' ? 0.9 : 0.1);
    }
    this.phoneLed.emissiveColor = new Color3(s.phone.ringing && blink ? 1 : 0.08, 0.05, 0.05);
    [s.power.main, ...FLOORS.map((f) => s.power.fl[f])].forEach((on, k) => { this.statusLeds[k].emissiveColor = on ? new Color3(0.2, 1, 0.35) : new Color3(blink ? 1 : 0.4, 0.12, 0.08); });
    for (const [id, m] of this.camLeds) m.emissiveColor = new Color3(s.camOffline.has(id) ? 0.05 : Math.sin(t * 2) > 0.6 ? 1 : 0.4, 0.05, 0.05);
    // pazienti: seduti quando chiamano
    for (const p of h.patients) {
      const n = this.patientNodes.get(p.id)!;
      const c = s.calls[p.id];
      const mv = s.mover.m.get(p.id);
      const st = mv?.state ?? 'bed';
      const up = c.assist !== 'off' || c.urgent !== 'off' || s.activeTasks().some((x) => x.patient === p.id && x.kind === 'assist' && x.known);
      n.lie.setEnabled(st === 'bed' && !up); n.sit.setEnabled(st === 'bed' && up);
      const walking = st === 'walk_to' || st === 'walk_back' || st === 'bath';
      n.walk.setEnabled(walking); n.floor.setEnabled(st === 'fallen');
      if (mv && walking) {
        n.walk.position.set(mv.x, floorY(p.f) + (st === 'bath' ? 0 : Math.abs(Math.sin(t * 3.1)) * 0.025), mv.z);
        n.walk.rotation.y = mv.yaw;
        n.walk.rotation.z = st === 'bath' ? 0 : Math.sin(t * 1.55) * 0.05;
      }
      if (mv && st === 'fallen') { n.floor.position.set(mv.x, floorY(p.f), mv.z); n.floor.rotation.y = mv.yaw; }
      // il paziente che non c'è: dopo la rivelazione si vede solo dalle telecamere
      const ghost = s.ghost.pid === p.id && s.ghost.revealed;
      const mask = ghost ? LAYER_CCTV : 0x0fffffff;
      if ((n.meshes[0].layerMask !== mask)) for (const m of n.meshes) m.layerMask = mask;
    }
    if (this.santaNode && s.santa) { this.santaNode.position.set(s.santa.x, floorY(s.santa.f), s.santa.z); this.santaNode.rotation.y = s.santa.yaw; }
    // guardiano
    const pl = s.player;
    this.avatar.position.set(pl.x, pl.y, pl.z);
    this.avatar.rotation.y = pl.yaw;
    // oggetto in mano
    for (const [k, m] of Object.entries(this.handItems)) m.setEnabled(s.carried === k && !cctv);
    this.hand.position.y = -0.27 + Math.sin(pl.meters * 5) * 0.008;
    // figure degli eventi
    const views = s.anomalyViews().filter((v) => v.kind === 'figure');
    this.figures.forEach((fg, k) => {
      const v = views[k];
      fg.node.setEnabled(!!v);
      if (!v) return;
      fg.node.position.set(v.pos.x, v.pos.y, v.pos.z);
      fg.node.rotation.y = v.yaw;
      fg.mesh.layerMask = v.visibility === 'live' ? LAYER_LIVE : v.visibility === 'cctv' ? LAYER_CCTV : LAYER_BASE;
    });
    // lucine
    for (const b of this.bulbs) {
      const on = pw[b.p] > -0.5;
      const k = on ? 0.55 + 0.45 * Math.max(0, Math.sin(t * b.speed + b.phase)) : 0.02;
      b.mat.emissiveColor = b.col.scale(k);
    }
    for (const m of this.signMats) m[1].setFloat('level', pw[m[0] - 20] > 0.5 ? 0.9 : pw[m[0] - 20] > -0.5 ? 0.5 : 0.1);

    // telecamera attiva
    const viewCam = cctv ? this.cctvCam : this.mainCam;
    if (cctv) {
      const c = s.cam();
      const pose = s.camPose(c);
      this.cctvCam.position.set(pose.pos.x, pose.pos.y, pose.pos.z);
      this.cctvCam.setTarget(new Vector3(pose.target.x, pose.target.y, pose.target.z));
      this.cctvCam.fov = c.fov;
      const dark = s.camDark(c);
      this.cctvState = { ir: dark ? 1 : 0, noSignal: s.camOffline.has(c.id) ? 1 : 0, glitch: (s.anomalyFx.camNoise[c.id] ?? 0) + (dark ? 0.3 : 0.05) };
      this.mat.setVector4('irLight', new Vector4(pose.pos.x, pose.pos.y, pose.pos.z, dark ? 0.85 : 0));
      if (this.scene.activeCamera !== this.cctvCam) this.scene.activeCamera = this.cctvCam;
    } else {
      this.mat.setVector4('irLight', new Vector4(0, 0, 0, 0));
      if (this.scene.activeCamera !== this.mainCam) this.scene.activeCamera = this.mainCam;
    }
    // monitor della reception: gira tra le telecamere ogni 6 secondi
    this.deskT -= dt;
    if (this.deskT <= 0) { this.deskT = 6; this.deskIdx = (this.deskIdx + 1) % h.cams.length; }
    const dc = h.cams[this.deskIdx], dp = s.camPose(dc);
    this.deskCam.position.set(dp.pos.x, dp.pos.y, dp.pos.z);
    this.deskCam.setTarget(new Vector3(dp.target.x, dp.target.y, dp.target.z));
    this.deskCam.fov = dc.fov;
    this.rtt.refreshRate = cctv || Math.abs(pl.x + 20) > 14 || pl.f !== 0 ? 0 : 3;
    this.monitorMat.setFloat('time', t);
    this.monitorMat.setFloat('power', 1);
    this.monitorMat.setFloat('noSignal', s.camOffline.has(dc.id) ? 1 : 0);

    // luci mobili
    const vp = viewCam.position;
    const cands: { x: number; y: number; z: number; r: number; c: RGB; i: number }[] = [];
    for (const [room, m] of this.callLamps) {
      if (m.emissiveColor.r < 0.5) continue;
      const d = h.doors.find((x) => x.room === room)!;
      const q = doorPoint(d, -0.4);
      cands.push({ x: q.x, y: floorY(d.f) + 2.2, z: q.z, r: 1.3, c: [1, 0.2, 0.1], i: 0.8 });
    }
    const lt = h.trees[0];
    const con = h.objs.find((o) => o.id === 'cctv-console')!, ph = h.objs.find((o) => o.id === 'phone-0')!;
    if (pw[0] > -0.5 && lt) cands.push({ x: lt.x, y: 1.6, z: lt.z, r: 2.2, c: [1, 0.55 + 0.3 * Math.sin(t * 1.3), 0.4 + 0.4 * Math.sin(t * 0.9 + 1)], i: 0.65 });
    cands.push({ x: con.x, y: 1.1, z: con.z + 0.3, r: 1.2, c: [0.6, 0.75, 0.9], i: 0.45 });
    const ct = h.trees.find((x) => x.zone === 'out');
    if (ct) cands.push({ x: ct.x, y: ct.y + 5, z: ct.z, r: 9, c: [1, 0.7, 0.4], i: 1.6 });
    if (s.phone.ringing && blink) cands.push({ x: ph.x, y: 0.95, z: ph.z, r: 0.6, c: [1, 0.1, 0.1], i: 0.4 });
    cands.sort((a, b) => Math.hypot(a.x - vp.x, a.y - vp.y, a.z - vp.z) - Math.hypot(b.x - vp.x, b.y - vp.y, b.z - vp.z));
    this.dyn.fill(0); this.dynC.fill(0);
    cands.slice(0, MAX_DYN).forEach((c, k) => {
      this.dyn.set([c.x, c.y, c.z, c.r], k * 4);
      this.dynC.set([c.c[0], c.c[1], c.c[2], c.i], k * 4);
    });
    this.mat.setArray4('dlPos', Array.from(this.dyn));
    this.mat.setArray4('dlCol', Array.from(this.dynC));
    // torcia
    if (s.torch && !cctv) {
      this.mat.setVector4('spotPos', new Vector4(eye.x + look.x * 0.2, eye.y - 0.15, eye.z + look.z * 0.2, 2.2 * s.torchPower()));
      this.mat.setVector4('spotDir', new Vector4(look.x, look.y, look.z, Math.cos(0.36)));
    } else this.mat.setVector4('spotPos', new Vector4(0, 0, 0, 0));
    // nebbia ed esposizione
    const prec = s.precip();
    this.mat.setVector3('camPos', vp);
    this.mat.setVector3('fogColor', new Vector3(0.035, 0.045, 0.08));
    this.mat.setFloat('fogDensity', 0.0035 + prec * 0.005);
    this.mat.setFloat('exposure', 1.15 * gfxBrightness);
    // precipitazioni
    const rain = s.weather.kind === 'rain', sleet = s.weather.kind === 'sleet';
    const right = viewCam.getDirection(Vector3.Right()), up = viewCam.getDirection(Vector3.Up());
    this.precipMat.setVector3('camPos', vp);
    this.precipMat.setVector3('camRight', right);
    this.precipMat.setVector3('camUp', up);
    this.precipMat.setFloat('time', t);
    this.precipMat.setVector4('params', new Vector4(rain ? 9 : sleet ? 4 : 1.1, rain ? 0.6 : 0.35, rain ? 0.035 : 0.06, rain ? 9 : sleet ? 2.5 : 1));
    this.precipMat.setVector4('tint', new Vector4(rain ? 0.6 : 0.95, rain ? 0.68 : 0.97, rain ? 0.8 : 1, (rain ? 0.35 : 0.75) * (0.35 + prec)));
    this.precip.setEnabled(vp.y > -0.5);
    void CEIL; void BX0;
  }

  /** Mette la scena su una telecamera di sorveglianza o torna allo sguardo del guardiano. */
  dispose(): void {
    this.scene.customRenderTargets.length = 0;
    this.rtt.dispose();
    this.cctvPP.dispose();
  }
}

/** Testo disegnato su una tela 2D e caricato come texture grezza (affidabile anche su GPU software). */
class CanvasTex {
  readonly ctx: CanvasRenderingContext2D;
  readonly tex: RawTexture;
  private readonly canvas: HTMLCanvasElement;
  constructor(scene: Scene, readonly w: number, readonly h: number, mips: boolean) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = w; this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    this.tex = RawTexture.CreateRGBATexture(new Uint8Array(w * h * 4), w, h, scene, mips, true, mips ? Constants.TEXTURE_TRILINEAR_SAMPLINGMODE : Constants.TEXTURE_BILINEAR_SAMPLINGMODE);
  }
  update(_invert?: boolean): void {
    this.tex.update(new Uint8Array(this.ctx.getImageData(0, 0, this.w, this.h).data.buffer));
  }
}

/** Cornice di una finestra (statica). */
function windowFrame(w: { axis: 'x' | 'z'; at: number; a0: number; a1: number; y0: number; y1: number; out: 1 | -1; zone: string; f: number }): Box[] {
  const fc: RGB = [0.88, 0.88, 0.86];
  const p = powerOfFloor(w.f);
  const t = 0.05;
  const zone = w.zone;
  const sill = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) =>
    w.axis === 'x' ? box(x0, x1, y0, y1, z0, z1, fc, zone, p) : box(z0, z1, y0, y1, x0, x1, fc, zone, p);
  const c0 = w.at - 0.09, c1 = w.at + 0.09;
  return [
    sill(w.a0, w.a1, w.y0 - 0.04, w.y0, c0 - w.out * 0.12, c1),
    sill(w.a0, w.a1, w.y1, w.y1 + t, c0, c1),
    sill(w.a0, w.a0 + t, w.y0, w.y1, c0, c1),
    sill(w.a1 - t, w.a1, w.y0, w.y1, c0, c1),
    sill((w.a0 + w.a1) / 2 - 0.025, (w.a0 + w.a1) / 2 + 0.025, w.y0, w.y1, c0, c1),
  ];
}

export { Constants };
