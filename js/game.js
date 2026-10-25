// Ramen_Builder — game rules, scoring and HUD. The 3D stage lives in stage.js.
import { INGREDIENTS, RECIPES, PACE, LAYER_NAME, SHORT } from './data.js';
import { ingredientSvg, bowlSvg, japanMapSvg } from './art.js';
import * as AR from './stage.js';

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
  phase: 'menu', // menu | scan | count | play | serving | paused | over
  score: 0, combo: 0, maxCombo: 0, mult: 1, maxMult: 1, lives: 3, served: 0,
  recipe: null, need: [], bowl: null, mistakes: 0, idle: 0,
  timeLeft: 0, timeMax: 1, lastTickAt: 0, learned: new Set(), lastRecipe: null,
  started: false, // the AR shop has been opened at least once this session
};

function show(id){
  document.querySelectorAll('.screen').forEach((el) => el.classList.toggle('on', el.id === id));
}
const overlay = (id, on) => $(id).classList.toggle('on', on);

// ------------------------------------------------------------ odometer
const ODO_DIGITS = 6;
function buildOdo(el, digits){
  el.innerHTML = Array.from({ length: digits }, () =>
    `<div class="d"><span>${Array.from({ length: 10 }, (_, n) => `<i>${n}</i>`).join('')}</span></div>`).join('');
}
function setOdo(el, value){
  const h = el.firstChild.offsetHeight || 26;
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
  sound.clack(); buzz(20);
  clearTimeout(lockScore.t);
  lockScore.t = setTimeout(() => $('scoreBox').classList.remove('locked'), 1100);
}
function addScore(points, { lock = false } = {}){
  S.score += points;
  setOdo($('odo'), S.score);
  if (lock) lockScore();
}

// ------------------------------------------------------------ HUD helpers
function renderMult(bumped){
  const m = $('mult');
  m.dataset.m = S.mult;
  m.innerHTML = `<div>×${S.mult}<small>combo ${S.combo}</small></div>`;
  if (bumped){ m.classList.remove('bump'); void m.offsetWidth; m.classList.add('bump'); }
}
const LIFE = `<svg viewBox="0 0 24 24"><path d="M2 10h20q-1 10-10 11Q3 20 2 10Z" fill="#f6eddb" stroke="#3b2a1c" stroke-width="1.5"/><path d="M4 10q8 3 16 0" fill="none" stroke="#b5452f" stroke-width="1.2"/><path d="M8 7q-1-3 1-5M12 7q-1-3 1-5M16 7q-1-3 1-5" fill="none" stroke="#8c7457" stroke-width="1.2" stroke-linecap="round"/></svg>`;
function renderLives(){
  const max = PACE.lives;
  $('lives').innerHTML = Array.from({ length: max }, () => LIFE).join('');
  [...$('lives').children].forEach((el, i) => el.classList.toggle('gone', i >= S.lives));
}
function popup(text, cls = 'mid', y = 0.4){
  const el = document.createElement('div');
  el.className = `pop ${cls}`;
  el.style.top = `${Math.round(innerHeight * y)}px`;
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1400);
}
// A label that pops out of a point in the AR scene.
function tagAt({ x, y }, text, cls = ''){
  const el = document.createElement('div');
  el.className = `tag ${cls}`;
  el.textContent = text;
  el.style.left = `${Math.max(60, Math.min(innerWidth - 60, x))}px`;
  el.style.top = `${Math.max(90, Math.min(innerHeight - 160, y))}px`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1050);
}
function toast(html, ms = 3200){
  const t = $('toast');
  t.innerHTML = html;
  t.classList.add('on');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('on'), ms);
}

// ------------------------------------------------------------ orders
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--){ const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = (list, n) => shuffle([...list]).slice(0, Math.max(0, n));
const MAX_TOKENS = 10; // how many ingredient plates are on the counter at once

function newOrder(){
  const d = PACE;
  const choices = RECIPES.filter((r) => r.id !== S.lastRecipe);
  const r = choices[Math.floor(Math.random() * choices.length)];
  S.lastRecipe = r.id;
  S.recipe = r;
  const nTop = Math.min(r.toppings.length, d.toppings + Math.floor(S.served / 2));
  S.need = [r.broth, r.noodles, ...r.toppings.slice(0, nTop)];
  S.bowl = { broth: null, noodles: null, toppings: [] };
  S.mistakes = 0; S.idle = 0;

  // Decoys come from the same layers, so the player has to know which broth and which noodle.
  const ramp = Math.min(1, S.served / 14);
  const nDecoy = Math.min(MAX_TOKENS - S.need.length, Math.round(d.decoys[0] + (d.decoys[1] - d.decoys[0]) * ramp));
  const all = Object.keys(INGREDIENTS).filter((id) => !S.need.includes(id));
  const byLayer = (layer) => all.filter((id) => INGREDIENTS[id].layer === layer);
  const decoys = [...pick(byLayer('broth'), Math.min(2, Math.ceil(nDecoy / 3))), ...pick(byLayer('noodles'), Math.min(2, Math.floor(nDecoy / 3)))];
  decoys.push(...pick(byLayer('topping'), nDecoy - decoys.length));

  const perStep = Math.max(d.floor, d.perStep * d.shrink ** S.served);
  S.timeMax = perStep * S.need.length + 3; // +3s to read the order and look around the ring
  S.timeLeft = S.timeMax;

  $('ordNo').textContent = `Order ${String(S.served + 1).padStart(2, '0')}`;
  $('ordPlace').textContent = r.place;
  $('ordName').textContent = r.name;
  $('map').innerHTML = japanMapSvg(RECIPES, r.id);
  AR.newBowl();
  AR.setTokens(shuffle([...S.need, ...decoys]));
  AR.hint(null);
  renderTicket();
  requestAnimationFrame(() => AR.layout()); // the ticket height may have changed
  S.phase = 'play';
}

const have = (id) => S.bowl.broth === id || S.bowl.noodles === id || S.bowl.toppings.includes(id);
const nextLayer = () => (!S.bowl.broth ? 'broth' : !S.bowl.noodles ? 'noodles' : 'topping');
function renderTicket(){
  const layer = nextLayer();
  $('ticket').innerHTML = S.need.map((id, i) => {
    const done = have(id);
    const next = !done && INGREDIENTS[id].layer === layer;
    const sep = i === 1 || i === 2 ? '<span class="sep"></span>' : '';
    return `${sep}<div class="chip${done ? ' done' : ''}${next ? ' next' : ''}" title="${INGREDIENTS[id].name}">${ingredientSvg(id, { size: 48 })}<span>${SHORT[id]}</span></div>`;
  }).join('');
  const got = S.need.filter(have).length;
  $('ordRead').textContent = `${got}/${S.need.length}`;
  const nextIds = S.need.filter((id) => !have(id) && INGREDIENTS[id].layer === layer);
  $('hint').innerHTML = got === S.need.length ? 'Order up!'
    : `Tap the <b>${layer === 'topping' ? 'toppings' : SHORT[nextIds[0]] + ' ' + LAYER_NAME[layer].toLowerCase()}</b>`;
}

// ------------------------------------------------------------ picking an ingredient in AR
function onPick(id){
  if (S.phase !== 'play') return;
  sound.unlock();
  $('dragHint').style.opacity = '0';
  const ing = INGREDIENTS[id];
  const layer = nextLayer();
  const inRecipe = S.need.includes(id);
  const at = AR.tokenScreen(id);
  if (!inRecipe || ing.layer !== layer){
    AR.wrongToken(id);
    mistake(at, inRecipe ? `${LAYER_NAME[layer]} first!` : `No ${SHORT[id]} in this bowl!`);
    return;
  }
  AR.acceptToken(id);
  if (layer === 'broth') S.bowl.broth = id;
  else if (layer === 'noodles') S.bowl.noodles = id;
  else S.bowl.toppings.push(id);
  S.idle = 0;
  AR.hint(null);
  S.combo++;
  S.maxCombo = Math.max(S.maxCombo, S.combo);
  const m = Math.min(5, 1 + Math.floor(S.combo / 4));
  const bumped = m > S.mult;
  S.mult = m;
  S.maxMult = Math.max(S.maxMult, m);
  sound.good(S.bowl.toppings.length + (S.bowl.noodles ? 1 : 0));
  buzz(12);
  tagAt(at, `+${10 * S.mult} ${SHORT[id]}`, 'good');
  if (bumped){ sound.combo(m); popup(`${S.combo} COMBO!  ×${m}`, 'big', 0.62); }
  else if (S.mult === 5 && S.combo % 5 === 0) popup(`${S.combo} COMBO!`, 'big', 0.62);
  addScore(10 * S.mult);
  renderMult(bumped);
  renderTicket();
  if (S.need.every(have)){ S.phase = 'serving'; setTimeout(serve, 650); }
}

function mistake(at, message){
  S.mistakes++;
  const lost = S.combo;
  S.combo = 0; S.mult = 1;
  renderMult(false);
  S.timeLeft = Math.max(0.01, S.timeLeft - 1.5);
  sound.bad(); buzz(80);
  tagAt(at, `✕ ${message}`, 'bad');
  if (lost >= 4) popup('Combo lost', 'mid', 0.3);
}

// ------------------------------------------------------------ serve / timeout
function flyPoints(points, done){
  const from = AR.bowlScreen();
  const to = $('odo').getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'pts';
  el.textContent = `+${points}`;
  el.style.left = `${from.x - 30}px`;
  el.style.top = `${from.y - 20}px`;
  document.body.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    el.style.transform = `translate(${to.left - from.x + 30}px, ${to.top - from.y + 20}px) scale(.7)`;
    el.style.opacity = '.2';
  }));
  setTimeout(() => { el.remove(); done(); }, 820);
}

async function serve(){
  const frac = S.timeLeft / S.timeMax;
  const perfect = S.mistakes === 0 ? 50 : 0;
  const total = (100 + Math.round(150 * frac) + perfect) * S.mult;
  S.served++;
  S.learned.add(S.recipe.id);
  sound.serve(); buzz([20, 40, 20]);
  popup(perfect ? 'Perfect bowl!' : 'Order up!', 'big', 0.3);
  flyPoints(total, () => addScore(total, { lock: true }));
  toast(`<b>${S.recipe.name}</b> — ${S.recipe.fact}`);
  AR.clearTokens();
  await AR.serveBowl();
  if (S.phase === 'serving') newOrder();
}

async function timeout(){
  S.phase = 'serving';
  S.lives--;
  S.combo = 0; S.mult = 1;
  renderMult(false); renderLives();
  sound.lose(); buzz([60, 40, 60]);
  popup('Too slow! The ramen got cold', 'mid', 0.3);
  AR.clearTokens();
  await AR.dumpBowl();
  if (S.lives <= 0) gameOver();
  else if (S.phase === 'serving') newOrder();
}

// ------------------------------------------------------------ loop
let lastT = 0;
function loop(t){
  const dt = Math.min(0.05, (t - lastT) / 1000 || 0);
  lastT = t;
  if (S.phase === 'play'){
    S.timeLeft -= dt;
    S.idle += dt;
    // A nudge for younger players: after a while with no progress, the wanted ingredients hop.
    if (S.idle > PACE.hintAfter){
      const layer = nextLayer();
      AR.hint(S.need.filter((id) => !have(id) && INGREDIENTS[id].layer === layer));
    }
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
  S.lives = PACE.lives;
  buildOdo($('odo'), ODO_DIGITS);
  setOdo($('odo'), 0);
  renderMult(false); renderLives();
}

function countdown(then){
  S.phase = 'count';
  overlay('count', true);
  const span = $('count').querySelector('span');
  const steps = ['3', '2', '1', 'いただきます!'];
  steps.forEach((txt, i) => setTimeout(() => {
    span.textContent = txt;
    span.className = i === 3 ? 'go' : '';
    span.style.animation = 'none'; void span.offsetWidth; span.style.animation = '';
    sound.tone(i === 3 ? 880 : 440, 0.12);
  }, i * 700));
  setTimeout(() => { overlay('count', false); then(); }, steps.length * 700);
}

function startGame(){
  resetGame();
  show(null);
  overlay('hud', true);
  $('ordName').textContent = 'Get ready…';
  $('ticket').innerHTML = ''; $('hint').textContent = ''; $('ordPlace').textContent = ''; $('ordRead').textContent = '';
  $('dragHint').style.opacity = '';
  AR.layout();
  AR.newBowl();
  countdown(() => newOrder());
}

function gameOver(){
  S.phase = 'over';
  AR.clearTokens();
  show('over');
  const best = store.get('best', 0);
  const isBest = S.score > best;
  if (isBest) store.set('best', S.score);
  $('overOrders').textContent = `${S.served} orders`;
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
  const lead = digits.length - String(S.score).length;
  big.innerHTML = [...digits].map(() => `<div class="d spin"><span>${Array.from({ length: 20 }, (_, n) => `<i>${n % 10}</i>`).join('')}</span></div>`).join('');
  [...big.children].forEach((d, i) => setTimeout(() => {
    d.classList.remove('spin');
    d.firstChild.style.transform = `translateY(${-Number(digits[i]) * 60}px)`;
    if (i < lead) d.style.opacity = '.35';
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
  show(null);
  S.phase = 'play';
}

// ------------------------------------------------------------ AR session
// The card is only needed once: when it is recognised the shop opens on screen
// over the live camera, and the phone can move freely from then on.
function onFound(){
  if (S.started) return;
  S.started = true;
  overlay('guide', false);
  AR.open($('ar'));
  sound.serve(); buzz(40);
  overlay('found', true);
  setTimeout(() => { overlay('found', false); startGame(); }, 1400);
}
async function openShop(demo){
  sound.unlock();
  AR.askMotion(); // iPhone asks once for motion access (used for a little tilt parallax)
  S.phase = 'scan'; S.started = false;
  show(null);
  document.body.classList.add('ar');
  $('guideTitle').textContent = 'Point your camera at the Ramen Builder card';
  $('scanStatus').textContent = 'Starting camera…';
  overlay('guide', !demo);
  try {
    await AR.preloadIcons();
    if (demo){ await AR.openDemo($('ar')); S.started = false; onFoundDemo(); }
    else await AR.scan($('ar'), { onStatus: (t) => { $('scanStatus').textContent = t; }, onFound });
  } catch (err) {
    console.error(err);
    const msg = String(err?.message || err);
    $('scanStatus').textContent = /permission|denied|notallowed/i.test(msg)
      ? 'Camera blocked — allow camera access for this site in your browser settings, or use demo mode.'
      : /mind|fetch|404/i.test(msg) ? `Could not load the card data (${msg}).` : `Could not start the camera (${msg}).`;
  }
}
function closeShop(){
  AR.stop();
  document.body.classList.remove('ar');
  ['guide', 'hud', 'count', 'found'].forEach((id) => overlay(id, false));
  S.phase = 'menu';
  syncBest();
  show('start');
}
function onFoundDemo(){
  S.started = true;
  startGame();
}

// ------------------------------------------------------------ wiring
function syncBest(){ $('bestCorner').textContent = `best ${store.get('best', 0)}`; }
$('scanBtn').addEventListener('click', () => openShop(false));
$('noScanBtn').addEventListener('click', () => openShop(true));
$('scanCancel').addEventListener('click', closeShop);
$('scanSkip').addEventListener('click', () => { AR.stop(); openShop(true); });
$('pauseBtn').addEventListener('click', pause);
$('resumeBtn').addEventListener('click', resume);
$('quitBtn').addEventListener('click', () => { show(null); gameOver(); });
$('soundBtn').addEventListener('click', () => {
  sound.on = !sound.on; store.set('sound', sound.on);
  $('soundBtn').textContent = `Sound: ${sound.on ? 'on' : 'off'}`;
  sound.unlock();
});
$('againBtn').addEventListener('click', () => { show(null); startGame(); });
$('menuBtn').addEventListener('click', closeShop);
$('errBtn').addEventListener('click', () => { $('err').hidden = true; closeShop(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
addEventListener('error', (e) => { $('errText').textContent = String(e.error?.stack || e.message); $('err').hidden = false; });
addEventListener('unhandledrejection', (e) => { $('errText').textContent = String(e.reason?.stack || e.reason); $('err').hidden = false; });

AR.onPick(onPick);
// The stage fills the screen below the order card, leaving a strip for the drag hint.
AR.setLayoutBounds(() => $('hudstack').getBoundingClientRect().bottom + 6, () => 22 + (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-b')) || 0));
$('soundBtn').textContent = `Sound: ${sound.on ? 'on' : 'off'}`;
$('logo').innerHTML = bowlSvg({ broth: 'miso', noodles: 'thickCurly', toppings: ['chashu', 'corn', 'butter', 'moyashi', 'negi'] }, { steam: true });
syncBest();
show('start');

// Debug hooks for headless checks.
window.__ramen = { S, newOrder, gameOver, startGame, onPick, AR };

if (DEMO) openShop(true);
