# Sound effects only (no music): reuses the sounds from the original Jalajil ad (orig.wav),
# re-timed to the scenes in ad.html. Writes sfx.wav (48 kHz stereo).
import numpy as np, wave
def read(p):
    with wave.open(p) as w: d = np.frombuffer(w.readframes(w.getnframes()), '<i2').reshape(-1, 2).astype(np.float32) / 32768; return d, w.getframerate()
src, SR = read('orig.wav'); out = np.zeros((int(30 * SR), 2), np.float32)
def seg(a, b): s = src[int(max(0, a - .02) * SR):int((b + .05) * SR)].copy(); f = int(.01 * SR); s[:f] *= np.linspace(0, 1, f)[:, None]; s[-f:] *= np.linspace(1, 0, f)[:, None]; return s
S = {'open': seg(0, .53), 'popA': seg(1.95, 2.32), 'popB': seg(2.78, 3.12), 'tr1': seg(7.0, 7.66), 'tr2': seg(11.73, 12.53),
     'popC': seg(17.78, 18.09), 'tr3': seg(18.91, 19.57), 'tr4': seg(22.0, 22.66), 'tr5': seg(24.83, 25.63), 'end': seg(27.11, 28.14)}
def put(t, k, g=1.0): i = int(t * SR); s = S[k]; j = min(len(out), i + len(s)); out[i:j] += g * s[:j - i]
put(0.0, 'open'); put(2.65, 'popA')                                  # hook, then "خلّك مرتاح"
for t, k in [(3.4, 'tr1'), (7.0, 'tr2'), (10.8, 'tr3'), (15.8, 'tr4'), (20.0, 'tr5'), (23.6, 'tr1'), (27.0, 'tr2')]: put(t, k)  # scene cuts
put(14.5, 'popB'); put(23.0, 'popC'); put(27.75, 'end')               # order received, delivered, link
pk = np.abs(out).max(); out *= min(1, .89 / pk)
with wave.open('sfx.wav', 'wb') as w: w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((out * 32767).astype('<i2').tobytes())
print('sfx.wav ok')
