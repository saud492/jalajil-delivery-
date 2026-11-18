// Nadr.ai motion kit: shared look for every motion skill (navy + gold, Readex Pro, clean motion).
// Load with <script src="kit.js"></script>, then use K.* inside window.frame(t).
(function () {
  const q = new URLSearchParams(location.search);
  const W = +(q.get('w') || 1080), H = +(q.get('h') || 1920);
  const c = document.getElementById('c'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  const U = Math.min(W, H) / 1080;             // 1 unit = 1 px at 1080 wide
  const COL = { bg0: '#0d2236', bg1: '#081826', bg2: '#040c14', gold: '#d4a857', gold2: '#f0d088',
    white: '#ffffff', soft: 'rgba(255,255,255,.62)', faint: 'rgba(255,255,255,.12)', line: 'rgba(212,168,87,.35)' };
  const FONT = '"Readex Pro","Segoe UI",Tahoma,sans-serif';
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  // progress of t inside [a,b], 0..1
  const pr = (t, a, b) => clamp((t - a) / (b - a));
  const E = {
    out: k => 1 - Math.pow(1 - k, 3), in: k => k * k * k,
    io: k => k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2,
    back: k => { const s = 1.70158; return 1 + (s + 1) * Math.pow(k - 1, 3) + s * Math.pow(k - 1, 2); },
    el: k => k === 0 || k === 1 ? k : Math.pow(2, -10 * k) * Math.sin((k * 10 - .75) * (2 * Math.PI / 3)) + 1
  };
  function bg(t, glow = true) {
    const g = x.createRadialGradient(W * .5, H * .38, 0, W * .5, H * .5, Math.max(W, H) * .75);
    g.addColorStop(0, COL.bg0); g.addColorStop(.55, COL.bg1); g.addColorStop(1, COL.bg2);
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    if (!glow) return;
    // two soft gold light pools that drift slowly
    for (const [px, py, r, a] of [[.22 + .03 * Math.sin(t * .6), .2, .55, .10], [.8, .78 + .02 * Math.cos(t * .5), .5, .07]]) {
      const gg = x.createRadialGradient(W * px, H * py, 0, W * px, H * py, W * r);
      gg.addColorStop(0, `rgba(212,168,87,${a})`); gg.addColorStop(1, 'rgba(212,168,87,0)');
      x.fillStyle = gg; x.fillRect(0, 0, W, H);
    }
  }
  function text(s, px, py, size, o = {}) {
    x.save();
    x.font = `${o.weight || 700} ${size * U}px ${FONT}`;
    x.textAlign = o.align || 'center'; x.textBaseline = o.base || 'middle';
    x.direction = o.dir || (/[؀-ۿ]/.test(s) ? 'rtl' : 'ltr');
    x.globalAlpha = o.alpha == null ? 1 : o.alpha;
    if (o.glow) { x.shadowColor = o.glow; x.shadowBlur = 24 * U; }
    x.fillStyle = o.color || COL.white; x.fillText(s, px, py);
    x.restore();
  }
  function rrect(px, py, w, h, r) {
    x.beginPath(); x.moveTo(px + r, py); x.arcTo(px + w, py, px + w, py + h, r); x.arcTo(px + w, py + h, px, py + h, r);
    x.arcTo(px, py + h, px, py, r); x.arcTo(px, py, px + w, py, r); x.closePath();
  }
  // a rounded label pill centred at (px,py)
  function pill(s, px, py, size, o = {}) {
    x.save(); x.font = `700 ${size * U}px ${FONT}`;
    const w = x.measureText(s).width + size * U * 1.4, h = size * U * 1.9;
    x.globalAlpha = o.alpha == null ? 1 : o.alpha;
    const sc = o.scale == null ? 1 : o.scale; x.translate(px, py); x.scale(sc, sc);
    rrect(-w / 2, -h / 2, w, h, h / 2); x.fillStyle = o.fill || 'rgba(8,24,38,.85)'; x.fill();
    x.lineWidth = 2 * U; x.strokeStyle = o.stroke || COL.gold; x.stroke();
    x.restore();
    text(s, px, py + size * U * .04, size * sc, { color: o.color || COL.gold2, alpha: o.alpha });
  }
  // simple perspective camera for "3D" scenes: world (X right, Y up, Z away) -> screen
  function cam(o) {
    const f = o.f || 900 * U, cx = o.cx == null ? W / 2 : o.cx, cy = o.cy == null ? H / 2 : o.cy;
    const ry = o.yaw || 0, rx = o.pitch || 0, d = o.dist || 1200;
    const cY = Math.cos(ry), sY = Math.sin(ry), cX = Math.cos(rx), sX = Math.sin(rx);
    return (X, Y, Z) => {
      let x1 = X * cY - Z * sY, z1 = X * sY + Z * cY;
      let y1 = Y * cX - z1 * sX, z2 = Y * sX + z1 * cX;
      const zz = z2 + d, s = f / zz;
      return [cx + x1 * s, cy - y1 * s, s, zz];
    };
  }
  const rnd = (i) => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  window.K = { W, H, U, x, COL, FONT, clamp, lerp, pr, E, bg, text, rrect, pill, cam, rnd };
})();
