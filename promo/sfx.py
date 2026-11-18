# Sound effects only (no music), timed to the scenes in ad.html. Writes sfx.wav (48 kHz stereo).
import numpy as np, wave
SR, DUR = 48000, 30.0
out = np.zeros(int(SR * DUR)); rng = np.random.default_rng(7)
def add(t, s, g=1.0):
    i = int(t * SR); j = min(len(out), i + len(s)); out[i:j] += g * s[:j - i]
def env(n, a=.005, d=.2):
    t = np.arange(n) / SR; return np.minimum(1, t / a) * np.exp(-t / d)
def whoosh(L=.45):
    n = int(L * SR); w = rng.standard_normal(n); t = np.linspace(0, 1, n)
    # sweep a simple one-pole low-pass from dark to bright and back
    cut = .02 + .25 * np.sin(np.pi * t) ** 2; y = np.zeros(n); acc = 0
    for k in range(n): acc += cut[k] * (w[k] - acc); y[k] = acc
    return y * np.sin(np.pi * t) ** 1.5 * 2.2
def click(f=1800, L=.05):
    n = int(L * SR); t = np.arange(n) / SR; return np.sin(2 * np.pi * f * t) * env(n, .001, .012)
def pop(f=520):
    n = int(.18 * SR); t = np.arange(n) / SR; fr = f * (1 + .6 * np.exp(-t / .02)); return np.sin(2 * np.pi * np.cumsum(fr) / SR) * env(n, .002, .05)
def ding(f=1320, L=1.1):
    n = int(L * SR); t = np.arange(n) / SR
    return (np.sin(2 * np.pi * f * t) + .5 * np.sin(2 * np.pi * f * 2.01 * t) + .25 * np.sin(2 * np.pi * f * 3.02 * t)) * env(n, .003, .35) * .5
def shimmer(L=1.4):
    n = int(L * SR); t = np.arange(n) / SR; y = sum(np.sin(2 * np.pi * f * t + p) for f, p in [(880, 0), (1108, 1), (1318, 2), (1760, 3)])
    return y * np.minimum(1, t / .4) * np.exp(-t / .6) * .18
for k in range(11): add(k * .3, click(2200 if k % 2 else 1600), .35)          # match-cut page flips
for c in [3.4, 7.0, 10.8, 15.8, 20.0, 23.6, 27.0]: add(c - .22, whoosh(), .35)  # scene cuts
add(3.55, shimmer(), 1)                                                         # spotlight
for i in range(4): add(7.25 + i * .12, pop(480 + 60 * i), .35)                  # orbit cards appear
for at in [.9, 2.0, 3.1]: add(10.8 + at + .12, click(900, .07), .6)             # toggles
add(10.8 + 3.75, ding(1568), .7)                                                # order received
for i in range(4): add(15.8 + .25 + i * .3, pop(560 + 40 * i), .45)             # glass cards
add(23.0, ding(1320), .6)                                                       # delivered
for at in [.6, 1.2, 1.8, 2.4]: add(23.6 + at, pop(700), .45)                    # todo ticks
add(27.05, pop(420), .5); add(27.75, ding(1760, 1.6), .55)                      # CTA
out = out / max(1e-9, np.abs(out).max()) * .8
pcm = (np.repeat(out[:, None], 2, 1) * 32767).astype('<i2')
with wave.open('sfx.wav', 'wb') as w: w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
print('sfx.wav ok')
