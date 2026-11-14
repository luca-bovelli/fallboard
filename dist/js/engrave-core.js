/* Fallboard — engrave-core.js
   Turns MusicXML into screen-width systems engraved by MuseScore (the webmscore build of its
   engine). Shared by the browser, for imported files, and by tools/engrave.js, which
   pre-engraves the built-in score.

   The score is re-flowed to a page as wide as the screen and only one system tall, so each
   "page" is one system: a strip that can be mounted on its own. The SVG is then compacted:
   repeated glyphs become <use> references into one shared table and colours become
   currentColor. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.FB = root.FB || {}).engrave = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* page widths in staff spaces; a staff is four spaces tall */
  const LAYOUTS = [
    { key: 'narrow', max: 560, wsp: 62 },
    { key: 'medium', max: 900, wsp: 96 },
    { key: 'wide', max: Infinity, wsp: 132 },
  ];
  const layoutFor = (cssWidth) => LAYOUTS.find((l) => cssWidth < l.max) || LAYOUTS[LAYOUTS.length - 1];

  const r1 = (v) => String(Math.round(v * 10) / 10);
  const NUM = /-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;

  /* MuseScore honours the page geometry written in the file, so the re-flow is done there:
     our own page size, and none of the source's system breaks or manual positions. */
  function prepareXml(xml, wsp) {
    let staves = 0;
    const partCount = (xml.match(/<part\s+id=/g) || []).length || 1;
    const declared = [...xml.matchAll(/<staves>\s*(\d+)\s*<\/staves>/g)].map((m) => +m[1]);
    staves = Math.max(partCount, declared.length ? declared.reduce((a, b) => Math.max(a, b), 1) + partCount - 1 : partCount);
    const hsp = Math.round(4 * staves + 6.5 * (staves - 1) + 10);
    const defaults =
      '<defaults><scaling><millimeters>7</millimeters><tenths>40</tenths></scaling>' +
      `<page-layout><page-height>${hsp * 10}</page-height><page-width>${wsp * 10}</page-width>` +
      '<page-margins type="both"><left-margin>12</left-margin><right-margin>12</right-margin>' +
      '<top-margin>20</top-margin><bottom-margin>20</bottom-margin></page-margins></page-layout></defaults>';
    let x = xml.replace(/<!DOCTYPE[^>]*>/i, '');
    x = x.replace(/<defaults>[\s\S]*?<\/defaults>\s*/, '');
    x = x.replace(/<credit[\s>][\s\S]*?<\/credit>\s*/g, '');
    /* MuseScore builds a title block from these when there are no credits; the app already shows the title */
    x = x.replace(/<work>[\s\S]*?<\/work>\s*/g, '');
    x = x.replace(/<(movement-title|movement-number|rights)\b[^>]*>[\s\S]*?<\/\1>\s*/g, '');
    x = x.replace(/<creator\b[^>]*>[\s\S]*?<\/creator>\s*/g, '');
    x = x.replace(/<print\b[^>]*\/>\s*/g, '').replace(/<print\b[^>]*>[\s\S]*?<\/print>\s*/g, '');
    x = x.replace(/\s(?:default-x|default-y|relative-x|relative-y|width)="[^"]*"/g, '');
    /* "Ped." and "*" written as loose symbols lose their place once the page is re-flowed, so
       they become pedal lines, which MuseScore positions itself under the bass staff */
    let down = false;
    x = x.replace(/<pedal\b([^>]*?)\/>/g, (all, a) => {
      const type = (/type="(\w+)"/.exec(a) || [])[1];
      if (type !== 'start' && type !== 'stop') return all;
      let out = type;
      if (type === 'start') { out = down ? 'change' : 'start'; down = true; }
      else if (!down) return '';
      else down = false;
      return `<pedal type="${out}" line="yes"/>`;
    });
    /* on a grand staff the pedal belongs under the lowest staff, wherever the file attached it */
    const lowest = declared.length ? declared.reduce((a, b) => Math.max(a, b), 1) : 1;
    if (partCount === 1 && lowest > 1) {
      x = x.replace(/<direction\b[^>]*>[\s\S]*?<\/direction>/g, (block) => {
        if (!block.includes('<pedal')) return block;
        let b = block.replace(/<staff>\s*\d+\s*<\/staff>/, '');
        const tag = `<staff>${lowest}</staff>`;
        b = b.includes('<sound') ? b.replace('<sound', tag + '<sound') : b.replace('</direction>', tag + '</direction>');
        return b.replace(/<direction\b[^>]*>/, '<direction placement="below">');
      });
    }
    if (/<part-list>/.test(x)) x = x.replace(/<part-list>/, defaults + '<part-list>');
    return x;
  }

  function attrs(s) {
    const o = {};
    for (const m of s.matchAll(/([\w:-]+)="([^"]*)"/g)) o[m[1]] = m[2];
    return o;
  }

  function extent(numbers, box) {
    for (let i = 0; i + 1 < numbers.length; i += 2) {
      const x = +numbers[i], y = +numbers[i + 1];
      if (x < box[0]) box[0] = x;
      if (y < box[1]) box[1] = y;
      if (x > box[2]) box[2] = x;
      if (y > box[3]) box[3] = y;
    }
    return box;
  }

  /* page numbers and bar numbers are drawn by the app, in its own type */
  const DROP = new Set(['Page', 'InstrumentName', 'MeasureNumber']);

  /* Which staff (so which hand) each element belongs to, for dimming the other hand: three
     layers, data-s="0" (right hand), "1" (left hand) and "n" (neutral). Barlines and the brace
     join both staves, so they are neutral and the app fades only their half on the other
     hand's side. Elements that hang off a note follow the nearest notehead; beams and flags
     follow the stems they touch; slurs and ties the note they start from; everything else
     (staff lines, clefs, signatures, rests, dynamics, tempo, pedal...) the nearer staff.
     Noteheads are tagged by the app, by the staff they sit on, the rule it matches them with. */
  const NEUTRAL = new Set(['BarLine', 'Bracket']);
  const ON_NOTE = new Set(['LedgerLine', 'Stem', 'Accidental', 'Articulation', 'NoteDot', 'Arpeggio', 'StemSlash', 'Fingering', 'Fermata', 'Tuplet', 'Tremolo', 'Glissando', 'GlissandoSegment']);
  const ON_STEMS = new Set(['Beam', 'Hook']);
  const FROM_START = new Set(['SlurSegment', 'TieSegment']);
  /* drawn in several parts (figure, line, hooks); the parts of one must not be split between hands */
  const MULTI = new Set(['OttavaSegment', 'PedalSegment', 'TextLineSegment', 'HairpinSegment', 'Tuplet']);

  function assignStaves(items, lines, sp) {
    const L = lines;
    if (L.length !== 10) return;
    const mid = (L[4] + L[5]) / 2, bands = [[L[0], L[4]], [L[5], L[9]]];
    const heads = [];
    for (const it of items) if (it.cls === 'Note' && it.head) heads.push({ x: it.head[0], y: it.head[1], s: it.head[1] > mid ? 1 : 0 });
    const toBox = (b, x, y) => Math.hypot(Math.max(b[0] - x, 0, x - b[2]), Math.max(b[1] - y, 0, y - b[3]));
    const nearestHead = (b) => {
      let best = null, bd = Infinity;
      for (const h of heads) { const d = toBox(b, h.x, h.y); if (d < bd) { bd = d; best = h; } }
      return best && bd < sp * 8 ? best.s : undefined;
    };
    const nearestBand = (b) => {
      const cy = (b[1] + b[3]) / 2;
      const d0 = Math.max(bands[0][0] - cy, 0, cy - bands[0][1]), d1 = Math.max(bands[1][0] - cy, 0, cy - bands[1][1]);
      return d1 < d0 ? 1 : 0;
    };
    const stems = [];
    for (const it of items) {
      if (it.cls === 'Note') continue;
      if (NEUTRAL.has(it.cls)) { it.staff = 'n'; continue; }
      if (!it.box) continue;
      if (ON_NOTE.has(it.cls)) it.staff = nearestHead(it.box);
      else if (FROM_START.has(it.cls) && it.start) it.staff = nearestHead([it.start[0], it.start[1], it.start[0], it.start[1]]);
      if (it.staff === undefined && !ON_STEMS.has(it.cls)) it.staff = nearestBand(it.box);
      if (it.cls === 'Stem' && it.staff !== undefined) stems.push(it);
    }
    for (const it of items) {
      if (!ON_STEMS.has(it.cls) || !it.box) continue;
      const b = it.box, votes = [0, 0];
      for (const st of stems) {
        const s = st.box;
        if (s[2] >= b[0] - sp * 0.4 && s[0] <= b[2] + sp * 0.4 && s[3] >= b[1] - sp * 0.6 && s[1] <= b[3] + sp * 0.6) votes[st.staff]++;
      }
      it.staff = votes[0] || votes[1] ? (votes[1] > votes[0] ? 1 : 0) : nearestHead(b);
      if (it.staff === undefined) it.staff = nearestBand(b);
    }

    const byCls = new Map();
    for (const it of items) if (MULTI.has(it.cls) && it.box) (byCls.get(it.cls) || byCls.set(it.cls, []).get(it.cls)).push(it);
    const near = (a, b) => a.box[0] - sp * 1.5 <= b.box[2] && b.box[0] - sp * 1.5 <= a.box[2] && a.box[1] - sp * 1.5 <= b.box[3] && b.box[1] - sp * 1.5 <= a.box[3];
    for (const [cls, list] of byCls) {
      const seen = new Set();
      for (const first of list) {
        if (seen.has(first)) continue;
        const parts = [first];
        seen.add(first);
        for (let k = 0; k < parts.length; k++) for (const o of list) if (!seen.has(o) && near(parts[k], o)) { seen.add(o); parts.push(o); }
        /* the nearer staff, weighted by the size of each part */
        let staff;
        {
          const votes = [0, 0];
          for (const p of parts) if (p.staff === 0 || p.staff === 1) votes[p.staff] += (p.box[2] - p.box[0]) + (p.box[3] - p.box[1]);
          staff = votes[1] > votes[0] ? 1 : 0;
        }
        for (const p of parts) p.staff = staff;
      }
    }
  }

  /* one MuseScore page -> { svg, w, right, y0, h, heads, lines } or null when the page is empty.
     Elements are grouped by class (and staff) so shared attributes are written once; noteheads
     stay in one group, in order, which is how the app tells them apart. */
  function compact(svg, glyphs, wsp) {
    const glyph = (key, d, sx, sy) => {
      let g = glyphs.map.get(key);
      if (!g) {
        const box = extent(d.match(NUM) || [], [Infinity, Infinity, -Infinity, -Infinity]);
        g = { id: 'fbg' + glyphs.map.size, box: [box[0] * sx, box[1] * sy, box[2] * sx, box[3] * sy] };
        const sc = sx === 1 && sy === 1 ? '' : Math.abs(sx - sy) < 1e-4 ? ` transform="scale(${+sx.toFixed(4)})"` : ` transform="scale(${+sx.toFixed(4)} ${+sy.toFixed(4)})"`;
        glyphs.map.set(key, g);
        glyphs.defs.push(`<path id="${g.id}"${sc} d="${d.replace(NUM, r1)}"/>`);
      }
      return g;
    };
    const items = [];
    const heads = [];
    const lines = [];
    const page = [Infinity, Infinity, -Infinity, -Infinity];
    const size = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
    const sp = (size ? +size[1] : 1000) / wsp;     // one staff space in SVG units
    for (const m of svg.matchAll(/<(path|polyline)\b([^>]*?)\/>/g)) {
      const a = attrs(m[2]);
      const cls = a.class || 'x';
      if (DROP.has(cls)) continue;
      let extra = a.stroke && a.stroke !== 'none' && a['stroke-width'] ? ` stroke-width="${r1(+a['stroke-width'])}"` : '';
      if (a.fill === 'none') extra += ' fill="none"';
      if (a['stroke-dasharray']) extra += ` stroke-dasharray="${a['stroke-dasharray'].replace(NUM, r1)}"`;
      if (a['stroke-linecap'] === 'round') extra += ' stroke-linecap="round"';

      if (m[1] === 'polyline') {
        const nums = (a.points || '').match(NUM) || [];
        const box = extent(nums, [Infinity, Infinity, -Infinity, -Infinity]);
        extent(nums, page);
        if (cls === 'StaffLines' && nums.length >= 4) lines.push(Math.round(+nums[1] * 10) / 10);
        items.push({ cls, extra, box, el: `<polyline points="${nums.map(r1).join(' ')}"/>` });
        continue;
      }

      const d = a.d || '';
      const t = a.transform ? (a.transform.match(NUM) || []).map(Number) : null;
      if (t && t.length === 6 && t[1] === 0 && t[2] === 0) {
        const g = glyph(d + '|' + t[0].toFixed(4) + '|' + t[3].toFixed(4), d, t[0], t[3]);
        const x = t[4], y = t[5];
        const box = [x + g.box[0], y + g.box[1], x + g.box[2], y + g.box[3]];
        extent(box, page);
        const it = { cls, extra, box, use: true, el: `<use href="#${g.id}" x="${r1(x)}" y="${r1(y)}"/>` };
        if (cls === 'Note') {
          it.head = [Math.round((x + (g.box[0] + g.box[2]) / 2) * 10) / 10, Math.round(y * 10) / 10];
          heads.push(it.head[0], it.head[1]);
        }
        items.push(it);
        continue;
      }
      const nums = d.match(NUM) || [];
      const box = t ? (t.length >= 6 ? [t[4], t[5], t[4], t[5]] : null) : extent(nums, [Infinity, Infinity, -Infinity, -Infinity]);
      if (!t) extent(nums, page);
      const start = !t && nums.length >= 2 ? [+nums[0], +nums[1]] : null;
      /* text set as outlines (dynamics, tuplet figures, tempo words): the same shape recurs at
         many positions, so store it once relative to its first point */
      if (!t && !extra && d.length > 160 && nums.length >= 4 && !/[HhVvAaSsQqTtmlc]/.test(d)) {
        const ox = +nums[0], oy = +nums[1];
        let i = 0;
        const rel = d.replace(NUM, (v) => r1(+v - (i++ % 2 ? oy : ox)));
        const g = glyph('rel|' + rel, rel, 1, 1);
        items.push({ cls, extra, box, start, use: true, el: `<use href="#${g.id}" x="${r1(ox)}" y="${r1(oy)}"/>` });
        continue;
      }
      const it = { cls, extra, box, start, el: `<path${a.transform ? ` transform="${a.transform}"` : ''} d="${d.replace(NUM, r1)}"/>` };
      if (t && cls === 'Note') { it.head = [t[4], t[5]]; heads.push(t[4], t[5]); }
      items.push(it);
    }
    if (!items.length || !(page[3] > page[1])) return null;
    const staffLines = [...new Set(lines)].sort((p, q) => p - q);
    assignStaves(items, staffLines, sp);

    const groups = new Map();
    for (const it of items) {
      const st = it.cls === 'Note' || it.staff === undefined ? '' : ` data-s="${it.staff}"`;
      const key = it.cls === 'Note' ? 'Note' : it.cls + it.extra + st;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { open: `<g class="${it.cls}"${it.cls === 'Note' ? '' : it.extra}${st}>`, items: [] }));
      g.items.push(it.el);
    }
    const pad = 10;
    const y0 = Math.floor(page[1] - pad), y1 = Math.ceil(page[3] + pad);
    let out = '';
    for (const g of groups.values()) out += g.open + g.items.join('') + '</g>';
    return {
      w: size ? Math.round(+size[1] * 10) / 10 : Math.ceil(page[2]),
      right: page[2],
      y0, h: y1 - y0,
      svg: out,
      heads,
      lines: staffLines,
    };
  }

  /* WebMscore: the loaded webmscore class (Node build or the browser's worker build) */
  async function engrave(WebMscore, xml, wsp, onProgress) {
    const data = new TextEncoder().encode(prepareXml(xml, wsp));
    const score = await WebMscore.load('musicxml', data);
    try {
      const n = await score.npages();
      const mp = await score.measurePositions();
      const glyphs = { map: new Map(), defs: [] };
      const pages = [];
      const pageMap = new Map();
      for (let i = 0; i < n; i++) {
        const pg = compact(await score.saveSvg(i, false), glyphs, wsp);
        if (pg) { pageMap.set(i, pages.length); pages.push(pg); }
        if (onProgress) onProgress((i + 1) / n);
      }
      if (!pages.length) throw new Error('This score could not be engraved.');
      const r = (v) => Math.round(v * 10) / 10;
      const meas = mp.elements
        .slice()
        .sort((a, b) => a.id - b.id)
        .map((e) => (pageMap.has(e.page) ? [pageMap.get(e.page), r(e.x), r(e.y), r(e.sx), r(e.sy)] : null));
      /* A bar too dense for the width runs past the page edge (MuseScore reports a justification
         error and leaves it). Such a system keeps its own, wider width, so the app draws it
         scaled down to fit the screen; every other system keeps the common staff size. */
      const w = pages[0].w, pad = (w / wsp) * 1.2;
      const fit = ({ w: _, right, ...p }) => (right > w + 1 ? { ...p, w: Math.ceil(right + pad) } : p);
      return { v: 2, wsp, w, defs: glyphs.defs.join(''), pages: pages.map(fit), meas };
    } finally {
      try { score.destroy(); } catch (e) { /* already gone */ }
    }
  }

  return { LAYOUTS, layoutFor, prepareXml, engrave };
});
