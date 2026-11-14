/* Pre-engraves a MusicXML score with MuseScore's engine at every layout width.
   Usage: node tools/engrave.js dist/scores/<name>.musicxml dist/scores/<name> <path to webmscore.nodejs.cjs>
   Writes <out-prefix>.narrow.json, .medium.json and .wide.json */
'use strict';
// webmscore's Node build predates Node's own fetch and read-only navigator
globalThis.fetch = undefined;
Object.defineProperty(globalThis, 'navigator', { value: {}, writable: true, configurable: true });

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const core = require('../dist/js/engrave-core.js');

const [, , src, prefix, modPath, only] = process.argv;
if (!src || !prefix || !modPath) {
  console.error('usage: node tools/engrave.js <score.musicxml> <out-prefix> <webmscore.nodejs.cjs>');
  process.exit(1);
}

if (!only) {
  // each layout runs in its own process: the engine does not survive loading a second score
  for (const layout of core.LAYOUTS) {
    execFileSync(process.execPath, [__filename, src, prefix, modPath, layout.key], { stdio: ['ignore', 'inherit', 'inherit'] });
  }
} else {
  (async () => {
    const mod = require(path.resolve(modPath));
    const WebMscore = mod.default || mod;
    await WebMscore.ready;
    const layout = core.LAYOUTS.find((l) => l.key === only);
    const t0 = Date.now();
    const eng = await core.engrave(WebMscore, fs.readFileSync(src, 'utf8'), layout.wsp);
    const file = prefix + '.' + layout.key + '.json';
    const json = JSON.stringify(eng);
    fs.writeFileSync(file, json);
    const heads = eng.pages.reduce((n, p) => n + p.heads.length / 2, 0);
    console.log(file + ': ' + eng.pages.length + ' systems, ' + eng.meas.length + ' measures, ' + heads +
      ' noteheads, ' + (json.length / 1024).toFixed(0) + ' KB, ' + (Date.now() - t0) + ' ms');
    process.exit(0);
  })().catch((e) => { console.error(e); process.exit(1); });
}
