/* Fallboard — the film. One timeline drives every layer: the signed-off backdrop, the real app
   (in a frame on a virtual clock, see app-runtime.js), the other tools in the opening, the
   headlines and the camera. The same timeline makes the sound: the opening's video is scored
   from the piece itself, and everything the app plays is what the app asked its piano for on
   that frame. promo/scripts/film.js renders it.

   API (window.FILM): ready(), shots, begin(i), frame(f), drain(), renderAudio(events, seconds). */
(function () {
  'use strict';
  const Q = new URLSearchParams(location.search);
  const FPS = 60, DT = 1000 / FPS;
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
  const WIN = (() => {
    const s = LAY.win.s, w = LAY.app.w * s, h = LAY.app.h * s;
    return { x: (W - w) / 2, y: H - h - LAY.win.bottom, w, h, s, r: LAY.win.r };
  })();

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
  function drawHeads(t) {
    const live = heads.filter((h) => t >= h.a - 0.01 && t < h.b + 0.3);
    const slots = [$('headA'), $('headB')];
    slots.forEach((el, i) => {
      const h = live[i];
      if (!h) { el.style.opacity = 0; el.dataset.k = ''; return; }
      const k = h.a + h.html;
      if (el.dataset.k !== k) { el.innerHTML = h.html; el.dataset.k = k; }
      const inP = ease(t, h.a, h.a + 0.42), outP = ease(t, h.b, h.b + 0.26, easeIn);
      el.style.fontSize = h.size + 'px';
      el.style.setProperty('--hi', h.hi);
      el.style.top = h.y + 'px';
      el.style.opacity = (inP * (1 - outP)).toFixed(4);
      el.style.transform = `translateY(calc(-50% + ${(lerp(14, 0, inP) - 8 * outP).toFixed(2)}px))`;
      el.style.filter = outP > 0 ? `blur(${(outP * 6).toFixed(2)}px)` : '';
    });
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
  function drawCam(t) {
    const c = camAt(t);
    $('stage').style.transform = `translate(${c.x}px, ${c.y}px) scale(${c.s.toFixed(5)}) translate(${-c.x}px, ${-c.y}px)`;
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
    const t0 = curShot.a;
    taps.length = 0; $('taps').textContent = '';
    scroll = null;
    log = [];
    if (curShot.setup) await curShot.setup(t0);
    actIdx = acts.findIndex((a) => a.t >= t0);
    if (actIdx < 0) actIdx = acts.length;
    logging = true;
    if (curShot.name === 'opening') log.push(...painEvents());
    if (curShot.name === 'reveal') log.push(...revealEvents());
  }

  function frame(f) {
    const t = f / FPS, s = curShot;
    // timed actions on the app happen on the frame they fall in, at their own moment
    if (s.app !== false) {
      while (actIdx < acts.length && acts[actIdx].t < t + 1e-6) {
        const a = acts[actIdx++];
        if (a.t >= s.a - 1e-6) { appTo(a.t); a.fn(); A.__vclock.sync(); }
      }
      if (scroll && t >= scroll.a && t <= scroll.b + 0.02) scroll.el.scrollTop = lerp(scroll.from, scroll.to, easeCam(prog(t, scroll.a, scroll.b)));
      appTo(t);
    }
    compose(t);
  }

  function compose(t) {
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
    plan();
    buildCut();
    buildCamera();
    acts.sort((a, b) => a.t - b.t);
    measureIcon();
    return { fps: FPS, duration: T.out, frames: Math.round(T.out * FPS), shots: shots.map((s) => ({ name: s.name, f0: s.f0, f1: s.f1 })) };
  }

  /* what was played in this shot, in film time */
  function drain() {
    const out = log.filter((e) => e.t >= curShot.a - 1e-6 && e.t < curShot.b - 1e-6 || e.k === 'n' && e.bus !== 'app');
    log = [];
    return out;
  }

  /* ------------------------------------------------------------------ sound */
  async function renderAudio(events, seconds) {
    const sr = 48000;
    const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sr), sr);
    const piano = new FB.Piano('/samples/');
    await piano.preload();
    const Real = window.AudioContext;
    window.AudioContext = function () { return ctx; };
    piano.ensure(false);
    window.AudioContext = Real;
    piano.voices = { add() {}, delete() {}, size: 0, values: () => [][Symbol.iterator]() };
    const appBus = piano.bus;
    // the opening's video: a laptop's speaker, and at 0.5× a time-stretch that smears
    const master = ctx.createDynamicsCompressor();
    master.threshold.value = -6; master.knee.value = 8; master.ratio.value = 4; master.attack.value = 0.004; master.release.value = 0.2;
    master.connect(ctx.destination);
    const mono = (src) => { const g = ctx.createGain(); g.channelCount = 1; g.channelCountMode = 'explicit'; g.channelInterpretation = 'speakers'; src.connect(g); return g; };
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
    // the app's piano is already wired to its own limiter; route that limiter on through the master too
    const buses = { app: appBus, video, smear };

    // kills: a stop silences what was scheduled before it
    const kills = events.filter((e) => e.k === 'x').map((e) => e.t).sort((a, b) => a - b);
    for (const e of events) {
      if (e.k !== 'n' || e.t < 0 || e.t > seconds) continue;
      let end = e.t + Math.max(0.05, e.dur);
      if (e.bus === 'app') {
        const k = kills.find((x) => x >= (e.at ?? e.t) - 1e-6);
        if (k !== undefined && k <= e.t + 1e-4) continue;
        piano.bus = buses.app;
        const v = piano.noteOn(e.midi, e.t, e.dur, e.vel);
        if (v && k !== undefined) {
          v.g.gain.cancelScheduledValues(k);
          v.g.gain.setTargetAtTime(0, k, 0.03);
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
    const buf = await ctx.startRendering();
    return wav(buf);
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
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(92, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.5);
      o.connect(g); env(0.26, 0.01, 0.16); o.start(t); o.stop(t + 1.2);
      const n = noise(ctx, 0.5), f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 260;
      const gn = ctx.createGain(); n.connect(f); f.connect(gn); gn.connect(out);
      gn.gain.setValueAtTime(0, t); gn.gain.linearRampToValueAtTime(0.12, t + 0.01); gn.gain.setTargetAtTime(0, t + 0.01, 0.08); n.start(t); n.stop(t + 0.5);
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
  window.FILM = { ready, begin, frame, drain, probe, renderAudio, get shots() { return shots; }, T };
})();
