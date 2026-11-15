/* Real-world queries and the piece each must return first.

     node tools/catalog/test-search.js          failures only, then the tally
     node tools/catalog/test-search.js -v       every query with its top results

   Each case: [query, composer, test on the top result's title, catalogue numbers and
   nicknames]. A failing case usually means a nickname or title the catalogue lacks
   (catalog/curated.json) or a way of writing a query the search does not read yet. */
'use strict';
const path = require('path');
const { create } = require('./search');
const catalog = require(path.join(__dirname, '..', '..', 'catalog', 'catalog.json'));
const search = create(catalog);
const verbose = process.argv.includes('-v');

const CASES = [
  // keys written short, in small letters ("am" stays a word)
  ['chopin ballade fm', 'chopin', /Op\. 52\b/],
  ['chopin fantaisie fm', 'chopin', /Op\. 49\b/],
  ['rach prelude gm', 'rachmaninoff', /Op\. 23 No\. 5\b/],
  ['liszt sonata bm', 'liszt', /S\. 178\b/],
  ['schumann am kamin', 'schumann', /Op\. 15 No\. 8\b/],
  // numbers, every way of writing them
  ['rach 23 2', 'rachmaninoff', /Op\. 23 No\. 2\b/],
  ['Rachmaninoff Bb Prelude', 'rachmaninoff', /Op\. 23 No\. 2\b/],
  ['Op. 23 No. 2 rachmaninov', 'rachmaninoff', /Op\. 23 No\. 2\b/],
  ['rachmaninow op.23/2', 'rachmaninoff', /Op\. 23 No\. 2\b/],
  ['chopin 10 4', 'chopin', /Op\. 10 No\. 4\b/],
  ['chopin op10 no4', 'chopin', /Op\. 10 No\. 4\b/],
  ['chopin etude op 10 #12', 'chopin', /Op\. 10 No\. 12\b/],
  ['bwv 846', 'bach', /BWV 846\b/],
  ['k 545', 'mozart', /K\. 545\b/],
  ['kv331', 'mozart', /K\. 331\b/],
  ['schubert d 899 3', 'schubert', /D\. 899 No\. 3\b/],
  ['schubert impromptu op 90 no 3', 'schubert', /(Op\. 90 No\. 3|D\. 899 No\. 3)\b/],
  ['haydn hob xvi 52', 'haydn', /Hob\. XVI:52\b/],
  ['hob. XVI:52', 'haydn', /Hob\. XVI:52\b/],
  ['scarlatti k 9', 'scarlatti', /K\. 9\b/],
  ['scarlatti L 413', 'scarlatti', /K\. 9\b/],
  ['liszt s 244 2', 'liszt', /S\. 244\/2|Rhapsody No\. 2/],
  ['scriabin op 8 no 12', 'scriabin', /Op\. 8 No\. 12\b/],
  ['shostakovich op 87 24', 'shostakovich', /Op\. 87 No\. 24\b/],
  ['chopin ballade 1', 'chopin', /Ballade No\. 1\b/],
  ['hungarian rhapsody 2', 'liszt', /Rhapsody No\. 2\b/],
  // keys, every way of writing them
  ['chopin sonata bbm', 'chopin', /Op\. 35\b/],
  ['chopin sonata b-flat minor', 'chopin', /Op\. 35\b/],
  ['chopin sonata b flat minor', 'chopin', /Op\. 35\b/],
  ['chopin sonata bb minor', 'chopin', /Op\. 35\b/],
  ['chopin sonata b♭ minor', 'chopin', /Op\. 35\b/],
  ['chopin sonata b-moll', 'chopin', /Op\. 35\b/],
  ['rach prelude c# minor', 'rachmaninoff', /Op\. 3 No\. 2\b/],
  ['rach prelude c sharp minor', 'rachmaninoff', /Op\. 3 No\. 2\b/],
  ['rachmaninoff prelude cis-moll', 'rachmaninoff', /Op\. 3 No\. 2\b/],
  ['rach prelude g minor', 'rachmaninoff', /Op\. 23 No\. 5\b/],
  ['chopin prelude e minor', 'chopin', /Op\. 28 No\. 4\b/],
  ['bach prelude and fugue c major', 'bach', /BWV 846\b/],
  ['mozart fantasia d minor', 'mozart', /K\. 397\b/],
  ['chopin nocturne e flat', 'chopin', /Op\. 9 No\. 2\b/],
  ['chopin nocturne Eb major', 'chopin', /Op\. 9 No\. 2\b/],
  ['beethoven sonata c#m', 'beethoven', /Op\. 27 No\. 2\b/],
  // nicknames and titles in other languages
  ['heroic polonaise', 'chopin', /Op\. 53\b/],
  ['polonaise heroique', 'chopin', /Op\. 53\b/],
  ['military polonaise', 'chopin', /Op\. 40 No\. 1\b/],
  ['fantaisie impromptu', 'chopin', /Op\. 66\b/],
  ['fantasy impromptu', 'chopin', /Op\. 66\b/],
  ['raindrop', 'chopin', /Op\. 28 No\. 15\b/],
  ['revolutionary etude', 'chopin', /Op\. 10 No\. 12\b/],
  ['winter wind', 'chopin', /Op\. 25 No\. 11\b/],
  ['black key etude', 'chopin', /Op\. 10 No\. 5\b/],
  ['ocean etude', 'chopin', /Op\. 25 No\. 12\b/],
  ['butterfly etude', 'chopin', /Op\. 25 No\. 9\b/],
  ['minute waltz', 'chopin', /Op\. 64 No\. 1\b/],
  ['funeral march chopin', 'chopin', /Op\. 35\b/],
  ['moonlight sonata', 'beethoven', /Op\. 27 No\. 2\b/],
  ['pathetique', 'beethoven', /Op\. 13\b/],
  ['appassionata', 'beethoven', /Op\. 57\b/],
  ['waldstein', 'beethoven', /Op\. 53\b/],
  ['tempest sonata', 'beethoven', /Op\. 31 No\. 2\b/],
  ['hammerklavier', 'beethoven', /Op\. 106\b/],
  ['fur elise', 'beethoven', /WoO 59\b/],
  ['für elise', 'beethoven', /WoO 59\b/],
  ['rondo alla turca', 'mozart', /K\. 331\b/],
  ['turkish march mozart', 'mozart', /K\. 331\b/],
  ['sonata facile', 'mozart', /K\. 545\b/],
  ['clair de lune', 'debussy', /Clair de lune/i],
  ['golliwogs cakewalk', 'debussy', /Golliwog/i],
  ['debussy arabesque 1', 'debussy', /Arabesque/i],
  ['la campanella', 'liszt', /Campanella|S\. 141/i],
  ['liebestraum 3', 'liszt', /S\. 541 No\. 3\b|Liebestraum No\. 3/],
  ['traumerei', 'schumann', /Träumerei/],
  ['träumerei', 'schumann', /Träumerei/],
  ['scenes from childhood', 'schumann', /Op\. 15\b/],
  ['years of pilgrimage', 'liszt', /Années/],
  ['well tempered clavier', 'bach', /BWV (846|870)–(869|893)/],
  ['wtc 2', 'bach', /BWV 870–893/],
  ['the girl with the flaxen hair', 'debussy', /L\. 117 No\. 8\b|cheveux de lin/i],
  ['sunken cathedral', 'debussy', /cathédrale engloutie/i],
  ['chopin prelude suffocation', 'chopin', /Op\. 28 No\. 4\b/],
  ['dance of the knights', 'prokofiev', /Op\. 75 No\. 6\b/],
  ['shostakovich dances of the dolls', 'shostakovich', /Dances of the Dolls/],
  ['happy farmer', 'schumann', /Op\. 68 No\. 10\b/],
  ['un sospiro', 'liszt', /S\. 144 No\. 3\b/],
  ['moonlight 3rd movement', 'beethoven', /Presto agitato/],
  ['twinkle twinkle variations', 'mozart', /K\. 265\b/],
  ['wtc 1 prelude 1', 'bach', /BWV 846\b/],
  ['goldberg variations', 'bach', /BWV 988\b/],
  ['songs without words', 'mendelssohn', /Lieder ohne Worte|Songs Without Words/i],
  ['spring song', 'mendelssohn', /Op\. 62 No\. 6\b/],
  ['venetian boat song', 'mendelssohn', /Venetian|Gondellied/i],
  ['moments musicaux 3', 'schubert', /D\. 780 No\. 3\b/],
  ['wedding day at troldhaugen', 'grieg', /Op\. 65 No\. 6\b/],
  ['march of the trolls', 'grieg', /Op\. 54 No\. 3\b/],
  ['tchaikovsky june', 'tchaikovsky', /June|Barcarolle/i],
  ['the seasons', 'tchaikovsky', /Seasons|Op\. 37/],
  ['scarbo', 'ravel', /Scarbo/i],
  ['pavane for a dead princess', 'ravel', /Pavane/i],
  ['prokofiev toccata', 'prokofiev', /Op\. 11\b/],
  ['scriabin etude op 42 5', 'scriabin', /Op\. 42 No\. 5\b/],
  ['rach elegie', 'rachmaninoff', /Op\. 3 No\. 1\b/],
  ['bach invention 1', 'bach', /BWV 772\b/],
  ['bach italian concerto', 'bach', /BWV 971\b/],
  ['chopin berceuse', 'chopin', /Op\. 57\b/],
  ['brahms intermezzo op 118 2', 'brahms', /Op\. 118 No\. 2\b/],
  ['children\'s corner', 'debussy', /Children/i],
  ['tchaikovsky childrens album', 'tchaikovsky', /Op\. 39\b/],
  // misspellings and composer forms
  ['chopan ballad 1', 'chopin', /Ballade No\. 1\b/],
  ['rachmaninov prelude in c sharp minor', 'rachmaninoff', /Op\. 3 No\. 2\b/],
  ['tschaikowsky seasons', 'tchaikovsky', /Seasons|Op\. 37/],
  ['szopen mazurka op 17 4', 'chopin', /Op\. 17 No\. 4\b/],
  ['shosty prelude 24', 'shostakovich', /No\. 24\b/],
];

let fails = 0;
for (const [q, composer, test] of CASES) {
  const res = search.find(q, 5);
  const top = res[0];
  const text = top ? [top.entry.title, ...(top.entry.cat || []), ...(top.entry.nick || []), ...(top.entry.alt || []), top.label].join(' | ') : '';
  const ok = top && top.entry.composer === composer && test.test(text);
  if (!ok) fails++;
  if (!ok || verbose) {
    console.log((ok ? 'ok   ' : 'FAIL ') + q.padEnd(40) + JSON.stringify(search.parse(q)));
    for (const r of res.slice(0, verbose ? 3 : 3)) console.log('       ' + r.score.toFixed(0).padStart(4) + '  ' + r.label);
  }
}
console.log(`${CASES.length - fails}/${CASES.length} queries find the right piece first`);
