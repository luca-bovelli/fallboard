/* Fallboard — xml-lite.js
   Just enough of the browser's DOMParser for js/score.js to run where there is none: elements
   with tagName, attributes, firstElementChild, nextElementSibling, textContent and
   getElementsByTagName. MusicXML needs nothing more. Used by the score worker
   (js/score-worker.js), where a big score is parsed off the page, and in Node by the score
   checks (tools/catalog/check-scores.js). In a worker its DOMParser is the global one. */
'use strict';

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e] !== undefined ? ENT[e] : m));

class Element {
  constructor(tagName, attrs, parent) {
    this.tagName = tagName;
    this.attrs = attrs;
    this.parentNode = parent;
    this.children = [];
    this.nodes = [];
    this.firstElementChild = null;
    this.nextElementSibling = null;
  }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null; }
  hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name); }
  get textContent() { return this.nodes.map((n) => (typeof n === 'string' ? n : n.textContent)).join(''); }
  getElementsByTagName(tag) {
    const out = [];
    const walk = (el) => { for (const c of el.children) { if (tag === '*' || c.tagName === tag) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
  querySelector(tag) { return this.getElementsByTagName(tag)[0] || null; }
}

function parse(xml) {
  const doc = new Element('#document', {}, null);
  let cur = doc;
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE(?:[^[>]|\[[^\]]*\])*>|<\/([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(xml))) {
    if (m[1] !== undefined) { cur.nodes.push(m[1]); continue; }
    if (m[2]) {
      if (cur.tagName !== m[2]) throw new Error('mismatched </' + m[2] + '>');
      cur = cur.parentNode;
      continue;
    }
    if (m[3]) {
      const attrs = {};
      for (const a of m[4].matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = decode(a[2] !== undefined ? a[2] : a[3]);
      const el = new Element(m[3], attrs, cur);
      const prev = cur.children[cur.children.length - 1];
      if (prev) prev.nextElementSibling = el; else cur.firstElementChild = el;
      cur.children.push(el);
      cur.nodes.push(el);
      if (!m[5]) cur = el;
      continue;
    }
    if (m[6] !== undefined && cur !== doc) cur.nodes.push(decode(m[6]));
  }
  if (cur !== doc) throw new Error('unclosed <' + cur.tagName + '>');
  doc.documentElement = doc.firstElementChild;
  return doc;
}

class DOMParser {
  parseFromString(xml) {
    try { return parse(xml); } catch (e) {
      const doc = new Element('#document', {}, null);
      const err = new Element('parsererror', {}, doc);
      doc.children.push(err); doc.firstElementChild = err; doc.documentElement = err;
      return doc;
    }
  }
}

if (typeof module === 'object' && module.exports) module.exports = { DOMParser, parse };
