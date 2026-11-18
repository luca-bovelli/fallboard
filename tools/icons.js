/* The app's icons, drawn by the app itself: a few bars of music opened in the player, its
   controls hidden, every key white, the roll's lit glass notes falling onto the lit keys, the
   foot of a phone's roll caught in a square and saved at every size the platforms ask for. Also
   the plain black launch screens iOS shows while an installed Fallboard starts.

     node tools/icons.js            (needs Chrome; CHROME=<path> to name it)

   Writes dist/icons/: icon-<size>.png (any purpose), maskable-512.png (the same scene with room
   round it for Android's masks), apple-touch-icon.png (180, no transparency: iOS rounds it),
   favicon-32.png, favicon-16.png, and splash-<w>x<h>.png for the iPhones and iPads in SPLASH. */
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
/* one octave, C4 to B4: a C major chord held, the left hand's C, the right hand's E and G, and a
   B still falling beside them ([step, octave, start, length, staff]; divisions: 2 to a quarter,
   120 bpm, so 0.25 s each). The scene is caught at AT seconds: the chord has sounded long enough
   for the keys' heat to be full, the light standing above them as it does in play */
const NOTES = [['C', 4, 0, 32, 2], ['E', 4, 0, 32, 1], ['G', 4, 0, 32, 1], ['B', 4, 14, 18, 1]];
const AT = 3.3;
/* the scene's size in css px: an octave of 20 px keys (a phone's, js/app.js MIN_W..), the
   keyboard a third of the square, the roll as tall as a phone's (its light reaches up from the
   keys in proportion to the roll's height), its foot the square's top two thirds */
const SIDE = 140, TALL = 560;
function scoreXml() {
  let pos = 0;
  const body = NOTES.map(([step, oct, at, dur, staff], i) => {
    const move = at < pos ? `<backup><duration>${pos - at}</duration></backup>` : at > pos ? `<forward><duration>${at - pos}</duration></forward>` : '';
    pos = at + dur;
    return move + `<note><pitch><step>${step}</step><octave>${oct}</octave></pitch><duration>${dur}</duration><voice>${i + 1}</voice><staff>${staff}</staff></note>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
<part id="P1"><measure number="1"><attributes><divisions>2</divisions><time><beats>16</beats><beat-type>4</beat-type></time><staves>2</staves>
<clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
<sound tempo="120"/>
${body}
</measure></part></score-partwise>`;
}
const XML = scoreXml();

const SIZES = [16, 32, 180, 192, 512];
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
    const shot = async (file, clip) => fs.writeFileSync(file, Buffer.from((await send('Page.captureScreenshot', { format: 'png', clip })).result.data, 'base64'));
    await send('Page.enable'); await send('Runtime.enable');

    /* the scene: a player SIDE css px wide and TALL high, at the scale that makes SIDE 1024 px.
       The roll's light, rims and glow are sized in css px, so they keep the weight they have on
       a phone, and the noise in the light the size it has there */
    await send('Emulation.setDeviceMetricsOverride', { width: SIDE, height: TALL, deviceScaleFactor: 1024 / SIDE, mobile: false });
    await send('Page.navigate', { url: `http://localhost:${PORT}/` });
    await sleep(2500);
    await run(`
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      for (let i = 0; i < 80 && !(window.FB && FB.debug && FB.debug.S.score); i++) await wait(100);
      if (FB.library && FB.library.isOpen()) FB.library.close();
      FB.rollGL.whiteKeys();
      const st = document.createElement('style');
      /* the controls hidden, the rail under the keys gone (the keys sit on the icon's bottom edge),
         the keys a third of the icon */
      st.textContent = '.top, .progress, #liveBtn, .toast, .status, #library, .scrub { visibility: hidden !important; } .rail { display: none !important; } .kbd-wrap { height: ${0.34 * SIDE}px !important; }';
      document.head.appendChild(st);
      await FB.debug.openFile(new File([${JSON.stringify(XML)}], ${JSON.stringify(NAME)}, { type: 'application/xml' }));
      for (let i = 0; i < 80 && !(FB.debug.S.meta && FB.debug.S.meta.id === 'file:${NAME}' && FB.debug.S.meta.hands); i++) await wait(100);
      for (const n of FB.debug.S.score.notes) n.name = '';                       // no names on the notes
      window.dispatchEvent(new Event('resize')); await wait(300);
      /* the keys from C4 to B4 across the icon, held there (C4 is white key 23 from A0) */
      const G = FB.debug.G;
      G.manual = true; G.holdUntil = Infinity;
      G.W = G.tW = G.width / 7; G.left = G.tLeft = 23;
      document.getElementById('kbd').getContext('2d').fillText = () => {};      // nor octaves on the keys
      await wait(600);
      FB.debug.seek(${AT}); await wait(400); FB.debug.seek(${AT + 0.001}); await wait(1500);
      return FB.debug.S.meta.id;`);
    const big = path.join(OUT, 'scene-1024.png');
    await shot(big, { x: 0, y: TALL - SIDE, width: SIDE, height: SIDE, scale: 1 });   // the square at the foot

    /* every size, and the maskable one, made from the scene by the browser (a canvas, smoothed) */
    const scene = 'data:image/png;base64,' + fs.readFileSync(big).toString('base64');
    const make = async (size, pad) => Buffer.from(await run(`
      const img = await new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = ${JSON.stringify(scene)}; });
      const c = document.createElement('canvas'); c.width = c.height = ${size}; const x = c.getContext('2d');
      x.fillStyle = '#000'; x.fillRect(0, 0, ${size}, ${size}); x.imageSmoothingQuality = 'high';
      const inset = ${size} * ${pad}; x.drawImage(img, inset, inset, ${size} - 2 * inset, ${size} - 2 * inset);
      return c.toDataURL('image/png').split(',')[1];`), 'base64');
    for (const size of SIZES) fs.writeFileSync(path.join(OUT, size <= 32 ? `favicon-${size}.png` : size === 180 ? 'apple-touch-icon.png' : `icon-${size}.png`), await make(size, 0));
    fs.writeFileSync(path.join(OUT, 'maskable-512.png'), await make(512, 0.1));   // Android's masks keep the middle 80 %
    fs.unlinkSync(big);

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
