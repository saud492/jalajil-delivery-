// Render a DOM animation page (window.DUR, window.frame(t), window.ready()) to MP4 with Playwright + ffmpeg.
// usage: node render-pw.js page.html out.mp4 [--fps 30] [--sub 2 (motion-blur sub-frames)] [--preview 1,2.5,3 (writes JPGs)]
const fs = require('fs'), path = require('path'), { spawn } = require('child_process'), { chromium } = require('playwright');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
(async () => {
  const [page, out] = process.argv.slice(2), FPS = +arg('fps', 30), SUB = +arg('sub', 2), prev = arg('preview', null);
  const b = await chromium.launch({ args: ['--allow-file-access-from-files', '--font-render-hinting=none', '--force-color-profile=srgb'] });
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  p.on('pageerror', e => console.log('PAGE ERROR', e.message));
  await p.goto('file://' + path.resolve(page)); await p.evaluate(async () => { await document.fonts.ready; if (window.ready) await window.ready(); });
  const DUR = await p.evaluate(() => window.DUR);
  const shot = async t => { await p.evaluate(t => window.frame(t), t); return p.screenshot({ type: 'jpeg', quality: 92 }); };
  if (prev) { for (const t of prev.split(',').map(Number)) fs.writeFileSync(out.replace(/\.mp4$/, '') + '_' + t.toFixed(2) + '.jpg', await shot(t)); await b.close(); return console.log('stills ok'); }
  const R = FPS * SUB, ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(R), '-i', '-',
    '-vf', (SUB > 1 ? `tmix=frames=${SUB},` : '') + `fps=${FPS}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '16', '-preset', 'medium', '-movflags', '+faststart', out]);
  ff.stderr.on('data', d => process.stderr.write(d));
  for (let i = 0, N = Math.round(DUR * R); i < N; i++) { const buf = await shot(i / R); if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r)); if (i % R === 0) process.stdout.write(`\r${i / R}s / ${DUR}s`); }
  ff.stdin.end(); await new Promise(r => ff.on('close', r)); await b.close(); console.log('\nsaved', out);
})();
