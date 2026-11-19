# Sound for ad4: short sounds from sfx/ placed on what happens on screen, each peak-matched, no long booms.
# usage: node render-pw.js ad4.html ad4_silent.mp4 && python3 ad4_audio.py
import subprocess, re
PEAK = {}
def peak(n):
    if n not in PEAK:
        o = subprocess.run(['ffmpeg', '-hide_banner', '-i', f'sfx/{n}.mp3', '-af', 'volumedetect', '-f', 'null', '-'], capture_output=True, text=True).stderr
        PEAK[n] = float(re.search(r'max_volume: (-?[\d.]+)', o).group(1))
    return PEAK[n]
C = [(0.0, 'pop', .8), (0.55, 'pop', .4), (1.7, 'whip', .6), (2.0, 'pop', .5)]
for i in range(3):
    u = 2.2 + 2.8 * i
    C += [(u + .1, 'pop', .3), (u + .45, 'pop', .35), (u + 1.1, 'toggle', .45), (u + 1.5, 'pop', .7)]
    if i == 1: C += [(u + .5, 'scooter', .3)]
    if i < 2: C += [(u + 2.5, 'whip', .35)]
C += [(10.5, 'whip', .55), (11.0, 'pop', .45), (11.4, 'pop', .8), (12.2, 'pop', .35),
      (13.3, 'whoosh', .25), (13.85, 'pop', .7), (15.7, 'whoosh', .25), (15.9, 'pop', .6),
      (16.6, 'pop', .4), (17.0, 'pop', .3), (17.4, 'typing', .35), (18.3, 'tap', .8), (18.45, 'sent', .55)]
args, fl = ['ffmpeg', '-y', '-loglevel', 'error', '-i', 'ad4_silent.mp4'], []
for j, (t, n, g) in enumerate(C):
    args += ['-i', f'sfx/{n}.mp3']; d = int(t * 1000); gain = min(3, g * 10 ** ((-3 - peak(n)) / 20)); ln = 1.3 if n == 'scooter' else 0.9
    fl.append(f'[{j+1}:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=0:{ln},afade=t=out:st={ln-.2:.2f}:d=0.2,volume={gain:.3f},adelay={d}|{d}[a{j}]')
fl.append(''.join(f'[a{j}]' for j in range(len(C))) + f'amix=inputs={len(C)}:normalize=0,alimiter=limit=0.8,apad,atrim=0:20[m]')
args += ['-filter_complex', ';'.join(fl), '-map', '0:v', '-map', '[m]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', 'ad4.mp4']
subprocess.run(args, check=True); print(len(C), 'cues')
