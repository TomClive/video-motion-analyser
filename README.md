# Video Motion Analyser

A browser-based tool for inspecting video motion cadence, low-motion patterns, possible duplicate frames, and cut/spike candidates.

Live demo: [videomotionanalyser.tomlikesrobots.com](https://videomotionanalyser.tomlikesrobots.com)

The app is designed for short AI-generated clips where the exported file may be 24 FPS, but the visual cadence contains repeated frames. It decodes the video locally, samples adjacent-frame motion, and shows the result as a motion curve, chronological frame grid, and temporal stack playback.

## What It Does

- Loads MP4/WebM video files or image-frame folders.
- Assumes 24 FPS by default, with an optional source FPS setting.
- Detects low-motion and possible duplicate adjacent frames.
- Flags abrupt motion spikes as cut/spike candidates.
- Displays motion cadence as a curve.
- Shows every frame in a grid with duplicate markers.
- Plays a temporal stack view for seeing duplicate-frame rhythm over time.
- Compares a second video against the original motion curve.
- Exports marker lists for Resolve/Premiere/After Effects review.

## Privacy And Hosting

Video processing happens in the browser. Files are decoded with browser media APIs and analysed on local canvases. The app does not need to upload source videos to a server for analysis.

For forensic frame checks, prefer loading an extracted PNG/JPG frame folder. MP4/WebM import is useful for quick inspection, but browser video seeking is timestamp-based and can occasionally repeat or snap to nearby decoded frames. A good ffmpeg extraction command is:

```bash
ffmpeg -i input.mp4 -vsync 0 frames/frame_%05d.png
```

Server requirements are tiny: this is a no-build static site. Runtime server load is just serving `index.html`, `styles.css`, `app.js`, and any static assets you add later. The heavy work is client CPU/GPU/browser memory on the visitor's machine.

## Local Development

Open `index.html` directly in a browser, or serve the folder with any static file server.

## GitHub Pages

This repo can be hosted directly from GitHub Pages:

1. Open the repository settings on GitHub.
2. Go to Pages.
3. Set the source to deploy from the `main` branch.
4. Set the folder to `/root`.
5. Save.

For a custom subdomain such as `videomotionanalyser.tomlikesrobots.com`, add the custom domain in GitHub Pages and point your DNS at the GitHub Pages target shown by GitHub.
