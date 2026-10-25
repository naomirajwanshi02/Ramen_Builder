// Ramen_Builder drawings.
// The bowl is a turned solid built with the Anatomy kit (vendor/anatomy, MIT):
// one meridian profile -> `solidOf` -> four-tone shaded SVG in the kit's own
// painter classes. Ingredients are hand-drawn SVG on a 100x100 grid in the same
// language: one ink weight, paper fills, a lit top and a shaded side.

import * as k from '../vendor/anatomy/iso-kit.mjs';
import * as G from '../vendor/anatomy/lathe.mjs';
import { INGREDIENTS } from './data.js';

const INK = '#3b2a1c';
const NOODLE = '#ecd391';
const TAU = Math.PI * 2;

export function rng(seed){
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const f1 = (n) => Math.round(n * 10) / 10;
const pts = (list) => list.map(([x, y]) => `${f1(x)},${f1(y)}`).join(' ');
const smoothPath = (p) => {
  // Catmull-Rom through the points, so noodles and sprouts bend instead of kink.
  if (p.length < 3) return `M${pts(p)}`;
  let d = `M${f1(p[0][0])} ${f1(p[0][1])}`;
  for (let i = 0; i < p.length - 1; i++){
    const a = p[i - 1] || p[i], b = p[i], c = p[i + 1], e = p[i + 2] || c;
    d += `C${f1(b[0] + (c[0] - a[0]) / 6)} ${f1(b[1] + (c[1] - a[1]) / 6)} ${f1(c[0] - (e[0] - b[0]) / 6)} ${f1(c[1] - (e[1] - b[1]) / 6)} ${f1(c[0])} ${f1(c[1])}`;
  }
  return d;
};
// An inked stroke: ink underneath, colour on top, so every strand reads as a solid.
const inked = (d, color, w, extra = '') =>
  `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${f1(w + 1.6)}" stroke-linecap="round" stroke-linejoin="round"${extra}/>` +
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${f1(w)}" stroke-linecap="round" stroke-linejoin="round"${extra}/>`;
const line = (d, w = 1.6, color = INK, extra = '') =>
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${extra}/>`;
const shape = (tag, attrs, fill, w = 1.8) =>
  `<${tag} ${attrs} fill="${fill}" stroke="${INK}" stroke-width="${w}" stroke-linejoin="round"/>`;

// ------------------------------------------------------------------ noodles
// Strands inside an ellipse (cx, cy, rx, ry). Same generator for the tile and the bowl.
// Same idea as the 3D noodles (stage.js): a folded bed of strands in layers, each
// strand with a warm outline, its colour, and a thin highlight along its top.
const NOODLE_EDGE = '#a47c3c', NOODLE_SHINE = '#fff4cc';
export function noodleStrands(style, weight, box, seed = 7, scale = 1){
  const r = rng(seed);
  const { cx, cy, rx, ry } = box;
  const w = weight * scale * 0.85;
  const out = [];
  const inside = (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
  if (style === 'straight' || style === 'flat'){
    const flat = style === 'flat';
    const gap = w * (flat ? 1.5 : 1.25) + 0.5 * scale;
    for (const tilt of [-0.2, -0.12, -0.04]){ // three layers, each folded at a slightly different angle
      for (let y = cy - ry * 1.05; y <= cy + ry * 1.05; y += gap * 2.2){
        const yy = y + r() * gap;
        const ph = r() * TAU, amp = w * (flat ? 0.9 : 0.35);
        const p = [];
        for (let i = 0; i <= 18; i++){
          const x = cx - rx + (2 * rx * i) / 18;
          const py = yy + (x - cx) * tilt * (ry / rx) + Math.sin((i / 18) * Math.PI * 2 + ph) * amp;
          if (inside(x, py)) p.push([x, py]);
        }
        if (p.length > 2) out.push({ d: smoothPath(p), w: flat ? w * 1.35 : w });
      }
    }
  } else {
    // chijire (crinkly): each strand wanders across the nest with tight side-to-side kinks
    const strands = Math.round((rx * ry) / (w * w * 3.2) + 6);
    for (let s = 0; s < strands; s++){
      let a = r() * TAU;
      let x = cx + (r() * 2 - 1) * rx * 0.7, y = cy + (r() * 2 - 1) * ry * 0.7;
      const step = w * 0.8 + 0.4 * scale, kink = 1.5 + r() * 0.9, ph = r() * TAU;
      const p = [];
      for (let i = 0; i < 40; i++){
        a += (r() - 0.5) * 0.35;
        x += Math.cos(a) * step; y += Math.sin(a) * step * (ry / rx);
        const k = Math.sin(i * kink + ph) * w * 0.9;
        const px = x - Math.sin(a) * k, py = y + Math.cos(a) * k * (ry / rx);
        if (inside(px, py)) p.push([px, py]); else if (p.length > 3) break;
      }
      if (p.length > 3) out.push({ d: smoothPath(p), w });
    }
  }
  return out.map(({ d, w: ww }) =>
    `<path d="${d}" fill="none" stroke="${NOODLE_EDGE}" stroke-width="${f1(ww + 1.1 * scale)}" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="${d}" fill="none" stroke="${NOODLE}" stroke-width="${f1(ww)}" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="${d}" fill="none" stroke="${NOODLE_SHINE}" stroke-width="${f1(Math.max(0.5, ww * 0.28))}" stroke-linecap="round" transform="translate(0 ${f1(-ww * 0.22)})" opacity=".8"/>`).join('');
}

// ------------------------------------------------------------------ tiles
function miniBowl(liquid, extra = ''){
  return `
  <ellipse cx="50" cy="86" rx="30" ry="6" fill="${INK}" opacity=".16"/>
  ${shape('path', 'd="M12 44 Q14 84 50 85 Q86 84 88 44 Z"', '#f6ecd8')}
  <path d="M60 84 Q84 80 88 44 L76 44 Q74 76 56 84 Z" fill="#000" opacity=".08"/>
  ${line('M16 60 Q50 74 84 60', 1.2, '#b5452f')}
  ${line('M17 65 Q50 79 83 65', 1.2, '#b5452f')}
  ${shape('ellipse', 'cx="50" cy="44" rx="38" ry="12"', '#e6d6b8')}
  ${shape('ellipse', 'cx="50" cy="46" rx="33" ry="9"', liquid, 1.2)}
  <ellipse cx="41" cy="44" rx="13" ry="3" fill="#fff" opacity=".28"/>
  ${extra}`;
}
function plate(inner){
  return `
  <ellipse cx="50" cy="80" rx="40" ry="10" fill="${INK}" opacity=".14"/>
  ${shape('ellipse', 'cx="50" cy="72" rx="42" ry="15"', '#f4e9d4')}
  ${line('M14 74 Q50 92 86 74', 1, '#c9b48f')}
  ${inner}`;
}

const TOPPING_ART = {
  chashu: () => `
    ${shape('ellipse', 'cx="50" cy="54" rx="34" ry="30"', '#7a3e22')}
    <ellipse cx="50" cy="52" rx="28" ry="24" fill="#d59c78"/>
    ${line('M30 50 Q40 36 54 42 Q66 48 60 58 Q52 66 44 58 Q40 52 48 50', 3, '#f3d9bf')}
    ${line('M30 50 Q40 36 54 42 Q66 48 60 58 Q52 66 44 58 Q40 52 48 50', 1, '#a4603e')}
    <ellipse cx="42" cy="40" rx="10" ry="4" fill="#fff" opacity=".3"/>`,
  ajitama: () => `
    ${shape('ellipse', 'cx="50" cy="52" rx="28" ry="34"', '#f8eedb')}
    ${line('M24 44 Q22 70 40 82', 3, '#c99a5c', ' opacity=".55"')}
    <circle cx="50" cy="55" r="17" fill="#e4932a" stroke="${INK}" stroke-width="1.4"/>
    <circle cx="50" cy="55" r="10" fill="#f6bc4c"/>
    <ellipse cx="44" cy="49" rx="5" ry="3" fill="#fff" opacity=".5"/>`,
  rawEgg: () => `
    ${shape('path', 'd="M20 56 Q18 30 46 28 Q74 24 82 46 Q88 72 60 78 Q26 84 20 56Z"', '#f7f0e0')}
    <circle cx="52" cy="52" r="18" fill="#f0a01e" stroke="${INK}" stroke-width="1.6"/>
    <circle cx="52" cy="52" r="12" fill="#f8b83a"/>
    <ellipse cx="45" cy="45" rx="6" ry="4" fill="#fff" opacity=".7"/>`,
  corn: () => {
    let s = shape('ellipse', 'cx="50" cy="58" rx="34" ry="22"', '#e2b93a', 1.6);
    const r = rng(11);
    for (let i = 0; i < 26; i++){
      const a = r() * TAU, d = Math.sqrt(r());
      const x = 50 + Math.cos(a) * d * 28, y = 56 + Math.sin(a) * d * 17 - (1 - d) * 6;
      s += `<rect x="${f1(x - 4)}" y="${f1(y - 3.5)}" width="8" height="7" rx="2.6" fill="#f6cf45" stroke="${INK}" stroke-width="1"/>` +
           `<rect x="${f1(x - 2.6)}" y="${f1(y - 2.6)}" width="3" height="2" rx="1" fill="#fff6c8"/>`;
    }
    return s;
  },
  butter: () => `
    ${shape('path', 'd="M22 42 L50 30 L78 42 L50 54 Z"', '#fcebab')}
    ${shape('path', 'd="M22 42 L50 54 L50 76 L22 64 Z"', '#efd477')}
    ${shape('path', 'd="M78 42 L50 54 L50 76 L78 64 Z"', '#ddbc58')}
    <path d="M30 42 L50 34 L60 38" fill="none" stroke="#fff" stroke-width="2.4" opacity=".7" stroke-linecap="round"/>`,
  moyashi: () => {
    let s = '';
    const r = rng(5);
    for (let i = 0; i < 9; i++){
      const x0 = 20 + r() * 60, y0 = 30 + r() * 40;
      const d = smoothPath([[x0, y0], [x0 + 10 + r() * 8, y0 + 8 + r() * 6], [x0 + 22 + r() * 6, y0 + 4 + r() * 10]]);
      s += inked(d, '#f8f1dc', 3.6) + `<ellipse cx="${f1(x0)}" cy="${f1(y0)}" rx="4" ry="3" fill="#e9cf62" stroke="${INK}" stroke-width="1.2"/>`;
    }
    return s;
  },
  menma: () => {
    let s = '';
    [[26, 40, -20], [44, 32, 14], [56, 46, -8], [36, 54, 22]].forEach(([x, y, a]) => {
      s += `<g transform="rotate(${a} ${x + 12} ${y + 14})">${shape('rect', `x="${x}" y="${y}" width="24" height="30" rx="3"`, '#c39550')}` +
           `${line(`M${x + 6} ${y + 3}V${y + 27}M${x + 12} ${y + 3}V${y + 27}M${x + 18} ${y + 3}V${y + 27}`, 1, '#8e6430')}` +
           `<rect x="${x + 2}" y="${y + 2}" width="20" height="5" rx="2" fill="#fff" opacity=".22"/></g>`;
    });
    return s;
  },
  nori: () => `
    <g transform="rotate(-8 50 50)">
    ${shape('rect', 'x="24" y="18" width="52" height="64" rx="2"', '#26271c')}
    ${line('M30 30 L70 26 M28 44 L72 40 M30 58 L70 54 M28 72 L72 68', 1, '#45463a')}
    <rect x="27" y="21" width="46" height="8" fill="#fff" opacity=".1"/></g>`,
  naruto: () => {
    const p = [];
    for (let i = 0; i < 28; i++){ const a = (i / 28) * TAU, rr = i % 2 ? 31 : 34; p.push([50 + Math.cos(a) * rr, 52 + Math.sin(a) * rr]); }
    const sp = [];
    for (let t = 0; t < 3.1 * TAU; t += 0.25){ const rr = 3 + t * 1.15; sp.push([50 + Math.cos(t) * rr, 52 + Math.sin(t) * rr]); }
    return `${shape('polygon', `points="${pts(p)}"`, '#fbf4e8')}${line(smoothPath(sp), 4.4, '#e0708a')}`;
  },
  kamaboko: () => `
    ${shape('path', 'd="M16 70 Q16 30 50 28 Q84 30 84 70 Z"', '#e2707e')}
    ${shape('path', 'd="M22 70 Q22 38 50 36 Q78 38 78 70 Z"', '#fbf4e8', 1.2)}
    ${shape('rect', 'x="12" y="70" width="76" height="8" rx="1"', '#e6d1a6', 1.4)}
    <path d="M30 46 Q50 38 66 44" fill="none" stroke="#fff" stroke-width="3" opacity=".7" stroke-linecap="round"/>`,
  negi: () => {
    let s = '';
    const r = rng(3);
    for (let i = 0; i < 15; i++){
      const a = r() * TAU, d = Math.sqrt(r()) * 26;
      const x = 50 + Math.cos(a) * d, y = 52 + Math.sin(a) * d * 0.85;
      const rr = 5 + r() * 2.5;
      s += `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(rr)}" fill="#e3edc0" stroke="${INK}" stroke-width="1"/>` +
           `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(rr - 1.8)}" fill="none" stroke="${i % 3 ? '#6e9a38' : '#9cbf5a'}" stroke-width="2.4"/>`;
    }
    return s;
  },
  beniShoga: () => {
    let s = '';
    const r = rng(9);
    for (let i = 0; i < 14; i++){
      const x = 26 + r() * 44, y = 32 + r() * 34, a = r() * 3;
      s += inked(smoothPath([[x, y], [x + 8 + a, y + 6], [x + 16, y + 3 + a * 2]]), '#cf3640', 2.6);
    }
    return s;
  },
  kikurage: () => {
    let s = '';
    [[24, 40], [30, 56], [40, 32], [48, 50], [36, 68]].forEach(([x, y], i) => {
      const d = smoothPath([[x, y], [x + 10, y - 6 + i], [x + 22, y + 2], [x + 34, y - 4]]);
      s += inked(d, '#3a2618', 7) + line(d, 1.4, '#7a5a40', ' opacity=".8" transform="translate(0 -1.6)"');
    });
    return s;
  },
  sesame: () => {
    let s = shape('ellipse', 'cx="50" cy="58" rx="32" ry="16"', '#ead7ad', 1.4);
    const r = rng(21);
    for (let i = 0; i < 46; i++){
      const a = r() * TAU, d = Math.sqrt(r());
      const x = 50 + Math.cos(a) * d * 28, y = 56 + Math.sin(a) * d * 13 - (1 - d) * 7;
      s += `<ellipse cx="${f1(x)}" cy="${f1(y)}" rx="3" ry="1.7" transform="rotate(${Math.round(r() * 180)} ${f1(x)} ${f1(y)})" fill="${i % 6 ? '#f5e6c2' : '#2a2016'}" stroke="${INK}" stroke-width=".6"/>`;
    }
    return s;
  },
  garlicChips: () => {
    let s = '';
    [[34, 40], [58, 36], [46, 56], [68, 58], [28, 62]].forEach(([x, y], i) => {
      s += `<ellipse cx="${x}" cy="${y}" rx="14" ry="10" transform="rotate(${i * 37} ${x} ${y})" fill="#f0d9a4" stroke="#a7783c" stroke-width="2.2"/>` +
           `<ellipse cx="${x}" cy="${y}" rx="14" ry="10" transform="rotate(${i * 37} ${x} ${y})" fill="none" stroke="${INK}" stroke-width="1"/>` +
           line(`M${x - 6} ${y}Q${x} ${y - 4} ${x + 6} ${y}`, 1, '#c79a5c');
    });
    return s;
  },
  mayu: () => `
    ${shape('path', 'd="M18 56 Q20 36 42 40 Q52 26 68 36 Q86 40 82 58 Q80 76 56 74 Q30 80 18 56Z"', '#1d1410')}
    <circle cx="38" cy="52" r="5" fill="#4a362a"/><circle cx="62" cy="58" r="4" fill="#4a362a"/>
    <ellipse cx="44" cy="44" rx="9" ry="3" fill="#fff" opacity=".35"/>
    <ellipse cx="66" cy="46" rx="5" ry="2" fill="#fff" opacity=".3"/>`,
  spinach: () => `
    ${shape('path', 'd="M20 62 Q22 30 50 26 Q46 50 20 62Z"', '#4f7130')}
    ${shape('path', 'd="M80 64 Q80 32 52 28 Q56 52 80 64Z"', '#5f8538')}
    ${shape('path', 'd="M28 72 Q50 44 72 72 Q50 82 28 72Z"', '#3e5d24')}
    ${line('M20 62 Q36 46 50 26 M80 64 Q66 48 52 28 M30 72 Q50 62 72 72', 1.2, '#a6c37a')}`,
  seabura: () => {
    let s = '';
    const r = rng(17);
    for (let i = 0; i < 22; i++){
      const a = r() * TAU, d = Math.sqrt(r()) * 30;
      const x = 50 + Math.cos(a) * d, y = 52 + Math.sin(a) * d * 0.8;
      const rr = 3 + r() * 3.4;
      s += `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(rr)}" fill="#fffaf0" stroke="${INK}" stroke-width=".9"/>` +
           `<circle cx="${f1(x - rr * 0.35)}" cy="${f1(y - rr * 0.35)}" r="${f1(rr * 0.3)}" fill="#fff"/>`;
    }
    return s;
  },
  pepper: () => {
    let s = shape('path', 'd="M16 70 Q30 34 50 32 Q70 34 84 70 Z"', '#7a6652', 1.6);
    const r = rng(29);
    for (let i = 0; i < 60; i++){
      const x = 22 + r() * 56, y = 40 + r() * 28;
      if (Math.abs(x - 50) > (y - 34) * 0.95) continue;
      s += `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(0.8 + r() * 1.6)}" fill="${i % 4 ? '#1c1612' : '#b7a58e'}"/>`;
    }
    return s;
  },
  porkBelly: () => {
    let s = '';
    [[22, 36, -10], [48, 30, 8], [36, 52, 4]].forEach(([x, y, a]) => {
      s += `<g transform="rotate(${a} ${x + 15} ${y + 12})">${shape('rect', `x="${x}" y="${y}" width="32" height="24" rx="5"`, '#8a4a28')}` +
           `<rect x="${x + 2}" y="${y + 7}" width="28" height="4" fill="#f4dfc0"/><rect x="${x + 2}" y="${y + 15}" width="28" height="3" fill="#f4dfc0"/>` +
           `<rect x="${x + 3}" y="${y + 2}" width="20" height="3" rx="1.5" fill="#fff" opacity=".3"/></g>`;
    });
    return s;
  },
  wakame: () => `
    ${shape('path', 'd="M22 66 Q26 40 40 36 Q36 54 48 50 Q50 32 64 30 Q60 50 76 46 Q80 64 60 70 Q40 78 22 66Z"', '#3e6a3a')}
    ${line('M26 64 Q44 56 58 46 Q64 40 70 36', 1.2, '#86b071')}
    <ellipse cx="44" cy="60" rx="8" ry="3" fill="#fff" opacity=".15"/>`,
};

export function ingredientSvg(id, { size = 100 } = {}){
  const ing = INGREDIENTS[id];
  let body;
  if (ing.layer === 'broth'){
    body = miniBowl(ing.color, `<ellipse cx="61" cy="47" rx="4" ry="1.6" fill="#fff" opacity=".25"/>`);
  } else if (ing.layer === 'noodles'){
    body = plate(noodleStrands(ing.style, ing.weight * 1.15, { cx: 50, cy: 50, rx: 34, ry: 22 }, 13, 1));
  } else {
    body = TOPPING_ART[id]();
  }
  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`;
}
export const toppingInner = (id) => TOPPING_ART[id]();

// ------------------------------------------------------------------ the bowl
// World units ~ millimetres of a real ramen bowl (diameter ~212, height ~70).
const W = 420, H = 270;
const RIM_S = 70, RIM_R = 106, LIP = 6, BROTH_S = 60;
const F = G.frameOf([0, 0, 0], [0, 0, 1], [1, 0, 0], [0, 1, 0]);
const PROFILE = [[0, 38], [8, 38], [8, 44], [14, 62, 1], [32, 88, 1], [52, 101, 1], [RIM_S, RIM_R]];
const P = k.fitProjection(
  Array.from({ length: 24 }, (_, i) => i / 24 * TAU).flatMap((a) => [
    G.pointOf(F, 0, 40, a), G.pointOf(F, RIM_S, RIM_R + 8, a)]),
  W, H, { pad: 14, elevation: 42 });
const V = G.viewOf(P);
const at = (s, r, a) => k.iso(G.pointOf(F, s, r, a), P);
// Only the half of a ring that faces the viewer — the back half is hidden by the bowl.
function frontArc(s, r, from = 0.04, to = 0.96){
  const faces = (a) => G.dot3(G.radialOf(F, a), V);
  const list = [];
  for (let i = 0; i <= 96; i++){
    const a = (i / 96) * TAU;
    if (faces(a) > 0) list.push(a);
  }
  // Start the run where the front begins, so the arc is one unbroken stroke.
  const start = list.findIndex((a, i) => i === 0 || a - list[i - 1] > 0.1);
  const run = [...list.slice(start), ...list.slice(0, start)];
  const n = run.length;
  return run.slice(Math.floor(n * from), Math.ceil(n * to)).map((a) => at(s, r, a));
}
const ellipseOf = (s, r) => G.circleOf(F, s, r, P, 96);
function ellipseBox(s, r){
  // Screen bounds of a horizontal ring, measured from its projected points.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < 64; i++){ const [x, y] = at(s, r, (i / 64) * TAU); minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, rx: (maxX - minX) / 2, ry: (maxY - minY) / 2 };
}

// The static porcelain, built once.
const BODY = (() => {
  const solid = G.solidOf(PROFILE, F, P, { smooth: { rows: 5 } });
  const decoBand = (s, r) => frontArc(s, r).length ? k.pathOf(frontArc(s, r)) : '';
  // Raimon (thunder-spiral) border: a run of little squares around the outside, front half only.
  let raimon = '';
  const meander = frontArc(56, 99.4, 0.06, 0.94);
  for (let i = 0; i < meander.length - 2; i += 3){
    const [x, y] = meander[i];
    raimon += `<rect x="${f1(x - 2.2)}" y="${f1(y - 2.2)}" width="4.4" height="4.4" fill="none" stroke="#b5452f" stroke-width=".9" transform="rotate(45 ${f1(x)} ${f1(y)})"/>`;
  }
  const footRing = decoBand(8, 44.2);
  return {
    porcelain: k.solidSvg(solid, { tone: 'hi', halo: true,
      inner: k.lineSvg(decoBand(48, 99.2), { tone: 'red' }) + k.lineSvg(decoBand(62, 104.2), { tone: 'red' }) + raimon +
             k.lineSvg(footRing, { tone: 'mid' }) }),
    rim: `<path class="rb-rim" d="${ellipseOf(RIM_S, RIM_R)}"/>`,
    opening: ellipseOf(RIM_S, RIM_R - LIP),
    rimLine: k.lineSvg(ellipseOf(RIM_S, RIM_R - LIP), { tone: 'mid' }),
    broth: ellipseOf(BROTH_S, RIM_R - LIP - 3),
    brothBox: ellipseBox(BROTH_S, RIM_R - LIP - 3),
  };
})();

const SLOTS = [-1.7, 2.2, 0.35, -0.55, 1.3]; // topping angles (radians) on the broth surface
const SLOT_R = [56, 56, 60, 62, 52];

/* Draw the bowl as it stands: `state` = { broth, noodles, toppings: [] }.
   `fresh` names the ingredient just added, so it alone plays the drop-in animation. */
export function bowlSvg(state, { fresh = null, steam = false } = {}){
  const parts = [`<g class="rb-porcelain">${BODY.porcelain}${BODY.rim}</g>`];
  const id = 'rbclip';
  parts.push(`<defs><clipPath id="${id}"><path d="${BODY.opening}"/></clipPath></defs>`);
  parts.push(`<path d="${BODY.opening}" fill="#e6d7ba"/>`); // inner glaze, seen when empty
  const inside = [];
  if (state.broth){
    const c = INGREDIENTS[state.broth].color;
    const b = BODY.brothBox;
    inside.push(`<g class="${fresh === state.broth ? 'rb-pour' : ''}"><path d="${BODY.broth}" fill="${c}" stroke="${INK}" stroke-width=".8"/>` +
      `<ellipse cx="${f1(b.cx - b.rx * 0.25)}" cy="${f1(b.cy - b.ry * 0.35)}" rx="${f1(b.rx * 0.38)}" ry="${f1(b.ry * 0.16)}" fill="#fff" opacity=".18"/>` +
      oilDots(b, 31) + '</g>');
  }
  if (state.noodles){
    const n = INGREDIENTS[state.noodles];
    const b = BODY.brothBox;
    const box = { cx: b.cx + b.rx * 0.02, cy: b.cy + b.ry * 0.05, rx: b.rx * 0.6, ry: b.ry * 0.56 };
    inside.push(`<g class="${fresh === state.noodles ? 'rb-drop' : ''}">${noodleStrands(n.style, n.weight, box, 41, 1.25)}</g>`);
  }
  const placed = state.toppings.map((t, i) => {
    const [x, y] = at(BROTH_S, SLOT_R[i % SLOTS.length], SLOTS[i % SLOTS.length]);
    return { t, x, y, i };
  }).sort((a, b) => a.y - b.y);
  const size = BODY.brothBox.rx * 0.74;
  for (const { t, x, y, i } of placed){
    const sc = size / 100;
    inside.push(`<g transform="translate(${f1(x)} ${f1(y)})"><g class="${fresh === t ? 'rb-drop' : ''}">` +
      `<g transform="scale(${f1(sc * 100) / 100} ${f1(sc * 78) / 100}) translate(-50 -54)">${TOPPING_ART[t]()}</g></g></g>`);
  }
  parts.push(`<g clip-path="url(#${id})">${inside.join('')}</g>`);
  parts.push(BODY.rimLine);
  if (steam) parts.push(steamSvg());
  return `<svg class="iso-svg rb-bowl" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Ramen bowl">${parts.join('')}</svg>`;
}
function oilDots(b, seed){
  const r = rng(seed);
  let s = '';
  for (let i = 0; i < 14; i++){
    const a = r() * TAU, d = 0.35 + r() * 0.6;
    s += `<ellipse cx="${f1(b.cx + Math.cos(a) * b.rx * d)}" cy="${f1(b.cy + Math.sin(a) * b.ry * d)}" rx="${f1(2 + r() * 4)}" ry="${f1(1 + r() * 2)}" fill="#fff6d8" opacity=".35"/>`;
  }
  return s;
}
function steamSvg(){
  const b = BODY.brothBox;
  let s = '<g class="rb-steam">';
  [-0.4, 0, 0.38].forEach((dx, i) => {
    const x = b.cx + dx * b.rx, y = b.cy - b.ry * 0.6;
    s += `<path style="animation-delay:${i * 0.35}s" d="M${f1(x)} ${f1(y)} q-10 -16 0 -30 q10 -14 0 -30" fill="none" stroke="#8c7457" stroke-width="2.4" stroke-linecap="round"/>`;
  });
  return s + '</g>';
}

// A small Japan map for the order ticket: dots for every region, the active one ringed.
export function japanMapSvg(recipes, activeId){
  // Rough island silhouettes on a 100x100 grid — enough to say "north" and "south".
  const isl = [
    'M70 4 Q84 2 92 10 Q96 18 88 24 Q80 28 74 24 Q68 30 66 24 Q70 16 66 10Z',          // Hokkaido
    'M68 32 Q74 36 72 46 Q70 54 66 60 Q60 64 54 62 Q46 62 40 66 Q34 68 30 66 Q36 60 44 58 Q50 52 56 50 Q62 44 64 36Z', // Honshu
    'M30 72 Q36 70 40 74 Q38 78 30 78 Q26 76 30 72Z',                                    // Shikoku
    'M10 70 Q18 68 22 74 Q22 84 16 90 Q10 88 8 80 Q6 74 10 70Z',                         // Kyushu
  ];
  let s = isl.map((d) => `<path d="${d}" fill="#e7d8bb" stroke="#8c7457" stroke-width="1"/>`).join('');
  for (const r of recipes){
    const on = r.id === activeId;
    s += `<circle cx="${r.x}" cy="${r.y}" r="${on ? 2.6 : 1.4}" fill="${on ? '#b5452f' : '#8c7457'}"/>`;
    if (on) s += `<circle class="rb-ping" cx="${r.x}" cy="${r.y}" r="6" fill="none" stroke="#b5452f" stroke-width="1.2"/>`;
  }
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${s}</svg>`;
}
