/* Fallboard — the film. One timeline drives every layer: the signed-off backdrop, the real app
   (in a frame on a virtual clock, see app-runtime.js), the other tools in the opening, the
   headlines and the camera. The same timeline makes the sound: the opening's video is scored
   from the piece itself, and everything the app plays is what the app asked its piano for on
   that frame. promo/scripts/film.js renders it.

   API (window.FILM): ready(), shots, begin(i), frame(f), drain(), renderAudio(events, seconds). */
(function () {
  'use strict';
  const Q = new URLSearchParams(location.search);
  const FPS = +Q.get('fps') || 60, DT = 1000 / FPS;
  const CUT = Q.get('cut') || 'main';
  const TT = CUT === 'tiktok', HOOKY = CUT === 'hook' || TT;   // tiktok: the hook again, 9:16, as a phone shows it
  const VERT = (Q.get('format') || '16x9') === '9x16';
  document.body.classList.toggle('vertical', VERT);
  const W = window.innerWidth, H = window.innerHeight;
  const $ = (id) => document.getElementById(id);

  /* ------------------------------------------------------------------ easing */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const prog = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
  function bezier(x1, y1, x2, y2) {
    return (x) => {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      const bx = (u) => 3 * (1 - u) * (1 - u) * u * x1 + 3 * (1 - u) * u * u * x2 + u * u * u;
      const by = (u) => 3 * (1 - u) * (1 - u) * u * y1 + 3 * (1 - u) * u * u * y2 + u * u * u;
      let lo = 0, hi = 1;
      for (let i = 0; i < 22; i++) { const m = (lo + hi) / 2; if (bx(m) < x) lo = m; else hi = m; }
      return by((lo + hi) / 2);
    };
  }
  const easeOut = bezier(0.18, 0.9, 0.25, 1);          // arrivals (the stills' own curve)
  const easeIn = bezier(0.55, 0, 0.9, 0.35);           // departures
  const easeApp = bezier(0.32, 0.72, 0, 1);            // Fallboard's --ease
  const easeCam = bezier(0.45, 0, 0.15, 1);            // camera: slow off, long settle
  const ease = (t, a, b, f = easeOut) => f(prog(t, a, b));

  /* ------------------------------------------------------------------ layout per format */
  const LAY = VERT ? {
    app: { w: 390, h: 720 }, win: { s: 0.74, r: 26, bottom: 22 },
    head: { app: 40, pain: 150, size: 21, sub: 13 }, fade: [64, 98],
    vid: { w: 288, h: 162 },
    player: { w: 324, h: 182.25, cx: 180, cy: 318 },
    scan: { w: 232, h: 300, cx: 212, cy: 352, rot: 3.2 },
    pay: { w: 258, cx: 180, cy: 366 },
  } : {
    app: { w: 1280, h: 720 }, win: { s: 0.78, r: 14, bottom: 28 },
    head: { app: 62, pain: 116, size: 38, sub: 17 }, fade: [92, 132],
    vid: { w: 416, h: 234 },
    player: { w: 768, h: 432, cx: 640, cy: 418 },
    scan: { w: 372, h: 482, cx: 884, cy: 420, rot: 2.6 },
    pay: { w: 330, cx: 640, cy: 438 },
  };
  if (TT) LAY.app = { w: 390, h: (640 * 390) / 360 };   // a phone's width, the frame's shape
  let WIN = (() => {
    const s = LAY.win.s, w = LAY.app.w * s, h = LAY.app.h * s;
    return { x: (W - w) / 2, y: H - h - LAY.win.bottom, w, h, s, r: LAY.win.r };
  })();

  if (HOOKY) WIN = { x: 0, y: 0, w: W, h: H, s: W / LAY.app.w, r: 0 };

  /* ------------------------------------------------------------------ the piece and its plan */
  const P0 = 14.55;          // the Revolutionary Étude, bar 9: the left hand's run into the theme
  const HI = { pain: 'rgba(255,255,255,0.6)', etude: '#ffd84a', rach: '#f7b48a', brand: '#ff9ad0' };
  let etude = null, rach = null, eng = null;
  const pianoNote = (n) => ({ midi: n.midi, vel: n.vel || 0.7 });

  /* the opening's video: where its playhead is, and how it sounds */
  const VSEG = [
    { a: 0.00, b: 2.20, p: P0, s: 1, bus: 'video' },
    { a: 2.20, b: 2.62, drag: [P0 + 2.20, 9.2] },
    { a: 2.62, b: 4.55, p: 9.2, s: 1, bus: 'video' },
    { a: 4.55, b: 7.30, p: 9.2 + 1.93, s: 0.5, bus: 'smear' },
    { a: 7.30, b: 99, hold: true },
  ];
  function videoPos(t) {
    let last = P0;
    for (const g of VSEG) {
      if (t < g.a) break;
      if (g.drag) last = lerp(g.drag[0], g.drag[1], easeApp(prog(t, g.a, g.b)));
      else if (g.hold) last = VSEG[3].p + (VSEG[3].b - VSEG[3].a) * VSEG[3].s;
      else last = g.p + (Math.min(t, g.b) - g.a) * g.s;
    }
    return last;
  }
  function videoEvents() {
    const ev = [];
    for (const g of VSEG) {
      if (g.drag) {
        for (let t = g.a + 0.02; t < g.b; t += 0.055) ev.push({ k: 's', t, kind: 'tick' });
        continue;
      }
      if (g.hold) continue;
      const p1 = g.p + (g.b - g.a) * g.s;
      for (const n of etude.notes) {
        if (n.t0 < g.p - 1e-6 || n.t0 >= p1) continue;
        const t = g.a + (n.t0 - g.p) / g.s;
        ev.push({ k: 'n', t, ...pianoNote(n), dur: (n.tOff - n.t0) / g.s, bus: g.bus, cut: g.b });
      }
    }
    return ev;
  }

  /* ------------------------------------------------------------------ headlines */
  const heads = [];   // { a, b, html, y, size, hi }
  function head(a, b, html, o = {}) { heads.push({ a, b, html, y: o.y, size: o.size || LAY.head.size, hi: o.hi || HI.etude }); }
  /* each character in its own box (words kept whole), numbered in reading order */
  function lettered(html) {
    const box = document.createElement('div');
    box.innerHTML = html;
    let i = 0;
    const walk = (node) => {
      for (const n of [...node.childNodes]) {
        if (n.nodeType !== 3) { walk(n); continue; }
        const frag = document.createDocumentFragment();
        for (const word of n.textContent.split(/(\s+)/)) {
          if (!word) continue;
          if (/^\s+$/.test(word)) { frag.appendChild(document.createTextNode(' ')); continue; }
          const w = document.createElement('span');
          w.className = 'w';
          for (const ch of word) { const c = document.createElement('span'); c.className = 'ch'; c.textContent = ch; c.dataset.i = i++; w.appendChild(c); }
          frag.appendChild(w);
        }
        n.replaceWith(frag);
      }
    };
    walk(box);
    return box.innerHTML;
  }
  const STAGGER = 0.024;
  /* a letter's rise: from below, past its place a little, back */
  const rise = (u) => (u <= 0 ? 1 : Math.exp(-u / 0.085) * Math.cos((2 * Math.PI * u) / 0.4));
  function drawHeads(t) {
    const live = heads.filter((h) => t >= h.a - 0.01 && t < h.b + 0.6);
    const slots = [$('headA'), $('headB')];
    let halo = 0;
    slots.forEach((el, k) => {
      const h = live[k];
      if (!h) { el.style.opacity = 0; el.dataset.k = ''; return; }
      const key = h.a + h.html;
      if (el.dataset.k !== key) { el.innerHTML = lettered(h.html); el.dataset.k = key; el._ch = [...el.querySelectorAll('.ch')].map((c) => ({ c, i: +c.dataset.i, em: !!c.closest('em') })); }
      el.style.opacity = 1;
      el.style.fontSize = h.size + 'px';
      el.style.setProperty('--hi', h.hi);
      el.style.top = h.y + 'px';
      el.style.transform = 'translateY(-50%)';
      el.style.filter = '';
      const n = el._ch.length;
      for (const { c, i, em } of el._ch) {
        const u = t - h.a - i * STAGGER, v = t - h.b;
        const inA = clamp(u / 0.09, 0, 1), outA = clamp(v / 0.16, 0, 1);
        const y = 0.62 * rise(u) + 0.22 * easeIn(clamp(v / 0.18, 0, 1));
        const heavy = 1 - easeOut(clamp(u / 0.38, 0, 1));
        c.style.opacity = (inA * (1 - outA)).toFixed(3);
        c.style.transform = `translateY(${y.toFixed(4)}em)`;
        c.style.fontWeight = em ? Math.round(500 + 300 * heavy) : Math.round(700 + 200 * heavy);
      }
      halo = Math.max(halo, clamp((t - h.a) / 0.3, 0, 1) * (1 - clamp((t - h.b) / 0.35, 0, 1)));
      if (k === 0) { const hb = $('headHalo'); hb.style.top = h.y + 'px'; }
    });
    const hb = $('headHalo');
    hb.style.opacity = (HOOKY ? halo : 0).toFixed(3);
  }

  /* what the camera pushes up under the headlines fades to black there, on Fallboard's C∞ curve */
  (function topFade() {
    const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : 1 / (1 + Math.exp(1 / t - 1 / (1 - t))));
    const [a, b] = LAY.fade, stops = [];
    for (let i = 0; i <= 32; i++) { const y = a + ((b - a) * i) / 32; stops.push(`rgb(0 0 0 / ${(1 - smooth(i / 32)).toFixed(4)}) ${y.toFixed(2)}px`); }
    $('topfade').style.background = `linear-gradient(to bottom, #000 0px, ${stops.join(', ')})`;
  })();

  /* ------------------------------------------------------------------ camera (zoom about a point) */
  let camKeys = [];   // { t, s, x, y }: from t on, ease to scale s about stage point (x, y)
  function cam(t, s, x, y, dur = 0.6) { camKeys.push({ t, s, x, y, dur }); }
  function camAt(t) {
    let cur = { s: 1, x: W / 2, y: H / 2 };
    for (const k of camKeys) {
      if (t < k.t) break;
      const p = easeCam(prog(t, k.t, k.t + k.dur));
      cur = { s: lerp(cur.s, k.s, p), x: lerp(cur.x, k.x, p), y: lerp(cur.y, k.y, p) };
    }
    return cur;
  }
  let hookDy = 0;
  /* the camera as screen = p * s + (tx, ty) */
  function viewAt(t) {
    if (HOOKY) return hookView(t);
    const c = camAt(t);
    return { s: c.s, tx: c.x * (1 - c.s), ty: c.y * (1 - c.s) };
  }
  function drawCam(t) {
    const v = viewAt(t), z = fbPulse(t);
    $('stage').style.transform = `translate(0px, ${hookDy.toFixed(2)}px) translate(${FB_PZ.x}px, ${FB_PZ.y}px) scale(${z.toFixed(5)}) translate(${-FB_PZ.x}px, ${-FB_PZ.y}px) translate(${v.tx.toFixed(3)}px, ${v.ty.toFixed(3)}px) scale(${v.s.toFixed(5)})`;
  }

  /* ------------------------------------------------------------------ the app's frame */
  let A = null, base = 0, logging = false, log = [];
  const appEl = $('app'), winEl = $('win');
  function placeWin(rect, radius, alpha = 1) {
    const s = rect.w / LAY.app.w;
    winEl.style.left = rect.x + 'px'; winEl.style.top = rect.y + 'px';
    winEl.style.width = rect.w + 'px'; winEl.style.height = rect.h + 'px';
    winEl.style.borderRadius = radius + 'px';
    winEl.style.opacity = alpha;
    winEl.style.display = alpha > 0 ? '' : 'none';
    appEl.style.width = LAY.app.w + 'px'; appEl.style.height = LAY.app.h + 'px';
    appEl.style.transform = `translate(0px, ${(rect.h - LAY.app.h * s).toFixed(3)}px) scale(${s.toFixed(5)})`;
  }
  const filmNow = () => (A.__vclock.now() - base) / 1000;
  function appTo(t) {
    const dt = base + t * 1000 - A.__vclock.now();
    if (dt > 0.01) A.__vclock.advance(dt);
  }
  const doc = () => A.document;
  const q = (sel) => (typeof sel === 'string' ? doc().querySelector(sel) : sel);
  async function waitFor(fn, ms = 30000) {
    const t0 = performance.now();
    while (!fn()) {
      if (performance.now() - t0 > ms) throw new Error('timed out waiting: ' + fn);
      A.__vclock.advance(DT);
      await new Promise((r) => setTimeout(r, 15));
    }
  }
  async function settle(ms) { for (let i = 0; i < ms / DT; i++) { A.__vclock.advance(DT); if (i % 6 === 5) await new Promise((r) => setTimeout(r, 0)); } }
  function hookPiano() {
    const P = A.FB.debug.piano, Param = A.__silentParam;
    P.noteOn = (midi, when, dur, vel) => {
      if (logging) log.push({ k: 'n', t: when - base / 1000, midi, dur, vel, bus: 'app', at: filmNow() });
      return { src: { stop() {} }, g: { gain: new Param(0) } };
    };
    P.stopAll = () => { if (logging) log.push({ k: 'x', t: filmNow() }); };
  }

  /* taps: a touch on a real control, and the halo that shows it */
  const taps = [];
  function centreOf(el) { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, r }; }
  function toStage(p) { const s = WIN.w / LAY.app.w; return { x: WIN.x + p.x * s, y: WIN.y + (WIN.h - LAY.app.h * s) + p.y * s }; }
  function pointer(type, el, x, y) {
    el.dispatchEvent(new A.PointerEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, pointerId: 11, pointerType: 'touch', isPrimary: true, button: 0, buttons: type === 'pointerdown' ? 1 : 0, view: A }));
  }
  function tapDown(t, sel, at) {
    const el = q(sel);
    if (!el) { console.warn('no element for tap', sel); return null; }
    const c = centreOf(el), x = at ? at.x : c.x, y = at ? at.y : c.y;
    const dot = document.createElement('div');
    dot.className = 'tap';
    $('taps').appendChild(dot);
    const sp = toStage({ x, y });
    dot.style.left = sp.x + 'px'; dot.style.top = sp.y + 'px';
    taps.push({ t, el: dot });
    pointer('pointerdown', el, x, y);
    return { el, x, y };
  }
  function tapUp(h) {
    if (!h) return;
    pointer('pointerup', h.el, h.x, h.y);
    h.el.dispatchEvent(new A.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, clientX: h.x, clientY: h.y, view: A }));
  }
  function drawTaps(t) {
    for (const tp of taps) {
      const age = t - tp.t;
      if (age < 0 || age > 0.6) { tp.el.style.opacity = 0; continue; }
      const grow = easeOut(prog(age, 0, 0.14)), fade = easeOut(prog(age, 0.16, 0.55));
      tp.el.style.opacity = (grow * (1 - fade)).toFixed(3);
      tp.el.style.transform = `scale(${(0.55 + 0.45 * grow + 0.25 * fade).toFixed(3)})`;
    }
  }
  /* a stage point to frame a control with the camera */
  const focusOf = (sel, dy = 0) => { const el = q(sel); const p = toStage(centreOf(el)); return { x: p.x, y: p.y + dy }; };

  /* ------------------------------------------------------------------ the opening's props */
  const vid = $('vid');
  vid.width = LAY.vid.w; vid.height = LAY.vid.h;
  const vctx = vid.getContext('2d');
  const isBlack = (m) => [1, 3, 6, 8, 10].includes(m % 12);
  function drawVideo(pos) {
    const w = vid.width, h = vid.height, kh = Math.round(h * 0.2), rh = h - kh, span = 1.45;
    const lo = 36, hi = 96;
    const whites = []; for (let m = lo; m <= hi; m++) if (!isBlack(m)) whites.push(m);
    const ww = w / whites.length;
    const xOf = (m) => { if (!isBlack(m)) return whites.indexOf(m) * ww; return whites.indexOf(m - 1) * ww + ww * 0.68; };
    const wOf = (m) => (isBlack(m) ? ww * 0.64 : ww);
    vctx.fillStyle = '#151518'; vctx.fillRect(0, 0, w, h);
    vctx.fillStyle = '#1c1c21';
    for (let i = 0; i < whites.length; i++) if (whites[i] % 12 === 0) vctx.fillRect(Math.round(i * ww), 0, 1, rh);
    const lit = new Map();
    for (const n of etude.notes) {
      if (n.t1 < pos - 0.05 || n.t0 > pos + span) continue;
      if (n.midi < lo || n.midi > hi) continue;
      if (n.t0 <= pos && n.t1 > pos) lit.set(n.midi, n.hand);
      const y0 = rh - ((n.t0 - pos) / span) * rh, y1 = rh - ((n.t1 - pos) / span) * rh;
      const x = xOf(n.midi) + 0.5, wd = wOf(n.midi) - 1;
      vctx.fillStyle = n.hand === 0 ? (isBlack(n.midi) ? '#2f86d8' : '#58aef5') : (isBlack(n.midi) ? '#3a9e48' : '#62c76d');
      const top = Math.max(-4, y1), bot = Math.min(y0, rh) - 1;
      if (bot > top) { vctx.beginPath(); vctx.roundRect(x, top, wd, bot - top, Math.min(2, wd / 3)); vctx.fill(); }
    }
    vctx.fillStyle = '#7a1e1e'; vctx.fillRect(0, rh - 1, w, 2);
    for (let i = 0; i < whites.length; i++) {
      const m = whites[i];
      vctx.fillStyle = lit.has(m) ? (lit.get(m) === 0 ? '#58aef5' : '#62c76d') : '#e9e9ec';
      vctx.fillRect(Math.round(i * ww), rh + 1, Math.ceil(ww) - 1, kh - 1);
    }
    for (let m = lo; m <= hi; m++) {
      if (!isBlack(m)) continue;
      vctx.fillStyle = lit.has(m) ? (lit.get(m) === 0 ? '#2f86d8' : '#3a9e48') : '#141414';
      vctx.fillRect(xOf(m), rh + 1, wOf(m), kh * 0.62);
    }
  }
  const fmt = (s) => { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  function propBox(el, box, extra = '') {
    const w = box.w, h = box.h || el.offsetHeight;
    el.style.width = w + 'px'; if (box.h) el.style.height = h + 'px';
    el.style.left = (box.cx - w / 2) + 'px'; el.style.top = (box.cy - (box.h || el.offsetHeight) / 2) + 'px';
    return extra;
  }
  function buildScan() {
    const box = $('scanInkBox');
    const pages = eng.pages, defs = eng.defs;
    const fbDefs = `<defs>${defs}</defs>`;
    let html = `<div class="s-title">ÉTUDE</div><div class="s-sub">Op. 10, No. 12</div>`;
    const sysW = LAY.scan.w * 0.86;
    let y = LAY.scan.h * 0.15;
    for (const i of [2, 3, 4, 5, 6]) {
      const p = pages[i], pw = p.w || eng.w, hh = (sysW * p.h) / pw;
      if (y + hh > LAY.scan.h * 0.97) break;
      html += `<svg class="sys" style="top:${y.toFixed(1)}px;transform:rotate(${(i % 2 ? -0.4 : 0.3)}deg)" viewBox="0 ${p.y0} ${pw} ${p.h}" fill="#2b241a" color="#2b241a"><style>g[stroke-width]{stroke:#2b241a}polyline{fill:none}</style>${fbDefs}${p.svg}</svg>`;
      y += hh * 0.92;
    }
    box.innerHTML = html;
    const g = $('grain'), gw = Math.round(LAY.scan.w * 1.5), gh = Math.round(LAY.scan.h * 1.5);
    g.width = gw; g.height = gh;
    const c = g.getContext('2d'), img = c.createImageData(gw, gh);
    let seed = 1234567;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      const i = (y * gw + x) * 4, edge = Math.min(x, y, gw - x, gh - y) / Math.min(gw, gh);
      const tone = 255 - (edge < 0.08 ? (0.08 - edge) * 900 : 0) - rnd() * 26 - (rnd() < 0.002 ? 120 : 0);
      img.data[i] = tone; img.data[i + 1] = tone * 0.985; img.data[i + 2] = tone * 0.95; img.data[i + 3] = 255;
    }
    c.putImageData(img, 0, 0);
  }

  function drawPain(t) {
    const pl = $('player'), sc = $('scan'), pw = $('paywall');
    const gone = ease(t, 10.85, 11.45, easeIn);
    const outT = (k) => `translateY(${(26 * gone).toFixed(2)}px) scale(${(1 - 0.08 * gone).toFixed(4)})`;
    const blurOut = gone > 0 ? ` blur(${(gone * 10).toFixed(2)}px)` : '';

    // the video
    const pin = ease(t, 0.0, 0.55);
    const aside = ease(t, 7.3, 7.85, easeApp);
    propBox(pl, LAY.player);
    const ax = VERT ? -46 : -170, ay = VERT ? -64 : -8;
    pl.style.opacity = (pin * (1 - gone) * (1 - 0.35 * aside)).toFixed(4);
    pl.style.transform = `translate(${(ax * aside).toFixed(2)}px, ${(ay * aside).toFixed(2)}px) scale(${(lerp(0.965, 1, pin) * lerp(1, 0.86, aside)).toFixed(4)}) ${outT()}`;
    pl.style.filter = (aside > 0 ? `brightness(${(1 - 0.3 * aside).toFixed(3)})` : '') + blurOut;
    const pos = videoPos(t);
    drawVideo(pos);
    const dur = etude.duration, frac = pos / dur;
    $('vdone').style.width = (frac * 100).toFixed(3) + '%';
    $('vknob').style.left = (frac * 100).toFixed(3) + '%';
    const knobOn = ease(t, 1.9, 2.1) * (1 - ease(t, 3.0, 3.2));
    $('vknob').style.transform = `scale(${knobOn.toFixed(3)})`;
    $('vtime').textContent = fmt(pos) + ' / ' + fmt(dur);
    const playing = t < 7.3;
    $('vplay').innerHTML = playing ? '<path d="M7 4.5h3.6v15H7zM13.4 4.5H17v15h-3.6z"/>' : '<path d="M7 4.5v15l12.5-7.5z"/>';
    // the speed menu
    const mOpen = ease(t, 3.95, 4.12) * (1 - ease(t, 4.5, 4.62, easeIn));
    const menu = $('vmenu');
    menu.style.opacity = mOpen.toFixed(3);
    menu.style.transform = `scale(${lerp(0.92, 1, mOpen).toFixed(4)})`;
    $('vm50').classList.toggle('hl', t >= 4.28);
    $('vm50').classList.toggle('on', t >= 4.5);
    $('vm100').classList.toggle('on', t < 4.5);

    // the cursor: in to the scrubber, drags back, out to the gear, picks 0.5
    const cur = $('cursor');
    const plR = pl.getBoundingClientRect(), plS = plR.width / LAY.player.w;
    const local = (el) => { const r = el.getBoundingClientRect(); return { x: (r.left - plR.left) / plS, y: (r.top - plR.top) / plS, w: r.width / plS, h: r.height / plS }; };
    const plX = LAY.player.cx - LAY.player.w / 2, plY = LAY.player.cy - LAY.player.h / 2;
    const bar = $('vbar'), bl = local(bar);
    const knobAt = (p) => ({ x: plX + bl.x + (p / dur) * bl.w, y: plY + bl.y + bl.h / 2 });
    const gearEl = pl.querySelectorAll('.row svg')[1], gl = local(gearEl);
    const gear = { x: plX + gl.x + gl.w / 2, y: plY + gl.y + gl.h / 2 };
    const m50 = local($('vm50'));
    const opt = { x: plX + m50.x + m50.w * 0.3, y: plY + m50.y + m50.h / 2 };
    let cp = { x: plX + LAY.player.w * 0.7, y: plY + LAY.player.h * 0.62 };
    const k0 = knobAt(P0 + 2.2);
    if (t >= 1.5) cp = { x: lerp(cp.x, k0.x, ease(t, 1.5, 2.15, easeCam)), y: lerp(cp.y, k0.y, ease(t, 1.5, 2.15, easeCam)) };
    if (t >= 2.2) cp = knobAt(videoPos(Math.min(t, 2.62)));
    if (t >= 3.3) { const k1 = knobAt(9.2); const e = ease(t, 3.3, 3.92, easeCam); cp = { x: lerp(k1.x, gear.x, e), y: lerp(k1.y, gear.y, e) }; }
    if (t >= 4.12) { const e = ease(t, 4.12, 4.45, easeCam); cp = { x: lerp(gear.x, opt.x, e), y: lerp(gear.y, opt.y, e) }; }
    if (t >= 4.62) { const e = ease(t, 4.62, 5.3, easeCam); cp = { x: lerp(opt.x, opt.x + 40, e), y: lerp(opt.y, opt.y + 70, e) }; }
    const press = (t >= 2.2 && t < 2.62) || (t >= 3.95 && t < 4.03) || (t >= 4.5 && t < 4.58);
    cur.style.opacity = (ease(t, 1.45, 1.6) * (1 - ease(t, 5.0, 5.3))).toFixed(3);
    const cs = VERT ? 15 : 22;
    cur.style.transform = `translate(${(cp.x - cs * 0.12).toFixed(2)}px, ${(cp.y - cs * 0.08).toFixed(2)}px) translate(${pl.style.transform.includes('translate(') ? 0 : 0}px,0) scale(${press ? 0.88 : 1})`;

    // the scan, crooked and silent
    propBox(sc, LAY.scan);
    const sin = ease(t, 7.35, 7.9, easeApp);
    sc.style.opacity = (sin * (1 - gone)).toFixed(4);
    sc.style.transform = `translate(${lerp(VERT ? 120 : 260, 0, sin).toFixed(2)}px, ${lerp(16, 0, sin).toFixed(2)}px) rotate(${(LAY.scan.rot + 4 * (1 - sin)).toFixed(3)}deg) ${outT()}`;
    sc.style.filter = (aside > 0 ? '' : '') + blurOut;
    const scanDim = ease(t, 9.2, 9.6);
    sc.style.filter = `brightness(${(1 - 0.28 * scanDim).toFixed(3)})` + blurOut;
    pl.style.filter = `brightness(${((1 - 0.3 * aside) * (1 - 0.25 * scanDim)).toFixed(3)})` + blurOut;

    // the paywall
    propBox(pw, LAY.pay);
    const pin2 = prog(t, 9.2, 9.62);
    const spring = pin2 >= 1 ? 1 : 1 - Math.exp(-7 * pin2) * Math.cos(9 * pin2);
    pw.style.opacity = (ease(t, 9.2, 9.36) * (1 - gone)).toFixed(4);
    pw.style.transform = `translateY(${lerp(30, 0, spring).toFixed(2)}px) scale(${lerp(0.9, 1, spring).toFixed(4)}) ${outT()}`;
    pw.style.filter = blurOut;

    $('black').style.opacity = 0;
  }
  function revealEvents() {
    const R = T.reveal, chord = [36, 43, 48, 60, 63, 67, 72];
    const ev = chord.map((m, i) => ({ k: 'n', t: R + 0.08 + i * 0.004, midi: m, dur: 2.6, vel: m < 50 ? 0.58 : 0.5, bus: 'app', at: R }));
    ev.push({ k: 's', t: R + 1.12, kind: 'whoosh' });
    return ev;
  }
  function painEvents() {
    const ev = videoEvents();
    ev.push({ k: 's', t: 3.95, kind: 'click' }, { k: 's', t: 4.5, kind: 'click' });
    ev.push({ k: 's', t: 7.3, kind: 'stop' });
    ev.push({ k: 's', t: 7.36, kind: 'paper' });
    ev.push({ k: 's', t: 9.22, kind: 'pop' });
    ev.push({ k: 's', t: 10.9, kind: 'drop' });
    return ev;
  }

  /* ------------------------------------------------------------------ the icon and name */
  let iconRect = null;
  function measureIcon() {
    const L = $('endLayer'), prev = L.style.opacity;
    for (const id of ['endStage', 'endIcon', 'endTitle', 'endSub']) $(id).style.transform = '';
    $('endSub').style.display = '';
    const r = $('endIcon').getBoundingClientRect();
    iconRect = { x: r.left, y: r.top, w: r.width, h: r.height };
    L.style.opacity = prev;
  }
  /* the signed-off endcard's entrance, from t0; withSub shows the line under the name */
  function drawBrand(t, t0, { withSub, out = 99, dive = null }) {
    const L = $('endLayer');
    L.style.opacity = 1;
    const k = t - t0;
    const drift = lerp(0.97, 1.015, prog(k, 0, 2.6));
    $('endStage').style.transform = `scale(${drift.toFixed(4)})`;
    const iIn = easeOut(prog(k, 0.06, 0.44));
    $('endIcon').style.opacity = iIn;
    $('endIcon').style.transformOrigin = '';
    $('endIcon').style.transform = `scale(${lerp(0.84, 1, iIn)}) translateY(${lerp(16, 0, iIn)}px)`;
    const tIn = easeOut(prog(k, 0.16, 0.54)), tOut = ease(t, out, out + 0.3, easeIn);
    $('endTitle').style.opacity = (tIn * (1 - tOut)).toFixed(4);
    $('endTitle').style.transform = `translateY(${lerp(16, 0, tIn) - 10 * tOut}px)`;
    const sIn = easeOut(prog(k, 0.28, 0.66));
    $('endSub').style.display = withSub ? '' : 'none';
    $('endSub').style.opacity = sIn;
    $('endSub').style.transform = `translateY(${lerp(12, 0, sIn)}px)`;
    if (dive !== null) $('endIcon').style.opacity = (iIn * (1 - dive)).toFixed(4);
  }
  function bg(t, palette, offset, alpha, scale = 1) {
    const c = $('bg');
    if (alpha <= 0.001) { c.style.opacity = 0; return; }
    Backdrop.render(c, palette, offset, { cy: 1.12, rx: VERT ? 1.35 : 1.24, ry: VERT ? 1.04 : 1.06, a: 0.65, b: 0.45, blur: 10 });
    c.style.opacity = alpha.toFixed(4);
    c.style.transform = `scale(${scale.toFixed(4)})`;
  }
  /* the icon laid over a rect: as tall as it, on its bottom edge (the icon's keys on the app's keys) */
  function iconOver(rect, alpha) {
    const el = $('endIcon'), sc = Math.min(rect.w / iconRect.w, rect.h / iconRect.h);
    const dx = rect.x + rect.w / 2 - (iconRect.x + iconRect.w / 2), dy = rect.y + rect.h - (iconRect.y + iconRect.h);
    el.style.transformOrigin = '50% 100%';
    el.style.transform = `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px) scale(${sc.toFixed(4)})`;
    el.style.opacity = alpha.toFixed(4);
  }
  const rectLerp = (a, b, p) => ({ x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p), w: lerp(a.w, b.w, p), h: lerp(a.h, b.h, p) });

  /* ------------------------------------------------------------------ the cut */
  const T = {
    reveal: 11.6, play: 13.0, pause: 15.0, steps: [15.45, 15.9, 16.35, 16.8, 17.25],
    hands: 18.4, speed: 22.4, score: 26.6, library: 30.8, end: 37.6, out: 41.0,
  };
  const shots = [];
  function shot(name, a, b, o) { shots.push({ name, a, b, f0: Math.round(a * FPS), f1: Math.round(b * FPS), ...o }); }
  const acts = [];   // { t, fn } once per render, in order
  function act(t, fn) { acts.push({ t, fn }); }
  function tap(t, sel, at) {
    let h = null;
    act(t, () => { h = tapDown(t, typeof sel === 'function' ? sel() : sel, typeof at === 'function' ? at() : at); });
    act(t + TAP, () => tapUp(h));
  }

  /* where the app's playhead is, worked out the way app.js does it: play() and setSpeed() anchor
     the clock LEAD ahead (reanchor), a button acts on its click, TAP after the touch, and the
     speed slider on the touch itself */
  const LEAD = 0.07, TAP = 0.09;
  const run = (from, callT, speed = 1) => (t) => from + Math.max(0, t - callT - LEAD) * speed;
  const HANDS_PLAY = 19.2 - LEAD, SLOW = 23.05 - LEAD, RACH = 35.2 - LEAD;
  let stepped = 0, pHands = null, pSlow = null;
  const pRach = run(0, RACH);
  function plan() {
    const on = A.FB.debug.S.score.onsets.both;
    let cur = run(P0, T.play - LEAD)(T.pause + TAP);
    for (let i = 0; i < T.steps.length; i++) cur = on.find((x) => x > cur + 1e-4);
    stepped = cur;
    pHands = run(stepped, HANDS_PLAY + TAP);
    pSlow = run(pHands(SLOW), SLOW, 0.5);
  }

  function buildCut() {
    // the opening
    head(0.45, 2.12, `It's <em class="hi">too fast.</em>`, { y: LAY.head.pain, hi: HI.pain });
    head(2.22, 2.88, `Back a bit…`, { y: LAY.head.pain, hi: HI.pain });
    head(2.98, 4.4, `<em class="hi">Too far.</em>`, { y: LAY.head.pain, hi: HI.pain });
    head(4.72, 7.2, `And 0.5× sounds <em class="hi">like this.</em>`, { y: LAY.head.pain, hi: HI.pain });
    head(7.55, 9.12, `The sheet music <em class="hi">doesn't play.</em>`, { y: LAY.head.pain, hi: HI.pain });
    head(9.4, 10.8, `One hand at a time? <em class="hi">Subscribe.</em>`, { y: LAY.head.pain, hi: HI.pain });

    // Fallboard
    head(15.1, 18.15, `Step through it, <em class="hi">chord by chord.</em>`, { y: LAY.head.app });
    head(18.6, 22.25, `One hand at a time. <em class="hi">Free.</em>`, { y: LAY.head.app });
    head(22.6, 26.45, `Slow it down. <em class="hi">Still a real piano.</em>`, { y: LAY.head.app });
    head(26.85, 30.65, `Real sheet music, <em class="hi">in sync.</em>`, { y: LAY.head.app });
    head(31.2, 34.3, `650 pieces, <em class="hi">ready to play.</em>`, { y: LAY.head.app });
    head(35.35, 37.4, `Each in <em class="hi">its own colours.</em>`, { y: LAY.head.app, hi: HI.rach });

    shot('opening', 0, T.reveal, { app: false });
    shot('reveal', T.reveal, T.hands, {
      setup: (t0) => appState({ piece: 'revolutionary', view: 'roll', hand: 'both', speed: 1, pos: P0 }, t0),
    });
    shot('hands', T.hands, T.speed, {
      setup: (t0) => appState({ piece: 'revolutionary', view: 'roll', hand: 'both', speed: 1, pos: stepped }, t0),
    });
    shot('speed', T.speed, T.score, {
      setup: (t0) => appState({ piece: 'revolutionary', view: 'roll', hand: 'L', speed: 1, rail: 'hand', pos: pHands(T.speed), playAt: T.speed }, t0),
    });
    shot('score', T.score, T.library, {
      setup: (t0) => appState({ piece: 'revolutionary', view: 'roll', hand: 'L', speed: 0.5, rail: 'speed', pos: pSlow(T.score), playAt: T.score }, t0),
    });
    shot('library', T.library, T.end, {
      setup: (t0) => appState({ piece: 'revolutionary', view: 'score', hand: 'L', speed: 0.5, pos: pSlow(T.library), playAt: T.library, warm: true }, t0),
    });
    shot('end', T.end, T.out, {
      setup: (t0) => appState({ piece: 'rach-cs', view: 'roll', hand: 'both', speed: 1, pos: pRach(T.end), playAt: T.end }, t0),
    });

    // the reveal: the app plays from bar 9, pauses on the theme, steps
    act(T.play - LEAD, () => A.FB.debug.play());
    tap(T.pause, '#playBtn');
    T.steps.forEach((s) => tap(s, '#nextBtn'));
    // hands
    tap(18.45, '#handToggle');
    tap(18.85, '#handSeg button[data-hand="L"]');
    tap(HANDS_PLAY, '#playBtn');
    // speed: open it, touch the 50% stop
    tap(22.55, '#speedToggle');
    tap(SLOW, '#speed', () => { const r = q('#speedTrack').getBoundingClientRect(); return { x: r.left + r.width / 6, y: r.top + r.height / 2 }; });
    // score
    tap(26.75, '#viewSeg button[data-view="score"]');
    // library: the piece's name, Library, down to Rachmaninoff, his prelude, Play
    tap(30.95, '#menuBtn');
    tap(31.35, '#menuMore');
    act(31.95, () => {
      const sc = q('#libScroll'), row = findRach();
      const r = row.getBoundingClientRect(), s0 = sc.scrollTop;
      scroll = { el: sc, a: 31.95, b: 32.95, from: s0, to: Math.max(0, s0 + r.top + r.height / 2 - LAY.app.h * 0.6) };
    });
    tap(33.15, () => findRach());
    act(34.3, () => {
      // behind the library, out of sight: both hands and the roll again
      hidden('#handSeg button[data-hand="both"]');
      hidden('#viewSeg button[data-view="roll"]');
    });
    tap(34.6, () => [...doc().querySelectorAll('#libPage .btn.main')].find((b) => /Play/.test(b.textContent)));
    act(34.95, () => { const D = A.FB.debug; if (D.S.playing) D.pause(); D.S.speed = 1; D.seek(0, { snap: true }); });
    act(RACH, () => { if (!A.FB.debug.S.playing) A.FB.debug.play(); });
  }
  let scroll = null;
  const hidden = (sel) => { const el = q(sel); if (el) el.dispatchEvent(new A.MouseEvent('click', { bubbles: true, detail: 1, view: A })); };
  function findRach() {
    return [...doc().querySelectorAll('#libPage button.row')].find((b) => /C♯ minor/.test(b.textContent) && /Rachmaninoff/.test(b.textContent));
  }

  /* put the app into a state at once, as a cut starts there */
  const PIECES = {
    revolutionary: { id: 'chopin-op10-12', file: 'revolutionary', title: 'Revolutionary Étude', composer: 'Frédéric Chopin, Op. 10 No. 12' },
    'rach-cs': { id: 'rachmaninoff-op3-2', file: 'rach-cs', title: 'Prelude in C♯ minor', composer: 'Sergei Rachmaninoff, Op. 3 No. 2' },
  };
  async function appState(o, t0) {
    logging = false;
    const D = A.FB.debug, S = D.S, pc = PIECES[o.piece];
    if (o.warm) {
      // visit the prelude's page once, so its sheet music is laid out before the film gets there
      A.FB.library.open();
      await waitFor(() => findRach());
      hidden(findRach());
      await waitFor(() => { const pg = q('#libPage'); return pg && /Bells of Moscow/.test(pg.textContent) && !/Laying out/.test(pg.textContent); }, 90000);
      await settle(400);
      hidden('#libBack');
      await settle(900);
    }
    if (A.FB.library.isOpen()) { A.FB.library.close(); await settle(900); }
    if (!S.meta || S.meta.id !== pc.id) {
      A.FB.app.open({ kind: 'builtin', file: pc.file }, { id: pc.id, title: pc.title, composer: pc.composer });
      await waitFor(() => S.meta && S.meta.id === pc.id && S.score);
    }
    D.pause();
    const click = (sel) => { const el = q(sel); if (el) el.dispatchEvent(new A.MouseEvent('click', { bubbles: true, detail: 1, view: A })); };
    if (S.view !== o.view) click(`#viewSeg button[data-view="${o.view}"]`);
    if (S.hand !== o.hand) click(`#handSeg button[data-hand="${o.hand}"]`);
    S.speed = o.speed;
    if (o.ppsMul) { if (!A.__pps0) A.__pps0 = S.pps; S.pps = A.__pps0 * o.ppsMul; }
    // the keyboard zoomed as a pinch leaves it, and held there: n white keys across from white key `left`
    // (the same in every shot, so the pieces meet exactly)
    if (o.keys) { const G = D.G; G.manual = true; G.tW = G.W = LAY.app.w / o.keys.n; G.tLeft = G.left = o.keys.left; G.holdUntil = 1e15; }
    // close any open rail control, then open the one wanted
    doc().dispatchEvent(new A.PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
    if (o.rail === 'hand') click('#handToggle');
    if (o.rail === 'speed') click('#speedToggle');
    D.seek(o.pos, { snap: true });
    if (o.view === 'score') await waitFor(() => D.notation && doc().querySelector('#notation svg'), 20000).catch(() => {});
    await settle(900);
    D.seek(o.pos, { snap: true });
    await settle(200);
    if (o.playAt !== undefined) {
      base = A.__vclock.now() + LEAD * 1000 - o.playAt * 1000;
      logging = true;
      D.play();
      appTo(o.playAt);
    } else {
      base = A.__vclock.now() - t0 * 1000;
    }
  }

  /* ------------------------------------------------------------------ one frame */
  let actIdx = 0, curShot = null;
  async function begin(i) {
    curShot = shots[i];
    const t0 = curShot.pre ?? curShot.a;
    taps.length = 0; $('taps').textContent = '';
    if (HOOKY) { fbView = null; camKeys.length = 0; }
    scroll = null;
    log = [];
    if (curShot.setup) await curShot.setup(t0);
    actIdx = acts.findIndex((a) => a.t >= t0);
    if (actIdx < 0) actIdx = acts.length;
    logging = true;
    if (curShot.name === 'opening') log.push(...painEvents());
    if (curShot.name === 'reveal') log.push(...revealEvents());
    if (curShot.name === 'youtube') log.push(...hookEvents());
    if (curShot.pre !== undefined) for (let f = Math.round(t0 * FPS); f < curShot.f0; f++) skip(f);
  }

  /* the app (and its timed actions) on to frame f, without drawing the film */
  function skip(f) {
    const t = f / FPS, s = curShot;
    // timed actions on the app happen on the frame they fall in, at their own moment
    if (s.app !== false) {
      while (actIdx < acts.length && acts[actIdx].t < t + 1e-6) {
        const a = acts[actIdx++];
        if (a.t >= (s.pre ?? s.a) - 1e-6) { appTo(a.t); a.fn(); A.__vclock.sync(); }
      }
      if (scroll && t >= scroll.a && t <= scroll.b + 0.02) scroll.el.scrollTop = lerp(scroll.from, scroll.to, easeCam(prog(t, scroll.a, scroll.b)));
      appTo(t);
    }
  }
  function frame(f) {
    skip(f);
    return compose(f / FPS);
  }

  function compose(t) {
    if (HOOKY) {
      const inYT = t < HK.cut;
      $('yt').style.display = inYT && !TT ? 'block' : 'none';
      $('myt').style.display = inYT && TT ? 'block' : 'none';
      $('topfade').style.display = 'none';
      if (inYT) {
        $('endLayer').style.opacity = 0;
        bg(t, 'orchid', 0, 0);
        placeWin(WIN, WIN.r, 0);
        for (const id of ['player', 'scan', 'paywall', 'cursor']) $(id).style.display = 'none';
        $('keys').style.display = 'none';
        $('fbCursor').style.opacity = 0; $('fxWash').style.opacity = 0; $('stage').style.filter = '';
        drawHeads(t);
        return TT ? drawMYT(t) : drawYT(t);
      }
      $('yt').style.filter = ''; $('myt').style.filter = '';
      hookDy = drawFb(t);
      if (TT) drawTTCaps(t);
    }
    const R = T.reveal;
    // the opening
    const inOpening = t < R;
    for (const id of ['player', 'scan', 'paywall', 'cursor']) $(id).style.display = inOpening ? '' : 'none';
    if (inOpening) drawPain(t);

    // the brand: the reveal, the dive into the app, and the end
    let winRect = { x: WIN.x, y: WIN.y, w: WIN.w, h: WIN.h }, winR = WIN.r, winA = 0;
    if (t < R) {
      $('endLayer').style.opacity = 0;
      bg(t, 'orchid', 0, 0);
    } else if (t < T.end) {
      const dive = ease(t, R + 1.25, R + 2.1, easeCam);
      if (!iconRect) measureIcon();
      winRect = rectLerp(iconRect, winRect, dive);
      winR = lerp(iconRect.w * 0.225, WIN.r, dive);
      winA = prog(dive, 0.0, 0.12);
      if (t < R + 2.4) {
        drawBrand(t, R, { withSub: false, out: R + 1.15 });
        if (t >= R + 1.25) iconOver(winRect, 1 - easeOut(prog(dive, 0.08, 0.42)));
      } else $('endLayer').style.opacity = 0;
      const bgIn = ease(t, R, R + 0.42);
      bg(t, 'orchid', (t - R) * 0.35, lerp(bgIn, 0.42, dive), lerp(1.09, 1, bgIn));
      $('black').style.opacity = (1 - ease(t, R - 0.05, R + 0.4)).toFixed(4);
    } else {
      // the pull back out into the icon
      const pull = ease(t, T.end, T.end + 0.75, easeCam);
      if (!iconRect) measureIcon();
      winRect = rectLerp(winRect, iconRect, pull);
      winR = lerp(WIN.r, iconRect.w * 0.225, pull);
      winA = 1 - prog(pull, 0.88, 1);
      drawBrand(t, T.end + 0.38, { withSub: true });
      iconOver(winRect, easeOut(prog(pull, 0.55, 0.92)));
      bg(t, 'orchid', (t - T.end) * 0.35, lerp(0.42, 1, ease(t, T.end + 0.2, T.end + 0.9)), 1);
      $('black').style.opacity = ease(t, T.out - 0.32, T.out - 0.02, easeIn).toFixed(4);
    }
    placeWin(winRect, winR, winA);
    drawCam(t);
    drawTaps(t);
    drawHeads(t);
  }

  /* ------------------------------------------------------------------ the camera's moves */
  function buildCamera() {
    const nb = focusOf('#nextBtn'), kb = toStage(centreOf(q('#kbd')));
    cam(14.75, 1.26, (nb.x + kb.x) / 2, (nb.y + kb.y) / 2 - 10);
    cam(17.75, 1, W / 2, H / 2, 0.65);
    const ht = focusOf('#handToggle');
    cam(18.2, 1.42, ht.x + (VERT ? 40 : 90), ht.y - (VERT ? 30 : 20));
    cam(19.4, 1, W / 2, H / 2, 0.7);
    const st = focusOf('#speedToggle');
    cam(22.3, 1.42, st.x - (VERT ? 40 : 120), st.y - (VERT ? 30 : 20));
    cam(23.6, 1, W / 2, H / 2, 0.7);
    const vs = focusOf('#viewSeg');
    cam(26.35, 1.38, vs.x - (VERT ? 30 : 60), vs.y + (VERT ? 40 : 40));
    cam(27.15, 1, W / 2, H / 2, 0.7);
    camKeys.sort((a, b) => a.t - b.t);
  }

  /* ================================================================== the hook cut (?cut=hook)
     Rousseau's video of the étude, braking onto one chord (bar 27, beat 4: E♭ F A D over F) while
     its sound runs on into the chord and holds; the search for it, ever faster, ever worse, at 0.5×,
     until the tape stops; Fallboard's own playback of the same build-up, and Fallboard stepping to
     the chord with its own buttons. */
  /* the TikTok cut: a shorter pause; from the speed menu on, the search lasts as long as the "ahh
     almost" clip; Fallboard's half is the hook's, moved earlier by D */
  const TTK = { tap: 4.46, gear: 7.46, item: 7.58, half: 7.72, s0: 9.02, clip: 4.435, clipAt: 7.46 };
  const HK = TT ? (() => {
    const stop = TTK.clipAt + TTK.clip, cut = stop + 0.8, D = cut - 15.2;
    return { brake: 4.48, freeze: 4.84, unpause: 7.24, half: TTK.half, frenzy: TTK.s0, stop, cut, D,
      fbAudio: 14.3 + D, pause: 18.87 + D, steps: [19.297, 19.752, 20.206, 20.661].map((x) => x + D), playOn: 21.57 + D, end: 22.7 + D, out: 26.1 + D };
  })() : {
    brake: 4.48, freeze: 4.84, unpause: 8.04, half: 10.70, frenzy: 12.3, stop: 14.4, D: 0,
    fbAudio: 14.3, cut: 15.2, pause: 18.87, steps: [19.297, 19.752, 20.206, 20.661], playOn: 21.57, end: 22.7, out: 26.1,
  };
  const SIXTEENTH = 60 / 132 / 4;   // the étude's sixteenth on Fallboard's clock
  const SRC0 = 45.0, YT_DUR = 181.6, CHORD_SRC = 52.84, FREEZE_SRC = 52.72, FB_FROM = 43.64, LAND = 48.636;
  const YT60_LAST = 790;
  const FREEZE_IMG = '/promo/_src/yt/0193.jpg';   // the 25 fps original of 52.72 s: the chord on the keys
  const STOP_LEN = HK.cut - HK.stop;
  const BRAKE = HK.freeze - HK.brake;   // speed falls as 1 - u²: the picture loses BRAKE/3 on the sound

  /* the search: three drags that miss, the speed menu, and then clicks along the bar that come faster
     and faster, none of them on the chord */
  /* the TikTok search, in the clip's 4.4 s: two drags and two double taps (10 s either way), then taps
     along the bar and more double taps, faster and faster, never on the chord */
  const TT_EV = (() => {
    if (!TT) return [];
    const ev = [];
    let seed = 7031, cur = FREEZE_SRC + (TTK.half - HK.unpause) + (TTK.s0 - TTK.half) * 0.5, t = TTK.s0;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const far = (p) => Math.abs(p - FREEZE_SRC) > 0.45;
    const gap = (dt) => { cur += dt * 0.5; t += dt; };
    ev.push({ t, kind: 'drag', b: t + 0.36, to: 49.3 }); cur = 49.3; t += 0.36;
    gap(0.36); ev.push({ t, kind: 'dtap', dir: 1, to: cur + 10 }); cur += 10;
    gap(0.36); ev.push({ t, kind: 'dtap', dir: -1, to: cur - 10 }); cur -= 10;
    gap(0.34); ev.push({ t, kind: 'drag', b: t + 0.3, to: 55.9 }); cur = 55.9; t += 0.3;
    let d = 0.34, k = 0;
    while (t + d < HK.stop - 0.08) {
      gap(d);
      if (k % 3 === 1) {
        const dir = cur > 58 ? -1 : cur < 46 ? 1 : rnd() < 0.5 ? -1 : 1;
        let to = clamp(cur + 10 * dir, 36, 69);
        if (!far(to)) to += 0.9;
        ev.push({ t, kind: 'dtap', dir, to }); cur = to;
      } else {
        let p;
        do p = 44 + rnd() * 22; while (!far(p) || Math.abs(p - cur) < 1.2);
        ev.push({ t, kind: 'tap', to: p }); cur = p;
      }
      d = Math.max(0.045, d * 0.82); k++;
    }
    return ev;
  })();
  const DRAGS = TT ? TT_EV.filter((e) => e.kind === 'drag').map((e) => ({ a: e.t, b: e.b, to: e.to }))
    : [{ a: 8.55, b: 8.85, to: 50.2 }, { a: 9.35, b: 9.58, to: 54.3 }, { a: 9.95, b: 10.15, to: 50.4 }];
  const SEEKS = TT ? TT_EV.filter((e) => e.kind !== 'drag').map((e) => ({ t: e.t, p: e.to, dir: e.dir, kind: e.kind })) : (() => {
    const out = [];
    let t = HK.frenzy, d = 0.36, seed = 20261122, prev = 51.75;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    while (t < 14.26) {
      let p;
      do p = 50.3 + rnd() * 6.2; while (Math.abs(p - FREEZE_SRC) < 0.4 || Math.abs(p - prev) < 1.1);
      out.push({ t, p });
      prev = p; t += d; d = Math.max(0.04, d * 0.8);
    }
    return out;
  })();
  const BOOMS = [...DRAGS.map((d) => d.b), ...SEEKS.map((s) => s.t)];
  const YSEG = TT ? (() => {
    const g = [{ a: 0, b: HK.brake, p: 48.0, s: 1 }, { a: HK.brake, b: HK.freeze, brake: 48.0 + HK.brake }, { a: HK.freeze, b: HK.unpause, hold: FREEZE_SRC }];
    let p = FREEZE_SRC, t = HK.unpause;
    g.push({ a: t, b: TTK.half, p, s: 1 }); p += TTK.half - t; t = TTK.half;
    for (const e of TT_EV) {
      g.push({ a: t, b: e.t, p, s: 0.5 }); p += (e.t - t) * 0.5;
      if (e.kind === 'drag') { g.push({ a: e.t, b: e.b, drag: [p, e.to] }); t = e.b; } else t = e.t;
      p = e.to;
    }
    g.push({ a: t, b: HK.stop, p, s: 0.5 });
    g.push({ a: HK.stop, b: 99, tape: true });
    return g;
  })() : (() => {
    const g = [];
    g.push({ a: 0, b: HK.brake, p: 48.0, s: 1 });
    g.push({ a: HK.brake, b: HK.freeze, brake: 48.0 + HK.brake });
    g.push({ a: HK.freeze, b: HK.unpause, hold: FREEZE_SRC });
    let p = FREEZE_SRC, t = HK.unpause;
    for (const d of DRAGS) {
      g.push({ a: t, b: d.a, p, s: 1 });
      const from = p + (d.a - t);
      g.push({ a: d.a, b: d.b, drag: [from, d.to] });
      p = d.to; t = d.b;
    }
    g.push({ a: t, b: HK.half, p, s: 1 });
    p += HK.half - t;
    g.push({ a: HK.half, b: SEEKS[0].t, p, s: 0.5 });
    SEEKS.forEach((s, i) => g.push({ a: s.t, b: i + 1 < SEEKS.length ? SEEKS[i + 1].t : HK.stop, p: s.p, s: 0.5 }));
    g.push({ a: HK.stop, b: 99, tape: true });
    return g;
  })();
  const lastSeg = YSEG[YSEG.length - 2];
  const posAtStop = lastSeg.p + (HK.stop - lastSeg.a) * 0.5;
  function ytPos(t) {
    let pos = 48.0;
    for (const g of YSEG) {
      if (t < g.a) break;
      if (g.hold !== undefined) pos = g.hold;
      else if (g.brake !== undefined) { const u = clamp((t - g.a) / BRAKE, 0, 1); pos = g.brake + BRAKE * (u - u * u * u / 3); }
      else if (g.drag) pos = lerp(g.drag[0], g.drag[1], easeCam(prog(t, g.a, g.b)));
      else if (g.tape) { const k = prog(t, HK.stop, HK.cut); pos = posAtStop + 0.5 * STOP_LEN * (k - k * k / 2); }
      else pos = g.p + (Math.min(t, g.b) - g.a) * g.s;
    }
    return pos;
  }
  const ytDragging = (t) => DRAGS.some((d) => t >= d.a && t < d.b);
  const onBar = TT ? (t) => DRAGS.some((d) => t >= d.a - 0.12 && t < d.b + 0.06) || SEEKS.some((s) => s.kind === 'tap' && t >= s.t - 0.05 && t < s.t + 0.08)
    : (t) => (t >= DRAGS[0].a - 0.25 && t < DRAGS[2].b + 0.03) || (t >= HK.frenzy - 0.2 && t < SEEKS[SEEKS.length - 1].t + 0.12);
  const MENU = TT ? { gear: TTK.gear, item: TTK.item, half: TTK.half } : { gear: 10.30, item: 10.47, half: 10.68 };

  /* every sound of the hook that is not the app's own piano. mix: A booms, then a FAHH; B booms only;
     C a FAHH on each drag, booms in the frenzy; D as A, with "ahh almost almost" over the frenzy instead of the FAHH */
  function hookEvents() {
    if (TT) return ttEvents();
    const ev = [];
    const clip = (o) => ev.push({ k: 'c', ...o });
    // the video's own sound: played through the brake into the chord, which rings out and is held
    clip({ t: 0, file: 'yt-norm', off: 48.0 - 40, dur: HK.freeze + 0.3, fadeOut: 0.26 });
    clip({ t: HK.freeze - 0.03, file: 'yt-drone', off: 0.2, dur: HK.unpause - HK.freeze + 0.25,
      env: [[0, 0], [0.4, 0.8], [HK.unpause - HK.freeze - 0.2, 0.62], [HK.unpause - HK.freeze + 0.22, 0]] });
    for (const g of YSEG) {
      if (g.hold !== undefined || g.drag || g.tape || g.brake !== undefined || g.a === 0) continue;
      if (g.s === 1) clip({ t: g.a, file: 'yt-norm', off: g.p - 40, dur: g.b - g.a });
      else clip({ t: g.a, file: 'yt-slow', off: (g.p - 50) * 2, dur: g.b - g.a, fadeIn: 0.004, fadeOut: 0.006 });
    }
    // the tape stops: speed and pitch fall together, the top goes, the level goes
    clip({ t: HK.stop, file: 'yt-slow', off: (posAtStop - 50) * 2, dur: STOP_LEN, tape: true });
    // the mouse
    for (const t of [HK.freeze - 0.02, HK.unpause, ...DRAGS.map((d) => d.a), MENU.gear, MENU.item, MENU.half]) ev.push({ k: 's', t, kind: 'mclick' });
    for (const d of DRAGS) for (let t = d.a + 0.03; t < d.b; t += 0.045) ev.push({ k: 's', t, kind: 'tick' });
    for (const s of SEEKS) ev.push({ k: 's', t: s.t, kind: 'mclick' });
    // the freeze lands as one hit: the click, a low F, the ring
    ev.push({ k: 's', t: HK.freeze, kind: 'freeze' });
    ev.push({ k: 's', t: HK.freeze + 0.1, kind: 'scribble' });
    ev.push({ k: 's', t: HK.freeze + 1.98, kind: 'drop' });
    // every miss: the boom (C: a FAHH on the drags)
    DRAGS.forEach((d) => {
      ev.push({ k: 'c', t: d.b - 0.05, file: 'sfx/vine-boom.mp3', bus: 'boom', gain: 0.6, mix: 'ABD' });
      ev.push({ k: 'c', t: d.b - 0.14, file: 'sfx/fahh.mp3', bus: 'boom', gain: 2.6, mix: 'C' });
    });
    SEEKS.forEach((s) => ev.push({ k: 'c', t: s.t - 0.05, file: 'sfx/vine-boom.mp3', bus: 'boom', gain: 0.6 }));
    ev.push({ k: 'c', t: SEEKS[SEEKS.length - 1].t + 0.02, file: 'sfx/fahh.mp3', bus: 'boom', gain: 3.2, mix: 'A' });
    // D: "ahh… almost… almost… almost" over the frenzy, ending as the tape stops (its last word ends
    // 2.82 s in; the ahh comes in just as the clicks start)
    ev.push({ k: 'c', t: HK.stop - 2.82, file: 'sfx/almost.wav', gain: 2.4, mix: 'D' });
    // strings under the search: an F and its fifth, and a wrong note more with each miss
    const CL = [54, 64, 59, 73, 74, 69, 63, 67, 70, 66, 61, 76, 57, 72];
    ev.push({ k: 'str', t: HK.unpause, midi: 41, g: 1 }, { k: 'str', t: HK.unpause, midi: 48, g: 0.7 });
    BOOMS.forEach((t, i) => { if (i < 3 || (i - 3) % 2 === 0) { const m = CL[Math.min(CL.length - 1, i < 3 ? i : 3 + (i - 3) / 2)]; ev.push({ k: 'str', t, midi: m, g: 0.6 }); } });
    ev.push({ k: 'str', t: HK.half, midi: 73, g: 0.5 });
    // Fallboard: its piano fades in under the stopping tape; a swell into the cut, and a hit on it
    ev.push({ k: 'bus', t0: HK.fbAudio, t1: HK.cut, from: 0, to: 1 });
    ev.push({ k: 's', t: HK.cut - 0.7, kind: 'swell' });
    ev.push({ k: 's', t: HK.cut, kind: 'impact' });
    for (const t of [HK.pause, ...HK.steps, HK.playOn]) ev.push({ k: 's', t: t - 0.07, kind: 'mclick' });
    ev.push({ k: 's', t: HK.steps[3] + 0.06, kind: 'scribble' });
    ev.push({ k: 's', t: HK.steps[3] + 0.02, kind: 'chime' });
    ev.push({ k: 's', t: HK.end - 0.05, kind: 'whoosh' });
    ev.push({ k: 's', t: HK.end + 0.55, kind: 'shimmer' });
    return ev.map((e) => ({ ...e, keep: true }));
  }

  /* the TikTok cut's sounds: the video from a wider stretch of it, a finger's taps, a boom on every
     miss, and "ahh… almost, almost, almost" over the whole search */
  function ttEvents() {
    const ev = [];
    const clip = (o) => ev.push({ k: 'c', ...o });
    clip({ t: 0, file: 'yt-norm-w', off: 48.0 - 35, dur: HK.freeze + 0.3, fadeOut: 0.26 });
    clip({ t: HK.freeze - 0.03, file: 'yt-drone', off: 0.2, dur: HK.unpause - HK.freeze + 0.25,
      env: [[0, 0], [0.4, 0.8], [HK.unpause - HK.freeze - 0.2, 0.62], [HK.unpause - HK.freeze + 0.22, 0]] });
    for (const g of YSEG) {
      if (g.hold !== undefined || g.drag || g.tape || g.brake !== undefined || g.a === 0 || g.b - g.a < 0.004) continue;
      if (g.s === 1) clip({ t: g.a, file: 'yt-norm-w', off: g.p - 35, dur: g.b - g.a });
      else clip({ t: g.a, file: 'yt-slow-w', off: (g.p - 35) * 2, dur: g.b - g.a, fadeIn: 0.004, fadeOut: 0.006 });
    }
    clip({ t: HK.stop, file: 'yt-slow-w', off: (posAtStop - 35) * 2, dur: STOP_LEN, tape: true });
    const taps = [TTK.tap, HK.freeze - 0.02, HK.freeze + 0.3, HK.unpause - 0.32, HK.unpause, MENU.gear, MENU.item, MENU.half, ...DRAGS.map((d) => d.a)];
    for (const s of SEEKS) { taps.push(s.t); if (s.kind === 'dtap') taps.push(s.t - 0.09); }
    for (const t of taps) ev.push({ k: 's', t, kind: 'mtap' });
    for (const d of DRAGS) for (let t = d.a + 0.03; t < d.b; t += 0.045) ev.push({ k: 's', t, kind: 'tick' });
    ev.push({ k: 's', t: HK.freeze, kind: 'freeze' });
    ev.push({ k: 's', t: HK.freeze + 0.05, kind: 'scribble' });
    for (const t of BOOMS) ev.push({ k: 'c', t: t - 0.05, file: 'sfx/vine-boom.mp3', bus: 'boom', gain: 0.6 });
    clip({ t: TTK.clipAt, file: 'sfx/almost-long.wav', gain: 2.4 });
    const CL = [54, 64, 59, 73, 74, 69, 63, 67, 70, 66, 61, 76, 57, 72];
    ev.push({ k: 'str', t: HK.unpause, midi: 41, g: 1 }, { k: 'str', t: HK.unpause, midi: 48, g: 0.7 });
    BOOMS.forEach((t, i) => { if (i < 3 || (i - 3) % 2 === 0) { const m = CL[Math.min(CL.length - 1, i < 3 ? i : 3 + (i - 3) / 2)]; ev.push({ k: 'str', t, midi: m, g: 0.6 }); } });
    ev.push({ k: 'bus', t0: HK.fbAudio, t1: HK.cut, from: 0, to: 1 });
    ev.push({ k: 's', t: HK.cut - 0.7, kind: 'swell' });
    ev.push({ k: 's', t: HK.cut, kind: 'impact' });
    for (const t of [HK.pause, ...HK.steps, HK.playOn]) ev.push({ k: 's', t: t - 0.07, kind: 'mtap' });
    ev.push({ k: 's', t: HK.steps[3] + 0.06, kind: 'scribble' });
    ev.push({ k: 's', t: HK.steps[3] + 0.02, kind: 'chime' });
    ev.push({ k: 's', t: HK.end - 0.05, kind: 'whoosh' });
    ev.push({ k: 's', t: HK.end + 0.55, kind: 'shimmer' });
    return ev.map((e) => ({ ...e, keep: true }));
  }

  const PLAY_D = 'M 12,26 18.5,22 18.5,14 12,10 z M 18.5,22 25,18 25,18 18.5,14 z';
  const PAUSE_D = 'M 12,26 16,26 16,10 12,10 z M 21,26 25,26 25,10 21,10 z';
  const ytWide = (pos) => `/promo/_src/yt25w/${String(clamp(Math.round((pos - 35) * 25), 0, 874)).padStart(4, '0')}.jpg`;
  const ytSrc = (pos) => (TT && (pos < 45 || pos > 58.1)) ? ytWide(pos) : `/promo/_src/yt60/${String(clamp(Math.round((pos - SRC0) * 60), 0, YT60_LAST)).padStart(4, '0')}.jpg`;
  const ytThumb = (pos) => TT ? ytWide(pos) : `/promo/_src/yt/${String(clamp(Math.round((pos - SRC0) * 25), 0, 324)).padStart(4, '0')}.jpg`;
  async function showImg(img, src) { if (img.dataset.src !== src) { img.dataset.src = src; img.src = src; await img.decode().catch(() => {}); } }

  const drawOn = (t, t0) => bezier(0.3, 0.1, 0.2, 1)(prog(t, t0, t0 + 0.5));

  /* a path of [time, point] keys, eased between */
  function along(t, keys) {
    let p = keys[0][1];
    for (let i = 0; i < keys.length; i++) {
      if (t >= keys[i][0]) p = keys[i][1];
      if (i + 1 < keys.length && t >= keys[i][0] && t < keys[i + 1][0]) {
        const e = easeCam(prog(t, keys[i][0], keys[i + 1][0]));
        p = { x: lerp(keys[i][1].x, keys[i + 1][1].x, e), y: lerp(keys[i][1].y, keys[i + 1][1].y, e) };
      }
    }
    return p;
  }

  /* the cursor: resting on the video, a click to pause and one to play, three drags, the speed menu,
     then the clicks along the bar */
  const YT_CLICK = { x: 590, y: 468 };
  function ytCursor(t) {
    const pr = $('ytProg').getBoundingClientRect();
    const barX = (pos) => pr.left + (pos / YT_DUR) * pr.width, barY = pr.bottom - 7.5;
    const at = (pos) => ({ x: barX(pos), y: barY });
    const ctr = (id, dx) => { const r = $(id).getBoundingClientRect(); return { x: r.left + (dx ?? r.width / 2), y: r.top + r.height / 2 }; };
    const item = (id) => ctr(id, Math.min(90, $(id).getBoundingClientRect().width * 0.4));
    const keys = [[0, { x: 676, y: 548 }], [HK.freeze - 0.5, YT_CLICK], [HK.unpause + 0.06, YT_CLICK]];
    let p0 = FREEZE_SRC, t0 = HK.unpause;
    for (const d of DRAGS) {
      const from = p0 + (d.a - t0);
      keys.push([d.a - 0.06, at(from)], [d.a, at(from)], [d.b, at(d.to)]);
      p0 = d.to; t0 = d.b;
    }
    keys.push([MENU.gear - 0.04, ctr('ytGear')], [MENU.gear + 0.03, ctr('ytGear')]);
    keys.push([MENU.item - 0.04, item('ytSpeedItem')], [MENU.item + 0.03, item('ytSpeedItem')]);
    keys.push([MENU.half - 0.04, item('ytHalf')], [MENU.half + 0.1, item('ytHalf')]);
    keys.push([11.4, { x: 1000, y: 612 }], [HK.frenzy - 0.12, at(54.4)]);
    let prevT = HK.frenzy - 0.12;
    for (const s of SEEKS) {
      const move = Math.min(0.16, (s.t - prevT) * 0.75);
      keys.push([s.t - move, keys[keys.length - 1][1]], [s.t, at(s.p)]);
      prevT = s.t;
    }
    keys.sort((a, b) => a[0] - b[0]);
    return along(t, keys);
  }
  const ytPress = (t) => ytDragging(t) || [HK.freeze, HK.unpause + 0.02, MENU.gear, MENU.item, MENU.half, ...SEEKS.map((s) => s.t)].some((x) => t >= x - 0.05 && t < x + 0.03);

  /* what the search does to the picture: every miss shakes it, punches in and splits its colour, and
     it all wears on: the hand gets less steady, the colour drains, the edges darken */
  function ytFx(t) {
    let sx = 0, sy = 0, rot = 0, ca = 0, m = 0;
    BOOMS.forEach((tb, k) => {
      const u = t - tb;
      if (u < 0) return;
      m++;
      if (u > 0.7) return;
      const s = Math.min(1, 0.5 + 0.035 * k), e = Math.exp(-u / 0.13);
      sx += s * e * Math.sin(2 * Math.PI * 14 * u + k * 1.7) * 15;
      sy += s * e * Math.cos(2 * Math.PI * 11 * u + k * 2.3) * 10;
      rot += s * e * Math.sin(2 * Math.PI * 9 * u + k) * 0.8;
      ca += s * Math.exp(-u / 0.12) * 8;
    });
    const w = ease(t, HK.unpause, HK.stop, (x) => x);
    sx += w * 3.2 * (Math.sin(t * 2.1) + 0.6 * Math.sin(t * 3.7 + 1));
    sy += w * 2.4 * (Math.sin(t * 1.7 + 2) + 0.5 * Math.sin(t * 4.3));
    const grade = clamp(m / 16, 0, 1);
    return {
      sx: clamp(sx, -20, 20), sy: clamp(sy, -16, 16), rot: clamp(rot, -1.4, 1.4),
      scale: 1 + 0.032 * ease(t, HK.unpause - 0.1, HK.unpause + 0.4) + (pulseAt(t, MISS_HITS) - 1),
      ca: Math.min(13, ca), sat: 1 - 0.42 * grade, con: 1 + 0.1 * grade, vig: grade,
    };
  }
  /* the whip at the cut: both sides move down, the way the notes fall, smeared */
  const whipOut = (t) => easeIn(prog(t, HK.cut - 0.16, HK.cut));
  const whipIn = (t) => 1 - easeOut(prog(t, HK.cut, HK.cut + 0.26));
  function setFx(blurY, caPx) {
    $('fxVBb').setAttribute('stdDeviation', `0 ${blurY.toFixed(2)}`);
    $('fxCAr').setAttribute('dx', caPx.toFixed(2));
    $('fxCAb').setAttribute('dx', (-caPx).toFixed(2));
  }

  /* ------------------------------------------------------------------ the chord, highlighted (?hl=1..4)
     1 a white ring drawn by hand · 2 a spotlight with the chord's name · 3 corner marks that lock
     on · 4 an arrow drawn from the headline to the chord. In white, over either picture. */
  const HL = +(Q.get('hl') || 1);
  /* the chord's notes where they meet the keys, in the video's 1280×720 frame */
  const YT_BOX = { x0: 772, y0: 290, x1: 966, y1: 338 };
  const ZO = { x: (YT_BOX.x0 + YT_BOX.x1) / 2, y: (YT_BOX.y0 + YT_BOX.y1) / 2 };
  /* the pause: a bump in, a slow creep closer as it waits, a snap back with a little overshoot */
  /* a held frame creeps in: fast at first, then slower and slower, never back (ln, so its slope only
     falls); letting go springs it back with a little overshoot */
  const creep = (u, A, D) => (A * Math.log(1 + u / 0.03)) / Math.log(1 + D / 0.03);
  function hold(t, a, b, A) {
    if (t < a) return 0;
    if (t < b) return creep(t - a, A, b - a);
    const u = t - b;
    return u > 1.2 ? 0 : A * Math.exp(-u / 0.1) * Math.cos((2 * Math.PI * u) / 0.42);
  }
  const pauseZoom = (t) => 1 + hold(t, HK.freeze, HK.unpause, 0.1);
  /* a tapered stroke through points, pressed on quickly and lifted at its end */
  function taper(pts, width, lift = 0.16) {
    const L = [], R = [], n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, s = pts[i].s;
      const w = width * Math.min(1, 0.25 + s / 0.08) * (0.85 + 0.15 * Math.sin(Math.PI * s)) * Math.min(1, (1 - s) / lift + 0.12);
      const nx = (-dy / len) * w / 2, ny = (dx / len) * w / 2;
      L.push(`${(pts[i].x + nx).toFixed(2)},${(pts[i].y + ny).toFixed(2)}`);
      R.push(`${(pts[i].x - nx).toFixed(2)},${(pts[i].y - ny).toFixed(2)}`);
    }
    return `M${L.join('L')}L${R.reverse().join('L')}Z`;
  }
  function ringPts(ring, p) {
    const sweep = Math.PI * 2 * 1.14, a0 = -2.55, tilt = -0.07, N = 140, pts = [];
    const n = Math.max(2, Math.round(N * p));
    for (let i = 0; i <= n; i++) {
      const s = i / N, th = a0 + sweep * s;
      const r = (1 + 0.028 * Math.sin(2 * th + 1.3) + 0.016 * Math.sin(3 * th + 0.4)) * lerp(0.95, 1.07, s);
      const x = Math.cos(th) * ring.rx * r, y = Math.sin(th) * ring.ry * r;
      pts.push({ x: ring.cx + x * Math.cos(tilt) - y * Math.sin(tilt), y: ring.cy + x * Math.sin(tilt) + y * Math.cos(tilt), s });
    }
    return pts;
  }
  const SHADOW = 'filter:drop-shadow(0 1px 2px rgb(0 0 0 / 0.85)) drop-shadow(0 0 12px rgb(0 0 0 / 0.55))';
  let arrowFrom = null;
  /* o: { t0, t1, box (screen px), head (the headline's element, for the arrow) } */
  function drawHL(t, o) {
    if (TT) return drawScrawl(t, o);
    const svg = $('hl');
    if (!o || t < o.t0 - 0.12 || t > o.t1 + 0.02) { svg.innerHTML = ''; if (!o || t > o.t1) arrowFrom = null; return; }
    const b = o.box, cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, w = b.x1 - b.x0, h = b.y1 - b.y0;
    const p = drawOn(t, o.t0), a = 1 - ease(t, o.t1 - 0.28, o.t1, easeIn), dimIn = ease(t, o.t0 - 0.1, o.t0 + 0.35) * a;
    const radial = (k) => `<defs><radialGradient id="hlR" gradientUnits="userSpaceOnUse" cx="${cx}" cy="${cy}" r="${w * 0.72}" gradientTransform="translate(${cx} ${cy}) scale(1 ${((h + 60) / w).toFixed(3)}) translate(${-cx} ${-cy})"><stop offset="0.62" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="${k}"/></radialGradient></defs><rect width="${W}" height="${H}" fill="url(#hlR)" opacity="${dimIn.toFixed(3)}"/>`;
    let s = '';
    if (HL === 1) {
      s += radial(0.7);
      s += `<path d="${taper(ringPts({ cx, cy, rx: w / 2 + 26, ry: h / 2 + 18 }, p), 4.4)}" fill="#fff" opacity="${a.toFixed(3)}" style="${SHADOW}"/>`;
    } else if (HL === 2) {
      const pad = 16, x = b.x0 - pad, y = b.y0 - pad, ww = w + 2 * pad, hh = h + 2 * pad, r = Math.min(hh / 2, 18);
      s += `<defs><filter id="hlSoft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="10"/></filter>
        <mask id="hlM" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#fff"/><rect x="${x}" y="${y}" width="${ww}" height="${hh}" rx="${r}" fill="#000" filter="url(#hlSoft)"/></mask></defs>
        <rect width="${W}" height="${H}" fill="#000" opacity="${(0.72 * dimIn).toFixed(3)}" mask="url(#hlM)"/>
        <rect x="${x}" y="${y}" width="${ww}" height="${hh}" rx="${r}" fill="none" stroke="#fff" stroke-opacity="0.9" stroke-width="1.75" pathLength="1" stroke-dasharray="${p.toFixed(4)} 2" opacity="${a.toFixed(3)}"/>`;
      const k = ease(t, o.t0 + 0.22, o.t0 + 0.55), cyChip = y + hh + 24 + (1 - k) * 8;
      s += `<g opacity="${(k * a).toFixed(3)}" transform="translate(${cx.toFixed(1)} ${cyChip.toFixed(1)})"><rect x="-50" y="-15" width="100" height="30" rx="15" fill="#fff"/><text x="-1" y="5.5" text-anchor="middle" font-family="Inter" font-weight="700" font-size="15" fill="#111" letter-spacing="-0.01em">F7<tspan font-size="11.5" dy="-4.5" font-weight="600">add13</tspan></text></g>`;
    } else if (HL === 3) {
      s += radial(0.55);
      const u = t - o.t0, sc = 1 + 0.42 * Math.exp(-u / 0.085) * Math.cos((2 * Math.PI * u) / 0.46), op = clamp(u / 0.07, 0, 1) * a;
      const pad = 14, hx = (w / 2 + pad) * sc, hy = (h / 2 + pad) * sc, arm = Math.min(24, w * 0.2);
      const d = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
        const X = cx + sx * hx, Y = cy + sy * hy;
        return `M${X},${Y - sy * arm}L${X},${Y}L${X - sx * arm},${Y}`;
      }).join('');
      s += `<path d="${d}" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" opacity="${op.toFixed(3)}" style="${SHADOW}"/>`;
    } else if (HL === 4) {
      s += radial(0.6);
      const em = o.head && o.head.querySelector('em');
      if (!arrowFrom && em && em.getBoundingClientRect().width > 0) { const r = em.getBoundingClientRect(); arrowFrom = { x: r.left + r.width * 0.6, y: r.bottom + 12 }; }
      if (arrowFrom) {
        const A0 = arrowFrom, A1 = { x: cx + w * 0.04, y: b.y0 - 16 };
        const C = { x: lerp(A0.x, A1.x, 0.5) + (A1.y - A0.y) * 0.32, y: lerp(A0.y, A1.y, 0.45) };
        const pa = bezier(0.35, 0, 0.2, 1)(prog(t, o.t0 + 0.12, o.t0 + 0.55)), N = 60, pts = [];
        for (let i = 0; i <= Math.max(2, Math.round(N * pa)); i++) {
          const u = i / N, x = (1 - u) * (1 - u) * A0.x + 2 * (1 - u) * u * C.x + u * u * A1.x, y = (1 - u) * (1 - u) * A0.y + 2 * (1 - u) * u * C.y + u * u * A1.y;
          pts.push({ x: x + Math.sin(u * 9) * 1.2, y, s: u });
        }
        s += `<path d="${taper(pts, 4.6, 0.04)}" fill="#fff" opacity="${a.toFixed(3)}" style="${SHADOW}"/>`;
        if (pa > 0.96) {
          const e = pts[pts.length - 1], q = pts[pts.length - 4], ang = Math.atan2(e.y - q.y, e.x - q.x), L = 15 * ease(t, o.t0 + 0.53, o.t0 + 0.62);
          const head = [-0.5, 0.5].map((da) => `M${e.x},${e.y}L${e.x - Math.cos(ang + da) * L},${e.y - Math.sin(ang + da) * L}`).join('');
          s += `<path d="${head}" fill="none" stroke="#fff" stroke-width="4.2" stroke-linecap="round" opacity="${a.toFixed(3)}" style="${SHADOW}"/>`;
        }
      }
    }
    svg.innerHTML = s;
  }
  /* the chord's box on screen: in the video, through the pause zoom; in Fallboard, through the camera */
  function ytHL(t) {
    let m;
    if (TT) { const pm = phoneMap(t); m = (x, y) => pm.map({ x: x * VK * PH.k, y: PH.y + (48 + y * VK) * PH.k }); }
    else { const z = pauseZoom(t); m = (x, y) => ({ x: ZO.x + (x - ZO.x) * z, y: ZO.y + (y - ZO.y) * z }); }
    const p0 = m(YT_BOX.x0, YT_BOX.y0), p1 = m(YT_BOX.x1, YT_BOX.y1);
    return { t0: HK.freeze + (TT ? 0.05 : 0.1), t1: HK.unpause, box: { x0: p0.x, y0: p0.y, x1: p1.x, y1: p1.y }, head: $('headA'),
      from: () => document.querySelector('#ttCap1 .fill .this') };
  }
  function fbHL(t) {
    const r = fbRing, m = (x, y) => stageToScreen(t, { x, y });
    const p0 = m(r.cx - r.rx + 14, r.cy - 44), p1 = m(r.cx + r.rx - 14, r.cy + 16);
    return { t0: HK.steps[3] + 0.06, t1: HK.playOn, box: { x0: p0.x, y0: p0.y, x1: p1.x, y1: p1.y }, head: $('headA'), from: () => document.querySelector('#ttCap4 .fill') };
  }

  /* a pulse: the picture jumps in a little the moment the note hits (at its top two frames later),
     then falls back softly */
  const bump = (u, A, k = 0.15, drop = false) => (u < 0 ? 0 : drop ? A * (1 + u / k) * Math.exp(-u / k) : A * (1 - Math.exp(-u / 0.012)) * Math.exp(-u / k));
  function pulseAt(t, hits) {
    let z = 0;
    for (const h of hits) { const u = t - h.t; if (u > -0.2 && u < 1.2) z += bump(u, h.A, h.k, h.drop); }
    return 1 + z;
  }
  /* the video's right-hand chords up to the pause, found in its sound (its bars 25-27, about 1.03x
     the score's time); after the pause only the misses */
  const YT_CHORDS = [48.38, 48.84, 49.33, 49.78, 50.25, 50.70, 50.95, 51.22, 51.44, 52.30];
  const YT_HITS = YT_CHORDS.map((s, i) => ({ t: s - 48.0, A: i === 8 ? 0.026 : 0.015 }));
  const MISS_HITS = BOOMS.map((t, k) => ({ t, A: Math.min(0.04, 0.026 + 0.0007 * k) }));
  const YT_PZ = { x: W / 2, y: 330 }, FB_PZ = { x: W / 2, y: H * 0.62 };
  /* Fallboard's: in at full zoom on the cut and quickly back, then a pulse on every right-hand chord
     it plays and every step (from the score, on the film's clock); the found chord, held, creeps in */
  let FB_HITS = [];
  function buildHits() {
    const groups = new Map();
    for (const n of etude.notes) {
      if (n.midi < 58) continue;
      const k = Math.round(n.t0 * 1000);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(n);
    }
    // (the shot's first play starts on its anchor; a play pressed later sounds LEAD after the press)
    const sPause = FB_FROM + (HK.pause - HK.fbAudio);
    const hits = [];
    for (const [k, ns] of groups) {
      if (ns.length < 3) continue;
      const s = k / 1000, dur = Math.max(...ns.map((n) => n.t1 - n.t0)), land = Math.abs(s - LAND) < 0.01;
      let t;
      if (s < sPause) t = HK.fbAudio + (s - FB_FROM);
      else if (land) { t = HK.steps[3] + 0.012; hits.push({ t: HK.playOn + LEAD, A: 0.015 }); }
      else if (s > LAND) t = HK.playOn + LEAD + (s - LAND);
      else continue;
      if (t < HK.cut + 0.3 || t > HK.end || land) continue;
      hits.push({ t, A: dur > 0.8 ? 0.026 : 0.015 });
    }
    for (const s of HK.steps.slice(0, 3)) hits.push({ t: s + 0.012, A: 0.008 });
    FB_HITS = [{ t: HK.cut, A: 0.15, k: 0.13, drop: true }, ...hits].sort((x, y) => x.t - y.t);
  }
  const fbPulse = (t) => (HOOKY && t >= HK.cut && t < HK.end + 0.1 ? pulseAt(t, FB_HITS) + (TT ? (t >= HK.pause && t < HK.playOn ? creep(t - HK.pause, 0.08, HK.playOn - HK.pause) : 0) : hold(t, HK.steps[3] + 0.012, HK.playOn, 0.06)) : 1);
  /* a stage point to the screen, through the camera and the lunge */
  function stageToScreen(t, p) {
    const v = viewAt(t), z = fbPulse(t);
    const x = p.x * v.s + v.tx, y = p.y * v.s + v.ty;
    return { x: FB_PZ.x + (x - FB_PZ.x) * z, y: FB_PZ.y + (y - FB_PZ.y) * z + hookDy };
  }

  /* a scrub moves the picture the way the playhead goes (back: left), a few pixels and smeared
     along it: with the drag's speed while dragging, a short kick on each click along the bar */
  function scrubShift(t) {
    let x = 0;
    if (ytDragging(t)) x += clamp((ytPos(t + 0.004) - ytPos(t - 0.004)) / 0.008 / 26, -1, 1) * 11;
    let prev = ytPos(HK.frenzy - 0.01);
    for (const s of SEEKS) {
      const u = t - s.t;
      if (u >= 0 && u < 0.8) x += Math.sign(s.p - prev) * Math.min(1, Math.abs(s.p - prev) / 3) * bump(u, 12 / 0.75, 0.11);
      prev = s.p;
    }
    return clamp(x, -16, 16);
  }

  /* ================================================================== the TikTok cut's own parts
     YouTube's iPhone web page (the real page, captured; its player drawn here with its own icons), a
     scrappy red circle and a blinking arrow drawn with a finger, and captions in TikTok's own style */
  const PH = { k: W / 390, y: 168 };          // the page on the 9:16 frame
  /* the whole phone zooms: cut in to 1.7x on the chord while paused (and creeping), and pulses on the
     chords about the player's middle */
  const ttPause = (t) => (TT && t >= HK.freeze && t < HK.unpause ? 1.7 + creep(t - HK.freeze, 0.1, HK.unpause - HK.freeze) : 1);
  const TT_C = { x: ZO.x * (390 / 1280) * (W / 390), y: 168 + (48 + ZO.y * (390 / 1280)) * (W / 390) };
  const TT_P = { x: 195 * (W / 390), y: 168 + (48 + 110) * (W / 390) };
  function phoneMap(t) {
    const zc = ttPause(t), zp = pulseAt(t, YT_HITS);
    return { zc, zp, map: (b) => { const x = TT_P.x + (b.x - TT_P.x) * zp, y = TT_P.y + (b.y - TT_P.y) * zp; return { x: TT_C.x + (x - TT_C.x) * zc, y: TT_C.y + (y - TT_C.y) * zc }; } };
  }
  const VK = 390 / 1280;                      // the video in the page's player
  const VH = (H - PH.y) / PH.k;               // how much of the page the frame shows
  const MYT_PLAY = 'M6 4.8v14.4a1.5 1.5 0 002.3 1.27l11.3-7.2a1.5 1.5 0 000-2.54L8.3 3.53A1.5 1.5 0 006 4.8Z';
  const MYT_PAUSE = 'M6.5 3A1.5 1.5 0 005 4.5v15A1.5 1.5 0 006.5 21h2a1.5 1.5 0 001.5-1.5v-15A1.5 1.5 0 008.5 3h-2Zm9 0A1.5 1.5 0 0014 4.5v15a1.5 1.5 0 001.5 1.5h2a1.5 1.5 0 001.5-1.5v-15A1.5 1.5 0 0017.5 3h-2Z';
  /* up with the tap before the pause; a tap after it clears them off the chord; one more brings them back for play */
  const ttControls = (t) => {
    if (t < TTK.tap) return 0;
    const up = ease(t, TTK.tap, TTK.tap + 0.12) * (1 - ease(t, HK.freeze + 0.3, HK.freeze + 0.42)) + ease(t, HK.unpause - 0.32, HK.unpause - 0.2);
    return Math.min(1, up) * (1 - ease(t, HK.stop, HK.stop + 0.2));
  };
  function ttDtap(t) {
    let o = null;
    for (const s of SEEKS) if (s.kind === 'dtap' && t >= s.t && t < s.t + 0.6) o = { dir: s.dir, u: t - s.t };
    return o;
  }
  function ttSheets(t) {
    const g = MENU.gear, it = MENU.item, hf = MENU.half;
    $('mytShade').style.opacity = (ease(t, g, g + 0.06) * (1 - ease(t, hf + 0.01, hf + 0.08))).toFixed(3);
    const s1 = $('mytSheet1'), s2 = $('mytSheet2');
    if (t >= g && t < it) {
      s1.style.display = 'block';
      s1.style.top = (VH - 24 - 405).toFixed(1) + 'px';
      s1.style.transform = `translateY(${((1 - easeOut(prog(t, g, g + 0.07))) * 440).toFixed(1)}px)`;
      $('mytRowSpeed').style.top = '116px';
      $('mytRowSpeed').style.opacity = t >= it - 0.05 ? 1 : 0;
    } else s1.style.display = 'none';
    if (t >= it && t < hf + 0.09) {
      s2.style.display = 'block';
      s2.style.top = (VH - 24 - 416).toFixed(1) + 'px';
      s2.style.transform = `translateY(${(ease(t, hf + 0.01, hf + 0.08, easeIn) * 440).toFixed(1)}px)`;
      for (const r of s2.querySelectorAll('.sp')) {
        const v = r.dataset.v;
        r.classList.toggle('on', v === (t >= hf ? '0.5x' : 'Normal'));
        r.classList.toggle('hl', v === '0.5x' && t >= hf - 0.05 && t < hf + 0.02);
      }
    } else s2.style.display = 'none';
  }
  async function drawMYT(t) {
    const pos = ytPos(t), frozen = t >= HK.freeze && t < HK.unpause;
    await showImg($('mytFrame'), frozen ? FREEZE_IMG : ytSrc(pos));
    const sink = ease(t, HK.stop, HK.cut, easeIn);
    const sx = scrubShift(t) * 2, smear = Math.abs(sx) * 0.55;
    $('fxHBb').setAttribute('stdDeviation', `${smear.toFixed(2)} 0`);
    $('mytFrame').style.filter = [smear > 0.3 ? 'url(#fxHB)' : '', sink > 0 ? `brightness(${(1 - 0.5 * sink).toFixed(3)}) saturate(${(1 - 0.6 * sink).toFixed(3)})` : ''].join(' ').trim();
    $('mytFrame').style.transform = sx ? `translate(${sx.toFixed(2)}px, 0px)` : '';
    const pm = phoneMap(t);
    $('phone').style.transform = `translate(${TT_C.x.toFixed(2)}px, ${TT_C.y.toFixed(2)}px) scale(${pm.zc.toFixed(5)}) translate(${(-TT_C.x).toFixed(2)}px, ${(-TT_C.y).toFixed(2)}px) translate(${TT_P.x.toFixed(2)}px, ${TT_P.y.toFixed(2)}px) scale(${pm.zp.toFixed(5)}) translate(${(-TT_P.x).toFixed(2)}px, ${(-TT_P.y).toFixed(2)}px) translate(0px, ${PH.y}px) scale(${PH.k.toFixed(5)})`;
    // the controls: up from the tap before the pause; a double tap shows only its own sign and the bar
    const c = ttControls(t), dt = ttDtap(t), ui = c * (dt ? 0 : 1);
    $('mytDim').style.opacity = ui.toFixed(3);
    $('mytIcons').style.opacity = ui.toFixed(3);
    $('mytBar').style.opacity = c.toFixed(3);
    $('mytThin').style.opacity = (1 - c).toFixed(3);
    $('mytPPd').setAttribute('d', frozen ? MYT_PLAY : MYT_PAUSE);
    $('mytCur').textContent = fmt(pos);
    const frac = clamp(pos / YT_DUR, 0, 1);
    $('mytPlayed').style.width = (frac * 100).toFixed(3) + '%';
    $('mytLoaded').style.width = (Math.min(1, (pos + 24) / YT_DUR) * 100).toFixed(3) + '%';
    $('mytKnob').style.left = (frac * 100).toFixed(3) + '%';
    $('mytThinP').style.width = (frac * 100).toFixed(3) + '%';
    const drag = ytDragging(t);
    $('mytKnob').style.transform = `scale(${drag ? 1.45 : 1})`;
    const tip = $('mytTip');
    tip.style.opacity = drag ? 1 : 0;
    if (drag) {
      tip.style.left = clamp(30 + frac * 330, 74, 316).toFixed(1) + 'px';
      $('mytTipT').textContent = fmt(pos);
      await showImg($('mytTipImg'), ytThumb(pos));
    }
    for (const [id, dir] of [['mytDtapR', 1], ['mytDtapL', -1]]) {
      const el = $(id), on = dt && dt.dir === dir;
      el.style.opacity = on ? (dt.u < 0.4 ? 1 : 1 - (dt.u - 0.4) / 0.2).toFixed(3) : 0;
      el.style.transform = on ? `scale(${(1 + 0.18 * Math.exp(-dt.u / 0.05)).toFixed(3)})` : '';
    }
    ttSheets(t);
    // the wear of the search, and the whip at the cut
    const fx = ytFx(t), wo = whipOut(t), layer = $('myt');
    $('mytVig').style.opacity = (0.1 + 0.6 * fx.vig).toFixed(3);
    layer.style.transform = `translate(${fx.sx.toFixed(2)}px, ${(fx.sy + 90 * wo * wo).toFixed(2)}px) rotate(${fx.rot.toFixed(3)}deg) scale(${fx.scale.toFixed(4)})`;
    const blur = 26 * wo, ca = fx.ca + 6 * wo;
    setFx(blur, ca);
    const f = [];
    if (ca > 0.25) f.push('url(#fxCA)');
    if (blur > 0.25) f.push('url(#fxVB)');
    if (fx.vig > 0) f.push(`saturate(${fx.sat.toFixed(3)}) contrast(${fx.con.toFixed(3)})`);
    layer.style.filter = f.join(' ');
    drawTTCaps(t);
    drawHL(t, ytHL(t));
  }

  /* captions: white, a hard black outline, lowercase, in TikTok Sans; in with a two-frame pop */
  const TT_CAPS = [];
  const capT = (a, b, html, y, rot = 0) => TT_CAPS.push({ a, b, html, y, rot });
  function drawTTCaps(t) {
    TT_CAPS.forEach((c, i) => {
      let el = document.getElementById('ttCap' + i);
      if (!el) {
        el = document.createElement('div');
        el.className = 'cap'; el.id = 'ttCap' + i;
        el.innerHTML = `<div class="stroke">${c.html}</div><div class="fill">${c.html}</div>`;
        $('ttCap').appendChild(el);
      }
      const on = t >= c.a && t < c.b;
      el.style.display = on ? 'block' : 'none';
      if (on) { el.style.top = c.y + 'px'; el.style.transform = `translateY(-50%) rotate(${c.rot}deg) scale(${t - c.a < 2 / 60 ? 1.12 : 1})`; }
    });
  }

  /* drawn with a finger: a lumpy red loop that overshoots where it started, put down in 0.2 s at a
     jerky 12 fps; an arrow from the caption that blinks on and off */
  function drawScrawl(t, o) {
    const svg = $('hl');
    if (!o || t < o.t0 || t >= o.t1) { svg.innerHTML = ''; return; }
    const b = o.box, cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, rx = (b.x1 - b.x0) / 2 + 11, ry = (b.y1 - b.y0) / 2 + 10;
    const p = Math.min(1, (Math.floor((t - o.t0) * 12) + 1) / 12 / 0.2);
    const pts = [], N = 54, sweep = Math.PI * 2 * 1.2, a0 = -2.3;
    for (let i = 0; i <= Math.round(N * p); i++) {
      const s = i / N, th = a0 + sweep * s;
      const wob = 1 + 0.045 * Math.sin(3 * th + 0.7) + 0.018 * Math.sin(7 * th + 2.1) + 0.008 * Math.sin(11 * th + 0.3);
      const drift = 1 + 0.17 * s;
      pts.push(`${(cx + Math.cos(th) * rx * wob * drift + 2.5 * s).toFixed(1)},${(cy + Math.sin(th) * ry * wob * drift * (1 + 0.12 * s) - 3 * s).toFixed(1)}`);
    }
    const RED = '#ff2d2d', W_ = 4.4;
    let s = `<path d="M${pts.join('L')}" fill="none" stroke="${RED}" stroke-width="${W_}" stroke-linecap="round" stroke-linejoin="round"/>`;
    const from = o.from && o.from();
    if (from && t >= o.t0 + 0.2 && Math.floor((t - o.t0 - 0.2) / 0.22) % 2 === 0) {
      const r = from.getBoundingClientRect();
      const up = cy < r.top;
      const A0 = { x: r.left + r.width / 2, y: up ? r.top - 5 : r.bottom + 5 }, A1 = { x: cx - rx * 0.1, y: up ? cy + ry * 1.2 + 4 : cy - ry * 1.2 - 4 };
      const C = { x: (A0.x + A1.x) / 2 + 26, y: (A0.y + A1.y) / 2 };
      const ap = [];
      for (let i = 0; i <= 16; i++) {
        const u = i / 16, x = (1 - u) * (1 - u) * A0.x + 2 * (1 - u) * u * C.x + u * u * A1.x, y = (1 - u) * (1 - u) * A0.y + 2 * (1 - u) * u * C.y + u * u * A1.y;
        ap.push({ x: x + Math.sin(u * 7 + 1) * 1.2, y: y + Math.cos(u * 5) * 0.9 });
      }
      const e = ap[ap.length - 1], q = ap[ap.length - 3], ang = Math.atan2(e.y - q.y, e.x - q.x), L = 14;
      s += `<path d="M${ap.map((v) => v.x.toFixed(1) + ',' + v.y.toFixed(1)).join('L')}M${(e.x - Math.cos(ang - 0.6) * L).toFixed(1)},${(e.y - Math.sin(ang - 0.6) * L).toFixed(1)}L${e.x.toFixed(1)},${e.y.toFixed(1)}L${(e.x - Math.cos(ang + 0.5) * L * 1.1).toFixed(1)},${(e.y - Math.sin(ang + 0.5) * L * 1.1).toFixed(1)}" fill="none" stroke="${RED}" stroke-width="${W_}" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    svg.innerHTML = s;
  }

  async function ttInit() {
    $('phone').style.top = '0px';
    $('phone').style.transform = `translate(0px, ${PH.y}px) scale(${PH.k.toFixed(5)})`;
    $('mytVid').style.transform = `scale(${VK.toFixed(6)})`;
    $('ttCap').style.display = 'block';
    for (const c of ['1fae9', '1f940']) { const im = new Image(); im.src = `/promo/_src/emoji/${c}.png`; }
    // the page round the player: YouTube's own HTML, every style inlined (promo/scripts/capture-myt.js)
    $('mytPage').innerHTML = await (await fetch('/promo/_src/myt/page.html')).text();
    await Promise.all([...$('mytPage').querySelectorAll('img')].map((im) => im.decode().catch(() => {})));
    await document.fonts.ready;
  }

  async function drawYT(t) {
    const pos = ytPos(t);
    const frozen = t >= HK.freeze && t < HK.unpause;
    await showImg($('ytFrame'), frozen ? FREEZE_IMG : ytSrc(pos));
    // the tape stopping: the picture sinks with it
    const sink = ease(t, HK.stop, HK.cut, easeIn);
    const sx = scrubShift(t), smear = Math.abs(sx) * 0.55;
    $('fxHBb').setAttribute('stdDeviation', `${smear.toFixed(2)} 0`);
    $('ytFrame').style.filter = [smear > 0.3 ? 'url(#fxHB)' : '', sink > 0 ? `brightness(${(1 - 0.5 * sink).toFixed(3)}) saturate(${(1 - 0.6 * sink).toFixed(3)})` : ''].join(' ').trim();
    // the freeze: a bump in that keeps creeping closer, and the chord highlighted
    const z = pauseZoom(t), zp = pulseAt(t, YT_HITS);
    $('ytFrame').style.transformOrigin = '0 0';
    $('ytFrame').style.transform = z !== 1 || zp !== 1 || sx !== 0 ? `translate(${sx.toFixed(2)}px, 0px) translate(${YT_PZ.x}px, ${YT_PZ.y}px) scale(${zp.toFixed(5)}) translate(${-YT_PZ.x}px, ${-YT_PZ.y}px) translate(${ZO.x}px, ${ZO.y}px) scale(${z.toFixed(5)}) translate(${-ZO.x}px, ${-ZO.y}px)` : '';
    drawHL(t, ytHL(t));
    // the big centre icon when it pauses and plays
    const big = $('ytBig');
    const flash = (t0) => { const k = prog(t, t0, t0 + 0.55); return k > 0 && k < 1 ? k : 0; };
    const fp = flash(HK.freeze), fu = flash(HK.unpause), k = fp || fu;
    $('ytBigIcon').innerHTML = `<path d="${fp ? PAUSE_D : PLAY_D}"/>`;
    big.style.opacity = k ? (1 - k).toFixed(3) : 0;
    big.style.transform = `scale(${(1 + k * 0.9).toFixed(3)})`;
    // the controls: up from the start, as the mouse is on the video
    const chrome = 1 - ease(t, HK.stop + 0.2, HK.stop + 0.5);
    $('ytChrome').style.opacity = chrome.toFixed(3);
    $('ytGrad').style.opacity = (0.35 + 0.65 * chrome).toFixed(3);
    const frac = pos / YT_DUR;
    $('ytPlayed').style.width = (frac * 100).toFixed(3) + '%';
    $('ytLoaded').style.width = (Math.min(1, (pos + 24) / YT_DUR) * 100).toFixed(3) + '%';
    $('ytPlayPath').setAttribute('d', frozen ? PLAY_D : PAUSE_D);
    $('ytTime').textContent = fmt(pos) + ' / ' + fmt(YT_DUR);
    const cur = ytCursor(t), pr = $('ytProg').getBoundingClientRect();
    const near = onBar(t);
    $('ytRail').style.height = near ? '5px' : '3px';
    $('ytKnob').style.left = (frac * 100).toFixed(3) + '%';
    $('ytKnob').style.transform = `scale(${near ? 1 : 0})`;
    $('ytHover').style.width = near ? clamp(cur.x - pr.left, 0, pr.width) + 'px' : '0px';
    // the preview over the bar, wherever the mouse is on it
    const tip = $('ytTip');
    tip.style.opacity = near ? 1 : 0;
    if (near) {
      const hp = clamp((cur.x - pr.left) / pr.width, 0, 1) * YT_DUR;
      tip.style.left = clamp(cur.x - pr.left + 12, 81, pr.width - 81 + 24) + 'px';
      $('ytTipT').textContent = fmt(hp);
      await showImg($('ytTipImg'), ytThumb(hp));
    }
    // the settings menu
    $('ytMenu').style.opacity = t >= MENU.gear && t < HK.half ? 1 : 0;
    $('ytMain').classList.toggle('on', t < MENU.item);
    $('ytSpeeds').classList.toggle('on', t >= MENU.item);
    $('ytSpeedItem').classList.toggle('hl', t >= MENU.item - 0.08 && t < MENU.item);
    $('ytHalf').classList.toggle('hl', t >= MENU.half - 0.08);
    $('ytHalf').classList.toggle('on', t >= HK.half);
    $('ytNormal').classList.toggle('on', t < HK.half);
    $('ytSpeedItem').querySelector('.vl').textContent = t >= HK.half ? '0.5' : 'Normal';
    // the cursor
    const c = $('ytCursor');
    c.style.opacity = (1 - ease(t, HK.stop, HK.stop + 0.3)).toFixed(3);
    c.style.transform = `translate(${(cur.x - 2.5).toFixed(2)}px, ${(cur.y - 1.5).toFixed(2)}px) scale(${ytPress(t) ? 0.9 : 1})`;
    // the wear of the search, and the whip at the cut
    const fx = ytFx(t), wo = whipOut(t);
    $('ytVig').style.opacity = (0.12 + 0.62 * fx.vig).toFixed(3);
    const layer = $('yt');
    layer.style.transform = `translate(${fx.sx.toFixed(2)}px, ${(fx.sy + 90 * wo * wo).toFixed(2)}px) rotate(${fx.rot.toFixed(3)}deg) scale(${fx.scale.toFixed(4)})`;
    const blur = 26 * wo, ca = fx.ca + 6 * wo;
    setFx(blur, ca);
    const f = [];
    if (ca > 0.25) f.push('url(#fxCA)');
    if (blur > 0.25) f.push('url(#fxVB)');
    if (fx.vig > 0) f.push(`saturate(${fx.sat.toFixed(3)}) contrast(${fx.con.toFixed(3)})`);
    layer.style.filter = f.join(' ');
  }

  /* Fallboard's half: its own buttons, pressed with a mouse, and the ring on the same chord */
  let fbRing = null;
  function measureFbRing() {
    const G = A.FB.debug.G, kb = q('#kbd').getBoundingClientRect();
    const wb = (m) => { let n = 0; for (let k = 21; k < m; k++) if (!isBlack(k)) n++; return n; };
    const x0 = kb.left + (wb(75) - G.left) * G.W - G.W * 0.3, x1 = kb.left + (wb(86) - G.left + 1) * G.W;   // E♭5 to D6
    const a = toStage({ x: x0, y: kb.top }), b = toStage({ x: x1, y: kb.top });
    fbRing = { cx: (a.x + b.x) / 2, cy: a.y - 6, rx: (b.x - a.x) / 2 + 20, ry: 44 * (VERT ? 0.6 : 1) };
  }
  /* the mouse over the app, in the app's own pixels */
  function fbCursorAt(t) {
    const c = (sel) => centreOf(q(sel));
    const play = c('#playBtn'), next = c('#nextBtn');
    const off = { x: LAY.app.w * 0.9, y: LAY.app.h * 0.98 };
    return along(t, [
      [HK.pause - 1.0, off], [HK.pause - 0.12, { x: play.x + 3, y: play.y + 4 }],
      [HK.pause + 0.08, { x: play.x + 3, y: play.y + 4 }], [HK.steps[0] - 0.12, { x: next.x + 2, y: next.y + 3 }],
      [HK.playOn - 0.42, { x: next.x + 2, y: next.y + 3 }], [HK.playOn - 0.1, { x: play.x + 2, y: play.y + 3 }],
      [HK.playOn + 0.25, { x: play.x + 2, y: play.y + 3 }], [HK.playOn + 0.9, { x: play.x + 160, y: play.y + 60 }],
    ]);
  }
  const FB_PRESS = [HK.pause, ...HK.steps, HK.playOn];
  function drawFbCursor(t) {
    const el = $('fbCursor');
    const vis = ease(t, HK.pause - 1.0, HK.pause - 0.8) * (1 - ease(t, HK.playOn + 0.5, HK.playOn + 0.9));
    el.style.opacity = vis.toFixed(3);
    const p = fbCursorAt(t), { x, y } = stageToScreen(t, toStage(p));
    const down = FB_PRESS.some((x0) => t >= x0 - 0.07 && t < x0 + 0.02);
    el.style.transform = `translate(${(x - 2.5).toFixed(2)}px, ${(y - 1.5).toFixed(2)}px) scale(${down ? 0.9 : 1})`;
    // the app's own hover, on whichever button is under it
    for (const sel of ['#playBtn', '#nextBtn', '#prevBtn']) {
      const b = q(sel), r = b.getBoundingClientRect();
      const over = vis > 0.5 && p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
      if (over) b.setAttribute('data-fxhover', ''); else b.removeAttribute('data-fxhover');
    }
  }
  /* the camera frames the chord and the buttons together as the mouse comes in, and lets go as it
     plays on. Measured once, on the frame the move starts, with the app laid out as it is then */
  /* the framing: the chord and the buttons together. Measured with the app paused at FRAME_T's
     place, so every shot gets the same numbers; then one movement in, and one out */
  const FRAME_T = HK.pause - 1.45;
  let fbView = null;
  function computeFraming() {
    measureFbRing();
    const r = fbRing, a = toStage(centreOf(q('#prevBtn'))), b = toStage(centreOf(q('#nextBtn')));
    const box = { x0: Math.min(r.cx - r.rx, a.x - 30) - 40, x1: Math.max(r.cx + r.rx, b.x + 30) + 40, y0: r.cy - r.ry - 150, y1: Math.max(a.y, b.y) + 40 };
    const s = Math.min(TT ? 1.75 : 1.3, W / (box.x1 - box.x0), H / (box.y1 - box.y0));
    const vw = W / s, vh = H / s;
    fbView = { s, x0: clamp((box.x0 + box.x1) / 2 - vw / 2, 0, W - vw), y0: clamp((box.y0 + box.y1) / 2 - vh / 2, 0, H - vh) };
  }
  async function framingFromPause() {
    placeWin(WIN, WIN.r, 1);
    await appState({ piece: 'revolutionary', view: 'roll', hand: 'both', speed: 1, ppsMul: 1.6, ...(TT ? { keys: { n: 34, left: 9 } } : {}), pos: FB_FROM + (FRAME_T - HK.fbAudio) }, FRAME_T);
    placeWin(WIN, WIN.r, 1);
    computeFraming();
  }
  /* the scale moves evenly (log-linear) and the view's rectangle is a mix of the whole frame and the
     framed one, so the zoom and the pan are one movement and the view never leaves the picture */
  const EZ = bezier(0.6, 0, 0.32, 1);
  function hookView(t) {
    if (!fbView || t < FRAME_T) return { s: 1, tx: 0, ty: 0 };
    const a = FRAME_T, b = HK.pause + 0.05, c = HK.playOn + 0.02, d = HK.playOn + 1.0;
    const k = TT ? (t >= HK.pause && t < HK.playOn ? 1 : 0) : t < b ? EZ(prog(t, a, b)) : t < c ? 1 : 1 - EZ(prog(t, c, d));
    const s = Math.pow(fbView.s, k), mix = fbView.s > 1 ? (1 - 1 / s) / (1 - 1 / fbView.s) : 0;
    return { s, tx: -fbView.x0 * mix * s, ty: -fbView.y0 * mix * s };
  }
  function drawFb(t) {
    if (winEl.style.display === 'none') placeWin(WIN, WIN.r, 1);
    measureFbRing();   // the keyboard re-fits as notes come and go: follow it
    const land = HK.steps[3] + 0.06;
    if (TT) $('fbCursor').style.opacity = 0; else drawFbCursor(t);   // a finger leaves no cursor
    drawHL(t, fbHL(t));
    // in from above, smeared, overexposed, and settling; a glow as the chord is found
    const wi = whipIn(t), exp = 1 - easeOut(prog(t, HK.cut, HK.cut + 1.3));
    const glow = t >= land ? Math.exp(-(t - land) / 0.3) : 0;
    setFx(26 * wi, 0);
    const f = [];
    if (wi > 0.01) f.push('url(#fxVB)');
    f.push(`brightness(${(1 + 1.35 * exp * exp + 0.14 * glow).toFixed(3)}) saturate(${(1.06 - 0.5 * exp * exp).toFixed(3)})`);
    $('stage').style.filter = f.join(' ');
    $('fxWash').style.opacity = (0.55 * Math.pow(1 - easeOut(prog(t, HK.cut, HK.cut + 0.55)), 2)).toFixed(3);
    return -90 * wi * wi;
  }

  function buildHook() {
    Object.assign(T, { reveal: -10, end: HK.end, out: HK.out });
    if (TT) {
      const emo = (c) => `<img class="emo" src="/promo/_src/emoji/${c}.png" alt="">`;
      capT(0, HK.cut, 'pov: learning piano from youtube', 108);
      capT(HK.freeze, HK.unpause, `good luck finding <span class="this">THIS</span> chord ${emo('1fae9')}${emo('1f940')}`, 462, -4);
      capT(TTK.clipAt + 2.0, HK.cut, 'ahhh… almost, almost, almost', 318, 5);
      capT(HK.pause, HK.steps[3], 'or just step to it', 250, -3);
      capT(HK.steps[3], HK.end - 0.1, 'there it is', 236, 4);
    } else {
      head(HK.freeze + 0.04, HK.freeze + 1.75, `Trying to find <em class="hi">that one chord?</em>`, { y: 112, hi: HI.etude });
      head(HK.freeze + 1.98, HK.unpause - 0.1, `<em class="hi">Good luck.</em>`, { y: 112, hi: HI.etude });
      head(HK.pause + 0.02, HK.steps[3] - 0.02, `Or just <em class="hi">step to it.</em>`, { y: 150 });
      head(HK.steps[3] + 0.12, HK.end - 0.15, `<em class="hi">There it is.</em>`, { y: 150 });
    }
    const D = HK.D;
    const fb = { piece: 'revolutionary', view: 'roll', hand: 'both', speed: 1, ppsMul: 1.6, ...(TT ? { keys: { n: 34, left: 9 } } : {}) };
    // small shots, one runner each in the cloud. The video needs no app; each app shot starts from a
    // state set up at its start, or a moment before (pre) and run on to it unseen
    (TT ? [[0, 2.5], [2.5, 5], [5, 7.5], [7.5, 9.6], [9.6, HK.fbAudio]] : [[0, 2.5], [2.5, 5], [5, 7.5], [7.5, 10], [10, 12.2], [12.2, HK.fbAudio]]).forEach(([a, b], i) =>
      shot(i ? `youtube-${i + 1}` : 'youtube', a, b, { app: false }));
    const playing = (t0) => { placeWin(WIN, WIN.r, 1); return appState({ ...fb, pos: FB_FROM + (t0 - HK.fbAudio), playAt: t0 }, t0); };
    const framedPlaying = async (t0) => { await framingFromPause(); await playing(t0); };
    shot('fallboard-1', HK.fbAudio, 16.3 + D, { setup: playing });
    shot('fallboard-2', 16.3 + D, 18.3 + D, { setup: framedPlaying });
    shot('fallboard-3', 18.3 + D, 19.4 + D, { setup: framedPlaying });
    shot('fallboard-3b', 19.4 + D, 20.5 + D, { pre: 18.6 + D, setup: framedPlaying });
    // paused on the second step's note, a moment before the third step
    shot('fallboard-4', 20.5 + D, HK.end, { pre: 20.1 + D, setup: async (t0) => { await framingFromPause(); await appState({ ...fb, pos: LAND - 2 * SIXTEENTH }, t0); } });
    shot('end', HK.end, 24.4 + D, { setup: (t0) => appState({ ...fb, pos: run(LAND, HK.playOn)(t0), playAt: t0 }, t0) });
    shot('end-2', 24.4 + D, HK.out, { setup: (t0) => appState({ ...fb, pos: run(LAND, HK.playOn)(t0), playAt: t0 }, t0) });
    // the mouse (in the TikTok cut a finger) on the app's own buttons: down, and a moment later up and the click
    const fire = TT ? pointer : mouse;
    const press = (sel, t) => {
      let h = null;
      act(t - 0.07, () => { const el = q(sel), c = centreOf(el); h = { el, x: c.x, y: c.y }; fire('pointerdown', el, c.x, c.y); });
      act(t, () => { if (!h) { const el = q(sel), c = centreOf(el); h = { el, x: c.x, y: c.y }; } fire('pointerup', h.el, h.x, h.y); h.el.dispatchEvent(new A.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, clientX: h.x, clientY: h.y, view: A })); h = null; });
    };
    press('#playBtn', HK.pause);
    for (const s of HK.steps) press('#nextBtn', s);
    press('#playBtn', HK.playOn);
  }
  function mouse(type, el, x, y) {
    el.dispatchEvent(new A.PointerEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerdown' ? 1 : 0, view: A }));
  }
  /* the app's :hover rules, copied onto [data-fxhover], so a scripted mouse shows them */
  function hoverRules() {
    const css = [];
    const walk = (rules, wrap) => {
      for (const r of rules) {
        if (r.cssRules && r.media) walk(r.cssRules, /hover/.test(r.media.mediaText) ? wrap : (s) => wrap(`@media ${r.media.mediaText}{${s}}`));
        else if (r.selectorText && r.selectorText.includes(':hover')) css.push(wrap(`${r.selectorText.replace(/:hover/g, '[data-fxhover]')}{${r.style.cssText}}`));
      }
    };
    for (const sh of doc().styleSheets) { try { walk(sh.cssRules, (s) => s); } catch (e) { /* another origin */ } }
    const st = doc().createElement('style');
    st.textContent = css.join('\n');
    doc().head.appendChild(st);
  }

  /* ------------------------------------------------------------------ setup */
  async function ready() {
    await document.fonts.ready;
    await Backdrop.init();
    etude = await FB.parseScore(await (await fetch('/scores/revolutionary.musicxml')).text());
    eng = await (await fetch('/scores/revolutionary.narrow.json')).json();
    buildScan();
    for (const sel of ['player', 'scan', 'paywall']) propBox($(sel), LAY[{ player: 'player', scan: 'scan', paywall: 'pay' }[sel]]);
    appEl.src = '/index.html';
    await new Promise((r) => appEl.addEventListener('load', r, { once: true }));
    A = appEl.contentWindow;
    await waitFor(() => A.FB && A.FB.debug && A.FB.debug.S.score && A.FB.library);
    await waitFor(() => A.FB.debug.piano.ready || A.FB.debug.piano.usable, 60000);
    hookPiano();
    await A.FB.library.load();
    await settle(600);
    placeWin(WIN, WIN.r, 1);
    if (HOOKY) {
      buildHook();
      buildHits();
      if (TT) await ttInit(); else hoverRules();
    } else {
      plan();
      buildCut();
      buildCamera();
    }
    acts.sort((a, b) => a.t - b.t);
    measureIcon();
    return { fps: FPS, duration: T.out, frames: Math.round(T.out * FPS), shots: shots.map((s) => ({ name: s.name, f0: s.f0, f1: s.f1 })) };
  }

  /* what was played in this shot, in film time */
  function drain() {
    const out = log.filter((e) => e.keep || e.t >= curShot.a - 1e-6 && e.t < curShot.b - 1e-6 || e.k === 'n' && e.bus !== 'app');
    log = [];
    return out;
  }

  /* ------------------------------------------------------------------ sound */
  async function renderAudio(events, seconds, mix = 'A') {
    const sr = 48000;
    events = events.filter((e) => !e.mix || e.mix.includes(mix));
    const HOOK = HOOKY;
    const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sr), sr);
    const piano = new FB.Piano('/samples/');
    await piano.preload();
    // the piano's own limiter goes out through the film's fade, not straight to the speakers
    const fadeOut = ctx.createGain();
    fadeOut.connect(ctx.destination);
    const pianoOut = ctx.createGain();
    pianoOut.gain.value = HOOK ? 1.2 : 1;
    pianoOut.connect(fadeOut);
    const Real = window.AudioContext, connect = AudioNode.prototype.connect;
    window.AudioContext = function () { return ctx; };
    AudioNode.prototype.connect = function (to, ...rest) { return connect.call(this, to === ctx.destination ? pianoOut : to, ...rest); };
    piano.ensure(false);
    AudioNode.prototype.connect = connect;
    window.AudioContext = Real;
    piano.voices = { add() {}, delete() {}, size: 0, values: () => [][Symbol.iterator]() };
    const appBus = piano.bus;
    for (const e of events) if (e.k === 'bus') {
      appBus.gain.setValueAtTime(1.5 * e.from, e.t0);
      appBus.gain.linearRampToValueAtTime(1.5 * e.to, e.t1);
    }
    // everything ends in the master, and the master fades with the picture
    if (HOOK) { fadeOut.gain.setValueAtTime(1, T.out - 0.9); fadeOut.gain.linearRampToValueAtTime(0, T.out - 0.05); }
    const master = ctx.createDynamicsCompressor();
    master.threshold.value = -6; master.knee.value = 8; master.ratio.value = 4; master.attack.value = 0.004; master.release.value = 0.2;
    master.connect(fadeOut);
    // a room for the synthesized parts
    const verb = ctx.createConvolver();
    verb.buffer = (() => {
      const len = Math.round(sr * 2.6), b = ctx.createBuffer(2, len, sr);
      let s = 4242;
      for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) { s = (s * 16807) % 2147483647; d[i] = (s / 1073741823.5 - 1) * Math.exp(-i / (sr * 0.55)) * Math.min(1, i / (sr * 0.01)); } }
      return b;
    })();
    const verbOut = ctx.createGain(); verbOut.gain.value = 0.32;
    verb.connect(verbOut); verbOut.connect(master);
    const mono = (src) => { const g = ctx.createGain(); g.channelCount = 1; g.channelCountMode = 'explicit'; g.channelInterpretation = 'speakers'; src.connect(g); return g; };
    // the opening's video (main cut): a laptop's speaker, and at 0.5× a time-stretch that smears
    const video = ctx.createGain(); video.gain.value = 0.95;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 170;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5200; lp.Q.value = 0.5;
    video.connect(hp); hp.connect(lp); mono(lp).connect(master);
    const smear = ctx.createGain(); smear.gain.value = 0.9;
    const slp = ctx.createBiquadFilter(); slp.type = 'lowpass'; slp.frequency.value = 1700; slp.Q.value = 0.9;
    const trem = ctx.createGain(); trem.gain.value = 0.72;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 7.5;
    const lfoAmt = ctx.createGain(); lfoAmt.gain.value = 0.28; lfo.connect(lfoAmt); lfoAmt.connect(trem.gain); lfo.start(0);
    const dly = ctx.createDelay(0.2); dly.delayTime.value = 0.031;
    const dlfo = ctx.createOscillator(); dlfo.frequency.value = 0.9;
    const dAmt = ctx.createGain(); dAmt.gain.value = 0.006; dlfo.connect(dAmt); dAmt.connect(dly.delayTime); dlfo.start(0);
    const dmix = ctx.createGain(); dmix.gain.value = 0.7;
    smear.connect(slp); slp.connect(trem); slp.connect(dly); dly.connect(dmix); dmix.connect(trem);
    mono(trem).connect(master);
    // the booms: their own hard limiter, so a pile of them is loud but not louder than one
    const boomBus = ctx.createDynamicsCompressor();
    boomBus.threshold.value = -10; boomBus.knee.value = 0; boomBus.ratio.value = 20; boomBus.attack.value = 0.001; boomBus.release.value = 0.08;
    const boomOut = ctx.createGain(); boomOut.gain.value = 0.7;
    boomBus.connect(boomOut); boomOut.connect(fadeOut);
    const buses = { app: appBus, video, smear };

    // kills: a stop silences what was scheduled before it. In the hook a pause is a lifted hand on
    // a held pedal: what sounds rings on, what was to come never starts
    // (in the order they were asked for: a play() stops what sounded, then schedules what comes)
    const kills = events.map((e, i) => (e.k === 'x' ? { t: e.t, i } : null)).filter(Boolean);
    const played = [];
    for (let j = 0; j < events.length; j++) {
      const e = events[j];
      if (e.k !== 'n' || e.t < 0 || e.t > seconds) continue;
      let end = e.t + Math.max(0.05, e.dur);
      if (e.bus === 'app') {
        const k = (kills.find((x) => x.i > j && x.t >= (e.at ?? e.t) - 1e-6) || {}).t;
        if (k !== undefined && k <= e.t + 1e-4) continue;
        let dur = e.dur;
        const stepping = HOOK && e.t >= HK.pause - 0.6 && e.t < HK.playOn - 0.01;
        if (stepping) dur = Math.max(dur, e.t < HK.pause ? 2.2 : 1.4);
        piano.bus = buses.app;
        const v = piano.noteOn(e.midi, e.t, dur, e.vel);
        played.push({ t: e.t, midi: e.midi, dur });
        const hard = k !== undefined && !(HOOK && Math.abs(k - HK.pause) < 0.05);
        if (v && hard) {
          v.g.gain.cancelScheduledValues(k);
          v.g.gain.setTargetAtTime(0, k, HOOK ? 0.25 : 0.03);
        }
      } else {
        piano.bus = buses[e.bus];
        const v = piano.noteOn(e.midi, e.t, Math.min(e.dur, (e.cut ?? 99) - e.t), e.vel);
        if (v && e.cut !== undefined && e.cut < end + 1) {
          v.g.gain.cancelScheduledValues(e.cut);
          v.g.gain.setTargetAtTime(0, e.cut, e.bus === 'video' ? 0.012 : 0.05);
        }
      }
    }
    for (const e of events) if (e.k === 's') sfx(ctx, master, e.kind, e.t);
    // recordings: stretches of the hook's video, the booms, the FAHH
    const clips = {};
    for (const e of events) {
      if (e.k !== 'c') continue;
      if (!clips[e.file]) clips[e.file] = await ctx.decodeAudioData(await (await fetch('/promo/_src/' + e.file + (e.file.includes('.') ? '' : '.wav'))).arrayBuffer());
      const src = ctx.createBufferSource(), g = ctx.createGain();
      src.buffer = clips[e.file];
      const gain = e.gain ?? 0.9, dur = e.dur ?? src.buffer.duration;
      const out = e.bus === 'boom' ? boomBus : master;
      if (e.tape) {
        // a record slowing to a stop: speed and pitch fall as one, the top end and the level go with them
        const tl = ctx.createBiquadFilter(); tl.type = 'lowpass'; tl.Q.value = 0.7;
        src.connect(tl); tl.connect(g); g.connect(out);
        src.playbackRate.setValueAtTime(1, e.t); src.playbackRate.exponentialRampToValueAtTime(0.05, e.t + dur);
        tl.frequency.setValueAtTime(3600, e.t); tl.frequency.exponentialRampToValueAtTime(180, e.t + dur);
        g.gain.setValueAtTime(gain, e.t); g.gain.setTargetAtTime(0, e.t + dur * 0.35, dur * 0.25);
        src.start(e.t, Math.max(0, e.off), dur * 0.6);
        continue;
      }
      src.connect(g); g.connect(out);
      if (e.env) {
        g.gain.setValueAtTime(0, e.t);
        for (const [dt, v] of e.env) g.gain.linearRampToValueAtTime(v * gain / 0.9, e.t + dt);
      } else if (e.dur === undefined) {
        g.gain.value = gain;
      } else {
        const fi = e.fadeIn ?? 0.012, fo = e.fadeOut ?? 0.012;
        g.gain.setValueAtTime(0, e.t); g.gain.linearRampToValueAtTime(gain, e.t + fi);
        g.gain.setValueAtTime(gain, e.t + dur - fo); g.gain.linearRampToValueAtTime(0, e.t + dur);
      }
      src.start(e.t, Math.max(0, e.off || 0), dur + 0.02);
    }
    if (HOOK) { strings(ctx, master, verb, events.filter((e) => e.k === 'str')); pads(ctx, master, verb, played); }
    const buf = await ctx.startRendering();
    return wav(buf);
  }

  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  /* the search's strings: bowed saws, an F and its fifth, a wrong note added with each miss; the
     bowing gets faster and more anxious, and at the tape stop they sink with it */
  function strings(ctx, master, verb, notes) {
    if (!notes.length) return;
    const t0 = Math.min(...notes.map((n) => n.t)), stop = HK.stop, end = HK.cut;
    const bus = ctx.createGain(), lpf = ctx.createBiquadFilter(), tremG = ctx.createGain();
    lpf.type = 'lowpass'; lpf.Q.value = 0.4;
    lpf.frequency.setValueAtTime(900, t0); lpf.frequency.linearRampToValueAtTime(2600, stop); lpf.frequency.exponentialRampToValueAtTime(300, end);
    bus.connect(lpf); lpf.connect(tremG); tremG.connect(master);
    const send = ctx.createGain(); send.gain.value = 0.5; tremG.connect(send); send.connect(verb);
    bus.gain.setValueAtTime(0.0001, t0); bus.gain.linearRampToValueAtTime(0.5, t0 + 1.2); bus.gain.linearRampToValueAtTime(1, stop);
    bus.gain.setTargetAtTime(0, stop + 0.1, STOP_LEN * 0.3);
    // tremolo: slow and faint at first, then a shiver
    const tl = ctx.createOscillator(), td = ctx.createGain();
    tl.frequency.setValueAtTime(4, t0); tl.frequency.linearRampToValueAtTime(11, stop);
    td.gain.setValueAtTime(0, t0); td.gain.linearRampToValueAtTime(0.45, stop);
    tremG.gain.value = 0.7; tl.connect(td); td.connect(tremG.gain); tl.start(t0); tl.stop(end + 0.5);
    const vib = ctx.createOscillator(), vd = ctx.createGain(); vib.frequency.value = 5.4; vd.gain.value = 7;
    vib.connect(vd); vib.start(t0); vib.stop(end + 0.5);
    for (const n of notes) {
      const g = ctx.createGain(); g.connect(bus);
      const lvl = 0.022 * n.g * (n.midi < 50 ? 1.3 : 1);
      g.gain.setValueAtTime(0, n.t); g.gain.linearRampToValueAtTime(lvl, n.t + 0.45);
      for (const dc of [-9, 0, 8]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz(n.midi); o.detune.value = dc;
        vd.connect(o.detune);
        o.detune.setValueAtTime(dc, stop); o.detune.linearRampToValueAtTime(dc - 1900, end);
        o.connect(g); o.start(n.t); o.stop(end + 0.3);
      }
    }
  }
  /* the release: soft pads on the chords Fallboard's piano is playing, voiced wide — the bass in two
     octaves, the chord's notes across two more. A found chord blooms a little. */
  function pads(ctx, master, verb, played) {
    const ns = played.filter((n) => n.t >= HK.cut - 0.3).sort((a, b) => a.t - b.t);
    const groups = [];
    for (const n of ns) {
      const g = groups[groups.length - 1];
      if (g && Math.abs(g.t - n.t) < 0.006) g.notes.push(n); else groups.push({ t: n.t, notes: [n] });
    }
    const chords = [];
    for (const g of groups) {
      const upper = g.notes.filter((n) => n.midi >= 58);
      if (upper.length < 3) continue;
      const near = played.filter((n) => n.t >= g.t - 0.95 && n.t <= g.t + 0.1);
      const bass = Math.min(...near.map((n) => n.midi));
      const pcs = [...new Set(upper.map((n) => n.midi % 12))];
      const key = pcs.slice().sort().join() + '/' + (bass % 12);
      if (chords.length && chords[chords.length - 1].key === key) continue;
      chords.push({ t: g.t, pcs, bass, key });
    }
    const bus = ctx.createGain(), lpf = ctx.createBiquadFilter();
    lpf.type = 'lowpass'; lpf.frequency.value = 1500; lpf.Q.value = 0.3;
    bus.connect(lpf); lpf.connect(master);
    const send = ctx.createGain(); send.gain.value = 0.9; lpf.connect(send); send.connect(verb);
    bus.gain.setValueAtTime(0, HK.cut - 0.05); bus.gain.linearRampToValueAtTime(1, HK.cut + 0.6);
    const land = HK.steps[3];
    chords.forEach((c, i) => {
      const t1 = i + 1 < chords.length ? chords[i + 1].t : T.out;
      const found = Math.abs(c.t - land) < 0.05;
      const b = 36 + (c.bass % 12);
      const voices = [b, b + 12];
      for (const pc of c.pcs) { voices.push(55 + ((pc - 55 % 12 + 12) % 12)); voices.push(67 + ((pc - 67 % 12 + 12) % 12)); }
      const g = ctx.createGain(); g.connect(bus);
      const lvl = (found ? 0.04 : 0.026);
      g.gain.setValueAtTime(0, c.t); g.gain.linearRampToValueAtTime(lvl, c.t + (found ? 0.5 : 0.18));
      g.gain.setValueAtTime(lvl, t1); g.gain.setTargetAtTime(0, t1, 0.18);
      for (const m of voices) for (const dc of [-6, 6]) {
        const o = ctx.createOscillator(); o.type = m < 50 ? 'triangle' : 'sawtooth'; o.frequency.value = hz(m); o.detune.value = dc;
        o.connect(g); o.start(c.t); o.stop(t1 + 1.2);
      }
    });
  }

  function noise(ctx, secs) {
    const b = ctx.createBuffer(1, Math.ceil(secs * ctx.sampleRate), ctx.sampleRate), d = b.getChannelData(0);
    let s = 99991; for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = s / 1073741823.5 - 1; }
    const n = ctx.createBufferSource(); n.buffer = b; return n;
  }
  function sfx(ctx, out, kind, t) {
    const g = ctx.createGain(); g.connect(out);
    const env = (peak, a, d) => { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.setTargetAtTime(0, t + a, d); };
    if (kind === 'tick') {
      const n = noise(ctx, 0.03), f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 3400; f.Q.value = 3;
      n.connect(f); f.connect(g); env(0.16, 0.001, 0.006); n.start(t); n.stop(t + 0.03);
    } else if (kind === 'click') {
      const n = noise(ctx, 0.04), f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2200; f.Q.value = 2;
      n.connect(f); f.connect(g); env(0.3, 0.001, 0.01); n.start(t); n.stop(t + 0.04);
    } else if (kind === 'stop') {
      const n = noise(ctx, 0.05), f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
      n.connect(f); f.connect(g); env(0.2, 0.002, 0.02); n.start(t); n.stop(t + 0.05);
    } else if (kind === 'paper') {
      const n = noise(ctx, 0.6), f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 0.8;
      f.frequency.setValueAtTime(700, t); f.frequency.exponentialRampToValueAtTime(3200, t + 0.45);
      n.connect(f); f.connect(g); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.32, t + 0.12); g.gain.setTargetAtTime(0, t + 0.3, 0.09); n.start(t); n.stop(t + 0.6);
    } else if (kind === 'pop') {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(520, t); o.frequency.exponentialRampToValueAtTime(860, t + 0.06);
      o.connect(g); env(0.22, 0.004, 0.05); o.start(t); o.stop(t + 0.4);
    } else if (kind === 'drop') {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(87.31, t); o.frequency.exponentialRampToValueAtTime(43.65, t + 0.5);
      o.connect(g); env(0.26, 0.01, 0.16); o.start(t); o.stop(t + 1.2);
      const n = noise(ctx, 0.5), f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 260;
      const gn = ctx.createGain(); n.connect(f); f.connect(gn); gn.connect(out);
      gn.gain.setValueAtTime(0, t); gn.gain.linearRampToValueAtTime(0.12, t + 0.01); gn.gain.setTargetAtTime(0, t + 0.01, 0.08); n.start(t); n.stop(t + 0.5);
    } else if (kind === 'freeze') {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(87.31, t); o.frequency.exponentialRampToValueAtTime(43.65, t + 0.35);
      o.connect(g); env(0.32, 0.004, 0.09); o.start(t); o.stop(t + 0.8);
    } else if (kind === 'scribble') {
      // a marker on glass: a rough, quick loop
      const n = noise(ctx, 0.6), f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2900; f.Q.value = 1.4;
      n.connect(f); f.connect(g);
      g.gain.setValueAtTime(0, t);
      const bumps = [0.16, 0.07, 0.2, 0.09, 0.18, 0.06, 0.14, 0.05, 0.1];
      bumps.forEach((v, k) => g.gain.setTargetAtTime(v * 0.55, t + k * 0.045, 0.012));
      g.gain.setTargetAtTime(0, t + bumps.length * 0.045, 0.03);
      n.start(t); n.stop(t + 0.6);
    } else if (kind === 'riser') {
      const n = noise(ctx, 1.3), f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.3;
      f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(6500, t + 1.08);
      n.connect(f); f.connect(g);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.13, t + 1.06); g.gain.linearRampToValueAtTime(0, t + 1.12);
      n.start(t); n.stop(t + 1.3);
      const o = ctx.createOscillator(), og = ctx.createGain(); o.type = 'sine';
      o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(760, t + 1.08);
      o.connect(og); og.connect(out); og.gain.setValueAtTime(0, t); og.gain.linearRampToValueAtTime(0.045, t + 1.05); og.gain.linearRampToValueAtTime(0, t + 1.1);
      o.start(t); o.stop(t + 1.2);
    } else if (kind === 'impact') {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(77.78, t); o.frequency.exponentialRampToValueAtTime(38.89, t + 0.55);
      o.connect(g); env(0.5, 0.004, 0.22); o.start(t); o.stop(t + 1.6);
      const n = noise(ctx, 0.4), f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1400;
      const ng = ctx.createGain(); n.connect(f); f.connect(ng); ng.connect(out);
      ng.gain.setValueAtTime(0, t); ng.gain.linearRampToValueAtTime(0.22, t + 0.003); ng.gain.setTargetAtTime(0, t + 0.004, 0.05); n.start(t); n.stop(t + 0.4);
      for (const [fq, a] of [[1864.7, 0.03], [2489.0, 0.022], [3136.0, 0.016]]) {
        const s2 = ctx.createOscillator(), sg = ctx.createGain(); s2.type = 'sine'; s2.frequency.value = fq;
        s2.connect(sg); sg.connect(out); sg.gain.setValueAtTime(0, t); sg.gain.linearRampToValueAtTime(a, t + 0.01); sg.gain.setTargetAtTime(0, t + 0.01, 0.45);
        s2.start(t); s2.stop(t + 2.5);
      }
    } else if (kind === 'key') {
      const n = noise(ctx, 0.03), f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 3800; f.Q.value = 1.6;
      n.connect(f); f.connect(g); env(0.22, 0.0008, 0.005); n.start(t); n.stop(t + 0.03);
      const o = ctx.createOscillator(), og = ctx.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(260, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.03);
      o.connect(og); og.connect(out); og.gain.setValueAtTime(0, t); og.gain.linearRampToValueAtTime(0.1, t + 0.002); og.gain.setTargetAtTime(0, t + 0.003, 0.012);
      o.start(t); o.stop(t + 0.1);
    } else if (kind === 'chime' || kind === 'shimmer') {
      const notes = kind === 'chime' ? [[1244.5, 0], [1396.9, 0.035], [1760, 0.07], [2349.3, 0.105]] : [[1864.7, 0], [2349.3, 0.05], [2793.8, 0.1]];
      for (const [fq, dt] of notes) {
        const s2 = ctx.createOscillator(), sg = ctx.createGain(); s2.type = 'sine'; s2.frequency.value = fq;
        s2.connect(sg); sg.connect(out);
        const a = kind === 'chime' ? 0.05 : 0.03;
        sg.gain.setValueAtTime(0, t + dt); sg.gain.linearRampToValueAtTime(a, t + dt + 0.008); sg.gain.setTargetAtTime(0, t + dt + 0.01, kind === 'chime' ? 0.6 : 0.8);
        s2.start(t + dt); s2.stop(t + dt + 4);
      }
    } else if (kind === 'swish') {
      const n = noise(ctx, 0.4), f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 0.9;
      f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(3400, t + 0.25);
      n.connect(f); f.connect(g); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05, t + 0.08); g.gain.setTargetAtTime(0, t + 0.12, 0.06);
      n.start(t); n.stop(t + 0.4);
    } else if (kind === 'mclick') {
      // a mouse button: down and up, close together
      for (const [dt, fq, a] of [[0, 4200, 0.12], [0.07, 3000, 0.07]]) {
        const n = noise(ctx, 0.02), f = ctx.createBiquadFilter(), gg = ctx.createGain(); f.type = 'bandpass'; f.frequency.value = fq; f.Q.value = 2.5;
        n.connect(f); f.connect(gg); gg.connect(out);
        gg.gain.setValueAtTime(0, t + dt); gg.gain.linearRampToValueAtTime(a, t + dt + 0.0008); gg.gain.setTargetAtTime(0, t + dt + 0.001, 0.004);
        n.start(t + dt); n.stop(t + dt + 0.02);
      }
    } else if (kind === 'swell') {
      // a reversed cymbal into the cut: noise that only grows
      const n = noise(ctx, 0.8), f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 2500;
      n.connect(f); f.connect(g); g.gain.setValueAtTime(0, t); g.gain.exponentialRampToValueAtTime(0.002, t + 0.05); g.gain.exponentialRampToValueAtTime(0.09, t + 0.69); g.gain.linearRampToValueAtTime(0, t + 0.71);
      n.start(t); n.stop(t + 0.8);
    } else if (kind === 'mtap') {
      // a fingertip on glass, barely there
      const n = noise(ctx, 0.02), f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2600; f.Q.value = 1.2;
      n.connect(f); f.connect(g); env(0.06, 0.0006, 0.004); n.start(t); n.stop(t + 0.02);
    } else if (kind === 'whoosh') {
      const n = noise(ctx, 1.0), f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.1;
      f.frequency.setValueAtTime(260, t); f.frequency.exponentialRampToValueAtTime(2600, t + 0.7);
      n.connect(f); f.connect(g); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.07, t + 0.45); g.gain.setTargetAtTime(0, t + 0.5, 0.12); n.start(t); n.stop(t + 1);
    }
  }
  function wav(buf) {
    const ch = buf.numberOfChannels, n = buf.length, data = [];
    let peak = 1e-6;
    for (let c = 0; c < ch; c++) { const d = buf.getChannelData(c); data.push(d); for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i])); }
    const gain = Math.min(4, 0.89 / peak);
    const bytes = new DataView(new ArrayBuffer(44 + n * ch * 2));
    const str = (o, s) => { for (let i = 0; i < s.length; i++) bytes.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); bytes.setUint32(4, 36 + n * ch * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    bytes.setUint32(16, 16, true); bytes.setUint16(20, 1, true); bytes.setUint16(22, ch, true); bytes.setUint32(24, buf.sampleRate, true);
    bytes.setUint32(28, buf.sampleRate * ch * 2, true); bytes.setUint16(32, ch * 2, true); bytes.setUint16(34, 16, true); str(36, 'data'); bytes.setUint32(40, n * ch * 2, true);
    let o = 44;
    for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { bytes.setInt16(o, clamp(Math.round(data[c][i] * gain * 32767), -32768, 32767), true); o += 2; }
    const u8 = new Uint8Array(bytes.buffer);
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }

  /* the app's state, to check that one shot ends where the next begins */
  function probe() {
    if (!A || curShot.app === false) return null;
    const S = A.FB.debug.S;
    return { t: +filmNow().toFixed(3), pos: +(S.playing ? S.anchorT + Math.max(0, filmNow() + base / 1000 - S.anchorCtx) * S.speed : S.t).toFixed(3), playing: S.playing, speed: S.speed, hand: S.hand, view: S.view, piece: S.meta && S.meta.id, library: A.FB.library.isOpen() };
  }
  /* a soundtrack from shots rendered earlier: the hook's own sounds (everything but the app's piano)
     come from the code as it is now, not from the shots' logs, so a sound-only run hears its changes */
  const freshEvents = (ev) => (HOOKY ? [...hookEvents(), ...ev.filter((e) => !e.keep)] : ev);
  window.FILM = { ready, begin, frame, skip, drain, freshEvents, probe, renderAudio, get shots() { return shots; }, T, hits: () => ({ yt: YT_HITS, miss: MISS_HITS, fb: FB_HITS }) };
})();
