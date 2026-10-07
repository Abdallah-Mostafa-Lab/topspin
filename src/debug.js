import * as THREE from 'three';
import { BLADE } from './paddleModel.js';

// A recorded shot ("rec"):
//   frames: [[t, px,py,pz, qx,qy,qz,qw, bx,by,bz], ...]  paddle mount pose + ball centre, table frame, every rendered frame
//   hits:   [{ t, side:'red'|'black', n, pv, bIn:{p,v,w}, bOut:{v,w}, assistDv, uv }]
//   outcome: 'good' | 'net' | 'own' | 'out' | 'miss',  land: {x,z} | null
const r4 = x => Math.round(x * 1e4) / 1e4;
const r5 = x => Math.round(x * 1e5) / 1e5;
export function frameRow(t, p, q, b) {
  return [r4(t), r4(p.x), r4(p.y), r4(p.z), r5(q.x), r5(q.y), r5(q.z), r5(q.w),
    b ? r4(b.x) : null, b ? r4(b.y) : null, b ? r4(b.z) : null];
}
export const vround = v => ({ x: r4(v.x), y: r4(v.y), z: r4(v.z) });

const deg = r => r * 180 / Math.PI;
const hyp = (a, b) => Math.hypot(a, b);
// Spin split into top/back (positive = topspin) and side, relative to the ball's travel direction, in revolutions/s.
export function spinParts(v, w) {
  const l = hyp(v.x, v.z) || 1;
  const top = (w.x * v.z - w.z * v.x) / l; // ω · (up × v̂)
  return { top: top / (2 * Math.PI), side: w.y / (2 * Math.PI) };
}
function spinText(v, w) {
  const s = spinParts(v, w);
  if (Math.abs(s.top) < 6 && Math.abs(s.side) < 6) return 'almost no spin';
  if (Math.abs(s.side) > Math.abs(s.top)) return `sidespin ${Math.abs(s.side).toFixed(0)} r/s`;
  return `${s.top > 0 ? 'topspin' : 'backspin'} ${Math.abs(s.top).toFixed(0)} r/s`;
}
const cm = m => `${Math.abs(m * 100).toFixed(0)} cm`;

// Where the ball passed the paddle when there was no contact.
function whiff(rec) {
  const q = new THREE.Quaternion(), qi = new THREE.Quaternion(), p = new THREE.Vector3(), b = new THREE.Vector3(), loc = new THREE.Vector3();
  const rows = rec.frames.filter(f => f[8] !== null);
  let prev = null, best = null;
  for (const f of rows) {
    p.set(f[1], f[2], f[3]); q.set(f[4], f[5], f[6], f[7]); b.set(f[8], f[9], f[10]);
    qi.copy(q).invert();
    loc.copy(b).sub(p).applyQuaternion(qi).sub(BLADE.c); // ball in blade coordinates: x = through the face
    const cur = { t: f[0], d: loc.x, u: loc.y, v: loc.z, q: q.clone(), bz: b.z, pz: p.z + BLADE.c.clone().applyQuaternion(q).z,
      dist: Math.hypot(loc.x, loc.y, loc.z) };
    if (b.z > 0 && (!best || cur.dist < best.dist)) best = cur;
    if (prev && b.z > 0 && Math.sign(prev.d) !== Math.sign(cur.d)) {
      const k = prev.d / (prev.d - cur.d);
      const u = prev.u + (cur.u - prev.u) * k, v = prev.v + (cur.v - prev.v) * k;
      const off = new THREE.Vector3(0, u, v).applyQuaternion(cur.q); // blade-centre → ball, table frame
      return { crossed: true, t: cur.t, dx: off.x, dy: off.y, dz: off.z };
    }
    prev = cur;
  }
  if (!best) return { crossed: false, never: true };
  return { crossed: false, t: best.t, dist: best.dist, behind: best.bz > best.pz + 0.03, ahead: best.bz < best.pz - 0.03 };
}

// Turn a recorded shot into the readout: a headline, detail rows and one tip.
export function analyze(rec) {
  const RES = { good: ['ON THE TABLE', 'good'], net: ['NET', 'bad'], own: ['OWN SIDE', 'bad'], out: ['OUT', 'bad'], miss: ['MISSED', 'bad'] };
  const [head, tone] = RES[rec.outcome] || ['—', 'dim'];
  const h = rec.hits[0];
  if (!h) {
    const w = whiff(rec);
    const rows = [];
    let tip;
    if (w.crossed) {
      const vert = Math.abs(w.dy) > 0.01 ? `${cm(w.dy)} ${w.dy > 0 ? 'above' : 'below'}` : '';
      const side = Math.abs(w.dx) > 0.01 ? `${cm(w.dx)} ${w.dx > 0 ? 'right of' : 'left of'}` : '';
      rows.push(['Ball passed', [vert, side].filter(Boolean).join(', ') + ' the blade centre']);
      tip = Math.abs(w.dy) >= Math.abs(w.dx)
        ? (w.dy > 0 ? 'Your blade was too low at contact. Start the swing a little higher.' : 'Your blade was too high at contact. Start lower and brush up through the ball.')
        : 'Line up sideways with the ball before you swing.';
    } else if (w.never) {
      rows.push(['Ball', 'never reached your side']);
      tip = 'The machine missed. This one does not count against you.';
    } else {
      rows.push(['Closest', `${cm(w.dist)} from the blade centre`]);
      tip = w.behind ? 'Swing was late: the ball was already past the blade. Start the swing earlier.'
        : w.ahead ? 'Swing was early: the blade had passed before the ball arrived. Wait a little longer.'
        : 'The blade never got close to the ball. Watch the bounce and move toward it.';
    }
    return { head: head + ' · NO CONTACT', tone, rows, tip };
  }
  const n = h.n, pv = h.pv;
  const closed = deg(Math.asin(-Math.max(-1, Math.min(1, n.y))));
  const sp = Math.hypot(pv.x, pv.y, pv.z);
  const up = deg(Math.atan2(pv.y, hyp(pv.x, pv.z)));
  const outV = h.bOutAssist || h.bOut.v;
  const launch = deg(Math.atan2(outV.y, hyp(outV.x, outV.z)));
  const offC = Math.hypot(h.uv.u, h.uv.v);
  const where = offC < 0.03 ? 'sweet spot' : `${cm(offC)} ${Math.abs(h.uv.v) > Math.abs(h.uv.u) ? (h.uv.v < 0 ? 'toward the tip' : 'toward the handle') : 'toward the edge'}`;
  const asst = h.assistDv ? Math.hypot(h.assistDv.x, h.assistDv.y, h.assistDv.z) : 0;
  const rows = [
    ['Face', `${h.side === 'red' ? 'red (forehand)' : 'black (backhand)'} · ${closed >= 0 ? 'closed' : 'open'} ${Math.abs(closed).toFixed(0)}°`],
    ['Swing', `${sp.toFixed(1)} m/s · ${up >= 0 ? up.toFixed(0) + '° upward' : (-up).toFixed(0) + '° downward'}`],
    ['Contact', where],
    ['Ball in', `${Math.hypot(h.bIn.v.x, h.bIn.v.y, h.bIn.v.z).toFixed(1)} m/s · ${spinText(h.bIn.v, h.bIn.w)}`],
    ['Ball out', `${Math.hypot(outV.x, outV.y, outV.z).toFixed(1)} m/s · ${launch.toFixed(0)}° launch · ${spinText(outV, h.bOut.w)}`],
  ];
  if (asst > 0.05) rows.push(['Assist', `nudged ${asst.toFixed(1)} m/s`]);
  if (rec.hits.length > 1) rows.push(['Note', `${rec.hits.length} paddle contacts`]);
  let tip;
  if (rec.outcome === 'good') tip = 'Good shot. Repeat that face angle and swing.';
  else if (rec.outcome === 'net' || rec.outcome === 'own') tip = launch < 4 ? 'Ball left too low. Open the face a little or brush more upward.' : 'Ball dipped short. Swing a little more forward through the ball.';
  else if (rec.outcome === 'out') tip = launch > 18 ? 'Ball left too high. Close the face more.' : 'Ball went long. Swing more upward and less forward, or slower.';
  else tip = 'The ball was touched but did not come back over the net.';
  return { head, tone, rows, tip };
}

// Replay window: from a little before contact (or the closest pass) to the end of the recording.
export function replayWindow(rec) {
  const f = rec.frames; if (!f.length) return null;
  const t0 = f[0][0], tEnd = f[f.length - 1][0];
  let key = rec.hits[0] ? rec.hits[0].t : null;
  if (key === null) { const w = whiff(rec); key = w.t ?? tEnd - 0.4; }
  return { start: Math.max(t0, key - 0.7), end: Math.min(tEnd, key + 0.6) };
}
