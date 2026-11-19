# Sound for ad4 (no music): short sounds from sfx/ placed on what happens on screen, each peak-matched, no long booms.
# usage: node render-pw.js ad4.html ad4_silent.mp4 && python3 ad4_audio.py
import subprocess, re
PEAK = {}
def peak(n):
    if n not in PEAK:
        o = subprocess.run(['ffmpeg', '-hide_banner', '-i', f'sfx/{n}.mp3', '-af', 'volumedetect', '-f', 'null', '-'], capture_output=True, text=True).stderr
        PEAK[n] = float(re.search(r'max_volume: (-?[\d.]+)', o).group(1))
    return PEAK[n]
# hf/* = Higgsfield-made for this ad (swoosh peaks at 0.58s, so it starts early to land on the cut)
SW = .58
C = [(0.0, 'pop', .8), (0.55, 'pop', .35), (2.0 - SW, 'hf/swoosh', .55), (2.0, 'pop', .4)]
for i in range(3):
    u = 2.2 + 2.8 * i
    C += [(u + .1, 'pop', .25), (u + .45, 'pop', .3), (u + 1.1, 'hf/buzz', .5), (u + 1.5, 'hf/ding', .55)]
    if i == 1: C += [(u + .5, 'scooter', .25)]
    if i < 2: C += [(u + 2.65 - SW, 'hf/swoosh', .3)]
C += [(10.75 - SW, 'hf/swoosh', .5), (11.0, 'pop', .4), (11.4, 'pop', .75), (12.2, 'pop', .3),
      (13.45 - SW, 'hf/swoosh', .25), (13.85, 'pop', .7), (15.85 - SW, 'hf/swoosh', .3), (15.9, 'pop', .55),
      (16.6, 'pop', .35), (17.4, 'typing', .3), (18.3, 'tap', .8), (18.45, 'sent', .5)]
args, fl = ['ffmpeg', '-y', '-loglevel', 'error', '-i', 'ad4_silent.mp4'], []
for j, (t, n, g) in enumerate(C):
    args += ['-i', f'sfx/{n}.mp3']; d = int(t * 1000); gain = min(3, g * 10 ** ((-3 - peak(n)) / 20)); ln = 1.3 if n == 'scooter' else 0.9
    fl.append(f'[{j+1}:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=0:{ln},afade=t=out:st={ln-.2:.2f}:d=0.2,volume={gain:.3f},adelay={d}|{d}[a{j}]')
fl.append(''.join(f'[a{j}]' for j in range(len(C))) + f'amix=inputs={len(C)}:normalize=0,alimiter=limit=0.8,apad,atrim=0:20[m]')
args += ['-filter_complex', ';'.join(fl), '-map', '0:v', '-map', '[m]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', 'ad4.mp4']
subprocess.run(args, check=True); print(len(C), 'cues')
