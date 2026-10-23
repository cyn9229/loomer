# Demo video

The Neighborhood Hacks demo video, built with [Remotion](https://www.remotion.dev): the edited screen recording, the camera takes, deck slides, captions, chapter titles, and callouts, all as React components driven by time.

```bash
npm install
npm run check      # prints the edit: narration timing, gaps, overlaps, callout lengths
npm run captions   # rebuilds src/data/captions.json from the narration text and audio
npm run audio      # builds out/audio.m4a (voice + ducked music) from the same timeline
npm run render     # picture only, to out/demo-video-picture.mp4 (about 10 minutes)
npm run mux        # combines them into out/demo-video.mp4
npm run studio     # preview in the browser
```

If another app holds port 3000, add `-- --port=3091` to `render`.

## Where things live

- `src/timeline.ts`: everything with a time or a place. The screen edit (`EDIT`: kept stretches, sped-up waits, freeze frames), each narration piece and where it lands (`at(src)` = the final time of a moment in the recording), camera moves, slides, chapter titles, and callouts. Change timing here, then run `npm run check`.
- `src/components/`: one layer each. `Screen` (edited recording, zooms, Gmail tab blur), `Callouts`, `Chapters`, `Slides`, `PrivacyList`, `Captions`, `Camera`, `NameTitle`.
- `src/lib/motion.ts`: the one spring used for all motion (settles without overshoot).
- `scripts/audio.ts`: lays every narration piece on a silent bed of the video's exact length (so nothing can shift), then loops the music with crossfades and ducks it under the voice.

## Narration cuts

Narration pieces are cut only in breaths. To check a new cut point, look at the take's loudness around it (a dip between words) and at what whisper.cpp heard (`transcripts/`, made with `whisper-cli ... -ml 1 -sow -ojf --dtw base.en`). Each piece's `text` is exactly what is said; the captions use it.

## Media (not in git)

- `public/media/screen.mp4`: the screen recording (an APFS clone, `cp -c`; Remotion's file server does not follow symlinks).
- `public/media/<take>.mp4`: camera takes converted to a steady 30 fps with a keyframe every second, with the brightness lift for the backlit room baked in. Chrome records at a variable frame rate with keyframes about 3 seconds apart, which made frame lookups time out mid-render.
- `public/media/pip/<take>.mp4`: 640x360 copies of the demo takes for the picture-in-picture (much faster to render).
- `public/music/digital-clouds.mp3`: "Digital Clouds" by Alejandro Magaña, from Mixkit (free license, no attribution required).
- `public/slides/`: the pitch deck pages as 1920x1080 PNGs.

```bash
LOOK="colorchannelmixer=rr=1.07:gg=1.07:bb=1.07,eq=contrast=1.05:saturation=1.04"
ffmpeg -i ../takes/<take>.mp4 -an -vf "fps=30,$LOOK" -c:v libx264 -preset veryfast -crf 16 -g 30 -pix_fmt yuv420p public/media/<take>.mp4
ffmpeg -i ../takes/<take>.mp4 -an -vf "fps=30,scale=640:360,$LOOK" -c:v libx264 -preset veryfast -crf 18 -g 30 -pix_fmt yuv420p public/media/pip/<take>.mp4
```
