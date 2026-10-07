import * as THREE from 'three';

// A flat canvas-textured panel that can be pointed at with a controller ray or the mouse.
export const C = {
  bg: 'rgba(9, 28, 51, 0.94)',
  line: 'rgba(255, 255, 255, 0.85)',
  faint: 'rgba(255, 255, 255, 0.18)',
  fg: '#f4f8fc',
  dim: '#9fb6cf',
  accent: '#ff7a1a',
  accentInk: '#241000',
  btn: '#174a7c',
  btnHover: '#22629f',
  good: '#5be3a1',
  bad: '#ff7a8a',
};
export const FONT_D = '"Saira Condensed", "Arial Narrow", sans-serif';
export const FONT_B = '"Atkinson Hyperlegible", "Segoe UI", sans-serif';

export class Panel {
  constructor(pxW, pxH, worldW, { interactive = true, transparent = false } = {}) {
    this.W = pxW; this.H = pxH;
    this.canvas = document.createElement('canvas');
    this.canvas.width = pxW; this.canvas.height = pxH;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    const worldH = worldW * pxH / pxW;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(worldW, worldH),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: !transparent, toneMapped: false })
    );
    this.mesh.renderOrder = transparent ? 10 : 5;
    this.interactive = interactive;
    this.buttons = [];
    this.hover = null;
    this.drawFn = null;
  }
  setDraw(fn) { this.drawFn = fn; this.redraw(); }
  redraw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.W, this.H);
    this.buttons = [];
    if (this.drawFn) this.drawFn(this);
    this.tex.needsUpdate = true;
  }
  // --- drawing helpers ---
  frame() {
    const ctx = this.ctx, W = this.W, H = this.H;
    ctx.fillStyle = C.bg;
    ctx.beginPath(); ctx.roundRect(4, 4, W - 8, H - 8, 28); ctx.fill();
    // white edge line like a table's side line, plus the centre line
    ctx.strokeStyle = C.line; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.roundRect(14, 14, W - 28, H - 28, 20); ctx.stroke();
  }
  text(str, x, y, { size = 34, color = C.fg, font = FONT_B, weight = 400, align = 'left', base = 'alphabetic' } = {}) {
    const ctx = this.ctx;
    ctx.font = `${weight} ${size}px ${font}`;
    ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = base;
    ctx.fillText(str, x, y);
  }
  button(id, label, x, y, w, h, { active = false, primary = false, size = 34, onClick } = {}) {
    const ctx = this.ctx;
    const hov = this.hover === id;
    ctx.fillStyle = active || primary ? C.accent : hov ? C.btnHover : C.btn;
    if ((active || primary) && hov) ctx.fillStyle = '#ff9447';
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 14); ctx.fill();
    if (hov) { ctx.strokeStyle = C.fg; ctx.lineWidth = 4; ctx.stroke(); }
    this.text(label, x + w / 2, y + h / 2 + 1, { size, align: 'center', base: 'middle', weight: 700, font: FONT_D,
      color: active || primary ? C.accentInk : C.fg });
    this.buttons.push({ id, x, y, w, h, onClick });
  }
  hitTest(uv) {
    const px = uv.x * this.W, py = (1 - uv.y) * this.H;
    return this.buttons.find(b => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) || null;
  }
  setHover(id) { if (id !== this.hover) { this.hover = id; this.redraw(); } }
}
