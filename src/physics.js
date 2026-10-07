// Ball physics for TopSpin VR. Pure functions on plain {x,y,z} vectors so it runs in node tests.
// Table frame: origin on the floor under the table centre, +y up, player end at +z, net at z = 0.

export const BALL_R = 0.02;          // 40 mm ball
export const BALL_M = 0.0027;        // 2.7 g
export const BALL_I = (2 / 3) * BALL_M * BALL_R * BALL_R; // thin hollow sphere
export const G = 9.81;
export const KD = 0.11;              // drag: a = -KD |v| v   (0.5·ρ·Cd·A / m)
export const KM = 0.0012;            // Magnus: a = KM (ω × v)
export const SPIN_DECAY = 0.12;      // 1/s, air slowly bleeds spin

export const TABLE = { L: 2.74, W: 1.525, H: 0.76, NET_H: 0.1525, NET_HALF_W: 0.915 };
// Paddle rubber: bounce, grip and tangential rebound. Tuned so brushing topspin strokes behave like real inverted rubber.
export const RUBBER = { e: 0.7, mu: 1.5, et: 0.5 };
export const SURFACE_Y = TABLE.H + BALL_R; // ball centre height when resting on the table

export const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const add = (a, b) => v3(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a, b) => v3(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (a, s) => v3(a.x * s, a.y * s, a.z * s);
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a, b) => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const len = (a) => Math.hypot(a.x, a.y, a.z);
export const copy = (a) => v3(a.x, a.y, a.z);

export function makeBall(pos, vel, spin) {
  return { p: copy(pos), v: copy(vel), w: copy(spin || v3()), events: [] };
}

// Acceleration from gravity, drag and Magnus lift.
function accel(v, w) {
  const s = len(v);
  const m = cross(w, v);
  return v3(-KD * s * v.x + KM * m.x, -G - KD * s * v.y + KM * m.y, -KD * s * v.z + KM * m.z);
}

// Impulse contact against a surface with normal n moving at surfVel.
// Handles bounce (restitution e) and friction (mu) that trades speed for spin and back.
// et > 0 models grippy rubber: the ball leaves "over-rolling" (slip reversed by et), as inverted rubber does.
export function contact(ball, n, surfVel, e, mu, et = 0) {
  const vr = sub(ball.v, surfVel);
  const vn = dot(vr, n);
  if (vn >= 0) return 0;
  const jn = -(1 + e) * vn * BALL_M;
  const rc = scale(n, -BALL_R);
  const vcp = add(vr, cross(ball.w, rc));
  const vt = sub(vcp, scale(n, dot(vcp, n)));
  const vtLen = len(vt);
  let jtVec = v3();
  if (vtLen > 1e-6) {
    // Impulse that would stop slipping completely (ball rolls off the surface): m|vt| / (1 + m r²/I) = 0.4 m |vt|
    const jStick = vtLen * BALL_M / (1 + BALL_M * BALL_R * BALL_R / BALL_I);
    const jt = Math.min(mu * jn, (1 + et) * jStick);
    jtVec = scale(vt, -jt / vtLen);
  }
  const J = add(scale(n, jn), jtVec);
  ball.v = add(ball.v, scale(J, 1 / BALL_M));
  ball.w = add(ball.w, scale(cross(rc, jtVec), 1 / BALL_I));
  return -vn;
}

// Below this downward speed a contact is the ball resting or rolling, not a bounce:
// no event and no sound, otherwise a ball at rest "bounces" every physics step.
export const REST_SPEED = 0.3;
function settle(ball, dt) {
  ball.v.y = 0;
  const k = Math.exp(-1.2 * dt); // rolling resistance
  ball.v.x *= k; ball.v.z *= k;
  ball.w = scale(ball.w, Math.exp(-3 * dt));
}

// Integrate one small step (≤ 2 ms) including table, net and floor contacts.
export function step(ball, dt, floorY = 0) {
  const prev = copy(ball.p);
  const a = accel(ball.v, ball.w);
  ball.v = add(ball.v, scale(a, dt));
  ball.p = add(ball.p, scale(ball.v, dt));
  const k = Math.exp(-SPIN_DECAY * dt);
  ball.w = scale(ball.w, k);

  const { L, W, H, NET_H, NET_HALF_W } = TABLE;
  // Table top
  if (ball.v.y < 0 && ball.p.y < SURFACE_Y && prev.y >= SURFACE_Y - 0.03 &&
      Math.abs(ball.p.x) <= W / 2 && Math.abs(ball.p.z) <= L / 2) {
    ball.p.y = SURFACE_Y;
    if (-ball.v.y < REST_SPEED) settle(ball, dt);
    else {
      const speed = contact(ball, v3(0, 1, 0), v3(), 0.89, 0.25);
      ball.events.push({ type: 'table', side: ball.p.z > 0 ? 'player' : 'far', x: ball.p.x, z: ball.p.z, speed });
    }
  }
  // Net: thin vertical wall at z = 0
  const crosses = (prev.z > BALL_R && ball.p.z <= BALL_R) || (prev.z < -BALL_R && ball.p.z >= -BALL_R);
  if (crosses && ball.p.y < TABLE.H + NET_H + BALL_R && ball.p.y > TABLE.H - 0.02 && Math.abs(ball.p.x) < NET_HALF_W) {
    const side = Math.sign(prev.z) || 1;
    if (ball.p.y > TABLE.H + NET_H) {
      // clips the net cord: loses pace and pops up, then carries on over
      ball.v = v3(ball.v.x * 0.7, Math.abs(ball.v.y) * 0.5 + 0.6, ball.v.z * 0.45);
      ball.events.push({ type: 'netcord' });
    } else {
      ball.p.z = side * BALL_R;
      ball.v = v3(ball.v.x * 0.4, ball.v.y * 0.4, -ball.v.z * 0.12);
      ball.w = scale(ball.w, 0.3);
      ball.events.push({ type: 'net', speed: Math.abs(ball.v.z) });
    }
  }
  // Floor
  if (ball.v.y < 0 && ball.p.y < floorY + BALL_R) {
    ball.p.y = floorY + BALL_R;
    if (-ball.v.y < REST_SPEED) settle(ball, dt);
    else {
      const speed = contact(ball, v3(0, 1, 0), v3(), 0.7, 0.4);
      ball.events.push({ type: 'floor', speed });
    }
  }
}

// Flight prediction without contacts: where does the ball come down to height y?
export function predict(p0, v0, w0, y, maxT = 3) {
  const b = { p: copy(p0), v: copy(v0), w: copy(w0) };
  const dt = 1 / 400;
  let t = 0, netY = null;
  while (t < maxT) {
    const prevZ = b.p.z, prevY = b.p.y;
    const a = accel(b.v, b.w);
    b.v = add(b.v, scale(a, dt));
    b.p = add(b.p, scale(b.v, dt));
    b.w = scale(b.w, Math.exp(-SPIN_DECAY * dt));
    t += dt;
    if (netY === null && Math.sign(prevZ) !== Math.sign(b.p.z) && prevZ !== 0) netY = prevY;
    if (b.v.y < 0 && b.p.y <= y) return { x: b.p.x, z: b.p.z, t, netY, v: b.v, w: b.w };
  }
  return null;
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Find a launch velocity from `from` that lands on the table at (tx, tz) with the given spin.
// `flight` is the rough flight time: shorter = faster shot.
export function solveShot(from, tx, tz, spin, flight) {
  const netClear = TABLE.H + TABLE.NET_H + BALL_R + 0.03;
  let T = flight;
  for (let tries = 0; tries < 8; tries++) {
    const dy = SURFACE_Y - from.y;
    const v = v3((tx - from.x) / T, (dy + 0.5 * G * T * T) / T, (tz - from.z) / T);
    let r = null;
    for (let i = 0; i < 10; i++) {
      r = predict(from, v, spin, SURFACE_Y);
      if (!r) break;
      v.x += (tx - r.x) / r.t;
      v.z += (tz - r.z) / r.t;
    }
    r = predict(from, v, spin, SURFACE_Y);
    if (r && Math.abs(r.x - tx) < 0.03 && Math.abs(r.z - tz) < 0.03 && (r.netY === null || r.netY > netClear)) return v;
    T *= 1.12; // loftier and slower until it clears the net
  }
  return null;
}

// Hit assist: nudge a return toward the far half of the table, never by more than maxDv (m/s).
export function applyAssist(ball, maxDv) {
  if (maxDv <= 0 || ball.v.z > -0.5) return false;
  const { L, W, H, NET_H } = TABLE;
  const m = 0.1;
  const orig = copy(ball.v);
  const v = copy(ball.v);
  for (let i = 0; i < 4; i++) {
    const r = predict(ball.p, v, ball.w, SURFACE_Y);
    if (!r) break;
    const dx = clamp(r.x, -W / 2 + m, W / 2 - m) - r.x;
    const dz = clamp(r.z, -L / 2 + m, -0.15) - r.z;
    let dy = 0;
    const need = H + NET_H + BALL_R + 0.02;
    if (r.netY !== null && r.netY < need && ball.p.z > 0) dy = (need - r.netY) / Math.max(0.15, r.t * 0.5);
    if (Math.abs(dx) < 0.005 && Math.abs(dz) < 0.005 && dy === 0) break;
    v.x += dx / r.t; v.z += dz / r.t; v.y += dy;
  }
  let d = sub(v, orig);
  const dl = len(d);
  if (dl < 1e-4) return false;
  if (dl > maxDv) d = scale(d, maxDv / dl);
  ball.v = add(orig, d);
  return true;
}
