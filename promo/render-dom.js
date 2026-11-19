// Render a DOM animation page to MP4 with real motion blur.
// The page defines window.DUR and window.frame(t) (sync), and window.ready() (async, optional).
// usage: node render-dom.js page.html out.mp4 [--fps 30] [--sub 2] [--preview 1,2,3] [--scale 1]
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const req = n => { for (const p of [n, path.join(process.cwd(), 'node_modules', n), path.join(__dirname, 'node_modules', n)]) { try { return require(p); } catch (e) {} } throw new Error('npm i ' + n); };
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
(async () => {
  const [page, out] = process.argv.slice(2);
  const FPS = +arg('fps', 30), SUB = +arg('sub', 2), prev = arg('preview', null), SC = +arg('scale', 1);
  const pup = req('puppeteer-core');
  const b = await pup.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium', headless: 'new',
    args: ['--no-sandbox', '--allow-file-access-from-files', '--font-render-hinting=none', '--force-color-profile=srgb'] });
  const p = await b.newPage(); p.on('pageerror', e => console.log('PAGE ERROR', e.message)); p.on('console', m => console.log('page:', m.text()));
  await p.setViewport({ width: 1080, height: 1920, deviceScaleFactor: SC });
  await p.goto('file://' + path.resolve(page), { waitUntil: 'networkidle0' });
  await p.evaluate(async () => { await document.fonts.ready; if (window.ready) await window.ready(); });
  const DUR = await p.evaluate(() => window.DUR);
  const shot = async t => { await p.evaluate(t => window.frame(t), t); return p.screenshot({ type: 'jpeg', quality: 92 }); };
  if (prev) { for (const t of prev.split(',').map(Number)) { const f = out.replace(/\.mp4$/, '') + '_' + t.toFixed(2) + '.jpg'; fs.writeFileSync(f, await shot(t)); } await b.close(); console.log('stills ok'); return; }
  const R = FPS * SUB;   // render SUB sub-frames per output frame and blend them = motion blur
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(R), '-i', '-',
    '-vf', (SUB > 1 ? `tmix=frames=${SUB},` : '') + `fps=${FPS},scale=1080:1920`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '16', '-preset', 'medium', '-movflags', '+faststart', out]);
  ff.stderr.on('data', d => process.stderr.write(d));
  const N = Math.round(DUR * R);
  for (let i = 0; i < N; i++) { const buf = await shot(i / R); if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r)); if (i % R === 0) process.stdout.write(`\r${i / R}s / ${DUR}s`); }
  ff.stdin.end(); await new Promise(r => ff.on('close', r)); await b.close(); console.log('\nsaved', out);
})();
