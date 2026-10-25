// Ramen_Builder stage: once the card is recognised, the shop lives on the screen
// over the live camera — no need to keep the card in frame. It is drawn the way
// the Anatomy kit draws: an orthographic camera at azimuth 45° / elevation 30°,
// four-tone flat shading (lit top = the exact colour, sides step darker toward
// sepia) and an ink outline around every solid. Colours are written raw in sRGB,
// so a 3D ingredient is exactly the colour of its icon on the order ticket.
//
// MindAR (mind-ar 1.2.5 + three 0.160.0, same pins as sushi-ar) is used only for
// the recognition step; after the card is found its tracking stops.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { INGREDIENTS, SHORT } from './data.js';
import { ingredientSvg } from './art.js';

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
varying vec3 vN; varying vec2 vUv;
void main(){
  vUv = uv;
  vec4 p = vec4(position, 1.0);
  vec3 n = normal;
  #ifdef USE_INSTANCING
    p = instanceMatrix * p; n = mat3(instanceMatrix) * n;
  #endif
  vN = normalize(normalMatrix * n);
  vec4 mv = modelViewMatrix * p;
  mv.xyz += vN * uInk;             // ink hull: grow along the normal, in world units
  gl_Position = projectionMatrix * mv;
}`;
const FS = `
uniform vec3 uColor; uniform float uOpacity; uniform sampler2D uMap; uniform float uHasMap; uniform float uAlphaTest; uniform float uFlat;
varying vec3 vN; varying vec2 vUv;
void main(){
  vec4 c = vec4(uColor, uOpacity);
  if (uHasMap > 0.5){ vec4 t = texture2D(uMap, vUv); c.rgb *= t.rgb; c.a *= t.a; }
  if (c.a < uAlphaTest) discard;
  if (uFlat > 0.5){ gl_FragColor = c; return; }
  vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
  float d = dot(n, normalize(vec3(-0.35, 0.82, 0.48)));
  float band = d > 0.6 ? 1.0 : d > 0.25 ? 0.93 : d > -0.1 ? 0.86 : d > -0.45 ? 0.79 : 0.72;
  vec3 tone = mix(vec3(0.55, 0.42, 0.29), vec3(1.0), (band - 0.72) / 0.28); // shade toward walnut, not grey
  gl_FragColor = vec4(c.rgb * mix(vec3(band), tone, 0.55), c.a);
}`;
const srgb = (hex) => { const h = typeof hex === 'string' ? parseInt(hex.slice(1), 16) : hex; return new THREE.Vector3(((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255); };
function mat(color, { map = null, opacity = 1, alphaTest = 0, flat = false, side = THREE.FrontSide, transparent = false } = {}){
  return new THREE.ShaderMaterial({
    vertexShader: VS, fragmentShader: FS, side, transparent: transparent || opacity < 1,
    uniforms: { uColor: { value: srgb(color) }, uOpacity: { value: opacity }, uMap: { value: map }, uHasMap: { value: map ? 1 : 0 },
      uAlphaTest: { value: alphaTest }, uFlat: { value: flat ? 1 : 0 }, uInk: { value: 0 } },
  });
}
const shared = (m) => { m.userData.shared = true; return m; };
const INK_MAT = shared(new THREE.ShaderMaterial({
  vertexShader: VS, fragmentShader: FS, side: THREE.BackSide,
  uniforms: { uColor: { value: srgb('#3b2a1c') }, uOpacity: { value: 1 }, uMap: { value: null }, uHasMap: { value: 0 },
    uAlphaTest: { value: 0 }, uFlat: { value: 1 }, uInk: { value: 0.0022 } },
}));
// Outline a solid with Anatomy's ink line (an inverted hull drawn behind it).
function ink(mesh){
  const hull = new THREE.Mesh(mesh.geometry, INK_MAT);
  hull.userData.hull = true; // shares its solid's geometry, which the solid disposes
  hull.renderOrder = -1;
  mesh.add(hull);
  return mesh;
}
const solid = (geo, m) => ink(new THREE.Mesh(geo, m));

// Same hex values as the 2D art (js/art.js), so 3D and icons match.
const C = { porcelain: '#f6ecd8', inner: '#efe3cb', red: '#b5452f', noodle: '#ecd391', wood: '#c39a62', woodTop: '#d9b88a' };
const PORCELAIN = shared(mat(C.porcelain, { side: THREE.DoubleSide }));
const GLAZE_RED = shared(mat(C.red));
const NOODLE = shared(mat(C.noodle));

// ------------------------------------------------------------------ icon textures (raw sRGB)
const iconCache = new Map();
export async function preloadIcons(){
  if (iconCache.size) return;
  await Promise.all(Object.keys(INGREDIENTS).map((id) => new Promise((ok) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      c.getContext('2d').drawImage(img, 0, 0, 256, 256);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.NoColorSpace; // sampled raw = the icon's own sRGB colours
      t.anisotropy = 4;
      iconCache.set(id, t);
      ok();
    };
    img.onerror = ok;
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(ingredientSvg(id, { size: 256 }));
  })));
}

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
  const surf = new THREE.Mesh(new THREE.CircleGeometry(BOWL.brothR * scale, 64), mat(color));
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

// Noodles: real tubes in a low mound, shaped by the regional style.
function noodleMesh(id, radius){
  const n = INGREDIENTS[id];
  const tube = { 1.8: 0.0012, 3.2: 0.0017, 4.6: 0.0023, 5.2: 0.0024, 6.5: 0.0023 }[n.weight] || 0.0018;
  const mound = (x, z) => 0.003 + 0.007 * Math.max(0, 1 - (x * x + z * z) / (radius * radius));
  const geos = [];
  const add = (points) => {
    if (points.length < 3) return;
    geos.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), Math.max(12, points.length * 3), tube, 5, false));
  };
  if (n.style === 'straight' || n.style === 'flat'){
    const gap = tube * (n.style === 'flat' ? 2.7 : 2.4);
    for (let z = -radius * 0.92; z <= radius * 0.92; z += gap){
      const half = Math.sqrt(Math.max(0, radius * radius - z * z)) * 0.95;
      const pts = [];
      for (let i = 0; i <= 10; i++){
        const x = -half + (2 * half * i) / 10;
        const wz = n.style === 'flat' ? Math.sin(i * 1.4 + z * 300) * tube * 1.4 : (Math.random() - 0.5) * tube * 0.6;
        pts.push(new THREE.Vector3(x, mound(x, z) + Math.random() * 0.0012, z + wz));
      }
      add(pts);
    }
  } else {
    const strands = Math.round((radius * radius) / (tube * 0.06) + 4);
    for (let s = 0; s < strands; s++){
      const pts = [];
      const z0 = (Math.random() * 2 - 1) * radius * 0.85, amp = tube * (2 + Math.random()), ph = Math.random() * TAU;
      for (let t = 0, x = -radius; x < radius; t++, x += tube * 1.3){
        const px = x + Math.cos(t * 0.9 + ph) * amp, pz = z0 + Math.sin(t * 0.9 + ph) * amp;
        if (px * px + pz * pz > radius * radius){ if (pts.length > 2) break; else continue; }
        pts.push(new THREE.Vector3(px, mound(px, pz) + Math.random() * 0.0015, pz));
      }
      add(pts);
    }
  }
  const geo = mergeGeometries(geos);
  geos.forEach((g) => g.dispose());
  const mesh = new THREE.Mesh(geo, NOODLE);
  if (n.style === 'flat') mesh.scale.y = 0.5;
  return mesh;
}

// ------------------------------------------------------------------ toppings
const rnd = (a, b) => a + Math.random() * (b - a);
function scatter(geo, material, count, radius, { y = 0.002, heap = 0.006, flat = false, scale = [1, 1] } = {}){
  const inst = new THREE.InstancedMesh(geo, material, count);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  for (let i = 0; i < count; i++){
    const a = Math.random() * TAU, d = Math.sqrt(Math.random()) * radius;
    e.set(flat ? Math.PI / 2 + rnd(-0.3, 0.3) : Math.random() * TAU, Math.random() * TAU, flat ? rnd(-0.3, 0.3) : Math.random() * TAU);
    q.setFromEuler(e);
    const s = rnd(scale[0], scale[1]);
    m4.compose(new THREE.Vector3(Math.cos(a) * d, y + heap * (1 - d / radius) + Math.random() * 0.001, Math.sin(a) * d), q, new THREE.Vector3(s, s, s));
    inst.setMatrixAt(i, m4);
  }
  return inst;
}
// The ingredient's own icon as a cut-out, a few layers deep so it has an edge.
function decal(id, size, { layers = 3, step = 0.0013 } = {}){
  const g = new THREE.Group();
  for (let i = 0; i < layers; i++){
    const top = i === layers - 1;
    const p = new THREE.Mesh(new THREE.PlaneGeometry(size, size),
      mat(top ? '#ffffff' : '#9c8a72', { map: iconCache.get(id), alphaTest: 0.45, side: THREE.DoubleSide, flat: true }));
    p.rotation.x = -Math.PI / 2;
    p.position.y = 0.001 + i * step;
    g.add(p);
  }
  return g;
}
// A disc whose top is the icon and whose side is the icon's edge colour.
function capDisc(id, r, h, side, { sz = 1 } = {}){
  const sideM = mat(side), topM = mat('#ffffff', { map: iconCache.get(id), flat: true });
  const c = solid(new THREE.CylinderGeometry(r, r * 1.02, h, 40), [sideM, topM, sideM]);
  c.position.y = h / 2;
  c.scale.set(1, 1, sz);
  return c;
}
const TOPPINGS = {
  chashu: () => { const g = new THREE.Group(); const a = capDisc('chashu', 0.024, 0.006, '#7a3e22'); a.rotation.z = 0.12; g.add(a);
    const b = capDisc('chashu', 0.022, 0.006, '#7a3e22'); b.position.set(0.012, 0.005, 0.008); b.rotation.z = -0.1; g.add(b); return g; },
  naruto: () => { const g = new THREE.Group(); const d = capDisc('naruto', 0.018, 0.005, '#fbf4e8'); d.rotation.x = 0.15; g.add(d); return g; },
  ajitama: () => { const g = new THREE.Group();
    const white = solid(new THREE.SphereGeometry(0.016, 24, 12, 0, TAU, 0, Math.PI / 2), mat('#f8eedb', { side: THREE.DoubleSide }));
    white.scale.set(1, 0.55, 1.3); white.rotation.x = Math.PI; white.position.y = 0.009; g.add(white);
    const cut = capDisc('ajitama', 0.016, 0.0015, '#f8eedb', { sz: 1.3 }); cut.position.y = 0.009; g.add(cut); g.rotation.z = 0.25; return g; },
  rawEgg: () => { const g = new THREE.Group();
    const white = new THREE.Mesh(new THREE.CircleGeometry(0.024, 32), mat('#f7f0e0'));
    white.rotation.x = -Math.PI / 2; white.position.y = 0.0015; white.scale.set(1, 0.85, 1); g.add(white);
    const yolk = solid(new THREE.SphereGeometry(0.0105, 24, 12, 0, TAU, 0, Math.PI / 2), mat('#f0a01e'));
    yolk.scale.y = 0.7; yolk.position.y = 0.0015; g.add(yolk); return g; },
  corn: () => { const g = new THREE.Group(); g.add(scatter(new THREE.SphereGeometry(0.0036, 8, 6), mat('#f6cf45'), 46, 0.022, { heap: 0.008, scale: [0.85, 1.15] })); return g; },
  butter: () => { const g = new THREE.Group();
    const pool = new THREE.Mesh(new THREE.CircleGeometry(0.02, 24), mat('#fcebab', { opacity: 0.85 }));
    pool.rotation.x = -Math.PI / 2; pool.position.y = 0.0008; g.add(pool);
    const b = solid(new THREE.BoxGeometry(0.021, 0.012, 0.021), mat('#fcebab'));
    b.position.y = 0.006; b.rotation.y = 0.5; g.add(b); return g; },
  negi: () => { const g = new THREE.Group();
    g.add(scatter(new THREE.TorusGeometry(0.0034, 0.0013, 6, 14), mat('#6e9a38'), 18, 0.024, { flat: true, heap: 0.004, scale: [0.8, 1.2] }));
    g.add(scatter(new THREE.TorusGeometry(0.0034, 0.0013, 6, 14), mat('#9cbf5a'), 8, 0.02, { flat: true, heap: 0.005 })); return g; },
  sesame: () => { const g = new THREE.Group();
    const geo = new THREE.SphereGeometry(0.0017, 6, 4); geo.scale(1, 0.5, 0.6);
    g.add(scatter(geo, mat('#f5e6c2'), 60, 0.03, { heap: 0.002 }));
    g.add(scatter(geo, mat('#2a2016'), 10, 0.03, { heap: 0.002 })); return g; },
  seabura: () => { const g = new THREE.Group(); g.add(scatter(new THREE.SphereGeometry(0.0023, 8, 6), mat('#fffaf0'), 36, 0.045, { heap: 0.001, scale: [0.6, 1.4] })); return g; },
  pepper: () => { const g = new THREE.Group(); g.add(scatter(new THREE.IcosahedronGeometry(0.0012, 0), mat('#1c1612'), 110, 0.04, { heap: 0.001, scale: [0.6, 1.5] })); return g; },
  moyashi: () => { const g = new THREE.Group();
    const geos = [];
    for (let i = 0; i < 14; i++){
      const a = Math.random() * TAU, x = rnd(-0.016, 0.016), z = rnd(-0.016, 0.016), l = rnd(0.016, 0.026);
      const c = new THREE.QuadraticBezierCurve3(new THREE.Vector3(x, 0.003, z),
        new THREE.Vector3(x + Math.cos(a) * l * 0.5, 0.008, z + Math.sin(a) * l * 0.5), new THREE.Vector3(x + Math.cos(a + 0.6) * l, 0.004 + Math.random() * 0.004, z + Math.sin(a + 0.6) * l));
      geos.push(new THREE.TubeGeometry(c, 8, 0.0012, 5));
    }
    g.add(new THREE.Mesh(mergeGeometries(geos), mat('#f8f1dc'))); geos.forEach((x) => x.dispose());
    g.add(scatter(new THREE.SphereGeometry(0.0019, 6, 4), mat('#e9cf62'), 10, 0.016, { heap: 0.004 })); return g; },
  menma: () => { const g = new THREE.Group(); const m = mat('#c39550');
    for (let i = 0; i < 5; i++){ const b = solid(new THREE.BoxGeometry(0.006, 0.004, 0.026), m);
      b.position.set(rnd(-0.01, 0.01), 0.002 + i * 0.0025, rnd(-0.006, 0.006)); b.rotation.y = rnd(-0.9, 0.9); g.add(b); } return g; },
  porkBelly: () => { const g = new THREE.Group(); const fat = mat('#f4dfc0'), meat = mat('#8a4a28');
    for (let i = 0; i < 2; i++){ const p = new THREE.Group();
      [0, 1, 2, 3].forEach((k) => { const l = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.0028, 0.016), k % 2 ? fat : meat); l.position.y = 0.0014 + k * 0.0028; p.add(l); });
      p.position.set(i * 0.016 - 0.008, i * 0.004, i * 0.01 - 0.005); p.rotation.y = rnd(-0.6, 0.6); g.add(p); } return g; },
  nori: () => { const g = new THREE.Group(); // stands up against the rim, the classic look
    const dark = mat('#26271c');
    const s = solid(new THREE.BoxGeometry(0.036, 0.046, 0.0014), [dark, dark, dark, dark, mat('#ffffff', { map: iconCache.get('nori'), flat: true }), dark]);
    s.position.y = 0.02; s.rotation.x = -0.35; g.add(s); return g; },
  kamaboko: () => decal('kamaboko', 0.042, { layers: 4 }),
  beniShoga: () => decal('beniShoga', 0.05, { layers: 2 }),
  kikurage: () => decal('kikurage', 0.052, { layers: 2 }),
  spinach: () => decal('spinach', 0.052, { layers: 3 }),
  wakame: () => decal('wakame', 0.052, { layers: 2 }),
  garlicChips: () => decal('garlicChips', 0.048, { layers: 2 }),
  mayu: () => decal('mayu', 0.052, { layers: 1 }),
};
const toppingMesh = (id) => TOPPINGS[id]();
const SLOTS = [[-2.2, 0.6], [0.5, 0.6], [2.4, 0.58], [-0.85, 0.64], [1.5, 0.64]];

// A token: the ingredient standing on a little plate, as on its icon.
function tokenModel(id){
  const ing = INGREDIENTS[id];
  const g = new THREE.Group();
  g.add(solid(new THREE.CylinderGeometry(0.042, 0.036, 0.007, 40), PORCELAIN).translateY(0.0035));
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.0405, 0.0014, 6, 64), GLAZE_RED);
  rim.rotation.x = Math.PI / 2; rim.position.y = 0.0072; g.add(rim);
  let model;
  if (ing.layer === 'broth'){
    model = new THREE.Group();
    const s = 0.21; // a small bowl that sits inside the plate's rim
    model.add(bowlMesh(s));
    const br = brothMesh(id, s); br.position.y = BOWL.brothY * s; model.add(br);
  } else if (ing.layer === 'noodles'){
    model = noodleMesh(id, 0.03);
  } else {
    model = toppingMesh(id);
    if (id === 'nori') model.position.z = 0.008;
  }
  model.position.y += 0.007;
  g.add(model);
  return g;
}

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
    const nd = noodleMesh(id, BOWL.brothR * 0.62);
    R.contents.add(nd);
    const sy = nd.scale.y;
    tw(0.45, EASE.back, (k) => { nd.position.y = (1 - k) * 0.05; nd.scale.y = Math.max(0.05, k) * sy; });
  } else {
    const t = toppingMesh(id);
    const [a, d] = id === 'nori' ? [-Math.PI * 0.75, 0.78] : SLOTS[R.toppingCount++ % SLOTS.length];
    const spread = ['seabura', 'pepper', 'sesame'].includes(id);
    const y0 = spread ? 0.011 : 0.004;
    t.position.set(spread ? 0 : Math.cos(a) * d * BOWL.brothR, y0, spread ? 0 : Math.sin(a) * d * BOWL.brothR);
    if (id === 'nori') t.rotation.y = -a - Math.PI / 2;
    else if (!spread) t.rotation.y = rnd(0, TAU);
    R.contents.add(t);
    const big = spread ? 1.4 : 1.5; // toppings read at bowl size, like on the icons
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
    label.innerHTML = `${SHORT[id]}<small>${INGREDIENTS[id].layer === 'topping' ? 'topping' : INGREDIENTS[id].layer}</small>`;
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
