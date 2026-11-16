/* Fallboard — score-worker.js
   MusicXML parsed off the page (js/score.js FB.parseScore): a big score takes seconds to parse,
   which on the page would freeze it. js/xml-lite.js stands in for the DOMParser a worker lacks.

     → { id, xml }
     ← { id, score }   the parsed score without its lookups (functions do not cross; the page
                       adds them back) and without the MusicXML (the page has it)
     ← { id, error } */
'use strict';
self.window = self;   // score.js keeps its functions on window.FB
importScripts('xml-lite.js' + self.location.search, 'score.js' + self.location.search);

self.onmessage = (e) => {
  const { id, xml } = e.data;
  try {
    const score = self.FB.parseMusicXML(xml);
    for (const k of ['beatToSec', 'secToBeat', 'measureAt', 'tempoAt', 'xml']) delete score[k];
    self.postMessage({ id, score });
  } catch (err) {
    self.postMessage({ id, error: err.message || 'This file could not be read.' });
  }
};
