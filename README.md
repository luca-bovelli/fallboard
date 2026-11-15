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

A bar too dense for the width (MuseScore logs "System justification error") keeps its system's real width and is drawn scaled down to fit the screen. Rests are re-placed rather than taken from the file: a rest alone in a silence sits on the middle line, one beside another voice sits on its own side of that voice, and a second voice's rest is dropped only when that cannot make the rhythm unclear (see `tidyRests` in `dist/js/engrave-core.js`). The title, composer and rights lines are left out of the engraving, since the app shows the title itself. Each element is tagged with the hand it belongs to (`data-s`), so the hand filter can fade the other hand; barlines and the brace are neutral and fade only on the other hand's half.

## Repertoire catalogue

`catalog/` lists every solo keyboard work by 19 composers (3,941 pieces) with titles, nicknames, catalogue numbers and keys, for the score library and its search. `npm run catalog` builds it; `catalog/README.md` explains the files and sources. `catalog/requests/` lists the scores still wanted from IMSLP and how to deliver them.

## Library

The piece's name in the player opens a menu of recent pieces; its More opens the library (`dist/js/library.js`). Home has Continue (an upload card, then recent pieces with a miniature of their notes) and Explore (pieces, works or composers, under glass tabs that pin at the top). A composer has top pieces and works; a work lists its pieces numbered; a piece has its own page with details, a short note for some (`catalog/about.json`) and its sheet music as A4 pages, engraved in the browser with one standard title block and saved as a PDF (`dist/js/print.js`). A red dot marks a piece with no score of its own yet. Typing in the search bar moves the tabs up into the glass bar and shows results.

Layout: the content column runs edge to edge (16 px margins) until 872 px, then stops at 720 px, centred, so the back and profile buttons never sit half over it; the search bar and the tabs take the column's width. The content fades to black under the glass. Its content is flat; the controls over it are the same glass as the player's, refracting a picture of the content that `library.js` paints. Search runs in a worker (`dist/js/search-worker.js`), since its index takes a second or two to build. `#library`, `#library/chopin`, `#library/chopin/op-28` and `#library/chopin/op-28/4` open it at that view.

`npm run catalog:publish` (`tools/catalog/publish.js`) fills it: the trimmed catalogue (`dist/library/catalog.json`), the search for the browser (`dist/js/catalog.js`, from `tools/catalog/vocab.js` and `search.js`; do not edit), and one zipped score per piece in `dist/library/scores/`, picked from the files the checks passed (`tools/catalog/check-scores.js`). Those scores are engraved in the browser when the score view first needs them. The player keeps the last piece, its place and the recent list in `localStorage`; uploads are kept in IndexedDB so they can be reopened.

`sources/` holds untouched downloads that the shipped scores were made from.
