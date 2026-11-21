// Ramen_Builder stage: once the card is recognised, the shop lives on the screen
// over the live camera — no need to keep the card in frame. The bowl, plates and
// counter are drawn the way the Anatomy kit draws: an orthographic camera at
// azimuth 45° / elevation 30°, four-tone flat shading toward sepia and an ink
// outline. The food is modelled after the real thing, soft-shaded with a little
// shine and painted textures. The order ticket's pictures are rendered from these
// same 3D models, so they always match.
//
// MindAR (mind-ar 1.2.5 + three 0.160.0, same pins as sushi-ar) is used only for
// the recognition step; after the card is found its tracking stops.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { INGREDIENTS, SHORT } from './data.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const params = new URLSearchParams(location.search);
export const TARGET_SRC = params.get('target') || './targets.mind';
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const AZIMUTH = 45, ELEVATION = 30; // the Anatomy kit's default camera

// ------------------------------------------------------------------ tweens
const tweens = [];
export const EASE = {
  out: (t) => 1 - (1 - t) ** 3,
  io: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  back: (t) => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2,
};
function tw(dur, ease, step, done, delay = 0){ tweens.push({ t: -delay, dur, ease, step, done }); }
function updateTweens(dt){
  for (let i = tweens.length - 1; i >= 0; i--){
    const T = tweens[i];
    T.t += dt;
    if (T.t < 0) continue;
    const k = Math.min(T.t / T.dur, 1);
    T.step(T.ease(k), k);
    if (k >= 1){ tweens.splice(i, 1); T.done?.(); }
  }
}
const wait = (s) => new Promise((ok) => tw(s, (t) => t, () => {}, ok));
function dispose(node){
  node.traverse((o) => {
    if (o.userData.hull) return;
    if (o.isMesh || o.isInstancedMesh || o.isSprite){
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => { if (!m.userData.shared) m.dispose(); });
      if (!o.geometry?.userData?.shared) o.geometry?.dispose();
    }
  });
}

// ------------------------------------------------------------------ Anatomy material
// Lighting is fixed in VIEW space, like a drawing: the top of anything lying flat
// gets band 1.0 (its true colour), faces turning away step down in four tones.
const VS = `
uniform float uInk;
varying vec3 vN; varying vec2 vUv; varying vec3 vTint;
void main(){
  vUv = uv;
  vTint = vec3(1.0);
  vec4 p = vec4(position, 1.0);
  vec3 n = normal;
  #ifdef USE_INSTANCING
    p = instanceMatrix * p; n = mat3(instanceMatrix) * n;
  #endif
  #ifdef USE_INSTANCING_COLOR
    vTint = instanceColor;         // per-piece colour (raw sRGB), e.g. pale-to-dark green onion rings
  #endif
  vN = normalize(normalMatrix * n);
  vec4 mv = modelViewMatrix * p;
  mv.xyz += vN * uInk;             // ink hull: grow along the normal, in world units
  gl_Position = projectionMatrix * mv;
}`;
/* Two looks share one shader:
   - Anatomy bands (bowl, plates, counter): four flat tones stepping toward walnut.
   - Food (uSoft): smooth half-lambert shading in the same warm tones, plus a
     specular glint (uSpec, uGloss) so egg yolk, glaze, oil and wet seaweed shine. */
const FS = `
uniform vec3 uColor; uniform float uOpacity; uniform sampler2D uMap; uniform float uHasMap; uniform float uAlphaTest; uniform float uFlat;
uniform float uSoft; uniform float uSpec; uniform float uGloss;
varying vec3 vN; varying vec2 vUv; varying vec3 vTint;
void main(){
  vec4 c = vec4(uColor * vTint, uOpacity);
  if (uHasMap > 0.5){ vec4 t = texture2D(uMap, vUv); c.rgb *= t.rgb; c.a *= t.a; }
  if (c.a < uAlphaTest) discard;
  if (uFlat > 0.5){ gl_FragColor = c; return; }
  vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
  vec3 L = normalize(vec3(-0.35, 0.82, 0.48));
  float d = dot(n, L);
  float band;
  if (uSoft > 0.5){
    band = 0.66 + 0.34 * smoothstep(0.0, 1.0, d * 0.5 + 0.5);
  } else {
    band = d > 0.6 ? 1.0 : d > 0.25 ? 0.93 : d > -0.1 ? 0.86 : d > -0.45 ? 0.79 : 0.72;
  }
  vec3 tone = mix(vec3(0.55, 0.42, 0.29), vec3(1.0), clamp((band - 0.66) / 0.34, 0.0, 1.0)); // shade toward walnut, not grey
  vec3 col = c.rgb * mix(vec3(band), tone, 0.55);
  if (uSpec > 0.0){
    vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
    col += vec3(1.0, 0.98, 0.92) * pow(max(dot(n, H), 0.0), uGloss) * uSpec;
  }
  gl_FragColor = vec4(col, c.a);
}`;
const srgb = (hex) => { const h = typeof hex === 'string' ? parseInt(hex.slice(1), 16) : hex; return new THREE.Vector3(((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255); };
function mat(color, { map = null, opacity = 1, alphaTest = 0, flat = false, side = THREE.FrontSide, transparent = false, soft = false, spec = 0, gloss = 24 } = {}){
  return new THREE.ShaderMaterial({
    vertexShader: VS, fragmentShader: FS, side, transparent: transparent || opacity < 1,
    uniforms: { uColor: { value: srgb(color) }, uOpacity: { value: opacity }, uMap: { value: map }, uHasMap: { value: map ? 1 : 0 },
      uAlphaTest: { value: alphaTest }, uFlat: { value: flat ? 1 : 0 }, uInk: { value: 0 },
      uSoft: { value: soft ? 1 : 0 }, uSpec: { value: spec }, uGloss: { value: gloss } },
  });
}
// Food: soft shading, optional shine.
const food = (color, o = {}) => mat(color, { soft: true, ...o });
const shared = (m) => { m.userData.shared = true; return m; };
const inkMat = (color, width) => shared(new THREE.ShaderMaterial({
  vertexShader: VS, fragmentShader: FS, side: THREE.BackSide,
  uniforms: { uColor: { value: srgb(color) }, uOpacity: { value: 1 }, uMap: { value: null }, uHasMap: { value: 0 },
    uAlphaTest: { value: 0 }, uFlat: { value: 1 }, uInk: { value: width }, uSoft: { value: 0 }, uSpec: { value: 0 }, uGloss: { value: 1 } },
}));
const INK_MAT = inkMat('#3b2a1c', 0.0022);
// Food gets a much finer, warm edge than the porcelain, so it reads as food, not as a cartoon.
const FOOD_INK = inkMat('#4a2f1c', 0.0007);
// Outline a solid with Anatomy's ink line (an inverted hull drawn behind it).
function ink(mesh, m = INK_MAT){
  const hull = new THREE.Mesh(mesh.geometry, m);
  hull.userData.hull = true; // shares its solid's geometry, which the solid disposes
  hull.renderOrder = -1;
  mesh.add(hull);
  return mesh;
}
const solid = (geo, m) => ink(new THREE.Mesh(geo, m));
const piece = (geo, m) => ink(new THREE.Mesh(geo, m), FOOD_INK);

// Same hex values as the 2D art (js/art.js), so 3D and icons match.
const C = { porcelain: '#f6ecd8', inner: '#efe3cb', red: '#b5452f', noodle: '#ecd391', wood: '#c39a62', woodTop: '#d9b88a' };
const PORCELAIN = shared(mat(C.porcelain, { side: THREE.DoubleSide }));
const GLAZE_RED = shared(mat(C.red));
const NOODLE = shared(food(C.noodle, { spec: 0.22, gloss: 16 }));
const NOODLE_INK = inkMat('#a47c3c', 0.0006);

// ------------------------------------------------------------------ painted food textures (raw sRGB)
const texCache = new Map();
function canvasTex(key, w, h, draw){
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace; // sampled raw, like every other colour here
  t.anisotropy = 4;
  texCache.set(key, t);
  return t;
}
// fine grain: many tiny translucent dots or dashes
function grain(g, w, h, n, colors, { r = [0.5, 1.5], a = [0.05, 0.2], dash = 0, angle = null } = {}){
  for (let i = 0; i < n; i++){
    g.globalAlpha = rnd(a[0], a[1]);
    g.fillStyle = g.strokeStyle = colors[i % colors.length];
    const x = Math.random() * w, y = Math.random() * h;
    if (dash){
      const an = angle ?? Math.random() * TAU, l = rnd(dash * 0.4, dash);
      g.lineWidth = rnd(r[0], r[1]);
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(an) * l, y + Math.sin(an) * l); g.stroke();
    } else { g.beginPath(); g.arc(x, y, rnd(r[0], r[1]), 0, TAU); g.fill(); }
  }
  g.globalAlpha = 1;
}
const radial = (g, x, y, r0, r1, stops) => { const gr = g.createRadialGradient(x, y, r0, x, y, r1); stops.forEach(([o, c]) => gr.addColorStop(o, c)); return gr; };
const sheen = (g, x, y, rx, ry, a = 0.3) => { g.save(); g.translate(x, y); g.scale(1, ry / rx); g.fillStyle = radial(g, 0, 0, 0, rx, [[0, `rgba(255,255,255,${a})`], [1, 'rgba(255,255,255,0)']]); g.beginPath(); g.arc(0, 0, rx, 0, TAU); g.fill(); g.restore(); };

const TEX = {
  // rolled chashu: seared rim, a spiral of pink-brown meat and creamy fat, soy glaze
  chashu: () => canvasTex('chashu', 256, 256, (g) => {
    g.fillStyle = '#5e2a14'; g.fillRect(0, 0, 256, 256);
    g.fillStyle = radial(g, 128, 128, 90, 126, [[0, '#9a5531'], [0.7, '#7a3a1d'], [1, '#5e2a14']]); g.beginPath(); g.arc(128, 128, 126, 0, TAU); g.fill();
    g.fillStyle = radial(g, 128, 128, 10, 108, [[0, '#d9a27e'], [0.8, '#c78963'], [1, '#a9653f']]); g.beginPath(); g.arc(128, 128, 106, 0, TAU); g.fill();
    g.lineCap = 'round';
    for (const [w, col, a] of [[13, '#f3dcc0', 0.95], [4, '#e7c49d', 1]]){
      g.strokeStyle = col; g.lineWidth = w; g.globalAlpha = a; g.beginPath();
      for (let t = 0.6; t < 3.2 * Math.PI * 2; t += 0.05){ const r = 6 + t * 4.9 + Math.sin(t * 3) * 2.5; const x = 128 + Math.cos(t) * r, y = 128 + Math.sin(t) * r; t > 0.6 ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke();
    }
    g.globalAlpha = 1;
    grain(g, 256, 256, 900, ['#7a3a1d', '#b8714a', '#f0d2b0'], { r: [0.5, 1.3], a: [0.08, 0.25], dash: 7 });
    sheen(g, 96, 84, 60, 26, 0.28);
  }),
  chashuSide: () => canvasTex('chashuSide', 128, 32, (g, w, h) => {
    g.fillStyle = '#6b3118'; g.fillRect(0, 0, w, h);
    grain(g, w, h, 300, ['#3e1a0a', '#9a5531'], { r: [0.5, 1.2], a: [0.2, 0.5], dash: 5, angle: Math.PI / 2 });
  }),
  // ajitama cut face: soy-tinted white, jammy orange yolk with a glossy centre
  ajitama: () => canvasTex('ajitama', 256, 256, (g) => {
    g.fillStyle = '#c98f55'; g.fillRect(0, 0, 256, 256);
    g.fillStyle = radial(g, 128, 128, 100, 128, [[0, '#fbf3e3'], [0.75, '#f3e2c2'], [1, '#c98f55']]); g.beginPath(); g.arc(128, 128, 127, 0, TAU); g.fill();
    g.fillStyle = radial(g, 128, 132, 4, 70, [[0, '#f59a12'], [0.55, '#ef8a17'], [0.85, '#f4b23a'], [1, '#f6d07a']]); g.beginPath(); g.arc(128, 132, 68, 0, TAU); g.fill();
    sheen(g, 112, 112, 26, 12, 0.55);
    grain(g, 256, 256, 200, ['#e8d6b4'], { r: [0.5, 1], a: [0.1, 0.3] });
  }),
  naruto: () => canvasTex('naruto', 256, 256, (g) => {
    g.fillStyle = '#fbf6ec'; g.fillRect(0, 0, 256, 256);
    grain(g, 256, 256, 500, ['#efe4d0', '#ffffff'], { r: [0.6, 1.6], a: [0.2, 0.5] });
    g.strokeStyle = '#e06b8b'; g.lineWidth = 15; g.lineCap = 'round'; g.shadowColor = '#e06b8b'; g.shadowBlur = 6; g.beginPath();
    for (let t = 0; t < 3.0 * TAU; t += 0.05){ const r = 6 + t * 5.6; const x = 128 + Math.cos(t) * r, y = 128 + Math.sin(t) * r; t ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke(); g.shadowBlur = 0;
  }),
  // kamaboko slice: white, with the pink coat along the curved edge (UVs span the D shape)
  kamaboko: () => canvasTex('kamaboko', 256, 256, (g) => {
    g.fillStyle = '#ec7f97'; g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#fcf7ef'; g.beginPath(); g.ellipse(128, 256, 112, 226, 0, Math.PI, TAU); g.fill();
    grain(g, 256, 256, 400, ['#efe4d0'], { r: [0.6, 1.4], a: [0.2, 0.5] });
  }),
  menma: () => canvasTex('menma', 64, 256, (g, w, h) => {
    g.fillStyle = '#c89548'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 3){ g.fillStyle = Math.random() < 0.5 ? '#a8742f' : '#dcae66'; g.globalAlpha = rnd(0.25, 0.6); g.fillRect(x, 0, rnd(0.8, 1.8), h); }
    g.globalAlpha = 1;
    grain(g, w, h, 120, ['#8a5a22'], { r: [0.5, 1], a: [0.2, 0.4], dash: 14, angle: Math.PI / 2 });
  }),
  nori: () => canvasTex('nori', 128, 160, (g, w, h) => {
    g.fillStyle = '#1d2219'; g.fillRect(0, 0, w, h);
    grain(g, w, h, 1500, ['#2e3a25', '#11140e', '#3b4a2c'], { r: [0.4, 1.2], a: [0.3, 0.8], dash: 4 });
    sheen(g, w * 0.35, h * 0.3, w * 0.5, h * 0.2, 0.12);
  }),
  garlic: () => canvasTex('garlic', 128, 128, (g) => {
    g.fillStyle = '#a8692c'; g.fillRect(0, 0, 128, 128);
    g.fillStyle = radial(g, 64, 64, 10, 64, [[0, '#f6dfa6'], [0.65, '#e8b866'], [0.9, '#c98a3c'], [1, '#a8692c']]); g.beginPath(); g.arc(64, 64, 63, 0, TAU); g.fill();
    g.strokeStyle = '#d9a556'; g.lineWidth = 2; g.beginPath(); g.ellipse(64, 64, 8, 34, 0.2, 0, TAU); g.stroke();
  }),
  leaf: (key, base, vein, edge) => canvasTex(key, 128, 128, (g) => {
    g.fillStyle = radial(g, 64, 64, 10, 90, [[0, base], [1, edge]]); g.fillRect(0, 0, 128, 128);
    g.strokeStyle = vein; g.lineWidth = 3; g.beginPath(); g.moveTo(4, 64); g.lineTo(124, 64); g.stroke();
    g.lineWidth = 1.2;
    for (let x = 16; x < 120; x += 14){ g.beginPath(); g.moveTo(x, 64); g.quadraticCurveTo(x + 10, 40, x + 20, 18); g.moveTo(x, 64); g.quadraticCurveTo(x + 10, 88, x + 20, 110); g.stroke(); }
    grain(g, 128, 128, 300, [edge, base], { r: [0.5, 1.4], a: [0.1, 0.3] });
  }),
  bellySide: () => canvasTex('bellySide', 128, 64, (g, w, h) => {
    const layers = [['#7a3a1c', 8], ['#f6e4c8', 10], ['#b0623a', 10], ['#f8e8cf', 9], ['#a2552f', 11], ['#f3dcbc', 8], ['#7a3a1c', 10]];
    let y = 0;
    for (const [c, t] of layers){ g.fillStyle = c; g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= w; x += 8) g.lineTo(x, y + Math.sin(x * 0.15 + y) * 1.5); g.lineTo(w, h); g.lineTo(0, h); g.fill(); y += t; }
    grain(g, w, h, 200, ['#5a2410', '#ffffff'], { r: [0.4, 1], a: [0.1, 0.3], dash: 6, angle: 0 });
  }),
  bellyTop: () => canvasTex('bellyTop', 128, 64, (g, w, h) => {
    g.fillStyle = '#7a3a1c'; g.fillRect(0, 0, w, h);
    grain(g, w, h, 300, ['#5a2410', '#a8643a'], { r: [0.5, 1.4], a: [0.2, 0.5], dash: 8, angle: 0 });
    sheen(g, w * 0.4, h * 0.4, w * 0.4, h * 0.25, 0.3);
  }),
};

// ------------------------------------------------------------------ the bowl
const K = 0.34 / 212; // the Anatomy figure's millimetres, scaled to stage units
const RIM_S = 70, BROTH_S = 60;
const outerR = (s) => 44 + 62 * (1 - (1 - (s - 8) / 62) ** 2.1);
const innerR = (s) => Math.max(0, outerR(s) - 6 - (70 - s) * 0.05);
export const BOWL = { r: 106 * K, h: RIM_S * K, brothY: BROTH_S * K, brothR: innerR(BROTH_S) * K };

function bowlMesh(scale = 1){
  const p = [[0, 0], [38, 0], [38, 8]];
  for (let s = 8; s <= 70; s += 2) p.push([outerR(s), s]);
  p.push([105.6, 71.4], [104, 72.2], [101.6, 71.6], [100.4, 70]);
  for (let s = 68; s >= 18; s -= 2) p.push([innerR(s), s]);
  p.push([innerR(16) * 0.7, 15.4], [0, 15]);
  const pts = p.map(([r, s]) => new THREE.Vector2(r * K * scale, s * K * scale));
  const g = new THREE.Group();
  g.add(solid(new THREE.LatheGeometry(pts, 72), PORCELAIN));
  // red glaze bands and a raimon (thunder) border, as on the Anatomy figure
  for (const s of [48, 62]){
    const ring = new THREE.Mesh(new THREE.TorusGeometry((outerR(s) + 0.5) * K * scale, 0.0013 * scale, 6, 96), GLAZE_RED);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = s * K * scale;
    g.add(ring);
  }
  const n = 40, box = new THREE.BoxGeometry(0.0058 * scale, 0.0058 * scale, 0.001 * scale);
  const inst = new THREE.InstancedMesh(box, GLAZE_RED, n);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  for (let i = 0; i < n; i++){
    const a = (i / n) * TAU, r = (outerR(55) + 0.6) * K * scale;
    e.set(0, -a + Math.PI / 2, Math.PI / 4, 'YXZ'); q.setFromEuler(e);
    m4.compose(new THREE.Vector3(Math.cos(a) * r, 55 * K * scale, Math.sin(a) * r), q, new THREE.Vector3(1, 1, 1));
    inst.setMatrixAt(i, m4);
  }
  g.add(inst);
  return g;
}

function brothMesh(id, scale = 1){
  const g = new THREE.Group();
  const color = INGREDIENTS[id].color;
  const surf = new THREE.Mesh(new THREE.CircleGeometry(BOWL.brothR * scale, 64), food(color, { spec: 0.3, gloss: 30 }));
  surf.rotation.x = -Math.PI / 2;
  g.add(surf);
  // sheen and fat droplets, as on the icon
  const sheen = new THREE.Mesh(new THREE.CircleGeometry(BOWL.brothR * scale * 0.38, 32), mat('#ffffff', { opacity: 0.2, flat: true }));
  sheen.rotation.x = -Math.PI / 2; sheen.scale.set(1, 0.35, 1); sheen.position.set(-BOWL.brothR * 0.25 * scale, 0.0003, -BOWL.brothR * 0.3 * scale);
  g.add(sheen);
  const drop = mat('#fff6d8', { opacity: 0.4, flat: true });
  for (let i = 0; i < 14; i++){
    const a = Math.random() * TAU, d = (0.35 + Math.random() * 0.6) * BOWL.brothR * scale;
    const c = new THREE.Mesh(new THREE.CircleGeometry((0.002 + Math.random() * 0.004) * scale, 16), drop);
    c.rotation.x = -Math.PI / 2;
    c.position.set(Math.cos(a) * d, 0.0004, Math.sin(a) * d);
    g.add(c);
  }
  return g;
}

/* Noodles, built the way they sit in a real bowl: a folded bed of strands, two or
   three layers deep, each layer at a slightly different angle. Strands rise into a
   soft mound in the middle and their ends dip under the broth (`dip`), so they look
   like they come up out of the soup instead of stopping in mid-air.
   - straight / flat: long strands with a gentle S-wave (flat ones are wide ribbons)
   - curly (chijire): short, tight kinks along a wandering path — the crinkle of
     Sapporo and Tokyo noodles. */
function noodleMesh(id, radius, { dip = true } = {}){
  const n = INGREDIENTS[id];
  const tube = { 1.8: 0.0011, 3.2: 0.0016, 4.6: 0.0021, 5.2: 0.0022, 6.5: 0.0021 }[n.weight] || 0.0017;
  const R = radius;
  const mound = (x, z) => 0.0025 + 0.009 * Math.max(0, 1 - (x * x + z * z) / (R * R)) ** 0.8;
  const sink = (t) => (dip ? -0.009 * Math.max(0, (Math.abs(t) - 0.72) / 0.28) ** 1.6 : 0); // ends go under the soup
  const geos = [];
  const add = (pts) => { if (pts.length >= 4) geos.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 4, tube, 6, false)); };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  if (n.style === 'straight' || n.style === 'flat'){
    const flat = n.style === 'flat';
    const layers = 3, gap = tube * (flat ? 2.9 : 2.3) * layers;
    for (let L = 0; L < layers; L++){
      const ang = (L - 1) * 0.1 + rnd(-0.04, 0.04);
      const dir = [Math.cos(ang), Math.sin(ang)], perp = [-dir[1], dir[0]];
      for (let d = -R * 0.95 + (L * gap) / layers; d <= R * 0.95; d += gap){
        const half = Math.sqrt(Math.max(0, R * R - d * d)) * rnd(1.05, 1.25);
        const ph = rnd(0, TAU), waves = rnd(1.2, 2.2), amp = tube * (flat ? 1.6 : 0.9);
        const pts = [];
        for (let i = 0; i <= 16; i++){
          const t = i / 8 - 1;
          const off = d + Math.sin(t * Math.PI * waves + ph) * amp;
          const x = dir[0] * t * half + perp[0] * off, z = dir[1] * t * half + perp[1] * off;
          pts.push(V(x, mound(x, z) + L * tube * 1.5 + rnd(0, 0.0008) + sink(t), z));
        }
        add(pts);
      }
    }
  } else {
    const strands = Math.round((R * R) / (tube * tube) * 0.075 + 6);
    for (let s = 0; s < strands; s++){
      let a = rnd(0, TAU);
      const r0 = Math.sqrt(Math.random()) * R * 0.75;
      let x = Math.cos(a) * r0 - Math.cos(a) * R * 0.7, z = Math.sin(a) * r0 - Math.sin(a) * R * 0.7;
      const steps = 34, len = R * rnd(1.5, 2.1), step = len / steps, kink = rnd(1.6, 2.4), ph = rnd(0, TAU);
      const pts = [];
      for (let i = 0; i <= steps; i++){
        const t = (i / steps) * 2 - 1;
        a += rnd(-0.12, 0.12);                       // the path wanders...
        x += Math.cos(a) * step; z += Math.sin(a) * step;
        const k = Math.sin(i * kink + ph) * tube * 1.5; // ...and crinkles side to side
        const px = x - Math.sin(a) * k, pz = z + Math.cos(a) * k;
        if (px * px + pz * pz > (R * 1.15) ** 2) continue;
        pts.push(V(px, mound(px, pz) + rnd(0, 0.003) + sink(t), pz));
      }
      add(pts);
    }
  }
  const geo = mergeGeometries(geos);
  geos.forEach((g) => g.dispose());
  const mesh = new THREE.Mesh(geo, NOODLE);
  // a fine, warm outline per strand, so the strands read separately like the Anatomy drawings
  const edge = new THREE.Mesh(geo, NOODLE_INK);
  edge.userData.hull = true; edge.renderOrder = -1;
  mesh.add(edge);
  if (n.style === 'flat') mesh.scale.y = 0.55;
  return mesh;
}

// ------------------------------------------------------------------ toppings
/* Each topping is modelled after the real thing, at the size it has in a bowl:
   rolled chashu slices with a fat spiral, a halved soy egg with a jammy yolk,
   scalloped naruto, half-moon kamaboko, julienned ginger, wood-ear ribbons,
   ruffled leaves, glossy oil. Food is soft-shaded with a little shine and a fine
   warm edge; the bowl and plates keep the Anatomy bands and ink. */
const rnd = (a, b) => a + Math.random() * (b - a);
const tint = new THREE.Color();
function scatter(geo, material, count, radius, { y = 0.002, heap = 0.006, tilt = null, scale = [1, 1], colors = null } = {}){
  const inst = new THREE.InstancedMesh(geo, material, count);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const ca = colors && srgb(colors[0]), cb = colors && srgb(colors[1] ?? colors[0]);
  for (let i = 0; i < count; i++){
    const a = Math.random() * TAU, d = Math.sqrt(Math.random()) * radius;
    if (tilt === null) e.set(Math.random() * TAU, Math.random() * TAU, Math.random() * TAU);
    else e.set(rnd(-tilt, tilt), Math.random() * TAU, rnd(-tilt, tilt));
    q.setFromEuler(e);
    const s = rnd(scale[0], scale[1]);
    m4.compose(new THREE.Vector3(Math.cos(a) * d, y + heap * (1 - d / radius) + Math.random() * 0.001, Math.sin(a) * d), q, new THREE.Vector3(s, s, s));
    inst.setMatrixAt(i, m4);
    if (colors){
      const k = Math.random();
      tint.setRGB(ca.x + (cb.x - ca.x) * k, ca.y + (cb.y - ca.y) * k, ca.z + (cb.z - ca.z) * k, THREE.LinearSRGBColorSpace); // raw, no conversion
      inst.setColorAt(i, tint);
    }
  }
  return inst;
}
// an uneven round edge, as on a hand-cut slice
function wobble(geo, amp = 0.06){
  const p = geo.attributes.position, f1 = rnd(0, TAU), f2 = rnd(0, TAU);
  for (let i = 0; i < p.count; i++){
    const x = p.getX(i), z = p.getZ(i), a = Math.atan2(z, x);
    const k = 1 + amp * (Math.sin(3 * a + f1) * 0.6 + Math.sin(5 * a + f2) * 0.4);
    p.setX(i, x * k); p.setZ(i, z * k);
  }
  geo.computeVertexNormals();
  return geo;
}
function noisyShape(r, amp = 0.1, n = 48){
  const s = new THREE.Shape(), f = [rnd(0, TAU), rnd(0, TAU), rnd(0, TAU)];
  for (let i = 0; i <= n; i++){
    const a = (i / n) * TAU;
    const k = r * (1 + amp * (Math.sin(2 * a + f[0]) * 0.5 + Math.sin(3 * a + f[1]) * 0.3 + Math.sin(5 * a + f[2]) * 0.2));
    i ? s.lineTo(Math.cos(a) * k, Math.sin(a) * k) : s.moveTo(Math.cos(a) * k, Math.sin(a) * k);
  }
  return s;
}
// UVs spread over the shape's bounding box (call before rotating the geometry)
function planarUV(geo){
  geo.computeBoundingBox();
  const b = geo.boundingBox, p = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) - b.min.x) / (b.max.x - b.min.x), (p.getY(i) - b.min.y) / (b.max.y - b.min.y));
  uv.needsUpdate = true;
  return geo;
}
// droop the ends of a long piece: y -= k·x²
function droop(geo, k){
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) - k * p.getX(i) ** 2);
  geo.computeVertexNormals();
  return geo;
}
// a leaf lying in XZ: tapered, arched, with a ruffled edge
function leafGeo(len, wid, ruffle = 0.2){
  const geo = new THREE.PlaneGeometry(len, 2, 14, 6);
  const p = geo.attributes.position, ph = rnd(0, TAU);
  for (let i = 0; i < p.count; i++){
    const u = (p.getX(i) + len / 2) / len, v = p.getY(i);
    const hw = wid * Math.max(0, Math.sin(Math.PI * Math.min(1, Math.max(0, u) * 1.04))) ** 0.7;
    const Y = 0.006 * Math.sin(Math.PI * u) - 0.004 * u * u + ruffle * 0.004 * Math.sin(u * 14 + ph) * Math.abs(v) + 0.002 * v * v;
    p.setXYZ(i, u * len - len * 0.25, Y, v * hw);
  }
  geo.computeVertexNormals();
  return geo;
}

const TOPPINGS = {
  chashu: () => { const g = new THREE.Group();
    const top = food('#ffffff', { map: TEX.chashu(), spec: 0.25, gloss: 20 }), side = food('#ffffff', { map: TEX.chashuSide() });
    const slice = (r) => { const m = piece(wobble(new THREE.CylinderGeometry(r, r * 0.97, 0.0055, 48), 0.05), [side, top, side]); m.position.y = 0.00275; return m; };
    const a = slice(0.025); a.rotation.z = 0.1; g.add(a);
    const b = slice(0.023); b.position.set(0.013, 0.0045, 0.009); b.rotation.set(0.12, 0.8, -0.14); g.add(b);
    return g; },
  ajitama: () => { const g = new THREE.Group();
    const shell = piece(new THREE.SphereGeometry(0.016, 32, 16, 0, TAU, 0, Math.PI / 2), food('#cf9658', { spec: 0.35, gloss: 30, side: THREE.DoubleSide }));
    shell.scale.set(1, 0.62, 1.32); shell.rotation.x = Math.PI; shell.position.y = 0.0099; g.add(shell);
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.0159, 48), food('#ffffff', { map: TEX.ajitama(), spec: 0.3, gloss: 40 }));
    face.rotation.x = -Math.PI / 2; face.scale.set(1, 1.32, 1); face.position.y = 0.01; g.add(face);
    g.rotation.z = 0.2; return g; },
  rawEgg: () => { const g = new THREE.Group();
    const geo = new THREE.ExtrudeGeometry(noisyShape(0.022, 0.12), { depth: 0.0006, bevelEnabled: true, bevelThickness: 0.0012, bevelSize: 0.0025, bevelSegments: 3, curveSegments: 48 });
    geo.rotateX(-Math.PI / 2);
    const white = new THREE.Mesh(geo, food('#f6efe0', { opacity: 0.93, spec: 0.5, gloss: 40 })); white.position.y = 0.0012; g.add(white);
    const yolk = piece(new THREE.SphereGeometry(0.0105, 32, 16, 0, TAU, 0, Math.PI / 2), food('#f39a12', { spec: 0.9, gloss: 60 }));
    yolk.scale.y = 0.72; yolk.position.set(0.002, 0.0025, -0.002); g.add(yolk); return g; },
  corn: () => { const g = new THREE.Group();
    const geo = new THREE.SphereGeometry(0.0036, 10, 8); geo.scale(1, 0.8, 0.85);
    g.add(scatter(geo, food('#ffffff', { spec: 0.45, gloss: 36 }), 60, 0.022, { heap: 0.009, scale: [0.85, 1.15], colors: ['#f7d24a', '#e8ac26'] })); return g; },
  butter: () => { const g = new THREE.Group();
    const pool = new THREE.Mesh(new THREE.ShapeGeometry(noisyShape(0.022, 0.15), 32), food('#f8de86', { opacity: 0.8, spec: 0.6, gloss: 40 }));
    pool.rotation.x = -Math.PI / 2; pool.position.y = 0.0008; g.add(pool);
    const pat = piece(new RoundedBoxGeometry(0.022, 0.011, 0.02, 3, 0.0028), food('#fbe7a4', { spec: 0.35, gloss: 28 }));
    pat.position.y = 0.0058; pat.rotation.y = 0.5; g.add(pat); return g; },
  negi: () => { const g = new THREE.Group();
    const outer = new THREE.CylinderGeometry(0.0036, 0.0036, 0.0018, 16, 1, true), inner = new THREE.CylinderGeometry(0.0022, 0.0022, 0.0018, 12, 1, true);
    const ring = mergeGeometries([outer, inner]); outer.dispose(); inner.dispose();
    g.add(scatter(ring, food('#ffffff', { side: THREE.DoubleSide, spec: 0.3 }), 34, 0.024, { tilt: 0.35, heap: 0.005, scale: [0.8, 1.2], colors: ['#4f8a2c', '#d3e6a4'] })); return g; },
  sesame: () => { const g = new THREE.Group();
    const geo = new THREE.SphereGeometry(0.0017, 8, 5); geo.scale(1, 0.45, 0.62);
    g.add(scatter(geo, food('#ffffff', { spec: 0.4 }), 70, 0.03, { heap: 0.002, colors: ['#f4e3bb', '#d6b177'] }));
    g.add(scatter(geo, food('#2a2016', { spec: 0.4 }), 10, 0.03, { heap: 0.002 })); return g; },
  seabura: () => { const g = new THREE.Group();
    g.add(scatter(new THREE.IcosahedronGeometry(0.0024, 1), food('#ffffff', { opacity: 0.94, spec: 0.6, gloss: 30 }), 42, 0.04, { heap: 0.001, scale: [0.5, 1.4], colors: ['#fffdf6', '#ecdfc2'] })); return g; },
  pepper: () => { const g = new THREE.Group();
    g.add(scatter(new THREE.IcosahedronGeometry(0.0012, 0), food('#ffffff'), 110, 0.036, { heap: 0.001, scale: [0.6, 1.5], colors: ['#16110d', '#4a3d30'] })); return g; },
  moyashi: () => { const g = new THREE.Group();
    const stems = [], heads = [];
    for (let i = 0; i < 16; i++){
      const a = rnd(0, TAU), b = a + rnd(-0.6, 0.6), l = rnd(0.018, 0.028);
      const p0 = new THREE.Vector3(rnd(-0.015, 0.015), rnd(0.002, 0.007), rnd(-0.015, 0.015));
      const p2 = new THREE.Vector3(p0.x + Math.cos(b) * l, p0.y + rnd(-0.002, 0.004), p0.z + Math.sin(b) * l);
      const p1 = p0.clone().lerp(p2, 0.5).add(new THREE.Vector3(rnd(-0.004, 0.004), 0.004, rnd(-0.004, 0.004)));
      stems.push(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(p0, p1, p2), 10, 0.0016, 6));
      const h = new THREE.SphereGeometry(0.0019, 8, 6); h.scale(1, 0.75, 1.3); h.translate(p0.x, p0.y, p0.z); heads.push(h);
    }
    g.add(new THREE.Mesh(mergeGeometries(stems), food('#efe5c8', { spec: 0.35, gloss: 30 })));
    g.add(new THREE.Mesh(mergeGeometries(heads), food('#e4cc5e', { spec: 0.3 })));
    [...stems, ...heads].forEach((x) => x.dispose()); return g; },
  menma: () => { const g = new THREE.Group(); const m = food('#ffffff', { map: TEX.menma(), spec: 0.3, gloss: 26 });
    for (let i = 0; i < 6; i++){
      const geo = new THREE.BoxGeometry(rnd(0.0055, 0.0075), 0.0032, rnd(0.024, 0.03), 1, 1, 8);
      const p = geo.attributes.position, k = rnd(-6, 6);
      for (let j = 0; j < p.count; j++) p.setY(j, p.getY(j) + k * p.getZ(j) ** 2);
      geo.computeVertexNormals();
      const b = piece(geo, m);
      b.position.set(rnd(-0.01, 0.01), 0.002 + i * 0.0024, rnd(-0.006, 0.006)); b.rotation.set(rnd(-0.1, 0.1), rnd(-0.9, 0.9), rnd(-0.12, 0.12)); g.add(b);
    } return g; },
  porkBelly: () => { const g = new THREE.Group();
    const sideM = food('#ffffff', { map: TEX.bellySide() }), topM = food('#ffffff', { map: TEX.bellyTop(), spec: 0.45, gloss: 30 }), botM = food('#8a4524');
    for (let i = 0; i < 2; i++){
      const p = piece(droop(new THREE.BoxGeometry(0.028, 0.0085, 0.017, 10, 1, 1), 9), [sideM, sideM, topM, botM, sideM, sideM]);
      p.position.set(i * 0.014 - 0.007, 0.0038 + i * 0.005, i * 0.01 - 0.005); p.rotation.set(0.35, rnd(-0.6, 0.6), (i ? -1 : 1) * 0.08); g.add(p);
    } return g; },
  nori: () => { const g = new THREE.Group(); // stands up against the rim, the classic look
    const geo = new THREE.BoxGeometry(0.038, 0.05, 0.0012, 8, 8, 1);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) + 25 * p.getX(i) ** 2 + 0.0015 * Math.sin(p.getY(i) * 300));
    geo.computeVertexNormals();
    const dark = food('#1d2219'), face = food('#ffffff', { map: TEX.nori(), spec: 0.25, gloss: 18 });
    const s = piece(geo, [dark, dark, dark, dark, face, face]); s.position.y = 0.022; s.rotation.x = -0.35; g.add(s); return g; },
  naruto: () => { const g = new THREE.Group(); const R0 = 0.018, s = new THREE.Shape();
    for (let i = 0; i <= 96; i++){ const a = (i / 96) * TAU, r = R0 * (1 + 0.05 * Math.cos(a * 18)); i ? s.lineTo(Math.cos(a) * r, Math.sin(a) * r) : s.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
    const geo = planarUV(new THREE.ExtrudeGeometry(s, { depth: 0.0035, bevelEnabled: true, bevelThickness: 0.0006, bevelSize: 0.0006, bevelSegments: 2, curveSegments: 4 }));
    geo.rotateX(-Math.PI / 2);
    const d = piece(geo, [food('#ffffff', { map: TEX.naruto(), spec: 0.2 }), food('#f6eee0', { spec: 0.15 })]);
    d.position.y = 0.0006; d.rotation.x = 0.12; g.add(d); return g; },
  kamaboko: () => { const g = new THREE.Group(); const w = 0.036, h = 0.017;
    const face = food('#ffffff', { map: TEX.kamaboko(), spec: 0.2 }), side = food('#ee8ea3', { spec: 0.15 });
    for (let i = 0; i < 2; i++){
      const s = new THREE.Shape(); s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.absellipse(0, 0, w / 2, h, 0, Math.PI, false);
      const geo = planarUV(new THREE.ExtrudeGeometry(s, { depth: 0.0045, bevelEnabled: true, bevelThickness: 0.0005, bevelSize: 0.0005, bevelSegments: 2, curveSegments: 24 }));
      geo.rotateX(-Math.PI / 2); geo.translate(0, 0.0005, h / 2);
      const k = piece(geo, [face, side]);
      k.position.set(i * 0.006, i * 0.004, i * -0.008); k.rotation.set(i * 0.15, i * 0.35, 0); g.add(k);
    } return g; },
  beniShoga: () => { const g = new THREE.Group();
    g.add(scatter(new THREE.BoxGeometry(0.0015, 0.0011, 0.013), food('#ffffff', { spec: 0.5, gloss: 30 }), 46, 0.016, { tilt: 0.5, heap: 0.008, colors: ['#d01d3a', '#f0566d'] })); return g; },
  kikurage: () => { const g = new THREE.Group(); const geos = [];
    for (let i = 0; i < 9; i++){
      const a = rnd(0, TAU), x = rnd(-0.012, 0.012), z = rnd(-0.012, 0.012), l = rnd(0.018, 0.028), y = 0.006 + i * 0.0035;
      const pts = [];
      for (let k = 0; k <= 6; k++){
        const t = k / 6 - 0.5, side = Math.sin(t * 7 + i) * 0.0015;
        pts.push(new THREE.Vector3(x + Math.cos(a) * t * l + Math.sin(a) * side, y + Math.sin(t * 9 + i) * 0.003, z + Math.sin(a) * t * l - Math.cos(a) * side));
      }
      const tg = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.0024, 6); tg.scale(1, 0.35, 1); geos.push(tg);
    }
    g.add(piece(mergeGeometries(geos), food('#2b1d16', { spec: 0.55, gloss: 30 }))); geos.forEach((x) => x.dispose()); return g; },
  garlicChips: () => { const g = new THREE.Group();
    g.add(scatter(wobble(new THREE.CylinderGeometry(0.0058, 0.0058, 0.0009, 20), 0.08), food('#ffffff', { map: TEX.garlic(), spec: 0.25 }), 16, 0.02, { tilt: 0.5, heap: 0.006, colors: ['#ffffff', '#e8cfa6'] })); return g; },
  mayu: () => { const g = new THREE.Group(); const m = food('#17100b', { opacity: 0.94, spec: 0.9, gloss: 50 });
    for (let i = 0; i < 6; i++){
      const r = i ? rnd(0.004, 0.009) : 0.017, a = rnd(0, TAU), d = i ? rnd(0.016, 0.03) : 0;
      const p = new THREE.Mesh(new THREE.ShapeGeometry(noisyShape(r, 0.25), 24), m);
      p.rotation.x = -Math.PI / 2; p.position.set(Math.cos(a) * d, 0.0007 + i * 0.00005, Math.sin(a) * d); g.add(p);
    }
    const glint = new THREE.Mesh(new THREE.CircleGeometry(0.006, 24), mat('#ffffff', { flat: true, opacity: 0.22 }));
    glint.rotation.x = -Math.PI / 2; glint.scale.set(1, 0.4, 1); glint.position.set(-0.004, 0.001, -0.005); g.add(glint); return g; },
  spinach: () => { const g = new THREE.Group();
    const m = food('#ffffff', { map: TEX.leaf('spinachLeaf', '#3f7a2e', '#6fa64e', '#244d1c'), side: THREE.DoubleSide, spec: 0.35, gloss: 22 });
    for (let i = 0; i < 6; i++){
      const l = new THREE.Mesh(leafGeo(rnd(0.026, 0.034), rnd(0.012, 0.016), 0.25), m);
      l.position.set(rnd(-0.004, 0.004), 0.002 + i * 0.0016, rnd(-0.004, 0.004)); l.rotation.y = (i / 6) * TAU + rnd(-0.3, 0.3); g.add(l);
    }
    const stems = [];
    for (let i = 0; i < 4; i++){ const a = rnd(0, TAU); stems.push(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0.012, 0), new THREE.Vector3(Math.cos(a) * 0.006, 0.014, Math.sin(a) * 0.006), new THREE.Vector3(Math.cos(a) * 0.014, 0.008, Math.sin(a) * 0.014)), 8, 0.0012, 5)); }
    g.add(new THREE.Mesh(mergeGeometries(stems), food('#8dbb5a', { spec: 0.3 }))); stems.forEach((x) => x.dispose()); return g; },
  wakame: () => { const g = new THREE.Group();
    const m = food('#ffffff', { map: TEX.leaf('wakameLeaf', '#2f5b2a', '#4f8040', '#1b3a18'), side: THREE.DoubleSide, opacity: 0.94, spec: 0.6, gloss: 30 });
    for (let i = 0; i < 5; i++){
      const l = new THREE.Mesh(leafGeo(rnd(0.03, 0.038), rnd(0.008, 0.011), 1), m);
      l.position.set(rnd(-0.005, 0.005), 0.002 + i * 0.0018, rnd(-0.005, 0.005)); l.rotation.y = (i / 5) * TAU + rnd(-0.4, 0.4); g.add(l);
    } return g; },
};
const toppingMesh = (id) => TOPPINGS[id]();
const SLOTS = [[-2.2, 0.6], [0.5, 0.6], [2.4, 0.58], [-0.85, 0.64], [1.5, 0.64]];

// A token: the ingredient standing on a little plate, as on its icon.
function tokenModel(id, { plate = true } = {}){
  const ing = INGREDIENTS[id];
  const g = new THREE.Group();
  if (plate){
    g.add(solid(new THREE.CylinderGeometry(0.042, 0.036, 0.007, 40), PORCELAIN).translateY(0.0035));
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.0405, 0.0014, 6, 64), GLAZE_RED);
    rim.rotation.x = Math.PI / 2; rim.position.y = 0.0072; g.add(rim);
  }
  let model;
  if (ing.layer === 'broth'){
    model = new THREE.Group();
    const s = 0.21; // a small bowl that sits inside the plate's rim
    model.add(bowlMesh(s));
    const br = brothMesh(id, s); br.position.y = BOWL.brothY * s; model.add(br);
  } else if (ing.layer === 'noodles'){
    model = noodleMesh(id, 0.03, { dip: false });
  } else {
    model = toppingMesh(id);
    if (id === 'nori') model.position.z = 0.008;
  }
  model.position.y += 0.007;
  g.add(model);
  return g;
}

// ------------------------------------------------------------------ pictures of the 3D models
/* The order ticket shows each ingredient as a picture rendered from its own 3D model,
   at the same Anatomy angle, so the ticket and the plates always look the same.
   The finished bowl is pictured the same way on the "bowl served" card. Rendered at
   twice the size and scaled down, for smooth edges. */
const iconUrls = new Map();
let snapper = null;
function snap(obj, px, pad = 1.08){
  if (!snapper){
    snapper = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    snapper.setPixelRatio(1);
    snapper.setClearColor(0x000000, 0);
  }
  const S = px * 2;
  snapper.setSize(S, S, false);
  const parent = obj.parent, scene = new THREE.Scene();
  scene.add(obj);
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj, true), c = box.getCenter(new THREE.Vector3());
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 20);
  const az = AZIMUTH * DEG, el = ELEVATION * DEG;
  cam.position.set(c.x + Math.sin(az) * Math.cos(el) * 4, c.y + Math.sin(el) * 4, c.z + Math.cos(az) * Math.cos(el) * 4);
  cam.lookAt(c);
  cam.updateMatrixWorld();
  let hw = 0;
  for (let i = 0; i < 8; i++){
    const v = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyMatrix4(cam.matrixWorldInverse);
    hw = Math.max(hw, Math.abs(v.x), Math.abs(v.y));
  }
  hw *= pad;
  Object.assign(cam, { left: -hw, right: hw, top: hw, bottom: -hw });
  cam.updateProjectionMatrix();
  snapper.render(scene, cam);
  scene.remove(obj);
  if (parent) parent.add(obj);
  const out = document.createElement('canvas');
  out.width = out.height = px;
  const g = out.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(snapper.domElement, 0, 0, px, px);
  return out.toDataURL('image/png');
}
export async function preloadIcons(){
  if (iconUrls.size) return;
  const ids = Object.keys(INGREDIENTS);
  for (let i = 0; i < ids.length; i++){
    const m = tokenModel(ids[i], { plate: false }); // just the food, so it fills the little ticket chip
    iconUrls.set(ids[i], snap(m, 128, 1.12));
    dispose(m);
    if (i % 4 === 3) await new Promise((ok) => setTimeout(ok, 0)); // keep the page responsive
  }
}
export const iconUrl = (id) => iconUrls.get(id);
export const bowlPicture = (px = 320) => (R.bowl ? snap(R.bowl, px, 1.04) : null);

// ------------------------------------------------------------------ stage state
const R = {
  renderer: null, scene: new THREE.Scene(), camera: null, canvas: null, container: null,
  world: new THREE.Group(), bowlSpot: new THREE.Group(), tokensRoot: new THREE.Group(), fx: new THREE.Group(),
  counter: null, bowl: null, contents: null, tokens: [], steam: [], steamOn: false, hintIds: null,
  pick: null, lastT: 0, running: false, layout: null, zoom: 600,
  view: { az: 0, el: 0, dragAz: 0, dragEl: 0, gyroAz: 0, gyroEl: 0, gyro0: null },
  mindar: null, video: null, labels: null,
};
R.scene.add(R.world);
R.world.add(R.bowlSpot, R.tokensRoot, R.fx);

function buildStatic(){
  // the counter the bowl stands on: a low Anatomy-style slab with a lighter top
  const slab = new THREE.Group();
  slab.add(solid(new THREE.CylinderGeometry(BOWL.r * 1.32, BOWL.r * 1.36, 0.022, 64), mat(C.wood)).translateY(-0.011));
  const top = new THREE.Mesh(new THREE.CircleGeometry(BOWL.r * 1.24, 64), mat(C.woodTop));
  top.rotation.x = -Math.PI / 2; top.position.y = 0.0004; slab.add(top);
  const ringLine = new THREE.Mesh(new THREE.RingGeometry(BOWL.r * 1.24, BOWL.r * 1.255, 64), mat('#8c7457', { flat: true }));
  ringLine.rotation.x = -Math.PI / 2; ringLine.position.y = 0.0006; slab.add(ringLine);
  for (let i = 0; i < 4; i++){ // screws, like the Anatomy plates
    const a = (i / 4) * TAU + Math.PI / 4;
    const sc = solid(new THREE.CylinderGeometry(0.0035, 0.0035, 0.0015, 12), mat('#ddcaa8'));
    sc.position.set(Math.cos(a) * BOWL.r * 1.12, 0.001, Math.sin(a) * BOWL.r * 1.12); slab.add(sc);
  }
  R.bowlSpot.add(slab);
  R.counter = slab;
  // steam puffs
  const sc = document.createElement('canvas'); sc.width = sc.height = 64;
  const sg = sc.getContext('2d'); const sgr = sg.createRadialGradient(32, 32, 2, 32, 32, 32);
  sgr.addColorStop(0, 'rgba(255,250,240,.8)'); sgr.addColorStop(1, 'rgba(255,250,240,0)'); sg.fillStyle = sgr; sg.fillRect(0, 0, 64, 64);
  const smap = new THREE.CanvasTexture(sc);
  for (let i = 0; i < 9; i++){
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smap, transparent: true, depthWrite: false, opacity: 0 }));
    s.userData.phase = i / 9; s.userData.x = rnd(-0.05, 0.05); s.userData.z = rnd(-0.04, 0.04);
    R.bowlSpot.add(s); R.steam.push(s);
  }
}

// ------------------------------------------------------------------ camera & layout
function aimCamera(){
  const v = R.view;
  const az = (AZIMUTH + v.dragAz + v.gyroAz) * DEG, el = Math.max(12, Math.min(62, ELEVATION + v.dragEl + v.gyroEl)) * DEG;
  R.camera.position.set(Math.sin(az) * Math.cos(el) * 4, Math.sin(el) * 4, Math.cos(az) * Math.cos(el) * 4);
  R.camera.lookAt(0, 0, 0);
}
function sizeCamera(){
  const w = innerWidth, h = innerHeight;
  Object.assign(R.camera, { left: -w / 2, right: w / 2, top: h / 2, bottom: -h / 2, zoom: R.zoom });
  R.camera.updateProjectionMatrix();
  R.renderer.setSize(w, h);
}
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), FLOOR = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
function floorAt(x, y){
  ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, R.camera);
  const p = new THREE.Vector3();
  return ray.ray.intersectPlane(FLOOR, p) ? p : new THREE.Vector3();
}
const v3 = new THREE.Vector3();
function project(obj, lift = 0){
  if (!R.camera) return { x: innerWidth / 2, y: innerHeight / 2 };
  v3.set(0, lift, 0);
  obj.localToWorld(v3).project(R.camera);
  return { x: (v3.x * 0.5 + 0.5) * innerWidth, y: (-v3.y * 0.5 + 0.5) * innerHeight };
}

/* Lay the stage out in the free screen area below the order card:
   the bowl on its counter at the top, the ingredient plates in a grid below.
   Positions are fixed in the world at the neutral camera, so tilting the
   phone or dragging only turns the view a little around them. */
export function layout(){
  if (!R.camera) return;
  const top = R.layoutTop?.() ?? 120;
  const bottom = innerHeight - (R.layoutBottom?.() ?? 12);
  const W = innerWidth, H = Math.max(200, bottom - top);
  const n = R.tokens.length || 8;
  const cols = W < 420 ? (n > 9 ? 4 : n > 4 ? 3 : n) : Math.min(5, Math.max(3, Math.ceil(n / 2)));
  const rows = Math.max(1, Math.ceil(n / cols));
  const bowlH = H * (rows > 2 ? 0.4 : 0.48);
  // zoom: the bowl on its counter should fill the bowl band
  const counterW = BOWL.r * 2.7;
  const sinE = Math.sin(ELEVATION * DEG), cosE = Math.cos(ELEVATION * DEG);
  const counterHpx = (counterW * sinE + (BOWL.h + 0.03) * cosE);
  R.zoom = Math.max(200, Math.min((W * 0.86) / counterW, (bowlH * 0.92) / counterHpx));
  const saved = { ...R.view };
  Object.assign(R.view, { dragAz: 0, dragEl: 0, gyroAz: 0, gyroEl: 0 });
  sizeCamera(); aimCamera(); R.camera.updateMatrixWorld();
  const bowlBase = floorAt(W / 2, top + bowlH - counterW * sinE * R.zoom * 0.5 - 4);
  R.bowlSpot.position.copy(bowlBase);
  const cellW = W / cols, gridTop = top + bowlH, cellH = (H - bowlH) / rows;
  const tokenPx = Math.min(cellW * 0.78, cellH * 0.95);
  const scale = tokenPx / (0.084 * R.zoom);
  R.layout = { cols, rows, cellW, cellH, gridTop, scale };
  R.tokens.forEach((t, i) => {
    const r = Math.floor(i / cols), c = i % cols;
    const inRow = Math.min(cols, n - r * cols);
    const x = (W - inRow * cellW) / 2 + (c + 0.5) * cellW;
    const y = gridTop + (r + 0.5) * cellH;
    t.home.copy(floorAt(x, y));
    t.node.position.copy(t.home);
    t.scale = scale;
    if (t.alive && !t.entering) t.node.scale.setScalar(scale);
  });
  Object.assign(R.view, saved);
  aimCamera();
}

// ------------------------------------------------------------------ public: bowl
export function newBowl(){
  if (R.bowl){ R.bowlSpot.remove(R.bowl); dispose(R.bowl); }
  R.bowl = new THREE.Group();
  R.bowl.add(bowlMesh());
  R.contents = new THREE.Group();
  R.contents.position.y = BOWL.brothY;
  R.bowl.add(R.contents);
  R.bowlSpot.add(R.bowl);
  R.toppingCount = 0;
  R.steamOn = false;
  const b = R.bowl;
  tw(0.55, EASE.back, (k) => { b.position.y = (1 - k) * 0.15; b.scale.setScalar(0.6 + 0.4 * k); });
}

function addToBowl(id){
  const ing = INGREDIENTS[id];
  if (ing.layer === 'broth'){
    const br = brothMesh(id);
    br.scale.setScalar(0.3);
    R.contents.add(br);
    tw(0.5, EASE.out, (k) => { br.position.y = -0.03 * (1 - k); br.scale.setScalar(0.3 + 0.7 * k); });
    R.steamOn = true;
  } else if (ing.layer === 'noodles'){
    const nd = noodleMesh(id, BOWL.brothR * 0.7);
    R.contents.add(nd);
    const sy = nd.scale.y;
    tw(0.45, EASE.back, (k) => { nd.position.y = (1 - k) * 0.05; nd.scale.y = Math.max(0.05, k) * sy; });
  } else {
    const t = toppingMesh(id);
    const [a, d] = id === 'nori' ? [-Math.PI * 0.75, 0.78] : SLOTS[R.toppingCount++ % SLOTS.length];
    const spread = ['seabura', 'pepper', 'sesame'].includes(id);
    const y0 = spread ? 0.011 : 0.008; // rest on top of the noodle mound
    t.position.set(spread ? 0 : Math.cos(a) * d * BOWL.brothR, y0, spread ? 0 : Math.sin(a) * d * BOWL.brothR);
    if (id === 'nori') t.rotation.y = -a - Math.PI / 2;
    else if (!spread) t.rotation.y = rnd(0, TAU);
    R.contents.add(t);
    const big = spread ? 1.4 : 1.75; // toppings read at bowl size
    tw(0.4, EASE.back, (k) => { t.position.y = y0 + (1 - k) * 0.05; t.scale.setScalar(big * (0.4 + 0.6 * k)); });
  }
}

// ------------------------------------------------------------------ public: tokens
export function setTokens(ids){
  clearTokens();
  R.tokens = ids.map((id) => {
    const node = new THREE.Group();
    const model = tokenModel(id);
    node.add(model);
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.07, 12), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = 0.03;
    node.add(hit);
    const label = document.createElement('div');
    label.className = 'tlabel';
    label.textContent = SHORT[id];
    R.labels.appendChild(label);
    const tok = { id, node, model, hit, label, home: new THREE.Vector3(), alive: true, entering: true, scale: 1, phase: Math.random() * TAU, shake: 0 };
    hit.userData.token = tok;
    R.tokensRoot.add(node);
    return tok;
  });
  layout();
  R.tokens.forEach((t, i) => {
    t.node.scale.setScalar(0.001);
    tw(0.45, EASE.back, (k) => t.node.scale.setScalar(Math.max(0.001, k * t.scale)), () => { t.entering = false; }, i * 0.04);
  });
}
export function clearTokens(){
  for (const t of R.tokens){
    const node = t.node, s0 = node.scale.x;
    t.alive = false;
    t.label.remove();
    tw(0.25, EASE.out, (k) => node.scale.setScalar(Math.max(0.001, s0 * (1 - k))), () => { R.tokensRoot.remove(node); dispose(node); });
  }
  R.tokens = [];
}
export function hint(ids){ R.hintIds = ids; }

export function acceptToken(id){
  const tok = R.tokens.find((t) => t.id === id && t.alive);
  if (!tok) return;
  tok.alive = false;
  tok.label.classList.add('gone');
  const node = tok.node;
  const from = node.position.clone();
  const to = R.bowlSpot.position.clone().add(new THREE.Vector3(0, BOWL.h + 0.02, 0));
  const s0 = node.scale.x;
  tw(0.45, EASE.io, (k) => {
    node.position.lerpVectors(from, to, k);
    node.position.y += Math.sin(k * Math.PI) * 0.18;
    node.rotation.y = k * TAU;
    node.scale.setScalar(Math.max(0.001, s0 * (1 - 0.7 * k)));
  }, () => { node.visible = false; addToBowl(id); sparkle(new THREE.Vector3(0, BOWL.h, 0), 0xf6cf45); });
}
export function wrongToken(id){
  const tok = R.tokens.find((t) => t.id === id && t.alive);
  if (tok){ tok.shake = 0.5; tok.label.classList.remove('bad'); void tok.label.offsetWidth; tok.label.classList.add('bad'); }
}

// ------------------------------------------------------------------ public: serve / dump
export async function serveBowl(){
  const b = R.bowl;
  R.steamOn = true;
  sparkle(new THREE.Vector3(0, BOWL.h + 0.02, 0), 0xb5452f, 18);
  await wait(0.7);
  R.steamOn = false;
  await new Promise((ok) => tw(0.6, EASE.io, (k) => {
    b.position.set(k * 0.9, Math.sin(k * Math.PI) * 0.1, -k * 0.3);
    b.rotation.y = -k * 1.2;
    b.scale.setScalar(Math.max(0.001, 1 - 0.5 * k));
  }, ok));
}
export async function dumpBowl(){
  const b = R.bowl;
  R.steamOn = false;
  await new Promise((ok) => tw(0.7, EASE.io, (k) => {
    b.rotation.x = k * 1.6;
    b.position.set(0, Math.sin(k * Math.PI) * 0.05, k * 0.1);
    b.scale.setScalar(Math.max(0.001, 1 - 0.8 * k));
  }, ok));
}

function sparkle(at, color, n = 10){
  const geo = new THREE.IcosahedronGeometry(1, 0);
  for (let i = 0; i < n; i++){
    const p = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true }));
    p.position.copy(at);
    // Start at sparkle size: the geometry is 1 unit (a whole screen), and a sparkle made
    // inside another tween's finish isn't stepped until the next frame, which drew one
    // full-screen yellow frame.
    p.scale.setScalar(0.007);
    R.bowlSpot.add(p);
    const a = Math.random() * TAU, sp = 0.1 + Math.random() * 0.12;
    const vx = Math.cos(a) * sp, vz = Math.sin(a) * sp, vy = 0.1 + Math.random() * 0.12;
    tw(0.6, EASE.out, (k) => {
      p.position.set(at.x + vx * k, at.y + vy * k - 0.15 * k * k, at.z + vz * k);
      p.material.opacity = 1 - k;
      p.scale.setScalar(0.007 * (1 - k * 0.5));
    }, () => { R.bowlSpot.remove(p); p.material.dispose(); if (i === n - 1) geo.dispose(); });
  }
}

export const bowlScreen = () => project(R.bowlSpot, BOWL.h + 0.04);
export const tokenScreen = (id) => { const t = R.tokens.find((x) => x.id === id); return t ? project(t.node, 0.06) : bowlScreen(); };
export function onPick(cb){ R.pick = cb; }
// Screen rectangles for the how-to-play spotlight.
export function bowlRect(){
  const c = project(R.bowlSpot, BOWL.h * 0.45);
  const w = BOWL.r * 2.7 * R.zoom, h = (BOWL.r * 2.7 * 0.5 + BOWL.h) * R.zoom;
  return { left: c.x - w / 2, top: c.y - h * 0.6, width: w, height: h };
}
export function tokensRect(){
  const pts = R.tokens.filter((t) => t.alive).flatMap((t) => [project(t.node, 0.07 * t.scale), { x: project(t.node).x, y: project(t.node).y + 0.05 * t.scale * R.zoom }]);
  if (!pts.length) return { left: 0, top: innerHeight / 2, width: innerWidth, height: innerHeight / 2 };
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const pad = 0.05 * R.zoom * (R.tokens[0]?.scale || 1);
  const left = Math.max(4, Math.min(...xs) - pad), right = Math.min(innerWidth - 4, Math.max(...xs) + pad);
  return { left, top: Math.min(...ys) - 6, width: right - left, height: Math.max(...ys) - Math.min(...ys) + 14 };
}
export function setLayoutBounds(top, bottom){ R.layoutTop = top; R.layoutBottom = bottom; }

// ------------------------------------------------------------------ input: tap a token, drag to turn the view
let down = null;
function onDown(ev){
  if (!R.running || ev.target.closest('button, .plate, .hud, .ordercard, .screen.on')) return;
  down = { x: ev.clientX, y: ev.clientY, az: R.view.dragAz, el: R.view.dragEl, moved: false };
}
function onMove(ev){
  if (!down) return;
  const dx = ev.clientX - down.x, dy = ev.clientY - down.y;
  if (Math.hypot(dx, dy) > 12) down.moved = true;
  if (down.moved){
    R.view.dragAz = Math.max(-35, Math.min(35, down.az - dx * 0.25));
    R.view.dragEl = Math.max(-14, Math.min(22, down.el + dy * 0.15));
  }
}
function onUp(ev){
  if (!down) return;
  const tap = !down.moved;
  down = null;
  if (!tap || !R.pick) return;
  const hits = R.tokens.filter((t) => t.alive).map((t) => t.hit);
  // the touch point first, then a ring around it — fingers are bigger than pixels
  for (const [dx, dy] of [[0, 0], [16, 0], [-16, 0], [0, 16], [0, -16], [24, 24], [-24, -24], [24, -24], [-24, 24]]){
    ndc.set(((ev.clientX + dx) / innerWidth) * 2 - 1, -((ev.clientY + dy) / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, R.camera);
    const h = ray.intersectObjects(hits, false)[0];
    if (h){ R.pick(h.object.userData.token.id); return; }
  }
}
function onGyro(e){
  if (e.beta == null || e.gamma == null) return;
  if (!R.view.gyro0) R.view.gyro0 = { b: e.beta, g: e.gamma };
  // small parallax: tilting the phone turns the view a few degrees, so the shop feels solid
  R.view.gyroAz = Math.max(-10, Math.min(10, (e.gamma - R.view.gyro0.g) * 0.35));
  R.view.gyroEl = Math.max(-8, Math.min(8, -(e.beta - R.view.gyro0.b) * 0.25));
}
export async function askMotion(){
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) await DeviceOrientationEvent.requestPermission();
  } catch { /* declined: no parallax */ }
}

// ------------------------------------------------------------------ frame
function frame(){
  const now = performance.now();
  const dt = Math.min((now - R.lastT) / 1000, 0.05);
  R.lastT = now;
  updateTweens(dt);
  const t = now / 1000;
  if (!down){ R.view.dragAz *= 0.96; R.view.dragEl *= 0.96; } // the view eases back to the Anatomy angle
  aimCamera();
  for (const tok of R.tokens){
    if (!tok.alive) continue;
    const hinted = R.hintIds && R.hintIds.includes(tok.id);
    tok.node.position.y = tok.home.y + Math.sin(t * 1.6 + tok.phase) * 0.004 + (hinted ? 0.012 + Math.abs(Math.sin(t * 6)) * 0.02 : 0);
    tok.model.rotation.y = t * 0.4 + tok.phase;
    if (tok.shake > 0){
      tok.shake = Math.max(0, tok.shake - dt);
      tok.node.position.x = tok.home.x + Math.sin(tok.shake * 60) * 0.01 * (tok.shake / 0.5);
    } else tok.node.position.x = tok.home.x;
  }
  for (const s of R.steam){
    const p = (t * 0.35 + s.userData.phase) % 1;
    s.position.set(s.userData.x + Math.sin(t + s.userData.phase * 9) * 0.01, BOWL.brothY + 0.01 + p * 0.18, s.userData.z);
    s.scale.setScalar(0.03 + p * 0.07);
    const target = R.steamOn && R.bowl ? Math.sin(p * Math.PI) * 0.6 : 0;
    s.material.opacity += (target - s.material.opacity) * 0.1;
  }
  R.renderer.render(R.scene, R.camera);
  // labels ride under their plates
  for (const tok of R.tokens){
    if (!tok.alive) continue;
    v3.copy(tok.home).project(R.camera);
    tok.label.style.transform = `translate(${((v3.x * 0.5 + 0.5) * innerWidth).toFixed(1)}px, ${((-v3.y * 0.5 + 0.5) * innerHeight + 0.032 * tok.scale * R.zoom).toFixed(1)}px) translate(-50%,0)`;
  }
}

// ------------------------------------------------------------------ backends
function startStage(container){
  R.container = container;
  if (!R.renderer){
    R.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    R.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    R.renderer.outputColorSpace = THREE.SRGBColorSpace;
    R.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 20);
    addEventListener('resize', () => { if (R.running){ sizeCamera(); layout(); } });
    addEventListener('pointerdown', onDown, { passive: true });
    addEventListener('pointermove', onMove, { passive: true });
    addEventListener('pointerup', onUp, { passive: true });
    addEventListener('deviceorientation', onGyro);
  }
  R.canvas = R.renderer.domElement;
  R.canvas.className = 'stage';
  container.appendChild(R.canvas);
  R.labels = document.createElement('div');
  R.labels.className = 'labels';
  container.appendChild(R.labels);
  R.view.gyro0 = null;
  R.running = true;
  sizeCamera(); aimCamera(); layout();
  R.lastT = performance.now();
  R.renderer.setAnimationLoop(frame);
}

async function cameraVideo(container){
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    const video = document.createElement('video');
    Object.assign(video, { srcObject: stream, playsInline: true, muted: true, autoplay: true });
    video.setAttribute('playsinline', '');
    video.className = 'feed';
    container.appendChild(video);
    await video.play();
    R.video = video;
  } catch { container.classList.add('nocam'); }
}

// Recognition only: MindAR watches the camera until it sees the card, then its tracking stops.
// Its video keeps running as the AR backdrop, and the stage takes over.
export async function scan(container, { onStatus, onFound }){
  onStatus('Loading the image tracker…');
  const { MindARThree } = await import('mindar-image-three');
  const mindar = new MindARThree({
    container, imageTargetSrc: TARGET_SRC, uiScanning: 'no', uiLoading: 'no', uiError: 'no',
    filterMinCF: 0.001, filterBeta: 1000, warmupTolerance: 3, missTolerance: 10,
  });
  R.mindar = mindar;
  const anchor = mindar.addAnchor(0);
  let found = false;
  anchor.onTargetFound = () => {
    if (found) return;
    found = true;
    try { mindar.controller.stopProcessVideo(); } catch { /* fine */ }
    mindar.renderer.setAnimationLoop(null);
    mindar.renderer.domElement.style.display = 'none';
    R.video = mindar.video;
    onFound();
  };
  onStatus('Starting camera…');
  try { await mindar.start(); }
  catch (e){ try { mindar.stop(); } catch { /* never started */ } R.mindar = null; throw e || new Error('camera unavailable'); }
  mindar.renderer.setAnimationLoop(() => mindar.renderer.render(mindar.scene, mindar.camera));
  onStatus('Looking for the card…');
}
export function open(container){ startStage(container); }
export async function openDemo(container){ await cameraVideo(container); startStage(container); }

export function stop(){
  R.running = false;
  try { R.renderer?.setAnimationLoop(null); } catch { /* gone */ }
  if (R.mindar){ try { R.mindar.stop(); } catch { /* already stopped */ } R.mindar = null; }
  R.container?.querySelectorAll('video').forEach((v) => v.srcObject?.getTracks?.().forEach((t) => t.stop()));
  clearTokens();
  if (R.bowl){ R.bowlSpot.remove(R.bowl); dispose(R.bowl); R.bowl = null; }
  if (R.container){ R.container.innerHTML = ''; R.container.classList.remove('nocam'); }
  R.video = null;
}

buildStatic();
window.__stage = R;
