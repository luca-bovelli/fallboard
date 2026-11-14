/* Local preview: serves fallboard.html inside the same skeleton the published artifact gets. */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const root = __dirname;
const types = { '.js': 'text/javascript', '.json': 'application/json', '.musicxml': 'application/xml', '.xml': 'application/xml', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.wasm': 'application/wasm' };
const seen = [];
const head = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' +
  '<style>:root{color-scheme:light;padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style></head><body>';

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(head + fs.readFileSync(path.join(root, 'fallboard.html'), 'utf8') + '</body></html>');
    return;
  }
  if (url === '/__requests') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(seen)); return; }
  if (url.startsWith('/engine/')) seen.push(url);
  const file = path.normalize(path.join(root, url));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(process.env.PORT || 5173, () => console.log('Fallboard preview on http://localhost:' + (process.env.PORT || 5173)));
