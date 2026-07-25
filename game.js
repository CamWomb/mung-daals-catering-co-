'use strict';
/* ============================================================
   MUNG DAAL'S CATERING CO.
   A Chowder fan-game. Pure vanilla JS + canvas, zero assets.
   Sections:
     1. Constants & canvas setup
     2. Audio (tiny WebAudio synth, mute-safe)
     3. Input
     4. Utilities & draw helpers
     5. Patterns (static screen-space fills — the show's gag)
     6. Character drawing (procedural)
     7. Game data (ingredients, recipes, customers, upgrades)
     8. State
     9. Title & Help screens
    10. Morning phase (dialogue)
    11. Market phase (hub + shops)
    12. Service phase (orders, tickets, Schnitzel)
    13. Mini-games (chop / stir / oven / plate)
    14. Chowder Factor events (+ rival sabotage)
    15. Evening phase (tally, shop, recipe book)
    16. Main loop
   ============================================================ */

/* ===================== 1. CONSTANTS ======================= */
const cv = document.getElementById('game');
const ctx = cv.getContext('2d');
const W = 960, H = 600;
const OUTLINE = '#231634';
const FONT = '"Comic Sans MS","Chalkboard SE","Segoe Print",sans-serif';
/* When true, the world/characters render in 3D on the lower WebGL canvas
   (world3d.js + three.min.js) and this canvas draws only the HUD/UI.
   When false (no THREE / no WebGL), the original full-2D path is used. */
let use3D = false;

/* ======================= 2. AUDIO ========================= */
let AC = null;
function ac() {
  if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { AC = null; } }
  if (AC && AC.state === 'suspended') AC.resume();
  return AC;
}
function tone(freq, dur, type, vol, delay) {
  if (G.muted) return;
  const c = ac(); if (!c) return;
  const t0 = c.currentTime + (delay || 0);
  const o = c.createOscillator(), g = c.createGain();
  o.type = type || 'square'; o.frequency.value = freq;
  g.gain.setValueAtTime(vol || 0.06, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g); g.connect(c.destination);
  o.start(t0); o.stop(t0 + dur + 0.03);
}
const sfx = {
  click()  { tone(620, 0.06, 'square', 0.045); },
  pop()    { tone(320, 0.05, 'triangle', 0.07); },
  coin()   { tone(920, 0.08); tone(1420, 0.13, 'square', 0.06, 0.07); },
  good()   { tone(523, 0.1); tone(659, 0.1, 'square', 0.06, 0.09); tone(784, 0.16, 'square', 0.06, 0.18); },
  bad()    { tone(150, 0.28, 'sawtooth', 0.08); tone(110, 0.3, 'sawtooth', 0.07, 0.1); },
  jingle() { [880, 660, 880, 1174, 880].forEach((f, i) => tone(f, 0.09, 'square', 0.06, i * 0.09)); },
  alarm()  { tone(700, 0.1, 'square', 0.07); tone(700, 0.1, 'square', 0.07, 0.15); },
  chop()   { tone(200, 0.04, 'square', 0.08); },
  ding()   { tone(1320, 0.2, 'sine', 0.08); },
};

/* ======================= 3. INPUT ========================= */
const keys = {};        // held keys (lowercased e.key)
let pressed = new Set(); // keys pressed this frame
let frameClicks = [];    // {x,y} mousedown events this frame
let frameReleases = [];  // {x,y} mouseup events this frame
const mouse = { x: W / 2, y: H / 2, down: false };

function canvasPos(e) {
  const r = cv.getBoundingClientRect();
  return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) };
}window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'tab'].includes(k)) e.preventDefault();
  if (!e.repeat) pressed.add(k);
  keys[k] = true;
  ac(); // unlock audio on first gesture
});
window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });
cv.addEventListener('mousemove', (e) => { const p = canvasPos(e); mouse.x = p.x; mouse.y = p.y; });
cv.addEventListener('mousedown', (e) => {
  const p = canvasPos(e); mouse.x = p.x; mouse.y = p.y; mouse.down = true;
  frameClicks.push({ x: p.x, y: p.y }); ac();
});
window.addEventListener('mouseup', (e) => {
  const p = canvasPos(e); mouse.x = p.x; mouse.y = p.y; mouse.down = false;
  frameReleases.push({ x: p.x, y: p.y });
});

/* ===================== TOUCH CONTROLS =====================
   Virtual joystick (floating origin, market) + context action
   buttons drawn on the HUD canvas, so they scale with the game.
   Touch maps onto the exact same input state as keyboard/mouse. */
const joy = { id: null, bx: 0, by: 0, dx: 0, dy: 0 }; // joystick state
let touchMouseId = null;                               // identifier of the touch driving "mouse"
const JOY_R = 60;

/* Context action buttons for the current phase/overlay. */
function getTouchButtons() {
  if (!G.touchUI) return [];
  const bs = [{ id: 'm', x: 930, y: 22, r: 17, label: 'M' }]; // mute, always
  const ov = G.overlay;
  if (ov) {
    if (ov.type === 'mg' && (ov.kind === 'chop' || ov.kind === 'oven'))
      bs.push({ id: ' ', x: 850, y: 490, r: 62, label: ov.kind === 'chop' ? 'CHOP!' : 'PULL!' });
    else if (ov.type === 'event' && ov.kind === 'wrestle')
      bs.push({ id: ' ', x: 850, y: 490, r: 62, label: 'MASH!' });
    else if (ov.type === 'shop')
      bs.push({ id: 'escape', x: 855, y: 520, r: 42, label: 'CLOSE' });
    else if (ov.type === 'budget')
      bs.push({ id: ' ', x: 850, y: 490, r: 55, label: 'OK' });
  } else if (G.screen === 'morning') {
    bs.push({ id: ' ', x: 855, y: 510, r: 55, label: 'NEXT' });
  } else if (G.screen === 'market') {
    bs.push({ id: 'e', x: 855, y: 490, r: 55, label: 'USE' });
    bs.push({ id: 'tab', x: 855, y: 385, r: 38, label: 'SWAP' });
  } else if (G.screen === 'service') {
    bs.push({ id: ' ', x: 855, y: 490, r: 55, label: 'COOK' });
  } else if (G.screen === 'evening') {
    bs.push({ id: 'enter', x: 855, y: 510, r: 55, label: 'NEXT' });
  }
  return bs;
}
function drawTouchControls() {
  if (!G.touchUI) return;
  // joystick: visible during market exploration only
  if (G.screen === 'market' && !G.overlay) {
    if (joy.id !== null) {
      ctx.globalAlpha = 0.35;
      circ(joy.bx, joy.by, JOY_R, '#fdf6e3', OUTLINE, 3);
      ctx.globalAlpha = 0.6;
      circ(joy.bx + joy.dx * 34, joy.by + joy.dy * 34, 26, '#ffd94a', OUTLINE, 3);
      ctx.globalAlpha = 1;
    } else {
      ctx.globalAlpha = 0.75;
      text('drag left side of screen to walk', 14, 84, 12, '#fdf6e3', 'left', false);
      ctx.globalAlpha = 1;
    }
  }
  for (const b of getTouchButtons()) {
    ctx.globalAlpha = 0.62;
    circ(b.x, b.y, b.r, '#ffd94a', OUTLINE, 3);
    ctx.globalAlpha = 1;
    text(b.label, b.x, b.y + 1, b.r > 30 ? 15 : 11, OUTLINE);
  }
}
cv.addEventListener('touchstart', (e) => {
  e.preventDefault(); // also suppresses synthesized mouse events (no double-fire)
  ac();
  for (const t of e.changedTouches) {
    const p = canvasPos(t);
    const b = getTouchButtons().find(b => dist(p.x, p.y, b.x, b.y) <= b.r * 1.2);
    if (b) { pressed.add(b.id); continue; }
    if (G.screen === 'market' && !G.overlay && joy.id === null && p.x < W * 0.45 && p.y > 240) {
      joy.id = t.identifier; joy.bx = p.x; joy.by = p.y; joy.dx = 0; joy.dy = 0;
      continue;
    }
    if (touchMouseId === null) {
      touchMouseId = t.identifier;
      mouse.x = p.x; mouse.y = p.y; mouse.down = true;
      frameClicks.push({ x: p.x, y: p.y });
    }
  }
}, { passive: false });
cv.addEventListener('touchmove', (e) => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    const p = canvasPos(t);
    if (t.identifier === joy.id) {
      joy.dx = clamp((p.x - joy.bx) / JOY_R, -1, 1);
      joy.dy = clamp((p.y - joy.by) / JOY_R, -1, 1);
    } else if (t.identifier === touchMouseId) {
      mouse.x = p.x; mouse.y = p.y;
    }
  }
}, { passive: false });
function touchEnd(e) {
  e.preventDefault();
  for (const t of e.changedTouches) {
    const p = canvasPos(t);
    if (t.identifier === joy.id) { joy.id = null; joy.dx = 0; joy.dy = 0; }
    else if (t.identifier === touchMouseId) {
      touchMouseId = null; mouse.down = false;
      frameReleases.push({ x: p.x, y: p.y });
    }
  }
}
cv.addEventListener('touchend', touchEnd, { passive: false });
cv.addEventListener('touchcancel', touchEnd, { passive: false });

/* ================= 4. UTILITIES & DRAW HELPERS ============ */
function rand(a, b) { return a + Math.random() * (b - a); }
function randi(a, b) { return Math.floor(rand(a, b + 1)); }
function choice(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function dist(x1, y1, x2, y2) { return Math.hypot(x2 - x1, y2 - y1); }
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

function rr(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function fillRR(x, y, w, h, r, fill, stroke, lw) {
  rr(x, y, w, h, r);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 3; ctx.stroke(); }
}
function circ(x, y, r, fill, stroke, lw) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 3; ctx.stroke(); }
}
function ell(x, y, rx, ry, fill, stroke, lw) {
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 3; ctx.stroke(); }
}
function tri(x1, y1, x2, y2, x3, y3, fill, stroke, lw) {
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 3; ctx.stroke(); }
}
function line(x1, y1, x2, y2, color, lw) {
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
  ctx.strokeStyle = color; ctx.lineWidth = lw || 2; ctx.stroke();
}
function text(str, x, y, size, color, align, bold) {
  ctx.font = (bold === false ? '' : 'bold ') + size + 'px ' + FONT;
  ctx.fillStyle = color; ctx.textAlign = align || 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(str, x, y);
}
function wrapText(str, maxW, size) {
  ctx.font = 'bold ' + size + 'px ' + FONT;
  const words = str.split(' '); const lines = []; let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

/* ---- Immediate-mode-ish buttons: drawn each frame, clicked next update ---- */
let uiButtons = [];
function btn(id, x, y, w, h, label, opts) {
  opts = opts || {};
  const hover = !opts.disabled && mouse.x >= x && mouse.x <= x + w && mouse.y >= y && mouse.y <= y + h;
  const bg = opts.disabled ? '#8f8a9a' : hover ? (opts.hcolor || '#ffd94a') : (opts.color || '#f4a83d');
  fillRR(x, y, w, h, 10, bg, OUTLINE, 3);
  text(label, x + w / 2, y + h / 2 + 1, opts.size || 18, opts.disabled ? '#5a5566' : OUTLINE);
  uiButtons.push({ id, x, y, w, h, disabled: !!opts.disabled });
}
function clickedBtn() {
  for (const c of frameClicks) {
    for (const b of uiButtons) {
      if (!b.disabled && c.x >= b.x && c.x <= b.x + b.w && c.y >= b.y && c.y <= b.y + b.h) return b.id;
    }
  }
  return null;
}

/* ===================== 5. PATTERNS ========================
   Filled with the identity transform so the pattern stays put
   in SCREEN space while characters move — the classic Chowder gag. */
function makeTile(fn) {
  const c = document.createElement('canvas'); c.width = c.height = 20;
  fn(c.getContext('2d'));
  return ctx.createPattern(c, 'repeat');
}
const PAT = {};
function initPatterns() {
  PAT.dotsPink = makeTile(g => { g.fillStyle = '#e85f9b'; g.fillRect(0, 0, 20, 20); g.fillStyle = '#ffd7ea'; g.beginPath(); g.arc(5, 5, 3, 0, 7); g.arc(15, 15, 3, 0, 7); g.fill(); });
  PAT.dotsRed = makeTile(g => { g.fillStyle = '#d64545'; g.fillRect(0, 0, 20, 20); g.fillStyle = '#ffe9d9'; g.beginPath(); g.arc(5, 5, 3, 0, 7); g.arc(15, 15, 3, 0, 7); g.fill(); });
  PAT.plaid = makeTile(g => {
    g.fillStyle = '#b8433a'; g.fillRect(0, 0, 20, 20);
    g.fillStyle = 'rgba(255,230,200,0.55)'; g.fillRect(0, 0, 5, 20); g.fillRect(0, 0, 20, 5);
    g.fillStyle = 'rgba(70,20,60,0.4)'; g.fillRect(10, 0, 4, 20); g.fillRect(0, 10, 20, 4);
  });
  PAT.stripesTeal = makeTile(g => { g.fillStyle = '#2e8f86'; g.fillRect(0, 0, 20, 20); g.fillStyle = '#9fe0d8'; g.fillRect(0, 0, 20, 6); g.fillRect(0, 13, 20, 3); });
  PAT.dotsYellow = makeTile(g => { g.fillStyle = '#f7c948'; g.fillRect(0, 0, 20, 20); g.fillStyle = '#fff3c9'; g.beginPath(); g.arc(5, 5, 3, 0, 7); g.arc(15, 15, 3, 0, 7); g.fill(); });
  PAT.dotsBrown = makeTile(g => { g.fillStyle = '#7a5230'; g.fillRect(0, 0, 20, 20); g.fillStyle = '#b98a5a'; g.beginPath(); g.arc(5, 5, 3, 0, 7); g.arc(15, 15, 3, 0, 7); g.fill(); });
}

/* ================= 6. CHARACTER DRAWING ===================
   All drawn in absolute coordinates (no ctx.translate) so
   pattern fills stay static on screen. x,y = feet center.    */
function drawMung(x, y, s) {
  const O = OUTLINE;
  fillRR(x - 17 * s, y - 26 * s, 13 * s, 26 * s, 4, '#3a3f8a', O, 2.5);
  fillRR(x + 4 * s, y - 26 * s, 13 * s, 26 * s, 4, '#3a3f8a', O, 2.5);
  fillRR(x - 21 * s, y - 8 * s, 19 * s, 8 * s, 3, '#26202e', O, 2);
  fillRR(x + 2 * s, y - 8 * s, 19 * s, 8 * s, 3, '#26202e', O, 2);
  fillRR(x - 24 * s, y - 80 * s, 48 * s, 58 * s, 10, '#f4f1e8', O, 3);
  rr(x - 19 * s, y - 72 * s, 38 * s, 44 * s, 8);
  ctx.fillStyle = PAT.plaid; ctx.fill(); ctx.strokeStyle = O; ctx.lineWidth = 2.5; ctx.stroke();
  ell(x - 27 * s, y - 58 * s, 7 * s, 16 * s, '#7fb2f0', O, 2.5); // arms (blue skin)
  ell(x + 27 * s, y - 58 * s, 7 * s, 16 * s, '#7fb2f0', O, 2.5);
  circ(x, y - 100 * s, 23 * s, '#7fb2f0', O, 3); // head
  fillRR(x - 19 * s, y - 148 * s, 38 * s, 30 * s, 9, '#ffffff', O, 3); // chef hat
  fillRR(x - 20 * s, y - 124 * s, 40 * s, 9 * s, 3, '#e3e3e3', O, 2.5);
  circ(x - 9 * s, y - 106 * s, 4.5 * s, '#fff', O, 2); circ(x + 9 * s, y - 106 * s, 4.5 * s, '#fff', O, 2);
  circ(x - 9 * s, y - 106 * s, 1.8 * s, O); circ(x + 9 * s, y - 106 * s, 1.8 * s, O);
  ell(x + 1 * s, y - 96 * s, 13 * s, 9 * s, '#6ea3e8', O, 2.5); // THE nose
  ell(x - 10 * s, y - 85 * s, 11 * s, 5 * s, '#ffffff', O, 2); // mustache
  ell(x + 10 * s, y - 85 * s, 11 * s, 5 * s, '#ffffff', O, 2);
}
function drawTruffles(x, y, s, shout) {
  const O = OUTLINE;
  ell(x - 16 * s, y - 46 * s, 10 * s, 5 * s, 'rgba(255,255,255,0.7)', O, 1.5); // wings
  ell(x + 16 * s, y - 46 * s, 10 * s, 5 * s, 'rgba(255,255,255,0.7)', O, 1.5);
  tri(x - 20 * s, y, x + 20 * s, y, x, y - 52 * s, '#e85f9b', O, 3); // dress base
  tri(x - 20 * s, y, x + 20 * s, y, x, y - 52 * s, PAT.dotsPink, O, 2.5);
  fillRR(x - 12 * s, y - 4 * s, 9 * s, 5 * s, 2, '#26202e', O, 2);
  fillRR(x + 3 * s, y - 4 * s, 9 * s, 5 * s, 2, '#26202e', O, 2);
  circ(x, y - 58 * s, 14 * s, '#ffe9c9', O, 3); // face
  ell(x, y - 72 * s, 27 * s, 13 * s, '#d64545', O, 3); // mushroom cap
  ell(x, y - 72 * s, 27 * s, 13 * s, PAT.dotsRed);
  ell(x, y - 72 * s, 27 * s, 13 * s, null, O, 3);
  if (shout) { // angry brows + yelling mouth
    line(x - 9 * s, y - 64 * s, x - 3 * s, y - 60 * s, O, 2.5);
    line(x + 9 * s, y - 64 * s, x + 3 * s, y - 60 * s, O, 2.5);
    ell(x, y - 52 * s, 5 * s, 7 * s, '#7a2430', O, 2);
  } else {
    circ(x - 5 * s, y - 60 * s, 2 * s, O); circ(x + 5 * s, y - 60 * s, 2 * s, O);
    ell(x, y - 52 * s, 4 * s, 2.5 * s, '#7a2430', O, 1.5);
  }
}
function drawSchnitzel(x, y, s) {
  const O = OUTLINE;
  fillRR(x - 27 * s, y - 112 * s, 54 * s, 106 * s, 16, '#8b9099', O, 3.5);
  fillRR(x - 16 * s, y - 66 * s, 32 * s, 40 * s, 10, '#a7adb6', O, 2.5); // belly
  line(x - 18 * s, y - 96 * s, x - 6 * s, y - 84 * s, '#6b7078', 2); // rock cracks
  line(x + 14 * s, y - 100 * s, x + 20 * s, y - 86 * s, '#6b7078', 2);
  fillRR(x - 20 * s, y - 62 * s, 40 * s, 34 * s, 6, '#ffffff', O, 2.5); // apron
  circ(x - 9 * s, y - 92 * s, 4 * s, '#fff', O, 2); circ(x + 9 * s, y - 92 * s, 4 * s, '#fff', O, 2);
  circ(x - 9 * s, y - 92 * s, 1.6 * s, O); circ(x + 9 * s, y - 92 * s, 1.6 * s, O);
  line(x - 6 * s, y - 80 * s, x + 6 * s, y - 80 * s, O, 2.5); // flat mouth
  fillRR(x - 24 * s, y - 8 * s, 18 * s, 8 * s, 3, '#6b7078', O, 2);
  fillRR(x + 6 * s, y - 8 * s, 18 * s, 8 * s, 3, '#6b7078', O, 2);
}
function drawChowder(x, y, s) {
  const O = OUTLINE;
  ell(x + 22 * s, y - 16 * s, 8 * s, 5 * s, '#8a53b8', O, 2); // tail
  ell(x, y - 30 * s, 24 * s, 27 * s, '#9a5fc9', O, 3); // body
  rr(x - 22 * s, y - 40 * s, 44 * s, 32 * s, 10); // shirt, dots pattern
  ctx.fillStyle = PAT.dotsPink; ctx.fill(); ctx.strokeStyle = O; ctx.lineWidth = 2.5; ctx.stroke();
  fillRR(x - 14 * s, y - 7 * s, 11 * s, 7 * s, 3, '#7a48a3', O, 2);
  fillRR(x + 3 * s, y - 7 * s, 11 * s, 7 * s, 3, '#7a48a3', O, 2);
  ell(x - 14 * s, y - 84 * s, 7 * s, 13 * s, '#9a5fc9', O, 2.5); // ears
  ell(x + 14 * s, y - 84 * s, 7 * s, 13 * s, '#9a5fc9', O, 2.5);
  ell(x - 14 * s, y - 84 * s, 3.5 * s, 8 * s, '#e0b0e8'); ell(x + 14 * s, y - 84 * s, 3.5 * s, 8 * s, '#e0b0e8');
  circ(x, y - 66 * s, 22 * s, '#9a5fc9', O, 3); // head
  ell(x, y - 86 * s, 12 * s, 6 * s, '#7a48a3', O, 2.5); // hat
  circ(x + 8 * s, y - 92 * s, 4 * s, '#fff', O, 2);
  circ(x - 13 * s, y - 62 * s, 5 * s, '#e0b0e8'); circ(x + 13 * s, y - 62 * s, 5 * s, '#e0b0e8'); // cheeks
  circ(x - 7 * s, y - 70 * s, 3.5 * s, '#fff', O, 2); circ(x + 7 * s, y - 70 * s, 3.5 * s, '#fff', O, 2);
  circ(x - 7 * s, y - 70 * s, 1.5 * s, O); circ(x + 7 * s, y - 70 * s, 1.5 * s, O);
  ell(x, y - 57 * s, 6 * s, 4.5 * s, '#5c2f7e', O, 2); // mouth
  tri(x - 3 * s, y - 55 * s, x - 1 * s, y - 50 * s, x + 1 * s, y - 55 * s, '#fff', O, 1); // fang
}
function drawGazpacho(x, y, s) {
  const O = OUTLINE;
  fillRR(x - 36 * s, y - 100 * s, 72 * s, 94 * s, 22, '#7d90b8', O, 3.5);
  ell(x - 34 * s, y - 86 * s, 10 * s, 14 * s, '#7d90b8', O, 2.5); // ears
  ell(x + 34 * s, y - 86 * s, 10 * s, 14 * s, '#7d90b8', O, 2.5);
  ell(x, y - 78 * s, 9 * s, 18 * s, '#6d80a8', O, 2.5); // trunk
  tri(x - 16 * s, y - 72 * s, x - 10 * s, y - 60 * s, x - 6 * s, y - 72 * s, '#fff', O, 2); // tusks
  tri(x + 16 * s, y - 72 * s, x + 10 * s, y - 60 * s, x + 6 * s, y - 72 * s, '#fff', O, 2);
  circ(x - 13 * s, y - 92 * s, 4 * s, '#fff', O, 2); circ(x + 13 * s, y - 92 * s, 4 * s, '#fff', O, 2);
  circ(x - 13 * s, y - 92 * s, 1.6 * s, O); circ(x + 13 * s, y - 92 * s, 1.6 * s, O);
  rr(x - 26 * s, y - 56 * s, 52 * s, 40 * s, 8); // apron, brown dots
  ctx.fillStyle = PAT.dotsBrown; ctx.fill(); ctx.strokeStyle = O; ctx.lineWidth = 2.5; ctx.stroke();
  fillRR(x - 28 * s, y - 8 * s, 20 * s, 8 * s, 3, '#5d6c8e', O, 2);
  fillRR(x + 8 * s, y - 8 * s, 20 * s, 8 * s, 3, '#5d6c8e', O, 2);
}
function drawEndive(x, y, s) {
  const O = OUTLINE;
  tri(x - 26 * s, y, x + 26 * s, y, x, y - 84 * s, '#2e8f86', O, 3);
  tri(x - 26 * s, y, x + 26 * s, y, x, y - 84 * s, PAT.stripesTeal, O, 2.5);
  fillRR(x - 14 * s, y - 118 * s, 28 * s, 44 * s, 10, '#e8a23d', O, 3); // tall neck/body
  ell(x, y - 132 * s, 19 * s, 20 * s, '#f0b25a', O, 3); // head
  ell(x + 20 * s, y - 128 * s, 14 * s, 6 * s, '#e8a23d', O, 2.5); // long nose
  circ(x - 2 * s, y - 152 * s, 12 * s, '#c97b2d', O, 2.5); // hair swirl
  circ(x + 8 * s, y - 158 * s, 8 * s, '#c97b2d', O, 2.5);
  circ(x - 6 * s, y - 136 * s, 3.5 * s, '#fff', O, 2); circ(x - 6 * s, y - 136 * s, 1.5 * s, O);
  line(x - 12 * s, y - 142 * s, x - 16 * s, y - 146 * s, O, 2); // lashes
  line(x - 10 * s, y - 144 * s, x - 13 * s, y - 149 * s, O, 2);
  line(x - 8 * s, y - 122 * s, x + 6 * s, y - 122 * s, O, 2.5); // smug mouth
}
function drawPanini(x, y, s) {
  const O = OUTLINE;
  ell(x - 16 * s, y - 78 * s, 8 * s, 18 * s, '#f2a0c4', O, 2.5); // big ears
  ell(x + 16 * s, y - 78 * s, 8 * s, 18 * s, '#f2a0c4', O, 2.5);
  ell(x - 16 * s, y - 78 * s, 4 * s, 12 * s, '#e07ba8'); ell(x + 16 * s, y - 78 * s, 4 * s, 12 * s, '#e07ba8');
  ell(x, y - 26 * s, 20 * s, 24 * s, '#f2a0c4', O, 3); // body
  rr(x - 18 * s, y - 36 * s, 36 * s, 28 * s, 9); // dress
  ctx.fillStyle = PAT.dotsYellow; ctx.fill(); ctx.strokeStyle = O; ctx.lineWidth = 2.5; ctx.stroke();
  circ(x, y - 58 * s, 19 * s, '#f2a0c4', O, 3); // head
  circ(x - 7 * s, y - 62 * s, 5 * s, '#fff', O, 2); circ(x + 7 * s, y - 62 * s, 5 * s, '#fff', O, 2);
  circ(x - 7 * s, y - 62 * s, 2 * s, '#5a2a44'); circ(x + 7 * s, y - 62 * s, 2 * s, '#5a2a44');
  line(x - 11 * s, y - 68 * s, x - 14 * s, y - 71 * s, O, 1.5); // lashes
  line(x + 11 * s, y - 68 * s, x + 14 * s, y - 71 * s, O, 1.5);
  ell(x, y - 50 * s, 5 * s, 3 * s, '#a33d6e', O, 1.5); // smile
  circ(x + 18 * s, y - 66 * s, 4 * s, '#ff5d8f', O, 1.5); // heart-ish bow dot
}
const CUST_COLORS = ['#e86a5a', '#5ab8e8', '#7ec96a', '#e8c95a', '#b88ae8', '#e89ab0', '#6ad0c0', '#d99a4e'];
function drawCustomer(x, y, s, seed) {
  const O = OUTLINE;
  const c = CUST_COLORS[seed % CUST_COLORS.length];
  fillRR(x - 20 * s, y - 56 * s, 40 * s, 50 * s, 12, c, O, 3);
  circ(x, y - 72 * s, 18 * s, '#ffe0bd', O, 3);
  if (seed % 3 === 0) { fillRR(x - 12 * s, y - 98 * s, 24 * s, 12 * s, 4, c, O, 2.5); } // little hat
  else { ell(x, y - 88 * s, 10 * s, 5 * s, '#6b4a2f', O, 2); } // hair tuft
  circ(x - 6 * s, y - 74 * s, 3 * s, '#fff', O, 1.5); circ(x + 6 * s, y - 74 * s, 3 * s, '#fff', O, 1.5);
  circ(x - 6 * s, y - 74 * s, 1.3 * s, O); circ(x + 6 * s, y - 74 * s, 1.3 * s, O);
  ell(x, y - 64 * s, 4 * s, 2.5 * s, '#a35a4a', O, 1.5);
  fillRR(x - 14 * s, y - 6 * s, 10 * s, 6 * s, 2, '#444', O, 2);
  fillRR(x + 4 * s, y - 6 * s, 10 * s, 6 * s, 2, '#444', O, 2);
}
/* Portrait dispatcher for dialogue boxes */
function drawSpeaker(sp, x, y, s) {
  if (sp === 'mung') drawMung(x, y, s);
  else if (sp === 'truffles') drawTruffles(x, y, s, true);
  else if (sp === 'schnitzel') drawSchnitzel(x, y, s);
  else if (sp === 'chowder') drawChowder(x, y, s);
  else if (sp === 'gazpacho') drawGazpacho(x, y, s);
  else if (sp === 'endive') drawEndive(x, y, s);
  else if (sp === 'panini') drawPanini(x, y, s);
  else drawCustomer(x, y, s, 2);
}
const SPEAKER_NAMES = { mung: 'Mung Daal', truffles: 'Truffles', schnitzel: 'Schnitzel', chowder: 'Chowder', gazpacho: 'Gazpacho', endive: 'Ms. Endive', panini: 'Panini' };

/* ======================= 7. GAME DATA ===================== */
const INGREDIENTS = {
  flour:         { name: 'Flour',          price: 4,  color: '#f5efe0' },
  eggs:          { name: 'Eggs',           price: 4,  color: '#fff2c9' },
  sugar:         { name: 'Sugar',          price: 4,  color: '#ffffff' },
  fruit:         { name: 'Fruit',          price: 5,  color: '#ff7a59' },
  meat:          { name: 'Meat',           price: 8,  color: '#c96a5a' },
  grub:          { name: 'Grub',           price: 6,  color: '#8a9a5a' },
  thricecream:   { name: 'Thrice Cream',   price: 15, color: '#b0e8ff', rare: true },
  schmingerbread:{ name: 'Schmingerbread', price: 12, color: '#b57a3a', rare: true },
  blutter:       { name: 'Blutter',        price: 12, color: '#4a7ad9', rare: true },
  fizzleberries: { name: 'Fizzleberries',  price: 14, color: '#d94ad9', rare: true },
};
const RARE_IDS = Object.keys(INGREDIENTS).filter(k => INGREDIENTS[k].rare);

const RECIPES = [
  { id: 'fapple',    name: 'Froggy Apple Crumple Thumpkin', steps: ['chop', 'oven'],                 ings: ['fruit', 'fruit', 'flour'],              price: 18, unlock: {} },
  { id: 'grubcakes', name: 'Grubble Cakes',                 steps: ['stir', 'oven'],                 ings: ['grub', 'flour', 'eggs'],                price: 14, unlock: {} },
  { id: 'stew',      name: "Mung's Mystery Stew",           steps: ['chop', 'stir', 'stir'],         ings: ['meat', 'grub', 'fruit'],                price: 20, unlock: {} },
  { id: 'macarons',  name: 'Marzipan Macarons',             steps: ['stir', 'oven', 'plate'],        ings: ['flour', 'eggs', 'sugar'],               price: 22, unlock: {} },
  { id: 'biscuits',  name: 'Blutter Biscuits',              steps: ['stir', 'oven'],                 ings: ['blutter', 'flour'],                     price: 16, unlock: { stars: 3 } },
  { id: 'fizz',      name: 'Fizzleberry Fizz',              steps: ['chop', 'stir'],                 ings: ['fizzleberries', 'fruit'],               price: 18, unlock: { stars: 6 } },
  { id: 'pie',       name: 'Thrice Cream Pie',              steps: ['stir', 'oven', 'plate'],        ings: ['thricecream', 'flour', 'sugar'],        price: 30, unlock: { stars: 9 } },
  { id: 'cookies',   name: 'Schmingerbread Cookies',        steps: ['stir', 'oven'],                 ings: ['schmingerbread', 'flour'],              price: 24, unlock: { money: 150 } },
  { id: 'house',     name: 'Schmingerbread House',          steps: ['chop', 'oven', 'plate'],        ings: ['schmingerbread', 'sugar', 'blutter'],   price: 36, unlock: { stars: 12 } },
  { id: 'meatball',  name: "Big Ball o' Meat",              steps: ['chop', 'chop', 'stir', 'oven'], ings: ['meat', 'meat', 'grub'],                 price: 34, unlock: { stars: 15 } },
  { id: 'tart',      name: 'Fizzleberry Tart',              steps: ['chop', 'oven', 'plate'],        ings: ['fizzleberries', 'flour', 'sugar'],      price: 32, unlock: { stars: 18 } },
  { id: 'cake',      name: 'Thrice Cream Cake',             steps: ['stir', 'oven', 'stir', 'plate'],ings: ['thricecream', 'flour', 'eggs', 'sugar'],price: 44, unlock: { stars: 22 } },
  { id: 'potpie',    name: 'Puckerberry Pot Pie',           steps: ['chop', 'stir', 'oven', 'plate'],ings: ['meat', 'fruit', 'flour', 'blutter'],     price: 48, unlock: { money: 300 } },
  { id: 'supreme',   name: 'Thrice Cream Supreme',          steps: ['chop', 'stir', 'oven', 'stir', 'plate'], ings: ['thricecream', 'thricecream', 'fizzleberries', 'sugar'], price: 70, unlock: { rare: 'thricecream' } },
];
const STEP_NAMES = { chop: 'CHOP', stir: 'STIR', oven: 'OVEN', plate: 'PLATE' };
const STEP_COLORS = { chop: '#e86a5a', stir: '#5ab8e8', oven: '#f4a83d', plate: '#7ec96a' };

const CUSTOMER_NAMES = ['Chestnut', 'Ceviche', 'Gorgonzola', 'Rosemary', 'Kiwi', 'Stilton', 'Marmalade', 'Anchovies', 'Pesto', 'Pate'];
const SUBSTITUTES = [
  { name: 'A sock (clean-ish)', mod: [-18, -8] },
  { name: 'Grubble gum', mod: [-10, 0] },
  { name: 'Old boot leather', mod: [-20, -10] },
  { name: 'Mystery powder', mod: [-15, 10] },
  { name: 'Puckerberries', mod: [-5, 8] },
  { name: 'Concentrated whimsy', mod: [-8, 12] },
];
const UPGRADES = [
  { id: 'knives',   name: 'Sharp Knives',       desc: 'Slower, easier chopping marker.',      cost: 60,  max: 1 },
  { id: 'oven',     name: 'Turbo Oven',         desc: 'Faster bake, wider golden window.',    cost: 90,  max: 1 },
  { id: 'counter',  name: 'Bigger Counter',     desc: '+1 simultaneous order (2 tiers).',     cost: 110, max: 2 },
  { id: 'schnitzel',name: "Schnitzel's Station",desc: 'Auto-cooks a parallel dish.',          cost: 160, max: 1 },
];

/* ========================= 8. STATE ======================= */
const G = {
  screen: 'title',
  day: 1, money: 50, totalEarned: 0, stars: 0,
  inv: {},                 // ingredient id -> count
  jobs: [],                // today's recipes
  orders: [], spawnQueue: [], spawnIdx: 0, spawnTimer: 0,
  active: null,            // selected order in service
  spentToday: 0, budget: 62, budgetWarned: false,
  friends: {},             // stall id -> purchase count
  upgrades: { knives: 0, oven: 0, counter: 0, schnitzel: 0 },
  unlockedRare: {},        // rare ingredient ids ever bought
  player: { x: 480, y: 420, char: 'chowder', walk: 0 },
  stalls: [], nearStall: null,
  dayStats: null,
  dialog: [], dlgIdx: 0,
  overlay: null,           // {type:'mg'|'event'|'warn'|'prompt'|'shop'|'budget'}
  toasts: [],
  chaosTimer: 15,
  shOrder: null, shTimer: 0,   // Schnitzel auto-station
  muted: false,
  touchUI: ('ontouchstart' in window) || navigator.maxTouchPoints > 0,
  bookOpen: false, bookPage: 0,
  evStars: 0, evLines: [],
  helpFrom: 'title',
};
function toast(str, color) { G.toasts.push({ str, t: 2.6, color: color || '#fff' }); }
function recipeById(id) { return RECIPES.find(r => r.id === id); }
function isUnlocked(r) {
  const u = r.unlock;
  if (u.stars !== undefined && G.stars < u.stars) return false;
  if (u.money !== undefined && G.totalEarned < u.money) return false;
  if (u.rare !== undefined && !G.unlockedRare[u.rare]) return false;
  return true;
}
function unlockText(r) {
  const u = r.unlock;
  if (u.stars !== undefined) return 'Unlock: ' + u.stars + ' total stars';
  if (u.money !== undefined) return 'Unlock: $' + u.money + ' lifetime earnings';
  if (u.rare !== undefined) return 'Unlock: buy ' + INGREDIENTS[u.rare].name;
  return '';
}
function specialDay() { return G.day % 5 === 0; }
function specialTheme() {
  return ['Thrice Cream Festival', "Ms. Endive's Cook-Off", "Gangster's Party"][Math.floor(G.day / 5 - 1) % 3];
}
function maxSlots() { return 2 + G.upgrades.counter; }
function activeOrders() { return G.orders.filter(o => o.state === 'waiting' || o.state === 'cooking'); }

/* ================== 9. TITLE & HELP ======================= */
function updateTitle() {
  if (pressed.has('enter')) { sfx.click(); startMorning(); }
  if (pressed.has('h')) { G.helpFrom = 'title'; G.screen = 'help'; }
}
function drawTitle(t) {
  if (!use3D) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#5a3d8a'); g.addColorStop(1, '#2c1e4a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 24; i++) circ((i * 173 + 40) % W, (i * 97 + 30) % H, 3 + (i % 3) * 2, 'rgba(255,255,255,0.12)');
    const bob = Math.sin(t / 400) * 6;
    drawMung(200, 480 + bob * 0.3, 1.25);
    drawChowder(770, 500 + bob, 1.1);
    drawTruffles(640, 500 - bob * 0.5, 0.9, false);
    drawSchnitzel(90, 500, 1.0);
  }
  text("MUNG DAAL'S", W / 2, 150, 64, '#ffd94a');
  text('CATERING CO.', W / 2, 220, 64, '#ff9a3d');
  text('"You take the moon and you take the sun..." — catering, mostly.', W / 2, 275, 16, '#d9c9f0');
  btn('start', W / 2 - 130, 330, 260, 56, 'START  (Enter)');
  btn('help', W / 2 - 90, 400, 180, 44, 'HELP  (H)', { color: '#7ec96a' });
  btn('touchTog', W - 220, H - 46, 200, 34, 'TOUCH UI: ' + (G.touchUI ? 'ON' : 'OFF'), { color: '#5ab8e8', size: 14 });
  text('A completely unofficial fan game. No food was wasted. Much.', W / 2, 560, 13, '#a08fc0');
  text('M = mute (' + (G.muted ? 'muted' : 'sound on') + ')', W / 2, 582, 13, '#a08fc0');
  const c = clickedBtn();
  if (c === 'start') { sfx.click(); startMorning(); }
  if (c === 'help') { sfx.click(); G.helpFrom = 'title'; G.screen = 'help'; }
  if (c === 'touchTog') { sfx.click(); G.touchUI = !G.touchUI; }
}
const HELP_LINES = [
  ['GOAL', 'Run Mung Daal\'s catering company: buy ingredients, cook orders, get rich(ish).'],
  ['', ''],
  ['EACH DAY', '1. MORNING — Mung announces jobs (Space/click to advance dialogue).'],
  ['', '2. MARKET — Walk with WASD/arrows. E or Space to shop at a stall. TAB switches'],
  ['', '   between Chowder and Schnitzel (Schnitzel walks faster). Buy what the jobs need!'],
  ['', '3. SERVICE — Click an order ticket (or press 1-5) to work it. Do each step:'],
  ['', '   CHOP: press Space when the marker is in the green zone (4 rounds).'],
  ['', '   STIR: circle the mouse around the pot at a steady speed (or hold <- / ->).'],
  ['', '   OVEN: press Space while the meter is in the golden window.'],
  ['', '   PLATE: drag each item onto its matching colored ghost. Click Serve.'],
  ['', '   Botched a step? Serve it anyway (lower tip) or bin it and redo the dish.'],
  ['', '4. EVENING — Tally, star rating, buy upgrades, browse the recipe book.'],
  ['', ''],
  ['CHOWDER!', 'Random chaos strikes during service. Truffles will yell. You have been warned.'],
  ['', ''],
  ['KEYS', 'Space/E interact · Tab switch character · M mute · Esc close panels · Enter confirm'],
];
function updateHelp() {
  const c = clickedBtn();
  if (c === 'touchTog') { sfx.click(); G.touchUI = !G.touchUI; return; }
  if (pressed.has('escape') || pressed.has('enter') || c) { sfx.click(); G.screen = G.helpFrom; }
}
function drawHelp() {
  ctx.fillStyle = '#2c1e4a'; ctx.fillRect(0, 0, W, H);
  fillRR(80, 40, W - 160, H - 110, 16, '#fdf6e3', OUTLINE, 4);
  text('HOW TO CATER', W / 2, 75, 34, '#b8433a');
  let y = 115;
  for (const [h, lineTxt] of HELP_LINES) {
    if (h) text(h, 140, y, 15, '#7a48a3', 'left');
    if (lineTxt) text(lineTxt, 260, y, 14, '#333', 'left', false);
    y += 24;
  }
  btn('back', W / 2 - 80, H - 105, 160, 42, 'BACK (Esc)');
  btn('touchTog', W / 2 + 110, H - 105, 200, 42, 'TOUCH UI: ' + (G.touchUI ? 'ON' : 'OFF'), { color: '#5ab8e8', size: 14 });
  drawChowder(110, H - 60, 0.7);
  drawMung(W - 110, H - 55, 0.7);
}

/* ==================== 10. MORNING ========================= */
function pickJobs() {
  const avail = RECIPES.filter(isUnlocked);
  const n = specialDay() ? 5 : randi(2, 4);
  const pool = shuffle(avail.slice());
  const jobs = [];
  for (let i = 0; i < n; i++) jobs.push(pool[i % pool.length]);
  return jobs;
}
function startMorning() {
  G.dayStats = { earned: 0, tips: 0, qualities: [], completed: 0, failed: 0 };
  G.spentToday = 0; G.budgetWarned = false;
  G.budget = 50 + G.day * 12;
  G.jobs = pickJobs();
  const d = [];
  if (specialDay()) {
    d.push({ sp: 'mung', t: 'Chowder! Truffles! Big news — today is the ' + specialTheme() + '! Huge crowds, huge tips, huge potential for disaster!' });
    d.push({ sp: 'truffles', t: 'Which means HUGE spending limits too. Budget: $' + G.budget + '. Do NOT make me come over there.' });
  } else {
    d.push({ sp: 'mung', t: choice([
      'Good morning, catering crew! Day ' + G.day + ". Another day, another chance to cook things that technically count as food!",
      'Rise and shine! Day ' + G.day + '. I had a dream about blutter again. Anyway — jobs!',
      'Day ' + G.day + "! Remember our motto: if the customer can't identify it, it's gourmet.",
    ]) });
    d.push({ sp: 'truffles', t: 'Budget today: $' + G.budget + '. Spend past it and you will hear about it. Loudly. From me.' });
  }
  const jobDesc = G.jobs.map(r => r.name).join(', ');
  d.push({ sp: 'mung', t: "Today's orders: " + jobDesc + '. Check the recipes, hit the market, buy what we need!' });
  if (G.day === 1) d.push({ sp: 'schnitzel', t: 'Radda radda. (He says the market is WASD + E to shop. He communicates in tutorial.)' });
  if (specialDay() && specialTheme().includes('Endive')) d.push({ sp: 'endive', t: 'Mung Daal. I will be watching your little catering operation today. Do try not to embarrass Marzipan City.' });
  d.push({ sp: 'chowder', t: choice(['I\'m helping!', 'Can I have a snack before we start? And during? And after?', 'I promise not to eat the ingredients this time. The IMPORTANT ones, anyway.']) });
  G.dialog = d; G.dlgIdx = 0;
  G.screen = 'morning';
}
function updateMorning() {
  if (pressed.has(' ') || pressed.has('enter') || frameClicks.length) {
    sfx.pop();
    G.dlgIdx++;
    if (G.dlgIdx >= G.dialog.length) startMarket();
  }
}
function drawMorning() {
  if (!use3D) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#ffd98a'); g.addColorStop(1, '#f4a83d');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // kitchen backdrop
    fillRR(0, 380, W, 220, 0, '#b8433a');
    fillRR(60, 300, 220, 100, 10, '#7a5230', OUTLINE, 3);
    fillRR(680, 290, 220, 110, 10, '#7a5230', OUTLINE, 3);
    drawMung(280, 400, 1.3);
    drawTruffles(700, 410, 1.0, true);
    drawChowder(560, 430, 0.95);
  }
  const d = G.dialog[G.dlgIdx];
  // dialogue box
  fillRR(60, 440, W - 120, 130, 14, '#fdf6e3', OUTLINE, 4);
  drawSpeaker(d.sp, 130, 540, 0.72);
  text(SPEAKER_NAMES[d.sp] || '???', 200, 470, 16, '#b8433a', 'left');
  const lines = wrapText(d.t, 620, 17);
  lines.forEach((l, i) => text(l, 200, 500 + i * 24, 17, '#333', 'left', false));
  text((G.touchUI ? 'Tap to continue  ' : 'Space / click to continue  ') + '(' + (G.dlgIdx + 1) + '/' + G.dialog.length + ')', W - 200, 555, 13, '#8a7a6a');
  drawTopBar('MORNING');
}

/* ===================== 11. MARKET ========================= */
function buildMarket() {
  const rareToday = shuffle(RARE_IDS.slice()).slice(0, 3);
  G.stalls = [
    { id: 'mevel', name: "Mevel's Basics", x: 130, vendorSeed: 1, items: ['flour', 'eggs', 'sugar', 'fruit'] },
    { id: 'grubguy', name: 'Grub Hub', x: 350, vendorSeed: 4, items: ['meat', 'grub', 'eggs', 'fruit'] },
    { id: 'fiona', name: "Fiona's Fancy Goods", x: 570, vendorSeed: 6, items: [rareToday[0], rareToday[1]] },
    { id: 'gazpacho', name: "Gazpacho's Stand", x: 790, vendorSeed: -1, items: [rareToday[2]], mystery: true },
  ];
}
function startMarket() {
  buildMarket();
  G.player.x = 480; G.player.y = 430;
  G.screen = 'market';
  toast('Buy ingredients for today\'s jobs, then start service on the right!', '#ffd94a');
}
function stallDiscount(s) {
  const n = G.friends[s.id] || 0;
  return Math.min(0.2, Math.floor(n / 3) * 0.1);
}
function buyItem(stall, ingId) {
  const ing = INGREDIENTS[ingId];
  const price = Math.max(1, Math.round(ing.price * (1 - stallDiscount(stall))));
  if (G.money < price) { sfx.bad(); toast('Not enough money!', '#ff7a7a'); return; }
  G.money -= price; G.spentToday += price;
  G.inv[ingId] = (G.inv[ingId] || 0) + 1;
  G.friends[stall.id] = (G.friends[stall.id] || 0) + 1;
  if (ing.rare) G.unlockedRare[ingId] = true;
  sfx.coin();
  toast('Bought ' + ing.name + ' ($' + price + ')', '#b0ffb0');
  if (!G.budgetWarned && G.spentToday > G.budget) {
    G.budgetWarned = true;
    G.overlay = { type: 'budget' };
    sfx.alarm();
  }
}
function buyMystery(stall) {
  const price = 10;
  if (G.money < price) { sfx.bad(); toast('Not enough money!', '#ff7a7a'); return; }
  G.money -= price; G.spentToday += price;
  G.friends[stall.id] = (G.friends[stall.id] || 0) + 1;
  if (Math.random() < 0.55) {
    const id = choice(RARE_IDS);
    G.inv[id] = (G.inv[id] || 0) + 1;
    G.unlockedRare[id] = true;
    sfx.good();
    toast('Mystery box: ' + INGREDIENTS[id].name + '! Totally legit!', '#ffd94a');
  } else {
    sfx.bad();
    toast(choice(["It's... an old sock.", "It's a jar of 'pickled nothing'.", "It's lint. Fancy lint, Gazpacho insists.", "It's a rock shaped like a smaller rock."]), '#ff9a9a');
  }
  if (!G.budgetWarned && G.spentToday > G.budget) {
    G.budgetWarned = true;
    G.overlay = { type: 'budget' };
    sfx.alarm();
  }
}
function updateMarket(dt) {
  if (G.overlay) { updateOverlay(dt); return; }
  const p = G.player;
  if (pressed.has('tab')) { p.char = p.char === 'chowder' ? 'schnitzel' : 'chowder'; sfx.pop(); toast(p.char === 'schnitzel' ? 'Radda! (Schnitzel carries more, walks faster)' : 'Chowder time!', '#d9c9f0'); }
  const spd = (p.char === 'schnitzel' ? 260 : 190) * dt;
  let moved = false;
  if (keys['arrowleft'] || keys['a']) { p.x -= spd; moved = true; }
  if (keys['arrowright'] || keys['d']) { p.x += spd; moved = true; }
  if (keys['arrowup'] || keys['w']) { p.y -= spd; moved = true; }
  if (keys['arrowdown'] || keys['s']) { p.y += spd; moved = true; }
  if (joy.id !== null && (joy.dx !== 0 || joy.dy !== 0)) { // virtual joystick
    p.x += joy.dx * spd; p.y += joy.dy * spd; moved = true;
  }
  p.x = clamp(p.x, 40, W - 40); p.y = clamp(p.y, 270, H - 40);
  if (moved) p.walk += dt * 10;
  // nearest stall / exit
  G.nearStall = null;
  for (const s of G.stalls) {
    if (Math.abs(p.x - s.x) < 85 && p.y < 400) { G.nearStall = s; break; }
  }
  const nearExit = p.x > W - 130;
  if (pressed.has('e') || pressed.has(' ')) {
    if (G.nearStall) { sfx.click(); G.overlay = { type: 'shop', stall: G.nearStall }; }
    else if (nearExit) { sfx.click(); startService(); }
  }
  if (nearExit) G.nearStall = 'exit';
}
function drawMarket() {
  if (!use3D) {
    // sky + ground
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#8ad4f4'); g.addColorStop(0.5, '#c9ecff'); g.addColorStop(0.5, '#9a7ab8'); g.addColorStop(1, '#7a5a9a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // Marzipan City buildings
    for (let i = 0; i < 7; i++) {
      const bx = i * 150 + 20, bh = 90 + (i % 3) * 40;
      fillRR(bx, 250 - bh, 110, bh, 8, ['#e89ab0', '#7ec96a', '#e8c95a', '#5ab8e8'][i % 4], OUTLINE, 3);
      for (let wx = 0; wx < 2; wx++) for (let wy = 0; wy < Math.floor(bh / 45); wy++)
        fillRR(bx + 18 + wx * 45, 250 - bh + 15 + wy * 45, 24, 26, 4, '#fdf6e3', OUTLINE, 2);
    }
    fillRR(0, 248, W, 14, 0, '#5a3d6a');
    text('MARZIPAN CITY MARKET', W / 2, 235, 18, '#fff');
    // stalls
    for (const s of G.stalls) {
      fillRR(s.x - 85, 330, 170, 60, 8, '#c98a4a', OUTLINE, 3);       // counter
      fillRR(s.x - 95, 300, 190, 26, 8, ['#d64545', '#2e8f86', '#7a48a3', '#e8a23d'][G.stalls.indexOf(s) % 4], OUTLINE, 3); // awning
      if (s.id === 'gazpacho') drawGazpacho(s.x, 330, 0.62);
      else drawCustomer(s.x, 330, 0.62, s.vendorSeed);
      text(s.name, s.x, 365, 13, '#fff');
      const d = stallDiscount(s);
      if (d > 0) text('friend discount -' + (d * 100) + '%', s.x, 384, 11, '#ffd94a');
      if (G.nearStall === s) {
        fillRR(s.x - 70, 268, 140, 26, 8, '#ffd94a', OUTLINE, 2.5);
        text('Press E to shop', s.x, 282, 13, OUTLINE);
      }
    }
    // start-service exit
    fillRR(W - 130, 380, 130, 220, 10, '#b8433a', OUTLINE, 4);
    drawMung(W - 65, 470, 0.6);
    text('START', W - 65, 500, 20, '#fff');
    text('SERVICE', W - 65, 522, 20, '#fff');
    text('(walk here + E)', W - 65, 545, 11, '#ffd0c0');
    if (G.nearStall === 'exit') {
      fillRR(W - 200, 340, 150, 26, 8, '#ffd94a', OUTLINE, 2.5);
      text('Press E: begin!', W - 125, 354, 13, OUTLINE);
    }
    // player
    const bob = Math.sin(G.player.walk) * 3;
    if (G.player.char === 'chowder') drawChowder(G.player.x, G.player.y + bob, 0.8);
    else drawSchnitzel(G.player.x, G.player.y + bob, 0.7);
  } else {
    // 3D mode: prompts float at the bottom center (world is rendered by world3d.js)
    const act = G.touchUI ? 'Tap USE' : 'Press E';
    if (G.nearStall && G.nearStall !== 'exit') {
      fillRR(W / 2 - 170, H - 60, 340, 34, 10, '#ffd94a', OUTLINE, 3);
      text(act + ': shop at ' + G.nearStall.name, W / 2, H - 42, 15, OUTLINE);
    } else if (G.nearStall === 'exit') {
      fillRR(W / 2 - 170, H - 60, 340, 34, 10, '#ffd94a', OUTLINE, 3);
      text(act + ': START SERVICE!', W / 2, H - 42, 15, OUTLINE);
    }
    fillRR(W / 2 - 200, 46, 400, 22, 8, 'rgba(253,246,227,0.85)', null);
  }
  // HUD: inventory strip
  fillRR(10, 400, 180, 190, 10, 'rgba(20,10,40,0.75)', OUTLINE, 2);
  text('PANTRY', 100, 416, 14, '#ffd94a');
  let iy = 436;
  for (const id of Object.keys(INGREDIENTS)) {
    const n = G.inv[id] || 0;
    circ(26, iy - 1, 5, INGREDIENTS[id].color, OUTLINE, 1.5);
    text(INGREDIENTS[id].name + ' x' + n, 36, iy, 11, n > 0 ? '#fff' : '#776a8a', 'left', false);
    iy += 17;
  }
  drawTopBar('MARKET');
  text('Day jobs: ' + G.jobs.map(r => r.name).join(', '), W / 2, 58, 13, '#3a2a4a');
}

/* ===================== 12. SERVICE ======================== */
function startService() {
  G.orders = []; G.spawnQueue = []; G.spawnIdx = 0; G.spawnTimer = 0.5;
  G.active = null; G.shOrder = null; G.shTimer = 0;
  G.chaosTimer = rand(13, 19);
  const mult = specialDay() ? 1.5 : 1;
  for (const r of G.jobs) G.spawnQueue.push(r);
  if (specialDay()) G.spawnQueue.push(choice(G.jobs), choice(G.jobs)); // extra rush
  G.screen = 'service';
  toast('Service begins! Click a ticket, then cook!', '#ffd94a');
  void mult;
}
function spawnOrder() {
  const r = G.spawnQueue[G.spawnIdx++];
  const steps = r.steps.length;
  const o = {
    id: Math.random().toString(36).slice(2, 7),
    recipe: r,
    cust: choice(CUSTOMER_NAMES),
    seed: randi(0, 99),
    t: 45 + steps * 13,
    maxT: 45 + steps * 13,
    state: 'waiting',      // waiting | cooking
    started: false, step: 0, qualities: [], improv: 0, bonus: 0,
    panini: 0, bySchnitzel: false,
    price: Math.round(r.price * (specialDay() ? 1.5 : 1)),
  };
  G.orders.push(o);
  sfx.pop();
  if (!G.active) G.active = o;
}
function startDish(o) {
  o.started = true; o.state = 'cooking';
  o.improv = 0;
  for (const id of o.recipe.ings) {
    if ((G.inv[id] || 0) > 0) G.inv[id]--;
    else o.improv++;
  }
  if (o.improv > 0) toast('Missing ' + o.improv + ' ingredient(s) — improvising! (-' + o.improv * 10 + ' quality)', '#ff9a9a');
  sfx.click();
}
function orderQuality(o) {
  const avg = o.qualities.length ? o.qualities.reduce((a, b) => a + b, 0) / o.qualities.length : 0;
  return clamp(Math.round(avg - o.improv * 10 + o.bonus), 3, 100);
}
function finishOrder(o) {
  const q = orderQuality(o);
  const pay = Math.round(o.price * (0.4 + 0.8 * q / 100));
  const tip = q >= 75 ? Math.round(o.price * 0.4 * (q - 70) / 30) : 0;
  G.money += pay + tip; G.totalEarned += pay + tip;
  G.dayStats.earned += pay; G.dayStats.tips += tip;
  G.dayStats.qualities.push(q); G.dayStats.completed++;
  removeOrder(o);
  sfx.coin();
  toast(o.cust + ': ' + (q >= 85 ? '"MAGNIFICENT!"' : q >= 65 ? '"Pretty tasty!"' : q >= 45 ? '"It\'s... edible."' : '"Is this legal?"') + '  +$' + pay + (tip ? ' (tip $' + tip + ')' : ''), q >= 65 ? '#b0ffb0' : '#ffd0a0');
  if (q >= 85 && Math.random() < 0.5) { toast('Schnitzel: "Radda radda!"', '#c9c9d9'); }
}
function failOrder(o, why) {
  G.dayStats.failed++;
  removeOrder(o);
  sfx.bad();
  toast(o.cust + ' left angry! (' + why + ')', '#ff7a7a');
}
function removeOrder(o) {
  G.orders = G.orders.filter(x => x !== o);
  if (G.shOrder === o) { G.shOrder = null; G.shTimer = 0; }
  if (G.active === o) G.active = activeOrders()[0] || null;
}
function startMinigame(o) {
  const kind = o.recipe.steps[o.step];
  G.overlay = { type: 'mg', kind, o };
  initMG(G.overlay);
  sfx.click();
}
function finishStep(o, q) {
  o.qualities.push(Math.round(q));
  if (q < 50) {
    G.overlay = { type: 'prompt', o, q: Math.round(q) };
    sfx.bad();
  } else {
    advanceStep(o);
  }
}
function advanceStep(o) {
  o.step++;
  G.overlay = null;
  sfx.good();
  if (o.bySchnitzel) { /* schnitzel loop continues in update */ }
  else if (o.step >= o.recipe.steps.length) finishOrder(o);
}
function updateService(dt) {
  if (G.overlay) { updateOverlay(dt); return; }
  // spawn orders staggered, limited by counter slots
  if (G.spawnIdx < G.spawnQueue.length) {
    G.spawnTimer -= dt;
    if (G.spawnTimer <= 0 && activeOrders().length < maxSlots()) {
      spawnOrder();
      G.spawnTimer = specialDay() ? 5 : 7;
    }
  }
  // timers
  for (const o of G.orders.slice()) {
    if (o.state !== 'waiting' && o.state !== 'cooking') continue;
    let rate = (o === G.active) ? 0.45 : 1;
    if (o.panini > 0) { o.panini -= dt; rate *= 2.2; }
    o.t -= dt * rate;
    if (o.t <= 0) failOrder(o, 'ran out of patience');
  }
  // Schnitzel auto-station
  if (G.upgrades.schnitzel > 0) {
    if (!G.shOrder) {
      const cand = activeOrders().find(o => o !== G.active && !o.bySchnitzel);
      if (cand) { cand.bySchnitzel = true; if (!cand.started) startDish(cand); G.shOrder = cand; G.shTimer = 0; toast('Schnitzel: "Radda." (He\'s on it.)', '#c9c9d9'); }
    } else {
      G.shTimer += dt;
      if (G.shTimer >= 4.5) {
        G.shTimer = 0;
        const o = G.shOrder;
        o.qualities.push(randi(58, 82)); o.step++;
        sfx.pop();
        if (o.step >= o.recipe.steps.length) finishOrder(o);
      }
    }
  }
  // The Chowder Factor
  if (activeOrders().length > 0) {
    G.chaosTimer -= dt;
    if (G.chaosTimer <= 0) triggerChaos();
  }
  // selection
  const act = activeOrders();
  for (let i = 0; i < Math.min(act.length, 9); i++) {
    if (pressed.has(String(i + 1))) { G.active = act[i]; sfx.pop(); }
  }
  const c = clickedBtn();
  if (c && c.startsWith('ticket:')) {
    const o = G.orders.find(x => x.id === c.slice(7));
    if (o) { G.active = o; sfx.pop(); }
  }
  if (c === 'endService') {
    for (const o of activeOrders()) failOrder(o, 'service ended early');
    startEvening();
    return;
  }
  const o = G.active;
  if (o && !o.bySchnitzel) {
    if (!o.started) {
      if (c === 'startDish' || pressed.has('enter') || pressed.has(' ')) startDish(o);
    } else if (o.step < o.recipe.steps.length) {
      if (c === 'doStep' || pressed.has(' ')) startMinigame(o);
    }
  }
  // end of service
  if (G.spawnIdx >= G.spawnQueue.length && activeOrders().length === 0) startEvening();
}
function drawService() {
  if (!use3D) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#f7e8c9'); g.addColorStop(1, '#e8c98a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // kitchen counter backdrop
    fillRR(0, 300, W, 300, 0, '#b8433a');
    fillRR(0, 300, W, 18, 0, '#8a2f2a');
    // oven prop
    fillRR(30, 330, 100, 130, 10, '#5a5566', OUTLINE, 3);
    fillRR(42, 350, 76, 60, 6, '#ffb35a', OUTLINE, 2.5);
    drawMung(162, 470, 0.85);
    drawTruffles(W - 70, 470, 0.7, false);
    text('$' + G.money, W - 70, 495, 15, '#2e6b2e');
  }
  if (G.upgrades.schnitzel > 0) {
    if (!use3D) {
      drawSchnitzel(80, 300, 0.55);
      text('Radda station', 80, 300 - 75, 11, '#5a5566');
    }
    if (G.shOrder) {
      fillRR(30, 210, 100, 10, 4, use3D ? '#fdf6e3' : '#333', null);
      fillRR(30, 210, 100 * (G.shTimer / 4.5), 10, 4, '#7ec96a', null);
    }
  }
  drawTopBar('SERVICE');
  // ---- order tickets ----
  const act = activeOrders();
  act.forEach((o, i) => {
    const x = 20 + i * 186, y = 60, w = 176, h = 86;
    const sel = o === G.active;
    fillRR(x, y, w, h, 8, o.panini > 0 ? '#f7c9e0' : sel ? '#fff8dc' : '#fdf6e3', sel ? '#d64545' : OUTLINE, sel ? 4 : 2.5);
    drawCustomer(x + 24, y + 62, 0.45, o.seed);
    text(o.cust, x + 48, y + 16, 13, OUTLINE, 'left');
    text(o.recipe.name, x + 48, y + 34, 11, '#5a4a3a', 'left', false);
    // timer bar
    const frac = clamp(o.t / o.maxT, 0, 1);
    fillRR(x + 8, y + h - 16, w - 16, 9, 4, '#ccc', null);
    fillRR(x + 8, y + h - 16, (w - 16) * frac, 9, 4, frac > 0.5 ? '#7ec96a' : frac > 0.25 ? '#f4a83d' : '#e85a5a', null);
    text((i + 1) + '', x + w - 14, y + 14, 13, '#8a7a6a');
    if (o.bySchnitzel) text('RADDA', x + w - 34, y + h - 28, 10, '#5a5566');
    btn('ticket:' + o.id, x, y, w, h, '', { color: 'rgba(0,0,0,0)', hcolor: 'rgba(255,255,255,0.15)' });
  });
  const waiting = G.spawnQueue.length - G.spawnIdx;
  if (waiting > 0) text('+' + waiting + ' more in queue', W - 120, 75, 13, '#5a4a3a');
  // chaos countdown hint
  text('Chowder is... somewhere.', W - 120, 95, 11, '#a08a6a', 'center', false);
  // ---- active dish panel ----
  fillRR(180, 380, 600, 200, 14, '#fdf6e3', OUTLINE, 4);
  const o = G.active;
  if (!o) {
    text('No order selected. Click a ticket!', 480, 480, 18, '#8a7a6a');
  } else {
    text(o.recipe.name + '  for  ' + o.cust, 480, 405, 20, '#b8433a');
    // ingredients
    let ix = 220;
    text('Needs:', ix, 432, 13, '#5a4a3a', 'left');
    ix += 50;
    const counts = {};
    o.recipe.ings.forEach(id => counts[id] = (counts[id] || 0) + 1);
    for (const id of Object.keys(counts)) {
      circ(ix + 7, 431, 6, INGREDIENTS[id].color, OUTLINE, 1.5);
      text(INGREDIENTS[id].name + (counts[id] > 1 ? ' x' + counts[id] : ''), ix + 16, 432, 11, o.started ? '#8a7a6a' : ((G.inv[id] || 0) >= counts[id] ? '#2e6b2e' : '#c0392b'), 'left', false);
      ix += 34 + ctx.measureText(INGREDIENTS[id].name).width + 14;
    }
    // steps
    let sx = 480 - o.recipe.steps.length * 52 + 52;
    o.recipe.steps.forEach((st, i) => {
      const done = i < o.qualities.length;
      const cur = o.started && i === o.step;
      fillRR(sx - 42, 455, 84, 46, 8, done ? '#b0e8b0' : cur ? STEP_COLORS[st] : '#ddd5c9', cur ? OUTLINE : '#8a7a6a', cur ? 3.5 : 2);
      text(STEP_NAMES[st], sx, 472, 13, done ? '#2e6b2e' : cur ? OUTLINE : '#8a7a6a');
      if (done) text(o.qualities[i] + '', sx, 490, 12, '#2e6b2e');
      sx += 104;
    });
    if (o.bySchnitzel) {
      text('Schnitzel is handling this one. Radda.', 480, 540, 16, '#5a5566');
    } else if (!o.started) {
      btn('startDish', 380, 520, 200, 44, 'START COOKING (Enter)');
    } else if (o.step < o.recipe.steps.length) {
      const st = o.recipe.steps[o.step];
      btn('doStep', 355, 520, 250, 44, 'DO STEP: ' + STEP_NAMES[st] + ' (Space)', { color: STEP_COLORS[st] });
    }
  }
  btn('endService', W - 130, 560, 115, 30, 'End Service', { color: '#c96a5a', size: 13 });
}

/* ===================== 13. MINI-GAMES ===================== */
function initMG(mg) {
  if (mg.kind === 'chop') {
    mg.round = 0; mg.hits = 0; mg.pos = 0.5; mg.dir = 1;
    mg.speed = G.upgrades.knives ? 0.55 : 0.8;
    mg.zone = { c: rand(0.25, 0.75), w: 0.14 };
    mg.rt = 2.8;
  } else if (mg.kind === 'stir') {
    mg.prog = 0; mg.burn = 0; mg.prevA = null; mg.speed = 0;
  } else if (mg.kind === 'oven') {
    mg.m = 0;
    mg.rise = G.upgrades.oven ? 62 : 42;
    mg.win = G.upgrades.oven ? [52, 86] : [62, 84];
  } else if (mg.kind === 'plate') {
    const n = 3 + Math.min(2, Math.floor(mg.o.recipe.price / 22));
    const cols = mg.o.recipe.ings.map(id => INGREDIENTS[id].color);
    mg.items = [];
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + i * (Math.PI * 2 / n);
      mg.items.push({
        color: cols[i % cols.length],
        tx: 480 + Math.cos(a) * 62, ty: 300 + Math.sin(a) * 62,
        x: 240 + i * 120, y: 515, placed: false, drag: false,
      });
    }
  }
}
function updateMG(dt) {
  const mg = G.overlay, o = mg.o;
  if (mg.kind === 'chop') {
    mg.pos += mg.dir * mg.speed * dt;
    if (mg.pos > 1) { mg.pos = 1; mg.dir = -1; }
    if (mg.pos < 0) { mg.pos = 0; mg.dir = 1; }
    mg.rt -= dt;
    let verdict = null;
    if (pressed.has(' ') || (G.touchUI && frameClicks.length)) { // Space / CHOP! button / tap anywhere
      const hit = Math.abs(mg.pos - mg.zone.c) <= mg.zone.w / 2;
      if (hit) { mg.hits++; sfx.chop(); } else sfx.bad();
      verdict = true;
    } else if (mg.rt <= 0) { sfx.bad(); verdict = true; }
    if (verdict) {
      mg.round++;
      mg.zone = { c: rand(0.22, 0.78), w: 0.14 };
      mg.rt = 2.8;
      if (mg.round >= 4) {
        const q = mg.hits / 4 * 100;
        if (q === 100) toast('Schnitzel: "Radda radda!" (perfect chopping)', '#c9c9d9');
        finishStep(o, q);
      }
    }
  } else if (mg.kind === 'stir') {
    const cx = 480, cy = 300;
    let dA = 0;
    const a = Math.atan2(mouse.y - cy, mouse.x - cx);
    if (mg.prevA !== null) {
      dA = a - mg.prevA;
      while (dA > Math.PI) dA -= Math.PI * 2;
      while (dA < -Math.PI) dA += Math.PI * 2;
    }
    mg.prevA = a;
    if (keys['arrowleft'] || keys['arrowright']) dA += 4.5 * dt; // keyboard fallback
    mg.speed = mg.speed * 0.85 + Math.abs(dA) / Math.max(dt, 0.001) * 0.15;
    const inBand = mg.speed >= 2.0 && mg.speed <= 8.0;
    if (inBand) { mg.prog += dt * 20; mg.burn = Math.max(0, mg.burn - dt * 6); }
    else mg.burn += dt * (mg.speed < 0.3 ? 5 : 11);
    if (mg.prog >= 100) finishStep(o, clamp(100 - mg.burn, 5, 100));
    else if (mg.burn >= 100) finishStep(o, 10);
  } else if (mg.kind === 'oven') {
    mg.m += mg.rise * dt;
    if (pressed.has(' ') || (G.touchUI && frameClicks.length)) { // Space / PULL! button / tap anywhere
      const c = (mg.win[0] + mg.win[1]) / 2;
      finishStep(o, clamp(100 - Math.abs(mg.m - c) * 3.2, 5, 100));
    } else if (mg.m >= 100) { sfx.bad(); finishStep(o, 12); }
  } else if (mg.kind === 'plate') {
    for (const c of frameClicks) {
      for (const it of mg.items) {
        if (dist(c.x, c.y, it.x, it.y) < (G.touchUI ? 40 : 26)) { it.drag = true; sfx.pop(); break; } // generous touch targets
      }
    }
    for (const it of mg.items) if (it.drag) { it.x = mouse.x; it.y = mouse.y; }
    for (const _ of frameReleases) {
      for (const it of mg.items) if (it.drag) { it.drag = false; it.placed = dist(it.x, it.y, 480, 300) < 130; }
    }
    if (mg.items.every(it => it.placed)) {
      const c = clickedBtn();
      if (c === 'servePlate' || pressed.has('enter')) {
        const avg = mg.items.reduce((s, it) => s + clamp(100 - dist(it.x, it.y, it.tx, it.ty) / 1.4, 0, 100), 0) / mg.items.length;
        finishStep(o, avg);
      }
    }
  }
}
function drawMG() {
  const mg = G.overlay;
  ctx.fillStyle = 'rgba(20,10,35,0.72)'; ctx.fillRect(0, 0, W, H);
  fillRR(120, 110, 720, 400, 16, '#fdf6e3', OUTLINE, 4);
  text(STEP_NAMES[mg.kind] + ' — ' + mg.o.recipe.name, 480, 140, 24, '#b8433a');
  if (mg.kind === 'chop') {
    text((G.touchUI ? 'TAP when the marker is in the green zone! ' : 'Press SPACE when the marker is in the green zone! ') + 'Round ' + (mg.round + 1) + '/4', 480, 175, 15, '#5a4a3a');
    // cutting board
    fillRR(180, 260, 600, 120, 12, '#c98a4a', OUTLINE, 3);
    const bx = 220, bw = 520, by = 320;
    fillRR(bx, by - 14, bw, 28, 8, '#e8d9b8', OUTLINE, 2.5);
    const zx = bx + (mg.zone.c - mg.zone.w / 2) * bw, zw = mg.zone.w * bw;
    fillRR(zx, by - 14, zw, 28, 4, '#7ec96a', null);
    const mx = bx + mg.pos * bw;
    tri(mx - 10, by - 34, mx + 10, by - 34, mx, by - 14, '#d64545', OUTLINE, 2);
    line(mx, by - 14, mx, by + 14, '#d64545', 3);
    // round pips
    for (let i = 0; i < 4; i++) circ(430 + i * 34, 420, 11, i < mg.round ? '#7ec96a' : '#ddd5c9', OUTLINE, 2);
    text('hits: ' + mg.hits, 480, 452, 15, '#2e6b2e');
    fillRR(340, 470, 280 * clamp(mg.rt / 2.8, 0, 1), 10, 4, '#f4a83d', null);
  } else if (mg.kind === 'stir') {
    text(G.touchUI ? 'Drag your finger in circles around the pot — steady speed!' : 'Circle the mouse around the pot — steady speed, not too wild! (or hold <- / ->)', 480, 175, 15, '#5a4a3a');
    // pot
    ell(480, 330, 110, 34, '#8a5a9a', OUTLINE, 3);
    fillRR(370, 250, 220, 80, 12, '#6a4a7a', OUTLINE, 3);
    ell(480, 252, 106, 28, '#4a3560', OUTLINE, 3);
    ell(480, 252, 88, 20, '#e8a23d', null); // soup
    const sw = Math.sin(performance.now() / 120) * (mg.speed / 8) * 20;
    ell(480 + sw, 252, 50, 10, '#f4c94a', null);
    // speed gauge
    text('speed', 205, 240, 13, '#5a4a3a');
    fillRR(160, 260, 90, 160, 8, '#ddd5c9', OUTLINE, 2.5);
    // band 2..8 mapped onto gauge 0..12
    const gy = v => 420 - (v / 12) * 160;
    fillRR(160, gy(8), 90, gy(2) - gy(8), 0, '#b0e8b0', null);
    fillRR(160, gy(clamp(mg.speed, 0, 12)) - 4, 90, 8, 3, '#d64545', OUTLINE, 2);
    // progress + burn
    text('progress', 480, 440, 13, '#5a4a3a');
    fillRR(340, 452, 280, 14, 6, '#ddd5c9', OUTLINE, 2);
    fillRR(340, 452, 280 * clamp(mg.prog / 100, 0, 1), 14, 6, '#5ab8e8', null);
    text('burn', 755, 440, 13, '#5a4a3a');
    fillRR(640, 452, 220, 14, 6, '#ddd5c9', OUTLINE, 2);
    fillRR(640, 452, 220 * clamp(mg.burn / 100, 0, 1), 14, 6, '#e85a5a', null);
  } else if (mg.kind === 'oven') {
    text((G.touchUI ? 'TAP in the GOLDEN window!' : 'Press SPACE in the GOLDEN window!') + (G.upgrades.oven ? ' (Turbo Oven!)' : ''), 480, 175, 15, '#5a4a3a');
    fillRR(380, 210, 60, 260, 10, '#5a5566', OUTLINE, 3);
    const my = v => 470 - (v / 100) * 260;
    fillRR(380, my(mg.win[1]), 60, my(mg.win[0]) - my(mg.win[1]), 0, '#ffd94a', null);
    fillRR(380, my(mg.m), 60, 470 - my(mg.m), 4, '#e85a2a', null);
    // little oven
    fillRR(520, 300, 180, 140, 12, '#8a5a4a', OUTLINE, 3);
    fillRR(540, 320, 140, 80, 8, mg.m > mg.win[1] ? '#ff5a2a' : '#ffb35a', OUTLINE, 2.5);
    circ(610, 420, 8, '#d64545', OUTLINE, 2);
    text(Math.round(mg.m) + '%', 410, 490, 16, '#5a4a3a');
  } else if (mg.kind === 'plate') {
    text('Drag each item onto its matching ghost spot!', 480, 175, 15, '#5a4a3a');
    // plate
    circ(480, 300, 130, '#fdfdfd', OUTLINE, 3);
    circ(480, 300, 100, '#eef2f5', '#c9d2d9', 2);
    for (const it of mg.items) { // ghost targets (dark ring so pale ingredients stay visible)
      circ(it.tx, it.ty, 18, null, OUTLINE, 4);
      ctx.globalAlpha = 0.35; circ(it.tx, it.ty, 14, it.color); ctx.globalAlpha = 1;
      circ(it.tx, it.ty, 14, null, it.color, 2);
    }
    for (const it of mg.items) {
      circ(it.x, it.y, 17, it.color, OUTLINE, 3);
      circ(it.x - 5, it.y - 5, 5, 'rgba(255,255,255,0.6)');
    }
    const allPlaced = mg.items.every(it => it.placed);
    btn('servePlate', 400, 480, 160, 44, 'SERVE! (Enter)', { disabled: !allPlaced, color: '#7ec96a' });
    if (!allPlaced) text('Place all items on the plate first', 480, 470, 12, '#8a7a6a');
  }
}

/* ============ 14. CHOWDER FACTOR + SABOTAGE ============== */
function triggerChaos() {
  G.chaosTimer = rand(14, 22);
  const opts = ['eat', 'wrestle', 'sneeze', 'panini', 'endive'];
  if (Math.random() < 0.12) opts.push('bonus', 'bonus');
  const kind = choice(opts);
  G.overlay = { type: 'warn', t: 1.5, next: kind };
  sfx.jingle();
}
function makeEvent(kind) {
  const act = activeOrders();
  if (kind === 'bonus') return { type: 'event', kind: 'bonus', t: 2.5, amt: 20 + G.day * 6 };
  if (act.length === 0) return null;
  const o = choice(act);
  if (kind === 'eat') {
    const subs = shuffle(SUBSTITUTES.slice()).slice(0, 3);
    return { type: 'event', kind: 'eat', o, subs, msg: 'Chowder ate a key ingredient for the ' + o.recipe.name + '! Pick a substitute...' };
  }
  if (kind === 'wrestle') return { type: 'event', kind: 'wrestle', o, need: 16, got: 0, t: 3.5, msg: 'Chowder is attached to the ' + o.recipe.name + ' and REFUSES to serve it! Mash SPACE to wrestle it back!' };
  if (kind === 'sneeze') return { type: 'event', kind: 'sneeze', o, t: 2.2, msg: 'Chowder sneezed on the thrice cream! The ' + o.recipe.name + ' has to be restarted. Sorry.' };
  if (kind === 'panini') return { type: 'event', kind: 'panini', o, t: 4, msg: 'Panini is flirting with the customers! "' + o.cust + '~, are YOU single?" Their patience drains twice as fast!' };
  return { type: 'event', kind: 'endive', o, t: 5, msg: 'Ms. Endive is poaching ' + o.cust + "'s order for HER catering company! Outbid her or lose it!" };
}
function updateEvent(dt) {
  const ev = G.overlay;
  if (ev.kind === 'wrestle') {
    ev.t -= dt;
    if (pressed.has(' ') || (G.touchUI && frameClicks.length)) { ev.got++; sfx.pop(); }
    if (ev.got >= ev.need) {
      toast('You wrestled the dish back! Chowder pouts.', '#b0ffb0');
      G.overlay = null;
    } else if (ev.t <= 0) {
      failOrder(ev.o, 'Chowder hugged it forever');
      G.overlay = null;
    }
    return;
  }
  if (ev.kind === 'panini') {
    ev.t -= dt;
    const c = clickedBtn();
    if (c === 'counter' && G.money >= 5) {
      G.money -= 5; sfx.coin();
      toast('You paid Panini $5 to go away. She winked. Worth it?', '#ffd0e8');
      G.overlay = null; return;
    }
    if (ev.t <= 0) { ev.o.panini = 8; toast(o_name(ev.o) + ' is distracted by Panini!', '#ff9ac9'); G.overlay = null; }
    return;
  }
  if (ev.kind === 'endive') {
    ev.t -= dt;
    const c = clickedBtn();
    if (c === 'counter' && G.money >= 12) {
      G.money -= 12; sfx.coin();
      toast('You outbid Endive! She leaves, furious and fabulous.', '#b0ffb0');
      G.overlay = null; return;
    }
    if (ev.t <= 0) { failOrder(ev.o, 'stolen by Ms. Endive'); G.overlay = null; }
    return;
  }
  if (ev.kind === 'eat') {
    const c = clickedBtn();
    if (c && c.startsWith('sub:')) {
      const i = Number(c.slice(4));
      const sub = ev.subs[i];
      const mod = randi(sub.mod[0], sub.mod[1]);
      ev.o.bonus += mod;
      sfx.click();
      toast(sub.name + ': ' + (mod >= 0 ? '+' + mod + ' quality. Genius!' : mod + ' quality. Oh well.'), mod >= 0 ? '#b0ffb0' : '#ff9a9a');
      G.overlay = null;
    } else if (c === 'skipSub') {
      ev.o.t = Math.max(4, ev.o.t - 6);
      toast('Skipped the substitution. Lost 6s on the order.', '#ffd0a0');
      G.overlay = null;
    }
    return;
  }
  // auto-resolving events (bonus, sneeze)
  ev.t -= dt;
  if (ev.t <= 0) {
    if (ev.kind === 'bonus') {
      G.money += ev.amt; G.totalEarned += ev.amt; G.dayStats.earned += ev.amt;
      sfx.coin();
      toast('Chowder accidentally made a BONUS DISH! +$' + ev.amt + '!', '#ffd94a');
    } else if (ev.kind === 'sneeze') {
      ev.o.step = 0; ev.o.qualities = [];
      sfx.bad();
    }
    G.overlay = null;
  }
}
function o_name(o) { return o.cust; }
function drawEvent() {
  const ev = G.overlay;
  ctx.fillStyle = 'rgba(20,10,35,0.6)'; ctx.fillRect(0, 0, W, H);
  fillRR(140, 160, 680, 280, 16, '#fdf6e3', OUTLINE, 4);
  if (ev.kind === 'panini') drawPanini(220, 330, 1.0);
  else if (ev.kind === 'endive') drawEndive(220, 350, 0.9);
  else drawChowder(220, 340, 1.0);
  const lines = wrapText(ev.msg, 430, 17);
  lines.forEach((l, i) => text(l, 330, 215 + i * 26, 17, '#333', 'left', false));
  if (ev.kind === 'wrestle') {
    text('MASH SPACE!  ' + ev.got + '/' + ev.need, 480, 330, 26, '#b8433a');
    fillRR(300, 360, 360, 16, 8, '#ddd5c9', OUTLINE, 2);
    fillRR(300, 360, 360 * clamp(ev.got / ev.need, 0, 1), 16, 8, '#7ec96a', null);
    fillRR(300, 390, 360 * clamp(ev.t / 3.5, 0, 1), 8, 4, '#e85a5a', null);
  } else if (ev.kind === 'eat') {
    ev.subs.forEach((s, i) => btn('sub:' + i, 300, 300 + i * 52, 260, 42, s.name, { size: 15 }));
    btn('skipSub', 590, 300, 170, 42, 'Skip (-6s)', { color: '#c9c9d9', size: 14 });
  } else if (ev.kind === 'panini') {
    btn('counter', 340, 330, 260, 46, 'Shoo Panini ($5)', { disabled: G.money < 5 });
    text('or let her distract the order... ' + Math.ceil(ev.t) + 's', 470, 400, 14, '#8a7a6a');
  } else if (ev.kind === 'endive') {
    btn('counter', 340, 330, 260, 46, 'Sabotage back: Outbid ($12)', { disabled: G.money < 12, size: 15 });
    text('or lose the order... ' + Math.ceil(ev.t) + 's', 470, 400, 14, '#8a7a6a');
  }
}
function updateWarn(dt) {
  const w = G.overlay;
  w.t -= dt;
  if (w.t <= 0) G.overlay = makeEvent(w.next);
}
function drawWarn() {
  ctx.fillStyle = 'rgba(214,69,69,0.28)'; ctx.fillRect(0, 0, W, H);
  drawTruffles(180, 320, 1.3, true);
  text('CHOWDER!!!', 560, 260, 64, '#d64545');
  text('Truffles senses a disturbance in the kitchen...', 560, 320, 18, '#fff');
  drawChowder(830, 330, 0.9);
}

/* ===================== 15. EVENING ======================== */
function startEvening() {
  const st = G.dayStats;
  const avgQ = st.qualities.length ? st.qualities.reduce((a, b) => a + b, 0) / st.qualities.length : 0;
  const tot = st.completed + st.failed;
  const comp = tot ? st.completed / tot : 0;
  const score = avgQ * 0.65 + comp * 35;
  G.evStars = tot === 0 ? 1 : clamp(Math.round(score / 20), 1, 5);
  G.stars += G.evStars;
  G.evLines = [
    ['Orders completed', st.completed + ' / ' + tot],
    ['Cooking earnings', '$' + st.earned],
    ['Tips', '$' + st.tips],
    ['Market expenses', '-$' + G.spentToday],
    ['Average dish quality', Math.round(avgQ) + '%'],
  ];
  G.bookOpen = false;
  G.screen = 'evening';
  sfx.good();
}
function updateEvening() {
  const c = clickedBtn();
  if (c && c.startsWith('buy:')) {
    const u = UPGRADES.find(x => x.id === c.slice(4));
    if (u && G.upgrades[u.id] < u.max && G.money >= u.cost) {
      G.money -= u.cost; G.upgrades[u.id]++;
      sfx.coin(); toast('Bought ' + u.name + '!', '#b0ffb0');
    }
  }
  if (c === 'book') { G.bookOpen = !G.bookOpen; sfx.click(); }
  if (c === 'bookPrev') { G.bookPage = Math.max(0, G.bookPage - 1); sfx.pop(); }
  if (c === 'bookNext') { G.bookPage = Math.min(Math.ceil(RECIPES.length / 4) - 1, G.bookPage + 1); sfx.pop(); }
  if (pressed.has('arrowleft')) G.bookPage = Math.max(0, G.bookPage - 1);
  if (pressed.has('arrowright')) G.bookPage = Math.min(Math.ceil(RECIPES.length / 4) - 1, G.bookPage + 1);
  if (c === 'nextDay' || pressed.has('enter')) {
    sfx.click();
    G.day++;
    startMorning();
  }
}
function drawEvening() {
  if (!use3D) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#2c1e4a'); g.addColorStop(1, '#4a2c6a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  text('DAY ' + G.day + ' COMPLETE!', W / 2, 55, 40, '#ffd94a');
  // stars
  for (let i = 0; i < 5; i++) drawStar(380 + i * 50, 105, 18, i < G.evStars ? '#ffd94a' : '#5a4a6a');
  text('Total stars: ' + G.stars + '    Money: $' + G.money + '    Lifetime earnings: $' + G.totalEarned, W / 2, 145, 15, '#d9c9f0');
  // tally
  fillRR(50, 175, 330, 250, 14, '#fdf6e3', OUTLINE, 4);
  text('EVENING TALLY', 215, 200, 18, '#b8433a');
  G.evLines.forEach((l, i) => {
    text(l[0], 75, 235 + i * 30, 14, '#5a4a3a', 'left', false);
    text(l[1], 355, 235 + i * 30, 14, OUTLINE, 'right');
  });
  drawTruffles(90, 460, 0.7, G.dayStats.failed > 0);
  // upgrade shop
  fillRR(410, 175, 300, 250, 14, '#fdf6e3', OUTLINE, 4);
  text('KITCHEN UPGRADES', 560, 200, 18, '#b8433a');
  UPGRADES.forEach((u, i) => {
    const lvl = G.upgrades[u.id], maxed = lvl >= u.max;
    const y = 222 + i * 50;
    text(u.name + (u.max > 1 ? ' (' + lvl + '/' + u.max + ')' : ''), 425, y + 10, 14, OUTLINE, 'left');
    text(u.desc, 425, y + 28, 11, '#8a7a6a', 'left', false);
    btn('buy:' + u.id, 600, y, 95, 38, maxed ? 'OWNED' : '$' + u.cost, { disabled: maxed || G.money < u.cost, size: 14 });
  });
  // recipe book
  fillRR(740, 175, 190, 250, 14, '#fdf6e3', OUTLINE, 4);
  text('RECIPE BOOK', 835, 200, 16, '#b8433a');
  const unlocked = RECIPES.filter(isUnlocked).length;
  text(unlocked + ' / ' + RECIPES.length + ' unlocked', 835, 222, 12, '#8a7a6a');
  btn('book', 765, 240, 140, 38, G.bookOpen ? 'CLOSE BOOK' : 'OPEN BOOK', { size: 13 });
  drawChowder(850, 400, 0.62);
  btn('nextDay', W / 2 - 130, 510, 260, 56, 'NEXT DAY  (Enter)', { color: '#7ec96a' });
  if (G.bookOpen) drawBook();
}
function drawStar(x, y, r, color) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5;
    const rr2 = i % 2 === 0 ? r : r * 0.45;
    const px = x + Math.cos(a) * rr2, py = y + Math.sin(a) * rr2;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = color; ctx.fill();
  ctx.strokeStyle = OUTLINE; ctx.lineWidth = 2; ctx.stroke();
}
function drawBook() {
  fillRR(120, 130, 720, 380, 16, '#fdf6e3', OUTLINE, 4);
  text('MUNG\'S SACRED RECIPE BOOK', 480, 160, 22, '#b8433a');
  const per = 4, start = G.bookPage * per;
  RECIPES.slice(start, start + per).forEach((r, i) => {
    const y = 195 + i * 72;
    const un = isUnlocked(r);
    fillRR(150, y, 660, 62, 10, un ? '#fff8dc' : '#e0d9cc', OUTLINE, 2);
    text(r.name, 170, y + 16, 15, un ? OUTLINE : '#9a8f7a', 'left');
    text('$' + r.price, 790, y + 16, 14, '#2e6b2e', 'right');
    if (un) {
      let sx = 170;
      r.steps.forEach(st => {
        fillRR(sx, y + 30, 58, 20, 5, STEP_COLORS[st], null);
        text(STEP_NAMES[st], sx + 29, y + 41, 10, OUTLINE);
        sx += 64;
      });
      text(r.ings.map(id => INGREDIENTS[id].name).join(', '), 810, y + 41, 11, '#8a7a6a', 'right', false);
    } else {
      text(unlockText(r), 170, y + 41, 12, '#b8433a', 'left', false);
    }
  });
  btn('bookPrev', 300, 470, 80, 30, '< Prev', { size: 13, disabled: G.bookPage === 0 });
  text('Page ' + (G.bookPage + 1) + ' / ' + Math.ceil(RECIPES.length / per), 480, 486, 13, '#8a7a6a');
  btn('bookNext', 580, 470, 80, 30, 'Next >', { size: 13, disabled: G.bookPage >= Math.ceil(RECIPES.length / per) - 1 });
}

/* ==================== SHARED UI =========================== */
function drawTopBar(phase) {
  fillRR(0, 0, W, 44, 0, '#2c1e4a');
  text('Day ' + G.day + (specialDay() ? ' — ' + specialTheme() : ''), 60, 23, 16, '#ffd94a', 'left');
  text(phase, W / 2, 23, 15, '#d9c9f0');
  text('$' + G.money, W - 200, 23, 16, '#7ee87e', 'left');
  text('★ ' + G.stars, W - 110, 23, 16, '#ffd94a', 'left');
  if (!G.touchUI) text(G.muted ? 'M: muted' : 'M: sound', W - 30, 23, 12, '#8a7aa0', 'right', false);
}
function updateToasts(dt) {
  for (const t of G.toasts) t.t -= dt;
  G.toasts = G.toasts.filter(t => t.t > 0);
}
function drawToasts() {
  G.toasts.forEach((t, i) => {
    const a = clamp(t.t / 0.5, 0, 1);
    ctx.globalAlpha = a;
    fillRR(W / 2 - 280, 52 + i * 30, 560, 24, 8, 'rgba(20,10,40,0.85)', null);
    text(t.str, W / 2, 65 + i * 30, 13, t.color);
    ctx.globalAlpha = 1;
  });
}
/* Shop panel (market) + budget warning live in overlays */
function updateShop() {
  const sh = G.overlay, stall = sh.stall;
  const c = clickedBtn();
  if (c && c.startsWith('buyi:')) {
    buyItem(stall, c.slice(5));
    if (G.overlay && G.overlay.type === 'budget') return; // budget popup replaced shop
  }
  if (c === 'mystery') {
    buyMystery(stall);
    if (G.overlay && G.overlay.type === 'budget') return;
  }
  for (let i = 0; i < stall.items.length; i++) {
    if (pressed.has(String(i + 1))) { buyItem(stall, stall.items[i]); if (G.overlay && G.overlay.type === 'budget') return; }
  }
  if (c === 'closeShop' || pressed.has('escape') || pressed.has('e')) { sfx.click(); G.overlay = null; }
}
function drawShop() {
  const sh = G.overlay, stall = sh.stall;
  ctx.fillStyle = 'rgba(20,10,35,0.6)'; ctx.fillRect(0, 0, W, H);
  fillRR(200, 120, 560, 380, 16, '#fdf6e3', OUTLINE, 4);
  text(stall.name, 480, 150, 24, '#b8433a');
  const d = stallDiscount(stall);
  text(d > 0 ? 'Friendship discount: -' + d * 100 + '%! Gazpacho-approved.' : 'Buy often to befriend this vendor (discounts!)', 480, 178, 13, '#8a7a6a');
  if (stall.id === 'gazpacho') drawGazpacho(280, 260, 0.55);
  else drawCustomer(280, 260, 0.55, stall.vendorSeed);
  stall.items.forEach((id, i) => {
    const ing = INGREDIENTS[id];
    const price = Math.max(1, Math.round(ing.price * (1 - d)));
    const y = 210 + i * 56;
    circ(400, y + 20, 10, ing.color, OUTLINE, 2);
    text(ing.name + (ing.rare ? ' ★RARE★' : ''), 420, y + 12, 15, OUTLINE, 'left');
    text('owned: ' + (G.inv[id] || 0), 420, y + 30, 11, '#8a7a6a', 'left', false);
    btn('buyi:' + id, 620, y, 110, 40, '$' + price + '  (' + (i + 1) + ')', { disabled: G.money < price, size: 15 });
  });
  if (stall.mystery) {
    const y = 210 + stall.items.length * 56;
    text('??? Mystery Ingredient ???', 420, y + 12, 15, '#7a48a3', 'left');
    text('"Totally legit," says Gazpacho.', 420, y + 30, 11, '#8a7a6a', 'left', false);
    btn('mystery', 620, y, 110, 40, '$10', { disabled: G.money < 10, size: 15 });
  }
  btn('closeShop', 400, 445, 160, 40, 'CLOSE (Esc)', { color: '#c9c9d9', size: 15 });
}
function updateBudget() {
  if (clickedBtn() || pressed.has(' ') || pressed.has('enter') || pressed.has('escape')) {
    sfx.click();
    G.overlay = null;
  }
}
function drawBudget() {
  ctx.fillStyle = 'rgba(20,10,35,0.65)'; ctx.fillRect(0, 0, W, H);
  fillRR(180, 180, 600, 230, 16, '#fdf6e3', OUTLINE, 4);
  drawTruffles(280, 340, 1.1, true);
  text('TRUFFLES SAYS:', 540, 230, 22, '#d64545');
  const lines = wrapText('You have spent $' + G.spentToday + ' of your $' + G.budget + ' budget! MONEY DOES NOT GROW ON TREES, IT GROWS IN MY REGISTER! Spend carefully!', 380, 16);
  lines.forEach((l, i) => text(l, 390, 270 + i * 24, 16, '#333', 'left', false));
  btn('ok', 460, 360, 160, 38, 'YES CHEF (Space)', { size: 14 });
}
/* prompt: serve anyway or bin */
function updatePrompt() {
  const p = G.overlay, o = p.o;
  const c = clickedBtn();
  if (c === 'serveAnyway' || pressed.has('enter')) {
    toast('Served it anyway. Bold move.', '#ffd0a0');
    advanceStep(o);
  } else if (c === 'binDish' || pressed.has('b')) {
    o.step = 0; o.qualities = []; o.t = Math.max(5, o.t - 6);
    sfx.bad();
    toast('Binned. Restarting the dish (-6s).', '#ff9a9a');
    G.overlay = null;
  }
}
function drawPrompt() {
  const p = G.overlay;
  ctx.fillStyle = 'rgba(20,10,35,0.65)'; ctx.fillRect(0, 0, W, H);
  fillRR(230, 200, 500, 200, 16, '#fdf6e3', OUTLINE, 4);
  text('STEP BOTCHED! (' + p.q + '% quality)', 480, 240, 24, '#d64545');
  text('Serve it anyway, or bin it and restart the dish?', 480, 275, 16, '#333');
  btn('serveAnyway', 280, 320, 190, 48, 'SERVE ANYWAY', { color: '#f4a83d', size: 15 });
  btn('binDish', 500, 320, 190, 48, 'BIN IT (B)', { color: '#c96a5a', size: 15 });
}

/* ==================== OVERLAY ROUTER ====================== */
function updateOverlay(dt) {
  const ov = G.overlay;
  if (!ov) return;
  if (ov.type === 'mg') updateMG(dt);
  else if (ov.type === 'warn') updateWarn(dt);
  else if (ov.type === 'event') updateEvent(dt);
  else if (ov.type === 'prompt') updatePrompt();
  else if (ov.type === 'shop') updateShop();
  else if (ov.type === 'budget') updateBudget();
}
function drawOverlay() {
  const ov = G.overlay;
  if (!ov) return;
  if (ov.type === 'mg') drawMG();
  else if (ov.type === 'warn') drawWarn();
  else if (ov.type === 'event') drawEvent();
  else if (ov.type === 'prompt') drawPrompt();
  else if (ov.type === 'shop') drawShop();
  else if (ov.type === 'budget') drawBudget();
}

/* ===================== 16. MAIN LOOP ====================== */
let last = 0;
function frame(ts) {
  const dt = Math.min(0.05, Math.max(0, last ? (ts - last) / 1000 : 0.016));
  last = ts;
  // global mute toggle
  if (pressed.has('m')) { G.muted = !G.muted; toast(G.muted ? 'Muted' : 'Sound on', '#d9c9f0'); }
  switch (G.screen) {
    case 'title': updateTitle(); break;
    case 'help': updateHelp(); break;
    case 'morning': updateMorning(); break;
    case 'market': updateMarket(dt); break;
    case 'service': updateService(dt); break;
    case 'evening': updateEvening(); break;
  }
  updateToasts(dt);
  // draw
  uiButtons = [];
  if (use3D) { W3.render(dt, ts / 1000); ctx.clearRect(0, 0, W, H); }
  switch (G.screen) {
    case 'title': drawTitle(ts); break;
    case 'help': drawHelp(); break;
    case 'morning': drawMorning(); break;
    case 'market': drawMarket(); break;
    case 'service': drawService(); break;
    case 'evening': drawEvening(); break;
  }
  drawOverlay();
  drawTouchControls();
  drawToasts();
  // clear per-frame input
  pressed = new Set();
  frameClicks = [];
  frameReleases = [];
  requestAnimationFrame(frame);
}
initPatterns();
use3D = (typeof W3 !== 'undefined') && W3.init(document.getElementById('game3d'));
requestAnimationFrame(frame);
