# Fallboard Piano

Practice piano pieces with a falling-note roll, interactive sheet music, and MusicXML import.

[Open Fallboard Piano](https://fallboard-piano.lucaa-bovelli.chatgpt.site/)

## Run locally

From the repository root, run:

```sh
python -m http.server 8000 --directory dist
```

Open <http://localhost:8000>. The site is static and requires no build step. Score, audio, and engine credits are in `dist/credits.html`.

`node dev-server.js` serves the same folder on port 5173 without caching.

## Adding a piece

1. Put the MusicXML in `dist/scores/<name>.musicxml`.
2. Pre-engrave it at the three layout widths with MuseScore's engine (`npm install webmscore@1.2.1` somewhere outside the repo):

   ```sh
   node tools/engrave.js dist/scores/<name>.musicxml dist/scores/<name> <path>/node_modules/webmscore/webmscore.nodejs.cjs
   ```

   This writes `<name>.narrow.json`, `.medium.json` and `.wide.json` at the widths in `LAYOUTS` (62, 96 and 132 staff spaces). Re-run it for every piece after changing `dist/js/engrave-core.js`. The Rachmaninoff preludes and the Revolutionary Étude were engraved at their own widths (for example 108, 100 and 132 for the B♭ prelude); re-running the tool on them resets those to the defaults.
3. Add the piece to `BUILTINS` in `dist/js/app.js` and credit its source in `dist/credits.html`.

`sources/` holds untouched downloads that the shipped scores were made from.
