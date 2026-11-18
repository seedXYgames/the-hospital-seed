// Shader dell'ospedale: luce precalcolata per zona (con e senza corrente), torcia, luci mobili, infrarosso, nebbia.
import { Effect } from '@babylonjs/core/Materials/effect';

export const MAX_DYN = 8;

Effect.ShadersStore.thsVertexShader = `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
attribute vec4 color;
attribute vec3 bakeOn;
attribute vec3 bakeOff;
attribute float pidx;
uniform mat4 world;
uniform mat4 viewProjection;
uniform float power[64];
varying vec3 vPos;
varying vec3 vN;
varying vec4 vCol;
varying vec3 vBake;
void main() {
  vec4 wp = world * vec4(position, 1.0);
  vPos = wp.xyz;
  vN = normalize(mat3(world) * normal);
  vCol = color;
  int i = int(pidx + 0.5);
  float pw = 1.0;
  for (int k = 0; k < 64; k++) { if (k == i) pw = power[k]; }
  // pw < 0: blackout, resta solo un filo della luce d'emergenza
  vBake = mix(bakeOff * (pw < -0.01 ? 0.14 : 1.0), bakeOn, max(pw, 0.0));
  gl_Position = viewProjection * wp;
}`;

Effect.ShadersStore.thsFragmentShader = `
precision highp float;
varying vec3 vPos;
varying vec3 vN;
varying vec4 vCol;
varying vec3 vBake;
uniform vec3 camPos;
uniform vec4 spotPos;
uniform vec4 spotDir;
uniform vec4 dlPos[${MAX_DYN}];
uniform vec4 dlCol[${MAX_DYN}];
uniform vec3 fogColor;
uniform float fogDensity;
uniform float exposure;
uniform vec4 irLight;
uniform float time;
void main() {
  vec3 albedo = vCol.rgb;
  vec3 col;
  if (vCol.a < 0.99) {
    col = albedo * vBake * 1.3;
    // le luci della città laggiù tremolano, come viste attraverso l'aria fredda
    if (vPos.y < -40.0) {
      float hsh = fract(sin(dot(floor(vPos.xz * 0.7), vec2(12.9898, 78.233))) * 43758.5453);
      col *= 0.72 + 0.4 * (0.5 + 0.5 * sin(time * (1.2 + hsh * 2.5) + hsh * 40.0));
    }
  } else {
    vec3 n = normalize(vN);
    vec3 light = vBake;
    if (spotPos.w > 0.0) {
      vec3 L = spotPos.xyz - vPos;
      float d = length(L);
      vec3 l = L / max(d, 0.001);
      float ca = dot(-l, spotDir.xyz);
      float cone = smoothstep(spotDir.w, spotDir.w + 0.06, ca);
      float hot = smoothstep(spotDir.w + 0.05, 1.0, ca);
      float ndl = max(dot(n, l), 0.0);
      light += vec3(1.0, 0.94, 0.82) * spotPos.w * (0.55 * cone + 1.1 * hot) * ndl / (1.0 + d * d * 0.07);
    }
    for (int k = 0; k < ${MAX_DYN}; k++) {
      if (dlCol[k].w <= 0.0) continue;
      vec3 Ld = dlPos[k].xyz - vPos;
      float dd = length(Ld);
      float r = dlPos[k].w;
      float att = dlCol[k].w / (1.0 + (dd / r) * (dd / r)) * clamp(1.0 - dd / (r * 3.0), 0.0, 1.0);
      light += dlCol[k].rgb * att * max(dot(n, Ld / max(dd, 0.001)), 0.0);
    }
    if (irLight.w > 0.0) {
      vec3 Li = irLight.xyz - vPos;
      float di = length(Li);
      light += vec3(irLight.w) / (1.0 + di * di * 0.025) * (0.3 + 0.7 * max(dot(n, Li / max(di, 0.001)), 0.0));
    }
    col = albedo * light;
  }
  float fd = length(vPos - camPos);
  // foschia bassa sulla città: le strade spariscono, le luci la bucano appena
  float mist = clamp((-50.0 - vPos.y) / 20.0, 0.0, 1.0);
  mist = mist * mist * (3.0 - 2.0 * mist) * (vCol.a < 0.99 ? 0.5 : 0.93);
  vec3 mistCol = vec3(0.25, 0.2, 0.25) + vec3(0.06, 0.04, 0.02) * sin(vPos.x * 0.01 + vPos.z * 0.013);
  col = mix(col, mistCol, mist);
  col = mix(fogColor, col, exp(-fd * fogDensity));
  col *= exposure;
  col = col / (1.0 + col * 0.22);
  gl_FragColor = vec4(col, 1.0);
}`;

// precipitazioni: quadrati che cadono in un volume attorno alla telecamera, scartati dentro l'edificio
Effect.ShadersStore.thsPrecipVertexShader = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 viewProjection;
uniform vec3 camPos;
uniform vec3 camRight;
uniform vec3 camUp;
uniform float time;
uniform vec4 params; // x velocità di caduta, y deriva, z dimensione, w allungamento
varying vec2 vUv;
varying vec3 vW;
varying float vFade;
void main() {
  vec3 box = vec3(36.0, 18.0, 36.0);
  vec3 p = position;
  p.y -= time * params.x * (0.8 + 0.4 * fract(position.x * 7.13));
  p.x += time * params.y + sin(time * 0.7 + position.z) * 0.4 * (1.0 - params.w * 0.2);
  vec3 rel = mod(p - camPos + box * 0.5, box) - box * 0.5;
  vec3 c = camPos + rel;
  vW = c;
  vFade = 1.0 - smoothstep(10.0, 18.0, length(rel.xz));
  vec2 o = (uv - 0.5) * params.z;
  vec3 wpos = c + camRight * o.x + vec3(0.0, 1.0, 0.0) * o.y * params.w + camUp * o.y * (1.0 - min(params.w, 1.0)) * 0.0;
  vUv = uv;
  gl_Position = viewProjection * vec4(wpos, 1.0);
}`;

Effect.ShadersStore.thsPrecipFragmentShader = `
precision highp float;
varying vec2 vUv;
varying vec3 vW;
varying float vFade;
uniform vec4 tint;
void main() {
  if (vW.x > -9.4 && vW.x < 9.4 && vW.z > -10.4 && vW.z < 10.4 && vW.y < 11.4) discard;
  vec2 d = vUv - 0.5;
  float a = 1.0 - smoothstep(0.15, 0.5, length(d * vec2(1.0, tint.w)));
  a *= vFade * tint.a;
  if (a < 0.01) discard;
  gl_FragColor = vec4(tint.rgb, a);
}`;

// schermo del monitor della reception: l'immagine della telecamera, in bianco e nero, con righe e rumore
Effect.ShadersStore.thsMonitorVertexShader = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 worldViewProjection;
varying vec2 vUv;
void main() { vUv = uv; gl_Position = worldViewProjection * vec4(position, 1.0); }`;

Effect.ShadersStore.thsMonitorFragmentShader = `
precision highp float;
varying vec2 vUv;
uniform sampler2D feed;
uniform float time;
uniform float power;
uniform float noSignal;
float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec3 c = texture2D(feed, vUv).rgb;
  float g = dot(c, vec3(0.3, 0.59, 0.11));
  float n = h(vUv * 400.0 + time * 13.0);
  g = g * 1.25 + (n - 0.5) * 0.08;
  g *= 0.85 + 0.15 * sin(vUv.y * 600.0 + time * 4.0);
  g = mix(g, n * 0.8, noSignal);
  vec2 v = vUv - 0.5;
  g *= 1.0 - dot(v, v) * 1.2;
  gl_FragColor = vec4(vec3(g * 0.92, g, g * 0.95) * power, 1.0);
}`;

// post-elaborazione della videosorveglianza a tutto schermo
Effect.ShadersStore.thsCctvFragmentShader = `
precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform float time;
uniform float ir;
uniform float noSignal;
uniform float glitch;
float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 uv = vUV;
  vec2 cc = uv - 0.5;
  uv = 0.5 + cc * (1.0 + dot(cc, cc) * 0.08);
  float line = floor(uv.y * 240.0);
  uv.x += (h(vec2(line, floor(time * 20.0))) - 0.5) * 0.012 * glitch;
  vec3 c = texture2D(textureSampler, uv).rgb;
  float g = dot(c, vec3(0.3, 0.59, 0.11));
  vec3 col = mix(c, vec3(g), 0.72);
  if (ir > 0.5) { g = pow(g * 1.6, 0.85); col = vec3(g * 0.9, g, g * 0.92); }
  float n = h(uv * vec2(640.0, 360.0) + time * 17.0);
  col += (n - 0.5) * (0.07 + 0.08 * ir);
  col *= 0.88 + 0.12 * sin(uv.y * 900.0);
  col *= 1.0 - dot(cc, cc) * 1.1;
  col = mix(col, vec3(n * 0.85), noSignal);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) col = vec3(0.0);
  gl_FragColor = vec4(col, 1.0);
}`;

// quadri con testo (cartelli, display): la texture moltiplicata per una luminosità
Effect.ShadersStore.thsTexVertexShader = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 worldViewProjection;
varying vec2 vUv;
void main() { vUv = uv; gl_Position = worldViewProjection * vec4(position, 1.0); }`;
Effect.ShadersStore.thsTexFragmentShader = `
precision highp float;
varying vec2 vUv;
uniform sampler2D tex;
uniform float level;
void main() { vec4 c = texture2D(tex, vUv); gl_FragColor = vec4(c.rgb * level, 1.0); }`;
