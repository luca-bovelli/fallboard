/* Fallboard — print.js
   The sheet music as pages, for the piece page's preview and its PDF. Every piece gets the same
   layout, whatever the file it came from: A4, MuseScore's standard staff size (7 mm), even
   margins, the engine's own line breaks, and one title block written from the catalogue (the
   title with its nickname, the catalogue number, the composer with their dates). The file's own
   titles, credits, page settings and breaks are dropped, as for the screen engraving
   (engrave-core.js prepareXml).

     FB.print.render(WebMscore, xml, { title, subtitle, composer }, onPage)
       -> { pages: [svg, ...] (none when onPage takes them), pdf: Uint8Array } */
(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const api = factory(node ? require('./engrave-core.js') : root.FB && root.FB.engrave);
  if (node) module.exports = api;
  else (root.FB = root.FB || {}).print = api;
})(typeof self !== 'undefined' ? self : this, function (core) {
  'use strict';

  const PAGE = { w: 210, h: 297, margin: 15 };   // millimetres
  const TENTHS_PER_MM = 40 / 7;                    // a 7 mm staff is 40 tenths tall
  const t = (mm) => Math.round(mm * TENTHS_PER_MM);
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function defaults() {
    const m = t(PAGE.margin);
    return '<defaults><scaling><millimeters>7</millimeters><tenths>40</tenths></scaling>' +
      `<page-layout><page-height>${t(PAGE.h)}</page-height><page-width>${t(PAGE.w)}</page-width>` +
      `<page-margins type="both"><left-margin>${m}</left-margin><right-margin>${m}</right-margin>` +
      `<top-margin>${m}</top-margin><bottom-margin>${m}</bottom-margin></page-margins></page-layout></defaults>`;
  }

  /* the title block as credits with their roles: title centred at the top, the catalogue number
     under it, the composer on the right */
  function credits(info) {
    const top = t(PAGE.h - PAGE.margin), mid = Math.round(t(PAGE.w) / 2), right = t(PAGE.w - PAGE.margin);
    const one = (type, text, x, y, size, justify) => (text
      ? `<credit page="1"><credit-type>${type}</credit-type><credit-words default-x="${x}" default-y="${y}" justify="${justify}" valign="top" font-size="${size}">${esc(text)}</credit-words></credit>`
      : '');
    return one('title', info.title, mid, top, 22, 'center') +
      one('subtitle', info.subtitle, mid, top - 46, 13, 'center') +
      one('composer', info.composer, right, top - (info.subtitle ? 78 : 56), 11, 'right');
  }
  function prepare(xml, info) {
    let x = core.prepareXml(xml, 100);
    x = x.replace(/<identification>[\s\S]*?<\/identification>\s*/g, '');
    x = x.replace(/<defaults>[\s\S]*?<\/defaults>/, defaults() + credits(info));
    const head = `<movement-title>${esc(info.title)}</movement-title>` +
      `<identification><creator type="composer">${esc(info.composer || '')}</creator></identification>`;
    return x.replace(/(<score-(?:partwise|timewise)\b[^>]*>)/, '$1' + head);
  }

  /* onPage(svg, index, count), if given, receives each page as soon as it is drawn (so a long
     score shows its first pages at once), and the pages are not kept; without it they are
     returned. The PDF comes last. */
  async function render(WebMscore, xml, info, onPage) {
    const score = await WebMscore.load('musicxml', new TextEncoder().encode(prepare(xml, info)));
    try {
      const n = await score.npages();
      const pages = [];
      for (let i = 0; i < n; i++) {
        const svg = await score.saveSvg(i, true);
        if (onPage) onPage(svg, i, n); else pages.push(svg);
      }
      return { pages, pdf: await score.savePdf() };
    } finally {
      try { score.destroy(); } catch (e) { /* already gone */ }
    }
  }

  /* a long score's first page, from its opening bars alone (engrave-core.js truncateXml): drawn
     in a moment, while the whole score takes its time to lay out. Null when the opening fits on
     one page, whose layout could then differ from the whole's */
  async function first(WebMscore, xml, info, bars = 48) {
    const score = await WebMscore.load('musicxml', new TextEncoder().encode(core.truncateXml(prepare(xml, info), bars)));
    try {
      return (await score.npages()) > 1 ? await score.saveSvg(0, true) : null;
    } finally {
      try { score.destroy(); } catch (e) { /* already gone */ }
    }
  }

  return { PAGE, prepare, render, first };
});
