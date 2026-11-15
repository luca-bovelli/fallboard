/* A score file of one movement belongs to that movement, not to the whole work.

     movementOf(catalog, work, text) -> the movement entry, or null

   The title says which: "Movement I", "mvt 3", "2nd movement", or a word of the movement's own
   title ("Allemande", "Presto agitato"). Genre words count as one word in every language, so a
   file called "Fugue" finds a movement called "Fuga", and "Prelude" finds "Præludium". */
'use strict';
const { GENRES } = require('./vocab');
const { fold } = require('./search');

const GENRE_OF = new Map();
for (const [name, ...forms] of GENRES) for (const f of forms) { const w = fold(f); if (!w.includes(' ')) GENRE_OF.set(w, name); }
const norm = (w) => GENRE_OF.get(w) || w;
const wordsOf = (s) => fold(s).split(/[^\p{L}]+/u).filter((x) => x.length >= 4).map(norm);
const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8 };

function movementOf(catalog, work, text) {
  const kids = catalog.entries.filter((e) => e.parent === work.id && e.kind === 'movement');
  if (!kids.length) return null;
  const t = fold(text);
  const n = (t.match(/\b(?:movement|mvt|mvmt|satz|mouvement)\s*([ivx]+|\d+)\b|\b(\d)(?:st|nd|rd|th)\s+(?:movement|mvt)\b/) || []).slice(1).find(Boolean);
  if (n) { const num = /^\d+$/.test(n) ? +n : ROMAN[n]; const k = kids.find((x) => x.number === num); if (k) return k; }
  const words = new Set(wordsOf(text));
  const scored = kids.map((k) => ({ k, hits: wordsOf(k.title).filter((x) => words.has(x)).length })).filter((x) => x.hits).sort((a, b) => b.hits - a.hits);
  return scored.length && (scored.length === 1 || scored[0].hits > scored[1].hits) ? scored[0].k : null;
}

module.exports = { movementOf };
