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

function ff(args) {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
}

function concatVideos(files, outVideo) {
  const inputs = files.flatMap((f) => ['-i', f]);
  const streams = files.map((_, i) => `[${i}:v:0]`).join('');
  ff([
    ...inputs,
    '-filter_complex', `${streams}concat=n=${files.length}:v=1:a=0[vout]`,
    '-map', '[vout]',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', '30',
    outVideo,
  ]);
}

function trimClip(inFile, startSec, durSec, outFile) {
  ff([
    '-ss', String(startSec),
    '-i', inFile,
    '-t', String(durSec),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', '30',
    outFile,
  ]);
}

function muxAudio(videoFile, audioFilterArgs, outFile, totalDur) {
  ff([
    '-i', videoFile,
    ...audioFilterArgs,
    '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-t', String(totalDur),
    '-movflags', '+faststart',
    outFile,
  ]);
}

console.log('Assembling master exports...');

// 1. X Master Showcase (16:9, ~40.4s)
{
  const raw = path.join(TMP, 'x-master-v.mp4');
  concatVideos([
    path.join(C16, '02-pain-frankenstein.mp4'),   // 6.5s
    path.join(C16, 'app-01-step-and-hands.mp4'),  // 8.5s
    path.join(C16, '07-bumper-sync.mp4'),         // 2.2s
    path.join(C16, 'app-02-roll-to-score.mp4'),   // 7.5s
    path.join(C16, '08-bumper-library.mp4'),      // 2.2s
    path.join(C16, 'app-04-library-henle-pdf.mp4'), // 9.0s
    path.join(C16, '05-endcard.mp4'),             // 4.5s
  ], raw);
  const out = path.join(EXP, 'x-master-showcase-16x9.mp4');
  muxAudio(raw, [
    '-i', path.join(AUD, 'pain-frankenstein-sfx.wav'),
    '-i', path.join(AUD, 'chopin-ballade-bed.wav'),
    '-filter_complex',
    '[1:a]atrim=0:6.5,asetpts=PTS-STARTPTS[a1];' +
    '[2:a]atrim=0:34.2,afade=t=in:st=0:d=0.6,afade=t=out:st=31.2:d=2.8,asetpts=PTS-STARTPTS[a2];' +
    '[a1][a2]concat=n=2:v=0:a=1[aout]',
    '-map', '0:v:0', '-map', '[aout]',
  ], out, 40.4);
  console.log('✓', path.relative(ROOT, out));
}

// 2. Short 01: Ledger-Line Jump Scare -> Step & Hands -> Roll/Score (9:16, ~24.5s)
// (Tip: swap 04-hook-ledger.mp4 with your own 4-6s real YouTube screen recording or botched-chord clip in CapCut!)
{
  const raw = path.join(TMP, 'short-01-v.mp4');
  concatVideos([
    path.join(C9, '04-hook-ledger.mp4'),          // 4.0s
    path.join(C9, 'app-01-step-and-hands.mp4'),   // 8.5s
    path.join(C9, 'app-02-roll-to-score.mp4'),    // 7.5s
    path.join(C9, '05-endcard.mp4'),              // 4.5s
  ], raw);
  const out = path.join(EXP, 'short-01-ledger-step-9x16.mp4');
  muxAudio(raw, [
    '-i', path.join(AUD, 'pain-youtube-muffled.wav'),
    '-i', path.join(AUD, 'chopin-step-demo.wav'),
    '-i', path.join(AUD, 'chopin-ballade-bed.wav'),
    '-filter_complex',
    '[1:a]atrim=2.0:6.0,asetpts=PTS-STARTPTS[a1];' +
    '[2:a]atrim=0:15.0,afade=t=out:st=14.2:d=0.8,asetpts=PTS-STARTPTS[a2];' +
    '[3:a]atrim=10:16.0,afade=t=in:st=0:d=0.6,afade=t=out:st=3.8:d=1.8,asetpts=PTS-STARTPTS[a3];' +
    '[a1][a2][a3]concat=n=3:v=0:a=1[aout]',
    '-map', '0:v:0', '-map', '[aout]',
  ], out, 24.5);
  console.log('✓', path.relative(ROOT, out));
}

// 3. Short 02: Purist Uno Reverse -> Roll/Score -> A4 PDF (9:16, ~20.5s)
{
  const pdfTail = path.join(TMP, 'short-02-pdf-tail.mp4');
  trimClip(path.join(C9, 'app-04-library-henle-pdf.mp4'), 4.5, 4.5, pdfTail);
  const raw = path.join(TMP, 'short-02-v.mp4');
  concatVideos([
    path.join(C9, '03-hook-purist.mp4'),          // 4.0s
    path.join(C9, 'app-02-roll-to-score.mp4'),    // 7.5s
    pdfTail,                                      // 4.5s
    path.join(C9, '05-endcard.mp4'),              // 4.5s
  ], raw);
  const out = path.join(EXP, 'short-02-purist-uno-reverse-9x16.mp4');
  muxAudio(raw, [
    '-i', path.join(AUD, 'chopin-ballade-bed.wav'),
    '-filter_complex',
    '[1:a]atrim=0:20.5,afade=t=in:st=0:d=0.4,afade=t=out:st=18.2:d=2.2,asetpts=PTS-STARTPTS[aout]',
    '-map', '0:v:0', '-map', '[aout]',
  ], out, 20.5);
  console.log('✓', path.relative(ROOT, out));
}

// 4. Short 03: Color Worlds + Library & Henle PDF (9:16, ~19.5s)
{
  const raw = path.join(TMP, 'short-03-v.mp4');
  concatVideos([
    path.join(C9, 'app-03-color-worlds.mp4'),     // 6.0s
    path.join(C9, 'app-04-library-henle-pdf.mp4'), // 9.0s
    path.join(C9, '05-endcard.mp4'),              // 4.5s
  ], raw);
  const out = path.join(EXP, 'short-03-color-worlds-library-9x16.mp4');
  muxAudio(raw, [
    '-i', path.join(AUD, 'rach-cs-bed.wav'),
    '-i', path.join(AUD, 'chopin-ballade-bed.wav'),
    '-filter_complex',
    '[1:a]atrim=0:16.5,afade=t=out:st=15.0:d=1.5,asetpts=PTS-STARTPTS[a1];' +
    '[2:a]atrim=0:3.5,afade=t=in:st=0:d=0.5,afade=t=out:st=1.8:d=1.6,asetpts=PTS-STARTPTS[a2];' +
    '[a1][a2]concat=n=2:v=0:a=1[aout]',
    '-map', '0:v:0', '-map', '[aout]',
  ], out, 19.5);
  console.log('✓', path.relative(ROOT, out));
}

// 5. Reddit Raw DIY Demo (16:9, ~16.0s, zero hype cards — pure app + piano sound)
{
  const raw = path.join(TMP, 'reddit-v.mp4');
  concatVideos([
    path.join(C16, 'app-01-step-and-hands.mp4'),  // 8.5s
    path.join(C16, 'app-02-roll-to-score.mp4'),   // 7.5s
  ], raw);
  const out = path.join(EXP, 'reddit-raw-demo-16x9.mp4');
  muxAudio(raw, [
    '-i', path.join(AUD, 'chopin-step-demo.wav'),
    '-i', path.join(AUD, 'chopin-ballade-bed.wav'),
    '-filter_complex',
    '[1:a]atrim=0:14.5,asetpts=PTS-STARTPTS[a1];' +
    '[2:a]atrim=12:14.0,afade=t=out:st=0.8:d=1.1,asetpts=PTS-STARTPTS[a2];' +
    '[a1][a2]concat=n=2:v=0:a=1[aout]',
    '-map', '0:v:0', '-map', '[aout]',
  ], out, 16.0);
  console.log('✓', path.relative(ROOT, out));
}

console.log('ALL EXPORTS COMPLETE.');
