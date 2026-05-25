# Video Motion Analyser

A browser-based tool for inspecting video motion cadence, duplicate frames, low-motion patterns, and cut/spike candidates.

The app is designed for short AI-generated clips where the exported file may be 24 FPS, but the visual cadence contains repeated frames. It decodes the video locally, samples adjacent-frame motion, and shows the result as a motion curve, chronological frame grid, and temporal stack playback.

## What It Does

- Loads MP4/WebM video files or image-frame folders.
- Assumes 24 FPS by default, with an optional source FPS setting.
- Detects duplicate or near-duplicate adjacent frames.
- Flags abrupt motion spikes as cut/spike candidates.
- Displays motion cadence as a curve.
- Shows every frame in a grid with duplicate markers.
- Plays a temporal stack view for seeing duplicate-frame rhythm over time.
- Compares a second video against the original motion curve.
- Exports marker lists for Resolve/Premiere/After Effects review.

## Privacy And Hosting

Video processing happens in the browser. Files are decoded with browser media APIs and analysed on local canvases. The app does not need to upload source videos to a server for analysis.

Server requirements are light: this can be hosted as a static Vite site after running `npm run build`. Runtime server load is mostly serving HTML, CSS, JavaScript, and static assets. The heavy work is client CPU/GPU/browser memory on the visitor's machine.

## Local Development

```bash
npm install
npm run dev
```

## Production Build

```bash
npm run build
```

Deploy the generated `dist/` folder to any static host, CDN, or existing web server.
