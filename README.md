# Fallboard Piano

Practice piano pieces with a falling-note roll, interactive sheet music, and MusicXML import.

[Open Fallboard Piano](https://fallboard-piano.lucaa-bovelli.chatgpt.site/) · [GitHub Pages](https://luca-bovelli.github.io/fallboard/)

## Run locally

From the repository root, run:

```sh
python -m http.server 8000 --directory dist
```

Open <http://localhost:8000>. The site is static and requires no build step. Score, audio, and engine credits are in `dist/credits.html`.

`npm run dev` (or `node dev-server.js`) serves the same folder on port 5173 without caching.

## Deploying

Every push to `main` runs `.github/workflows/pages.yml`: it engraves any new or changed scores, commits those engravings back to `main`, and publishes `dist/` to GitHub Pages. Pages caches files for 10 minutes, so the deploy copy (never the repository) has its script and score URLs stamped with the commit by `tools/stamp.js`.

## Adding a piece

1. Put the MusicXML in `dist/scores/<name>.musicxml`.
2. Add the piece to `BUILTINS` in `dist/js/app.js` and credit its source in `dist/credits.html`.
3. Push. The workflow engraves it; to see it locally first, run `npm install` once and then `npm run engrave`.

`npm run engrave` engraves every score whose engravings are missing or stale, with MuseScore's engine (webmscore 1.2.1, installed by `npm install`). Each score gets `<name>.narrow.json`, `.medium.json` and `.wide.json` at the widths in `LAYOUTS` in `dist/js/engrave-core.js` (62, 96 and 132 staff spaces), so every piece has the same staff size. Each file is stamped with a hash of its score, `engrave-core.js` and the engine version; changing any of them makes the piece stale, so editing `engrave-core.js` re-engraves everything. `npm run engrave -- --force` redoes all of them, `npm run engrave -- <name>` just one.

A bar too dense for the width (MuseScore logs "System justification error") keeps its system's real width and is drawn scaled down to fit the screen. The title, composer and rights lines are left out of the engraving, since the app shows the title itself. Each element is tagged with the hand it belongs to (`data-s`), so the hand filter can fade the other hand; barlines and the brace are neutral and fade only on the other hand's half.

`sources/` holds untouched downloads that the shipped scores were made from.
