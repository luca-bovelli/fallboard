'use strict';
const fs = require('fs');

function loadPlaywright() {
  for (const mod of ['playwright', 'playwright-core', 'C:/Users/luca/node_modules/playwright-core']) {
    try { return require(mod); } catch (_) { /* try next */ }
  }
  throw new Error('Playwright not found. Run: npm install --no-save playwright@1.49.1');
}

async function launchBrowser() {
  const pw = loadPlaywright();
  const isWin = process.platform === 'win32';
  const winChrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const useWinChrome = isWin && fs.existsSync(winChrome);

  const args = isWin
    ? ['--use-gl=angle', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist']
    : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--no-sandbox'];

  return pw.chromium.launch({
    ...(useWinChrome ? { executablePath: winChrome } : {}),
    headless: true,
    args,
  });
}

module.exports = { launchBrowser };
