import * as THREE from 'three';

// Competition-style shakehand paddle, built in "mount" space:
//   +X / -X = the two rubber faces, -Z = from the handle toward the blade tip, Y = across the blade.
// Grip origin (where the controller is held) sits on the handle.
export const BLADE = { a: 0.0755, b: 0.0785, n: 2.5, c: new THREE.Vector3(0, 0, -0.155) }; // half-width, half-length, squareness
const WOOD_T = 0.0058, RUB_T = 0.0021; // blade core and each rubber sheet (sponge + topsheet)

// Rounded-square blade outline (a superellipse), the classic shape of a modern blade.
function bladeShape(grow = 0) {
  const s = new THREE.Shape();
  const a = BLADE.a + grow, b = BLADE.b + grow, n = BLADE.n, N = 96;
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * Math.PI * 2, c = Math.cos(t), si = Math.sin(t);
    const x = a * Math.sign(c) * Math.abs(c) ** (2 / n), y = b * Math.sign(si) * Math.abs(si) ** (2 / n);
    i === 0 ? s.moveTo(x, y) : s.lineTo(x, y);
  }
  return s;
}
// Shape (sx, sy) extruded along e  →  mount (X = e, Y = -sx, Z = -sy), centred on the blade centre.
function toBlade(geo, depth, xOff) {
  geo.translate(0, 0, -depth / 2);
  geo.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, 0, -1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 0, 1));
  geo.translate(xOff, BLADE.c.y, BLADE.c.z);
  return geo;
}

function rubberTexture(base, dark) {
  // fine topsheet grain so the rubber reads as rubber, not paint
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = base; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    x.fillStyle = Math.random() < 0.5 ? dark : 'rgba(255,255,255,0.05)';
    x.fillRect(Math.random() * 256, Math.random() * 256, 1, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(12, 12);
  return t;
}

function handleTexture() {
  // dark stained wood with a pale centre inlay and two thin light pinstripes along the handle
  const c = document.createElement('canvas'); c.width = 128; c.height = 512;
  const x = c.getContext('2d');
  x.fillStyle = '#2a2523'; x.fillRect(0, 0, 128, 512);
  for (let i = 0; i < 60; i++) { // grain
    x.strokeStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '90,80,74'},0.25)`; x.lineWidth = 1 + Math.random();
    const px = Math.random() * 128; x.beginPath(); x.moveTo(px, 0); x.bezierCurveTo(px + 6, 170, px - 6, 340, px + 3, 512); x.stroke();
  }
  x.fillStyle = '#bfa992'; x.fillRect(52, 0, 24, 512);              // pale ash inlay
  x.fillStyle = '#8f7a68'; x.fillRect(52, 0, 2, 512); x.fillRect(74, 0, 2, 512);
  x.fillStyle = '#e3d6c6'; x.fillRect(30, 0, 3, 512); x.fillRect(95, 0, 3, 512); // pinstripes
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildPaddle() {
  const group = new THREE.Group();
  const tape = new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.45, metalness: 0.1 });
  const woodFace = new THREE.MeshStandardMaterial({ color: '#d9b98c', roughness: 0.8 });

  // blade core: the rim is the black edge tape
  const core = new THREE.Mesh(toBlade(new THREE.ExtrudeGeometry(bladeShape(0.0004), { depth: WOOD_T, bevelEnabled: false, curveSegments: 1 }), WOOD_T, 0), [woodFace, tape]);
  group.add(core);

  const red = new THREE.MeshStandardMaterial({ map: rubberTexture('#dc1f2c', 'rgba(90,0,8,0.18)'), roughness: 0.5 });
  const black = new THREE.MeshStandardMaterial({ map: rubberTexture('#121315', 'rgba(255,255,255,0.06)'), roughness: 0.62 });
  const sheet = () => new THREE.ExtrudeGeometry(bladeShape(), { depth: RUB_T, bevelEnabled: false, curveSegments: 1 });
  const off = WOOD_T / 2 + RUB_T / 2;
  const redSheet = new THREE.Mesh(toBlade(sheet(), RUB_T, 0), [red, tape]);
  const blackSheet = new THREE.Mesh(toBlade(sheet(), RUB_T, 0), [black, tape]);
  group.add(redSheet, blackSheet);

  // flared handle: rounded-rectangle section, wider toward the butt
  const W = 0.0155, T = 0.0122, r = 0.0065, LEN = 0.1;
  const sec = new THREE.Shape();
  sec.moveTo(-W + r, -T); sec.lineTo(W - r, -T); sec.quadraticCurveTo(W, -T, W, -T + r); sec.lineTo(W, T - r);
  sec.quadraticCurveTo(W, T, W - r, T); sec.lineTo(-W + r, T); sec.quadraticCurveTo(-W, T, -W, T - r);
  sec.lineTo(-W, -T + r); sec.quadraticCurveTo(-W, -T, -W + r, -T);
  const hg = new THREE.ExtrudeGeometry(sec, { depth: LEN, steps: 12, bevelEnabled: false, curveSegments: 4 });
  const pos = hg.attributes.position, uv = hg.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const sx = pos.getX(i), sy = pos.getY(i), e = pos.getZ(i);
    const k = e / LEN; // 0 at butt, 1 at blade
    const flare = 1 + 0.2 * (1 - k) ** 2 + 0.12 * k ** 4;
    pos.setXYZ(i, sy * (1 + 0.06 * (1 - k)), sx * flare, 0.025 - e);
    uv.setXY(i, (sx / W + 1) / 2, k);
  }
  hg.computeVertexNormals();
  const endGrain = new THREE.MeshStandardMaterial({ color: '#cdb497', roughness: 0.85 });
  const handle = new THREE.Mesh(hg, [endGrain, new THREE.MeshStandardMaterial({ map: handleTexture(), roughness: 0.5 })]);
  group.add(handle);

  // throat: light wood shoulders where the handle meets the blade
  const throat = new THREE.Mesh(new THREE.BoxGeometry(WOOD_T + 2 * RUB_T - 0.0006, 0.034, 0.012), new THREE.MeshStandardMaterial({ color: '#cfb08a', roughness: 0.75 }));
  throat.position.set(0, 0, -0.077); group.add(throat);

  // Which side is red. sign = +1 puts red on +X.
  function setRedSide(sign) {
    redSheet.position.x = sign * off;
    blackSheet.position.x = -sign * off;
  }
  setRedSide(1);
  return { group, setRedSide };
}

// Is a point (in blade-plane coordinates u across, v along, metres from the blade centre) over the blade, with margin?
export function overBlade(u, v, margin) {
  const { a, b, n } = BLADE;
  return (Math.abs(u) / (a + margin)) ** n + (Math.abs(v) / (b + margin)) ** n <= 1;
}
