# /effects step 1: cut the talking video into frames + person masks + face box.
# python prep.py <input video> <work dir> [--start 0] [--dur 0 (=all)] [--fps 30] [--w 1080 --h 1920]
# Needs: ffmpeg on PATH, Python 3.9-3.12 with:  pip install mediapipe opencv-python numpy
import argparse, json, os, subprocess, sys
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument('src'); ap.add_argument('work')
ap.add_argument('--start', type=float, default=0); ap.add_argument('--dur', type=float, default=0)
ap.add_argument('--fps', type=int, default=30); ap.add_argument('--w', type=int, default=1080); ap.add_argument('--h', type=int, default=1920)
a = ap.parse_args()
try:
    import cv2, mediapipe as mp
except ImportError:
    sys.exit('Missing packages: pip install mediapipe opencv-python numpy')
W, H = a.w, a.h
os.makedirs(os.path.join(a.work, 'frames'), exist_ok=True); os.makedirs(os.path.join(a.work, 'mask'), exist_ok=True)
cut = ['-ss', str(a.start)] + (['-t', str(a.dur)] if a.dur else [])
vf = f'scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},fps={a.fps}'
# audio (kept for the final mux)
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', *cut, '-i', a.src, '-vn', '-ac', '2', '-ar', '48000', os.path.join(a.work, 'audio.wav')])
proc = subprocess.Popen(['ffmpeg', '-loglevel', 'error', *cut, '-i', a.src, '-vf', vf, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], stdout=subprocess.PIPE)
seg = mp.solutions.selfie_segmentation.SelfieSegmentation(model_selection=0)
fd = mp.solutions.face_detection.FaceDetection(model_selection=1, min_detection_confidence=.5)
prev_m, face, faces, i = None, None, [], 0
while True:
    buf = proc.stdout.read(W * H * 3)
    if len(buf) < W * H * 3: break
    i += 1
    rgb = np.frombuffer(buf, np.uint8).reshape(H, W, 3)
    cv2.imwrite(os.path.join(a.work, 'frames', f'{i:05d}.jpg'), cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 92])
    m = seg.process(rgb).segmentation_mask.astype(np.float32)
    m = np.clip((m - .35) / .3, 0, 1)
    if prev_m is not None: m = .6 * m + .4 * prev_m          # calm the edges between frames
    prev_m = m
    m8 = cv2.GaussianBlur((m * 255).astype(np.uint8), (0, 0), 2.2)
    cv2.imwrite(os.path.join(a.work, 'mask', f'{i:05d}.png'), np.dstack([np.full_like(m8, 255)] * 3 + [m8]))  # alpha = person
    r = fd.process(rgb)
    if r.detections:
        b = r.detections[0].location_data.relative_bounding_box
        f = [b.xmin * W, b.ymin * H, b.width * W, b.height * H]
        face = f if face is None else [.75 * p + .25 * q for p, q in zip(face, f)]
    faces.append([round(v, 1) for v in (face or [W * .35, H * .25, W * .3, H * .17])])
    if i % 30 == 0: print(f'\r{i} frames', end='', flush=True)
proc.wait()
meta = {'fps': a.fps, 'n': i, 'w': W, 'h': H, 'faces': faces}
json.dump(meta, open(os.path.join(a.work, 'meta.json'), 'w'))
open(os.path.join(a.work, 'meta.js'), 'w').write('window.META=' + json.dumps(meta) + ';')
print(f'\nready: {i} frames, {i / a.fps:.1f} s -> {a.work}')
