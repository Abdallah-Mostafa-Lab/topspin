// Small synthesized sound kit: no audio files needed.
let ctx = null, master = null, noiseBuf = null;
export let enabled = true;
export function setEnabled(v) { enabled = v; }

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0.8; master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch { ctx = null; }
}

function click(freq, q, dur, gain, toneFreq = 0, toneGain = 0) {
  if (!ctx || !enabled) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource(); src.buffer = noiseBuf;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp); bp.connect(g); g.connect(master); src.start(t); src.stop(t + dur + 0.02);
  if (toneFreq) {
    const o = ctx.createOscillator(); o.frequency.value = toneFreq;
    const og = ctx.createGain(); og.gain.setValueAtTime(toneGain, t); og.gain.exponentialRampToValueAtTime(0.0001, t + dur * 1.4);
    o.connect(og); og.connect(master); o.start(t); o.stop(t + dur * 1.5);
  }
}

const k = (s, lo, hi) => Math.max(lo, Math.min(hi, s));
export const sfx = {
  paddle: (speed) => speed > 0.4 && click(2400, 1.2, 0.05, k(0.25 + speed / 14, 0.25, 1.1), 1150, k(0.15 + speed / 30, 0.1, 0.5)),
  table: (speed) => speed > 0.3 && click(1700, 1.5, 0.04, k(speed / 6, 0.05, 0.8), 2300, k(speed / 25, 0.02, 0.12)),
  net: () => click(350, 0.8, 0.12, 0.6),
  floor: (speed) => speed > 0.3 && click(900, 1, 0.05, k(speed / 10, 0.03, 0.4)),
  launch: () => click(500, 0.7, 0.09, 0.5, 140, 0.4),
  tone(freqs, gain = 0.18, dur = 0.14) {
    if (!ctx || !enabled) return;
    const t0 = ctx.currentTime;
    freqs.forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
      const g = ctx.createGain(); const t = t0 + i * dur * 0.7;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
    });
  },
  good() { this.tone([660, 990]); },
  target() { this.tone([660, 880, 1320], 0.22); },
  bad() { this.tone([220, 165], 0.16, 0.2); },
};
