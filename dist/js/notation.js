/* Fallboard — notation.js
   The engraved score: MuseScore systems stacked as strips and mounted lazily, with a playback
   cursor, lit noteheads, tap-to-seek, and scrolling that detaches from / re-attaches to playback.

   MuseScore's SVG carries no note identities, so printed noteheads are matched to the parsed
   score by position: heads are assigned to bars by the bar boxes and to staves by height, then
   read left to right as time columns and bottom to top as pitches within a column. */
(function () {
  'use strict';
  const FB = (window.FB = window.FB || {});
  // webmscore 1.2.1 (MuseScore 4's engine as WebAssembly), shipped next to the page: it starts a
  // worker that fetches its .wasm and font pack from the same folder
  const ENGINE_URL = 'engine/webmscore.js';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const EPS = 1e-4;

  let enginePromise = null;
  function loadEngine() {
    if (enginePromise) return enginePromise;
    enginePromise = new Promise((resolve, reject) => {
      const fail = (msg) => { enginePromise = null; reject(new Error(msg)); };
      const s = document.createElement('script');
      s.src = ENGINE_URL;
      s.async = true;
      s.onerror = () => fail('The notation engine could not be downloaded. The falling-note view still works.');
      s.onload = () => {
        const W = window.WebMscore;
        if (!W) return fail('The notation engine did not start. The falling-note view still works.');
        Promise.resolve(W.ready).then(() => resolve(W), () => fail('The notation engine did not start. The falling-note view still works.'));
      };
      document.head.appendChild(s);
    });
    return enginePromise;
  }
  FB.loadEngine = loadEngine;   // the library's page previews and PDFs share the engine

  class Notation {
    constructor({ box, pages, onSeek, onStatus, onDetach, onChange }) {
      this.box = box;
      this.pagesEl = pages;
      this.onSeek = onSeek;
      this.onStatus = onStatus;
      this.onDetach = onDetach;
      this.onChange = onChange;
      this.visible = false;
      this.detached = false;
      this.hand = 'both';
      this.score = null;
      this.meta = null;
      this.token = 0;
      this.cache = new Map();     // layout key -> engraving, for the current score
      this.pending = new Map();   // layout key -> promise
      this.reset();

      this.defs = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      this.defs.setAttribute('aria-hidden', 'true');
      this.defs.setAttribute('class', 'glyphs');
      box.insertBefore(this.defs, box.firstChild);

      this.io = new IntersectionObserver((entries) => {
        for (const en of entries) {
          const i = +en.target.dataset.i;
          if (en.isIntersecting) this.mount(i);
          else if (i !== this.cursorPage) this.unmount(i);
        }
      }, { root: box, rootMargin: '100% 0px' });

      const userScroll = () => this.detach();
      box.addEventListener('wheel', userScroll, { passive: true });
      box.addEventListener('touchmove', userScroll, { passive: true });
      // dragging the scrollbar itself: the only pointer press that lands on the scroller outside its content
      box.addEventListener('pointerdown', (e) => { if (e.target === box && e.offsetX >= box.clientWidth) userScroll(); });
      box.addEventListener('keydown', (e) => { if (/^(Page|Arrow(Up|Down)|Home|End)/.test(e.key)) userScroll(); });
      pages.addEventListener('click', (e) => this.tap(e));
    }

    reset() {
      if (this.imgs) for (const e of this.imgs.values()) URL.revokeObjectURL(e.url);
      this.imgs = new Map();      // system index -> { img, ready, url }: copies for the glass to refract
      this.imgInk = '';
      this.svgs = new Map();      // system index -> its SVG with each notehead tagged by staff
      this.defMap = null;
      this.eng = null;
      this.layoutKey = null;
      this.sys = [];
      this.mounted = new Set();
      this.noteEls = [];
      this.cols = [];
      this.refs = [];
      this.byPage = [];
      this.lit = new Set();
      this.cursorPage = -1;
      this.scrollKey = null;
      this.forceScroll = false;
      this.stats = null;
    }

    setScore(score, meta) {
      this.token++;
      this.score = score;
      this.meta = meta;
      this.cache.clear();
      this.pending.clear();
      this.clearDom();
      this.reset();
      if (this.visible) this.ensure();
    }

    setHand(hand) { this.hand = hand; this.pagesEl.dataset.hand = hand; }

    show() { this.visible = true; this.box.hidden = false; this.ensure(); this.attach(); }
    hide() { this.visible = false; this.box.hidden = true; }

    /* the reader took over the scrolling: stop following playback */
    detach() {
      if (this.eng && !this.detached) { this.detached = true; this.onDetach(true); }
    }

    /* the bar printed first in the system at the top of the view */
    barAtTop() {
      if (!this.eng || !this.score.docNumbers) return null;
      const top = this.box.scrollTop + (this.topInset || 0);
      for (let i = 0; i < this.sys.length; i++) {
        const d = this.sys[i];
        if (d.offsetTop + d.offsetHeight > top) {
          for (let j = i; j >= 0; j--) if (this.firstBar[j] >= 0) return this.score.docNumbers[this.firstBar[j]];
          return null;
        }
      }
      return null;
    }

    attach() {
      this.forceScroll = true;
      if (this.detached) { this.detached = false; this.onDetach(false); }
    }

    clearDom() {
      this.io.disconnect();
      this.pagesEl.textContent = '';
    }

    layout() {
      const stage = this.box.parentElement;
      const width = Math.min(1180, (this.box.clientWidth || (stage && stage.clientWidth) || 0));
      if (!width) return null;
      const L = FB.engrave.LAYOUTS;
      let i = L.indexOf(FB.engrave.layoutFor(width));
      // a phone on its side has little height: a smaller staff keeps a whole system in view
      if (stage && stage.clientHeight < 280 && i < L.length - 1) i++;
      return L[i];
    }

    /* fetch (or engrave) the notation for a layout; resolves to the engraving */
    fetchEngraving(layout, background) {
      if (this.cache.has(layout.key)) return Promise.resolve(this.cache.get(layout.key));
      if (this.pending.has(layout.key)) return this.pending.get(layout.key);
      const meta = this.meta, score = this.score, token = this.token;
      const say = (msg) => { if (!background && token === this.token && this.visible) this.onStatus(msg); };
      const job = (async () => {
        let eng = null;
        if (meta.engraved) {
          say('Opening the score…');
          try {
            const r = await fetch(meta.engraved.replace('{layout}', layout.key));
            if (r.ok) eng = await r.json();
          } catch (e) { eng = null; }
        }
        if (!eng) {
          say('Fetching the engraver…');
          const W = await loadEngine();
          say('Engraving the score…');
          // the engine runs in a worker and stays silent if it fails to start, so give it a deadline
          let timer;
          const late = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('The engraver did not respond. The falling-note view still works.')), 120000); });
          try { eng = await Promise.race([FB.engrave.engrave(W, score.xml, layout.wsp), late]); } finally { clearTimeout(timer); }
        }
        if (token === this.token) this.cache.set(layout.key, eng);
        return eng;
      })();
      this.pending.set(layout.key, job);
      const clearPending = () => {
        if (this.pending.get(layout.key) === job) this.pending.delete(layout.key);
      };
      job.then(clearPending, clearPending);
      return job;
    }

    /* warm the cache while the roll is on screen, so switching views is instant */
    preload() {
      if (!this.score || !this.meta || !this.meta.engraved) return;
      const layout = this.layout();
      if (layout) this.fetchEngraving(layout, true).catch(() => {});
    }

    async ensure() {
      if (!this.score || !this.visible) return;
      const layout = this.layout();
      if (!layout || (this.eng && this.layoutKey === layout.key)) return;
      const token = this.token;
      try {
        const eng = await this.fetchEngraving(layout, false);
        if (token !== this.token || !this.visible) return;
        const now = this.layout();
        if (now && now.key !== layout.key) { this.ensure(); return; }
        this.install(eng, layout.key);
        this.onStatus(null);
      } catch (e) {
        if (token === this.token) this.onStatus(e.message || 'The score could not be engraved.', true);
      }
    }

    install(eng, key) {
      this.clearDom();
      this.reset();
      this.eng = eng;
      this.layoutKey = key;
      this.pagesEl.style.setProperty('--sp', (this.pagesEl.clientWidth - 12) / eng.wsp + 'px');
      this.defs.innerHTML = '<defs>' + eng.defs + '</defs>';
      this.match();
      const firstBar = eng.pages.map(() => -1);
      eng.meas.forEach((m, di) => { if (m && firstBar[m[0]] < 0) firstBar[m[0]] = di; });
      this.firstBar = firstBar;
      this.sys = eng.pages.map((p, i) => {
        const d = document.createElement('div');
        d.className = 'sys';
        d.dataset.i = i;
        d.style.aspectRatio = `${p.w || eng.w} / ${p.h}`;
        this.pagesEl.appendChild(d);
        this.io.observe(d);
        return d;
      });
      this.forceScroll = true;
      if (this.onChange) this.onChange();
    }

    /* printed noteheads -> parsed notes, and the time columns of every bar */
    match() {
      const eng = this.eng, sc = this.score;
      const nM = eng.meas.length;
      const onPage = eng.pages.map(() => []);
      eng.meas.forEach((m, di) => { if (m) onPage[m[0]].push(di); });
      for (const list of onPage) list.sort((a, b) => eng.meas[a][1] - eng.meas[b][1]);

      /* which staff a height belongs to: boundaries halfway between neighbouring staves */
      const staffOf = (p, y) => {
        let s = 0;
        for (let i = 5; i < p.lines.length; i += 5) if (y > (p.lines[i - 1] + p.lines[i]) / 2) s = i / 5;
        return s;
      };
      const found = Array.from({ length: nM }, () => []);
      eng.pages.forEach((p, pi) => {
        const list = onPage[pi];
        if (!list.length) return;
        for (let k = 0; k * 2 < p.heads.length; k++) {
          const x = p.heads[k * 2], y = p.heads[k * 2 + 1];
          let di = list[0];
          for (const c of list) { if (eng.meas[c][1] <= x + 1) di = c; else break; }
          found[di].push({ page: pi, k, x, y, staff: staffOf(p, y) });
        }
      });

      /* staves in score order, so a parsed (part, staff) can be compared with a printed staff */
      const trackSet = new Set();
      for (const hs of sc.docHeads || []) for (const h of hs) trackSet.add(h.part * 100 + h.staff);
      const tracks = [...trackSet].sort((a, b) => a - b);
      const trackOf = (h) => tracks.indexOf(h.part * 100 + h.staff);

      /* pair one bar's printed heads with its parsed heads: left to right by time column,
         bottom to top by pitch within a column */
      const pair = (S, E, out) => {
        const groups = new Map();
        for (const h of E) { if (!groups.has(h.col)) groups.set(h.col, []); groups.get(h.col).push(h); }
        const sorted = S.slice().sort((a, b) => a.x - b.x);
        let pos = 0;
        for (const key of [...groups.keys()].sort((a, b) => a - b)) {
          const grp = groups.get(key).sort((a, b) => trackOf(b) - trackOf(a) || a.dstep - b.dstep || a.midi - b.midi);
          const sl = sorted.slice(pos, pos + grp.length).sort((a, b) => b.y - a.y || a.x - b.x);
          pos += grp.length;
          grp.forEach((h, j) => out.push({ h, s: sl[j] }));
        }
      };

      const stats = { bars: nM, matched: 0, byStaff: 0, miscounted: [] };
      this.byPage = eng.pages.map(() => []);
      const sameBars = sc.docHeads && sc.docHeads.length === nM;
      for (let di = 0; di < nM; di++) {
        this.cols[di] = [];
        this.refs[di] = [];
        const S = found[di];
        const E = sameBars ? sc.docHeads[di] : null;
        if (!E || !S.length) continue;
        if (S.length !== E.length) { stats.miscounted.push(di); continue; }
        const pairs = [];
        /* staff by staff when the counts agree (the usual case); otherwise all staves at once */
        const nS = Math.max(tracks.length, 1);
        const sBy = Array.from({ length: nS }, () => []), eBy = Array.from({ length: nS }, () => []);
        for (const s of S) (sBy[s.staff] || sBy[nS - 1]).push(s);
        for (const h of E) eBy[Math.max(0, trackOf(h))].push(h);
        if (sBy.every((list, i) => list.length === eBy[i].length)) {
          for (let i = 0; i < nS; i++) pair(sBy[i], eBy[i], pairs);
          stats.byStaff++;
        } else pair(S, E, pairs);
        stats.matched++;
        const colX = new Map();
        for (const { h, s } of pairs) {
          this.refs[di].push({ h, page: s.page, k: s.k });
          this.byPage[s.page].push({ x: s.x, y: s.y, q: h.q, di });
          if (!colX.has(h.q)) colX.set(h.q, []);
          colX.get(h.q).push(s.x);
        }
        const cols = [...colX].map(([q, xs]) => {
          xs.sort((a, b) => a - b);
          return { q, x: xs[xs.length >> 1] };
        }).sort((a, b) => a.q - b.q);
        // a cursor only ever moves forward within a bar
        for (let i = 1; i < cols.length; i++) if (cols[i].x < cols[i - 1].x) { cols[i].x = cols[i - 1].x; stats.inversions = (stats.inversions || 0) + 1; }
        this.cols[di] = cols;
      }
      this.onPage = onPage;
      this.stats = stats;
    }

    mount(i) {
      if (this.mounted.has(i) || !this.eng) return;
      const eng = this.eng, p = eng.pages[i], d = this.sys[i];
      const pw = p.w || eng.w;
      let html = `<svg viewBox="0 ${p.y0} ${pw} ${p.h}" fill="currentColor" aria-hidden="true">${this.svgFor(i)}</svg>`;
      const fb = this.firstBar[i];
      if (fb >= 0 && this.score.docNumbers && this.score.docNumbers[fb] !== undefined && p.lines.length) {
        const m = eng.meas[fb];
        const top = ((p.lines[0] - p.y0) / p.h) * 100;
        html += `<span class="barno" style="left:${((m[1] / pw) * 100).toFixed(2)}%;top:${top.toFixed(2)}%">${this.score.docNumbers[fb]}</span>`;
      }
      html += '<div class="cursor" hidden></div>';
      d.innerHTML = html;
      // noteheads by their index in the engraving, whichever hand's layer they were moved to
      const heads = d.querySelectorAll('g.Note > *');
      let els = heads;
      if (heads.length && heads[0].hasAttribute('data-k')) { els = []; for (const el of heads) els[+el.getAttribute('data-k')] = el; }
      this.noteEls[i] = els;
      this.mounted.add(i);
      if (this.onChange) this.onChange();
    }

    /* A system's SVG, arranged for hand focus. The engraving tags each group with the hand it
       belongs to (data-s "0" right, "1" left, "n" both: barlines and the brace); noteheads are
       split here by the staff they sit on, the rule match() uses, each keeping its index in
       data-k. The groups are then gathered into one layer per hand, so fading a hand fades its
       layer as a whole: overlapping marks (a stem over its notehead, a beam over its stems) do
       not stack up where they cross. Neutral marks stay at full strength. */
    svgFor(i) {
      let svg = this.svgs.get(i);
      if (svg !== undefined) return svg;
      const p = this.eng.pages[i];
      svg = p.svg;
      if (this.score.hasHands && p.lines.length === 10) {
        const mid = (p.lines[4] + p.lines[5]) / 2, heads = p.heads;
        const layer = { n: '', 0: '', 1: '' };
        for (const g of svg.matchAll(/<g\b([^>]*)>([\s\S]*?)<\/g>/g)) {
          const attrs = g[1], inner = g[2];
          if (/class="Note"/.test(attrs)) {
            const items = inner.match(/<(use|path)\b[^>]*\/>/g) || [];
            if (items.length * 2 !== heads.length) { layer.n += g[0]; continue; }
            const byStaff = ['', ''];
            items.forEach((el, k) => { byStaff[heads[2 * k + 1] > mid ? 1 : 0] += el.replace(/^<(use|path)\b/, `$& data-k="${k}"`); });
            for (const s of [0, 1]) if (byStaff[s]) layer[s] += '<g class="Note">' + byStaff[s] + '</g>';
            continue;
          }
          const s = (/data-s="(\w)"/.exec(attrs) || [])[1];
          layer[s === '0' || s === '1' ? s : 'n'] += g[0];
        }
        svg = `<g data-layer="n">${layer.n}</g><g data-layer="0">${layer[0]}</g><g data-layer="1">${layer[1]}</g>`;
      }
      this.svgs.set(i, svg);
      return svg;
    }

    /* One system as a bitmap. The glass controls cannot sample the page itself, so the systems
       that pass under them are drawn a second time into the scene they refract. */
    image(i, inkColour) {
      if (this.noImages) return null;
      const ink = inkColour + '|' + this.hand;
      if (this.imgInk !== ink) {
        for (const e of this.imgs.values()) URL.revokeObjectURL(e.url);
        this.imgs.clear();
        this.imgInk = ink;
      }
      let e = this.imgs.get(i);
      if (!e) {
        const eng = this.eng, p = eng.pages[i];
        if (!this.defMap) {
          this.defMap = new Map();
          for (const m of eng.defs.matchAll(/<path id="(fbg\d+)"[^>]*\/>/g)) this.defMap.set(m[1], m[0]);
        }
        const need = new Set();
        for (const m of p.svg.matchAll(/href="#(fbg\d+)"/g)) need.add(m[1]);
        const other = this.hand === 'R' ? 1 : this.hand === 'L' ? 0 : -1;
        const fade = other < 0 ? '' : `[data-layer="${other}"]{opacity:.2}`;
        let defs = '';
        for (const id of need) defs += this.defMap.get(id) || '';
        const px = clamp(Math.round((this.sys[i].clientWidth || 800) * 1.5), 300, 2400);
        const pw = p.w || eng.w;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 ${p.y0} ${pw} ${p.h}" width="${px}" height="${Math.max(1, Math.round((px * p.h) / pw))}" fill="${inkColour}" color="${inkColour}">` +
          `<style>g[stroke-width]{stroke:${inkColour}}polyline{fill:none}${fade}</style><defs>${defs}</defs>${this.svgFor(i)}</svg>`;
        const img = new Image();
        e = { img, ready: false, url: URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })) };
        img.onload = () => {
          // a browser that treats SVG images as foreign would poison the scene: check once, then never draw them
          if (this.imageSafe === undefined) {
            try {
              const c = document.createElement('canvas');
              c.width = c.height = 1;
              const x = c.getContext('2d');
              x.drawImage(img, 0, 0, 1, 1);
              x.getImageData(0, 0, 1, 1);
              this.imageSafe = true;
            } catch (err) { this.imageSafe = false; this.noImages = true; }
          }
          e.ready = true;
          if (this.onChange) this.onChange();
        };
        img.src = e.url;
        this.imgs.set(i, e);
        if (this.imgs.size > 10) {
          const k = this.imgs.keys().next().value;
          URL.revokeObjectURL(this.imgs.get(k).url);
          this.imgs.delete(k);
        }
      }
      return e.ready && !this.noImages ? e.img : null;
    }

    /* paint the part of the page that lies under the glass: sr is the stage's box, bands the
       vertical extents (viewport pixels) of the controls */
    paint(ctx, sr, bands, theme) {
      if (!this.eng || !this.visible) return;
      const pr = this.pagesEl.getBoundingClientRect();
      ctx.fillStyle = theme.paper;
      ctx.fillRect(pr.left - sr.left, Math.max(0, pr.top - sr.top), pr.width, sr.height);
      for (const i of this.mounted) {
        const r = this.sys[i].getBoundingClientRect();
        if (r.bottom < sr.top || r.top > sr.bottom) continue;
        if (!bands.some(([a, b]) => r.bottom > a && r.top < b)) continue;
        const x = r.left - sr.left, y = r.top - sr.top;
        const p = this.eng.pages[i];
        const img = this.image(i, theme['score-ink']);
        if (img) ctx.drawImage(img, x, y, r.width, r.height);
        else {
          // until the bitmap is ready: the staff lines alone
          ctx.fillStyle = theme['score-ink'];
          for (const ly of p.lines) ctx.fillRect(x + r.width * 0.06, y + ((ly - p.y0) / p.h) * r.height, r.width * 0.93, 1);
        }
      }
    }

    /* is any printed notehead behind this screen rectangle? Worked out from the engraving's own
       notehead positions: one box measured per system on screen, the rest is arithmetic */
    hasNoteBehind(readout) {
      const eng = this.eng;
      if (!eng) return false;
      const sp = eng.w / eng.wsp, hw = sp * 0.65, hh = sp * 0.5;
      for (const i of this.mounted) {
        const r = this.sys[i].getBoundingClientRect();
        if (r.bottom < readout.top - 8 || r.top > readout.bottom + 8 || !r.width) continue;
        const p = eng.pages[i], k = (p.w || eng.w) / r.width;
        const x0 = (readout.left - 2 - r.left) * k - hw, x1 = (readout.right + 2 - r.left) * k + hw;
        const y0 = p.y0 + (readout.top - 2 - r.top) * k - hh, y1 = p.y0 + (readout.bottom + 2 - r.top) * k + hh;
        const heads = p.heads;
        for (let j = 0; j < heads.length; j += 2) {
          if (heads[j] > x0 && heads[j] < x1 && heads[j + 1] > y0 && heads[j + 1] < y1) return true;
        }
      }
      return false;
    }

    unmount(i) {
      if (!this.mounted.has(i)) return;
      for (const el of this.lit) if (el.ownerSVGElement && this.sys[i].contains(el)) this.lit.delete(el);
      this.sys[i].textContent = '';
      this.noteEls[i] = null;
      this.mounted.delete(i);
      if (this.onChange) this.onChange();
    }

    /* where a score time sits on the page: bar, position in the bar, and x in page units */
    locate(t, playing) {
      const sc = this.score, eng = this.eng;
      const o = sc.measures[sc.measureAt(t)];
      const box = eng.meas[o.doc];
      if (!box) return null;
      const q = clamp(sc.secToBeat(t) - o.beat, 0, o.lenQ);
      const cols = this.cols[o.doc] || [];
      const end = box[1] + box[3];
      let x;
      if (!cols.length) x = box[1] + (o.lenQ > 0 ? q / o.lenQ : 0) * box[3];
      else {
        let k = -1;
        for (let i = 0; i < cols.length; i++) { if (cols[i].q <= q + 2e-3) k = i; else break; }
        if (k < 0) x = cols[0].x;
        else {
          x = cols[k].x;
          if (playing) {
            const nq = k + 1 < cols.length ? cols[k + 1].q : o.lenQ;
            const nx = k + 1 < cols.length ? cols[k + 1].x : end;
            if (nq > cols[k].q) x += (nx - x) * clamp((q - cols[k].q) / (nq - cols[k].q), 0, 1);
          }
        }
      }
      return { di: o.doc, q, x, box };
    }

    update(t, playing) {
      if (!this.eng || !this.visible) return;
      const eng = this.eng;
      const at = this.locate(t, playing);
      if (!at) { this.hideCursor(); return; }
      const p = at.box[0];
      if (!this.detached && !this.mounted.has(p)) this.mount(p);

      /* lit noteheads: every printed note whose written span covers this moment */
      const act = new Set();
      for (const r of this.refs[at.di] || []) {
        const h = r.h;
        if (h.q > at.q + 2e-3 || at.q >= h.q + h.dur - 2e-3) continue;
        if (this.hand !== 'both' && (this.hand === 'R') !== (h.hand === 0)) continue;
        const els = this.noteEls[r.page];
        const el = els && els[r.k];
        if (!el) continue;
        act.add(el);
        if (!this.lit.has(el)) { el.setAttribute('class', h.hand === 0 ? 'on r' : 'on l'); this.lit.add(el); }
      }
      for (const el of this.lit) if (!act.has(el)) { el.removeAttribute('class'); this.lit.delete(el); }

      /* cursor */
      if (!this.mounted.has(p)) { this.hideCursor(); return; }
      if (this.cursorPage !== p) { this.hideCursor(); this.cursorPage = p; }
      const pg = eng.pages[p];
      const c = this.sys[p].lastElementChild;
      const pad = at.box[4] * 0.1;
      const y0 = (at.box[2] - pad - pg.y0) / pg.h, y1 = (at.box[2] + at.box[4] + pad - pg.y0) / pg.h;
      if (c && c.className === 'cursor') {
        c.hidden = false;
        c.style.left = ((at.x / (pg.w || eng.w)) * 100).toFixed(3) + '%';
        c.style.top = (y0 * 100).toFixed(2) + '%';
        c.style.height = ((y1 - y0) * 100).toFixed(2) + '%';
      }

      /* keep the current system in view while attached */
      if (!this.detached && (this.forceScroll || p !== this.scrollKey)) {
        const d = this.sys[p];
        const top = d.offsetTop, bottom = top + d.offsetHeight;
        const view = this.box.clientHeight;
        // the system sits clear of the controls floating over the top of the page
        const target = Math.max(0, bottom - top > view * 0.8 ? top - 8 : top - Math.max(view * 0.14, this.topInset || 0));
        if (Math.abs(target - this.box.scrollTop) > 4) {
          const far = Math.abs(target - this.box.scrollTop) > view * 2.5;
          const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          this.box.scrollTo({ top: target, behavior: far || calm ? 'auto' : 'smooth' });
        }
        this.forceScroll = false;
      }
      this.scrollKey = p;
    }

    hideCursor() {
      if (this.cursorPage >= 0 && this.mounted.has(this.cursorPage)) {
        const c = this.sys[this.cursorPage].lastElementChild;
        if (c && c.className === 'cursor') c.hidden = true;
      }
    }

    tap(e) {
      if (!this.eng) return;
      const d = e.target.closest ? e.target.closest('.sys') : null;
      if (!d) return;
      const i = +d.dataset.i, eng = this.eng, pg = eng.pages[i], sc = this.score;
      const r = d.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * (pg.w || eng.w);
      const y = pg.y0 + ((e.clientY - r.top) / r.height) * pg.h;
      /* the nearest notehead wins; a tap in open space falls back to the bar under the finger */
      let di = -1, q = 0, best = 60 * 60;
      for (const h of this.byPage[i] || []) {
        const dx = h.x - x, dy = (h.y - y) * 0.45;
        const dist = dx * dx + dy * dy;
        if (dist < best) { best = dist; di = h.di; q = h.q; }
      }
      if (di < 0) {
        for (const c of this.onPage[i] || []) if (eng.meas[c][1] <= x) di = c;
        if (di < 0) return;
        const m = eng.meas[di];
        const cols = this.cols[di];
        if (cols.length) {
          let bd = Infinity;
          for (const c of cols) if (Math.abs(c.x - x) < bd) { bd = Math.abs(c.x - x); q = c.q; }
        } else q = clamp((x - m[1]) / m[3], 0, 1) * (sc.docMeasureLen[di] || 0);
      }
      const beats = sc.docBeats[di];
      if (!beats || !beats.length) return;
      const cur = this.now ? this.now() : 0;
      let beat = beats[0];
      for (const b of beats) if (Math.abs(sc.beatToSec(b) - cur) < Math.abs(sc.beatToSec(beat) - cur)) beat = b;
      this.onSeek(sc.beatToSec(beat + Math.max(0, q) + EPS));
    }
  }

  FB.Notation = Notation;
})();
