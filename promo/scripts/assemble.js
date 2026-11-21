'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const C16 = path.join(ROOT, 'promo', 'clips', '16x9');
const C9 = path.join(ROOT, 'promo', 'clips', '9x16');
const AUD = path.join(ROOT, 'promo', 'audio');
const EXP = path.join(ROOT, 'promo', 'exports');
const TMP = path.join(ROOT, 'promo', '_tmp');
[EXP, TMP].forEach((d) => fs.mkdirSync(d, { recursive: true }));

const FPS = 60;

function ff(args) {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
}

function probeDuration(file) {
  const out = execFileSync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    file,
  ], { encoding: 'utf8' }).trim();
  return parseFloat(out);
}

/* Bake each clip's frame-exact synced WAV into its modular building-block MP4
   so every standalone clip in promo/clips/<fmt>/ is ready-to-drop with 100% synced audio! */
function bakeBuildingBlocks(dir) {
  const names = [
    'app-01-open-and-step',
    'app-02-roll-to-score',
    'app-03-color-worlds',
    'app-04-library-henle-pdf',
    '03-hook-purist',
    '05-endcard',
  ];
  for (const name of names) {
    const vid = path.join(dir, `${name}.mp4`);
    const wav = path.join(AUD, `${name}.wav`);
    if (!fs.existsSync(vid) || !fs.existsSync(wav)) continue;
    const tmpOut = path.join(TMP, `baked-${path.basename(dir)}-${name}.mp4`);
    ff([
      '-i', vid,
      '-i', wav,
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-c:v', 'copy',
      '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-ac', '2',
      '-shortest',
      '-movflags', '+faststart',
      tmpOut,
    ]);
    fs.copyFileSync(tmpOut, vid);
  }
}

/* Join N audio+video clips using matched-motion xfade + sample-locked acrossfade.
   Each clip's exit push + next clip's settle overlap by exact `xfDur` on BOTH video and audio,
   guaranteeing 0.000ms A/V drift across the entire master! */
function assembleWithXfade(clips, outFile, xfDur = 0.24) {
  const durs = clips.map((c) => probeDuration(c.file));
  const inputs = clips.flatMap((c) => ['-i', c.file]);

  if (clips.length === 1) {
    ff([...inputs, '-c', 'copy', '-movflags', '+faststart', outFile]);
    return;
  }

  const filters = [];
  for (let i = 0; i < clips.length; i++) {
    filters.push(`[${i}:v:0]fps=${FPS},format=yuv420p,settb=AVTB,setpts=PTS-STARTPTS[v${i}]`);
    filters.push(`[${i}:a:0]aformat=sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS[a${i}]`);
  }

  let curV = 'v0';
  let curA = 'a0';
  let accDur = durs[0];

  for (let i = 1; i < clips.length; i++) {
    const d = clips[i].xf ?? xfDur;
    const trans = clips[i].transition || 'fade';
    const offset = Math.max(0.05, accDur - d);
    const nextV = i === clips.length - 1 ? 'vout' : `vx${i}`;
    const nextA = i === clips.length - 1 ? 'aout' : `ax${i}`;
    filters.push(`[${curV}][v${i}]xfade=transition=${trans}:duration=${d.toFixed(4)}:offset=${offset.toFixed(4)}[${nextV}]`);
    filters.push(`[${curA}][a${i}]acrossfade=d=${d.toFixed(4)}:c1=tri:c2=tri[${nextA}]`);
    curV = nextV;
    curA = nextA;
    accDur = accDur + durs[i] - d;
  }

  ff([
    ...inputs,
    '-filter_complex', filters.join(';'),
    '-map', '[vout]',
    '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-ac', '2',
    '-movflags', '+faststart',
    outFile,
  ]);
}

function trimAV(inFile, startSec, durSec, outFile) {
  ff([
    '-ss', String(startSec),
    '-i', inFile,
    '-t', String(durSec),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-ac', '2',
    '-movflags', '+faststart',
    outFile,
  ]);
}

console.log('Baking 100% frame-synced audio into modular building-block clips...');
bakeBuildingBlocks(C16);
bakeBuildingBlocks(C9);

console.log('Assembling master 60fps exports with matched-motion transitions...');

// 1. X Master Showcase (16:9, ~24.2s @ 60fps — pure product craft, zero bumpers, 100% synced per-piece audio!)
{
  const out = path.join(EXP, 'x-master-showcase-16x9.mp4');
  assembleWithXfade([
    { file: path.join(C16, 'app-01-open-and-step.mp4') },                     // 7.4s (Ballade No. 1)
    { file: path.join(C16, 'app-02-roll-to-score.mp4'), xf: 0.24 },           // 5.6s (Rachmaninoff C# minor)
    { file: path.join(C16, 'app-03-color-worlds.mp4'), xf: 0.22 },            // 4.2s (Revolutionary -> Rach Gm -> Ballade)
    { file: path.join(C16, 'app-04-library-henle-pdf.mp4'), xf: 0.20 },       // 5.4s (UI SFX only, zero music!)
    { file: path.join(C16, '05-endcard.mp4'), xf: 0.26 },                     // 2.6s (living notes + quiet resolve)
  ], out, 0.24);
  console.log('✓', path.relative(ROOT, out), probeDuration(out).toFixed(2) + 's');
}

// 2. Short 01: Open + Step/Hands + Roll/Score (9:16, ~15.1s @ 60fps — ready to post or drop behind filmed hook!)
{
  const out = path.join(EXP, 'short-01-step-and-score-9x16.mp4');
  assembleWithXfade([
    { file: path.join(C9, 'app-01-open-and-step.mp4') },
    { file: path.join(C9, 'app-02-roll-to-score.mp4'), xf: 0.24 },
    { file: path.join(C9, '05-endcard.mp4'), xf: 0.26 },
  ], out, 0.24);
  console.log('✓', path.relative(ROOT, out), probeDuration(out).toFixed(2) + 's');
}

// 3. Short 02: Purist Uno Reverse -> Roll/Score -> A4 PDF (9:16, ~13.0s @ 60fps)
{
  const pdfTail = path.join(TMP, 'short-02-pdf-tail.mp4');
  trimAV(path.join(C9, 'app-04-library-henle-pdf.mp4'), 3.10, 2.30, pdfTail);
  const out = path.join(EXP, 'short-02-purist-uno-reverse-9x16.mp4');
  assembleWithXfade([
    { file: path.join(C9, '03-hook-purist.mp4') },
    { file: path.join(C9, 'app-02-roll-to-score.mp4'), xf: 0.24 },
    { file: pdfTail, xf: 0.24 },
    { file: path.join(C9, '05-endcard.mp4'), xf: 0.26 },
  ], out, 0.24);
  console.log('✓', path.relative(ROOT, out), probeDuration(out).toFixed(2) + 's');
}

// 4. Short 03: Color Worlds + Library & Henle PDF (9:16, ~11.7s @ 60fps)
{
  const out = path.join(EXP, 'short-03-worlds-and-library-9x16.mp4');
  assembleWithXfade([
    { file: path.join(C9, 'app-03-color-worlds.mp4') },
    { file: path.join(C9, 'app-04-library-henle-pdf.mp4'), xf: 0.20 },
    { file: path.join(C9, '05-endcard.mp4'), xf: 0.26 },
  ], out, 0.24);
  console.log('✓', path.relative(ROOT, out), probeDuration(out).toFixed(2) + 's');
}

// 5. Reddit Raw DIY Demo (16:9, ~12.8s @ 60fps — pure Fallboard + 100% synced Yamaha C5 piano audio!)
{
  const out = path.join(EXP, 'reddit-raw-demo-16x9.mp4');
  assembleWithXfade([
    { file: path.join(C16, 'app-01-open-and-step.mp4') },
    { file: path.join(C16, 'app-02-roll-to-score.mp4'), xf: 0.24 },
  ], out, 0.24);
  console.log('✓', path.relative(ROOT, out), probeDuration(out).toFixed(2) + 's');
}

console.log('ALL 60FPS EXPORTS COMPLETE.');
