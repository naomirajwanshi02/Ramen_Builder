// Ramen_Builder — game rules, scoring and HUD. The 3D stage lives in stage.js.
import { INGREDIENTS, RECIPES, PACE, LAYER_NAME, SHORT } from './data.js';
import { ingredientSvg } from './art.js';
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
  m.innerHTML = `<div>×${S.mult}<small>${S.combo ? `${S.combo} perfect` : 'combo'}</small></div>`;
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
  sound.good(S.bowl.toppings.length + (S.bowl.noodles ? 1 : 0));
  buzz(12);
  tagAt(at, `+10 ${SHORT[id]}`, 'good');
  addScore(10);
  renderTicket();
  if (S.need.every(have)){ S.phase = 'serving'; setTimeout(serve, 650); }
}

/* Combo, kept simple for kids: every PERFECT bowl in a row (no wrong taps) adds one
   to the multiplier, up to ×5. One mistake, or a bowl that goes cold, resets it to ×1.
   The multiplier applies to the bowl's points when it's served. */
function breakCombo(){
  const had = S.combo;
  S.combo = 0; S.mult = 1;
  renderMult(false);
  if (had > 0) popup('Combo lost', 'mid', 0.3);
}
function mistake(at, message){
  S.mistakes++;
  breakCombo();
  S.timeLeft = Math.max(0.01, S.timeLeft - 1.5);
  sound.bad(); buzz(80);
  tagAt(at, `✕ ${message}`, 'bad');
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
  const frac = Math.max(0, S.timeLeft / S.timeMax);
  const perfect = S.mistakes === 0;
  // every part is a multiple of 10: 100 for the bowl, up to 150 for speed, 50 if perfect
  const total = (100 + Math.round(15 * frac) * 10 + (perfect ? 50 : 0)) * S.mult;
  S.served++;
  S.learned.add(S.recipe.id);
  sound.serve(); buzz([20, 40, 20]);
  popup(perfect ? 'Perfect bowl!' : 'Order up!', 'big', 0.3);
  flyPoints(total, () => addScore(total, { lock: true }));
  if (perfect){
    S.combo++;
    S.maxCombo = Math.max(S.maxCombo, S.combo);
    const m = Math.min(5, 1 + S.combo);
    const bumped = m > S.mult;
    S.mult = m;
    S.maxMult = Math.max(S.maxMult, m);
    renderMult(bumped);
    if (bumped) setTimeout(() => { sound.combo(m); popup(`${S.combo} perfect in a row!  ×${m}`, 'big', 0.62); }, 500);
  }
  toast(`<b>${S.recipe.name}</b> — ${S.recipe.fact}`);
  AR.clearTokens();
  await AR.serveBowl();
  if (S.phase === 'serving') newOrder();
}

async function timeout(){
  S.phase = 'serving';
  S.lives--;
  breakCombo();
  renderLives();
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

// No countdown: the first order is on the counter the moment the shop opens.
function startGame({ tour = false } = {}){
  resetGame();
  show(null);
  overlay('hud', true);
  $('dragHint').style.opacity = '';
  newOrder();
  if (tour){ S.phase = 'intro'; setTimeout(showTour, 1100); } // the clock waits until the tour is done
}

// ------------------------------------------------------------ how to play
// A short spotlight tour over the real first order, so every part is pointed at where it is.
const TOUR = [
  { title: '📋 Your order', text: 'This is the ramen to cook. Add the ingredients <b>left to right</b>; each one gets a ✓. Finish before the <b>timer bar</b> runs out!',
    rect: () => $('order').getBoundingClientRect() },
  { title: '🍜 Your bowl', text: 'Everything you pick jumps into this bowl. When it\'s full, it\'s <b>served automatically</b> and the next order comes in.',
    rect: () => AR.bowlRect() },
  { title: '👆 The ingredients', text: 'Tap a plate to add it. Always <b>broth first</b>, then <b>noodles</b>, then the <b>toppings</b>. A wrong tap costs time!',
    rect: () => AR.tokensRect() },
  { title: '⭐ Score, combo & lives', text: 'Every <b>perfect bowl</b> in a row raises your multiplier, up to <b>×5</b>. A bowl that goes cold costs one of your <b>3 lives</b>. It gets faster as you go!',
    rect: () => document.querySelector('.hud.top').getBoundingClientRect() },
];
let tourStep = 0;
function showTour(){
  if (S.phase !== 'intro') return;
  tourStep = 0;
  overlay('howto', true);
  renderTour();
}
function renderTour(){
  const step = TOUR[tourStep];
  const r = step.rect();
  const pad = 6;
  Object.assign($('spot').style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
  $('coachStep').textContent = `How to play · ${tourStep + 1}/${TOUR.length}`;
  $('coachTitle').textContent = step.title;
  $('coachText').innerHTML = step.text;
  $('coachNext').textContent = tourStep === TOUR.length - 1 ? "Let's cook!" : 'Next';
  // put the card on whichever side of the spotlight has more room
  const coach = $('coach');
  const below = innerHeight - (r.top + r.height);
  const h = coach.offsetHeight || 170;
  coach.style.top = below > r.top ? `${Math.min(innerHeight - h - 12, r.top + r.height + 16)}px` : `${Math.max(12, r.top - h - 16)}px`;
  coach.style.animation = 'none'; void coach.offsetWidth; coach.style.animation = '';
}
function endTour(){
  overlay('howto', false);
  if (S.phase !== 'intro') return;
  S.timeLeft = S.timeMax;
  S.idle = 0;
  S.phase = 'play';
  sound.unlock();
  popup('いただきます!', 'big', 0.4);
}
$('coachNext').addEventListener('click', () => {
  sound.unlock();
  if (tourStep < TOUR.length - 1){ tourStep++; renderTour(); } else endTour();
});
$('coachSkip').addEventListener('click', endTour);
addEventListener('resize', () => { if ($('howto').classList.contains('on')) setTimeout(renderTour, 50); });

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
  setTimeout(() => overlay('found', false), 1100);
  startGame({ tour: true });
}
// The page opens straight into the camera viewfinder.
async function openShop(demo){
  S.phase = 'scan'; S.started = false;
  show(null);
  overlay('hud', false);
  $('scanRetry').hidden = true;
  $('guideTitle').textContent = 'Point your camera at the Ramen Builder card';
  $('scanStatus').textContent = 'Starting camera…';
  overlay('guide', !demo);
  try {
    await AR.preloadIcons();
    if (demo){ await AR.openDemo($('ar')); onFound(); }
    else await AR.scan($('ar'), { onStatus: (t) => { $('scanStatus').textContent = t; }, onFound });
  } catch (err) {
    console.error(err);
    const msg = String(err?.message || err?.name || err || '');
    $('scanStatus').textContent = /mind|fetch|404/i.test(msg) ? `Could not load the card data (${msg}).`
      : 'Camera not available — allow camera access for this site in your browser settings, then tap Try again.';
    $('scanRetry').hidden = false;
  }
}
function rescan(demo = false){
  AR.stop();
  overlay('found', false);
  openShop(demo);
}

// Sound and iPhone motion access both need a tap, so they unlock on the first touch anywhere.
addEventListener('pointerdown', () => { sound.unlock(); AR.askMotion(); }, { once: true, capture: true });

// ------------------------------------------------------------ wiring
$('scanRetry').addEventListener('click', () => rescan(false));
$('scanSkip').addEventListener('click', () => rescan(true));
$('pauseBtn').addEventListener('click', pause);
$('resumeBtn').addEventListener('click', resume);
$('quitBtn').addEventListener('click', () => { show(null); gameOver(); });
$('soundBtn').addEventListener('click', () => {
  sound.on = !sound.on; store.set('sound', sound.on);
  $('soundBtn').textContent = `Sound: ${sound.on ? 'on' : 'off'}`;
  sound.unlock();
});
$('againBtn').addEventListener('click', () => { show(null); startGame(); });
$('menuBtn').addEventListener('click', () => rescan(false));
$('errBtn').addEventListener('click', () => { $('err').hidden = true; rescan(false); });
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
// MindAR's own listeners can throw after a failed camera start; the viewfinder already says what to do.
const fromTracker = (s) => /mind-?ar/i.test(String(s));
addEventListener('error', (e) => { const s = e.error?.stack || e.message; if (fromTracker(s + e.filename)) return; $('errText').textContent = String(s); $('err').hidden = false; });
addEventListener('unhandledrejection', (e) => { const s = e.reason?.stack || e.reason; if (fromTracker(s)) return; $('errText').textContent = String(s); $('err').hidden = false; });

AR.onPick(onPick);
// The stage fills the screen below the order card, leaving a strip for the drag hint.
AR.setLayoutBounds(() => $('hudstack').getBoundingClientRect().bottom + 6, () => 22 + (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-b')) || 0));
$('soundBtn').textContent = `Sound: ${sound.on ? 'on' : 'off'}`;

// Debug hooks for headless checks.
window.__ramen = { S, newOrder, gameOver, startGame, onPick, AR };

openShop(DEMO);
