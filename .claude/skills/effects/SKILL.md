---
name: effects
description: Adds motion-graphics effects around a person in a talking-to-camera video (glass-widgets, orbit, spotlight, todo, timeline, match-cut, apple-toggles) and exports a new MP4 with the original sound. Use when the user types /effects <name> or asks to put effects/graphics around themselves in their video.
---

# /effects  (مؤثرات على فيديوك)

Part of the Nadr.ai skills. Claude cuts the person out of the video, writes the effect timeline, and your computer renders the result. Nothing is uploaded anywhere.

## The 7 effects
| name | what it does | opts (all optional) |
|---|---|---|
| glass-widgets | frosted glass cards float around the head: a title, a bar chart, an export %, a signature | `title`, `pct`, `sig` |
| orbit | video thumbnails orbit the head, passing behind and in front of it | `images` (list of image paths), `count`, `speed` |
| spotlight | the background goes dark and a big gold word glows behind the person | `word`, `size` |
| todo | a checklist under the face; items tick and strike through on time | `title`, `items` ([[text, seconds after start], ...]) |
| timeline | an editor timeline (V1, CAPTIONS, GRADE, AUDIO) with a glowing playhead and a render % | `start` (first %) |
| match-cut | fast cuts between page designs while one word stays locked in a gold box | `word`, `heads` (headlines), `step` (seconds per cut) |
| apple-toggles | iPhone-style switches under the face turn on one by one | `rows` ([[label, seconds after start], ...]) |

## What you need once
- ffmpeg on PATH, Node.js 18+, Chrome or Edge (Windows: `winget install Gyan.FFmpeg` and `winget install OpenJS.NodeJS.LTS`).
- Python 3.9-3.12: `pip install mediapipe opencv-python numpy` (cuts the person out, on your PC).
- In the project folder: `npm i puppeteer-core`.

## Steps
1. Get the video path and which effects the user wants (one or several). Default format is 9:16 (1080x1920).
2. Make a folder `effects-<short-name>/` and copy into it from this skill: `prep.py`, `fx.html`, `kit.js`, `render.js`, `readex.woff2`.
3. Prepare the clip (frames, person masks, face box, audio):
   `python prep.py "<video>" work --start 0 --dur 0`  (use --start/--dur to take only part of a long video).
4. If the user gave a script or you can hear the timing, place each effect on the words it belongs to. Write `fx.js`:
   ```js
   window.FX = [
     { fx: 'glass-widgets', from: 0.0, to: 2.5, opts: { title: 'فيديو واحد' } },
     { fx: 'spotlight', from: 2.5, to: 5.0, opts: { word: 'اسمك' } }
   ];
   ```
   Times are seconds in the prepared clip. Effects can follow each other or overlap (except match-cut, which takes the full screen).
5. Check stills first: `node render.js fx.html out.mp4 --preview 1,3,5`. Open the PNGs (saved as `out_t1.00.png`…). Fix text that covers the face or leaves the frame by changing opts or times.
6. Render and add the original sound:
   `node render.js fx.html silent.mp4 --fps 30`
   `ffmpeg -y -i silent.mp4 -i work/audio.wav -c:v copy -c:a aac -b:a 192k -shortest final.mp4`
7. Tell the user the path of `final.mp4`. They can delete the `work` folder afterwards (it holds the frames).

## Tips
- Best input: a bright room, the person centred, chest-up, with some space above the head.
- Brand look is navy #081826 + gold #d4a857. To change colours, edit `COL` in kit.js.
- Only use images the user owns in `orbit`. Headlines in `match-cut` are the user's own designs, never real news sites.

Made by Nadr.ai · www.nadr.ai
