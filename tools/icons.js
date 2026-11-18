/* The app's icons, drawn by the app itself: a few bars of music opened in the player and drawn
   as the library draws a Continue card (js/roll-gl.js thumb): the cover's colour fields, the
   notes' light added to them, the card's glass over both, its edge on the outline iOS cuts the
   icon to; saved at every size the platforms ask for. Also the plain black launch screens iOS
   shows while an installed Fallboard starts.

     node tools/icons.js            (needs Chrome; CHROME=<path> to name it)

   Writes dist/icons/: apple-touch-icon.png (180, square and opaque: iOS cuts it to its outline,
   where the glass's edge is), icon-<size>.png and favicon-<size>.png (any purpose: cut to that
   outline, clear outside), maskable-512.png (Android: the card without its glass, edge to edge,
   since each launcher cuts it to a shape of its own, a circle, a squircle, a rounded square,
   and an edge drawn for one would be cut through by the others), and splash-<w>x<h>.png for the
   iPhones and iPads in SPLASH. ICON_SCENES=1 also keeps the two 1024 px cards. */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = process.env.ICON_OUT || path.join(ROOT, 'dist', 'icons');
const PORT = 5197;
const CHROME = process.env.CHROME || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find((p) => fs.existsSync(p));
/* the palette comes from the file's name, as an upload's does (js/library.js FB.pieceLook): this
   name gives orchid: violet and pink */
const NAME = process.env.ICON_NAME || 'Fallboard 5.musicxml';
/* one octave, C4 to B4, its outer keys left unplayed, balanced by weight rather than mirrored:
   left of the middle the left hand's E, held, the one tall light, and a short C# high above;
   right of it the right hand's lighter notes, a G falling, an A# repeated in eighths, an F#
   sounding at the keys. No two notes overlap. [note, start, length, staff], in sixteenths of a
   second (divisions 8 to a quarter, 120 bpm). The card starts at AT seconds, the notes sounding
   then landing on its bottom edge */
const DIV = 8;
const NOTES = [
  ['E4', 0, 80, 2], ['C#4', 61, 4, 2],
  ['G4', 58, 20, 1], ...[53, 57, 61, 65, 69, 73, 77].map((t) => ['A#4', t, 3, 1]), ['F#4', 48, 8, 1],
];
const AT = 3.33;
/* the card: SIDE css px, a phone's Continue card, drawn at the scale that makes it 1024 px; its
   corner (and the glass's bevel and height) CORNER of its side, where the cards' squircle
   (softness 1/2) lies within 0.2 px at 180 px of iOS's icon mask, a continuous corner of 0.2237
   of the side; END: the hundredths of a second from its bottom edge to 0.2 from its top */
const SIDE = 160, CORNER = 0.1935, END = 72;
function scoreXml() {
  let pos = 0;
  const body = NOTES.map(([name, at, dur, staff], i) => {
    const move = at < pos ? `<backup><duration>${pos - at}</duration></backup>` : at > pos ? `<forward><duration>${at - pos}</duration></forward>` : '';
    pos = at + dur;
    return move + `<note><pitch><step>${name[0]}</step>${name[1] === '#' ? '<alter>1</alter>' : ''}<octave>${name.slice(-1)}</octave></pitch><duration>${dur}</duration><voice>${i + 1}</voice><staff>${staff}</staff></note>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
<part id="P1"><measure number="1"><attributes><divisions>${DIV}</divisions><time><beats>${Math.ceil(Math.max(...NOTES.map((n) => n[1] + n[2])) / DIV)}</beats><beat-type>4</beat-type></time><staves>2</staves>
<clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
<sound tempo="120"/>
${body}
</measure></part></score-partwise>`;
}
const XML = scoreXml();

/* iOS launch screens, portrait (and landscape for iPads): [css width, css height, scale] */
const SPLASH = [
  [440, 956, 3], [402, 874, 3], [430, 932, 3], [393, 852, 3], [428, 926, 3], [390, 844, 3], [414, 896, 3], [375, 812, 3], [414, 896, 2], [375, 667, 2], [320, 568, 2],
  [1032, 1376, 2], [1024, 1366, 2], [834, 1210, 2], [834, 1194, 2], [820, 1180, 2], [834, 1112, 2], [810, 1080, 2], [768, 1024, 2], [744, 1133, 2],
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/* a PNG of one colour, written here and deflated hard (a browser's encoder left a black screen
   at 100 KB; this, a few) */
function solidPng(w, h, [r, g, b]) {
  const zlib = require('zlib');
  const row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) row.set([r, g, b], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

(async () => {
  if (!CHROME) throw new Error('no Chrome found: set CHROME');
  fs.mkdirSync(OUT, { recursive: true });
  const server = spawn(process.execPath, [path.join(ROOT, 'dev-server.js')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  const prof = fs.mkdtempSync(path.join(require('os').tmpdir(), 'fb-icons-'));
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9227', `--user-data-dir=${prof}`, '--window-size=600,600', 'about:blank'], { stdio: 'ignore' });
  try {
    let targets = null;
    for (let i = 0; i < 60 && !targets; i++) { await sleep(200); try { targets = await (await fetch('http://127.0.0.1:9227/json')).json(); } catch (e) { /* not up yet */ } }
    const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener('open', r));
    let id = 0; const pending = new Map();
    ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
    const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const run = async (expr) => { const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400)); return r.result.result.value; };
    await send('Page.enable'); await send('Runtime.enable');

    /* the score opened in the player, for its notes and the palette its name gives */
    await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 400, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: `http://localhost:${PORT}/` });
    await sleep(2500);
    const [glass, flat] = await run(`
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      for (let i = 0; i < 80 && !(window.FB && FB.debug && FB.debug.S.score && FB.rollGL); i++) await wait(100);
      if (FB.library && FB.library.isOpen()) FB.library.close();
      await FB.debug.openFile(new File([${JSON.stringify(XML)}], ${JSON.stringify(NAME)}, { type: 'application/xml' }));
      for (let i = 0; i < 80 && !(FB.debug.S.meta && FB.debug.S.meta.id === 'file:${NAME}' && FB.debug.S.meta.hands); i++) await wait(100);
      /* a Continue card of it (js/library.js card, js/roll-gl.js thumb): the notes from AT on, those
         sounding then landing on the bottom edge, END hundredths of a second up to 0.2 from the top */
      const meta = FB.debug.S.meta, look = FB.pieceLook(meta) || FB.pieceLook(meta, true), notes = [];
      for (const n of FB.debug.S.score.notes.slice().sort((p, q) => p.t0 - q.t0)) {
        if (n.t1 <= ${AT}) continue;
        notes.push(Math.round(Math.max(0, n.t0 - ${AT}) * 100), Math.max(4, Math.round((n.t1 - Math.max(n.t0, ${AT})) * 100)), n.midi, n.hand);
      }
      const card = (withGlass) => {
        const box = document.createElement('div'), cv = document.createElement('canvas');
        box.style.cssText = 'position: fixed; left: 0; top: 0; z-index: 99; width: ${SIDE}px; height: ${SIDE}px; border-radius: ${CORNER * SIDE}px';
        cv.style.cssText = 'display: block; width: 100%; height: 100%';
        box.appendChild(cv); document.body.appendChild(box);
        FB.rollGL.thumb(cv, { hands: look.hands, cover: { fields: look.fields, base: look.base, ink: look.inkNotes && look.ink }, roll: { end: ${END}, bars: [], notes }, dpr: 1024 / ${SIDE}, glass: withGlass });
        const url = cv.toDataURL('image/png').split(',')[1];
        box.remove();
        return url;
      };
      return [card(true), card(false)];`);

    /* every size, made from the two by the browser (a canvas, smoothed): for iOS, opaque, square, the
       glass's edge on the outline it is cut to; elsewhere cut to that outline, the rest clear; for
       Android's masks the card without its glass, edge to edge */
    const uri = (b64) => JSON.stringify('data:image/png;base64,' + b64);
    const make = async (b64, size, cut) => Buffer.from(await run(`
      const img = await new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = ${uri(b64)}; });
      const c = document.createElement('canvas'); c.width = c.height = ${size}; const x = c.getContext('2d');
      x.imageSmoothingQuality = 'high';
      if (${cut}) {
        /* the squircle, as js/library.js squirclePath traces it: along each axis a smooth hinge
           (softness 1/2), the outline where the two add to 1, traced by rays from the middle */
        const hinge = (q, e) => { const root = Math.sqrt(q * q + e * e); return q < 0 ? (e * e) / Math.max(root - q, 1e-8) : q + root; };
        const axis = (v, half, r) => { const e = r * 0.5, cc = half - r, vp = hinge(v - cc, e), vm = hinge(-v - cc, e), v0 = hinge(-cc, e), eP = hinge(r, e), eM = hinge(r - 2 * half, e); return Math.max(0, ((vp - v0) * (vp + v0) + (vm - v0) * (vm + v0)) / ((eP - v0) * (eP + v0) + (eM - v0) * (eM + v0))); };
        const half = ${size} / 2, r = ${CORNER} * ${size}, p = new Path2D();
        for (let i = 0; i <= 720; i++) {
          const a = (i / 720) * 2 * Math.PI, dx = Math.cos(a), dy = Math.sin(a);
          let lo = 0, hi = half * 1.5;
          for (let k = 0; k < 40; k++) { const t = (lo + hi) / 2; if (axis(t * dx, half, r) + axis(t * dy, half, r) < 1) lo = t; else hi = t; }
          if (i) p.lineTo(half + lo * dx, half + lo * dy); else p.moveTo(half + lo * dx, half + lo * dy);
        }
        p.closePath(); x.clip(p);
      }
      x.drawImage(img, 0, 0, ${size}, ${size});
      return c.toDataURL('image/png').split(',')[1];`), 'base64');
    fs.writeFileSync(path.join(OUT, 'apple-touch-icon.png'), await make(glass, 180, false));
    for (const size of [16, 32]) fs.writeFileSync(path.join(OUT, `favicon-${size}.png`), await make(glass, size, true));
    for (const size of [192, 512]) fs.writeFileSync(path.join(OUT, `icon-${size}.png`), await make(glass, size, true));
    fs.writeFileSync(path.join(OUT, 'maskable-512.png'), await make(flat, 512, false));
    if (process.env.ICON_SCENES) { fs.writeFileSync(path.join(OUT, 'scene-glass.png'), Buffer.from(glass, 'base64')); fs.writeFileSync(path.join(OUT, 'scene-flat.png'), Buffer.from(flat, 'base64')); }

    /* the launch screens: the app's black page, nothing on it, as a native app's launch screen
       shows the screen it opens to before anything is in it */
    for (const [w, h, k] of SPLASH) {
      for (const [W, H] of w >= 744 ? [[w, h], [h, w]] : [[w, h]]) {
        fs.writeFileSync(path.join(OUT, `splash-${W * k}x${H * k}.png`), solidPng(W * k, H * k, [0, 0, 0]));
      }
    }
    ws.close();
    console.log('icons and launch screens in dist/icons');
  } finally {
    chrome.kill(); server.kill();
    setTimeout(() => { try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) { /* in use a moment longer */ } }, 1000);
  }
})().catch((e) => { console.error(e); process.exit(1); });
