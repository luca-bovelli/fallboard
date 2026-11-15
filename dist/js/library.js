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
    menuBtn: $('menuBtn'), file: $('fileInput'),
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
  function head(page, title, lines, extra) {
    const h = make('header', 'lib-head');
    h.appendChild(make('h1', '', title, 'text'));
    for (const line of lines) if (line) h.appendChild(typeof line === 'string' ? make('p', '', line, 'text') : line);
    if (extra) h.appendChild(extra);
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

  /* a row. style: 'two' (name, then composer and number in grey), 'one' (the name only),
     'num' (a grey number, then the name), 'work' (the grey catalogue number, then the name) */
  function row(e, style, n) {
    const d = L.data, group = d.kids.has(e.id);
    const b = button('row' + (style === 'num' ? ' num one' : style === 'two' ? '' : ' one'), undefined, () => go(e));
    if (style === 'num') b.appendChild(make('span', 'n', n != null ? String(n) : '', 'text'));
    const main = make('span', 'main');
    const title = make('b', '', undefined, 'text');
    if (style === 'work' && catOf(e)) title.appendChild(make('span', 'cat', catOf(e)));
    title.appendChild(document.createTextNode(style === 'two' ? nameOf(e, true) : nameOf(e, false)));
    if (lacks(e)) title.appendChild(dot());
    main.appendChild(title);
    if (style === 'two') main.appendChild(make('small', '', [composerName(e), catOf(e)].filter(Boolean).join(' · '), 'text'));
    b.appendChild(main);
    const aside = make('span', 'aside');
    if (group) aside.insertAdjacentHTML('beforeend', CHEVRON);
    b.appendChild(aside);
    return b;
  }
  function rows(list, style, cols = true) {
    const box = make('div', 'rows' + (cols ? ' cols' : ''));
    list.forEach((e, i) => box.appendChild(row(e, style, style === 'num' ? e.number || i + 1 : null)));
    return box;
  }

  /* a recent piece: its notes in miniature, then its name and where you left off */
  function card(r) {
    const b = button('card', undefined, () => { FB.app.open(r.open, r); close(); }, 'box');
    const cv = make('canvas', '', undefined, 'img');
    cv.setAttribute('aria-hidden', 'true');
    cv._r = r;
    b.appendChild(cv);
    const t = make('span', 'txt');
    t.appendChild(make('b', '', r.title, 'text'));
    if (r.composer) t.appendChild(make('small', '', r.composer, 'text'));
    t.appendChild(make('span', 'where', r.bars ? 'Bar ' + (r.bar || 1) + ' of ' + r.bars : '', 'text'));
    b.appendChild(t);
    L.thumbs.push([cv, r]);
    return b;
  }
  /* the first card: your own MusicXML file */
  function uploadCard() {
    const b = button('card', undefined, () => FB.app.upload(), 'box');
    const art = make('span', 'art', undefined, 'box');
    art.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
    b.appendChild(art);
    const t = make('span', 'txt');
    t.appendChild(make('b', '', 'Upload a score', 'text'));
    t.appendChild(make('small', '', 'MusicXML or .mxl', 'text'));
    t.appendChild(make('span', 'where', 'From this device', 'text'));
    b.appendChild(t);
    return b;
  }
  function drawThumb(cv, r) {
    const w = cv.clientWidth, h = cv.clientHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
    if (!w || !h) return;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = css.stage; c.fillRect(0, 0, w, h);
    const t = r.thumb || [];
    let lo = 127, hi = 0;
    for (let i = 0; i < t.length; i += 4) { lo = Math.min(lo, t[i + 2]); hi = Math.max(hi, t[i + 2]); }
    const padX = 12, padY = 12, span = Math.max(12, hi - lo), iw = w - padX * 2, ih = h - padY * 2;
    for (let i = 0; i < t.length; i += 4) {
      const x = padX + t[i] / 1000 * iw, len = Math.max(2, t[i + 1] / 1000 * iw);
      const y = padY + (1 - (t[i + 2] - lo) / span) * ih - 1.25;
      c.fillStyle = t[i + 3] ? css.lh : css.rh;
      rr(c, x, y, len, 2.5, 1.25);
      c.fill();
    }
    if (r.pos > 0 && r.dur) {
      const x = padX + Math.min(1, r.pos / r.dur) * iw;
      c.fillStyle = css.now;
      rr(c, x - 1, 6, 2, h - 12, 1);
      c.fill();
    }
  }
  function flushThumbs() {
    const list = L.thumbs;
    L.thumbs = [];
    requestAnimationFrame(() => { for (const [cv, r] of list) drawThumb(cv, r); sceneV++; kick(); });
  }

  function tile(c) {
    const b = button('tile', undefined, () => { clearQuery(); go2([{ view: 'home' }, { view: 'composer', id: c.id }]); }, 'box');
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
    syncPills();
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
      /* Explore's heading and tabs pin at the top; the list runs on beneath them */
      const x = make('section', 'lib-sec explore');
      const top = make('div', 'explore-head');
      top.appendChild(make('h2', '', 'Explore', 'text'));
      top.appendChild(tabsControl());
      x.appendChild(top);
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
      head(page, 'Pieces', [c.full]);
      page.appendChild(rows(L.data.leaves.filter((e) => e.composer === c.id).sort(byFame), 'one'));
    },
    works(page, item) {
      const c = L.data.comp.get(item.id);
      head(page, 'Works', [c.full]);
      page.appendChild(rows(L.data.tops.filter((e) => e.composer === c.id).sort(byCatalogue), 'work'));
    },

    work(page, item) {
      const d = L.data, e = d.byId.get(item.id), c = d.comp.get(e.composer);
      const yearOf = e.year || (d.parentOf(e) || {}).year;
      const who = button('link', c.full, () => go2([{ view: 'home' }, { view: 'composer', id: c.id }]), 'text');
      const p = d.parentOf(e);
      const lines = [who, [catOf(e), e.key && keyText(e.key), yearOf].filter(Boolean).join(' · ')];
      if (p) lines.push(button('link', 'Part of ' + workName(p), () => push({ view: 'work', id: p.id }), 'text'));
      let actions = null;
      if (e.s || e.b) {
        actions = make('div', 'actions');
        actions.appendChild(playButton(e));
      }
      head(page, workName(e), lines, actions);
      const s = make('section', 'lib-sec');
      const k = d.kids.get(e.id);
      s.appendChild(rows(k, 'num', k.length > 6));
      page.appendChild(s);
    },

    piece(page, item) { pieceView(page, L.data.byId.get(item.id)); },

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
      if (!S.results || S.results.q !== q) {
        ask(q);
        page.appendChild(make('p', 'lib-note', S.ready ? 'Searching…' : 'Getting the search ready…', 'text'));
        return;
      }
      const want = L.tab === 'works' ? (e) => L.data.kids.has(e.id) : (e) => !L.data.kids.has(e.id);
      const found = S.results.ids.map((id) => L.data.byId.get(id)).filter((e) => e && want(e));
      if (found.length) page.appendChild(rows(found, 'two'));
      else page.appendChild(make('p', 'lib-note', 'No ' + L.tab + ' match “' + q + '”. Try a composer, a key or a catalogue number, like rach 23 2 or bb minor' + (L.tab === 'pieces' ? ', or look under Works.' : ', or look under Pieces.'), 'text'));
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
  function pieceView(page, e) {
    const d = L.data, c = d.comp.get(e.composer), p = d.parentOf(e);
    const year = e.year || (p && p.year), pub = e.pub || (p && p.pub);
    const title = pieceName(e, false);
    const lines = [button('link', c.full, () => go2([{ view: 'home' }, { view: 'composer', id: c.id }]), 'text')];
    if (p) lines.push(button('link', [catOf(e), workName(p)].filter(Boolean).join(' · '), () => push({ view: 'work', id: p.id }), 'text'));
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
    actions.appendChild(pdf);
    const h = head(page, title, lines, actions);
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
    fact('Composer', c.full + (lifeOf(c) ? ' (' + lifeOf(c) + ')' : ''));
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
    s.appendChild(make('p', 'lib-note', 'A4, the same layout for every piece in the library. Download it as a PDF to print or keep.', 'text'));
    const pages = make('div', 'pages');
    s.appendChild(pages);
    if (!TOUCH.matches) pageArrows(s.querySelector('.sec-head'), pages);
    showPages(e, pages);
  }
  /* with a mouse there is no swiping: arrows turn the preview a page at a time */
  function pageArrows(headRow, pages) {
    const box = make('div', 'page-arrows');
    const arrow = (dir, label, path) => {
      const b = button('btn icon small', undefined, () => {
        const pg = pages.querySelector('.sheet-page');
        const step = pg ? pg.offsetWidth + CARD_GAP : pages.clientWidth;
        pages.scrollBy({ left: dir * step, behavior: 'smooth' });
      });
      b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + path + '"/></svg>';
      b.setAttribute('aria-label', label);
      b.title = label;
      return b;
    };
    const prev = arrow(-1, 'Previous page', 'm14.5 5.5-6.5 6.5 6.5 6.5');
    const next = arrow(1, 'Next page', 'm9.5 5.5 6.5 6.5-6.5 6.5');
    box.append(prev, next);
    headRow.appendChild(box);
    const sync = () => {
      prev.disabled = pages.scrollLeft < 2;
      next.disabled = pages.scrollLeft + pages.clientWidth > pages.scrollWidth - 2;
    };
    pages.addEventListener('scroll', sync, { passive: true });
    new ResizeObserver(sync).observe(pages);
    new MutationObserver(sync).observe(pages, { childList: true });
    sync();
  }

  /* the pages as they will print, engraved here by MuseScore's engine (js/print.js); kept for
     the session so the PDF and a second visit are instant */
  function printInfo(e) {
    const d = L.data, c = d.comp.get(e.composer), p = d.parentOf(e);
    const sub = [e.kind === 'movement' && p ? workName(p) : '', catOf(e)].filter(Boolean).join(' · ');
    return { title: pieceName(e, false), subtitle: sub, composer: c.full + (lifeOf(c) ? ' (' + lifeOf(c) + ')' : '') };
  }
  function engraveFor(e) {
    if (L.prints.has(e.id)) return L.prints.get(e.id);
    const job = (async () => {
      const url = e.b ? 'scores/' + e.b + '.musicxml' + V : 'library/scores/' + e.s + V;
      const r = await fetch(url);
      if (!r.ok) throw new Error('The score could not be downloaded.');
      const xml = await FB.readScoreFile(new File([await r.blob()], url.split('/').pop().split('?')[0]));
      const W = await FB.loadEngine();
      const out = await FB.print.render(W, xml, printInfo(e), (svg, i, n) => { job.progress = [i + 1, n]; if (job.onPage) job.onPage(svg, i, n); });
      return { pages: out.pages.map((svg) => URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))), pdf: URL.createObjectURL(new Blob([out.pdf], { type: 'application/pdf' })) };
    })();
    job.catch(() => L.prints.delete(e.id));
    L.prints.set(e.id, job);
    return job;
  }
  function showPages(e, box) {
    box.textContent = '';
    const waiting = make('div', 'sheet-page is-waiting', 'Laying out the pages…', 'box');
    box.appendChild(waiting);
    const job = engraveFor(e);
    job.onPage = (svg, i, n) => { if (waiting.isConnected) waiting.textContent = 'Laying out page ' + (i + 1) + ' of ' + n + '…'; };
    job.then((out) => {
      if (!box.isConnected) return;
      box.textContent = '';
      out.pages.forEach((src, i) => {
        const pg = make('div', 'sheet-page');
        const img = make('img');
        img.src = src;
        img.alt = 'Page ' + (i + 1) + ' of ' + out.pages.length;
        pg.appendChild(img);
        box.appendChild(pg);
      });
      sceneV++; kick(200);
    }, (err) => { if (box.isConnected) { waiting.textContent = err.message || 'The pages could not be laid out.'; } });
  }
  async function savePdf(e) {
    const out = await engraveFor(e);
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
    /* the address names the view (#library/chopin/op-28/15), so a reload, a bookmark or a shared
       link comes back to it */
    if (L.open) history.replaceState(null, '', '#library' + hashOf(L.stack[L.stack.length - 1]));
    syncScopes();
    fitShelves();
    flushThumbs();
    requestAnimationFrame(pinCheck);
    sceneV++;
    kick(400);
  }
  const hashOf = (top) => (top.view === 'recent' ? '/recent' : top.view === 'pieces' ? '/' + top.id + '/~pieces' : top.view === 'works' ? '/' + top.id + '/~works' : top.id ? '/' + top.id : '');
  function push(item) {
    L.stack[L.stack.length - 1].top = el.scroll.scrollTop;
    if (L.query) clearQuery();
    L.stack.push(item);
    render(true);
    el.scroll.scrollTop = 0;
  }
  function go2(stack) {
    L.stack = stack;
    if (L.query) clearQuery();
    render(true);
    el.scroll.scrollTop = 0;
  }
  /* back: out of a search, up a level, or at the top back to the player */
  function back() {
    if (L.query) { clearQuery(); el.query.blur(); render(true); el.scroll.scrollTop = L.stack[L.stack.length - 1].top || 0; return; }
    if (L.stack.length < 2) { close(); return; }
    L.stack.pop();
    render(true);
    el.scroll.scrollTop = L.stack[L.stack.length - 1].top || 0;
  }
  function openEntry(e) {
    const d = L.data, f = d.fileOf(e);
    if (!f) return;
    const c = d.comp.get(f.composer), cat = catOf(f);
    if (f.b) FB.app.open({ kind: 'builtin', file: f.b });
    else FB.app.open({ kind: 'url', url: 'library/scores/' + f.s }, { id: 'cat:' + f.id, title: nameOf(f, true), composer: c.full + (cat ? ', ' + cat : '') });
    close();
  }

  /* ------------------------------------------------------------------ search */
  /* the search runs in a worker (js/search-worker.js); results come back as catalogue ids */
  const S = { worker: null, ready: false, seq: 0, asked: '', results: null };
  function startSearch() {
    if (S.worker || !window.Worker) return;
    try { S.worker = new Worker('js/search-worker.js' + V); } catch (e) { return; }
    S.worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'ready') S.ready = true;
      else if (m.type === 'found' && m.id === S.seq) {
        S.results = { q: S.asked, ids: m.ids };
        if (L.open && L.query.trim() === S.asked) render(false);
      }
    };
    S.worker.postMessage({ type: 'init', url: new URL('library/catalog.json' + V, location.href).href });
  }
  function ask(q) {
    startSearch();
    if (!S.worker || (S.asked === q && S.results && S.results.q === q)) return;
    S.asked = q;
    S.worker.postMessage({ type: 'find', id: ++S.seq, q, limit: 200 });
  }
  let searchTimer = 0;
  function onQuery() {
    const was = !!L.query.trim();
    L.query = el.query.value;
    el.clear.hidden = !L.query;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      if (!L.data) return;
      const now = !!L.query.trim();
      if (!was && now) L.stack[L.stack.length - 1].top = el.scroll.scrollTop;
      render(was !== now);
      el.scroll.scrollTop = now ? 0 : L.stack[L.stack.length - 1].top || 0;
    }, 90);
  }
  function clearQuery() { el.query.value = ''; L.query = ''; el.clear.hidden = true; }
  el.query.addEventListener('input', onQuery);
  el.query.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.query.blur(); });
  el.clear.addEventListener('click', (e) => { e.preventDefault(); clearQuery(); onQuery(); el.query.focus(); });
  /* the scopes in the glass layer: the same choice as Explore's tabs */
  function syncScopes() {
    for (const b of el.scopes.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.tab === L.tab));
    syncPills();
  }
  /* the tab bars' pills, on the chosen tab (their parts can change width with the screen). A bar
     just built, or just shown, gets its pill in place at once; after that the pill slides */
  function syncPills() {
    const i = TABS.indexOf(L.tab);
    for (const seg of el.lib.querySelectorAll('.seg.fit')) {
      if (!seg.offsetWidth) { seg._placed = false; continue; }
      if (seg._placed) { FB.placePill(seg, i); continue; }
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
  /* the on-screen keyboard: lift the search above it */
  if (window.visualViewport) {
    const vv = window.visualViewport;
    const lift = () => { const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop); el.lib.style.setProperty('--kb', (kb > 60 ? kb : 0) + 'px'); sceneV++; kick(400); };
    vv.addEventListener('resize', lift);
    vv.addEventListener('scroll', lift);
  }

  /* ------------------------------------------------------------------ glass */
  const css = {};
  function readTheme() {
    const cs = getComputedStyle(document.documentElement);
    for (const k of ['bg', 'stage', 'lane', 'rh', 'lh', 'now']) css[k] = cs.getPropertyValue('--' + k).trim();
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
      glass = new GL.GlassBackdrop({ root: () => el.lib, reducedTransparency: () => window.matchMedia('(prefers-contrast: more)').matches });
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
    glass.update(el.lib.clientWidth, el.lib.clientHeight, ms, paint, String(sceneV));
    if (ms < busyUntil) kick();
  }
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
    for (const n of el.page.querySelectorAll('[data-paint]')) {
      const r = n.getBoundingClientRect();
      if (!r.width || !bands.some((b) => r.right > b[0] && r.bottom > b[1] && r.left < b[2] && r.top < b[3])) continue;
      const x = r.left - root.left, y = r.top - root.top;
      if (n.tagName === 'CANVAS') { if (n.width) ctx.drawImage(n, x, y, r.width, r.height); continue; }
      const cs = getComputedStyle(n);
      if (n.dataset.paint === 'box') {
        ctx.fillStyle = cs.backgroundColor;
        rr(ctx, x, y, r.width, r.height, parseFloat(cs.borderTopLeftRadius) || 0);
        ctx.fill();
        continue;
      }
      const size = parseFloat(cs.fontSize);
      ctx.font = cs.fontWeight + ' ' + size + 'px ' + cs.fontFamily;
      ctx.fillStyle = cs.color;
      ctx.textBaseline = 'alphabetic';
      ctx.save();
      ctx.beginPath(); ctx.rect(x, y, r.width, r.height); ctx.clip();
      ctx.fillText(n.textContent, x, y + (Math.min(r.height, size * 1.5) + size * 0.7) / 2);
      ctx.restore();
    }
    /* black from `black` to `clear`, through the given stops ([position 0-1, how much shows]), as
       the CSS masks and covers do */
    const fade = (black, clear, fromTop, stops = []) => {
      const g = ctx.createLinearGradient(0, black, 0, clear);
      g.addColorStop(0, css.bg);
      for (const [at, shows] of stops) g.addColorStop(at, 'rgba(0,0,0,' + (1 - shows) + ')');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, Math.min(black, clear), root.width, Math.abs(clear - black));
      ctx.fillStyle = css.bg;
      if (fromTop) ctx.fillRect(0, 0, root.width, black); else ctx.fillRect(0, black, root.width, root.height - black);
    };
    /* Explore's pinned heading hides the list above its tabs */
    const head = el.page.querySelector('.explore-head.is-pinned');
    if (head) { const r = head.getBoundingClientRect(); fade(r.bottom - root.top - 12 - parseFloat(getComputedStyle(head.lastChild).height), r.bottom - root.top, true); }
    /* the same smooth S as the CSS mask (index.html .lib-scroll) */
    const S_CURVE = [[0.25, 0.156], [0.5, 0.5], [0.75, 0.844]];
    const back = el.back.getBoundingClientRect();
    if (!WIDE.matches && back.height) fade(back.top - root.top, back.bottom - root.top + 16, true, S_CURVE);
    const bar = el.bottom.getBoundingClientRect();
    if (bar.height) fade(bar.bottom - root.top, bar.top - 64 - root.top, false, S_CURVE);
  }
  /* from 872 px the back button sits beside the column (index.html .library) */
  const WIDE = window.matchMedia('(min-width: 872px)');
  /* the Explore heading is pinned once it reaches its place under the back button */
  /* measured on the layout (the scroll position against where the section starts), not on screen:
     a fresh page starts its entrance 12 px low, which would read as "not pinned yet" */
  function pinCheck() {
    const head = el.page.querySelector('.explore-head');
    if (!head) return;
    const b = el.back.getBoundingClientRect(), top = el.scroll.getBoundingClientRect().top;
    const stick = (WIDE.matches ? b.top : b.bottom + 16) - top;
    head.classList.toggle('is-pinned', el.scroll.scrollTop >= head.parentElement.offsetTop - stick - 0.5);
    sceneV++;
    kick();
  }
  el.scroll.addEventListener('scroll', () => { pinCheck(); sceneV++; kick(); }, { passive: true });
  el.page.addEventListener('scroll', () => { sceneV++; kick(); }, { passive: true, capture: true });
  el.lib.addEventListener('pointerdown', () => kick(500), true);
  el.lib.addEventListener('pointerup', () => kick(500), true);
  /* a press that slid off a tab without choosing it puts the pill back */
  for (const type of ['pointerup', 'pointercancel']) el.lib.addEventListener(type, () => setTimeout(syncPills, 200), true);
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
  function open() {
    if (L.open) return;
    L.open = true;
    el.lib.classList.remove('is-closing');
    el.lib.hidden = false;
    FB.app.covered(true);
    readTheme();
    initGlass();
    if (!L.data) load().then(() => { if (L.open) render(true); startSearch(); }, () => { if (L.open) render(false); });
    else startSearch();
    /* home shows the latest recents each time; anywhere else stays where it was */
    if (L.stack.length === 1 || !L.data) render(true);
    else { history.replaceState(null, '', '#library' + hashOf(L.stack[L.stack.length - 1])); kick(400); }
    requestAnimationFrame(pinCheck);
    kick(600);
  }
  function close() {
    if (!L.open) return;
    L.open = false;
    el.query.blur();
    el.lib.classList.add('is-closing');
    setTimeout(() => { if (!L.open) { el.lib.hidden = true; el.lib.classList.remove('is-closing'); } }, 200);
    history.replaceState(null, '', location.pathname + location.search);
    FB.app.covered(false);
    el.menuBtn.focus({ preventScroll: true });
  }
  el.back.addEventListener('click', back);
  el.file.addEventListener('change', () => { if (L.open && el.file.files && el.file.files.length) close(); }, true);
  document.addEventListener('keydown', (e) => {
    if (!L.open) return;
    const typing = e.target === el.query;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (!el.menu.hidden) closeMenu();
      else if (L.query) back();
      else if (typing) el.query.blur();
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
    open();
    load().then(() => { L.stack = stackFor(asked[1] && decodeURIComponent(asked[1])); if (L.open) render(true); }, () => {});
  } else if (FB.app && FB.app.firstVisit) open();
  else if ('requestIdleCallback' in window) requestIdleCallback(() => load().catch(() => {}));
})();
