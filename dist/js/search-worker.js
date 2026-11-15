/* Fallboard — search-worker.js
   The catalogue search (js/catalog.js) runs here, off the page: building its index takes a few
   seconds, and the library must keep scrolling and taking taps meanwhile.

     → { type: 'init', url }            the catalogue (library/catalog.json)
     ← { type: 'ready' }
     → { type: 'find', id, q, limit }
     ← { type: 'found', id, ids }        catalogue ids, best first */
'use strict';
importScripts('catalog.js' + self.location.search);
let search = null;
const queue = [];

function find(m) {
  self.postMessage({ type: 'found', id: m.id, ids: search.find(m.q, m.limit).map((r) => r.entry.id) });
}

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'init') {
    const cat = await (await fetch(m.url)).json();
    /* versions of a work stay out, as in the library's lists */
    const raw = new Map(cat.entries.map((x) => [x.id, x]));
    const isVariant = (x) => { for (let y = x; y; y = y.parent && raw.get(y.parent)) if (y.variant) return true; return false; };
    search = self.CatalogSearch.create({ composers: cat.composers, entries: cat.entries.filter((x) => !isVariant(x)) });
    self.postMessage({ type: 'ready' });
    for (const q of queue.splice(0)) find(q);
  } else if (m.type === 'find') {
    if (search) find(m);
    else { queue.length = 0; queue.push(m); }   // only the latest query waits for the index
  }
};
