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

The piece's name in the player opens a menu of recent pieces; its More opens the library (`dist/js/library.js`). Home has Continue (an upload card, then recent pieces, each card its opening bars as a little piano roll fading into its name; a swiping shelf on touch screens, one fitted row with a mouse) and Explore (pieces, works or composers, under glass tabs that pin at the top). Pieces and works have generated covers (`cover()` in `library.js`), decided by a hash of the album's id so each never changes: every piece in a work, or in a numbered series such as Liszt's S. 244, shares its album's palette, layout and type and changes only the words. A cover is a mesh gradient from one of twelve palettes, one of four layouts (an echoed title in outside-only outlines, an engraved frame, a giant outlined numeral, a title under a staff), procedural SVG ornaments (rules, borders and corner pieces, with the turn, mordent and fermata as centrepieces), titles in Nyght Serif (self-hosted, `dist/fonts/nyght`), Boska, Melodrama or Switzer Thin (Fontshare) sized by measuring them, and the nickname set large when there is one. Outlines are always Nyght Serif, since a didone's hairline serifs fall apart when outlined, and thin text never sits over the ornaments. A cover is one picture at every size (everything inside is in `cqw`). `#library/~covers` shows sixty side by side. A piece's or a work's page opens on its cover, large and centred, its colours glowing behind. A composer has top pieces and works; a work lists its pieces numbered; a piece has its own page with its cover, details, a short note for some (`catalog/about.json`) and its sheet music as A4 pages, engraved in the browser with one standard title block (`dist/js/print.js`): a page opens full screen with the PDF to download. A red dot marks a piece with no score of its own yet. Pieces carry the G. Henle Verlag's level of difficulty, 1 to 9, as a pill at the end of their row ("6/9"; a work shows its pieces' range, "4–7/9") and in their details, linked to the Henle edition that grades them; the search finds by level ("henle 6", "6/9", "henle 4-6", "henle easy"). Typing in the search bar moves the tabs up into the glass bar and shows results.

Once a page's heading has scrolled up under the top bar, its name shows small in the bar's middle, as iOS does (with the composer under a piece's or a work's name; on the home, Library and then Explore); Explore's tabs pin under the bar, overshooting a little as they arrive. The keyboard crops the library from below: on iOS a touch on the search bar opens the keyboard from a hidden field at the top (so iOS does not slide the page up to reach the search field), the search bar rides up on the keyboard, and the real field takes over once it is up.

Every step in the library (including a search) is an entry on the browser's history, so the back button, Escape, the browser's back and a phone's back gesture all step back the same way; installed on a home screen, the library adds its own swipe from the left edge.

Layout: the content column runs edge to edge (16 px margins) until 872 px, then stops at 720 px, centred, so the back and profile buttons never sit half over it; the search bar and the tabs take the column's width. The content fades to black under the glass. Its content is flat; the controls over it are the same glass as the player's, refracting a picture of the content that `library.js` paints. Search runs in a worker (`dist/js/search-worker.js`), since its index takes a second or two to build. `#library`, `#library/chopin`, `#library/chopin/op-28` and `#library/chopin/op-28/4` open it at that view.

`npm run catalog:publish` (`tools/catalog/publish.js`) fills it: the trimmed catalogue (`dist/library/catalog.json`), the search for the browser (`dist/js/catalog.js`, from `tools/catalog/vocab.js` and `search.js`; do not edit), and one zipped score per piece in `dist/library/scores/`, picked from the files the checks passed (`tools/catalog/check-scores.js`). Those scores are engraved in the browser when the score view first needs them. The player keeps the last piece, its place and the recent list in `localStorage`; uploads are kept in IndexedDB so they can be reopened.

`sources/` holds untouched downloads that the shipped scores were made from.
