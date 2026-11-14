# Repertoire catalogue

Every solo keyboard work by 19 composers, with what search needs to find it: titles in the composer's language and in English, nicknames, catalogue numbers, keys and genres. Score files are not part of it yet.

| Composer | Pieces | Composer | Pieces |
|---|---:|---|---:|
| Bach | 293 | Debussy | 80 |
| Beethoven | 149 | Rachmaninoff | 81 |
| Mozart | 166 | Scriabin | 209 |
| Chopin | 216 | Ravel | 32 |
| Liszt | 475 | Grieg | 208 |
| Schubert | 436 | Prokofiev | 124 |
| Schumann | 252 | Scarlatti | 556 |
| Brahms | 76 | Haydn | 106 |
| Mendelssohn | 107 | Tchaikovsky | 109 |
| Shostakovich | 98 | **Total** | **3,773** |

A piece is what you would open on its own: each prelude of a set, each sonata whole (its movements are entries too). Early versions (BWV 806a beside BWV 806) are kept but marked `variant` and not counted.

## Files

- `catalog.json`: the catalogue, built by `npm run catalog`. Do not edit it; edit `curated.json` or the build.
- `curated.json`: hand-written additions, applied last: nicknames and English titles the sources lack, catalogue fixes, pages to leave out, and sets no source lists.
- `raw/`: the source data as pulled, so the build needs no network.
  - `imslp/`: each composer's solo keyboard work pages from IMSLP (work-info block only, plus score and recording counts).
  - `wikipedia/`: the 555 Scarlatti sonatas and Shostakovich's piano works, which IMSLP covers only in part.
  - `wikidata/`: every Wikidata item by each composer, with catalogue codes, keys, labels and aliases.

## Entries

`catalog.json` holds `composers` (names, spellings people type, catalogues, life dates) and `entries`, a flat list linked by `parent`:

| Field | What it holds |
|---|---|
| `kind` | `set` (Préludes, Livre 1), `work` (Ballade No. 1; a sonata), `piece` (one prelude of a set), `movement` |
| `title` | the work's own title, usually in its own language ("Kinderszenen", "Années de pèlerinage I") |
| `en` | the English title, when the title is in another language ("Scenes from Childhood") |
| `alt` | other titles: other languages, earlier names, IMSLP's and Wikidata's alternatives |
| `nick` | nicknames, the shown one first ("Raindrop", "Moonlight", "Heroic") |
| `cat` | catalogue numbers, the composer's main catalogue first ("Op. 28 No. 15", "B. 107", "C. 180") |
| `key`, `tempo`, `genre` | "Db major"; the tempo marking; the genre in English |
| `pop` | IMSLP's score and recording count, a rough measure of how much it is played |
| `rights` | whether the composition is public domain in the EU (70 years after the composer's death) and the US (published 1930 or earlier); `null` when the publication year is unknown |

`rights` is about the composition only. A score file has its own rights (the edition, the person who typeset it), which the score library will need to record separately. Shostakovich's music is still protected in both, and some of Prokofiev's and Rachmaninoff's later works are protected in the US.

## Commands

```bash
npm run catalog            # build catalog.json from raw/ and curated.json
npm run catalog:test       # the search test queries
npm run catalog:pull       # pull raw data for composers that have none yet
```

To refresh a composer's raw data, run a puller with names: `node tools/catalog/pull-imslp.js chopin liszt`, likewise `pull-wikidata.js`. A new composer goes in `tools/catalog/composers.js`.

## Search

`tools/catalog/search.js` reads one query box: keys in any spelling ("bbm", "b-flat minor", "B♭ minor", "b moll"), catalogue numbers with or without names ("op 23 no 2", "23 2", "bwv846", "hob xvi 52"), composer spellings and prefixes ("rach", "tschaikowsky", "szopen"), genres in any language, nicknames, and one typo per word. `tools/catalog/test-search.js` holds the queries it is held to.

## Sources

- [IMSLP](https://imslp.org) work pages: titles, catalogue numbers, keys, movements and alternative titles (facts only).
- English Wikipedia: [List of solo keyboard sonatas by Domenico Scarlatti](https://en.wikipedia.org/wiki/List_of_solo_keyboard_sonatas_by_Domenico_Scarlatti), [List of compositions by Dmitri Shostakovich](https://en.wikipedia.org/wiki/List_of_compositions_by_Dmitri_Shostakovich) (facts only).
- [Wikidata](https://www.wikidata.org) (CC0): labels, aliases and nicknames.
- Hans von Bülow's names for Chopin's Op. 28 preludes as listed on [ourchopin.com](https://ourchopin.com/analysis/prelude.html).
