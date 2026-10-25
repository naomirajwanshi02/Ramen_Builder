// Ramen_Builder — game loop, scoring, and screens.
import { INGREDIENTS, RECIPES, DIFFICULTY, LAYER_NAME } from './data.js';
import { ingredientSvg, bowlSvg, japanMapSvg } from './art.js';
import { startScan, stopScan } from './scan.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const DEMO = params.has('demo');

// ------------------------------------------------------------ storage (best-effort)
const store = {
  get(key, fallback){ try { const v = localStorage.getItem('ramen_builder.' + key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(key, value){ try { localStorage.setItem('ramen_builder.' + key, JSON.stringify(value)); } catch { /* private mode */ } },
};

// ------------------------------------------------------------ sound (tiny synth, no files)
const sound = {
  ctx: null, on: store.get('sound', true),
  unlock(){ if (!this.ctx){ try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { this.on = false; } } this.ctx?.resume?.(); },
  tone(freq, dur = 0.09, type = 'triangle', gain = 0.14, slide = 0, delay = 0){
    if (!this.on || !this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.ctx.destination); o.start(t); o.stop(t + dur + 0.02);
  },
  good(step){ this.tone(520 + step * 60, 0.08); this.tone(780 + step * 60, 0.1, 'sine', 0.08, 0, 0.05); },
  bad(){ this.tone(180, 0.22, 'square', 0.08, -80); },
  tick(){ this.tone(1200, 0.03, 'square', 0.04); },
  clack(){ this.tone(140, 0.06, 'square', 0.12, -60); this.tone(2400, 0.02, 'square', 0.03); },
  serve(){ [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.14, 'triangle', 0.12, 0, i * 0.07)); },
  combo(m){ [0, 1, 2].forEach((i) => this.tone(600 + m * 90 + i * 140, 0.08, 'sine', 0.1, 0, i * 0.05)); },
  lose(){ [392, 330, 262].forEach((f, i) => this.tone(f, 0.2, 'triangle', 0.12, 0, i * 0.12)); },
  stamp(){ this.tone(90, 0.25, 'sine', 0.3, -40); this.tone(300, 0.05, 'square', 0.06); },
};
const buzz = (ms) => { try { navigator.vibrate?.(ms); } catch { /* unsupported */ } };

// ------------------------------------------------------------ state
const S = {
  diff: store.get('diff', 'easy'),
  phase: 'menu', // menu | scan | count | play | serving | paused | over
  score: 0, combo: 0, maxCombo: 0, mult: 1, maxMult: 1, lives: 3, served: 0,
  recipe: null, need: [], bowl: null, mistakes: 0,
  timeLeft: 0, timeMax: 1, lastTickAt: 0, learned: new Set(), lastRecipe: null,
};

function show(id){
  document.body.classList.toggle('scanning', id === 'scan');
  document.querySelectorAll('.screen').forEach((el) => el.classList.toggle('on', el.id === id));
}

// ------------------------------------------------------------ odometer
const ODO_DIGITS = 6;
function buildOdo(el, digits, cls = ''){
  el.innerHTML = Array.from({ length: digits }, () =>
    `<div class="d ${cls}"><span>${Array.from({ length: 10 }, (_, n) => `<i>${n}</i>`).join('')}</span></div>`).join('');
}
function setOdo(el, value, h){
  const s = String(Math.min(value, 10 ** el.children.length - 1)).padStart(el.children.length, '0');
  [...el.children].forEach((d, i) => {
    d.firstChild.style.transform = `translateY(${-Number(s[i]) * h}px)`;
    d.style.opacity = i < el.children.length - String(value).length ? '.28' : '1';
  });
}
function lockScore(){
  const odo = $('odo');
  odo.classList.remove('lock'); void odo.offsetWidth; odo.classList.add('lock');
  $('scoreBox').classList.add('locked');
  sound.clack();
  clearTimeout(lockScore.t);
  lockScore.t = setTimeout(() => $('scoreBox').classList.remove('locked'), 1100);
}
function addScore(points, { lock = false } = {}){
  S.score += points;
  setOdo($('odo'), S.score, 30);
  if (lock) lockScore();
}

// ------------------------------------------------------------ HUD
function renderMult(bumped){
  const m = $('mult');
  m.dataset.m = S.mult;
  m.innerHTML = `<div>×${S.mult}<small>combo ${S.combo}</small></div>`;
  if (bumped){ m.classList.remove('bump'); void m.offsetWidth; m.classList.add('bump'); }
}
const LIFE = `<svg viewBox="0 0 24 24"><path d="M2 10h20q-1 10-10 11Q3 20 2 10Z" fill="#f6eddb" stroke="#3b2a1c" stroke-width="1.5"/><path d="M4 10q8 3 16 0" fill="none" stroke="#b5452f" stroke-width="1.2"/><path d="M8 7q-1-3 1-5M12 7q-1-3 1-5M16 7q-1-3 1-5" fill="none" stroke="#8c7457" stroke-width="1.2" stroke-linecap="round"/></svg>`;
function renderLives(){
  const max = DIFFICULTY[S.diff].lives;
  $('lives').innerHTML = Array.from({ length: max }, () => LIFE).join('');
  [...$('lives').children].forEach((el, i) => el.classList.toggle('gone', i >= S.lives));
}
function popup(text, cls = 'mid', y = 0.42){
  const el = document.createElement('div');
  el.className = `pop ${cls}`;
  el.style.top = `${Math.round(innerHeight * y)}px`;
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1400);
}
function toast(html, ms = 2600){
  const t = $('toast');
  t.innerHTML = html;
  t.classList.add('on');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('on'), ms);
}

// ------------------------------------------------------------ orders
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--){ const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = (list, n) => shuffle([...list]).slice(0, n);
const BASE_TOPPINGS = { easy: 2, normal: 3, hard: 4 };

function newOrder(){
  const d = DIFFICULTY[S.diff];
  const choices = RECIPES.filter((r) => r.id !== S.lastRecipe);
  const r = choices[Math.floor(Math.random() * choices.length)];
  S.lastRecipe = r.id;
  S.recipe = r;
  const nTop = Math.min(r.toppings.length, BASE_TOPPINGS[S.diff] + Math.floor(S.served / 2));
  const toppings = r.toppings.slice(0, nTop);
  S.need = [r.broth, r.noodles, ...toppings];
  S.bowl = { broth: null, noodles: null, toppings: [] };
  S.mistakes = 0;

  // Decoys come from the same layers, so the player has to know which broth and which noodle.
  const ramp = Math.min(1, S.served / 12);
  const nDecoy = Math.min(12 - S.need.length, Math.round(d.decoys[0] + (d.decoys[1] - d.decoys[0]) * ramp));
  const all = Object.keys(INGREDIENTS).filter((id) => !S.need.includes(id));
  const byLayer = (layer) => all.filter((id) => INGREDIENTS[id].layer === layer);
  const decoys = [
    ...pick(byLayer('broth'), Math.min(2, Math.ceil(nDecoy / 3))),
    ...pick(byLayer('noodles'), Math.min(2, Math.floor(nDecoy / 3))),
  ];
  decoys.push(...pick(byLayer('topping'), nDecoy - decoys.length));

  const perStep = Math.max(d.floor, d.perStep * d.shrink ** S.served);
  S.timeMax = perStep * S.need.length + 2;
  S.timeLeft = S.timeMax;

  $('ordNo').textContent = `Order ${String(S.served + 1).padStart(2, '0')}`;
  $('ordPlace').textContent = r.place;
  $('ordName').textContent = r.name;
  $('map').innerHTML = japanMapSvg(RECIPES, r.id);
  const bowl = $('bowl');
  bowl.className = 'bowlwrap enter';
  renderBowl();
  void bowl.offsetWidth;
  bowl.className = 'bowlwrap';

  $('tray').innerHTML = shuffle([...S.need, ...decoys]).map((id, i) => {
    const ing = INGREDIENTS[id];
    return `<button class="tile" data-id="${id}" style="animation-delay:${i * 25}ms" aria-label="${ing.name}">` +
      `<span class="tl">${ing.layer === 'topping' ? 'top' : ing.layer === 'noodles' ? 'noodle' : 'broth'}</span>` +
      `${ingredientSvg(id, { size: 64 })}<span class="tn">${ing.name}</span></button>`;
  }).join('');
  renderTicket();
  S.phase = 'play';
}

function have(id){
  const b = S.bowl;
  return b.broth === id || b.noodles === id || b.toppings.includes(id);
}
function nextLayer(){
  if (!S.bowl.broth) return 'broth';
  if (!S.bowl.noodles) return 'noodles';
  return 'topping';
}
function renderBowl(fresh = null, steam = false){
  $('bowl').innerHTML = bowlSvg(S.bowl, { fresh, steam });
}
function renderTicket(){
  const layer = nextLayer();
  $('ticket').innerHTML = S.need.map((id, i) => {
    const ing = INGREDIENTS[id];
    const done = have(id);
    const next = !done && ing.layer === layer;
    const sep = i === 1 || i === 2 ? '<span class="sep"></span>' : '';
    return `${sep}<div class="chip${done ? ' done' : ''}${next ? ' next' : ''}" title="${ing.name}">${ingredientSvg(id, { size: 32 })}</div>`;
  }).join('');
  const got = S.need.filter(have).length;
  $('ordRead').textContent = `${got} / ${S.need.length}`;
  $('hint').innerHTML = got === S.need.length ? 'Order up!' : `Next: <b>${LAYER_NAME[layer]}</b>`;
}

// ------------------------------------------------------------ tapping
function flyToBowl(tile){
  const from = tile.querySelector('svg').getBoundingClientRect();
  const to = $('bowl').getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'fly';
  el.innerHTML = tile.querySelector('svg').outerHTML;
  el.style.left = `${from.left}px`; el.style.top = `${from.top}px`;
  el.style.width = `${from.width}px`; el.style.height = `${from.height}px`;
  document.body.appendChild(el);
  requestAnimationFrame(() => {
    el.style.transform = `translate(${to.left + to.width / 2 - from.left - from.width / 2}px, ${to.top + to.height * 0.45 - from.top - from.height / 2}px) scale(.6)`;
    el.style.opacity = '.2';
  });
  setTimeout(() => el.remove(), 480);
}

function onTile(tile){
  if (S.phase !== 'play') return;
  const id = tile.dataset.id;
  const ing = INGREDIENTS[id];
  const layer = nextLayer();
  const inRecipe = S.need.includes(id);
  if (!inRecipe || ing.layer !== layer){
    mistake(tile, inRecipe ? `${LAYER_NAME[layer]} first!` : `No ${ing.name} in this bowl!`);
    return;
  }
  // correct
  tile.classList.add('used');
  flyToBowl(tile);
  if (layer === 'broth') S.bowl.broth = id;
  else if (layer === 'noodles') S.bowl.noodles = id;
  else S.bowl.toppings.push(id);
  S.combo++;
  S.maxCombo = Math.max(S.maxCombo, S.combo);
  const m = Math.min(5, 1 + Math.floor(S.combo / 4));
  const bumped = m > S.mult;
  S.mult = m;
  S.maxMult = Math.max(S.maxMult, m);
  sound.good(S.bowl.toppings.length + (S.bowl.noodles ? 1 : 0));
  if (bumped){ sound.combo(m); popup(`${S.combo} COMBO!  ×${m}`, 'big', 0.3); }
  else if (S.mult === 5 && S.combo % 5 === 0) popup(`${S.combo} COMBO!`, 'big', 0.3);
  addScore(10 * S.mult);
  renderMult(bumped);
  setTimeout(() => { renderBowl(id); renderTicket(); if (S.need.every(have)) serve(); }, 260);
}

function mistake(tile, message){
  tile.classList.remove('wrong'); void tile.offsetWidth; tile.classList.add('wrong');
  S.mistakes++;
  const lost = S.combo;
  S.combo = 0; S.mult = 1;
  renderMult(false);
  S.timeLeft = Math.max(0.01, S.timeLeft - (S.diff === 'easy' ? 1.5 : 2));
  sound.bad(); buzz(80);
  popup(lost >= 4 ? `${message}  Combo lost` : message, 'mid', 0.5);
}

// ------------------------------------------------------------ serve / timeout
function flyPoints(points, done){
  const from = $('bowl').getBoundingClientRect();
  const to = $('odo').getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'pts';
  el.textContent = `+${points}`;
  el.style.left = `${from.left + from.width / 2 - 30}px`;
  el.style.top = `${from.top + from.height * 0.3}px`;
  document.body.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    el.style.transform = `translate(${to.left - from.left - from.width / 2 + 30}px, ${to.top - from.top - from.height * 0.3}px) scale(.7)`;
    el.style.opacity = '.3';
  }));
  setTimeout(() => { el.remove(); done(); }, 820);
}

function serve(){
  S.phase = 'serving';
  const frac = S.timeLeft / S.timeMax;
  const speed = Math.round(150 * frac);
  const perfect = S.mistakes === 0 ? 50 : 0;
  const total = (100 + speed + perfect) * S.mult;
  S.served++;
  S.learned.add(S.recipe.id);
  sound.serve();
  renderBowl(null, true);
  $('bowl').classList.add('done');
  popup(perfect ? 'Perfect bowl!' : 'Order up!', 'big', 0.3);
  flyPoints(total, () => addScore(total, { lock: true }));
  toast(`<b>${S.recipe.name}</b> — ${S.recipe.fact}`);
  setTimeout(() => { $('bowl').classList.remove('done'); $('bowl').classList.add('serve'); }, 1100);
  setTimeout(() => { if (S.phase === 'serving') newOrder(); }, 1700);
}

function timeout(){
  S.phase = 'serving';
  S.lives--;
  S.combo = 0; S.mult = 1;
  renderMult(false); renderLives();
  sound.lose(); buzz([60, 40, 60]);
  popup('Too slow! The ramen got cold', 'mid', 0.3);
  $('bowl').classList.add('dump');
  setTimeout(() => {
    if (S.lives <= 0) gameOver();
    else if (S.phase === 'serving') newOrder();
  }, 1200);
}

// ------------------------------------------------------------ loop
let lastT = 0;
function loop(t){
  const dt = Math.min(0.05, (t - lastT) / 1000 || 0);
  lastT = t;
  if (S.phase === 'play'){
    S.timeLeft -= dt;
    const frac = Math.max(0, S.timeLeft / S.timeMax);
    $('timerBar').style.transform = `scaleX(${frac})`;
    const hot = frac < 0.3;
    $('timer').classList.toggle('hot', hot);
    if (hot && t - S.lastTickAt > (frac < 0.15 ? 250 : 500)){ S.lastTickAt = t; sound.tick(); }
    if (S.timeLeft <= 0) timeout();
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ------------------------------------------------------------ flow
function resetGame(){
  Object.assign(S, { score: 0, combo: 0, maxCombo: 0, mult: 1, maxMult: 1, served: 0, lastRecipe: null, learned: new Set() });
  S.lives = DIFFICULTY[S.diff].lives;
  buildOdo($('odo'), ODO_DIGITS);
  setOdo($('odo'), 0, 30);
  renderMult(false); renderLives();
}

function countdown(then){
  S.phase = 'count';
  const box = $('count'), span = box.querySelector('span');
  box.classList.add('on');
  const steps = ['3', '2', '1', 'いただきます!'];
  steps.forEach((txt, i) => setTimeout(() => {
    span.textContent = txt;
    span.className = i === 3 ? 'go' : '';
    span.style.animation = 'none'; void span.offsetWidth; span.style.animation = '';
    sound.tone(i === 3 ? 880 : 440, 0.12);
  }, i * 700));
  setTimeout(() => { box.classList.remove('on'); then(); }, steps.length * 700);
}

function startGame(){
  resetGame();
  show('game');
  countdown(() => newOrder());
}

function gameOver(){
  S.phase = 'over';
  show('over');
  const best = store.get(`best.${S.diff}`, 0);
  const isBest = S.score > best;
  if (isBest) store.set(`best.${S.diff}`, S.score);
  $('overDiff').textContent = DIFFICULTY[S.diff].label;
  $('overBest').textContent = `best ${Math.max(best, S.score)}`;
  $('stBowls').textContent = S.served;
  $('stCombo').textContent = S.maxCombo;
  $('stMult').textContent = `×${S.maxMult}`;
  $('learned').innerHTML = S.learned.size
    ? `Bowls you cooked: ${[...S.learned].map((id) => RECIPES.find((r) => r.id === id).place.split(' · ')[0]).join(', ')}`
    : 'Tip: broth first, then noodles, then toppings!';
  $('hanko').classList.remove('on');
  $('newBest').classList.remove('on');

  // Score lock: every digit spins, then they lock one by one from the left.
  const big = $('bigodo');
  const digits = String(S.score).padStart(4, '0');
  big.innerHTML = [...digits].map(() => `<div class="d spin"><span>${Array.from({ length: 20 }, (_, n) => `<i>${n % 10}</i>`).join('')}</span></div>`).join('');
  const lead = digits.length - String(S.score).length;
  [...big.children].forEach((d, i) => setTimeout(() => {
    d.classList.remove('spin');
    if (i < lead) d.style.opacity = '.35';
    d.firstChild.style.transform = `translateY(${-Number(digits[i]) * 60}px)`;
    d.classList.add('locked');
    sound.clack(); buzz(15);
  }, 700 + i * 320));
  setTimeout(() => {
    $('hanko').classList.add('on'); sound.stamp(); buzz(60);
    if (isBest) setTimeout(() => { $('newBest').classList.add('on'); sound.combo(5); }, 350);
  }, 900 + digits.length * 320);
}

function pause(){
  if (S.phase !== 'play') return;
  S.phase = 'paused';
  show('pause');
}
function resume(){
  if (S.phase !== 'paused') return;
  show('game');
  S.phase = 'play';
}

// ------------------------------------------------------------ scanning
async function beginScan(){
  S.phase = 'scan';
  show('scan');
  $('scanStatus').textContent = 'Starting camera…';
  try {
    await startScan($('ar'), {
      onStatus: (t) => { $('scanStatus').textContent = t; },
      onFound: () => {
        if (S.phase !== 'scan') return;
        S.phase = 'count';
        sound.serve(); buzz(40);
        $('found').classList.add('on');
        setTimeout(() => { stopScan($('ar')); $('found').classList.remove('on'); startGame(); }, 1300);
      },
    });
  } catch (err) {
    console.error(err);
    const msg = String(err?.message || err);
    $('scanStatus').textContent = /permission|denied|notallowed/i.test(msg)
      ? 'Camera blocked — allow camera access in your browser settings, or play without scanning.'
      : `Could not start the scanner (${msg}). You can still play without scanning.`;
  }
}
function leaveScan(){
  stopScan($('ar'));
  S.phase = 'menu';
  show('start');
}

// ------------------------------------------------------------ wiring
function syncDiff(){
  document.querySelectorAll('#diff button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.d === S.diff)));
  $('bestCorner').textContent = `best ${store.get(`best.${S.diff}`, 0)}`;
}
$('diff').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  S.diff = b.dataset.d;
  store.set('diff', S.diff);
  syncDiff();
});
$('scanBtn').addEventListener('click', () => { sound.unlock(); beginScan(); });
$('noScanBtn').addEventListener('click', () => { sound.unlock(); startGame(); });
$('scanCancel').addEventListener('click', leaveScan);
$('scanSkip').addEventListener('click', () => { stopScan($('ar')); startGame(); });
$('tray').addEventListener('pointerdown', (e) => {
  const tile = e.target.closest('.tile');
  if (tile) onTile(tile);
});
$('pauseBtn').addEventListener('click', pause);
$('resumeBtn').addEventListener('click', resume);
$('quitBtn').addEventListener('click', () => { show('game'); gameOver(); });
$('soundBtn').addEventListener('click', () => {
  sound.on = !sound.on; store.set('sound', sound.on);
  $('soundBtn').textContent = `Sound: ${sound.on ? 'on' : 'off'}`;
  sound.unlock();
});
$('againBtn').addEventListener('click', startGame);
$('menuBtn').addEventListener('click', () => { S.phase = 'menu'; syncDiff(); show('start'); });
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

$('soundBtn').textContent = `Sound: ${sound.on ? 'on' : 'off'}`;
$('logo').innerHTML = bowlSvg({ broth: 'miso', noodles: 'thickCurly', toppings: ['chashu', 'corn', 'butter', 'moyashi', 'negi'] }, { steam: true });
syncDiff();

// Debug hooks for headless checks.
window.__ramen = { S, newOrder, serve, gameOver, startGame };

if (DEMO){ sound.unlock(); startGame(); }
