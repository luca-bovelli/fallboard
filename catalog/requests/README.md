# Scores wanted from IMSLP

[`imslp-needed.csv`](imslp-needed.csv) lists every catalogue piece that no source has given a
usable score for yet, one row per IMSLP page, since one download usually covers a whole set or
sonata. It opens in Excel, Numbers or Google Sheets.

As of the last build, 3,273 of the catalogue's 3,941 pieces still need a score:

- 3,019 of them sit on 1,388 IMSLP pages, one row each.
- 254 have no IMSLP page in the catalogue. They are in `not-on-imslp.csv`.

Rows come in priority order:

1. **Rows 1–8**: IMSLP has MusicXML or MuseScore files for every piece still needed. Download
   them; no transcription needed.
2. **Rows 9–20**: Capella files. Open them in MuseScore (it imports `.cap` and `.capx`) and
   export MusicXML. I can't read Capella here.
3. **Rows 21–60**: LilyPond, PMX, Finale, Sibelius and similar files. I can't open those,
   but each comes with a typeset PDF, and typeset PDFs recognise far better than scans.
   Transcribe the PDF.
4. **Rows 61 onward**: scans, ordered by how much the pieces are played. Up to row 100 they
   cover about 400 pieces; up to row 300, about 1,000.
5. **The last 111 rows**: works IMSLP marks as still protected in the US or the EU. Skip
   them.

Rebuild the list after a batch with `node tools/catalog/imslp-requests.js`. It reads only
IMSLP's page text through its API and downloads no scores.

## The columns

| column | what it says |
| --- | --- |
| `priority` | the order to work in |
| `folder` | the folder name to deliver into (see below) |
| `composer`, `work`, `catalogue` | the IMSLP page's work |
| `pieces` | how many catalogue pieces this page would cover |
| `hasSource` | `yes`: engraving files cover every piece still needed. `3 of 22`: they cover only some |
| `sourceFormat` | the program those files come from, as IMSLP names it. MusicXML and MuseScore need nothing more; Capella needs a MusicXML export from MuseScore; for anything else, transcribe the PDF that comes with it |
| `suggest` | my pick among the page's uploads: one edition, several files joined by `+` when it comes in parts |
| `suggestWhy` | why: engraving files, typeset or scan, then publisher, editor and description. `covers 3 of 12` when no single upload has them all |
| `otherSource` | engraving files that cover some of the pieces when `suggest` is a scan: grab them too |
| `rights` | set when IMSLP marks the work as still protected in the US or the EU: skip these rows |
| `imslp` | the page |
| `fileNames` | the names your transcriptions should have, one per piece still needed |
| `neededTitles` | the pieces still needed, by title. "(only movements 2, 3)" means the other movements are already covered |
| `needed` | the same pieces as catalogue ids, for me |

`imslp-needed.json` holds the same rows for scripts. [`not-on-imslp.csv`](not-on-imslp.csv)
lists the pieces with no IMSLP page in the catalogue: 236 Scarlatti sonatas (the catalogue
took them from Wikipedia's list, which does not link IMSLP) and 18 Shostakovich pieces (still
protected).
If you find one, deliver it like any other, in a folder named after its id with `/` written
as `__`.

## Choosing the file

`suggest` is a starting point, not a rule. Open the page's preview before downloading.

- Engraving files beat everything.
- A typeset edition, or a clean engraved edition from the late 19th or the 20th century (a
  complete-works edition such as Breitkopf's, or Henle, Peters or Schirmer), scans best.
- Avoid manuscripts. Avoid faded or skewed first editions when a cleaner print exists.
- Avoid arrangements, simplified editions and editions with heavy editorial additions
  (fingering is fine).
- One edition per folder. If the pieces are split over several files of the same edition
  (Book I and Book II), download all of them.

## Delivering

Put everything in `inbox/` at the top of the repository. Git ignores it, so nothing in it is
committed or published. Make one folder per row, named exactly as the row's `folder`:

```
inbox/
  schumann__op-68/                  fileNames: 9 16 20 22 …
    original/
      PMLP2707-schumann_op.68_durand.pdf
    9.musicxml
    16.mxl
    20.musicxml
    notes.txt
  beethoven__op-106/                fileNames: 1   (only the first movement is missing)
    original/
      PMLP1486-A4_106_----.pdf
    1.mscz
  grieg__op-47/                     MuseScore files on IMSLP: nothing to transcribe
    original/
      (the .mscz files as downloaded)
```

- **`original/`**: the IMSLP download(s), unchanged, with IMSLP's file names (the name tells me
  which edition it is). Engraving files go here too. With MusicXML or MuseScore files, the
  folder needs nothing else. With Capella files, add your MusicXML export of them as the
  transcription.
- **One transcription per piece**, named from the row's `fileNames` column: `16` becomes
  `16.musicxml`. A row whose page is a single piece says `score`. Where only some movements
  are missing, the names are the movement numbers. For a whole sonata, one file per movement
  (`1`, `2`, `3`) and one `score` file both work. So does one file for a whole set, as long as
  each piece starts on a new system with its own number or title; I split it.
- **Formats**: MusicXML (`.mxl`, `.musicxml`, `.xml`) is best. MuseScore files (`.mscz`, `.mscx`)
  are fine too; I convert them, and ask for a MusicXML export if that fails.
- **`notes.txt`** (optional): the program and version you used (Audiveris, PlayScore,
  ScanScore, SmartScore, MuseScore's PDF import…), which original you transcribed if there are
  several, and anything you already know is wrong ("bars 40 to 48 left hand an octave low",
  "ornaments missing", "skipped the repeat").

Send the recognition output as it is. You don't need to clean it up first: a rough
transcription is useful as long as it is honest about what it is.

## How I judge a transcription

Every file goes through the same repairs and checks as the scores already in the catalogue,
then I compare it with the original:

- **Bar arithmetic**: do the notes and rests of each bar add up to its time signature? This is
  where recognition fails most often.
- **Hands**: one piano part on two staves, with the clefs of the original.
- **Key and time signatures** against the catalogue's key and the original.
- **Range and leaps**: a misread ledger line shows up as a sudden octave jump.
- **Bar count, repeats and endings** against the original.
- **By eye**: I engrave it and compare systems with the scanned pages.

Each piece gets one of three verdicts. **Usable**: it goes in. **Usable after repairs**: I fix
what can be fixed automatically, such as tempo marks, tuplets that do not add up, hands split
into two parts, or lyrics and chord symbols. **Not usable**: I say which bars and why, so you
can redo only those. Some faults no check can catch: wrong pitches that still add up, a missing
inner voice, a misread rhythm that happens to fit the bar. Those only show when I compare the
engraving with the scan, so a bar-perfect file can still fail.

When a batch is ready, tell me which folders (or just "the inbox is ready").

## Scores that pass the checks but are wrong

Every bar can add up and a score can still be wrong (the left hand of Chopin's Op. 28 No. 15 in
PDMX, for one). [`catalog/rejects.json`](../rejects.json) lists such files and the pieces that
must not fall back to their set's copy. The checks mark them rejected, the library stops
serving them, and this list asks for them again. Add an entry whenever you hear or see one.
