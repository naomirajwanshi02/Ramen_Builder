// Ramen_Builder AR scene: a real three.js ramen bowl standing on the scanned card,
// with the ingredients floating in a ring around it. Same backend as sushi-ar:
// MindAR image tracking (mind-ar 1.2.5 + three 0.160.0), or a demo board that
// floats in front of the camera when there is no card.
//
// Layout units are MindAR anchor units: the card is 1.0 wide and 1/aspect tall.
// Everything is modelled Y-up inside `root`, which is tipped onto the card so
// +Y points out of the card (towards the viewer) — like a bowl on a table.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { INGREDIENTS, SHORT } from './data.js';
import { ingredientSvg } from './art.js';

const params = new URLSearchParams(location.search);
export const TARGET_SRC = params.get('target') || './targets.mind';
const TAU = Math.PI * 2;

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
    if (o.isMesh || o.isInstancedMesh || o.isSprite){
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => { if (!m.userData.shared){ if (m.userData.ownMap) m.map?.dispose(); m.dispose(); } });
      if (!o.geometry?.userData?.shared) o.geometry?.dispose();
    }
  });
}

// ------------------------------------------------------------------ textures from the 2D art
const iconCache = new Map();
export async function preloadIcons(){
  await Promise.all(Object.keys(INGREDIENTS).map((id) => new Promise((ok) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      c.getContext('2d').drawImage(img, 0, 0, 256, 256);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      iconCache.set(id, t);
      ok();
    };
    img.onerror = ok;
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(ingredientSvg(id, { size: 256 }));
  })));
}

function labelTexture(text, sub){
  const c = document.createElement('canvas');
  c.width = 384; c.height = 104;
  const g = c.getContext('2d');
  const r = 30, w = c.width, h = c.height;
  g.fillStyle = 'rgba(246,237,219,.94)';
  g.beginPath(); g.moveTo(r, 2); g.arcTo(w - 2, 2, w - 2, h - 2, r); g.arcTo(w - 2, h - 2, 2, h - 2, r);
  g.arcTo(2, h - 2, 2, 2, r); g.arcTo(2, 2, w - 2, 2, r); g.closePath(); g.fill();
  g.strokeStyle = '#3b2a1c'; g.lineWidth = 3; g.stroke();
  g.fillStyle = '#2b1e13'; g.textAlign = 'center'; g.textBaseline = 'middle';
  let size = 40;
  g.font = `800 ${size}px 'Zen Maru Gothic',ui-rounded,system-ui,sans-serif`;
  while (g.measureText(text).width > w - 40 && size > 22){ size -= 2; g.font = `800 ${size}px 'Zen Maru Gothic',ui-rounded,system-ui,sans-serif`; }
  g.fillText(text, w / 2, sub ? 40 : h / 2 + 2);
  if (sub){
    g.fillStyle = '#8c7457';
    g.font = `700 22px ui-monospace,Consolas,monospace`;
    g.fillText(sub, w / 2, 78);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ------------------------------------------------------------------ materials
const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0, ...o });
const PORCELAIN = mat(0xf6eedd, { roughness: 0.28 }); PORCELAIN.userData.shared = true;
const GLAZE_RED = mat(0xb5452f, { roughness: 0.35 }); GLAZE_RED.userData.shared = true;
const NOODLE = mat(0xecd391, { roughness: 0.5 }); NOODLE.userData.shared = true;
const WOOD = mat(0xa8743f, { roughness: 0.7 }); WOOD.userData.shared = true;

// ------------------------------------------------------------------ the bowl
// Same proportions as the Anatomy figure (millimetres of a real bowl), scaled to the card.
const K = 0.34 / 212;
// Tokens are drawn bigger than life so a child's finger can hit them on a phone held over the card.
const TOKEN_SCALE = 1.75;
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
  const body = new THREE.Mesh(new THREE.LatheGeometry(pts, 72), PORCELAIN);
  body.castShadow = true;
  g.add(body);
  // red glaze bands + a raimon (thunder) border, like the Anatomy figure
  for (const s of [48, 62]){
    const ring = new THREE.Mesh(new THREE.TorusGeometry((outerR(s) + 0.5) * K * scale, 0.0011 * scale, 6, 96), GLAZE_RED);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = s * K * scale;
    g.add(ring);
  }
  const n = 40, box = new THREE.BoxGeometry(0.0055 * scale, 0.0055 * scale, 0.0009 * scale);
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
  const color = new THREE.Color(INGREDIENTS[id].color);
  const surf = new THREE.Mesh(new THREE.CircleGeometry(BOWL.brothR * scale, 64), mat(color, { roughness: 0.12 }));
  surf.rotation.x = -Math.PI / 2;
  g.add(surf);
  // floating fat droplets catch the light
  const drop = mat(color.clone().lerp(new THREE.Color(0xfff6d8), 0.55), { roughness: 0.05, transparent: true, opacity: 0.7 });
  for (let i = 0; i < 16; i++){
    const a = Math.random() * TAU, d = (0.35 + Math.random() * 0.6) * BOWL.brothR * scale;
    const c = new THREE.Mesh(new THREE.CircleGeometry((0.002 + Math.random() * 0.004) * scale, 16), drop);
    c.rotation.x = -Math.PI / 2;
    c.position.set(Math.cos(a) * d, 0.0004, Math.sin(a) * d);
    g.add(c);
  }
  return g;
}

// Noodles: real tubes laid in a low mound, shaped by the regional style.
function noodleMesh(id, radius){
  const n = INGREDIENTS[id];
  const tube = { 1.8: 0.0011, 3.2: 0.0016, 4.6: 0.0022, 5.2: 0.0023, 6.5: 0.0022 }[n.weight] || 0.0018;
  const mound = (x, z) => 0.003 + 0.007 * Math.max(0, 1 - (x * x + z * z) / (radius * radius));
  const geos = [];
  const add = (points) => {
    if (points.length < 3) return;
    const curve = new THREE.CatmullRomCurve3(points);
    geos.push(new THREE.TubeGeometry(curve, Math.max(12, points.length * 3), tube, 5, false));
  };
  if (n.style === 'straight' || n.style === 'flat'){
    const gap = tube * (n.style === 'flat' ? 2.6 : 2.3);
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
        if (px * px + pz * pz > radius * radius) { if (pts.length > 2) break; else continue; }
        pts.push(new THREE.Vector3(px, mound(px, pz) + Math.random() * 0.0015, pz));
      }
      add(pts);
    }
  }
  const mesh = new THREE.Mesh(mergeGeometries(geos), NOODLE);
  geos.forEach((g) => g.dispose());
  if (n.style === 'flat') mesh.scale.y = 0.5;
  return mesh;
}

// ------------------------------------------------------------------ toppings
// Each builder returns a Y-up group about 0.05 across, centred on its footprint.
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
// A flat cut-out of the ingredient drawing, stacked a few layers deep so it has thickness.
function decal(id, size, { layers = 3, step = 0.0012, tilt = 0 } = {}){
  const g = new THREE.Group();
  const tex = iconCache.get(id);
  for (let i = 0; i < layers; i++){
    const top = i === layers - 1;
    const m = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.45, transparent: false, roughness: 0.6, side: THREE.DoubleSide,
      color: top ? 0xffffff : 0x8a7a66 });
    const p = new THREE.Mesh(new THREE.PlaneGeometry(size, size), m);
    p.rotation.x = -Math.PI / 2;
    p.position.y = 0.001 + i * step;
    g.add(p);
  }
  g.rotation.z = tilt;
  return g;
}
function capDisc(id, r, h, side, { sx = 1, sz = 1 } = {}){
  const sideM = mat(side), topM = mat(0xffffff, { map: iconCache.get(id), roughness: 0.45 });
  const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.02, h, 40), [sideM, topM, sideM]);
  c.position.y = h / 2;
  c.scale.set(sx, 1, sz);
  return c;
}
const TOPPINGS = {
  chashu: () => { const g = new THREE.Group(); const a = capDisc('chashu', 0.024, 0.005, 0x7a3e22); a.rotation.z = 0.12; g.add(a);
    const b = capDisc('chashu', 0.022, 0.005, 0x7a3e22); b.position.set(0.012, 0.004, 0.008); b.rotation.z = -0.1; g.add(b); return g; },
  naruto: () => { const g = new THREE.Group(); const d = capDisc('naruto', 0.017, 0.004, 0xf6efe2); d.rotation.x = 0.15; g.add(d); return g; },
  ajitama: () => { const g = new THREE.Group();
    const white = new THREE.Mesh(new THREE.SphereGeometry(0.016, 24, 12, 0, TAU, 0, Math.PI / 2), mat(0xc79a5c, { roughness: 0.35 }));
    white.scale.set(1, 0.55, 1.3); white.rotation.x = Math.PI; white.position.y = 0.009; g.add(white);
    const cut = capDisc('ajitama', 0.016, 0.0015, 0xf8eedb, { sz: 1.3 }); cut.position.y = 0.009; g.add(cut); g.rotation.z = 0.25; return g; },
  rawEgg: () => { const g = new THREE.Group();
    const white = new THREE.Mesh(new THREE.CircleGeometry(0.024, 32), mat(0xfbf6ea, { transparent: true, opacity: 0.85, roughness: 0.1 }));
    white.rotation.x = -Math.PI / 2; white.position.y = 0.0015; white.scale.set(1, 0.85, 1); g.add(white);
    const yolk = new THREE.Mesh(new THREE.SphereGeometry(0.0105, 24, 12, 0, TAU, 0, Math.PI / 2), mat(0xf0a01e, { roughness: 0.08 }));
    yolk.scale.y = 0.7; yolk.position.y = 0.0015; g.add(yolk); return g; },
  corn: () => { const g = new THREE.Group(); g.add(scatter(new THREE.SphereGeometry(0.0034, 8, 6), mat(0xf6cf45, { roughness: 0.3 }), 46, 0.022, { heap: 0.008, scale: [0.85, 1.15] })); return g; },
  butter: () => { const g = new THREE.Group();
    const pool = new THREE.Mesh(new THREE.CircleGeometry(0.02, 24), mat(0xf7e7a0, { transparent: true, opacity: 0.8, roughness: 0.1 }));
    pool.rotation.x = -Math.PI / 2; pool.position.y = 0.0008; g.add(pool);
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.011, 0.02), mat(0xfbe39a, { roughness: 0.3 }));
    b.position.y = 0.006; b.rotation.y = 0.5; g.add(b); return g; },
  negi: () => { const g = new THREE.Group();
    g.add(scatter(new THREE.TorusGeometry(0.0032, 0.0012, 6, 14), mat(0x6e9a38), 18, 0.024, { flat: true, heap: 0.004, scale: [0.8, 1.2] }));
    g.add(scatter(new THREE.TorusGeometry(0.0032, 0.0012, 6, 14), mat(0xb9d47a), 8, 0.02, { flat: true, heap: 0.005 })); return g; },
  sesame: () => { const g = new THREE.Group();
    const geo = new THREE.SphereGeometry(0.0016, 6, 4); geo.scale(1, 0.5, 0.6);
    g.add(scatter(geo, mat(0xf5e6c2), 60, 0.03, { heap: 0.002 }));
    g.add(scatter(geo, mat(0x2a2016), 10, 0.03, { heap: 0.002 })); return g; },
  seabura: () => { const g = new THREE.Group(); g.add(scatter(new THREE.SphereGeometry(0.0022, 8, 6), mat(0xfffaf0, { roughness: 0.15 }), 36, 0.045, { heap: 0.001, scale: [0.6, 1.4] })); return g; },
  pepper: () => { const g = new THREE.Group(); g.add(scatter(new THREE.IcosahedronGeometry(0.0011, 0), mat(0x1c1612), 110, 0.04, { heap: 0.001, scale: [0.6, 1.5] })); return g; },
  moyashi: () => { const g = new THREE.Group();
    const geos = [];
    for (let i = 0; i < 14; i++){
      const a = Math.random() * TAU, x = rnd(-0.016, 0.016), z = rnd(-0.016, 0.016), l = rnd(0.016, 0.026);
      const c = new THREE.QuadraticBezierCurve3(new THREE.Vector3(x, 0.003, z),
        new THREE.Vector3(x + Math.cos(a) * l * 0.5, 0.008, z + Math.sin(a) * l * 0.5), new THREE.Vector3(x + Math.cos(a + 0.6) * l, 0.004 + Math.random() * 0.004, z + Math.sin(a + 0.6) * l));
      geos.push(new THREE.TubeGeometry(c, 8, 0.0011, 5));
    }
    g.add(new THREE.Mesh(mergeGeometries(geos), mat(0xf8f1dc, { roughness: 0.35 }))); geos.forEach((x) => x.dispose());
    g.add(scatter(new THREE.SphereGeometry(0.0018, 6, 4), mat(0xe9cf62), 10, 0.016, { heap: 0.004 })); return g; },
  menma: () => { const g = new THREE.Group(); const m = mat(0xc39550, { roughness: 0.6 });
    for (let i = 0; i < 5; i++){ const b = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.004, 0.026), m);
      b.position.set(rnd(-0.01, 0.01), 0.002 + i * 0.0025, rnd(-0.006, 0.006)); b.rotation.y = rnd(-0.9, 0.9); g.add(b); } return g; },
  porkBelly: () => { const g = new THREE.Group(); const fat = mat(0xf4dfc0), meat = mat(0x8a4a28);
    for (let i = 0; i < 2; i++){ const p = new THREE.Group();
      [0, 1, 2, 3].forEach((k) => { const l = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.0028, 0.016), k % 2 ? fat : meat); l.position.y = 0.0014 + k * 0.0028; p.add(l); });
      p.position.set(i * 0.016 - 0.008, i * 0.004, i * 0.01 - 0.005); p.rotation.y = rnd(-0.6, 0.6); g.add(p); } return g; },
  nori: () => { const g = new THREE.Group();
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.046, 0.0012), [mat(0x26271c), mat(0x26271c), mat(0x26271c), mat(0x26271c), mat(0xffffff, { map: iconCache.get('nori') }), mat(0x26271c)]);
    s.position.y = 0.02; s.rotation.x = -0.35; g.add(s); return g; }, // stands up against the rim, the classic look
  kamaboko: () => decal('kamaboko', 0.04, { layers: 4, tilt: 0.1 }),
  beniShoga: () => decal('beniShoga', 0.048, { layers: 2 }),
  kikurage: () => decal('kikurage', 0.05, { layers: 2 }),
  spinach: () => decal('spinach', 0.05, { layers: 3 }),
  wakame: () => decal('wakame', 0.05, { layers: 2 }),
  garlicChips: () => decal('garlicChips', 0.046, { layers: 2 }),
  mayu: () => decal('mayu', 0.05, { layers: 1 }),
};
export const toppingMesh = (id) => TOPPINGS[id]();

// Where each topping sits on the broth (angle around the noodles, distance out).
const SLOTS = [[-2.2, 0.62], [0.5, 0.62], [2.4, 0.6], [-0.85, 0.66], [1.5, 0.66]];

// ------------------------------------------------------------------ the floating tokens
function tokenModel(id){
  const ing = INGREDIENTS[id];
  const g = new THREE.Group();
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.036, 0.006, 40), PORCELAIN);
  plate.position.y = 0.003;
  g.add(plate);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.0405, 0.0012, 6, 64), GLAZE_RED);
  rim.rotation.x = Math.PI / 2; rim.position.y = 0.0062; g.add(rim);
  let model;
  if (ing.layer === 'broth'){
    model = new THREE.Group();
    const b = bowlMesh(0.42); model.add(b);
    const br = brothMesh(id, 0.42); br.position.y = BOWL.brothY * 0.42; model.add(br);
  } else if (ing.layer === 'noodles'){
    model = noodleMesh(id, 0.03);
  } else {
    model = toppingMesh(id);
    if (id === 'nori'){ model.rotation.x = 0.3; model.position.z = 0.008; }
  }
  model.position.y += 0.006;
  g.add(model);
  return g;
}

// ------------------------------------------------------------------ scene state
const R = {
  mode: null, mindar: null, renderer: null, scene: null, camera: null, container: null,
  board: new THREE.Group(), root: new THREE.Group(), tokensRoot: new THREE.Group(), fx: new THREE.Group(),
  bowlSpot: new THREE.Group(), bowl: null, contents: null,
  tokens: [], tracked: false, ring: { rx: 0.42, ry: 0.28 }, pick: null, onFound: null, onLost: null,
  lockRing: null, shadow: null, steam: [], steamOn: false, hintIds: null, lastT: 0, demoHolder: null,
};
R.root.rotation.x = Math.PI / 2;
R.board.add(R.root);
R.root.add(R.bowlSpot, R.tokensRoot, R.fx);

function buildStatic(){
  R.root.add(new THREE.HemisphereLight(0xfff4e0, 0x6b5238, 1.4));
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(0.3, 1, 0.5); R.root.add(key);
  const fill = new THREE.DirectionalLight(0xffe2c0, 0.5); fill.position.set(-0.6, 0.4, -0.3); R.root.add(fill);
  // soft contact shadow under the bowl grounds it on the card
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'); const grd = g.createRadialGradient(64, 64, 10, 64, 64, 64);
  grd.addColorStop(0, 'rgba(40,24,10,.55)'); grd.addColorStop(1, 'rgba(40,24,10,0)'); g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const sh = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  sh.rotation.x = -Math.PI / 2; sh.position.y = 0.0006; R.root.add(sh); R.shadow = sh;
  // lock-on ring: an ellipse fitted to the card, drawn as a dotted Anatomy-style line
  const pts = [];
  for (let i = 0; i <= 160; i++){ const a = (i / 160) * TAU; pts.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a))); }
  const lr = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: 0xb5452f, dashSize: 0.04, gapSize: 0.03, transparent: true, opacity: 0.9 }));
  lr.computeLineDistances();
  lr.position.y = 0.001; R.root.add(lr); R.lockRing = lr;
  // steam puffs (sprites) that drift up from the broth
  const sc = document.createElement('canvas'); sc.width = sc.height = 64;
  const sg = sc.getContext('2d'); const sgr = sg.createRadialGradient(32, 32, 2, 32, 32, 32);
  sgr.addColorStop(0, 'rgba(255,250,240,.75)'); sgr.addColorStop(1, 'rgba(255,250,240,0)'); sg.fillStyle = sgr; sg.fillRect(0, 0, 64, 64);
  const smap = new THREE.CanvasTexture(sc);
  for (let i = 0; i < 9; i++){
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smap, transparent: true, depthWrite: false, opacity: 0 }));
    s.userData.phase = i / 9; s.userData.x = rnd(-0.05, 0.05); s.userData.z = rnd(-0.04, 0.04);
    R.bowlSpot.add(s); R.steam.push(s);
  }
  applyAspect(1.5);
}
function applyAspect(aspect){
  const halfH = 0.5 / aspect;
  R.ring.rx = 0.4;
  R.ring.ry = Math.min(0.42, halfH * 0.86);
  R.lockRing.scale.set(R.ring.rx + 0.06, 1, R.ring.ry + 0.05);
}

// Arc-length spacing around the ellipse, so tokens look evenly placed.
function ringPoints(n, phase){
  const N = 512, cum = [0];
  const P = (t) => [R.ring.rx * Math.cos(t), R.ring.ry * Math.sin(t)];
  let prev = P(0);
  for (let i = 1; i <= N; i++){ const p = P((i / N) * TAU); cum.push(cum[i - 1] + Math.hypot(p[0] - prev[0], p[1] - prev[1])); prev = p; }
  const out = [];
  for (let k = 0; k < n; k++){
    const want = ((k / n + phase / TAU) % 1) * cum[N];
    let i = cum.findIndex((c) => c >= want); if (i < 0) i = N;
    out.push(P((i / N) * TAU));
  }
  return out;
}

// ------------------------------------------------------------------ public: bowl
function freshBowl(){
  if (R.bowl){ R.bowlSpot.remove(R.bowl); dispose(R.bowl); }
  R.bowl = new THREE.Group();
  R.bowl.add(bowlMesh());
  R.contents = new THREE.Group();
  R.contents.position.y = BOWL.brothY;
  R.bowl.add(R.contents);
  R.bowlSpot.add(R.bowl);
  R.toppingCount = 0;
  R.steamOn = false;
}
export function newBowl(){
  freshBowl();
  const b = R.bowl;
  tw(0.55, EASE.back, (k) => { b.position.y = (1 - k) * 0.12; b.scale.setScalar(0.6 + 0.4 * k); });
}

function addToBowl(id){
  const ing = INGREDIENTS[id];
  if (ing.layer === 'broth'){
    const br = brothMesh(id);
    br.scale.setScalar(0.3);
    R.contents.add(br);
    br.position.y = -0.03;
    tw(0.5, EASE.out, (k) => { br.position.y = -0.03 * (1 - k); br.scale.setScalar(0.3 + 0.7 * k); });
    R.steamOn = true;
  } else if (ing.layer === 'noodles'){
    const nd = noodleMesh(id, BOWL.brothR * 0.62);
    R.contents.add(nd);
    tw(0.45, EASE.back, (k) => { nd.position.y = (1 - k) * 0.05; nd.scale.set(1, Math.max(0.05, k), 1); });
  } else {
    const t = toppingMesh(id);
    const [a, d] = id === 'nori' ? [-Math.PI / 2, 0.78] : SLOTS[R.toppingCount++ % SLOTS.length];
    const spread = ['seabura', 'pepper', 'sesame'].includes(id);
    t.position.set(spread ? 0 : Math.cos(a) * d * BOWL.brothR, 0.004, spread ? 0 : Math.sin(a) * d * BOWL.brothR);
    if (!spread && id !== 'nori') t.rotation.y = rnd(0, TAU);
    if (spread) t.position.y = 0.011;
    R.contents.add(t);
    tw(0.4, EASE.back, (k) => { t.position.y = (spread ? 0.011 : 0.004) + (1 - k) * 0.05; t.scale.setScalar(0.4 + 0.6 * k); });
  }
}

// ------------------------------------------------------------------ public: tokens
export function setTokens(ids){
  clearTokens();
  const pts = ringPoints(ids.length, Math.random() * TAU);
  ids.forEach((id, i) => {
    const node = new THREE.Group();
    const model = tokenModel(id);
    node.add(model);
    const ing = INGREDIENTS[id];
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(SHORT[id], ing.layer === 'topping' ? 'TOPPING' : ing.layer.toUpperCase()), transparent: true, depthWrite: false }));
    label.material.userData.ownMap = true;
    label.scale.set(0.12, 0.0325, 1);
    label.position.set(0, 0.012, 0.052);
    label.renderOrder = 5;
    node.add(label);
    const hit = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = 0.02;
    node.add(hit);
    const [x, y] = pts[i];
    node.position.set(x, 0.045, -y);
    node.scale.setScalar(0.001);
    const tok = { id, node, model, label, hit, home: node.position.clone(), alive: true, phase: Math.random() * TAU, shake: 0 };
    hit.userData.token = tok;
    R.tokens.push(tok);
    R.tokensRoot.add(node);
    tw(0.45, EASE.back, (k) => node.scale.setScalar(Math.max(0.001, k * TOKEN_SCALE)), null, i * 0.04);
  });
}
export function clearTokens(){
  for (const t of R.tokens){
    const node = t.node;
    t.alive = false;
    const s0 = node.scale.x;
    tw(0.25, EASE.out, (k) => node.scale.setScalar(Math.max(0.001, s0 * (1 - k))), () => { R.tokensRoot.remove(node); dispose(node); });
  }
  R.tokens = [];
}
export function hint(ids){ R.hintIds = ids; }

export function acceptToken(id){
  const tok = R.tokens.find((t) => t.id === id && t.alive);
  if (!tok) return;
  tok.alive = false;
  R.tokens = R.tokens.filter((t) => t !== tok);
  const node = tok.node;
  tok.label.visible = false;
  const from = node.position.clone(), to = new THREE.Vector3(0, BOWL.h + 0.02, 0);
  tw(0.42, EASE.io, (k) => {
    node.position.lerpVectors(from, to, k);
    node.position.y += Math.sin(k * Math.PI) * 0.12;
    node.rotation.y = k * TAU;
    node.scale.setScalar(Math.max(0.001, TOKEN_SCALE * (1 - 0.75 * k)));
  }, () => { R.tokensRoot.remove(node); dispose(node); addToBowl(id); sparkle(new THREE.Vector3(0, BOWL.h, 0), 0xf6cf45); });
}
export function wrongToken(id){
  const tok = R.tokens.find((t) => t.id === id && t.alive);
  if (tok) tok.shake = 0.5;
}

// ------------------------------------------------------------------ public: serve / dump
export async function serveBowl(){
  const b = R.bowl;
  R.steamOn = true;
  sparkle(new THREE.Vector3(0, BOWL.h + 0.02, 0), 0xb5452f, 18);
  await wait(0.7);
  R.steamOn = false;
  await new Promise((ok) => tw(0.6, EASE.io, (k) => {
    b.position.set(k * 0.7, Math.sin(k * Math.PI) * 0.08, 0);
    b.rotation.z = -k * 0.4;
    b.scale.setScalar(1 - 0.5 * k);
  }, ok));
}
export async function dumpBowl(){
  const b = R.bowl;
  R.steamOn = false;
  await new Promise((ok) => tw(0.7, EASE.io, (k) => {
    b.rotation.x = k * 1.6;
    b.position.set(0, Math.sin(k * Math.PI) * 0.05, -k * 0.1);
    b.scale.setScalar(Math.max(0.001, 1 - 0.8 * k));
  }, ok));
}

function sparkle(at, color, n = 10){
  const geo = new THREE.IcosahedronGeometry(1, 0);
  for (let i = 0; i < n; i++){
    const p = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true }));
    p.position.copy(at);
    R.fx.add(p);
    const a = Math.random() * TAU, sp = 0.08 + Math.random() * 0.1;
    const vx = Math.cos(a) * sp, vz = Math.sin(a) * sp, vy = 0.08 + Math.random() * 0.12;
    tw(0.6, EASE.out, (k) => {
      p.position.set(at.x + vx * k, at.y + vy * k - 0.15 * k * k, at.z + vz * k);
      p.material.opacity = 1 - k;
      p.scale.setScalar(0.006 * (1 - k * 0.5));
    }, () => { R.fx.remove(p); p.material.dispose(); if (i === n - 1) geo.dispose(); });
  }
}

// ------------------------------------------------------------------ public: screen positions
const v3 = new THREE.Vector3();
function project(obj, lift = 0){
  if (!R.camera) return { x: innerWidth / 2, y: innerHeight / 2 };
  v3.set(0, lift, 0);
  obj.localToWorld(v3).project(R.camera);
  return { x: (v3.x * 0.5 + 0.5) * innerWidth, y: (-v3.y * 0.5 + 0.5) * innerHeight };
}
export const bowlScreen = () => project(R.bowlSpot, BOWL.h + 0.03);
export const tokenScreen = (id) => { const t = R.tokens.find((x) => x.id === id); return t ? project(t.node, 0.05) : bowlScreen(); };
export const isTracked = () => R.tracked;

// ------------------------------------------------------------------ input
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function onPointer(ev){
  if (!R.camera || !R.pick || ev.target.closest('button, .plate, .hud, .ordercard')) return;
  const hits = R.tokens.filter((t) => t.alive).map((t) => t.hit);
  // try the touch point first, then a few points around it — fingers are bigger than pixels
  for (const [dx, dy] of [[0, 0], [14, 0], [-14, 0], [0, 14], [0, -14], [22, 22], [-22, -22], [22, -22], [-22, 22]]){
    ndc.set(((ev.clientX + dx) / innerWidth) * 2 - 1, -((ev.clientY + dy) / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, R.camera);
    const h = ray.intersectObjects(hits, false)[0];
    if (h){ R.pick(h.object.userData.token.id); return; }
  }
}
export function onPick(cb){ R.pick = cb; }

// ------------------------------------------------------------------ frame
function frame(){
  const now = performance.now();
  const dt = Math.min((now - R.lastT) / 1000, 0.05);
  R.lastT = now;
  updateTweens(dt);
  const t = now / 1000;
  for (const tok of R.tokens){
    if (!tok.alive) continue;
    const hinted = R.hintIds && R.hintIds.includes(tok.id);
    tok.node.position.y = tok.home.y + Math.sin(t * 1.6 + tok.phase) * 0.006 + (hinted ? 0.012 + Math.sin(t * 6) * 0.006 : 0);
    tok.model.rotation.y = Math.sin(t * 0.5 + tok.phase) * 0.5;
    if (tok.shake > 0){
      tok.shake = Math.max(0, tok.shake - dt);
      tok.node.position.x = tok.home.x + Math.sin(tok.shake * 60) * 0.012 * (tok.shake / 0.5);
    } else tok.node.position.x = tok.home.x;
  }
  for (const s of R.steam){
    const p = (t * 0.35 + s.userData.phase) % 1;
    s.position.set(s.userData.x + Math.sin(t + s.userData.phase * 9) * 0.01, BOWL.brothY + 0.01 + p * 0.16, s.userData.z);
    s.scale.setScalar(0.03 + p * 0.07);
    const target = R.steamOn && R.bowl ? Math.sin(p * Math.PI) * 0.55 : 0;
    s.material.opacity += (target - s.material.opacity) * 0.1;
  }
  R.lockRing.material.opacity = 0.55 + Math.sin(t * 2) * 0.25;
  R.renderer.render(R.scene, R.camera);
}

// ------------------------------------------------------------------ backends
function envFor(renderer, scene){
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
}

export async function startAR(container, { onStatus, onFound, onLost }){
  R.container = container;
  onStatus('Loading the image tracker…');
  const { MindARThree } = await import('mindar-image-three');
  const mindar = new MindARThree({
    container, imageTargetSrc: TARGET_SRC, uiScanning: 'no', uiLoading: 'no', uiError: 'no',
    filterMinCF: 0.001, filterBeta: 1000, warmupTolerance: 5, missTolerance: 10,
  });
  R.mindar = mindar;
  const { renderer, scene, camera } = mindar;
  Object.assign(R, { mode: 'ar', renderer, scene, camera });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  envFor(renderer, scene);
  const anchor = mindar.addAnchor(0);
  anchor.group.add(R.board);
  anchor.onTargetFound = () => {
    R.tracked = true;
    R.lockRing.scale.multiplyScalar(1.3);
    const sx = R.ring.rx + 0.06, sz = R.ring.ry + 0.05;
    tw(0.5, EASE.out, (k) => R.lockRing.scale.set(sx * (1.3 - 0.3 * k), 1, sz * (1.3 - 0.3 * k)));
    onFound();
  };
  anchor.onTargetLost = () => { R.tracked = false; onLost(); };
  onStatus('Starting camera…');
  await mindar.start();
  const dims = mindar.controller?.markerDimensions?.[0];
  if (dims && dims[0] && dims[1]) applyAspect(dims[0] / dims[1]);
  R.lastT = performance.now();
  renderer.setAnimationLoop(frame);
  onStatus('Looking for the card…');
}

// No card: the board floats in front of the camera (or a sepia backdrop if there is no camera).
export async function startDemo(container, { onFound }){
  R.container = container;
  let video = null;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    video = document.createElement('video');
    Object.assign(video, { srcObject: stream, playsInline: true, muted: true, autoplay: true });
    video.setAttribute('playsinline', '');
    Object.assign(video.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover' });
    container.appendChild(video);
    await video.play();
  } catch { container.classList.add('nocam'); }
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  Object.assign(renderer.domElement.style, { position: 'absolute', inset: '0' });
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.01, 20);
  envFor(renderer, scene);
  const holder = new THREE.Group();
  holder.rotation.x = -Math.PI / 4; // like a phone held over a card on the table
  holder.add(R.board);
  scene.add(holder);
  // the printed card under the board, so demo mode still reads as "on the table"
  const cardTex = new THREE.TextureLoader().load('target.png');
  cardTex.colorSpace = THREE.SRGBColorSpace;
  const card = new THREE.Mesh(new THREE.PlaneGeometry(1, 1 / 1.5), new THREE.MeshStandardMaterial({ map: cardTex, roughness: 0.9 }));
  card.position.z = -0.001; R.board.add(card); R.demoCard = card;
  const DIST = 1.0;
  const fit = () => {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    const halfH = DIST * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), halfW = halfH * camera.aspect;
    const s = Math.min(1.1, 0.92 * Math.min(halfW / (R.ring.rx + 0.1), halfH / (R.ring.ry + 0.2)));
    holder.scale.setScalar(s);
    holder.position.set(0, -0.02 * s, -DIST);
  };
  fit();
  addEventListener('resize', fit);
  R.demoFit = fit;
  Object.assign(R, { mode: 'demo', renderer, scene, camera, tracked: true, video });
  R.lastT = performance.now();
  renderer.setAnimationLoop(frame);
  onFound();
}

export function stop(){
  try { R.renderer?.setAnimationLoop(null); } catch { /* gone */ }
  if (R.mode === 'ar'){ try { R.mindar.stop(); } catch { /* already stopped */ } }
  if (R.demoFit) removeEventListener('resize', R.demoFit);
  R.container?.querySelectorAll('video').forEach((v) => v.srcObject?.getTracks?.().forEach((t) => t.stop()));
  if (R.mode === 'demo') R.renderer.dispose();
  R.board.parent?.remove(R.board);
  if (R.demoCard){ R.board.remove(R.demoCard); R.demoCard.material.map?.dispose(); R.demoCard.material.dispose(); R.demoCard = null; }
  clearTokens();
  if (R.bowl){ R.bowlSpot.remove(R.bowl); dispose(R.bowl); R.bowl = null; }
  if (R.container){ R.container.innerHTML = ''; R.container.classList.remove('nocam'); }
  Object.assign(R, { mode: null, mindar: null, renderer: null, scene: null, camera: null, tracked: false, demoFit: null });
}

buildStatic();
addEventListener('pointerdown', onPointer, { passive: true });
window.__ar = R;
