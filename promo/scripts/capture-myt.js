'use strict';
/* Captures YouTube's iPhone web page for the TikTok cut (promo/_src/myt/): the page around the
   player as static HTML with every element's computed style inlined, its images downloaded beside
   it, the player left as an empty slot (the film draws its own). Local only: the result is
   Rousseau's page, kept with the other private sources (promo/scripts/src-assets.sh).

   node promo/scripts/capture-myt.js */
const fs = require('fs');
const path = require('path');
const { launchBrowser } = require('./browser');

const OUT = path.join(__dirname, '..', '_src', 'myt');
const IPHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1' };

(async () => {
  fs.mkdirSync(path.join(OUT, 'img'), { recursive: true });
  const b = await launchBrowser();
  const ctx = await b.newContext({ ...IPHONE, locale: 'en-US', colorScheme: 'dark' });
  await ctx.addCookies([{ name: 'SOCS', value: 'CAESEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg', domain: '.youtube.com', path: '/' }, { name: 'PREF', value: 'hl=en&gl=US', domain: '.youtube.com', path: '/' }]);
  await ctx.route(/doubleclick|googleads|pagead|ad_status|\/api\/stats\/ads/, (r) => r.abort());
  const p = await ctx.newPage();
  await p.goto('https://m.youtube.com/watch?v=g1uLrHq9TDg&t=48&hl=en&gl=US', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForTimeout(9000);
  await p.evaluate(() => { const v = document.querySelector('video'); if (v) v.pause(); window.scrollTo(0, 0); });
  await p.waitForTimeout(800);
  await p.screenshot({ path: path.join(OUT, 'reference.png') });

  const snap = await p.evaluate(() => {
    const player = document.querySelector('#player-container-id') || document.querySelector('ytm-player') || document.querySelector('#player');
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    const blank = frame.contentDocument;
    const cache = new Map();
    const defaults = (tag, svg) => {
      const k = (svg ? 'svg:' : '') + tag;
      if (!cache.has(k)) {
        const el = svg ? blank.createElementNS('http://www.w3.org/2000/svg', tag) : blank.createElement(tag);
        blank.body.appendChild(el);
        const cs = frame.contentWindow.getComputedStyle(el), o = {};
        for (const pr of cs) o[pr] = cs.getPropertyValue(pr);
        cache.set(k, o);
      }
      return cache.get(k);
    };
    const imgs = [];
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const attr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const SKIP = new Set(['script', 'style', 'link', 'meta', 'noscript', 'template', 'iframe', 'video']);
    // an element that holds text itself is left to size to it (the browser's own metrics), and keeps its
    // line clamp
    const SIZE = new Set(['width', 'inline-size', 'min-width', 'min-inline-size']);
    const styleOf = (el, svg) => {
      const cs = getComputedStyle(el), d = defaults(el.localName, svg);
      const text = !svg && [...el.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
      let st = '';
      if (cs.webkitLineClamp && cs.webkitLineClamp !== 'none' && cs.display !== 'inline') st += `display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:${cs.webkitLineClamp};overflow:hidden;`;
      for (const pr of cs) {
        if (pr.startsWith('--') || pr === 'transition' || pr.startsWith('transition-') || pr.startsWith('animation')) continue;
        if (text && SIZE.has(pr) && cs.overflow !== 'hidden') continue;
        // the page as it was drawn: its Roboto web font only in bold; the rest fell back to Arial
        if (pr === 'font-family' && /Roboto/.test(cs.fontFamily)) { st += `font-family:${+cs.fontWeight >= 600 ? 'YTRoboto, Arial' : 'Arial'}, sans-serif;`; continue; }
        let v = cs.getPropertyValue(pr);
        if (v === d[pr]) continue;
        if (/url\(/.test(v)) v = v.replace(/url\("?([^")]+)"?\)/g, (m, u) => { imgs.push(u); return `url("@@IMG${imgs.length - 1}@@")`; });
        st += `${pr}:${v};`;
      }
      // text that sat on one line stays on one line
      if (!svg && !/flex|grid/.test(cs.display)) { const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3, h = el.getBoundingClientRect().height; if (h > 0 && h <= lh * 1.6) st += 'white-space:nowrap;'; }
      return st;
    };
    const ser = (n, svg) => {
      if (n.nodeType === 3) return esc(n.textContent);
      if (n.nodeType !== 1) return '';
      const tag = n.localName;
      if (SKIP.has(tag)) return '';
      if (n === player) return '';   // fixed over its placeholder: the film draws its own player there
      if (tag === 'canvas') {
        // the ambient glow behind the title is drawn from the video on canvases: keep them as pictures
        try { imgs.push(n.toDataURL('image/png')); return `<img src="@@IMG${imgs.length - 1}@@" alt="" style="${attr(styleOf(n, false))}">`; } catch (e) { return ''; }
      }
      const inSvg = svg || tag === 'svg';
      const cs = getComputedStyle(n);
      if (!inSvg && cs.display === 'none') return '';
      const r = n.getBoundingClientRect();
      if (!inSvg && r.top > 1000 && cs.position !== 'fixed') return '';
      let a = '';
      if (inSvg) for (const at of n.attributes) { if (at.name !== 'style' && at.name !== 'class') a += ` ${at.name}="${attr(at.value)}"`; }
      if (tag === 'img') { imgs.push(n.currentSrc || n.src); a += ` src="@@IMG${imgs.length - 1}@@" alt=""`; }
      const st = styleOf(n, inSvg);
      let kids = '';
      for (const c of (n.shadowRoot ? n.shadowRoot.childNodes : n.childNodes)) kids += ser(c, inSvg);
      if (!inSvg) {
        // ::before and ::after, as spans of their own
        const pseudo = (which) => {
          const ps = getComputedStyle(n, which), d = defaults('span', false);
          if (!ps.content || ps.content === 'none' || ps.content === 'normal') return '';
          let st = '';
          for (const pr of ps) { if (pr.startsWith('--') || pr.startsWith('transition') || pr.startsWith('animation') || pr === 'content') continue; const v = ps.getPropertyValue(pr); if (v !== d[pr]) st += `${pr}:${v};`; }
          const txt = /^".*"$/.test(ps.content) ? ps.content.slice(1, -1) : '';
          return `<span style="${attr(st)}">${esc(txt)}</span>`;
        };
        kids = pseudo('::before') + kids + pseudo('::after');
      }
      return `<${tag}${a} style="${attr(st)}">${kids}</${tag}>`;
    };
    const sheets = [...document.querySelectorAll('link[rel=stylesheet]')].map((l) => l.href);
    const inline = [...document.querySelectorAll('style')].map((x) => x.textContent).join('\n');
    const root = document.body;
    const html = `<div style="${attr(styleOf(root, false))}">${[...root.childNodes].map((c) => ser(c, false)).join('')}</div>`;
    frame.remove();
    return { html, imgs, sheets, inline };
  });

  // the images, beside the page
  const map = {};
  for (let i = 0; i < snap.imgs.length; i++) {
    const u = snap.imgs[i];
    if (!u || u.startsWith('data:')) { map[i] = u || ''; continue; }
    try {
      const res = await p.request.get(u);
      const ct = res.headers()['content-type'] || '';
      const ext = ct.includes('png') ? 'png' : ct.includes('svg') ? 'svg' : ct.includes('webp') ? 'webp' : 'jpg';
      const name = `img/${i}.${ext}`;
      fs.writeFileSync(path.join(OUT, name), await res.body());
      map[i] = `/promo/_src/myt/${name}`;
    } catch (e) { map[i] = ''; }
  }
  const html = snap.html.replace(/@@IMG(\d+)@@/g, (m, i) => map[i]);
  // YouTube's own font files, so the text breaks exactly where it does on the phone
  let css = snap.inline;
  for (const h of snap.sheets) { try { css += '\n' + (await (await p.request.get(h)).text()); } catch (e) { /* skip */ } }
  const faces = (css.match(/@font-face\s*{[^}]*}/g) || []).filter((f) => /Roboto|YouTube Sans/i.test(f));
  let fontCss = '', k = 0;
  for (const f of faces) {
    const u = (f.match(/url\(["']?([^"')]+)["']?\)/) || [])[1];
    if (!u) continue;
    const abs = new URL(u, 'https://m.youtube.com/').href;
    try {
      const res = await p.request.get(abs);
      const name = `font-${k++}.woff2`;
      fs.writeFileSync(path.join(OUT, name), await res.body());
      fontCss += f.replace(/src\s*:[^;]*;/, `src: url(/promo/_src/myt/${name}) format("woff2");`) + '\n';
    } catch (e) { /* skip */ }
  }
  fs.writeFileSync(path.join(OUT, 'fonts.css'), fontCss);
  console.log(`${faces.length} font faces`);
  fs.writeFileSync(path.join(OUT, 'page.html'), html);
  console.log(`page.html ${(html.length / 1024).toFixed(0)} KB, ${snap.imgs.length} images`);
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
