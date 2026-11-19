# Sound for ad4 (no music). Cue times come from window.CUES in ad4.html, the same timeline the picture uses.
# Sounds are trimmed picks from the owner's library (sfx/lib). Each one is placed so its HIT lands on the cue
# time, not its start (LEAD = seconds from clip start to the hit).
# usage: node render-pw.js ad4.html ad4_silent.mp4 && python3 ad4_audio.py
import subprocess, re, json, wave
import numpy as np

LEAD = {'hit': .05, 'dart': .08, 'keys': .08, 'boop': .05, 'cash': .1, 'swoosh': .31, 'button': .08, 'ding': .08}
LEN = {'cash': 1.9, 'swoosh': 1.2, 'keys': 1.3, 'ding': 1.1, 'boop': 1.3, 'hit': 1.1, 'dart': .9, 'button': .28}
SR, DUR = 48000, 20.0

cues = json.loads(subprocess.run(['node', '-e', '''
const { chromium } = require('playwright'), path = require('path');
(async () => { const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('file://' + path.resolve('ad4.html')); console.log(JSON.stringify(await p.evaluate(() => window.CUES))); await b.close(); })();
'''], capture_output=True, text=True, check=True).stdout)

def load(n):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', f'sfx/lib/{n}.mp3', '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    x = np.frombuffer(raw, '<f4')[:int(LEN[n] * SR)].copy()
    f = min(len(x), int(.12 * SR)); x[-f:] *= np.linspace(1, 0, f)
    return x / (np.abs(x).max() + 1e-9) * 0.7   # every sound peak-matched, gain in CUES sets the balance

X = {n: load(n) for n in LEAD}
out = np.zeros(int(DUR * SR))
for t, n, g in cues:
    i = int(round((t - LEAD[n]) * SR)); s = X[n] * g
    if i < 0: s = s[-i:]; i = 0
    j = min(len(out), i + len(s)); out[i:j] += s[:j - i]

ceil = 10 ** (-1.5 / 20)                      # -1.5 dBFS ceiling, survives AAC
out = out * (ceil / np.abs(out).max())          # loudest hit sits at the ceiling
with wave.open('ad4_sfx.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((np.repeat(out[:, None], 2, 1) * 32767).astype('<i2').tobytes())
subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', 'ad4_silent.mp4', '-i', 'ad4_sfx.wav', '-map', '0:v', '-map', '1:a',
                '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', 'ad4.mp4'], check=True)

# --- measure, since nobody can listen from here ---
# 1) sync: first onset within +-60 ms of each cue must sit within 20 ms of it
env = np.abs(out); bad = 0
for t, n, g in cues:
    if n == 'swoosh':   # a swoosh swells: what must land on the cut is its peak
        a, b = int((t - .15) * SR), int((t + .15) * SR); sm = np.convolve(env[a:b], np.ones(480) / 480, 'same'); on = (a + np.argmax(sm)) / SR
    else:
        a, b = int(max(0, t - .06) * SR), int((t + .06) * SR)
        seg = env[a:b]; on = (a + np.argmax(seg > seg.max() * .5)) / SR
    ok = abs(on - t) <= .02; bad += not ok
    print(f"{'ok ' if ok else 'BAD'} {t:6.2f}s {n:7s} hit at {on:6.3f}s ({(on - t) * 1000:+.0f} ms)")
# 2) levels per section
for name, a, b in [('hook', 0, 2.2), ('rounds', 2.2, 10.6), ('price', 10.6, 13.3), ('logo', 13.3, 15.7), ('cta', 15.7, 20)]:
    s = out[int(a * SR):int(b * SR)]
    print(f"{name:7s} peak {20 * np.log10(np.abs(s).max() + 1e-9):6.1f} dBFS   rms {20 * np.log10(np.sqrt((s ** 2).mean()) + 1e-9):6.1f} dBFS")
lu = subprocess.run(['ffmpeg', '-hide_banner', '-i', 'ad4.mp4', '-af', 'ebur128=peak=true', '-f', 'null', '-'], capture_output=True, text=True).stderr
print('integrated', re.findall(r'I:\s+(-?[\d.]+) LUFS', lu)[-1], 'LUFS   true peak', re.findall(r'Peak:\s+(-?[\d.]+) dBFS', lu)[-1], 'dBFS')
print(len(cues), 'cues,', bad, 'out of sync')
