/* Pulls every Wikidata item composed by each catalogue composer into catalog/raw/wikidata/<id>.json:
   catalogue codes, key, and labels and aliases in English and the composer's languages.

     node tools/catalog/pull-wikidata.js            composers whose raw file is missing
     node tools/catalog/pull-wikidata.js chopin ... just these, always

   The build matches these items to catalogue entries by catalogue number (and by the opus
   numbers written in their labels), and takes their names: English titles for native ones,
   native titles for English ones, and the aliases people use ("Raindrop", "Aeolian Harp").
   Wikidata is CC0. */
'use strict';
const fs = require('fs');
const path = require('path');
const { COMPOSERS } = require('./composers');

const OUT = path.join(__dirname, '..', '..', 'catalog', 'raw', 'wikidata');
const HEADERS = { 'User-Agent': 'catalog-builder/0.1 (personal, non-commercial)', Accept: 'application/sparql-results+json' };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function sparql(query) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch('https://query.wikidata.org/sparql?query=' + encodeURIComponent(query), { headers: HEADERS });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const body = await res.json();
      await pause(1500);
      return body.results.bindings;
    } catch (err) {
      if (attempt >= 4) throw err;
      await pause(5000 * attempt);
    }
  }
}

async function composerItem(c) {
  const url = 'https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=info&sites=enwiki&titles=' + encodeURIComponent(c.full);
  const body = await (await fetch(url, { headers: { 'User-Agent': HEADERS['User-Agent'] } })).json();
  const id = Object.keys(body.entities || {}).find((k) => /^Q\d+$/.test(k));
  if (!id) throw new Error('no Wikidata item for ' + c.full);
  return id;
}

async function pull(c) {
  const q = await composerItem(c);
  const langs = ['en', ...c.langs].map((l) => '"' + l + '"').join(',');
  const names = await sparql(`SELECT ?item ?label ?kind WHERE {
    ?item wdt:P86 wd:${q} .
    { ?item rdfs:label ?label . BIND("l" AS ?kind) } UNION { ?item skos:altLabel ?label . BIND("a" AS ?kind) }
    FILTER(LANG(?label) IN (${langs}))
  }`);
  const codes = await sparql(`SELECT ?item ?code ?catalog ?key WHERE {
    ?item wdt:P86 wd:${q} .
    OPTIONAL { ?item p:P528 ?st . ?st ps:P528 ?code . OPTIONAL { ?st pq:P972 ?c . ?c rdfs:label ?catalog . FILTER(LANG(?catalog) = "en") } }
    OPTIONAL { ?item wdt:P826 ?k . ?k rdfs:label ?key . FILTER(LANG(?key) = "en") }
  }`);
  const items = new Map();
  const get = (b) => { const id = b.item.value.split('/').pop(); if (!items.has(id)) items.set(id, { id, codes: [], key: undefined, labels: {}, aliases: {} }); return items.get(id); };
  for (const b of names) {
    const it = get(b);
    const lang = b.label['xml:lang'];
    const bag = b.kind.value === 'l' ? it.labels : it.aliases;
    (bag[lang] = bag[lang] || []).includes(b.label.value) || bag[lang].push(b.label.value);
  }
  for (const b of codes) {
    const it = get(b);
    if (b.code && !it.codes.some((x) => x.code === b.code.value)) it.codes.push({ code: b.code.value, ...(b.catalog ? { catalog: b.catalog.value } : {}) });
    if (b.key) it.key = b.key.value;
  }
  return { composer: q, pulled: new Date().toISOString().slice(0, 10), items: [...items.values()].sort((a, b) => +a.id.slice(1) - +b.id.slice(1)) };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const asked = process.argv.slice(2);
  for (const c of COMPOSERS) {
    const file = path.join(OUT, c.id + '.json');
    if (asked.length ? !asked.includes(c.id) : fs.existsSync(file)) continue;
    const data = await pull(c);
    fs.writeFileSync(file, JSON.stringify(data, null, 0).replace(/\},\{"id"/g, '},\n{"id"') + '\n');
    console.log(c.id, data.composer, data.items.length + ' items');
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
