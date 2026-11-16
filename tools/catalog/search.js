/* Catalogue search: one query box for composers, keys, catalogue numbers, titles and nicknames.

     const search = CatalogSearch.create(catalog);   // catalog/catalog.json
     search.find('rach 23 2')                        // [{ entry, score, label }, ...]

   A query is read in this order, each part leaving the rest of the text to the next:
     level      Henle's level of difficulty: "henle 6", "level 6", "6/9", "henle 4-6", "easy", "hard"
     key        "b-flat minor", "bb minor", "B♭ minor", "bbm", "Bbm", "fm", "in bb", "b moll" (German,
                where b is B-flat and h is B), "si bémol mineur"; dashes count as spaces
     numbers    "Op. 23 No. 2", "op23/2", "23 2", "BWV 846", "K. 331", "D 899 3", "Hob XVI:52",
                "no 2"; without a catalogue name, any of the entry's numbers can match
     composer   any spelling in composers.js, or the start of one: "rach", "tchaik", "shost"
     words      everything else, matched against titles in every language, nicknames, genres in
                every language ("étude", "study", "этюд"), tempo markings, and the titles of the
                sets and works an entry belongs to; a word may be shortened or have one typo
   Works without the key, numbers or composer asked for are left out; words only rank. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./vocab'));
  else root.CatalogSearch = factory(root.CatalogVocab);
})(typeof self !== 'undefined' ? self : this, function (vocab) {
  'use strict';

  /* ---------- normalising ---------- */

  const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/ß/g, 'ss').replace(/♭/g, 'b').replace(/♯/g, '#').replace(/ё/g, 'е');
  /* "ae", "oe", "ue" are how umlauts are typed without them: Traeumerei = Träumerei */
  const umlaut = (w) => w.replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u');
  const words = (s) => fold(s).replace(/[^\p{L}\p{N}#]+/gu, ' ').trim().split(' ').filter(Boolean).map(umlaut);

  /* ---------- keys ---------- */

  const LETTER = { c: 'C', d: 'D', e: 'E', f: 'F', g: 'G', a: 'A', b: 'B' };
  const ACC = { '#': '#', sharp: '#', b: 'b', flat: 'b', '': '' };
  const MODE = { major: 'major', maj: 'major', dur: 'major', majeur: 'major', minor: 'minor', min: 'minor', moll: 'minor', mineur: 'minor', m: 'minor' };
  const GERMAN = { c: 'C', cis: 'C#', des: 'Db', d: 'D', dis: 'D#', es: 'Eb', e: 'E', eis: 'E#', fes: 'Fb', f: 'F', fis: 'F#', ges: 'Gb', g: 'G', gis: 'G#', as: 'Ab', a: 'A', ais: 'A#', b: 'Bb', h: 'B', his: 'B#', ces: 'Cb' };
  const SOLFEGE = { do: 'C', ut: 'C', re: 'D', mi: 'E', fa: 'F', sol: 'G', la: 'A', si: 'B' };
  const enharmonic = { 'C#': 'Db', Db: 'C#', 'D#': 'Eb', Eb: 'D#', 'F#': 'Gb', Gb: 'F#', 'G#': 'Ab', Ab: 'G#', 'A#': 'Bb', Bb: 'A#', Cb: 'B', B: 'Cb', 'E#': 'F', F: 'E#', Fb: 'E', E: 'Fb', 'B#': 'C', C: 'B#' };

  /* finds and removes a key from the query text; returns { tonic, mode } (either may be absent) */
  function takeKey(text, raw) {
    let key = null;
    const found = (tonic, mode) => { key = { tonic, mode }; return ' '; };
    /* German and French names come with their mode word: "fis moll", "es dur", "si bemol mineur" */
    text = text.replace(/(^|\s)(c|cis|des|d|dis|es|e|eis|fes|f|fis|ges|g|gis|as|a|ais|b|h|his|ces)\s+(dur|moll)(?=\s|$)/, (m, pre, n, mode) => (key ? m : pre + found(GERMAN[n], MODE[mode])));
    text = text.replace(/(^|\s)(do|ut|re|mi|fa|sol|la|si)(?:\s+(diese|bemol))?\s+(majeur|mineur)(?=\s|$)/, (m, pre, n, acc, mode) => (key ? m : pre + found(SOLFEGE[n] + (acc === 'diese' ? '#' : acc ? 'b' : ''), MODE[mode])));
    /* English: "b flat minor", "bb minor", "c# min", "bbm", "c#m" */
    text = text.replace(/(^|\s)([a-g])\s*(#|sharp|flat|b)?\s*(major|minor|maj|min)(?=\s|$)/, (m, pre, l, acc, mode) => (key ? m : pre + found(LETTER[l] + ACC[acc || ''], MODE[mode])));
    text = text.replace(/(^|\s)([a-g])(#|b)m(?=\s|$)/, (m, pre, l, acc) => (key ? m : pre + found(LETTER[l] + ACC[acc], 'minor')));
    /* "fm", "gm", "em": a letter and m is a minor key, in small letters too, except "am", which
       is a word in titles ("Am Kamin"): A minor is "Am", "a minor" or "amin" */
    text = text.replace(/(^|\s)([b-g])m(?=\s|$)/, (m, pre, l) => (key ? m : pre + found(LETTER[l], 'minor')));
    /* "Am", "Em", "F#m" written with a capital: minor keys */
    if (!key) {
      const cap = raw.match(/(?:^|\s)([A-G])([#b♭♯]?)m(?=\s|$)/);
      if (cap) { text = text.replace(new RegExp('(^|\\s)' + cap[1].toLowerCase() + fold(cap[2]).replace('#', '\\#') + 'm(?=\\s|$)'), '$1 '); key = { tonic: cap[1] + ACC[fold(cap[2])], mode: 'minor' }; }
    }
    /* a tonic alone: "in b flat", "in c", or "bb", "c#", "f sharp" written as one */
    text = text.replace(/(^|\s)in\s+([a-g])\s*(#|sharp|flat|b)?(?=\s|$)/, (m, pre, l, acc) => (key ? m : pre + found(LETTER[l] + ACC[acc || ''])));
    text = text.replace(/(^|\s)([a-g])\s*(#|sharp|flat)(?=\s|$)/, (m, pre, l, acc) => (key ? m : pre + found(LETTER[l] + ACC[acc])));
    text = text.replace(/(^|\s)([a-g])b(?=\s|$)/, (m, pre, l) => (key ? m : pre + found(LETTER[l] + 'b')));
    if (!key) text = text.replace(/(^|\s)(major|minor|dur|moll)(?=\s|$)/, (m, pre, mode) => pre + found(undefined, MODE[mode]));
    return { text, key };
  }
  const keyOf = (k) => { if (!k) return null; const [tonic, mode] = k.split(' '); return { tonic, mode }; };

  /* ---------- levels of difficulty ---------- */

  /* Henle's levels (1 to 9, an entry's h): "henle 6", "level 6", "6/9", "henle 4-6", "henle 4 to 6",
     and Henle's bands, with or without "henle": "easy" or "beginner" (1 to 3), "medium" or
     "intermediate" (4 to 6), "difficult", "hard" or "advanced" (7 to 9). Read from the query as
     typed, before anything else, since "6/9" would otherwise be two numbers */
  const BANDS = { easy: [1, 3], beginner: [1, 3], medium: [4, 6], intermediate: [4, 6], difficult: [7, 9], hard: [7, 9], advanced: [7, 9] };
  function takeLevel(q) {
    let range = null, word = false;
    const cut = (re, f) => { if (!range) q = q.replace(re, (...m) => { range = f(...m); return m[1] + ' '; }); };
    cut(/(^|\s)(?:henle|level|lvl)\s*([1-9])(?:\s*(?:-|–|to)\s*([1-9]))?(?=\s|$)/i, (m, pre, a, b) => [+a, +(b || a)].sort((x, y) => x - y));
    cut(/(^|\s)([1-9])\s*\/\s*9(?=\s|$)/, (m, pre, a) => [+a, +a]);
    cut(/(^|\s)(?:(?:henle|level)\s+)?(easy|beginner|medium|intermediate|difficult|hard|advanced)(?=\s|$)/i, (m, pre, w) => { word = !/henle|level/i.test(m); return BANDS[w.toLowerCase()]; });
    return { text: q, range, word };
  }
  function keyMatches(q, k) {
    if (!q || !k) return null;
    if (q.mode && q.mode !== k.mode) return false;
    return !q.tonic || q.tonic === k.tonic || enharmonic[q.tonic] === k.tonic;
  }

  /* ---------- numbers ---------- */

  const CATS = { op: 'op', opus: 'op', opp: 'op', bwv: 'bwv', k: 'k', kv: 'k', kochel: 'k', d: 'd', deutsch: 'd', s: 's', searle: 's', hob: 'hob', woo: 'woo', l: 'l', p: 'p', kk: 'kk', b: 'b', m: 'm', mwv: 'mwv', th: 'th', eg: 'eg', cd: 'cd', lw: 'lw', r: 'r', anh: 'anh', cz: 'cz', ct: 'ct', c: 'c' };
  const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15, xvi: 16, xvii: 17, xviii: 18, xix: 19, xx: 20, xxi: 21, xxii: 22, xxiii: 23, xxiv: 24, xxv: 25, xxvi: 26, xxvii: 27, xxviii: 28, xxix: 29, xxx: 30, xxxi: 31 };
  /* a catalogue string as its name and number sequence: "Op. 28 No. 15" -> op [28, 15];
     "Hob. XVI:52" -> hob [16, 52]; "S. 244/2" -> s [244, 2]; letters stay on the number */
  function catSeq(c) {
    const f = fold(c).replace(/\b(nos?|nr|n)\b\.?/g, ' ').replace(/[.:/,–-]/g, ' ');
    const parts = f.split(/\s+/).filter(Boolean);
    let name = '';
    const nums = [];
    for (const p of parts) {
      if (/^\d+[a-z]?$/.test(p)) nums.push(p);
      else if (ROMAN[p] && name === 'hob') nums.push(String(ROMAN[p]));
      /* "BWV Anh. 114", "K. Anh. 32": the appendix is its own catalogue */
      else if (!nums.length && name && name !== 'anh' && /^(anh|anhang|app|appendix)$/.test(p)) name += 'anh';
      else if (!nums.length && !name && CATS[p.replace(/\d.*$/, '')] !== undefined) { name = CATS[p.replace(/\d.*$/, '')]; const n = p.match(/\d+[a-z]?$/); if (n) nums.push(n[0]); }
      else if (!nums.length && !name) name = p;
      else break;
    }
    return nums.length ? { name, nums } : null;
  }
  /* numbers in the query: with a catalogue name ("op 23 2", "bwv846", "hob xvi 52") or bare ("23 2", "no 2") */
  function takeNumbers(text) {
    const groups = [];
    const toks = text.split(/\s+/).filter(Boolean);
    const rest = [];
    /* Roman numerals count as numbers: "ii" to "xxxi" anywhere, and "i", "v", "x" after a word
       that numbers things ("Partita I", "Book V", "Consolations I") */
    for (let i = 0; i < toks.length; i++) {
      const r = ROMAN[toks[i]];
      if (r && (toks[i].length > 1 || (i && (NUMBERED.test(toks[i - 1]) || genreWord(toks[i - 1]))))) toks[i] = String(r);
    }
    for (let i = 0; i < toks.length; i++) {
      let t = toks[i];
      let name = null;
      const glued = t.match(/^([a-z]+)\.?(\d+[a-z]?)$/);
      if (glued && CATS[glued[1]] !== undefined) { name = CATS[glued[1]]; toks[i] = glued[2]; t = glued[2]; i--; }
      else if (CATS[t] !== undefined && i + 2 < toks.length && /^(anh|anhang|app|appendix)$/.test(toks[i + 1]) && /^\d/.test(toks[i + 2])) { name = (CATS[t] === 'anh' ? '' : CATS[t]) + 'anh'; i++; }
      else if (CATS[t] !== undefined && i + 1 < toks.length && (/^\d/.test(toks[i + 1]) || (t === 'hob' && ROMAN[toks[i + 1]]))) { name = CATS[t]; }
      else if (/^(no|nr|n|number)$/.test(t) && i + 1 < toks.length && /^\d+$/.test(toks[i + 1])) { name = ''; }
      else if (!/^\d+[a-z]?$/.test(t) && !/^#\d+$/.test(t)) { rest.push(t); continue; }
      /* a count before a plural genre is not a number to find: "24 preludes", "6 partitas" */
      else if (/^\d+$/.test(t) && i + 1 < toks.length && PLURAL_WORD.test(toks[i + 1])) continue;
      /* a year ("1838") is not a catalogue number */
      else if (/^1[5-9]\d\d$/.test(t)) continue;
      else { name = ''; i--; }
      /* gather the numbers that follow, with "no", "#", "/" between them */
      const nums = [];
      for (i = i + 1; i < toks.length; i++) {
        const u = toks[i].replace(/^#/, '');
        if (/^\d+[a-z]?$/.test(u)) nums.push(u);
        else if (name === 'hob' && ROMAN[u] && !nums.length) nums.push(String(ROMAN[u]));
        else if (/^(no|nr|n|number)$/.test(u) && i + 1 < toks.length && /^\d/.test(toks[i + 1])) continue;
        else { i--; break; }
      }
      if (nums.length) groups.push({ name, nums });
    }
    /* one number said several ways ("No 2 (D.420) D. 420.2") is one: drop groups that another
       group of the same catalogue extends, and bare numbers that end a named group */
    const same = (a, b) => a.name === b.name && a.nums.join() === b.nums.join();
    const kept = groups.filter((g, i) => groups.findIndex((h) => same(g, h)) === i)
      .filter((g, _, all) => !all.some((h) => h !== g && h.name === g.name && h.nums.length > g.nums.length && g.nums.every((n, j) => h.nums[j] === n)))
      .filter((g, _, all) => !(g.name === '' && g.nums.length === 1 && all.some((h) => h.name && h.nums[h.nums.length - 1] === g.nums[0])));
    return { text: rest.join(' '), groups: kept };
  }
  const PLURAL_WORD = /^(preludes|preludios|etudes|studies|mazurkas|nocturnes|waltzes|valses|polonaises|impromptus|ballades|scherzos|scherzi|inventions|sinfonias|bagatelles|intermezzi|rhapsodies|pieces|stucke|klavierstucke|morceaux|dances|tanze|landler|ecossaises|minuets|menuets|marches|consolations|partitas|suites|sonatas|sonatinas|fugues|variations|songs|lieder|moments|fantasies|caprices|romances|novelletten|canons)$/;
  const NUMBERED = /^(book|livre|heft|vol|volume|cahier|teil|part|no|nr|suite|partita|sonata|sonate|prelude|fugue|invention|sinfonia|consolation|consolations|liebestraum|ballade|scherzo|impromptu|etude|study|nocturne|waltz|valse|mazurka|polonaise|rhapsody|bagatelle|intermezzo|menuet|minuet|movement|satz)$/;
  let genreWord = () => false;
  const MOVEMENT = /^(movement|movements|mvt|mvmt|mov|satz|mouvement|mvmnt)$/;
  const ORDINAL = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, erste: 1, zweite: 2, dritte: 3, vierte: 4, premier: 1, deuxieme: 2, troisieme: 3 };
  const BOOK = /\b(?:Book|Livre|Heft|Vol\.?|Volume|Cahier|Série|Year|Année|Teil)\s+([IVX]+|\d+)\b/i;
  /* does an entry's number sequence answer a query group: exactly (2), as its start (1) */
  function seqMatch(g, s) {
    if (g.name && s.name && g.name !== s.name) return 0;
    if (g.name && !s.name) return 0;
    for (let i = 0; i < g.nums.length; i++) if (s.nums[i] !== g.nums[i] && s.nums[i] !== g.nums[i] + '' && parseInt(s.nums[i], 10) + '' !== g.nums[i]) return 0;
    if (g.nums.length > s.nums.length) return 0;
    return g.nums.length === s.nums.length ? 2 : 1;
  }

  /* ---------- index ---------- */

  function create(catalog) {
    const composers = catalog.composers;
    const byId = new Map(catalog.entries.map((e) => [e.id, e]));
    const genreForms = vocab.GENRES.map(([name, ...forms]) => ({ name, forms: forms.map((f) => words(f).join(' ')) }));
    const genreByName = new Map(genreForms.map((g) => [g.name, g]));
    const genreSet = new Set(genreForms.flatMap((g) => g.forms));
    genreWord = (w) => genreSet.has(w);

    /* composer names: every word of every spelling, for whole-word and prefix matches */
    const nameWords = [];
    for (const c of composers) for (const n of [c.name, c.full, ...(c.names || [])]) for (const w of words(n)) if (w.length > 1) nameWords.push({ w, id: c.id, surname: fold(n).endsWith(w) || words(c.name).includes(w) });

    /* the same titles and genre names recur across thousands of entries: split each once */
    const split = new Map();
    const termsOf = (text) => {
      let t = split.get(text);
      if (!t) { t = [...new Set([...words(text), ...words(text.replace(/[-'’]/g, ''))])]; split.set(text, t); }
      return t;
    };
    const docs = catalog.entries.map((e) => {
      const terms = new Map();
      /* hyphenated and apostrophe words also count joined: "cake-walk" is found by "cakewalk" */
      const put = (text, weight) => { if (!text) return; for (const w of termsOf(text)) if (!terms.has(w) || terms.get(w) < weight) terms.set(w, weight); };
      put(e.title, 10);
      put(e.en, 10);
      for (const n of e.nick || []) put(n, 12);
      for (const a of e.alt || []) put(a, 9);
      put(e.tempo, 4);
      if (e.genre) for (const f of (genreByName.get(e.genre) || { forms: [] }).forms) put(f, 6);
      /* the sets and works it belongs to: "Voiles" is found by "debussy preludes" */
      const seqs = (e.cat || []).map(catSeq).filter(Boolean);
      let depth = 0;
      for (let p = e.parent && byId.get(e.parent); p; p = p.parent && byId.get(p.parent)) {
        depth++;
        put(p.title, 5);
        put(p.en, 5);
        for (const n of p.nick || []) put(n, 6);
        for (const a of p.alt || []) put(a, 5);
        /* the book it is in: "wtc 1 prelude 1", "debussy preludes 2 voiles" */
        if (depth === 1) for (const t of [p.title, ...(p.alt || [])]) { const b = t.match(BOOK); if (b) seqs.push({ name: '', nums: [String(ROMAN[b[1].toLowerCase()] || b[1])], weak: true }); }
        /* and the work's own number: "Piano Sonata No. 14 ... II" is a movement of No. 14 */
        if (depth === 1 && e.kind === 'movement') { const no = (p.title || '').match(/\bNo\.?\s*(\d+)/); if (no) seqs.push({ name: '', nums: [no[1]], weak: true }); }
        if (p.genre) for (const f of (genreByName.get(p.genre) || { forms: [] }).forms) put(f, 3);
        /* a movement is found by its work's numbers and its own place: "moonlight 3", "op 27 2 3" */
        if (e.kind === 'movement' && depth === 1) for (const c of p.cat || []) { const s = catSeq(c); if (s) seqs.push({ name: s.name, nums: [...s.nums, String(e.number)], weak: true }); }
      }
      /* numbers in the title ("Ballade No. 1", "Hungarian Rhapsody No. 2") and a child's place */
      /* numbers in its titles: "Bagatelle No. 25" (Für Elise), "Menuet II" */
      for (const t of [e.title, e.en, ...(e.alt || [])]) {
        for (const m of (t || '').matchAll(/\bNo\.?\s*(\d+)/g)) seqs.push({ name: '', nums: [m[1]], title: true });
        const roman = (t || '').match(/\s([IVX]{1,5})$/);
        if (roman && ROMAN[roman[1].toLowerCase()]) seqs.push({ name: '', nums: [String(ROMAN[roman[1].toLowerCase()])], title: true });
      }
      for (const t of [e.title, e.en, ...(e.alt || [])]) { const b = (t || '').match(BOOK); if (b) { seqs.push({ name: '', nums: [String(ROMAN[b[1].toLowerCase()] || b[1])], title: true }); break; } }
      if (e.parent && e.number) seqs.push({ name: '', nums: [String(e.number)], weak: true });
      return { e, terms, seqs, key: keyOf(e.key), depth, termList: [...terms.keys()] };
    });

    const allTerms = new Set();
    for (const d of docs) for (const t of d.termList) allTerms.add(t);

    /* which index words a query word stands for: itself, words it starts (3+ letters), and
       words one edit away (5+ letters) */
    const expansions = new Map();
    function expand(w) {
      if (expansions.has(w)) return expansions.get(w);
      const out = new Map();
      for (const t of allTerms) {
        if (t === w) out.set(t, 1);
        else if (w.length >= 3 && t.startsWith(w)) out.set(t, 0.8);
        else if (w.length >= 5 && Math.abs(t.length - w.length) <= 1 && edit1(w, t)) out.set(t, 0.7);
      }
      expansions.set(w, out);
      return out;
    }

    function takeComposers(text) {
      const ids = new Set();
      const rest = [];
      for (const w of text.split(/\s+/).filter(Boolean)) {
        const hit = nameWords.filter((n) => n.w === w || (w.length >= 3 && n.surname && n.w.startsWith(w)));
        if (hit.length && !genreForms.some((g) => g.forms.includes(w))) hit.forEach((h) => ids.add(h.id));
        else rest.push(w);
      }
      return { text: rest.join(' '), ids };
    }

    /* plain: read the query without levels, for a band word that found nothing as a level ("easy
       sonata" when no sonata is that easy: then it is the "Sonata facile") */
    function find(query, limit = 10, plain = false) {
      const asked = query;
      const lv = plain ? { text: query, range: null } : takeLevel(query);
      query = lv.text;
      const raw = query;
      /* "op10", "no4", "wtc1": letters and digits written together are two words; "3rd",
         "third" are 3; "movement" and "mvt" only say a movement is wanted */
      let text = words(query).flatMap((w) => {
        const m = w.match(/^([a-z]+)(\d+[a-z]?)$/);
        if (m) return [m[1], m[2]];
        const ord = w.match(/^(\d+)(st|nd|rd|th|e|er|eme|te|ter)$/);
        if (ord) return [ord[1]];
        if (ORDINAL[w]) return [String(ORDINAL[w])];
        return [w];
      });
      /* "movement I", "mvt 3": the number stays, the word goes */
      text = text.map((w, i) => (i && MOVEMENT.test(text[i - 1]) && ROMAN[w] ? String(ROMAN[w]) : w)).filter((w) => !MOVEMENT.test(w)).join(' ');
      /* a dash joins a key into one chunk ("b-flat") and is otherwise a space */
      const k = takeKey(text, raw);
      const n = takeNumbers(k.text);
      /* the same number twice ("Op. 28 No. 13" in a title and its subtitle) is one number */
      n.groups = n.groups.filter((g, i) => n.groups.findIndex((h) => h.name === g.name && h.nums.join() === g.nums.join()) === i);
      const c = takeComposers(n.text);
      const qwords = c.text.split(/\s+/).filter(Boolean);
      const results = [];
      for (const d of docs) {
        const e = d.e;
        if (c.ids.size && !c.ids.has(e.composer)) continue;
        if (lv.range && !(e.h >= lv.range[0] && e.h <= lv.range[1])) continue;
        let score = 0;
        if (k.key) {
          const m = keyMatches(k.key, d.key);
          if (m === false) continue;
          /* an entry with no key on record may still be in it (a set, a work IMSLP gives no key) */
          if (m === null) { if (e.kind === 'movement') continue; score -= 8; } else score += 30;
        }
        /* each number group takes a different number of the entry: "wtc 1 prelude 1" needs
           both a book 1 and a piece 1 */
        let ok = true;
        const used = new Set();
        const take = (g) => {
          let best = 0, bestAt = -1;
          d.seqs.forEach((s, at) => {
            if (used.has(at)) return;
            const m = seqMatch(g, s);
            const v = m ? (m === 2 ? 40 : 18) - (s.weak ? 12 : 0) - (s.title && g.name ? 40 : 0) : 0;
            if (v > best) { best = v; bestAt = at; }
          });
          if (best > 0) used.add(bestAt);
          return best;
        };
        let exact = false;
        const missed = [];
        for (const g of n.groups) {
          let got = take(g);
          /* bare numbers that are not one sequence may be separate ones: "book 2 no 2" */
          if (!got && !g.name && g.nums.length > 1) {
            const parts = g.nums.map((x) => take({ name: '', nums: [x] }));
            got = parts.every((p) => p > 0) ? parts.reduce((a, b) => a + b, 0) - 10 : 0;
          }
          if (got) { score += got; if (g.name && got >= 40) exact = true; } else missed.push(g);
        }
        /* a second catalogue's number may be unknown here ("K. 15m (Anh. 109b Nr. 4)"): once one
           catalogue number matched exactly, other catalogues only cost points */
        for (const g of missed) { if (exact && g.name) score -= 20; else { ok = false; break; } }
        if (!ok) continue;
        let matched = 0, named = 0, nicked = 0;
        for (const w of qwords) {
          let best = 0;
          for (const [t, f] of expand(w)) { const weight = d.terms.get(t); if (weight) best = Math.max(best, weight * f); }
          /* "named": a title or nickname word that is not just a genre ("Raindrop", not "waltz") */
          if (best) { matched++; score += best * 3; if (best >= 9 && !genreWord(w)) named++; if (best >= 12) nicked++; } else score -= 12;
        }
        /* how it matched, for callers that need to judge a match (the score-file matcher) */
        const why = { key: !!(k.key && d.key), groups: n.groups.length, words: qwords.length, matched, named, nicked };
        if (qwords.length && !matched) continue;
        if (!lv.range && !k.key && !n.groups.length && !qwords.length && !c.ids.size) continue;
        /* popular and named works first; movements and early versions after whole pieces */
        score += 1.5 * Math.min(10, Math.log2(1 + (e.pop || 0))) + ((e.nick || []).length ? 3 : 0);
        if (e.kind === 'movement') score -= 6;
        if (e.variant) score -= 10;
        score -= d.depth;
        results.push({ entry: e, score, why });
      }
      if (!results.length && lv.word) return find(asked, limit, true);
      results.sort((a, b) => b.score - a.score);
      return results.slice(0, limit).map((r) => ({ ...r, label: label(r.entry) }));
    }

    /* "Chopin · Prelude in D-flat major, Op. 28 No. 15 'Raindrop'" with its set or work for parts */
    function label(e) {
      const comp = composers.find((c) => c.id === e.composer);
      const up = e.parent ? byId.get(e.parent) : null;
      const parts = [];
      if (e.kind === 'movement' && up) parts.push(up.title + (up.cat && up.cat[0] ? ', ' + up.cat[0] : '') + ': ' + romanOf(e.number) + '. ' + e.title);
      else parts.push(e.title + (e.en ? ' (' + e.en + ')' : '') + (e.cat && e.cat[0] ? ', ' + e.cat[0] : '') + (up && up.kind === 'set' && !(e.cat || []).length ? ' (' + up.title + ')' : ''));
      if (e.nick && e.nick.length) parts.push('"' + e.nick[0] + '"');
      return comp.name + ' · ' + parts.join(' ');
    }

    return { find, label, parse: (q) => { const lv = takeLevel(q); q = lv.text; const k = takeKey(words(q).join(' '), q); const n = takeNumbers(k.text); const c = takeComposers(n.text); return { level: lv.range, key: k.key, groups: n.groups, composers: [...c.ids], words: c.text }; } };
  }

  function edit1(a, b) {
    if (a === b) return true;
    let i = 0, j = 0, diff = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++diff > 1) return false;
      if (a.length > b.length) i++; else if (b.length > a.length) j++; else { if (a[i + 1] === b[j] && a[i] === b[j + 1]) { i += 2; j += 2; continue; } i++; j++; }
    }
    return diff + (a.length - i) + (b.length - j) <= 1;
  }
  const romanOf = (n) => ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'][n] || String(n);

  return { create, fold, words, catSeq };
});
