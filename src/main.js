import * as THREE from 'three';
import * as P from './physics.js';
import { Panel, C, FONT_D, FONT_B } from './panel.js';
import { initAudio, sfx, setEnabled as setSound } from './audio.js';

const { TABLE, BALL_R } = P;
const { L, W, H } = TABLE;

// ---------------------------------------------------------------- settings & storage
const store = {
  get(k, d) { try { const v = localStorage.getItem('topspin.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('topspin.' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};
const PRESETS = {
  assisted: { assist: 'light', speed: 0.85, spinFx: true },
  simulation: { assist: 'off', speed: 1, spinFx: false },
};
const settings = Object.assign({
  preset: 'assisted', assist: 'light', speed: 0.85, spinFx: true, space: 'standard',
  hand: 'right', angle: 0, sound: true, difficulty: 'medium', weight: 75,
}, store.get('settings', {}));
const bests = store.get('bests', {});
function saveSettings() {
  const match = Object.entries(PRESETS).find(([, p]) => p.assist === settings.assist && p.speed === settings.speed && p.spinFx === settings.spinFx);
  settings.preset = match ? match[0] : 'custom';
  store.set('settings', settings);
  setSound(settings.sound);
}
setSound(settings.sound);
const ASSIST_DV = { off: 0, light: 0.8, strong: 2.0 };
const SPREAD = { small: 0.22, standard: 0.42, large: 0.58 };
const DIFF_LEVEL = { easy: 0, medium: 10, hard: 22 };

// ---------------------------------------------------------------- renderer & scene
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');

const scene = new THREE.Scene();
const BG = new THREE.Color('#0a1a2e');
scene.background = BG;
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.01, 60);
camera.position.set(0, 1.5, L / 2 + 1.0);
camera.lookAt(0, 0.85, -0.4);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

scene.add(new THREE.HemisphereLight('#dfefff', '#3a3125', 1.6));
const sun = new THREE.DirectionalLight('#ffffff', 1.6);
sun.position.set(1.5, 4, 2); scene.add(sun);

// Virtual room, only shown on desktop or when passthrough isn't available.
const env = new THREE.Group(); scene.add(env);
{
  const floor = new THREE.Mesh(new THREE.CircleGeometry(9, 48), new THREE.MeshStandardMaterial({ color: '#1b2b3f', roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2; env.add(floor);
  const grid = new THREE.GridHelper(14, 28, '#2f4b6b', '#22384f'); grid.position.y = 0.002; env.add(grid);
}

// Everything game-related lives in the table frame (origin on the floor under the table centre).
const tableRoot = new THREE.Group(); scene.add(tableRoot);

function buildTable() {
  const g = new THREE.Group();
  const top = new THREE.Mesh(new THREE.BoxGeometry(W, 0.025, L), new THREE.MeshStandardMaterial({ color: '#1c4f8c', roughness: 0.55 }));
  top.position.y = H - 0.0125; g.add(top);
  const white = new THREE.MeshBasicMaterial({ color: '#f3f6fa' });
  const line = (w, l, x, z) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), white); m.rotation.x = -Math.PI / 2; m.position.set(x, H + 0.0006, z); g.add(m); };
  line(0.02, L, -W / 2 + 0.01, 0); line(0.02, L, W / 2 - 0.01, 0);
  line(W, 0.02, 0, -L / 2 + 0.01); line(W, 0.02, 0, L / 2 - 0.01);
  line(0.003, L, 0, 0);
  const legMat = new THREE.MeshStandardMaterial({ color: '#2b3038', roughness: 0.6 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, H - 0.03, 0.05), legMat);
    leg.position.set(sx * (W / 2 - 0.15), (H - 0.03) / 2, sz * (L / 2 - 0.3)); g.add(leg);
  }
  const net = new THREE.Mesh(new THREE.PlaneGeometry(TABLE.NET_HALF_W * 2, TABLE.NET_H),
    new THREE.MeshStandardMaterial({ color: '#0d1724', transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
  net.position.set(0, H + TABLE.NET_H / 2, 0); g.add(net);
  const tape = new THREE.Mesh(new THREE.BoxGeometry(TABLE.NET_HALF_W * 2, 0.012, 0.004), white);
  tape.position.set(0, H + TABLE.NET_H, 0); g.add(tape);
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, TABLE.NET_H + 0.02), legMat);
    post.position.set(sx * TABLE.NET_HALF_W, H + TABLE.NET_H / 2, 0); g.add(post);
  }
  return g;
}
tableRoot.add(buildTable());

// Ball machine at the far end.
const NOZZLE = P.v3(0, H + 0.32, -L / 2 - 0.25);
const machine = new THREE.Group();
const machineLight = new THREE.MeshBasicMaterial({ color: '#40220b' });
{
  const dark = new THREE.MeshStandardMaterial({ color: '#26313f', roughness: 0.5, metalness: 0.2 });
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, NOZZLE.y - 0.1), dark);
  stand.position.y = -(NOZZLE.y - 0.1) / 2 - 0.08; machine.add(stand);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.18, 0.26), dark); body.position.set(0, -0.05, -0.08); machine.add(body);
  const hopper = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.08, 0.16, 20, 1, true),
    new THREE.MeshStandardMaterial({ color: '#9fc3e6', transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
  hopper.position.set(0, 0.12, -0.12); machine.add(hopper);
  const orange = new THREE.MeshStandardMaterial({ color: '#ff7a1a', roughness: 0.4 });
  for (let i = 0; i < 9; i++) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 12, 8), orange);
    b.position.set(Math.cos(i * 2.1) * 0.07 * (i % 3) / 2, 0.07 + Math.floor(i / 3) * 0.035, -0.12 + Math.sin(i * 2.1) * 0.07 * (i % 3) / 2);
    machine.add(b);
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.012, 10, 24), machineLight);
  ring.position.z = 0.04; machine.add(ring);
  machine.nozzle = new THREE.Group(); machine.add(machine.nozzle);
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.034, 0.12, 16), dark);
  tube.rotation.x = Math.PI / 2; tube.position.z = 0.03; machine.nozzle.add(tube);
}
machine.position.set(NOZZLE.x, NOZZLE.y, NOZZLE.z);
tableRoot.add(machine);

// Target ring on the far half.
const target = new THREE.Group();
{
  const ringMat = new THREE.MeshBasicMaterial({ color: '#ff7a1a', transparent: true, opacity: 0.95, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.17, 0.2, 40), ringMat); ring.rotation.x = -Math.PI / 2; target.add(ring);
  const fill = new THREE.Mesh(new THREE.CircleGeometry(0.17, 40), new THREE.MeshBasicMaterial({ color: '#ff7a1a', transparent: true, opacity: 0.22, depthWrite: false }));
  fill.rotation.x = -Math.PI / 2; target.add(fill);
  target.position.y = H + 0.002; target.visible = false; target.fill = fill;
  tableRoot.add(target);
}
const TARGET_R = 0.2;

// ---------------------------------------------------------------- paddle
const BLADE_R = 0.077;
const BLADE_C = new THREE.Vector3(0, 0, -0.155); // blade centre in paddle-mount space; face normal is the mount's X axis
const paddle = new THREE.Group(); // the mount: rotation.x = paddle angle setting
{
  const wood = new THREE.MeshStandardMaterial({ color: '#c9a36b', roughness: 0.7 });
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.032, 0.105), wood); handle.position.z = -0.03; paddle.add(handle);
  const blade = new THREE.Mesh(new THREE.CylinderGeometry(BLADE_R, BLADE_R, 0.006, 40), wood);
  blade.rotation.z = Math.PI / 2; blade.scale.set(1, 1, 1.04); blade.position.copy(BLADE_C); paddle.add(blade);
  const rubber = (color, side) => {
    const r = new THREE.Mesh(new THREE.CylinderGeometry(BLADE_R - 0.002, BLADE_R - 0.002, 0.003, 40), new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
    r.rotation.z = Math.PI / 2; r.scale.set(1, 1, 1.04); r.position.copy(BLADE_C); r.position.x = side * 0.0045; paddle.add(r);
  };
  rubber('#c8202c', 1); rubber('#15171a', -1);
}
const desktopHolder = new THREE.Group(); scene.add(desktopHolder);
const offHandMarker = new THREE.Mesh(new THREE.SphereGeometry(0.025, 16, 12), new THREE.MeshStandardMaterial({ color: '#9fb6cf' }));

// ---------------------------------------------------------------- balls
const ballTex = (() => {
  const c = document.createElement('canvas'); c.width = 128; c.height = 64;
  const x = c.getContext('2d'); x.fillStyle = '#ff7a1a'; x.fillRect(0, 0, 128, 64);
  x.fillStyle = '#b84a00'; x.fillRect(0, 29, 128, 6); // a seam so spin is visible
  x.fillStyle = '#fff3e6'; x.beginPath(); x.arc(32, 18, 7, 0, 7); x.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
const ballGeo = new THREE.SphereGeometry(BALL_R, 20, 14);
const shadowGeo = new THREE.CircleGeometry(BALL_R * 1.4, 20);
const TRAIL_N = 18;
const balls = [];
function makeBallObj() {
  const mesh = new THREE.Mesh(ballGeo, new THREE.MeshStandardMaterial({ map: ballTex, roughness: 0.45, emissive: '#331300' }));
  const shadow = new THREE.Mesh(shadowGeo, new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.4, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  const trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_N * 3), 3));
  const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.7 }));
  trail.frustumCulled = false;
  tableRoot.add(mesh, shadow, trail);
  return { mesh, shadow, trail, trailPts: [], b: null, phase: 'dead', age: 0, lastHit: -1, current: false, fade: 0 };
}
for (let i = 0; i < 4; i++) balls.push(makeBallObj());
function hideBall(o) { o.mesh.visible = o.shadow.visible = o.trail.visible = false; o.phase = 'dead'; o.b = null; o.current = false; }
balls.forEach(hideBall);
function spawnBall(pos, vel, spin) {
  let o = balls.find(x => !x.b) || balls.reduce((a, x) => (x.age > a.age ? x : a));
  balls.forEach(x => { x.current = false; });
  o.b = P.makeBall(pos, vel, spin); o.phase = 'incoming'; o.age = 0; o.lastHit = -1; o.current = true; o.trailPts = [];
  o.mesh.visible = o.shadow.visible = true; o.trail.visible = settings.spinFx;
  return o;
}

// ---------------------------------------------------------------- UI panels
const menu = new Panel(1100, 820, 1.05);
menu.mesh.position.set(0, H + 0.58, -0.25);
tableRoot.add(menu.mesh);
const hud = new Panel(1024, 200, 1.0, { interactive: false });
hud.mesh.position.set(0, 1.62, -L / 2 - 0.35);
tableRoot.add(hud.mesh);
const pop = new Panel(512, 128, 0.42, { interactive: false, transparent: true });
pop.mesh.visible = false; tableRoot.add(pop.mesh);
let popT = 0;
function popup(text, color, x, z) {
  pop.setDraw(p => p.text(text, 256, 64, { size: 76, color, font: FONT_D, weight: 700, align: 'center', base: 'middle' }));
  pop.mesh.position.set(x, H + 0.12, z); pop.mesh.visible = true; popT = 0;
}

// ---------------------------------------------------------------- game state
const S = {
  screen: 'main',          // main | settings | playing | paused | results
  mode: 'drills',          // drills | rally
  time: 0, playTime: 0,
  fed: 0, setSize: 25, score: 0, streak: 0, bestStreak: 0, onTable: 0, targets: 0, hits: 0,
  rally: 0, nextFeedAt: Infinity, pendingShot: null, cur: null,
  headDist: 0, swings: 0, lastHead: null, swingArmed: true,
  result: null,
};
const MODE_NAME = { drills: 'Target Drills', rally: 'Rally Survival' };
const cap = s => s[0].toUpperCase() + s.slice(1);
const bestKey = () => `${S.mode}.${settings.difficulty}`;

function resetRun() {
  Object.assign(S, { time: 0, playTime: 0, fed: 0, score: 0, streak: 0, bestStreak: 0, onTable: 0, targets: 0, hits: 0, rally: 0,
    headDist: 0, swings: 0, lastHead: null, cur: null, pendingShot: null, finishAt: Infinity });
  balls.forEach(hideBall);
}
function startMode(mode) {
  S.mode = mode; resetRun();
  S.screen = 'playing';
  S.nextFeedAt = 1.5;
  placeTarget();
  showScreen();
}
function placeTarget() {
  if (S.mode !== 'drills') { target.visible = false; return; }
  const xs = [-0.45, 0, 0.45], zs = [-0.5, -1.0];
  let x, z;
  do { x = xs[Math.floor(Math.random() * 3)]; z = zs[Math.floor(Math.random() * 2)]; }
  while (target.visible && Math.abs(target.position.x - x) < 0.01 && Math.abs(target.position.z - z) < 0.01);
  if (settings.space === 'small') x *= 0.8;
  target.position.x = x; target.position.z = z; target.visible = true;
}

function rand(a, b) { return a + Math.random() * (b - a); }
function makeShot(level) {
  const types = [
    { spin: P.v3(40, 0, 0), T: [0.78, 0.86] },              // float
    { spin: P.v3(110, 0, 0), T: [0.68, 0.76] },             // slow topspin
  ];
  if (level >= 8) types.push({ spin: P.v3(200, 0, 0), T: [0.56, 0.64] }, { spin: P.v3(-190, 0, 0), T: [0.72, 0.8] });
  if (level >= 20) types.push({ spin: P.v3(290, 0, 0), T: [0.44, 0.5] }, { spin: P.v3(70, 170, 0), T: [0.58, 0.64] },
    { spin: P.v3(70, -170, 0), T: [0.58, 0.64] }, { spin: P.v3(-260, 0, 0), T: [0.68, 0.74] });
  const t = types[Math.floor(Math.random() * types.length)];
  const pace = 1 - Math.min(0.22, Math.max(0, level - 20) * 0.006);
  const spread = SPREAD[settings.space] * (level < 8 ? 0.7 : 1);
  const tx = rand(-spread, spread), tz = rand(0.55, 1.05);
  const v = P.solveShot(NOZZLE, tx, tz, t.spin, rand(...t.T) * pace) || P.solveShot(NOZZLE, 0, 0.8, P.v3(), 0.8);
  return { v, spin: t.spin };
}
function feed() {
  const level = S.mode === 'rally' ? DIFF_LEVEL[settings.difficulty] + S.rally : DIFF_LEVEL[settings.difficulty];
  const shot = S.pendingShot || makeShot(level);
  S.pendingShot = null;
  S.cur = spawnBall(NOZZLE, shot.v, shot.spin);
  S.fed++;
  sfx.launch();
  S.nextFeedAt = Infinity;
}
function feedGap() {
  if (S.mode === 'rally') return Math.max(0.5, 1.15 - S.rally * 0.02);
  return { easy: 1.4, medium: 1.1, hard: 0.85 }[settings.difficulty];
}

// A ball's fate is decided: score it and line up the next one.
function resolve(o, outcome, x, z) {
  if (o.phase === 'done') return;
  o.phase = 'done';
  if (outcome === 'good') {
    S.onTable++; S.streak++; S.bestStreak = Math.max(S.bestStreak, S.streak);
    if (S.mode === 'drills') {
      const mult = S.streak >= 10 ? 3 : S.streak >= 5 ? 2 : 1;
      const inTarget = Math.hypot(x - target.position.x, z - target.position.z) <= TARGET_R;
      const pts = (inTarget ? 5 : 1) * mult;
      S.score += pts; if (inTarget) S.targets++;
      popup(inTarget ? `TARGET +${pts}` : `+${pts}`, inTarget ? C.accent : C.fg, x, z);
      inTarget ? sfx.target() : sfx.good();
      placeTarget();
    } else {
      S.rally++; S.score = S.rally;
      popup(`${S.rally}`, C.fg, x, z); sfx.good();
    }
  } else {
    S.streak = 0;
    const msg = { net: 'NET', out: 'OUT', own: 'OWN SIDE', miss: 'MISSED' }[outcome];
    const p = o.b ? o.b.p : P.v3(0, 0, L / 2);
    popup(msg, C.bad, Math.max(-0.7, Math.min(0.7, p.x)), outcome === 'miss' ? L / 2 - 0.2 : Math.max(-1.2, Math.min(1.2, p.z)));
    sfx.bad();
    if (S.mode === 'rally') { S.finishAt = S.time + 0.9; S.nextFeedAt = Infinity; return; }
  }
  if (S.mode === 'drills' && S.fed >= S.setSize) { S.finishAt = S.time + 1.1; S.nextFeedAt = Infinity; return; }
  S.nextFeedAt = S.time + feedGap();
}

function finishRun() {
  const mins = Math.max(S.playTime / 60, 0.1);
  const met = Math.min(7, 2.8 + 0.035 * (S.swings / mins) + 0.12 * (S.headDist / mins));
  const kcal = met * settings.weight * (S.playTime / 3600);
  const key = bestKey();
  const prev = bests[key] || 0;
  const isBest = S.score > prev;
  if (isBest) { bests[key] = S.score; store.set('bests', bests); }
  S.result = { score: S.score, isBest, prev, kcal, met };
  S.screen = 'results'; target.visible = false;
  balls.forEach(hideBall);
  showScreen();
  renderBests();
}

// ---------------------------------------------------------------- screens
function seg(p, id, options, value, y, x0 = 330, w = 230) {
  options.forEach(([val, label], i) => p.button(`${id}:${val}`, label, x0 + i * (w + 12), y, w, 64,
    { active: value === val, size: 30, onClick: () => { settings[id] = val; if (id === 'preset' && PRESETS[val]) Object.assign(settings, PRESETS[val]); saveSettings(); applyHand(); menu.redraw(); } }));
}
function label(p, str, y) { p.text(str, 70, y + 42, { size: 32, color: C.dim }); }

const screens = {
  main(p) {
    p.frame();
    p.text('TOPSPIN VR', 70, 135, { size: 110, font: FONT_D, weight: 700 });
    p.text('Table tennis workout', 72, 185, { size: 34, color: C.dim });
    p.button('drills', 'TARGET DRILLS', 70, 240, 470, 120, { primary: true, size: 46, onClick: () => startMode('drills') });
    p.button('rally', 'RALLY SURVIVAL', 560, 240, 470, 120, { primary: true, size: 46, onClick: () => startMode('rally') });
    p.text('25 balls · hit the orange ring for 5', 72, 400, { size: 26, color: C.dim });
    p.text('Endless rally · one miss ends it', 562, 400, { size: 26, color: C.dim });
    label(p, 'Level', 450); seg(p, 'difficulty', [['easy', 'EASY'], ['medium', 'MEDIUM'], ['hard', 'HARD']], settings.difficulty, 450, 250, 250);
    const bd = bests[`drills.${settings.difficulty}`], br = bests[`rally.${settings.difficulty}`];
    p.text(`Best · Drills ${bd ?? '—'} · Rally ${br ?? '—'}`, 72, 580, { size: 30, color: C.fg });
    p.button('settings', 'SETTINGS', 70, 630, 300, 90, { onClick: () => { S.screen = 'settings'; showScreen(); } });
    p.button('recenter', 'RECENTER TABLE', 390, 630, 380, 90, { onClick: recenter });
    if (xrSession) p.button('exit', 'EXIT', 790, 630, 240, 90, { onClick: () => xrSession.end() });
    p.text(xrSession ? 'Point and pull the trigger · B or Y pauses' : 'Click to choose · Esc pauses', 72, 770, { size: 26, color: C.dim });
  },
  settings(p) {
    p.frame();
    p.text('SETTINGS', 70, 105, { size: 70, font: FONT_D, weight: 700 });
    const presetLbl = { assisted: 'Realistic + assists', simulation: 'Simulation', custom: 'Custom' }[settings.preset];
    p.text(presetLbl, 1030, 100, { size: 32, color: C.accent, align: 'right' });
    label(p, 'Preset', 140); seg(p, 'preset', [['assisted', 'ASSISTED'], ['simulation', 'SIMULATION']], settings.preset, 140, 330, 352);
    label(p, 'Hit assist', 220); seg(p, 'assist', [['off', 'OFF'], ['light', 'LIGHT'], ['strong', 'STRONG']], settings.assist, 220);
    label(p, 'Ball speed', 300); seg(p, 'speed', [[0.7, '70%'], [0.85, '85%'], [1, '100%']], settings.speed, 300);
    label(p, 'Spin trails', 380); seg(p, 'spinFx', [[true, 'ON'], [false, 'OFF']], settings.spinFx, 380, 330, 352);
    label(p, 'Play space', 460); seg(p, 'space', [['small', 'SMALL'], ['standard', 'STANDARD'], ['large', 'LARGE']], settings.space, 460);
    label(p, 'Paddle hand', 540); seg(p, 'hand', [['left', 'LEFT'], ['right', 'RIGHT']], settings.hand, 540, 330, 352);
    label(p, 'Paddle angle', 620);
    p.button('ang-', '−', 330, 620, 110, 64, { size: 44, onClick: () => { settings.angle = Math.max(-45, settings.angle - 5); saveSettings(); applyHand(); menu.redraw(); } });
    p.text(`${settings.angle > 0 ? '+' : ''}${settings.angle}°`, 532, 664, { size: 38, align: 'center', font: FONT_D, weight: 700 });
    p.button('ang+', '+', 624, 620, 110, 64, { size: 44, onClick: () => { settings.angle = Math.min(45, settings.angle + 5); saveSettings(); applyHand(); menu.redraw(); } });
    p.button('sound', settings.sound ? 'SOUND ON' : 'SOUND OFF', 754, 620, 276, 64, { size: 30, active: settings.sound, onClick: () => { settings.sound = !settings.sound; saveSettings(); menu.redraw(); } });
    p.button('back', 'DONE', 70, 715, 300, 80, { primary: true, onClick: () => { S.screen = S.returnTo || 'main'; S.returnTo = null; showScreen(); } });
    p.text('Simulation turns every assist off', 400, 765, { size: 26, color: C.dim });
  },
  paused(p) {
    p.frame();
    p.text('PAUSED', 70, 130, { size: 96, font: FONT_D, weight: 700 });
    p.text(`${MODE_NAME[S.mode]} · ${cap(settings.difficulty)}`, 72, 185, { size: 34, color: C.dim });
    p.button('resume', 'RESUME', 70, 240, 470, 120, { primary: true, size: 48, onClick: () => { S.screen = 'playing'; showScreen(); } });
    p.button('restart', 'RESTART', 560, 240, 470, 120, { size: 44, onClick: () => startMode(S.mode) });
    p.button('settings', 'SETTINGS', 70, 390, 470, 100, { onClick: () => { S.returnTo = 'paused'; S.screen = 'settings'; showScreen(); } });
    p.button('recenter', 'RECENTER TABLE', 560, 390, 470, 100, { onClick: recenter });
    p.button('quit', 'QUIT TO MENU', 70, 520, 470, 100, { onClick: () => { S.screen = 'main'; resetRun(); target.visible = false; showScreen(); } });
  },
  results(p) {
    const r = S.result;
    p.frame();
    p.text(MODE_NAME[S.mode].toUpperCase(), 70, 100, { size: 52, font: FONT_D, weight: 700, color: C.dim });
    p.text(`${cap(settings.difficulty)}`, 1030, 100, { size: 34, color: C.dim, align: 'right' });
    p.text(String(r.score), 70, 250, { size: 170, font: FONT_D, weight: 700, color: C.accent });
    p.text(S.mode === 'drills' ? 'points' : 'shot rally', 72, 295, { size: 32, color: C.dim });
    p.text(r.isBest ? 'New best!' : `Best ${r.prev}`, 1030, 250, { size: 44, align: 'right', color: r.isBest ? C.good : C.fg, font: FONT_D, weight: 700 });
    const rows = S.mode === 'drills'
      ? [['Returns on table', `${S.onTable} / ${S.fed}`], ['Targets hit', S.targets], ['Best streak', S.bestStreak]]
      : [['Paddle hits', S.hits], ['Best streak', S.bestStreak], ['Level reached', cap(settings.difficulty) + ` +${S.rally}`]];
    rows.push(['Time', `${Math.floor(S.playTime / 60)}:${String(Math.floor(S.playTime % 60)).padStart(2, '0')}`],
      ['Moved', `${S.headDist.toFixed(0)} m`], ['Calories (estimate)', `${r.kcal.toFixed(0)} kcal`]);
    rows.forEach(([k, v], i) => {
      const col = i % 2, row = Math.floor(i / 2);
      const x = 70 + col * 490, y = 345 + row * 90;
      p.text(k, x, y + 30, { size: 28, color: C.dim });
      p.text(String(v), x, y + 72, { size: 44, font: FONT_D, weight: 700 });
    });
    p.button('again', 'PLAY AGAIN', 70, 640, 470, 110, { primary: true, size: 46, onClick: () => startMode(S.mode) });
    p.button('menu', 'MENU', 560, 640, 470, 110, { size: 44, onClick: () => { S.screen = 'main'; showScreen(); } });
  },
};
function showScreen() {
  const interactive = S.screen !== 'playing';
  menu.mesh.visible = interactive;
  if (interactive) menu.setDraw(screens[S.screen]);
  hud.mesh.visible = S.screen === 'playing' || S.screen === 'paused';
  document.body.classList.toggle('paused', S.screen !== 'playing');
  rays.forEach(r => { r.visible = interactive && !!xrSession; });
}
let hudKey = '';
function drawHud() {
  const key = S.mode === 'drills' ? `${S.score}|${S.streak}|${S.fed}` : `${S.rally}`;
  if (key === hudKey) return; hudKey = key;
  hud.setDraw(p => {
    const ctx = p.ctx; ctx.fillStyle = C.bg; ctx.beginPath(); ctx.roundRect(4, 4, p.W - 8, p.H - 8, 24); ctx.fill();
    if (S.mode === 'drills') {
      const mult = S.streak >= 10 ? 3 : S.streak >= 5 ? 2 : 1;
      p.text(String(S.score), 60, 140, { size: 120, font: FONT_D, weight: 700, color: C.accent });
      p.text('POINTS', 60 + p.ctx.measureText(String(S.score)).width + 18, 140, { size: 40, font: FONT_D, color: C.dim });
      p.text(`×${mult}`, 640, 140, { size: 90, font: FONT_D, weight: 700, align: 'center', color: mult > 1 ? C.fg : C.dim });
      p.text(`${Math.min(S.fed, S.setSize)}/${S.setSize}`, 964, 140, { size: 80, font: FONT_D, weight: 700, align: 'right' });
    } else {
      p.text('RALLY', 60, 135, { size: 56, font: FONT_D, color: C.dim });
      p.text(String(S.rally), 512, 150, { size: 140, font: FONT_D, weight: 700, align: 'center', color: C.accent });
      p.text(`BEST ${bests[bestKey()] ?? 0}`, 964, 135, { size: 56, font: FONT_D, align: 'right', color: C.dim });
    }
  });
}

// ---------------------------------------------------------------- XR session, controllers, pointer
let xrSession = null, xrMode = null;
const grips = [0, 1].map(i => renderer.xr.getControllerGrip(i));
const ctrls = [0, 1].map(i => renderer.xr.getController(i));
const rays = ctrls.map(c => {
  const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -3)]);
  const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: '#ffb27a' }));
  line.visible = false; c.add(line); return line;
});
[...grips, ...ctrls].forEach(o => scene.add(o));
const handOf = [null, null], sourceOf = [null, null];
grips.forEach((g, i) => {
  g.addEventListener('connected', e => { handOf[i] = e.data.handedness; sourceOf[i] = e.data; applyHand(); });
  g.addEventListener('disconnected', () => { handOf[i] = null; sourceOf[i] = null; applyHand(); });
});
let paddleIdx = -1;
function applyHand() {
  paddle.rotation.x = THREE.MathUtils.degToRad(settings.angle);
  paddle.visible = true;
  if (!xrSession) { desktopHolder.add(paddle); paddleIdx = -1; return; }
  let idx = handOf.indexOf(settings.hand);
  if (idx < 0) idx = handOf.findIndex(h => h);
  paddleIdx = idx;
  if (idx >= 0) grips[idx].add(paddle);
  const off = idx === 0 ? 1 : 0;
  if (xrMode === 'immersive-vr' && handOf[off]) grips[off].add(offHandMarker); else offHandMarker.removeFromParent();
  prevPadValid = false;
}

const raycaster = new THREE.Raycaster();
const tmpM = new THREE.Matrix4();
function pointAt(origin, dir) {
  if (!menu.mesh.visible) return null;
  raycaster.set(origin, dir);
  const hit = raycaster.intersectObject(menu.mesh)[0];
  return hit ? menu.hitTest(hit.uv) : null;
}
const hoverBy = [null, null];
ctrls.forEach((c, i) => c.addEventListener('selectstart', () => {
  initAudio();
  const b = hoverBy[i]; if (b && b.onClick) { b.onClick(); pulse(i, 0.3, 20); }
}));
function updateXRPointers() {
  let hov = null;
  ctrls.forEach((c, i) => {
    hoverBy[i] = null;
    if (!rays[i].visible) return;
    tmpM.identity().extractRotation(c.matrixWorld);
    const o = new THREE.Vector3().setFromMatrixPosition(c.matrixWorld);
    const d = new THREE.Vector3(0, 0, -1).applyMatrix4(tmpM);
    const b = pointAt(o, d); hoverBy[i] = b; if (b) hov = b.id;
  });
  menu.setHover(hov);
}
function pulse(i, strength, ms) {
  try { sourceOf[i]?.gamepad?.hapticActuators?.[0]?.pulse(strength, ms); } catch { /* no haptics */ }
}
const prevButtons = [[], []];
function pollButtons() {
  if (!xrSession) return;
  for (const src of xrSession.inputSources) {
    const i = sourceOf.indexOf(src); if (i < 0 || !src.gamepad) continue;
    const pressed = src.gamepad.buttons.map(b => b.pressed);
    const edge = n => pressed[n] && !prevButtons[i][n];
    if (edge(5)) togglePause();
    prevButtons[i] = pressed;
  }
}
function togglePause() {
  if (S.screen === 'playing') { S.screen = 'paused'; showScreen(); }
  else if (S.screen === 'paused') { S.screen = 'playing'; showScreen(); }
}

const tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
function recenter() {
  if (!xrSession) return;
  // three copies the headset pose into `camera` every XR frame
  const head = new THREE.Vector3(), hq = new THREE.Quaternion();
  camera.matrixWorld.decompose(head, hq, sc);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(hq); fwd.y = 0;
  if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
  fwd.normalize();
  const d = (settings.space === 'small' ? 0.45 : 0.55) + L / 2;
  tableRoot.position.set(head.x + fwd.x * d, 0, head.z + fwd.z * d);
  tableRoot.rotation.set(0, Math.atan2(-fwd.x, -fwd.z), 0);
  tableRoot.updateMatrixWorld(true);
  prevPadValid = false;
}

async function startXR(mode) {
  initAudio();
  const session = await navigator.xr.requestSession(mode, { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
  xrMode = mode; xrSession = session;
  await renderer.xr.setSession(session);
  try { if (session.supportedFrameRates?.includes(90)) await session.updateTargetFrameRate(90); } catch { /* keep default */ }
  const ar = mode === 'immersive-ar';
  env.visible = !ar;
  scene.background = ar ? null : BG;
  renderer.setClearColor(0x000000, ar ? 0 : 1);
  document.body.classList.add('in-game');
  S.screen = 'main'; resetRun(); target.visible = false;
  applyHand(); showScreen();
  setTimeout(recenter, 400);
  session.addEventListener('end', () => {
    xrSession = null; xrMode = null; env.visible = true; scene.background = BG;
    tableRoot.position.set(0, 0, 0); tableRoot.rotation.set(0, 0, 0);
    document.body.classList.remove('in-game');
    resetRun(); S.screen = 'main'; target.visible = false; applyHand(); showScreen();
  });
}

// ---------------------------------------------------------------- desktop controls
const mouse = new THREE.Vector2(0, 0);
let desktopActive = false, swingDown = false, swingAmt = 0, testAim = false;
const deskPos = new THREE.Vector3(0.15, H + 0.25, L / 2 + 0.25);
function startDesktop() {
  initAudio(); desktopActive = true;
  document.body.classList.add('in-game');
  applyHand(); showScreen();
}
canvas.addEventListener('pointermove', e => {
  mouse.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  if (!desktopActive) return;
  raycaster.setFromCamera(mouse, camera);
  const b = pointAt(raycaster.ray.origin, raycaster.ray.direction);
  menu.setHover(b ? b.id : null);
  canvas.style.cursor = b ? 'pointer' : 'default';
});
canvas.addEventListener('pointerdown', e => {
  if (!desktopActive) return;
  raycaster.setFromCamera(mouse, camera);
  const b = pointAt(raycaster.ray.origin, raycaster.ray.direction);
  if (b) { b.onClick?.(); return; }
  if (S.screen === 'playing') swingDown = true;
});
addEventListener('pointerup', () => { swingDown = false; });
addEventListener('keydown', e => {
  if (e.key === 'Escape' && desktopActive) {
    if (S.screen === 'playing' || S.screen === 'paused') togglePause();
    else if (S.screen === 'main') { desktopActive = false; document.body.classList.remove('in-game'); }
  }
});
const planeZ = new THREE.Plane(new THREE.Vector3(0, 0, 1), -(L / 2 + 0.25));
function updateDesktopPaddle(dt) {
  raycaster.setFromCamera(mouse, camera);
  const hit = new THREE.Vector3();
  if (!testAim && raycaster.ray.intersectPlane(planeZ, hit)) {
    deskPos.x = THREE.MathUtils.clamp(hit.x, -1, 1);
    deskPos.y = THREE.MathUtils.clamp(hit.y, H + 0.03, H + 0.7);
  }
  swingAmt = THREE.MathUtils.clamp(swingAmt + (swingDown ? dt / 0.11 : -dt / 0.25), 0, 1);
  const e = 1 - (1 - swingAmt) ** 2;
  // blade faces the table, slightly closed; a click drives it forward and up through the ball
  const n = new THREE.Vector3(0, -0.15, -1).normalize();
  const up = new THREE.Vector3(0.25, 1, 0.1).normalize();
  const zAxis = up.clone().negate().sub(n.clone().multiplyScalar(up.clone().negate().dot(n))).normalize();
  const yAxis = new THREE.Vector3().crossVectors(zAxis, n);
  const m = new THREE.Matrix4().makeBasis(n, yAxis, zAxis);
  const q = new THREE.Quaternion().setFromRotationMatrix(m);
  const centre = new THREE.Vector3(deskPos.x, deskPos.y + e * 0.06, deskPos.z - e * 0.36);
  const off = BLADE_C.clone().applyQuaternion(q);
  desktopHolder.position.copy(centre.sub(off));
  desktopHolder.quaternion.copy(q);
  paddle.rotation.x = 0;
}

// ---------------------------------------------------------------- paddle collision
let prevPadValid = false;
const padPrev = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
const padCur = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
const invRoot = new THREE.Matrix4(), padM = new THREE.Matrix4(), sc = new THREE.Vector3();
const X = new THREE.Vector3(1, 0, 0);
function readPaddlePose() {
  if (!paddle.parent || (xrSession && paddleIdx < 0)) return false;
  tableRoot.updateMatrixWorld(true);
  paddle.updateWorldMatrix(true, false);
  invRoot.copy(tableRoot.matrixWorld).invert();
  padM.multiplyMatrices(invRoot, paddle.matrixWorld);
  padM.decompose(padCur.p, padCur.q, sc);
  return true;
}
const ip = new THREE.Vector3(), iq = new THREE.Quaternion(), bc = new THREE.Vector3(), bn = new THREE.Vector3();
function interpPose(a) {
  ip.lerpVectors(padPrev.p, padCur.p, a); iq.slerpQuaternions(padPrev.q, padCur.q, a);
  bc.copy(BLADE_C).applyQuaternion(iq).add(ip);
  bn.copy(X).applyQuaternion(iq);
}
// Paddle surface velocity at a point (table frame), from last frame's pose to this frame's pose.
function padPointVel(worldPt, frameDt) {
  const local = worldPt.clone().sub(ip).applyQuaternion(iq.clone().invert());
  const a = local.clone().applyQuaternion(padPrev.q).add(padPrev.p);
  const b = local.clone().applyQuaternion(padCur.q).add(padCur.p);
  return b.sub(a).multiplyScalar(1 / frameDt);
}
function paddleSpeed(frameDt) { return padCur.p.distanceTo(padPrev.p) / frameDt; }

function collidePaddle(o, a, frameDt, simScale) {
  interpPose(a);
  const bp = new THREE.Vector3(o.b.p.x, o.b.p.y, o.b.p.z);
  const d = bp.clone().sub(bc);
  const dist = d.dot(bn);
  const radial = d.clone().sub(bn.clone().multiplyScalar(dist)).length();
  const prevDist = o.prevDist;
  o.prevDist = dist;
  if (prevDist === undefined || radial > BLADE_R + BALL_R * 0.6) return false;
  const touching = Math.abs(dist) < BALL_R + 0.005;
  const crossed = Math.sign(dist) !== Math.sign(prevDist);
  if (!touching && !crossed) return false;
  if (S.time - o.lastHit < 0.08) return false;
  const side = Math.sign(prevDist) || 1;
  const n = bn.clone().multiplyScalar(side);
  // world velocity of paddle surface; in slowed time the paddle moves "faster" relative to the sim
  const pv = padPointVel(bp, frameDt).multiplyScalar(1 / simScale);
  const before = P.copy(o.b.v);
  const impact = P.contact(o.b, P.v3(n.x, n.y, n.z), P.v3(pv.x, pv.y, pv.z), 0.82, 0.8);
  if (impact <= 0) return false;
  const out = bc.clone().add(bn.clone().multiplyScalar(side * (BALL_R + 0.0045))).add(d.clone().sub(bn.clone().multiplyScalar(dist)));
  o.b.p = P.v3(out.x, out.y, out.z);
  o.prevDist = side * (BALL_R + 0.0045);
  o.lastHit = S.time;
  if (o.current) P.applyAssist(o.b, ASSIST_DV[settings.assist]);
  const rel = P.len(P.sub(o.b.v, before));
  sfx.paddle(rel * simScale);
  pulse(paddleIdx, Math.min(1, 0.35 + rel / 18), 28);
  return true;
}

// ---------------------------------------------------------------- ball update & rules
const upV = P.v3(0, 1, 0);
function spinColor(b) {
  const vh = P.v3(b.v.x, 0, b.v.z); const l = P.len(vh) || 1;
  const topAxis = P.cross(upV, P.scale(vh, 1 / l));
  const top = P.dot(b.w, topAxis), side = b.w.y;
  if (Math.max(Math.abs(top), Math.abs(side)) < 50) return '#ffffff';
  if (Math.abs(side) > Math.abs(top)) return '#c58cff';
  return top > 0 ? '#ff5a3c' : '#3cb4ff';
}
function handleEvents(o) {
  const evs = o.b.events; o.b.events = [];
  for (const e of evs) {
    if (e.type === 'table') sfx.table(e.speed); else if (e.type === 'net') sfx.net(); else if (e.type === 'floor') sfx.floor(e.speed);
    if (!o.current || o.phase === 'done') continue;
    if (e.type === 'table') {
      if (e.side === 'player') {
        if (o.phase === 'incoming') o.phase = 'live';
        else if (o.phase === 'live') resolve(o, 'miss');
        else if (o.phase === 'returned') resolve(o, 'own');
      } else {
        if (o.phase === 'returned') resolve(o, 'good', e.x, e.z);
        else if (o.phase === 'incoming') { o.phase = 'done'; S.fed--; S.nextFeedAt = S.time + 0.5; } // machine fault, re-feed
      }
    } else if (e.type === 'net' && o.phase === 'returned') resolve(o, 'net');
    else if (e.type === 'floor') resolve(o, o.phase === 'returned' ? 'out' : 'miss');
  }
}
function onPaddleHit(o) {
  S.hits++;
  if (o.current && (o.phase === 'live' || o.phase === 'incoming')) o.phase = 'returned';
}

function updateBalls(dt, frameDt, padOk) {
  const simScale = settings.speed;
  const N = 10;
  const sdt = dt * simScale / N;
  for (const o of balls) {
    if (!o.b) continue;
    o.age += dt;
    for (let i = 0; i < N; i++) {
      P.step(o.b, sdt, 0);
      if (padOk && collidePaddle(o, (i + 1) / N, frameDt, simScale)) onPaddleHit(o);
      handleEvents(o);
    }
    const p = o.b.p;
    if (o.current && o.phase !== 'done' && (p.z > L / 2 + 2.2 || o.age > 7)) resolve(o, 'miss');
    if (o.age > 9 || p.y < -2) { hideBall(o); continue; }
    // visuals
    o.mesh.position.set(p.x, p.y, p.z);
    const wl = P.len(o.b.w);
    if (wl > 0.1) o.mesh.quaternion.premultiply(tmpQ.setFromAxisAngle(tmpV.set(o.b.w.x / wl, o.b.w.y / wl, o.b.w.z / wl), wl * dt * simScale));
    const overTable = Math.abs(p.x) <= W / 2 && Math.abs(p.z) <= L / 2 && p.y >= H;
    const sy = overTable ? H + 0.001 : 0.003;
    o.shadow.position.set(p.x, sy, p.z);
    const hgt = p.y - sy;
    o.shadow.material.opacity = Math.max(0, 0.45 - hgt * 0.35);
    o.shadow.scale.setScalar(1 + hgt * 0.8);
    o.trail.visible = settings.spinFx && o.age > 0.05;
    if (o.trail.visible) {
      o.trailPts.unshift(p.x, p.y, p.z); if (o.trailPts.length > TRAIL_N * 3) o.trailPts.length = TRAIL_N * 3;
      const arr = o.trail.geometry.attributes.position.array;
      for (let i = 0; i < TRAIL_N; i++) { const j = Math.min(i * 3, o.trailPts.length - 3); arr[i * 3] = o.trailPts[j]; arr[i * 3 + 1] = o.trailPts[j + 1]; arr[i * 3 + 2] = o.trailPts[j + 2]; }
      o.trail.geometry.attributes.position.needsUpdate = true;
      o.trail.material.color.set(spinColor(o.b));
    }
  }
}

// ---------------------------------------------------------------- main loop
const clock = new THREE.Clock();
const headPos = new THREE.Vector3();
function trackWorkout(dt, frameDt) {
  headPos.setFromMatrixPosition(camera.matrixWorld);
  if (S.lastHead) {
    const dx = headPos.x - S.lastHead.x, dz = headPos.z - S.lastHead.z;
    const step = Math.hypot(dx, dz), spd = step / dt;
    if (spd > 0.05 && spd < 4) S.headDist += step;
  }
  S.lastHead = headPos.clone();
  const ps = paddleSpeed(frameDt);
  if (S.swingArmed && ps > 3) { S.swings++; S.swingArmed = false; }
  if (ps < 1) S.swingArmed = true;
}

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 1 / 30);
  if (!xrSession && !desktopActive) {
    // idle preview behind the start card: slow orbit around the table
    const t = performance.now() / 9000;
    camera.position.set(Math.sin(t) * 3.2, 1.7, Math.cos(t) * 3.2);
    camera.lookAt(0, 0.8, 0);
    renderer.render(scene, camera);
    return;
  }
  if (!xrSession) {
    camera.position.set(0, 1.62, L / 2 + 1.25); camera.lookAt(0, 0.9, -0.5);
    updateDesktopPaddle(dt);
    paddle.visible = S.screen === 'playing';
  }
  pollButtons();
  if (xrSession) updateXRPointers();

  const padOk = readPaddlePose();
  if (padOk && !prevPadValid) { padPrev.p.copy(padCur.p); padPrev.q.copy(padCur.q); prevPadValid = true; }
  const playing = S.screen === 'playing';
  if (playing) {
    S.time += dt; S.playTime += dt;
    if (S.time >= S.nextFeedAt - 0.6 && !S.pendingShot && S.nextFeedAt !== Infinity) {
      const level = S.mode === 'rally' ? DIFF_LEVEL[settings.difficulty] + S.rally : DIFF_LEVEL[settings.difficulty];
      S.pendingShot = makeShot(level);
    }
    if (S.time >= S.nextFeedAt) feed();
    if (S.time >= S.finishAt) { S.finishAt = Infinity; finishRun(); }
    updateBalls(dt, dt, padOk);
    trackWorkout(dt, dt);
    drawHud();
  }
  // machine cue light and aim
  const cue = S.nextFeedAt !== Infinity && playing ? THREE.MathUtils.clamp(1 - (S.nextFeedAt - S.time) / 0.6, 0, 1) : 0;
  machineLight.color.setRGB(0.25 + cue * 0.75, 0.13 + cue * 0.35, 0.04);
  if (S.pendingShot) { const v = S.pendingShot.v; machine.nozzle.lookAt(tmpV.set(NOZZLE.x + v.x, NOZZLE.y + v.y, NOZZLE.z + v.z).applyMatrix4(tableRoot.matrixWorld)); }
  if (target.visible) target.fill.material.opacity = 0.16 + 0.1 * Math.sin(performance.now() / 220);
  if (pop.mesh.visible) {
    popT += dt; pop.mesh.position.y += dt * 0.12;
    pop.mesh.material.opacity = Math.max(0, 1 - Math.max(0, popT - 0.5) / 0.5);
    pop.mesh.lookAt(tmpV.setFromMatrixPosition(camera.matrixWorld));
    if (popT > 1) pop.mesh.visible = false;
  }
  if (padOk) { padPrev.p.copy(padCur.p); padPrev.q.copy(padCur.q); }
  renderer.render(scene, camera);
});

// ---------------------------------------------------------------- start page wiring
const btnAR = document.getElementById('enter-ar');
const btnVR = document.getElementById('enter-vr');
const note = document.getElementById('xr-note');
const btnDesk = document.getElementById('play-desktop');
const weightIn = document.getElementById('weight');
weightIn.value = settings.weight;
weightIn.addEventListener('change', () => {
  const w = Math.round(Number(weightIn.value));
  if (w >= 30 && w <= 250) { settings.weight = w; saveSettings(); } else weightIn.value = settings.weight;
});
btnDesk.addEventListener('click', startDesktop);
function renderBests() {
  const el = document.getElementById('bests');
  const rows = [];
  for (const m of ['drills', 'rally']) for (const d of ['easy', 'medium', 'hard']) {
    const v = bests[`${m}.${d}`]; if (v != null) rows.push(`<li><span>${MODE_NAME[m]} · ${cap(d)}</span><b>${v}</b></li>`);
  }
  el.innerHTML = rows.join('');
  document.getElementById('bests-empty').hidden = rows.length > 0;
}
renderBests();
(async () => {
  if (!navigator.xr) { note.textContent = 'This browser has no WebXR. Open the page in the Meta Quest Browser to play in your room.'; return; }
  const [ar, vr] = await Promise.all(['immersive-ar', 'immersive-vr'].map(m => navigator.xr.isSessionSupported(m).catch(() => false)));
  if (ar) { btnAR.disabled = false; note.textContent = 'Ready. Clear a space about 2 × 3 m and press Start in your room.'; }
  if (vr) { btnVR.hidden = false; btnVR.disabled = false; }
  if (!ar && vr) note.textContent = 'Passthrough isn\'t available here, so the game runs in a virtual room.';
  if (!ar && !vr) note.textContent = 'No headset found. Open the page in the Meta Quest Browser to play in your room.';
  const go = mode => startXR(mode).catch(err => { note.textContent = `Couldn't start: ${err.message}`; });
  btnAR.addEventListener('click', () => go('immersive-ar'));
  btnVR.addEventListener('click', () => go('immersive-vr'));
})();
document.fonts?.ready.then(() => menu.redraw());
showScreen();
applyHand();
window.__topspin = { S, settings, startMode, balls, P,
  showScreen, finishRun, aim(x, y) { testAim = true; deskPos.x = x; deskPos.y = y; }, swing(v) { swingDown = v; } };
