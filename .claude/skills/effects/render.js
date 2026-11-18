// Nadr.ai motion skills: render one HTML canvas animation to MP4.
// The page must define: window.DUR (seconds) and window.frame(t) that draws time t on <canvas id="c">.
// Usage: node render.js <page.html> <out.mp4> [--w 1080] [--h 1920] [--fps 30] [--preview 1.5,3,4.5 (writes PNGs)]
// Needs: Node 18+, puppeteer-core (npm i puppeteer-core), ffmpeg on PATH, Chrome or Edge installed.
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
function req(name) {
  const tries = [name, path.join(process.cwd(), 'node_modules', name),
    path.join(__dirname, 'node_modules', name),
    path.join(require('os').homedir(), '.video-ad-editor', 'node_modules', name)];
  for (const t of tries) { try { return require(t); } catch (e) {} }
  throw new Error(name + ' not found: run  npm i ' + name);
}
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const browserPath = () => [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => p && fs.existsSync(p));

(async () => {
  const [page, out] = process.argv.slice(2);
  if (!page || !out) { console.log('node render.js <page.html> <out.mp4> [--w --h --fps --preview t1,t2]'); process.exit(1); }
  const W = +arg('w', 1080), H = +arg('h', 1920), FPS = +arg('fps', 30), prev = arg('preview', null);
  const pup = req('puppeteer-core');
  const b = await pup.launch({ executablePath: browserPath(), headless: 'new',
    args: ['--allow-file-access-from-files', '--font-render-hinting=none', '--force-color-profile=srgb'] });
  const p = await b.newPage();
  p.on('pageerror', e => console.log('PAGE ERROR', e.message));
  await p.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  const url = 'file:///' + path.resolve(page).replace(/\\/g, '/') + '?w=' + W + '&h=' + H;
  await p.goto(url, { waitUntil: 'networkidle0', timeout: 120000 });
  await p.evaluate(() => document.fonts.ready.then(() => window.ready ? window.ready() : 0));
  const DUR = await p.evaluate(() => window.DUR);
  const shot = t => p.evaluate(async t => { await window.frame(t); return document.getElementById('c').toDataURL('image/png'); }, t);
  if (prev) {
    for (const t of prev.split(',').map(Number)) {
      const f = out.replace(/\.mp4$/i, '') + '_t' + t.toFixed(2) + '.png';
      fs.writeFileSync(f, Buffer.from((await shot(t)).split(',')[1], 'base64')); console.log('still', f);
    }
    await b.close(); return;
  }
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '16', '-preset', 'medium', '-movflags', '+faststart', out]);
  ff.stderr.on('data', d => process.stderr.write(d));
  const N = Math.round(DUR * FPS);
  for (let i = 0; i < N; i++) {
    const buf = Buffer.from((await shot(i / FPS)).split(',')[1], 'base64');
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (i % FPS === 0) process.stdout.write('\r' + (i / FPS).toFixed(0) + 's / ' + DUR + 's');
  }
  ff.stdin.end(); await new Promise(r => ff.on('close', r)); await b.close();
  console.log('\nsaved', out);
})();
