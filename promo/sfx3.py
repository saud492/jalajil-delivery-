# Sound design for ad3.html: Higgsfield-generated SFX (sfx/*.wav) + a synthesized sub impact and riser.
import numpy as np, wave
SR = 48000; out = np.zeros(int(30.5 * SR))
def load(n):
    with wave.open(f'sfx/{n}.wav') as w: d = np.frombuffer(w.readframes(w.getnframes()), '<i2') / 32768
    return d / (np.abs(d).max() + 1e-9) * .7
X = {n: load(n) for n in ['whoosh', 'whip', 'pop', 'toggle', 'success', 'sent', 'typing', 'scooter']}
HIT = {'whoosh': .32, 'whip': .8, 'pop': 0, 'toggle': 0, 'success': .2, 'sent': .25, 'typing': 0, 'scooter': 0}
t = np.arange(int(1.6 * SR)) / SR
X['impact'] = (np.sin(2 * np.pi * np.cumsum(45 + 90 * np.exp(-t / .05)) / SR) * np.exp(-t / .45) + np.random.default_rng(1).standard_normal(len(t)) * np.exp(-t / .015) * .5) * .8; HIT['impact'] = 0
n = int(1.6 * SR); tt = np.arange(n) / SR; nz = np.random.default_rng(2).standard_normal(n); y = np.zeros(n); acc = 0
cut = .01 + .3 * (tt / tt[-1]) ** 2
for k in range(n): acc += cut[k] * (nz[k] - acc); y[k] = acc
X['riser'] = (y * 2.5 + .25 * np.sin(2 * np.pi * np.cumsum(200 + 900 * (tt / tt[-1]) ** 2) / SR)) * (tt / tt[-1]) ** 2.2 * .7; HIT['riser'] = 1.6
def put(at, name, g=1.0, maxlen=None):
    s = X[name] if maxlen is None else X[name][:int(maxlen * SR)] * np.r_[np.ones(int(maxlen * SR) - 2400), np.linspace(1, 0, 2400)][:len(X[name][:int(maxlen * SR)])]
    i = int((at - HIT[name]) * SR)
    if i < 0: s = s[-i:]; i = 0
    j = min(len(out), i + len(s)); out[i:j] += g * s[:j - i]
C = [  # (time of the hit, sound, gain) - retimed for ad3 transitions (pull-back / track matte / match cut)
 (.12, 'pop', .55), (.5, 'pop', .55), (.88, 'pop', .55), (1.3, 'impact', .55), (1.3, 'pop', .6), (1.85, 'pop', .5),
 (2.6, 'whoosh', .85), (2.68, 'pop', .5), (3.25, 'whoosh', .65), (3.32, 'pop', .5), (3.9, 'whoosh', .65), (3.97, 'pop', .5),
 (4.7, 'whoosh', .8), (4.68, 'toggle', .3), (4.98, 'toggle', .3), (5.33, 'toggle', .3), (5.65, 'pop', .6),
 (6.5, 'riser', .8), (6.4, 'whoosh', .6), (6.6, 'impact', 1.0), (6.75, 'whoosh', .35), (7.15, 'pop', .4),
 (8.72, 'whoosh', .95), (8.9, 'whip', .45),
 (9.8, 'toggle', .8), (10.5, 'typing', .6), (11.2, 'typing', .55), (12.6, 'toggle', .8), (12.75, 'pop', .6), (14.4, 'toggle', .8), (14.5, 'sent', .8),
 (15.3, 'pop', .6), (15.35, 'success', .6), (15.72, 'pop', .55), (16.14, 'pop', .55),
 (17.2, 'whoosh', .9), (17.3, 'pop', .4), (17.65, 'pop', .55), (17.8, 'pop', .55), (18.1, 'toggle', .6), (18.4, 'impact', .55), (18.95, 'pop', .6), (19.6, 'pop', .35),
 (20.5, 'whoosh', .85), (20.6, 'scooter', .55), (22.0, 'whoosh', .3), (22.8, 'success', .7), (23.95, 'whoosh', .5),
 (24.0, 'impact', .45), (24.0, 'pop', .6), (24.48, 'pop', .6), (24.96, 'pop', .6), (25.44, 'pop', .6), (25.92, 'pop', .6), (24.48, 'toggle', .35), (24.96, 'toggle', .35), (25.44, 'toggle', .35), (25.92, 'toggle', .35), (26.4, 'impact', .6), (26.4, 'pop', .6),
 (27.0, 'whoosh', .5), (27.05, 'pop', .6), (27.25, 'impact', .9), (27.6, 'pop', .6), (28.3, 'toggle', .8), (28.35, 'success', .55), (28.5, 'pop', .35), (28.95, 'impact', .55), (29.2, 'whoosh', .3)]
for at, n, g in C: put(at, n, g, 2.1 if n == 'scooter' else None)
out = np.tanh(out * 1.3) ; out = out / np.abs(out).max() * .9
with wave.open('sfx3.wav', 'wb') as w: w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((np.repeat(out[:, None], 2, 1) * 32767).astype('<i2').tobytes())
print('ok', len(C), 'cues')
