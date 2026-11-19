# Sound for ad4 (no music): short sounds from sfx/ placed on what happens on screen, each peak-matched, no long booms.
# usage: node render-pw.js ad4.html ad4_silent.mp4 && python3 ad4_audio.py
import subprocess, re
PEAK = {}
def peak(n):
    if n not in PEAK:
        o = subprocess.run(['ffmpeg', '-hide_banner', '-i', f'sfx/{n}.mp3', '-af', 'volumedetect', '-f', 'null', '-'], capture_output=True, text=True).stderr
        PEAK[n] = float(re.search(r'max_volume: (-?[\d.]+)', o).group(1))
    return PEAK[n]
# lib/* = trimmed picks from the owner's sound library (Google Drive). LEAD = seconds from clip start to its hit,
# so each cue is placed with its hit on the frame, not its start.
LEAD = {'lib/hit': .05, 'lib/dart': .05, 'lib/keys': .08, 'lib/boop': .05, 'lib/cash': .1, 'lib/swoosh': .31,
        'lib/button': .08, 'lib/click': .03, 'lib/ding': .08, 'scooter': 0}
LEN = {'lib/cash': 1.9, 'lib/swoosh': 1.2, 'lib/keys': 1.3, 'lib/ding': 1.1, 'lib/boop': 1.3, 'scooter': 1.3}
C = [(0.05, 'lib/hit', .7), (0.55, 'lib/click', .35), (1.9, 'lib/swoosh', .5), (2.05, 'lib/click', .4)]
for i in range(3):
    u = 2.2 + 2.8 * i
    C += [(u + .15, 'lib/click', .25), (u + .5, 'lib/click', .3), (u + 1.1, 'lib/boop', .5), (u + 1.5, 'lib/ding', .6)]
    if i == 1: C += [(u + .5, 'scooter', .22)]
    if i < 2: C += [(u + 2.65, 'lib/swoosh', .3)]
C += [(10.7, 'lib/swoosh', .45), (11.05, 'lib/click', .35), (11.45, 'lib/cash', .7), (12.25, 'lib/click', .25),
      (13.4, 'lib/swoosh', .25), (13.85, 'lib/dart', .6), (15.8, 'lib/swoosh', .3), (15.95, 'lib/hit', .45),
      (16.65, 'lib/click', .3), (17.45, 'lib/keys', .35), (18.3, 'lib/button', .7)]
C = [(t - LEAD.get(n, 0), n, g) for t, n, g in C]
args, fl = ['ffmpeg', '-y', '-loglevel', 'error', '-i', 'ad4_silent.mp4'], []
for j, (t, n, g) in enumerate(C):
    args += ['-i', f'sfx/{n}.mp3']; d = int(t * 1000); gain = min(3, g * 10 ** ((-3 - peak(n)) / 20)); ln = LEN.get(n, 0.9)
    fl.append(f'[{j+1}:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=0:{ln},afade=t=out:st={ln-.2:.2f}:d=0.2,volume={gain:.3f},adelay={d}|{d}[a{j}]')
fl.append(''.join(f'[a{j}]' for j in range(len(C))) + f'amix=inputs={len(C)}:normalize=0,alimiter=limit=0.8,apad,atrim=0:20[m]')
args += ['-filter_complex', ';'.join(fl), '-map', '0:v', '-map', '[m]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', 'ad4.mp4']
subprocess.run(args, check=True); print(len(C), 'cues')
