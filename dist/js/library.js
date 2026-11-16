/* Fallboard — library.js
   The library over the player. Home has two sections: Continue (an upload card, then the pieces
   opened lately) and Explore (pieces, works or composers to browse). Typing in the search bar
   moves Explore's tabs up into the glass layer and shows results under them. A composer has
   their best-known pieces and their works; a work lists its pieces numbered; a piece has its
   own page with its details, a note on it for some, and its sheet music as A4 pages to save as
   a PDF.

   The catalogue (library/catalog.json) and the search (js/catalog.js, run in
   js/search-worker.js) are built by tools/catalog/publish.js; scores open in the player through
   FB.app (js/app.js); pages and PDFs come from js/print.js.

   Layers, as on the player: the content is flat DOM on the black page; the controls float over
   it as the Graph Notes glass, refracting a picture of the content beneath them that paint()
   draws: browsers cannot hand DOM pixels to WebGL, so the boxes, text and miniatures near the
   glass are drawn again into its scene. */
(function () {
  'use strict';
  const FB = window.FB;
  const $ = (id) => document.getElementById(id);
  const V = window.FB_VERSION ? '?v=' + window.FB_VERSION : '';
  const ERA = [1680, 1980];   // the composers' tiles share one line of years
  const fmt = (n) => n.toLocaleString('en-US');
  const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
  const TABS = ['pieces', 'works', 'composers'];
  const HOME_RECENTS = 10;

  const el = {
    lib: $('library'), scroll: $('libScroll'), page: $('libPage'),
    back: $('libBack'), scopes: $('libScopes'), profile: $('libProfile'),
    more: $('libMore'), menu: $('libMenu'), share: $('libShare'), shareNote: $('libShareNote'),
    bottom: $('libBottom'), search: $('libSearch'), query: $('libQuery'), clear: $('libClear'),
    menuBtn: $('menuBtn'), file: $('fileInput'), title: $('libTitle'), fadeTop: $('libFadeTop'),
  };

  const L = { open: false, data: null, stack: [{ view: 'home' }], query: '', tab: 'pieces', thumbs: [], prints: new Map() };
  /* the glass renderer, the version of the scene it refracts, and its frame loop */
  let glass = null, sceneV = 0, frameQueued = false, busyUntil = 0;

  /* ------------------------------------------------------------------ the catalogue */
  let loading = null;
  function load() {
    if (!loading) {
      loading = fetch('library/catalog.json' + V)
        .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(prepare)
        .catch((e) => { loading = null; throw e; });
    }
    return loading;
  }

  function prepare(cat) {
    const raw = new Map(cat.entries.map((e) => [e.id, e]));
    /* versions of a work (an early version, a revision) stay out of the lists, with their parts */
    const isVariant = (e) => { for (let x = e; x; x = x.parent && raw.get(x.parent)) if (x.variant) return true; return false; };
    const entries = cat.entries.filter((e) => !isVariant(e));
    const byId = new Map(entries.map((e) => [e.id, e]));
    const comp = new Map(cat.composers.map((c) => [c.id, c]));
    const kids = new Map();
    for (const e of entries) if (e.parent && byId.has(e.parent)) { if (!kids.has(e.parent)) kids.set(e.parent, []); kids.get(e.parent).push(e); }
    for (const list of kids.values()) list.sort((a, b) => (a.number || 1e9) - (b.number || 1e9));
    const parentOf = (e) => e.parent && byId.get(e.parent);
    /* the file that opens an entry: its own, or that of the work or set it belongs to (unless
       that copy of it is known to be wrong) */
    const fileOf = (e) => {
      if (e.s || e.b) return e;
      if (e.own) return null;
      for (let x = parentOf(e); x; x = parentOf(x)) if (x.s || x.b) return x;
      return null;
    };
    /* pieces under each entry, and how many have a score of their own */
    const count = new Map();
    const walk = (e) => {
      const k = kids.get(e.id);
      let n = 0, have = 0;
      if (k && k.length) for (const c of k) { const r = walk(c); n += r[0]; have += r[1]; }
      else { n = 1; have = e.s || e.b ? 1 : 0; }
      if (e.s || e.b) have = n;
      count.set(e.id, [n, have]);
      return [n, have];
    };
    const tops = entries.filter((e) => !parentOf(e));
    for (const t of tops) walk(t);
    /* fame: an entry's own, or a little of its set's (a prelude does not inherit all of Op. 28's) */
    const fame = (e) => e.pop || (parentOf(e) ? (parentOf(e).pop || 0) * 0.25 : 0);
    const leaves = entries.filter((e) => !kids.has(e.id));
    const works = entries.filter((e) => kids.has(e.id));
    const spread = (list, max, per = 2) => {
      const out = [], seen = new Map();
      for (const e of list) {
        const k = e.parent || e.id;
        if ((seen.get(k) || 0) >= per) continue;
        seen.set(k, (seen.get(k) || 0) + 1);
        out.push(e);
        if (out.length >= max) break;
      }
      return out;
    };
    /* Explore: well-known pieces and works that open in the player */
    const explore = {
      pieces: spread(leaves.filter((e) => fileOf(e)).sort((a, b) => fame(b) - fame(a)), 30),
      works: works.filter((e) => count.get(e.id)[1] > 0).sort((a, b) => fame(b) - fame(a)).slice(0, 24),
    };
    L.data = { cat, entries, byId, comp, kids, parentOf, fileOf, count, tops, leaves, works, fame, explore };
    el.query.placeholder = 'Search ' + fmt(leaves.length) + ' pieces';
  }

  /* ------------------------------------------------------------------ names */
  /* titles keep their language, with flats and sharps as signs: "Prelude in D♭ major" */
  const signs = (t) => t.replace(/\b([A-G])-(flat|sharp)\b/g, (m, n, a) => n + (a === 'sharp' ? '♯' : '♭'));
  /* "C# minor", "Ab major", "E-flat major" as a musician writes them: C♯ minor, A♭ major */
  const keyText = (k) => k.replace(/^([A-G])(#|-sharp|b(?=\s)|-flat)/i, (m, n, a) => n.toUpperCase() + (/#|sharp/i.test(a) ? '♯' : '♭'));
  /* the name pianists use for it (“Raindrop”, “Pathétique”); never a repeat or translation of the
     title, nor a library catalogue's romanisation ("Fantazii︠a︡-ėkspromt") */
  function nickOf(e) {
    const same = (a, b) => { const x = fold(a).replace(/ /g, ''), y = fold(b).replace(/ /g, ''); return x.includes(y) || y.includes(x); };
    /* another title rather than a nickname: one starting like the title ("Für Therese" beside
       "Für Elise"), or a collection's volume ("Clavier-Übung IV") */
    const first = (s) => fold(s).split(' ')[0];
    const alias = (n) => first(n) === first(e.title) || /\b[IVX]+$/.test(n) || /\b(op|no|bwv|vol)\b/i.test(n);
    return (e.nick || []).find((n) => !/[︠-︯]/.test(n) && !alias(n) && ![e.title, e.en].filter(Boolean).some((t) => same(n, t))) || '';
  }
  const withNick = (name, e) => { const n = nickOf(e); return n ? name + ' “' + n + '”' : name; };
  /* a set named by its count when its title is its pieces' kind: "24 Preludes", "12 Études" */
  const plural = (g) => (/s$/.test(g) ? g : /[^aeiou]y$/.test(g) ? g.slice(0, -1) + 'ies' : /(z|x|ch|sh)$/.test(g) ? g + 'es' : g + 's');
  function workName(e) {
    const k = L.data.kids.get(e.id) || [];
    let name = signs(e.title);
    if (k.length > 1 && k[0].kind !== 'movement' && k[0].genre && !/^\d/.test(name) && fold(plural(k[0].genre)) === fold(e.title)) name = k.length + ' ' + name;
    return withNick(name, e);
  }
  /* a piece's name; a movement away from its work says which work */
  function pieceName(e, alone) {
    const name = withNick(signs(e.title), e);
    const p = L.data.parentOf(e);
    if (alone && e.kind === 'movement' && p) return workName(p) + ': ' + (ROMAN[e.number] ? ROMAN[e.number] + '. ' : '') + name;
    return name;
  }
  const nameOf = (e, alone) => (L.data.kids.has(e.id) ? workName(e) : pieceName(e, alone));
  const catOf = (e) => (e.cat || [])[0] || (e.kind === 'movement' && L.data.parentOf(e) ? (L.data.parentOf(e).cat || [])[0] || '' : '');
  const composerName = (e) => L.data.comp.get(e.composer).name;
  const lifeOf = (c) => (c.born ? c.born + '–' + (c.died || '') : '');
  /* a piece without a score of its own: a red dot after its name. A work: when some of its pieces
     have none */
  const lacks = (e) => { const [n, have] = L.data.count.get(e.id); return have < n; };
  function catKey(e) {
    const c = (e.cat || [])[0];
    const comp = L.data.comp.get(e.composer);
    if (!c) return [99, 1e9, 0, e.title];
    const m = /^(.*?)(\d+)\D*(\d+)?/.exec(c);
    const name = m ? m[1].replace(/[\s.]+$/, '').trim() : c;
    const at = (comp.catalogues || []).findIndex((x) => x.replace(/\.$/, '') === name.replace(/\.$/, ''));
    return [at < 0 ? 50 : at, m ? +m[2] : 1e9, m && m[3] ? +m[3] : 0, e.title];
  }
  const byCatalogue = (a, b) => {
    const x = catKey(a), y = catKey(b);
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
    return x[3].localeCompare(y[3]);
  };
  const byFame = (a, b) => L.data.fame(b) - L.data.fame(a);

  /* ------------------------------------------------------------------ building blocks */
  function make(tag, cls, text, paint) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    if (paint) n.dataset.paint = paint;
    return n;
  }
  function button(cls, text, onClick, paint) {
    const b = make('button', cls, text, paint);
    b.type = 'button';
    if (onClick) b.addEventListener('click', onClick);
    return b;
  }
  /* a page's heading; a piece's or a work's page leads with its cover, as an album's does */
  function head(page, title, lines, extra, art) {
    const h = make('header', 'lib-head' + (art ? ' with-cover' : ''));
    const text = art ? make('div', 'head-text') : h;
    const h1 = make('h1', '', title, 'text');
    h1.dataset.title = title;
    text.appendChild(h1);
    for (const line of lines) if (line) text.appendChild(typeof line === 'string' ? make('p', '', line, 'text') : line);
    if (extra) text.appendChild(extra);
    if (art) h.append(art, text);
    page.appendChild(h);
    return h;
  }
  function section(page, title, seeAll) {
    const s = make('section', 'lib-sec');
    const top = make('div', 'sec-head');
    top.appendChild(make('h2', '', title, 'text'));
    if (seeAll) top.appendChild(button('see-all', 'See all', seeAll, 'text'));
    s.appendChild(top);
    page.appendChild(s);
    return s;
  }
  const CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
  const dot = () => { const d = make('i', 'dot'); d.title = 'No score of its own yet'; return d; };
  const go = (e) => push(L.data.kids.has(e.id) ? { view: 'work', id: e.id } : { view: 'piece', id: e.id });
  /* Henle's level of difficulty (1 to 9, graded per piece: a sonata's movements each have one).
     A work shows the range of its pieces' levels */
  const LEVEL_BAND = ['', 'easy', 'easy', 'easy', 'medium', 'medium', 'medium', 'difficult', 'difficult', 'difficult'];
  const levelRange = (e) => {
    const d = L.data;
    if (!d.levels) d.levels = new Map();
    if (d.levels.has(e.id)) return d.levels.get(e.id);
    let lo = e.h || 10, hi = e.h || 0;
    for (const k of d.kids.get(e.id) || []) { const r = levelRange(k); if (r) { lo = Math.min(lo, r[0]); hi = Math.max(hi, r[1]); } }
    const r = hi ? [lo, hi] : null;
    d.levels.set(e.id, r);
    return r;
  };
  function levelPill(e) {
    const r = levelRange(e);
    if (!r) return null;
    const p = make('span', 'lvl');
    p.appendChild(make('b', '', r[0] === r[1] ? String(r[0]) : r[0] + '–' + r[1], 'text'));
    p.appendChild(make('small', '', '/9', 'text'));
    p.title = r[0] === r[1] ? 'Henle level ' + r[0] + ' of 9 (' + LEVEL_BAND[r[0]] + ')' : 'Henle levels ' + r[0] + ' to ' + r[1] + ' of 9';
    return p;
  }

  /* a row. style: 'two' (name, then composer and number in grey), 'one' (the name only),
     'num' (a grey number, then the name), 'work' (the grey catalogue number, then the name) */
  function row(e, style, n) {
    const d = L.data, group = d.kids.has(e.id);
    const b = button('row' + (style === 'num' ? ' num one' : style === 'two' ? ' has-cover' : ' one has-cover'), undefined, () => go(e));
    if (style === 'num') b.appendChild(make('span', 'n', n != null ? String(n) : '', 'text'));
    else b.appendChild(lazyCover(e));
    const main = make('span', 'main');
    const title = make('b', '', undefined, 'text');
    if (style === 'work' && catOf(e)) title.appendChild(make('span', 'cat', catOf(e)));
    title.appendChild(document.createTextNode(style === 'two' ? nameOf(e, true) : nameOf(e, false)));
    if (lacks(e)) title.appendChild(dot());
    main.appendChild(title);
    if (style === 'two') main.appendChild(make('small', '', [composerName(e), catOf(e)].filter(Boolean).join(' · '), 'text'));
    b.appendChild(main);
    const aside = make('span', 'aside');
    const pill = levelPill(e);
    if (pill) aside.appendChild(pill);
    if (group) aside.insertAdjacentHTML('beforeend', CHEVRON);
    b.appendChild(aside);
    return b;
  }
  /* A row's cover, made when the row comes within a screen or two of view: Chopin's works are
     227 rows, and making all their covers at once held the page up for half a second (more on
     a phone). The first rows of a list get theirs at once (lazyNow), so a page opens complete;
     the rest hold a blank square of the same size until they are near */
  let lazyNow = 0;
  const coverSoon = new IntersectionObserver((seen) => {
    for (const s of seen) {
      if (!s.isIntersecting) continue;
      coverSoon.unobserve(s.target);
      const real = cover(s.target._entry);
      s.target.replaceWith(real);
    }
    sceneV++; kick();
  }, { root: el.scroll, rootMargin: '1200px 0px' });
  function lazyCover(e) {
    if (lazyNow > 0) { lazyNow--; return cover(e); }
    const hold = make('span', 'cover is-later');
    hold.setAttribute('aria-hidden', 'true');
    hold._entry = e;
    coverSoon.observe(hold);
    return hold;
  }
  /* A list's rows: those a screen can show at once, then the rest in slices between frames, so a
     tap that swaps a long list (Explore's tabs, a search) never holds up the frames of what
     answers it (the pill sliding, the press letting go). A view that must reach far down at once
     (going back to where a list was scrolled) finishes them first: finishRows() */
  const ROWS_NOW = 16;
  let rowsLeft = [];
  function rows(list, style, cols = true) {
    lazyNow = 30;
    const box = make('div', 'rows' + (cols ? ' cols' : ''));
    const one = (i) => box.appendChild(row(list[i], style, style === 'num' ? list[i].number || i + 1 : null));
    let i = 0;
    for (; i < Math.min(ROWS_NOW, list.length); i++) one(i);
    if (i < list.length) {
      const job = { box, more: (budget) => { const end = performance.now() + budget; while (i < list.length && performance.now() < end) one(i++); return i < list.length; } };
      rowsLeft.push(job);
      if (rowsLeft.length === 1) setTimeout(rowsSlice, 0);
    }
    return box;
  }
  function rowsSlice() {
    /* lists no longer on the page are dropped; each slice takes a few ms, then lets a frame by */
    rowsLeft = rowsLeft.filter((j) => j.box.isConnected || !j.box.parentNode);
    const job = rowsLeft[0];
    if (!job) return;
    if (!job.more(6)) rowsLeft.shift();
    if (rowsLeft.length) setTimeout(rowsSlice, 0);
  }
  function finishRows() {
    for (const j of rowsLeft) if (j.box.isConnected) j.more(Infinity);
    rowsLeft = [];
  }

  /* a recent piece: a square card, its opening as a piano roll rising from the bottom edge as in
     the player, its name at the top over a wash of its two hands' colours (--wl from the top left,
     --wr from the top right, js/roll-gl.js washOf); the composer under the card */
  function cardItem(b, title, under) {
    const item = make('div', 'card-item');
    b.appendChild(make('span', 'shade'));
    b.appendChild(make('b', 'title', title, 'text'));
    b.setAttribute('aria-label', under ? title + ', ' + under : title);
    item.appendChild(b);
    if (under) item.appendChild(make('small', 'by', under, 'text'));
    return item;
  }
  function card(r) {
    const b = button('card', undefined, () => { FB.app.open(r.open, r); close(); }, 'box');
    const cv = make('canvas', 'roll', undefined, 'img');
    cv.setAttribute('aria-hidden', 'true');
    cv._r = r;
    b.appendChild(cv);
    L.thumbs.push([cv, r]);
    const wash = FB.rollGL && FB.rollGL.washOf(r.id, css);
    if (wash) { b.style.setProperty('--wr', wash[0]); b.style.setProperty('--wl', wash[1]); }
    return cardItem(b, r.title, r.composer);
  }
  /* the first card: your own MusicXML file */
  function uploadCard() {
    const b = button('card upload', undefined, () => FB.app.upload(), 'box');
    const art = make('span', 'art');
    art.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
    b.appendChild(art);
    return cardItem(b, 'Upload a score', 'MusicXML or .mxl');
  }
  /* the opening bars as the player's roll draws them: pitch across, time rising from the
     keyboard's edge at the bottom of the card (the first notes lowest), each hand in its colour,
     bar lines faint. Drawn lit by js/roll-gl.js; this flat one is for browsers without WebGL 2 */
  const ROLL_FLOOR = 1;   // where the first notes land, as a share of the card's height
  function drawThumb(cv, r) {
    if (FB.rollGL && FB.rollGL.thumb(cv, r, css)) return;   // lit, as the player draws it; below, the flat roll without WebGL 2
    const w = cv.clientWidth, h = cv.clientHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
    if (!w || !h) return;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = css.stage; c.fillRect(0, 0, w, h);
    const roll = r.roll;
    if (!roll || !roll.notes.length) return;
    const t = roll.notes;
    let lo = 127, hi = 0;
    for (let i = 0; i < t.length; i += 4) { lo = Math.min(lo, t[i + 2]); hi = Math.max(hi, t[i + 2]); }
    lo -= 2; hi += 2;
    const keyW = w / (hi - lo + 1), floor = h * ROLL_FLOOR, top = h * 0.38;   // above: the card's name (no blur here)
    const yOf = (cs) => floor - (cs / roll.end) * (floor - top);
    c.fillStyle = css.grid;
    for (const b of roll.bars) c.fillRect(0, Math.round(yOf(b)), w, 1);
    for (let i = 0; i < t.length; i += 4) {
      const y0 = yOf(t[i]), y1 = yOf(t[i] + t[i + 1]);
      const x = (t[i + 2] - lo) * keyW;
      c.fillStyle = t[i + 3] ? css.lh : css.rh;
      rr(c, x + keyW * 0.12, y1 + 0.5, keyW * 0.76, Math.max(2, y0 - y1 - 1), Math.min(2, keyW * 0.3));
      c.fill();
    }
  }

  /* ------------------------------------------------------------------ covers
     Every piece and work has artwork of its own, decided by a hash of its id, so it is the same
     on every visit: a palette and a mesh of soft colour fields, a layout, a typeface. The layouts
     borrow from engraved editions and posters: an echoed title, an engraved double frame, a giant
     numeral in outline, a title riding a staff. The name set large is the one people remember:
     the nickname when there is one ("Raindrop"), else the piece's own name without its key or
     number, which go underneath. The cover is one picture at every size (index.html .cover).
     Composers will have photographs instead. */
  const PALETTES = [
    /* base, four colour fields, ink, lines, and the hands' colours in the player (right, left:
       two of the cover's own colours, the right always the lighter, js/roll-gl.js) */
    ['#3424e8', ['#3a2bf0', '#3f8cf2', '#7fe6a8', '#3fe3cf'], '#f7f6ff', 'rgb(255 255 255 / 0.55)', ['#7fe6a8', '#5b6cff']],   // electric
    ['#ff1d1d', ['#ff4a2a', '#ff8b3a', '#ffcf86', '#ff2b1f'], '#ffe8b5', 'rgb(255 232 181 / 0.6)', ['#ffc46b', '#ff4b3e']],    // ember
    ['#1d1450', ['#5b3fe0', '#ef6aa6', '#ffb489', '#2a1a6e'], '#fff0f5', 'rgb(255 240 245 / 0.5)', ['#ffb489', '#8f63ff']],    // dusk
    ['#05396b', ['#0a6bd8', '#1fd3c3', '#bafff0', '#063e7a'], '#f0fffb', 'rgb(240 255 251 / 0.55)', ['#6ff0dc', '#3a86ff']],   // lagoon
    ['#4d1499', ['#9b38f2', '#ff6fb2', '#ffd0ea', '#5a1aa8'], '#fff2fb', 'rgb(255 242 251 / 0.55)', ['#ff9ad0', '#a557ff']],   // orchid
    ['#ff5f3a', ['#ff356c', '#ffb54a', '#fff0c4', '#ff7a2e'], '#2b0c13', 'rgb(43 12 19 / 0.45)', ['#ffc85c', '#ff4f86']],      // sunrise
    ['#d9e6ff', ['#9fbfff', '#f1d6ff', '#ffffff', '#b9f0ff'], '#18204a', 'rgb(24 32 74 / 0.45)', ['#a6ecff', '#b28cff']],      // glacier
    ['#ffcf3a', ['#ff9a1f', '#fff2a8', '#f458b0', '#ffd84d'], '#3b0f2c', 'rgb(59 15 44 / 0.5)', ['#ffd84a', '#f45cb2']],       // citrus
    /* the classic editions: gilt on navy, green on cream, cream on claret, pale on moss */
    ['#0e1c3c', ['#1d3672', '#13265a', '#28468a', '#0b1530'], '#e9c97c', 'rgb(233 201 124 / 0.8)', ['#e9c97c', '#5a8cf0']],   // gilt
    ['#f2e9d4', ['#e9dcbc', '#f7f0de', '#e3d4ae', '#efe4c8'], '#1f4b35', 'rgb(31 75 53 / 0.75)', ['#efd58e', '#3fb07a']],      // folio
    ['#470b1a', ['#8e1c36', '#d9504e', '#f6b388', '#5a0f22'], '#ffe9d8', 'rgb(255 233 216 / 0.55)', ['#f7b48a', '#e0435f']],   // claret
    ['#0c3527', ['#1d7656', '#97df86', '#eef7bf', '#0f4a35'], '#f3ffe8', 'rgb(243 255 232 / 0.5)', ['#c8f08e', '#2fb08a']],    // moss
  ];
  const CLASSIC = [8, 9, 10, 11];
  /* the faces: family, roughly how wide a letter is (in ems), style, weight. Boska bold italic,
     Melodrama's upright drama and Switzer Thin set the names; Nyght Serif sets the echoed titles
     (its heaviest italic) and draws every outline (its regular italic): outlines need even
     strokes, which the high-contrast faces with hairline serifs do not have */
  const FACE = {
    boska: ['Boska, Georgia, serif', 0.5, 'italic', 900],
    melodrama: ['Melodrama, Didot, Georgia, serif', 0.5, 'normal', 700],
    switzer: ['Switzer, Inter, sans-serif', 0.55, 'normal', 200],
    nyght: ['"Nyght Serif", Georgia, serif', 0.52, 'italic', 900],
    outline: ['"Nyght Serif", Georgia, serif', 0.5, 'italic', 400],
  };
  /* a name is measured in its own face to size it; until the faces have arrived the estimate
     above stands in, and the covers are drawn again once they are here */
  const measure = document.createElement('canvas').getContext('2d');
  const FONTS = Object.values(FACE).map(([fam, , style, weight]) => `${style} ${weight} 40px ${fam}`);
  let fontsIn = false;
  function widthOf(text, face) {
    const [fam, f, style, weight] = FACE[face];
    if (!fontsIn) return f * text.length;
    measure.font = `${style} ${weight} 100px ${fam}`;
    return measure.measureText(text).width / 100;
  }
  /* where a word's ink reaches, left and right of where it starts, per unit of size: an italic's
     slant carries its top right well past its advance width */
  function inkOf(text, face) {
    const [fam, f, style, weight] = FACE[face];
    if (!fontsIn) return { left: 0, right: f * text.length * 1.15 };
    measure.font = `${style} ${weight} 100px ${fam}`;
    const m = measure.measureText(text);
    return { left: -m.actualBoundingBoxLeft / 100, right: m.actualBoundingBoxRight / 100 };
  }
  function loadFonts() {
    if (!document.fonts || fontsIn) return;
    Promise.all(FONTS.map((s) => document.fonts.load(s))).then(() => {
      fontsIn = true;
      if (L.open && L.data) { const top = el.scroll.scrollTop; render(false); el.scroll.scrollTop = top; }
    }, () => {});
  }
  function idHash(id) {
    let h = 2166136261;
    for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  /* a stream of numbers from the hash, so each choice is independent of the others */
  function chooser(id) {
    let s = idHash(id) || 1;
    return (n) => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s % n; };
  }
  /* the colour fields: three or four ellipses of the palette's colours, each its own size,
     shape and place, over the base colour */
  function meshOf(p, pick) {
    const fields = p[1].filter((c, i) => i < 3 || pick(3)).map((c) => {
      const w = 45 + pick(65), h = 35 + pick(65);
      return `radial-gradient(ellipse ${w}% ${h}% at ${pick(101)}% ${pick(101)}%, ${c} 0, ${c} ${pick(18)}%, transparent 100%)`;
    });
    return fields.join(', ') + ', ' + p[0];
  }

  /* ------------------------------------------------------------------ ornaments
     Drawn in a 100-unit square laid over the cover, in its line colour, from parts the cover's
     hash picks: rules, corners and borders after engraved editions, with music's own ornaments
     as centrepieces (the turn, the mordent, the fermata, a star, a diamond). */
  const stroke = (w) => `stroke="currentColor" stroke-width="${w}" fill="none" stroke-linecap="round" stroke-linejoin="round"`;
  const CENTRE = [
    (x, y, s) => `<path d="M${x} ${y - s}L${x + s} ${y}L${x} ${y + s}L${x - s} ${y}Z" fill="currentColor"/>`,                                   // diamond
    (x, y, s) => `<path d="M${x - 2.4 * s} ${y + 0.4 * s}C${x - 2.4 * s} ${y - 1.5 * s} ${x - 0.5 * s} ${y - 1.5 * s} ${x} ${y}S${x + 2.4 * s} ${y + 1.5 * s} ${x + 2.4 * s} ${y - 0.4 * s}" ${stroke(0.55 * s)}/>`,   // turn
    (x, y, s) => `<path d="M${x - 2.4 * s} ${y + 0.5 * s}l${0.8 * s} ${-s}l${0.8 * s} ${s}l${0.8 * s} ${-s}l${0.8 * s} ${s}l${0.8 * s} ${-s}l${0.8 * s} ${s}M${x} ${y - 1.3 * s}V${y + 1.3 * s}" ${stroke(0.4 * s)}/>`,   // mordent
    (x, y, s) => `<path d="M${x - 2.2 * s} ${y + 0.8 * s}A${2.2 * s} ${2.2 * s} 0 0 1 ${x + 2.2 * s} ${y + 0.8 * s}" ${stroke(0.45 * s)}/><circle cx="${x}" cy="${y + 0.35 * s}" r="${0.42 * s}" fill="currentColor"/>`,   // fermata
    (x, y, s) => `<path d="M${x} ${y - 1.4 * s}Q${x + 0.25 * s} ${y - 0.25 * s} ${x + 1.4 * s} ${y}Q${x + 0.25 * s} ${y + 0.25 * s} ${x} ${y + 1.4 * s}Q${x - 0.25 * s} ${y + 0.25 * s} ${x - 1.4 * s} ${y}Q${x - 0.25 * s} ${y - 0.25 * s} ${x} ${y - 1.4 * s}Z" fill="currentColor"/>`,   // star
  ];
  /* a rule from x1 to x2 with a centrepiece, and dots or curls at its ends */
  function rule(pick, x1, x2, y, s = 1.3) {
    const mid = (x1 + x2) / 2, gap = 3.4 * s;
    let out = `<path d="M${x1} ${y}H${mid - gap}M${mid + gap} ${y}H${x2}" ${stroke(0.32)}/>` + CENTRE[pick(CENTRE.length)](mid, y, s);
    const ends = pick(3);
    if (ends === 1) out += `<circle cx="${x1 - 1.6}" cy="${y}" r="0.55" fill="currentColor"/><circle cx="${x2 + 1.6}" cy="${y}" r="0.55" fill="currentColor"/>`;
    if (ends === 2) out += `<path d="M${x1} ${y}c-1.6 0-2.4-1.9-1-2.5s2 1 0.8 1.6M${x2} ${y}c1.6 0 2.4-1.9 1-2.5s-2 1-0.8 1.6" ${stroke(0.32)}/>`;
    return out;
  }
  /* a frame inset from the edge: double, beaded, dotted or thick and thin */
  function border(pick, inset) {
    const r = (i) => `x="${i}" y="${i}" width="${100 - 2 * i}" height="${100 - 2 * i}"`;
    switch (pick(4)) {
      case 0: return `<rect ${r(inset)} ${stroke(0.7)}/><rect ${r(inset + 2)} ${stroke(0.25)}/>`;
      case 1: {
        let beads = '';
        const i = inset + 2.2, n = 26, len = 100 - 2 * i;
        for (let k = 0; k <= n; k++) {
          const t = (k / n) * len + i;
          beads += `<circle cx="${t}" cy="${i}" r="0.42"/><circle cx="${t}" cy="${100 - i}" r="0.42"/><circle cx="${i}" cy="${t}" r="0.42"/><circle cx="${100 - i}" cy="${t}" r="0.42"/>`;
        }
        return `<rect ${r(inset)} ${stroke(0.35)}/><g fill="currentColor">${beads}</g><rect ${r(inset + 4.4)} ${stroke(0.35)}/>`;
      }
      case 2: return `<rect ${r(inset)} ${stroke(0.6)} stroke-dasharray="0.01 1.5"/><rect ${r(inset + 2.2)} ${stroke(0.3)}/>`;
      default: return `<rect ${r(inset)} ${stroke(1.1)}/><rect ${r(inset + 2.4)} ${stroke(0.3)}/><rect ${r(inset + 3.6)} ${stroke(0.3)}/>`;
    }
  }
  /* the coda sign as engraved: an oval heavy at its sides and fine at top and bottom, crossed by a
     line each way */
  const coda = (x, y, r) => {
    const oval = (rx, ry) => `M${x - rx} ${y}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0Z`;
    return `<path d="${oval(r, 1.18 * r)}${oval(0.6 * r, 1.03 * r)}" fill="currentColor" fill-rule="evenodd"/>` +
      `<path d="M${x - 1.85 * r} ${y}H${x + 1.85 * r}M${x} ${y - 1.95 * r}V${y + 1.95 * r}" stroke="currentColor" stroke-width="0.3" stroke-linecap="butt"/>`;
  };
  /* the same piece at each corner of a frame, turned to face inward: a bracket, a lozenge, a coda
     sign or a star */
  function corners(pick, at) {
    const style = pick(4), out = [];
    for (const [x, y, dx, dy] of [[at, at, 1, 1], [100 - at, at, -1, 1], [at, 100 - at, 1, -1], [100 - at, 100 - at, -1, -1]]) {
      if (style === 0) out.push(`<path d="M${x + dx * 7} ${y}H${x}V${y + dy * 7}" ${stroke(0.5)}/><circle cx="${x + dx * 2.2}" cy="${y + dy * 2.2}" r="0.7" fill="currentColor"/>`);
      else if (style === 1) out.push(`<path d="M${x + dx * 2.8} ${y + dy * 0.6}L${x + dx * 5} ${y + dy * 2.8}L${x + dx * 2.8} ${y + dy * 5}L${x + dx * 0.6} ${y + dy * 2.8}Z" ${stroke(0.35)}/>` + CENTRE[0](x + dx * 2.8, y + dy * 2.8, 0.85));
      else if (style === 2) out.push(coda(x + dx * 2.8, y + dy * 2.8, 1.5));
      else out.push(CENTRE[4](x + dx * 2.6, y + dy * 2.6, 1.6));
    }
    return out.join('');
  }
  /* printer's marks: crop marks at two corners and a registration target */
  function marks(pick) {
    const t = [[80, 9], [50, 7]][pick(2)];   // clear of the composer and number along the bottom
    return `<path d="M4 9H8M9 4V8M96 9H92M91 4V8" ${stroke(0.3)}/>` +
      `<circle cx="${t[0]}" cy="${t[1]}" r="2.6" ${stroke(0.3)}/><path d="M${t[0] - 4} ${t[1]}H${t[0] + 4}M${t[0]} ${t[1] - 4}V${t[1] + 4}" ${stroke(0.3)}/>`;
  }
  const layer = (inner) => `<svg class="orn" viewBox="0 0 100 100" aria-hidden="true">${inner}</svg>`;
  /* what a cover says: the name to set large, what goes under it, a number for the numeral */
  function coverText(e) {
    const d = L.data, p = d.parentOf(e);
    let main = d.kids.has(e.id) ? workName(e).replace(/ “[^”]*”$/, '') : signs(e.title);
    let sub = '', num = '';
    const key = / in ([A-G][♭♯]? (?:major|minor))$/.exec(main);
    if (key) { sub = 'in ' + key[1]; main = main.slice(0, key.index); }
    const no = /,? No\. ?(\d+)$/.exec(main);
    if (no) { num = no[1]; main = main.slice(0, no.index); }
    const lead = /^(\d+) (.+)$/.exec(main);
    if (!num && lead) { num = lead[1]; main = lead[2]; }
    if (!num && p && e.number) num = String(e.number);
    const nick = nickOf(e);
    if (nick) { sub = [main + (no ? ' No. ' + no[1] : ''), sub].filter(Boolean).join(' '); main = nick; }
    else if (no) sub = ['No. ' + no[1], sub].filter(Boolean).join(' ');
    if (e.kind === 'movement' && p && !sub) sub = workName(p).replace(/ “[^”]*”$/, '');
    return { main, sub, num, who: d.comp.get(e.composer).name, cat: catOf(e) };
  }
  /* the largest size (in cqw) at which the name fits its box: its longest word on one line, the
     whole of it within the box's area */
  function fitSize(text, face, width, height, max) {
    const longest = Math.max(...text.split(/\s+/).map((w) => widthOf(w, face)), 0.01);
    const whole = widthOf(text, face);
    return +Math.min(max, width / longest, Math.sqrt((width * height) / (whole * 0.95))).toFixed(2);
  }
  let maskSeq = 0;   // each outline's mask needs an id of its own on the page
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  /* A set or a work and everything in it are one album: they share a look (layout, palette,
     colour fields, faces, ornaments), chosen from the album's id, and differ only in what they
     say. The layout must suit every member: the echo needs one short word, so an album where any
     name is longer takes the numeral (when all are numbered) or the staff instead */
  /* A numbered series with no parent work in the catalogue (Liszt's S. 244/1 to 19) is one album too. */
  const SERIES = /^(.+)\/\d+[a-z]?$/;
  let seriesMap = null;
  function seriesOf(e) {
    if (!seriesMap) {
      seriesMap = new Map();
      for (const x of L.data.byId.values()) {
        const m = !x.parent && x.cat && SERIES.exec(x.cat[0]);
        if (!m) continue;
        const id = '~' + x.composer + '|' + m[1];
        if (!seriesMap.has(id)) seriesMap.set(id, { id, series: [] });
        seriesMap.get(id).series.push(x);
      }
    }
    const m = !e.parent && e.cat && SERIES.exec(e.cat[0]);
    const s = m && seriesMap.get('~' + e.composer + '|' + m[1]);
    return s && s.series.length > 1 ? s : e;
  }
  const albumOf = (e) => { let x = e; while (x.parent && L.data.byId.get(x.parent)) x = L.data.byId.get(x.parent); return seriesOf(x); };
  const albumLayout = new Map();
  function layoutOf(album, wanted) {
    const key = album.id + ':' + wanted;
    if (albumLayout.has(key)) return albumLayout.get(key);
    let layout = wanted;
    if (wanted === 'echo' || wanted === 'num') {
      const members = album.series ? [...album.series] : [album], d = L.data;
      for (let i = 0; i < members.length; i++) for (const k of d.kids.get(members[i].id) || []) members.push(k);
      const texts = members.map(coverText);
      if (wanted === 'echo' && texts.some((t) => /\s/.test(t.main) || t.main.length > 11)) layout = texts.every((t) => t.num) ? 'num' : 'staff';
    }
    albumLayout.set(key, layout);
    return layout;
  }
  /* A cover, once made, is kept (the last few hundred, by entry and by whether the fonts were in)
     and copied when it is wanted again: making one measures its words and parses its drawing, a
     copy does neither. The same covers come back all the time: a search's results as each letter
     is typed, Explore's lists as its tabs are switched, a list gone back to. A copy's outline masks
     get ids of their own, as every mask on the page must */
  const coversMade = new Map();
  function cover(e) {
    const key = (fontsIn ? '' : '~') + e.id;
    const kept = coversMade.get(key);
    if (kept) {
      coversMade.delete(key); coversMade.set(key, kept);   // most recently wanted last
      const c = kept.cloneNode(true);
      for (const m of c.querySelectorAll('mask')) {
        const id = 'cvm' + (++maskSeq);
        c.querySelector(`[mask="url(#${m.id})"]`).setAttribute('mask', `url(#${id})`);
        m.id = id;
      }
      return c;
    }
    const c = makeCover(e);
    coversMade.set(key, c.cloneNode(true));
    if (coversMade.size > 400) coversMade.delete(coversMade.keys().next().value);
    return c;
  }
  /* the palette a piece's cover is drawn from, for the player, which lights its roll in the
     palette's hand colours (js/roll-gl.js): the same choices as makeCover, made in the same order */
  FB.coverPalette = (id) => {
    const e = L.data && L.data.byId.get(id);
    if (!e) return null;
    const album = albumOf(e), pick = chooser(album.id);
    const layout = layoutOf(album, ['echo', 'frame', 'num', 'staff'][pick(4)]);
    return layout === 'frame' ? PALETTES[CLASSIC[pick(CLASSIC.length)]] : PALETTES[pick(8)];
  };
  function makeCover(e) {
    const album = albumOf(e);
    const pick = chooser(album.id);
    const t = coverText(e);
    const layout = layoutOf(album, ['echo', 'frame', 'num', 'staff'][pick(4)]);
    const p = layout === 'frame' ? PALETTES[CLASSIC[pick(CLASSIC.length)]] : PALETTES[pick(8)];
    const face = layout === 'echo' ? 'nyght' : layout === 'frame' ? (pick(2) ? 'melodrama' : 'boska')
      : layout === 'num' ? 'boska' : pick(2) ? 'switzer' : 'melodrama';
    const c = make('span', 'cover cv-' + layout, undefined, 'cover');
    c.setAttribute('aria-hidden', 'true');
    c.style.setProperty('--mesh', meshOf(p, pick));
    c.style.setProperty('--ink', p[2]);
    c.style.setProperty('--line', p[3]);
    c.style.setProperty('--face', FACE[face][0]);
    c.style.setProperty('--face-style', FACE[face][2]);
    c.style.setProperty('--face-weight', FACE[face][3]);
    c.dataset.base = p[0];
    c.dataset.field = p[1][0];
    const part = (cls, text) => { const s = make('span', cls, text); c.appendChild(s); return s; };
    const art = (svg) => c.insertAdjacentHTML('beforeend', svg);
    /* a word drawn in SVG, in the cover's 100-unit square: filled in ink, or as an outline that
       lies outside the letters only (a stroke twice as wide, the letters masked out of it), so
       the outline never eats into the letter's own shape. The mask goes on a group holding an
       empty square as large as the mask: Safari clips a masked text to its advance box, which
       cut off an italic's slant (the top right of a big outlined H) */
    const word = (text, x, y, size, fam, style, weight, outline, anchor = 'start', fade = 1) => {
      const font = `font-family="${fam.replace(/"/g, "'")}" font-style="${style}" font-weight="${weight}" font-size="${size}" text-anchor="${anchor}" letter-spacing="${(-0.01 * size).toFixed(2)}"`;
      const glyphs = `<text x="${x}" y="${y}" ${font}>${esc(text)}</text>`;
      if (!outline) return glyphs.replace('<text ', '<text style="fill: var(--ink)" ');
      const id = 'cvm' + (++maskSeq);
      return `<mask id="${id}" maskUnits="userSpaceOnUse" x="-60" y="-60" width="220" height="220"><rect x="-60" y="-60" width="220" height="220" fill="#fff"/>${glyphs.replace('<text ', '<text fill="#000" ')}</mask>` +
        `<g mask="url(#${id})"><rect x="-60" y="-60" width="220" height="220" fill="#000" fill-opacity="0"/>` +
        glyphs.replace('<text ', `<text fill="none" stroke="currentColor" stroke-width="${outline * 2}" stroke-opacity="${fade}" stroke-linejoin="round" `) + '</g>';
    };
    const [fam, fstyle, fweight] = [FACE[face][0], FACE[face][2], FACE[face][3]];
    const [ofam, ostyle, oweight] = [FACE.outline[0], FACE.outline[2], FACE.outline[3]];
    if (layout === 'echo') {
      /* the name low on the cover, its outline twice above it, the upper one cut by the top
         edge; the small lines underneath have the bottom to themselves */
      const s = fitSize(t.main, face, 86, 28, 30);
      const y = 78 - 0.25 * s - 2;
      art(layer(marks(pick) +
        word(t.main, 7, y - 2 * s, s, ofam, ostyle, oweight, 0.3, 'start', 0.5) + word(t.main, 7, y - s, s, ofam, ostyle, oweight, 0.3, 'start', 0.5) +
        word(t.main, 7, y, s, fam, fstyle, fweight, 0)));
      if (t.sub) part('sub', t.sub);
      part('who', t.who);
      if (t.cat) part('cat', t.cat);
    } else if (layout === 'frame') {
      c.style.setProperty('--ts', fitSize(t.main, face, 72, 30, 17) + 'cqw');
      art(layer(border(pick, 4.5) + corners(pick, 10)));
      const stack = part('stack');
      stack.appendChild(make('span', 'who', t.who));
      stack.insertAdjacentHTML('beforeend', `<svg class="divider" viewBox="0 0 100 8" aria-hidden="true">${rule(pick, 8, 92, 4, 1.7)}</svg>`);
      stack.appendChild(make('span', 'main', t.main));
      if (t.sub) stack.appendChild(make('span', 'sub', t.sub));
      if (t.cat) stack.appendChild(make('span', 'cat', t.cat));
    } else if (layout === 'num') {
      c.style.setProperty('--ts', fitSize(t.main, face, 84, 26, 18) + 'cqw');
      /* the numeral in outline in the top right, its ink (slant and outline included) within the
         cover's margin on the right, and at most 46 units wide so it keeps clear of the composer
         and number at the top left */
      const big = t.num || (t.main.match(/\p{L}/u) || ['·'])[0];
      const ink = inkOf(big, 'outline');
      const size = Math.min(82, 46 / Math.max(ink.right - ink.left, 0.01));
      const x = 92 - 0.3 - ink.right * size;
      art(layer(word(big, x.toFixed(2), 70, size.toFixed(2), ofam, ostyle, oweight, 0.3, 'start', 0.5)));
      part('who', t.who);
      if (t.cat) part('cat', t.cat);
      part('main', t.main);
      if (t.sub) part('sub', t.sub);
    } else {
      c.style.setProperty('--ts', fitSize(t.main, face, 86, 26, face === 'switzer' ? 17 : 20) + 'cqw');
      /* the staff ends in a final double barline, square-ended like printed ones */
      art(layer(`<path d="M90.6 58V80.5M93.2 58V80.5" stroke="currentColor" stroke-width="0.3" stroke-linecap="butt"/><path d="M93.2 58V80.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="butt"/>`));
      part('staff'); part('who', t.who);
      if (t.cat) part('cat', t.cat);
      part('main', t.main);
      if (t.sub) part('sub', t.sub);
    }
    return c;
  }
  /* a piece's or a work's page opens on its cover, as an album does, its colours behind */
  function hero(page, e, title, lines, extra) {
    const h = make('header', 'hero');
    const art = cover(e);
    const glow = make('span', 'hero-glow');
    glow.style.setProperty('--mesh', art.style.getPropertyValue('--mesh'));
    h.append(glow, art);
    const text = make('div', 'hero-text');
    const h1 = make('h1', '', title, 'text');
    h1.dataset.title = title;
    h1.dataset.sub = L.data.comp.get(e.composer).name;
    text.appendChild(h1);
    for (const line of lines) if (line) text.appendChild(typeof line === 'string' ? make('p', '', line, 'text') : line);
    if (extra) text.appendChild(extra);
    h.appendChild(text);
    page.appendChild(h);
    return h;
  }
  function flushThumbs() {
    const list = L.thumbs;
    L.thumbs = [];
    requestAnimationFrame(() => { for (const [cv, r] of list) drawThumb(cv, r); sceneV++; kick(); });
  }

  function tile(c) {
    const b = button('tile', undefined, () => push({ view: 'composer', id: c.id }), 'box');
    b.appendChild(make('b', '', c.name, 'text'));
    b.appendChild(make('small', '', lifeOf(c), 'text'));
    const era = make('span', 'era');
    const span = ERA[1] - ERA[0];
    era.style.setProperty('--a', Math.max(0, (c.born - ERA[0]) / span).toFixed(3));
    era.style.setProperty('--b', Math.min(1, ((c.died || c.born + 60) - ERA[0]) / span).toFixed(3));
    era.appendChild(make('i'));
    b.appendChild(era);
    return b;
  }
  const composersInOrder = () => [...L.data.comp.values()].sort((a, b) => a.born - b.born);
  function tiles(list) {
    const box = make('div', 'tiles');
    for (const c of list) box.appendChild(tile(c));
    return box;
  }

  /* Explore's tabs: glass, the same control the search shows at the top, and the same choice */
  function tabsControl() {
    const f = make('div', 'seg fit lib-tabs glass-material');
    f.setAttribute('role', 'group');
    f.setAttribute('aria-label', 'Explore');
    f.style.setProperty('--n', 3);
    f.style.setProperty('--i', TABS.indexOf(L.tab));
    for (const [v, label] of [['pieces', 'Pieces'], ['works', 'Works'], ['composers', 'Composers']]) {
      const b = button('', label, () => setTab(v));
      b.dataset.tab = v;
      b.setAttribute('aria-pressed', String(L.tab === v));
      f.appendChild(b);
    }
    return f;
  }
  /* what Explore lists under its tabs */
  const exploreContent = () => (L.tab === 'composers' ? tiles(composersInOrder()) : rows(L.data.explore[L.tab], 'two'));
  /* choosing a tab keeps the tab bar (its pill slides from where it is) and swaps only what
     lies under it: Explore's list, or the search results */
  function setTab(v) {
    if (L.tab !== v) {
      L.tab = v;
      for (const b of el.lib.querySelectorAll('.seg.fit button')) b.setAttribute('aria-pressed', String(b.dataset.tab === v));
    }
    syncPills(true);
    if (L.query.trim()) render(false);
    else if (L.exploreList && L.exploreList.isConnected) {
      L.exploreList.replaceChildren(exploreContent());
      pinCheck();
      sceneV++;
      kick(300);
    } else render(false);
  }

  /* ------------------------------------------------------------------ views */
  const VIEWS = {
    home(page) {
      const d = L.data;
      head(page, 'Library', []);
      const recent = FB.app.recents();
      const s = section(page, 'Continue', recent.length ? () => push({ view: 'recent' }) : null);
      /* a touch screen swipes through a shelf; a mouse gets one row of cards that fills the column
         (fitShelves sizes both) */
      const shelf = make('div', TOUCH.matches ? 'shelf' : 'shelf fitted');
      shelf.appendChild(uploadCard());
      for (const r of recent.slice(0, HOME_RECENTS)) shelf.appendChild(card(r));
      s.appendChild(shelf);
      /* Explore's heading scrolls up under the top bar, where it becomes the small title; its
         tabs pin beneath the bar, and the list runs on under them. The mark holds the tabs'
         place in the page, which a pinned bar no longer tells */
      const x = make('section', 'lib-sec explore');
      const h2 = make('h2', '', 'Explore', 'text');
      h2.dataset.title = 'Explore';
      const tabs = make('div', 'explore-tabs');
      tabs.appendChild(tabsControl());
      x.append(h2, make('div', 'explore-mark'), tabs);
      L.exploreList = make('div', 'explore-list');
      L.exploreList.appendChild(exploreContent());
      x.appendChild(L.exploreList);
      page.appendChild(x);
    },

    recent(page) {
      head(page, 'Continue', []);
      const box = make('div', 'cards');
      box.appendChild(uploadCard());
      for (const r of FB.app.recents()) box.appendChild(card(r));
      page.appendChild(box);
    },

    composer(page, item) {
      const d = L.data, c = d.comp.get(item.id);
      head(page, c.name, [c.full + ' · ' + lifeOf(c)]);
      const mine = (e) => e.composer === c.id;
      const top = d.leaves.filter(mine).sort(byFame);
      const works = d.tops.filter(mine);
      section(page, 'Top pieces', top.length > 8 ? () => push({ view: 'pieces', id: c.id }) : null).appendChild(rows(top.slice(0, 8), 'one'));
      section(page, 'Works', works.length > 8 ? () => push({ view: 'works', id: c.id }) : null).appendChild(rows(works.slice().sort(byFame).slice(0, 8), 'work'));
    },
    pieces(page, item) {
      const c = L.data.comp.get(item.id);
      head(page, 'Pieces', [c.full]).querySelector('h1').dataset.sub = c.name;
      page.appendChild(rows(L.data.leaves.filter((e) => e.composer === c.id).sort(byFame), 'one'));
    },
    works(page, item) {
      const c = L.data.comp.get(item.id);
      head(page, 'Works', [c.full]).querySelector('h1').dataset.sub = c.name;
      page.appendChild(rows(L.data.tops.filter((e) => e.composer === c.id).sort(byCatalogue), 'work'));
    },

    work(page, item) {
      const d = L.data, e = d.byId.get(item.id), c = d.comp.get(e.composer);
      const yearOf = e.year || (d.parentOf(e) || {}).year;
      const who = button('link', c.full, () => push({ view: 'composer', id: c.id }), 'text');
      const p = d.parentOf(e);
      const lines = [who, [catOf(e), e.key && keyText(e.key), yearOf].filter(Boolean).join(' · ')];
      if (p) lines.push(button('link quiet', 'Part of ' + workName(p), () => push({ view: 'work', id: p.id }), 'text'));
      let actions = null;
      if (e.s || e.b) {
        actions = make('div', 'actions');
        actions.appendChild(playButton(e));
      }
      hero(page, e, workName(e), lines, actions);
      const s = make('section', 'lib-sec');
      const k = d.kids.get(e.id);
      s.appendChild(rows(k, 'num', k.length > 6));
      page.appendChild(s);
    },

    piece(page, item) { pieceView(page, L.data.byId.get(item.id)); },

    /* #library/~covers: sixty covers side by side, to judge the designs together */
    covers(page) {
      head(page, 'Covers', ['The artwork of the pieces and works in Explore']);
      const grid = make('div', 'cover-grid');
      for (const e of [...L.data.explore.pieces, ...L.data.explore.works].slice(0, 60)) {
        const b = button('cover-pick', undefined, () => go(e));
        b.appendChild(cover(e));
        b.appendChild(make('span', '', nameOf(e, true)));
        grid.appendChild(b);
      }
      page.appendChild(grid);
    },

    search(page) {
      const q = L.query.trim();
      if (L.tab === 'composers') {
        const words = fold(q).split(' ');
        const found = composersInOrder().filter((c) => {
          const names = [c.name, c.full, ...(c.names || [])].map(fold).join(' ').split(' ');
          return words.every((w) => names.some((n) => n.startsWith(w)));
        });
        if (found.length) page.appendChild(tiles(found));
        else page.appendChild(make('p', 'lib-note', 'No composer matches “' + q + '”. The library has ' + L.data.comp.size + ' composers, from Bach to Shostakovich.', 'text'));
        return;
      }
      /* what is typed now if it has been found, else the results last found while it is: never a
         "Searching…" in between. Only a search opened cold (a reload, before the index is built)
         has nothing yet to show */
      const res = S.cache.get(q) || S.results;
      if (!res || res.q !== q) ask(q);
      S.shownQ = res ? res.q : null;
      if (!res) {
        if (!S.ready) page.appendChild(make('p', 'lib-note', 'Getting the search ready…', 'text'));
        return;
      }
      const want = L.tab === 'works' ? (e) => L.data.kids.has(e.id) : (e) => !L.data.kids.has(e.id);
      const found = res.ids.map((id) => L.data.byId.get(id)).filter((e) => e && want(e));
      if (found.length) page.appendChild(rows(found, 'two'));
      else page.appendChild(make('p', 'lib-note', 'No ' + L.tab + ' match “' + res.q + '”. Try a composer, a key or a catalogue number, like rach 23 2 or bb minor' + (L.tab === 'pieces' ? ', or look under Works.' : ', or look under Pieces.'), 'text'));
    },
  };

  /* ------------------------------------------------------------------ a piece's page */
  const ICON = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.54 6 L18.93 12 L8.54 18 Z" stroke-linejoin="round"/></svg>',
    pdf: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14"/></svg>',
  };
  function playButton(e) {
    const b = button('btn main', undefined, () => openEntry(e), 'box');
    b.innerHTML = ICON.play;
    b.appendChild(make('span', '', 'Play', 'text'));
    return b;
  }
  /* the Henle edition a level comes from, for the link beside it: their pages are named, so the
     names come from a small file (library/henle.json), fetched the first time one is needed */
  let henleNames = null;
  function henleEdition(hn) {
    if (!henleNames) henleNames = fetch('library/henle.json').then((r) => r.json()).catch(() => ({}));
    return henleNames.then((m) => (m[hn] ? 'https://www.henle.de/en/' + m[hn] + '/HN-' + hn : null));
  }
  function pieceView(page, e) {
    const d = L.data, c = d.comp.get(e.composer), p = d.parentOf(e);
    const year = e.year || (p && p.year), pub = e.pub || (p && p.pub);
    const title = pieceName(e, false);
    const lines = [button('link', c.full, () => push({ view: 'composer', id: c.id }), 'text')];
    if (p) lines.push(button('link quiet', [catOf(e), workName(p)].filter(Boolean).join(' · '), () => push({ view: 'work', id: p.id }), 'text'));
    else if (catOf(e)) lines.push(catOf(e));
    const actions = make('div', 'actions');
    const file = d.fileOf(e);
    if (file) actions.appendChild(playButton(e));
    const own = e.s || e.b;
    const pdf = button('btn', undefined, () => savePdf(e), 'box');
    pdf.innerHTML = ICON.pdf;
    pdf.appendChild(make('span', '', 'PDF', 'text'));
    pdf.disabled = !own;
    pdf.title = own ? 'Download the sheet music as a PDF (A4)' : 'No score of its own yet';
    if (own) actions.appendChild(pdf);
    const h = hero(page, e, title, lines, actions);
    if (!own) h.querySelector('h1').appendChild(dot());

    if (e.about) section(page, 'About').appendChild(make('p', 'lib-about', e.about, 'text'));

    const facts = make('dl', 'facts');
    const fact = (label, value) => {
      if (!value) return;
      const f = make('div');
      f.appendChild(make('dt', '', label, 'text'));
      const dd = make('dd', '', typeof value === 'string' ? value : undefined, 'text');
      if (typeof value !== 'string') dd.appendChild(value);
      f.appendChild(dd);
      facts.appendChild(f);
    };
    /* Henle's level, first and set apart: the row's pill, larger, its band beside it; the pill
       opens the Henle edition that grades it */
    if (e.h) {
      const lv = make('span', 'level');
      const pill = make('a', 'lvl');
      pill.appendChild(make('b', '', String(e.h), 'text'));
      pill.appendChild(make('small', '', '/9', 'text'));
      pill.href = 'https://www.henle.de/en/Levels-of-Difficulty/';
      pill.target = '_blank';
      pill.rel = 'noopener';
      pill.title = 'Graded by the G. Henle Verlag (Rolf Koenen)';
      if (e.hn) henleEdition(e.hn).then((url) => { if (url) { pill.href = url; pill.title = 'Graded by the G. Henle Verlag in its edition HN ' + e.hn; } });
      lv.append(pill, make('span', 'band', LEVEL_BAND[e.h][0].toUpperCase() + LEVEL_BAND[e.h].slice(1), 'text'));
      fact('Henle level', lv);
    }
    fact('Key', e.key && keyText(e.key));
    fact('Catalogue', (e.cat || []).join(' · '));
    fact('Composed', year && String(year));
    fact('Published', pub && String(pub));
    fact('Tempo', e.tempo);
    fact('Form', e.genre);
    if (p) fact('Part of', button('', workName(p), () => push({ view: 'work', id: p.id })));
    section(page, 'Details').appendChild(facts);

    const s = section(page, 'Sheet music');
    if (!own) { s.appendChild(make('p', 'lib-note', 'This piece has no score of its own yet' + (file ? ': Play opens it within ' + workName(file) + '.' : '.'), 'text')); return; }
    const pages = make('div', 'pages');
    const box = make('div', 'carousel');
    box.appendChild(pages);
    s.appendChild(box);
    if (!TOUCH.matches) carouselArrows(box, pages);
    showPages(e, pages);
  }
  /* with a mouse there is no swiping: glass arrows at the carousel's sides turn it a page at a
     time. They show only while there is somewhere to go: none when everything fits, no back
     arrow at the start, no forward arrow at the end */
  const ARROW = { prev: 'm14.5 5.5-6.5 6.5 6.5 6.5', next: 'm9.5 5.5 6.5 6.5-6.5 6.5' };
  function carouselArrows(box, strip) {
    const step = () => { const pg = strip.firstElementChild; return pg ? pg.offsetWidth + parseFloat(getComputedStyle(strip).columnGap || '0') : strip.clientWidth; };
    const arrow = (dir, label) => {
      const b = button('round glass-material carousel-arrow ' + (dir < 0 ? 'prev' : 'next'), undefined, () => strip.scrollBy({ left: dir * step(), behavior: 'smooth' }));
      b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + (dir < 0 ? ARROW.prev : ARROW.next) + '"/></svg>';
      b.setAttribute('aria-label', label);
      b.title = label;
      b.hidden = true;
      return b;
    };
    const prev = arrow(-1, 'Previous page'), next = arrow(1, 'Next page');
    box.append(prev, next);
    const sync = () => {
      const over = strip.scrollWidth > strip.clientWidth + 1;
      prev.hidden = !over || strip.scrollLeft < 2;
      next.hidden = !over || strip.scrollLeft + strip.clientWidth > strip.scrollWidth - 2;
      sceneV++; kick(200);
    };
    strip.addEventListener('scroll', sync, { passive: true });
    new ResizeObserver(sync).observe(strip);
    new MutationObserver(sync).observe(strip, { childList: true });
    sync();
    return { prev, next, step };
  }

  /* ------------------------------------------------------------------ the sheet music, full screen
     A page of the preview opens the pages full screen, one at a time, each as large as the screen
     allows, with the PDF to download in the corner. Swipe, scroll or use the arrows (or the arrow
     keys) to turn pages; the close button or Escape goes back. */
  function openViewer(e, index) {
    const job = engraveFor(e);
    closeViewer();
    const v = make('div', 'viewer');
    v.setAttribute('role', 'dialog');
    v.setAttribute('aria-label', 'Sheet music: ' + pieceName(e, true));
    const strip = make('div', 'viewer-pages');
    v.appendChild(strip);
    const shut = button('round glass-material viewer-close', undefined, closeViewer);
    shut.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>';
    shut.setAttribute('aria-label', 'Close');
    shut.title = 'Close';
    const save = button('round glass-material viewer-save', undefined, () => savePdf(e));
    save.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14"/></svg>';
    save.setAttribute('aria-label', 'Download the PDF');
    save.title = 'Download the PDF';
    v.append(shut, save);
    el.lib.appendChild(v);
    L.viewer = { el: v, strip, arrows: TOUCH.matches ? null : carouselArrows(v, strip) };
    /* a blank page for each page to come, filled as it is drawn */
    const fill = (i) => {
      if (!v.isConnected) { job.watchers.delete(fill); return; }
      while (strip.children.length < job.total) strip.appendChild(make('div', 'viewer-page is-blank'));
      const pg = strip.children[i];
      if (i < 0 || !pg || !job.pages[i] || pg.firstChild) return;
      const img = make('img', '', undefined, 'img');
      img.src = job.pages[i];
      img.alt = 'Page ' + (i + 1) + ' of ' + job.total;
      img.decoding = 'async';
      pg.appendChild(img);
      pg.classList.remove('is-blank');
      sceneV++; kick(200);
    };
    job.watchers.add(fill);
    job.pages.forEach((src, i) => fill(i));
    requestAnimationFrame(() => { const pg = strip.children[index]; if (pg) strip.scrollLeft = pg.offsetLeft - (strip.clientWidth - pg.offsetWidth) / 2; });
    shut.focus({ preventScroll: true });
    sceneV++; kick(500);
  }
  function closeViewer() {
    if (!L.viewer) return;
    L.viewer.el.remove();
    L.viewer = null;
    sceneV++; kick(300);
  }
  function turnViewer(dir) {
    const v = L.viewer;
    if (!v) return;
    const pg = v.strip.firstElementChild;
    v.strip.scrollBy({ left: dir * (pg ? pg.offsetWidth + parseFloat(getComputedStyle(v.strip).columnGap || '0') : v.strip.clientWidth), behavior: 'smooth' });
  }

  /* the pages as they will print, engraved here by MuseScore's engine (js/print.js). A job holds
     the pages drawn so far (pages, in order), how many there will be (total, known with the
     first), and tells its watchers as each arrives (with its index; -1 when all are drawn and
     the PDF is made, -2 if it failed); done resolves then. The engine lays out the whole score
     before the first page, then draws one page at a time: a long piece (the Goldberg Variations,
     171 pages) shows its first page as soon as it is drawn, and the rest follow. Kept for the
     session, so the PDF and a second visit are instant */
  function printInfo(e) {
    const d = L.data, c = d.comp.get(e.composer), p = d.parentOf(e);
    const sub = [e.kind === 'movement' && p ? workName(p) : '', catOf(e)].filter(Boolean).join(' · ');
    return { title: pieceName(e, false), subtitle: sub, composer: c.full + (lifeOf(c) ? ' (' + lifeOf(c) + ')' : '') };
  }
  function engraveFor(e) {
    if (L.prints.has(e.id)) return L.prints.get(e.id);
    const job = { pages: [], total: 0, provisional: false, pdf: null, error: null, watchers: new Set() };
    const tell = (i) => { for (const f of [...job.watchers]) f(i); };
    job.done = (async () => {
      const url = e.b ? 'scores/' + e.b + '.musicxml' + V : 'library/scores/' + e.s + V;
      const r = await fetch(url);
      if (!r.ok) throw new Error('The score could not be downloaded.');
      const xml = await FB.readScoreFile(new File([await r.blob()], url.split('/').pop().split('?')[0]));
      const W = await FB.loadEngine();
      const page = (svg) => URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      /* a long score: its first page from its opening bars, in a moment, while the whole lays out
         (provisional: more pages are coming, how many is not known yet) */
      if (FB.engrave.isLong(xml)) {
        const svg = await FB.print.first(W, xml, printInfo(e));
        if (svg) { job.pages[0] = page(svg); job.total = 1; job.provisional = true; tell(0); }
      }
      const out = await FB.print.render(W, xml, printInfo(e), (svg, i, n) => {
        job.total = n;
        job.provisional = false;
        job.pages[i] = page(svg);
        tell(i);
      });
      job.pdf = URL.createObjectURL(new Blob([out.pdf], { type: 'application/pdf' }));
      tell(-1);
      return job;
    })();
    job.done.catch((err) => { job.error = err; L.prints.delete(e.id); tell(-2); });
    L.prints.set(e.id, job);
    return job;
  }
  /* the preview: a blank sheet for each page once the count is known, each filled as it is drawn */
  function showPages(e, box) {
    box.textContent = '';
    const waiting = make('div', 'sheet-page is-waiting', 'Laying out the pages…', 'box');
    box.appendChild(waiting);
    const job = engraveFor(e);
    const fill = (i) => {
      if (!box.isConnected) { job.watchers.delete(fill); return; }
      if (i === -2) { waiting.textContent = (job.error && job.error.message) || 'The pages could not be laid out.'; return; }
      if (!job.total) return;
      const sheets = box.querySelectorAll('.sheet-page:not(.is-waiting)');
      for (let k = sheets.length; k < job.total; k++) {
        const pg = button('sheet-page is-blank', undefined, () => openViewer(e, k));
        pg.setAttribute('aria-label', 'Page ' + (k + 1) + ', full screen');
        box.insertBefore(pg, waiting.isConnected ? waiting : null);
      }
      /* the first page came from the opening alone: the rest are being laid out */
      if (job.provisional) { waiting.textContent = 'Laying out the other pages…'; if (!waiting.isConnected) box.appendChild(waiting); }
      else waiting.remove();
      if (i < 0) return;
      const pg = box.querySelectorAll('.sheet-page:not(.is-waiting)')[i];
      if (!pg || !job.pages[i] || pg.firstChild) return;
      const img = make('img', '', undefined, 'img');
      img.src = job.pages[i];
      img.alt = '';
      img.decoding = 'async';
      img.loading = 'lazy';
      pg.appendChild(img);
      pg.classList.remove('is-blank');
      sceneV++; kick(200);
    };
    job.watchers.add(fill);
    job.pages.forEach((src, i) => fill(i));
    if (job.error) fill(-2);
  }
  async function savePdf(e) {
    const out = await engraveFor(e).done;
    const c = L.data.comp.get(e.composer);
    const name = (c.name + ' – ' + pieceName(e, true) + (catOf(e) ? ', ' + catOf(e) : '')).replace(/[\\/:*?"<>|“”]+/g, '').replace(/\s+/g, ' ').trim() + '.pdf';
    const a = document.createElement('a');
    a.href = out.pdf;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  /* ------------------------------------------------------------------ the ellipsis menu
     On a composer's, a work's or a piece's page (and their lists), the top right holds a menu of
     what can be done with the page: for now, sharing a link to it. */
  function viewName() {
    const d = L.data, top = L.stack[L.stack.length - 1];
    if (!d || !top.id) return 'Fallboard library';
    if (d.comp.has(top.id)) return d.comp.get(top.id).full + (top.view === 'pieces' ? ': pieces' : top.view === 'works' ? ': works' : '');
    const e = d.byId.get(top.id);
    return e ? composerName(e) + ': ' + nameOf(e, true) : 'Fallboard library';
  }
  function openMenu() {
    el.shareNote.textContent = navigator.share ? 'Send a link to this page' : 'Copy a link to this page';
    el.menu.hidden = false;
    el.more.setAttribute('aria-expanded', 'true');
    kick(400);
  }
  function closeMenu() {
    if (el.menu.hidden) return;
    el.menu.hidden = true;
    el.more.setAttribute('aria-expanded', 'false');
    kick(300);
  }
  el.more.addEventListener('click', (e) => { e.stopPropagation(); if (el.menu.hidden) openMenu(); else closeMenu(); });
  document.addEventListener('pointerdown', (e) => { if (!el.menu.hidden && !el.menu.contains(e.target) && !el.more.contains(e.target)) closeMenu(); });
  el.share.addEventListener('click', async () => {
    const url = location.href, text = viewName();
    try {
      if (navigator.share) { closeMenu(); await navigator.share({ title: text, text, url }); return; }
      await navigator.clipboard.writeText(url);
      el.shareNote.textContent = 'Link copied';
      setTimeout(closeMenu, 900);
    } catch (err) { closeMenu(); /* the share sheet was dismissed, or the clipboard refused */ }
  });

  /* ------------------------------------------------------------------ navigation */
  function render(enter) {
    const page = el.page;
    page.textContent = '';
    L.thumbs = [];
    const now = L.stack[L.stack.length - 1];
    L.query = now.view === 'search' ? now.q || '' : '';
    const searching = !!L.query.trim();
    el.lib.classList.toggle('is-searching', searching);
    el.scopes.hidden = !searching;
    /* the top right: the profile on the library's home, the ellipsis menu on a page about something */
    const about = !!L.stack[L.stack.length - 1].id;
    el.profile.hidden = about;
    el.more.hidden = !about;
    closeMenu();
    if (!L.data) {
      head(page, 'Library', []);
      page.appendChild(make('p', 'lib-note', loading ? 'Loading the catalogue…' : 'The catalogue could not be loaded. Check the connection, then open the library again.', 'text'));
    } else if (searching) VIEWS.search(page);
    else { const top = L.stack[L.stack.length - 1]; VIEWS[top.view](page, top); }
    if (enter) { page.classList.remove('is-entering'); void page.offsetWidth; page.classList.add('is-entering'); }
    el.lib.classList.toggle('has-hero', !!page.querySelector('.hero'));
    el.lib.classList.remove('is-titled', 'tabs-pinned');
    L.titled = undefined;
    setFade(false);
    syncScopes();
    fitShelves();
    flushThumbs();
    requestAnimationFrame(pinCheck);
    sceneV++;
    kick(400);
  }
  /* Every step in the library (home, a composer, a search, a piece…) is an entry on the
     browser's history holding the steps up to it, and the address names it
     (#library/chopin/op-28/15, #library/~search/raindrop) for reloads, bookmarks and shared links.
     So the back button, Escape, the browser's back, a phone's back gesture and a swipe in from
     the left edge all go one step back the same way: out of a piece into the search it came
     from, out of a search into the page it started on, and from the library's home to the
     player. */
  const hashOf = (top) => (top.view === 'recent' ? '/recent' : top.view === 'covers' ? '/~covers' : top.view === 'search' ? '/~search/' + encodeURIComponent(top.q || '')
    : top.view === 'pieces' ? '/' + top.id + '/~pieces' : top.view === 'works' ? '/' + top.id + '/~works' : top.id ? '/' + top.id : '');
  const urlOf = (item) => '#library' + hashOf(item);
  const entry = (stack) => ({ fb: 'library', stack: stack.map((s) => ({ ...s })) });
  const inHistory = () => !!(history.state && history.state.fb === 'library');
  /* show the step on top: its search text in the field, where it was scrolled */
  function show(enter) {
    const top = L.stack[L.stack.length - 1];
    el.query.value = top.view === 'search' ? top.q || '' : '';
    el.clear.hidden = !el.query.value;
    render(enter);
    if (top.top) finishRows();   // back to where it was scrolled: the rows down to there must be in
    el.scroll.scrollTop = top.top || 0;
  }
  function push(item) {
    const cur = L.stack[L.stack.length - 1];
    cur.top = el.scroll.scrollTop;
    if (L.open && inHistory()) history.replaceState(entry(L.stack), '', urlOf(cur));
    L.stack.push(item);
    if (L.open) history.pushState(entry(L.stack), '', urlOf(item));
    show(true);
  }
  function back() {
    if (L.viewer) { closeViewer(); return; }
    if (!el.menu.hidden) { closeMenu(); return; }
    if (inHistory()) { history.back(); return; }
    /* no history of our own (it could not be written): step back by hand */
    if (L.stack.length > 1) { L.stack.pop(); show(true); } else closeNow();
  }
  window.addEventListener('popstate', (e) => {
    const s = e.state;
    if (s && s.fb === 'library') {
      L.stack = s.stack.map((x) => ({ ...x }));
      if (!L.open) present();
      show(true);
    } else if (L.open) closeNow();
  });
  function openEntry(e) {
    const d = L.data, f = d.fileOf(e);
    if (!f) return;
    const c = d.comp.get(f.composer), cat = catOf(f);
    if (f.b) FB.app.open({ kind: 'builtin', file: f.b });
    else FB.app.open({ kind: 'url', url: 'library/scores/' + f.s }, { id: 'cat:' + f.id, title: nameOf(f, true), composer: c.full + (cat ? ', ' + cat : '') });
    close();
  }

  /* ------------------------------------------------------------------ search */
  /* The search runs in a worker (js/search-worker.js); results come back as catalogue ids. One
     search at a time is out with the worker: what is typed meanwhile waits (only the latest), so
     the worker never works through letters already typed past. Answers are kept by query (the
     last few dozen), so typing back, or going back to a search, shows its results at once. */
  const S = { worker: null, ready: false, seq: 0, flying: null, next: null, results: null, shownQ: null, from: null, cache: new Map() };  function startSearch() {
    if (S.worker || !window.Worker) return;
    try { S.worker = new Worker('js/search-worker.js' + V); } catch (e) { return; }
    S.worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'ready') S.ready = true;
      else if (m.type === 'found') {
        const res = { q: S.flying, ids: m.ids };
        S.flying = null;
        S.cache.set(res.q, res);
        if (S.cache.size > 40) S.cache.delete(S.cache.keys().next().value);
        S.results = res;
        if (S.next !== null) { const n = S.next; S.next = null; if (!S.cache.has(n)) send(n); }
        landed(res);
      }
    };
    S.worker.postMessage({ type: 'init', url: new URL('library/catalog.json' + V, location.href).href });
  }
  function send(q) { S.flying = q; S.worker.postMessage({ type: 'find', id: ++S.seq, q, limit: 200 }); }
  function ask(q) {
    startSearch();
    if (!S.worker || S.cache.has(q) || q === S.flying || q === S.next) return;
    if (S.flying !== null) S.next = q;
    else send(q);
  }
  /* an answer is in: shown if it is for what is typed, or the best there is while that is found */
  function landed(res) {
    if (!L.open || !L.data) return;
    const top = L.stack[L.stack.length - 1];
    if (S.from) {
      /* a search typed on another page opens with its first results, not before */
      const from = S.from;
      S.from = null;
      if (from === top && el.query.value.trim()) push({ view: 'search', q: el.query.value });
      return;
    }
    if (top.view !== 'search' || L.tab === 'composers') return;
    const q = (top.q || '').trim();
    if (res.q !== q && S.cache.has(q)) return;   // answered after what is typed now was found
    if (res.q === S.shownQ) return;
    render(false);
    el.scroll.scrollTop = 0;
  }
  /* typing starts a search as a step of its own; more typing updates it in place; emptying the
     field steps back out of it. Until new results are in, the page keeps what it shows: the
     results before, or (for a search begun elsewhere) the page it was begun on */
  function onQuery() {
    const v = el.query.value, q = v.trim();
    el.clear.hidden = !v;
    const top = L.stack[L.stack.length - 1];
    if (top.view === 'search') {
      if (!q) { back(); return; }
      top.q = v;
      if (inHistory()) history.replaceState(entry(L.stack), '', urlOf(top));
      /* composers are matched here and now; pieces and works once the worker has them */
      if (L.tab === 'composers' || (S.cache.has(q) && q !== S.shownQ)) { render(false); el.scroll.scrollTop = 0; }
      else ask(q);
    } else if (!q) S.from = null;
    else if (L.data) {
      ask(q);
      /* a cold search (the index still being built) opens at once, saying so */
      if (L.tab === 'composers' || S.cache.has(q) || !S.worker || !S.ready) push({ view: 'search', q: v });
      else S.from = top;
    }
  }
  el.query.addEventListener('input', onQuery);
  el.query.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.query.blur(); });
  /* clearing keeps the keyboard as it was: up if it was up, and not opened (iOS would slide the page to the field) */
  el.clear.addEventListener('click', (e) => { e.preventDefault(); const typing = document.activeElement === el.query; el.query.value = ''; onQuery(); if (typing) el.query.focus(); });
  /* the scopes in the glass layer: the same choice as Explore's tabs */
  function syncScopes() {
    for (const b of el.scopes.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.tab === L.tab));
    syncPills();
  }
  /* The tab bars' pills, on the chosen tab. The pill slides only when the tab changes (slide: a
     tab chosen, or a press let go); when its tab merely changes size or place (the fonts arriving
     after a reload, the screen turning, a bar built or shown) it is set there at once. Sliding on
     those too made it wander for seconds after a reload as the tabs' widths settled. Each tab is
     watched for size changes, which the library's own resize does not see */
  const pillSizes = new ResizeObserver(() => { if (L.open) syncPills(false); });
  function syncPills(slide = false) {
    const i = TABS.indexOf(L.tab);
    for (const seg of el.lib.querySelectorAll('.seg.fit')) {
      if (!seg._watched) { seg._watched = true; for (const b of seg.querySelectorAll('button')) pillSizes.observe(b); }
      if (!seg.offsetWidth) { seg._placed = false; continue; }
      if (seg._placed && slide) { FB.placePill(seg, i); continue; }
      seg.classList.add('is-placing');
      FB.placePill(seg, i);
      void getComputedStyle(seg, '::after').left;
      seg._placed = true;
      requestAnimationFrame(() => requestAnimationFrame(() => seg.classList.remove('is-placing')));
    }
  }

  /* ------------------------------------------------------------------ Continue's cards
     On a touch screen the shelf swipes, and its cards are sized so the last one in view is cut
     exactly in half at the edge: whole cards and a half, as near the usual card width as that
     allows. With a mouse there is no swiping: one row of as many cards as fit at the usual width,
     stretched to fill the column. */
  const TOUCH = window.matchMedia('(hover: none) and (pointer: coarse)');
  const CARD_GAP = 12;
  function fitShelves() {
    const target = parseFloat(getComputedStyle(el.lib).getPropertyValue('--card-w')) || 200;
    for (const shelf of el.page.querySelectorAll('.shelf')) {
      const cards = [...shelf.children];
      if (shelf.classList.contains('fitted')) {
        const w = shelf.clientWidth;
        const cols = Math.max(2, Math.floor((w + CARD_GAP) / (target + CARD_GAP)));
        shelf.style.setProperty('--cols', cols);
        cards.forEach((c, i) => { c.hidden = i >= cols; });
      } else {
        const pad = parseFloat(getComputedStyle(shelf).paddingLeft) || 0;
        const view = shelf.clientWidth - pad;
        const whole = Math.max(1, Math.round(view / (target + CARD_GAP) - 0.5));
        shelf.style.setProperty('--card-w', ((view - whole * CARD_GAP) / (whole + 0.5)).toFixed(2) + 'px');
      }
    }
  }
  TOUCH.addEventListener('change', () => { if (L.open && L.data) render(false); });
  for (const b of el.scopes.querySelectorAll('button')) b.addEventListener('click', () => setTab(b.dataset.tab));
  /* The on-screen keyboard crops the library from below, and nothing else moves: the library
     keeps covering the whole screen (so nothing of the player shows around the keyboard), the
     list's bottom edge and the search bar ride up on the keyboard (--kb, its height), and the
     top stays where it is, from the moment the keyboard starts to rise to when it is gone.
     iOS would otherwise slide the whole page up to bring the search field into view, since the
     field sits where the keyboard is about to be. So on iOS a touch on the search bar does not
     focus the field itself: it focuses a hidden field at the top of the screen (#libProxy),
     which iOS has no need to scroll to, and its text is copied into the search as it is typed.
     Once the keyboard is up and the search bar sits on it, the real field takes over (the
     keyboard stays up when focus moves between fields), with its caret.
     The keyboard's height is known only once it is up, so the crop starts with the height it had
     last time (kept per orientation), or a guess, and settles on the real one as iOS reports it.
     Heights are judged against the layout viewport (clientHeight), which the keyboard leaves
     alone; window.innerHeight can shrink with it on iOS. */
  if (window.visualViewport) {
    const vv = window.visualViewport;
    const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const proxy = $('libProxy');
    const field = (a) => !!a && el.lib.contains(a) && (a.isContentEditable || a.tagName === 'INPUT' || a.tagName === 'TEXTAREA');
    const typing = () => L.open && field(document.activeElement);
    const portrait = () => (innerWidth < innerHeight ? 'p' : 'l');
    const remembered = () => { try { return JSON.parse(localStorage.getItem('fb.keyboard') || '{}'); } catch (err) { return {}; } };
    const guess = () => remembered()[portrait()] || Math.round(document.documentElement.clientHeight * (portrait() === 'p' ? 0.45 : 0.55));
    let kb = 0;
    const setKb = (px) => {
      px = Math.max(0, Math.round(px));
      if (px === kb) return;
      kb = px;
      el.lib.style.setProperty('--kb', px + 'px');
      el.lib.classList.toggle('kb-up', px > 80);
      sceneUntil = performance.now() + 500;   // the search bar's glass follows it up
      kick(500);
    };
    /* what the keyboard hides, once iOS says; while it is rising, the height expected */
    let rising = 0;
    const fit = () => {
      /* if iOS slid the page after all, the library goes with it, so its top stays in view; once
         nothing is being typed it is back where it belongs, whatever iOS reports */
      el.lib.style.transform = typing() && vv.offsetTop > 0 ? 'translateY(' + vv.offsetTop + 'px)' : '';
      const hidden = document.documentElement.clientHeight - vv.height;
      if (!typing()) { if (!rising) setKb(0); return; }
      if (hidden > 80) {
        rising = 0;
        try { localStorage.setItem('fb.keyboard', JSON.stringify({ ...remembered(), [portrait()]: hidden })); } catch (err) { /* private mode */ }
        setKb(hidden);
        handOverSoon();
      } else if (!rising) setKb(0);   // a hardware keyboard: nothing to crop
    };
    vv.addEventListener('resize', fit);
    vv.addEventListener('scroll', fit);
    el.lib.addEventListener('focusin', () => { fit(); setTimeout(fit, 150); setTimeout(fit, 500); });
    el.lib.addEventListener('focusout', () => setTimeout(() => { if (!typing() && !handing) { rising = 0; setKb(0); fit(); } }, 0));

    /* iOS: start the keyboard from the hidden field. The real field takes over only once the
       search bar has finished riding up and sits wholly above the keyboard: while it is still
       under it, iOS would slide the page up to reach it */
    let handing = false, handTimer = 0;
    function handOverSoon(tries = 0) {
      clearTimeout(handTimer);
      if (document.activeElement !== proxy) return;
      const moving = el.bottom.getAnimations().length > 0;
      const covered = el.search.getBoundingClientRect().bottom > vv.offsetTop + vv.height - 1;
      if ((moving || covered) && tries < 30) { handTimer = setTimeout(() => handOverSoon(tries + 1), 50); return; }
      if (!covered) handOver();   // still covered after 1.5 s: stay on the hidden field, which types just the same
    }
    function handOver() {
      if (document.activeElement !== proxy) return;
      handing = true;
      el.query.focus({ preventScroll: true });
      const n = el.query.value.length;
      try { el.query.setSelectionRange(n, n); } catch (err) { /* type=search may refuse */ }
      handing = false;
    }
    if (IOS && proxy) {
      el.search.addEventListener('touchend', (e) => {
        if (!L.open || typing() || e.target.closest('button')) return;
        e.preventDefault();   // no focus (and no scroll) on the field under the finger
        proxy.value = el.query.value;
        proxy.focus({ preventScroll: true });
        rising = performance.now();
        setKb(guess());
        setTimeout(() => { if (rising && performance.now() - rising >= 1400) { rising = 0; fit(); } }, 1500);
      }, { passive: false });
      proxy.addEventListener('input', () => { el.query.value = proxy.value; el.query.dispatchEvent(new Event('input', { bubbles: true })); });
      proxy.addEventListener('keydown', (e) => { if (e.key === 'Enter') proxy.blur(); });
    }
  }

  /* ------------------------------------------------------------------ glass */
  const css = {};
  function readTheme() {
    const cs = getComputedStyle(document.documentElement);
    for (const k of ['bg', 'stage', 'lane', 'grid', 'grid-2', 'rh', 'lh', 'now']) css[k] = cs.getPropertyValue('--' + k).trim();
  }
  function rr(c, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    c.beginPath();
    c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
  function initGlass() {
    const GL = window.FBGlass;
    if (glass || !GL) return;
    try {
      /* fps: set by pace() below. At the glass's own 30 a second it redrew every other frame of a
         scroll (every fourth on a 120 Hz screen), showing the page as it was frames before */
      glass = new GL.GlassBackdrop({ root: () => el.lib, fps: Infinity, reducedTransparency: () => window.matchMedia('(prefers-contrast: more)').matches,
        record: (step, ms) => {
          if (step === 'glass.frame.cpu') glassCost = glassCost ? glassCost * 0.8 + ms * 0.2 : ms;
          /* the cost of each step of a frame, for profiling: set FB.glassRecord = (step, ms) => … */
          if (FB.glassRecord) FB.glassRecord(step, ms);
        } });
      GL.attachGlassMaterials(glass, el.lib);
    } catch (e) { glass = null; }
  }
  function kick(ms) {
    if (ms) busyUntil = Math.max(busyUntil, performance.now() + ms);
    if (!frameQueued) { frameQueued = true; requestAnimationFrame(frame); }
  }
  function frame(ms) {
    frameQueued = false;
    if (!L.open || !glass) return;
    pace(ms);
    if (performance.now() < sceneUntil) sceneV++;
    glass.update(el.lib.clientWidth, el.lib.clientHeight, ms, paint, String(sceneV));
    if (ms < busyUntil) kick();
  }
  /* How often the glass redraws while the page under it moves: on every frame while a redraw is
     cheap next to the frame (any recent phone, at 60 or 120 Hz), so what shows through it is
     never older than the frame being drawn; every other frame where it is not (a slow device),
     so the page around it keeps its frame rate. Between the two by a margin, so it doesn't flip.
     A frame is the screen's: the shortest gap between frames in a run (a slow frame is longer) */
  let glassCost = 0, frameGap = 1000 / 60, lastFrame = 0, everyOther = false;
  function pace(ms) {
    const gap = ms - lastFrame;
    lastFrame = ms;
    if (gap > 4 && gap < 50) frameGap = Math.min(frameGap * 1.002, gap, 20);   // no screen is slower than 50 Hz
    if (!everyOther && glassCost > frameGap * 0.4) everyOther = true;
    else if (everyOther && glassCost < frameGap * 0.25) everyOther = false;
    glass.options.fps = everyOther ? 1000 / (frameGap * 1.2) : Infinity;
  }
  /* What the scene can draw, measured once per layout rather than on every frame (on Explore that
     was hundreds of nodes, each measured and its style read sixty times a second while the page
     scrolled): each node's box where it sits in the scrolling page (and in a sideways shelf or
     strip, which it moves with), and what it takes to draw it. Measured again once anything
     changes the layout (a view, a resize, nodes or text added or removed, the page's entrance
     ending); scrolling only shifts it */
  let paintables = null;
  /* geo: the layout's numbers that each frame of a scroll reads (where the tabs pin, the headings
     the small title follows, the top bar's bottom, the fade's top), measured once per layout */
  let geo = {};
  const unmeasure = () => { paintables = null; geo = {}; depthNow = null; };
  function measurePaintables(scope, root) {
    const vy = scope === el.page ? el.scroll.scrollTop : 0;
    const list = [];
    for (const n of scope.querySelectorAll('[data-paint]')) {
      const r = n.getBoundingClientRect();
      if (!r.width) continue;
      const side = n.closest('.shelf, .pages, .viewer-pages');
      const it = { n, side, sx: side ? side.scrollLeft : 0, x: r.left - root.left, y: r.top - root.top + vy, w: r.width, h: r.height };
      it.kind = n.tagName === 'CANVAS' ? 'canvas' : n.tagName === 'IMG' ? 'img' : n.dataset.paint;
      list.push(it);
    }
    return { scope, list };
  }
  /* what it takes to draw a node, read the first time it is drawn: most never come near the glass */
  function styleOf(it) {
    it.styled = true;
    if (it.kind === 'canvas' || it.kind === 'img') return;
    const n = it.n, cs = getComputedStyle(n);
    it.radius = parseFloat(cs.borderTopLeftRadius) || 0;
    if (it.kind === 'cover') { it.field = n.dataset.field; it.base = n.dataset.base; }
    else if (it.kind === 'box') it.bg = cs.backgroundColor;
    else { it.size = parseFloat(cs.fontSize); it.font = cs.fontWeight + ' ' + it.size + 'px ' + cs.fontFamily; it.color = cs.color; it.text = n.textContent; }
  }
  /* changes in the top bar (the small title) move nothing the scene draws */
  new MutationObserver((list) => { if (list.some((m) => !el.title.contains(m.target))) unmeasure(); }).observe(el.lib, { childList: true, subtree: true, characterData: true });
  el.page.addEventListener('animationend', unmeasure);
  new ResizeObserver(unmeasure).observe(el.lib);
  /* the scene under the glass: the page, every box, miniature and line of text near a glass
     control, drawn where it sits, then the same fade to black as the content above the search */
  function paint(ctx) {
    const root = el.lib.getBoundingClientRect();
    ctx.fillStyle = css.bg;
    ctx.fillRect(0, 0, root.width, root.height);
    const bands = [];
    for (const g of el.lib.querySelectorAll('.glass-material')) {
      const r = g.getBoundingClientRect();
      if (r.width && r.height) bands.push([r.left - 32, r.top - 32, r.right + 32, r.bottom + 32]);
    }
    /* the full-screen sheet music, when open, is all there is under its glass */
    const scope = L.viewer ? L.viewer.el : el.page;
    if (!paintables || paintables.scope !== scope) paintables = measurePaintables(scope, root);
    const vy = scope === el.page ? el.scroll.scrollTop : 0;
    for (const it of paintables.list) {
      const x = it.x - (it.side ? it.side.scrollLeft - it.sx : 0), y = it.y - vy, w = it.w, h = it.h;
      if (!bands.some((band) => x + w > band[0] && y + h > band[1] && x < band[2] && y < band[3])) continue;
      if (!it.styled) styleOf(it);
      if (it.kind === 'canvas') { if (it.n.width) ctx.drawImage(it.n, x, y, w, h); continue; }
      /* a page of sheet music is drawn as the paper it shows: drawing the SVG itself could lock
         the canvas, and the glass could no longer read it */
      if (it.kind === 'img') { ctx.fillStyle = '#fff'; ctx.fillRect(x, y, w, h); continue; }
      if (it.kind === 'cover') {
        /* the cover's palette, as a plain two-colour wash: enough for the glass to refract */
        const g = ctx.createLinearGradient(x, y, x + w, y + h);
        g.addColorStop(0, it.field || css.lane);
        g.addColorStop(1, it.base || css.lane);
        ctx.fillStyle = g;
        rr(ctx, x, y, w, h, it.radius);
        ctx.fill();
        continue;
      }
      if (it.kind === 'box') {
        ctx.fillStyle = it.bg;
        rr(ctx, x, y, w, h, it.radius);
        ctx.fill();
        continue;
      }
      ctx.font = it.font;
      ctx.fillStyle = it.color;
      ctx.textBaseline = 'alphabetic';
      ctx.save();
      ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
      ctx.fillText(it.text, x, y + (Math.min(h, it.size * 1.5) + it.size * 0.7) / 2);
      ctx.restore();
    }
    /* black from `black` to `clear`, through the given stops ([position 0-1, how much shows]), as
       the CSS masks and covers do */
    const fade = (black, clear, fromTop, stops = [], floor = 0) => {
      const k = 1 - floor;   // how black the black end is: a floor of 0.5 leaves half showing
      const g = ctx.createLinearGradient(0, black, 0, clear);
      g.addColorStop(0, 'rgba(0,0,0,' + k + ')');
      for (const [at, shows] of stops) g.addColorStop(at, 'rgba(0,0,0,' + k * (1 - shows) + ')');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, Math.min(black, clear), root.width, Math.abs(clear - black));
      ctx.fillStyle = 'rgba(0,0,0,' + k + ')';
      if (fromTop) ctx.fillRect(0, 0, root.width, black); else ctx.fillRect(0, black, root.width, root.height - black);
    };
    if (L.viewer) return;
    /* the same smooth S as the CSS mask (index.html .lib-scroll), read from it as it changes */
    const S_CURVE = [[0.25, 0.156], [0.5, 0.5], [0.75, 0.844]];
    /* the fade as applyFade last set it; where it reaches black (the top edge) is read once per layout */
    if (geo.topBlack === undefined) geo.topBlack = parseFloat(getComputedStyle(el.fadeTop).getPropertyValue('--top-black')) || 0;
    if (fadeShown.span > 0) fade(geo.topBlack, geo.topBlack + fadeShown.span, true, S_CURVE, fadeShown.floor);
    const bar = el.bottom.getBoundingClientRect();
    if (bar.height) fade(bar.bottom - root.top, bar.top - 64 - root.top, false, S_CURVE);
  }
  /* from 872 px the back button sits beside the column (index.html .library) */
  const WIDE = window.matchMedia('(min-width: 872px)');
  /* Positions are measured on the layout (offsets within the scrolling page), not on screen: a
     fresh page starts its entrance 12 px low, which would read as "not there yet" */
  const layoutTop = (node) => { let y = 0; for (let n = node; n && n !== el.scroll; n = n.offsetParent) y += n.offsetTop; return y; };
  const STILL = window.matchMedia('(prefers-reduced-motion: reduce)');
  /* Explore's tabs pin under the top bar, and ease into their place rather than stopping dead
     (as a sticky element alone does): over the EASE px of scrolling either side of where they
     pin, they fall behind the page a little, slowing evenly until they rest. The easing is a
     scroll-driven animation in the CSS (index.html .explore-tabs), so it moves in step with the
     scroll itself; set from a script on every scroll event it lagged a frame behind on the
     iPhone and jittered. Here only its scroll range is kept up to date: where they pin, in
     scroll offset, less and more EASE */
  const EASE = 28;
  function pinCheck() {
    const tabs = el.page.querySelector('.explore-tabs'), mark = el.page.querySelector('.explore-mark');
    if (tabs && mark) {
      if (geo.pinAt === undefined || geo.tabs !== tabs) { geo.tabs = tabs; geo.pinAt = layoutTop(mark) - parseFloat(getComputedStyle(tabs).top); }
      const at = geo.pinAt;
      const range = Math.round(at - EASE) + 'px ' + Math.round(at + EASE) + 'px';
      if (tabs.dataset.range !== range) { tabs.dataset.range = range; tabs.style.setProperty('--settle', range); }
      const pinned = el.scroll.scrollTop >= at - 0.5;
      tabs.classList.toggle('is-pinned', pinned);
      if (el.lib.classList.contains('tabs-pinned') !== pinned) {
        el.lib.classList.toggle('tabs-pinned', pinned);   // the top fade reaches down behind them
        setFade(true);
      }
    }
    titleCheck();
    setFade(true);   // the top fade grows with the first bit of scrolling
    sceneV++;
    kick();
  }
  /* The page's name, small, in the middle of the top bar once its heading has gone up under the
     bar (as iOS does): the last heading marked with data-title that has passed the bar's bottom,
     so on the home it reads Library, then Explore. While it shows, the top fade is at full
     strength (index.html .lib-scroll), even over an album cover's glow. */
  let sceneUntil = 0;   // until then, the glass's scene is repainted every frame (the search bar riding the keyboard)
  function titleCheck() {
    let on = null;
    if (!L.viewer && !L.query.trim()) {
      if (!geo.heads) {
        geo.bar = el.back.getBoundingClientRect().bottom - el.scroll.getBoundingClientRect().top;
        geo.heads = [...el.page.querySelectorAll('[data-title]')].map((h) => [h, layoutTop(h) + h.offsetHeight]);
      }
      const line = geo.bar + el.scroll.scrollTop;
      for (const [h, bottom] of geo.heads) if (bottom < line) on = h;
    }
    const key = on ? on.dataset.title + '|' + (on.dataset.sub || '') : '';
    if (key === L.titled) return;
    const was = L.titled;
    L.titled = key;
    if (on) {
      el.title.firstElementChild.textContent = on.dataset.title;
      el.title.lastElementChild.textContent = on.dataset.sub || '';
      if (was) el.title.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' });
    }
    el.title.classList.toggle('is-on', !!on);
    el.lib.classList.toggle('is-titled', !!on);
    setFade(true);
  }
  /* The top fade (index.html .lib-scroll): half strength over an album cover until the small
     title shows; down to the bottom of Explore's tabs while they are pinned. Eased here, frame by
     frame, over --dur-move; the glass's scene is repainted along with it */
  const FADE_MS = 280;
  let fadeNow = null, fadeFrom = null, fadeTo = null, fadeAt = 0;
  /* the top bar's depth (a button and an edge): the top fade's height at rest */
  let depthNow = null;
  const barDepth = () => {
    if (depthNow) return depthNow;
    const cs = getComputedStyle(document.documentElement);
    return (depthNow = { control: parseFloat(cs.getPropertyValue('--control')) || 44, edge: parseFloat(cs.getPropertyValue('--edge')) || 16 });
  };
  /* what is eased: the floor, and how much further the fade reaches while the tabs are pinned */
  function fadeTarget() {
    const { control } = barDepth(), c = el.lib.classList;
    return { floor: c.contains('has-hero') && !c.contains('is-titled') ? 0.5 : 0, extra: c.contains('tabs-pinned') ? 2 * control : 0 };
  }
  /* what follows the scroll: the fade grows from the bar's depth to twice it over the first
     bar's depth of scrolling */
  function applyFade(v) {
    fadeNow = v;
    const { control, edge } = barDepth(), depth = control + edge;
    const grow = Math.min(Math.max(el.scroll.scrollTop / depth, 0), 1);
    /* on the fade's own layer, and only when they change: set on the library they changed the
       style of everything in it, on every frame of a scroll */
    const floor = Math.round(v.floor * 1000) / 1000, span = Math.round((depth * (1 + grow) + v.extra) * 10) / 10;
    if (floor === fadeShown.floor && span === fadeShown.span) return;
    fadeShown = { floor, span };
    el.fadeTop.style.setProperty('--top-floor', String(floor));
    el.fadeTop.style.setProperty('--top-span', span + 'px');
    sceneV++;
    kick();
  }
  let fadeShown = { floor: 0, span: 0 };
  function setFade(animate) {
    const to = fadeTarget();
    if (fadeTo && to.floor === fadeTo.floor && to.extra === fadeTo.extra) { if (!fadeAt && fadeNow) applyFade(fadeNow); return; }
    fadeTo = to;
    if (!animate || !fadeNow || STILL.matches) { fadeAt = 0; applyFade(to); return; }
    fadeFrom = fadeNow;
    const first = !fadeAt;
    fadeAt = performance.now();
    if (first) requestAnimationFrame(stepFade);
  }
  function stepFade() {
    if (!fadeAt) return;
    const t = Math.min(1, (performance.now() - fadeAt) / FADE_MS), e = 1 - Math.pow(1 - t, 3);
    applyFade({ floor: fadeFrom.floor + (fadeTo.floor - fadeFrom.floor) * e, extra: fadeFrom.extra + (fadeTo.extra - fadeFrom.extra) * e });
    if (t < 1) requestAnimationFrame(stepFade); else fadeAt = 0;
  }
  el.scroll.addEventListener('scroll', () => { pinCheck(); sceneV++; kick(); }, { passive: true });
  el.page.addEventListener('scroll', () => { sceneV++; kick(); }, { passive: true, capture: true });
  el.lib.addEventListener('pointerdown', () => kick(500), true);
  el.lib.addEventListener('pointerup', () => kick(500), true);
  /* a press that slid off a tab without choosing it puts the pill back */
  for (const type of ['pointerup', 'pointercancel']) el.lib.addEventListener(type, () => setTimeout(() => syncPills(true), 200), true);
  new ResizeObserver(() => {
    if (!L.open) return;
    fitShelves();
    syncPills();
    for (const c of el.page.querySelectorAll('.card canvas')) L.thumbs.push([c, c._r]);
    flushThumbs();
    pinCheck();
    sceneV++;
    kick(300);
  }).observe(el.lib);

  /* ------------------------------------------------------------------ open and close */
  /* the library on screen, without touching the history (a step back or forward reached it) */
  function present() {
    L.open = true;
    el.lib.classList.remove('is-closing');
    el.lib.hidden = false;
    FB.app.covered(true);
    readTheme();
    loadFonts();
    initGlass();
    if (!L.data) load().then(() => { if (L.open) show(true); startSearch(); }, () => { if (L.open) render(false); });
    else startSearch();
    requestAnimationFrame(pinCheck);
    kick(600);
  }
  /* open where it was left (home shows the latest recents each time), one history entry per step */
  function open() {
    if (L.open) return;
    L.stack.forEach((s, i) => history.pushState(entry(L.stack.slice(0, i + 1)), '', urlOf(s)));
    present();
    show(true);
  }
  /* leave for the player: back past all of the library's steps, as if each had been undone */
  function close() {
    if (!L.open) return;
    if (inHistory()) history.go(-L.stack.length);
    else closeNow();
  }
  function closeNow() {
    if (!L.open) return;
    L.open = false;
    closeViewer();
    el.query.blur();
    el.lib.classList.add('is-closing');
    setTimeout(() => { if (!L.open) { el.lib.hidden = true; el.lib.classList.remove('is-closing'); } }, 200);
    FB.app.covered(false);
    el.menuBtn.focus({ preventScroll: true });
  }
  el.back.addEventListener('click', back);
  /* Installed on a phone's home screen there is no browser around the app to give the swipe in
     from the left edge, so the library gives it: the same step back as the button. In a browser
     the browser's own gesture already steps back through the library's history. */
  const STANDALONE = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (STANDALONE) {
    let swipe = null;
    el.lib.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      swipe = e.touches.length === 1 && t.clientX < 24 ? { x: t.clientX, y: t.clientY } : null;
    }, { passive: true });
    el.lib.addEventListener('touchmove', (e) => {
      if (!swipe) return;
      const t = e.touches[0], dx = t.clientX - swipe.x, dy = Math.abs(t.clientY - swipe.y);
      if (dy > 40 && dy > dx) swipe = null;
      else if (dx > 72) { swipe = null; back(); }
    }, { passive: true });
    el.lib.addEventListener('touchend', () => { swipe = null; }, { passive: true });
  }
  el.file.addEventListener('change', () => { if (L.open && el.file.files && el.file.files.length) close(); }, true);
  document.addEventListener('keydown', (e) => {
    if (!L.open) return;
    if (L.viewer) {
      if (e.key === 'Escape') { e.preventDefault(); closeViewer(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); turnViewer(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); turnViewer(-1); }
      return;
    }
    const typing = e.target === el.query;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (typing && !L.query) el.query.blur();
      else back();
    } else if (!typing && (e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k'))) {
      e.preventDefault();
      el.query.focus();
    }
  });

  /* #library/<composer>, #library/<id> (a work or a piece), #library/recent,
     #library/<composer>/~pieces, #library/<composer>/~works: open there once the catalogue is in */
  function stackFor(path) {
    const d = L.data, stack = [{ view: 'home' }];
    if (!path || !d) return stack;
    if (path === 'recent') return [...stack, { view: 'recent' }];
    if (path === '~covers') return [...stack, { view: 'covers' }];
    const sought = /^~search\/(.*)$/.exec(path);
    if (sought) return [...stack, { view: 'search', q: sought[1] }];
    const list = /^(.+)\/~(pieces|works)$/.exec(path);
    if (list && d.comp.has(list[1])) return [...stack, { view: 'composer', id: list[1] }, { view: list[2], id: list[1] }];
    if (d.comp.has(path)) return [...stack, { view: 'composer', id: path }];
    const e = d.byId.get(path);
    if (!e) return stack;
    stack.push({ view: 'composer', id: e.composer });
    const chain = [];
    for (let x = d.parentOf(e); x; x = d.parentOf(x)) chain.unshift({ view: 'work', id: x.id });
    return [...stack, ...chain, d.kids.has(e.id) ? { view: 'work', id: e.id } : { view: 'piece', id: e.id }];
  }
  FB.library = { open, close, isOpen: () => L.open };
  const asked = /^#library(?:\/(.+))?$/.exec(location.hash);
  if (asked) {
    /* a link into the library: the player's entry underneath, then a step for each level, so
       back walks up through them to the player */
    history.replaceState(null, '', location.pathname + location.search);
    open();
    load().then(() => { for (const item of stackFor(asked[1] && decodeURIComponent(asked[1])).slice(1)) push(item); }, () => {});
  } else if (FB.app && FB.app.firstVisit) open();
  else if ('requestIdleCallback' in window) requestIdleCallback(() => load().catch(() => {}));
})();
