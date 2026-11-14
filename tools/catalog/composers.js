/* The catalogue's composers, written by hand.

   name      how the app shows the composer
   full      full name, for the library and credits
   imslp     the composer's category on IMSLP
   langs     languages of the composer's own titles (Wikidata codes), searched beside English
   names     other spellings and forms people type: transliterations (Rachmaninov, Rachmaninow,
             Rakhmaninov), native forms (Fryderyk, Liszt Ferenc, Cyrillic), first names alone are
             not included since several composers share them. Search also matches any prefix of
             a surname, so "rach", "tchaik" or "shost" need no entry here.
   catalogues  the catalogue prefixes this composer's works are numbered in, as IMSLP writes them
   died      for public-domain checks: a composition is free in the EU 70 years after the end of
             the composer's death year; the US also counts publication before 1931 (as of 2026) */
'use strict';

const COMPOSERS = [
  { id: 'bach', name: 'Bach', full: 'Johann Sebastian Bach', imslp: 'Bach, Johann Sebastian', born: 1685, died: 1750, langs: ['de'],
    names: ['J. S. Bach', 'JS Bach', 'J.S. Bach', 'Johann Sebastian Bach', 'JSB', 'Бах'], catalogues: ['BWV', 'BWV Anh.'] },
  { id: 'beethoven', name: 'Beethoven', full: 'Ludwig van Beethoven', imslp: 'Beethoven, Ludwig van', born: 1770, died: 1827, langs: ['de'],
    names: ['Ludwig van Beethoven', 'L. v. Beethoven', 'LvB', 'Bethoven', 'Beethofen', 'Бетховен'], catalogues: ['Op.', 'WoO', 'Anh.', 'Hess', 'Biamonti', 'Unv'] },
  { id: 'mozart', name: 'Mozart', full: 'Wolfgang Amadeus Mozart', imslp: 'Mozart, Wolfgang Amadeus', born: 1756, died: 1791, langs: ['de'],
    names: ['W. A. Mozart', 'WA Mozart', 'Wolfgang Amadeus Mozart', 'Wolfgang Amadé Mozart', 'Моцарт'], catalogues: ['K.', 'KV', 'K6', 'K.Anh.'] },
  { id: 'chopin', name: 'Chopin', full: 'Frédéric Chopin', imslp: 'Chopin, Frédéric', born: 1810, died: 1849, langs: ['pl', 'fr'],
    names: ['Frédéric Chopin', 'Frederic Chopin', 'Fryderyk Chopin', 'Fryderyk Franciszek Chopin', 'Szopen', 'Шопен'], catalogues: ['Op.', 'B.', 'KK', 'P.', 'C.', 'CT'] },
  { id: 'liszt', name: 'Liszt', full: 'Franz Liszt', imslp: 'Liszt, Franz', born: 1811, died: 1886, langs: ['de', 'fr', 'hu'],
    names: ['Franz Liszt', 'Ferenc Liszt', 'Liszt Ferenc', 'Лист'], catalogues: ['S.', 'LW', 'R.'] },
  { id: 'schubert', name: 'Schubert', full: 'Franz Schubert', imslp: 'Schubert, Franz', born: 1797, died: 1828, langs: ['de'],
    names: ['Franz Schubert', 'Franz Peter Schubert', 'Shubert', 'Шуберт'], catalogues: ['D.', 'Op.'] },
  { id: 'schumann', name: 'Schumann', full: 'Robert Schumann', imslp: 'Schumann, Robert', born: 1810, died: 1856, langs: ['de'],
    names: ['Robert Schumann', 'Shuman', 'Schuman', 'Шуман'], catalogues: ['Op.', 'WoO', 'Anh.'] },
  { id: 'brahms', name: 'Brahms', full: 'Johannes Brahms', imslp: 'Brahms, Johannes', born: 1833, died: 1897, langs: ['de'],
    names: ['Johannes Brahms', 'Брамс'], catalogues: ['Op.', 'WoO', 'Anh.'] },
  { id: 'debussy', name: 'Debussy', full: 'Claude Debussy', imslp: 'Debussy, Claude', born: 1862, died: 1918, langs: ['fr'],
    names: ['Claude Debussy', 'Claude-Achille Debussy', 'Debussi', 'Дебюсси'], catalogues: ['L.', 'CD'] },
  { id: 'rachmaninoff', name: 'Rachmaninoff', full: 'Sergei Rachmaninoff', imslp: 'Rachmaninoff, Sergei', born: 1873, died: 1943, langs: ['ru'],
    names: ['Sergei Rachmaninoff', 'Sergei Rachmaninov', 'Sergey Rachmaninov', 'Serge Rachmaninoff', 'Sergej Rachmaninow', 'Rachmaninov', 'Rachmaninow', 'Rachmaninof', 'Rakhmaninov', 'Сергей Рахманинов', 'Рахманинов'], catalogues: ['Op.', 'TN', 'TR'] },
  { id: 'scriabin', name: 'Scriabin', full: 'Alexander Scriabin', imslp: 'Scriabin, Aleksandr', born: 1872, died: 1915, langs: ['ru'],
    names: ['Alexander Scriabin', 'Aleksandr Scriabin', 'Aleksandr Skryabin', 'Alexandre Scriabine', 'Alexander Skrjabin', 'Skryabin', 'Skriabin', 'Scriabine', 'Skrjabin', 'Александр Скрябин', 'Скрябин'], catalogues: ['Op.', 'WoO', 'Anh.'] },
  { id: 'ravel', name: 'Ravel', full: 'Maurice Ravel', imslp: 'Ravel, Maurice', born: 1875, died: 1937, langs: ['fr'],
    names: ['Maurice Ravel', 'Joseph-Maurice Ravel', 'Равель'], catalogues: ['M.', 'O.'] },
  { id: 'grieg', name: 'Grieg', full: 'Edvard Grieg', imslp: 'Grieg, Edvard', born: 1843, died: 1907, langs: ['nb', 'no', 'nn'],
    names: ['Edvard Grieg', 'Edvard Hagerup Grieg', 'Edward Grieg', 'Григ'], catalogues: ['Op.', 'EG'] },
  { id: 'prokofiev', name: 'Prokofiev', full: 'Sergei Prokofiev', imslp: 'Prokofiev, Sergey', born: 1891, died: 1953, langs: ['ru'],
    names: ['Sergei Prokofiev', 'Sergey Prokofiev', 'Serge Prokofiev', 'Sergei Prokofieff', 'Sergej Prokofjew', 'Prokofieff', 'Prokofjew', 'Prokofjev', 'Prokofyev', 'Сергей Прокофьев', 'Прокофьев'], catalogues: ['Op.'] },
  { id: 'scarlatti', name: 'Scarlatti', full: 'Domenico Scarlatti', imslp: 'Scarlatti, Domenico', born: 1685, died: 1757, langs: ['it'],
    names: ['Domenico Scarlatti', 'Giuseppe Domenico Scarlatti', 'D. Scarlatti', 'Скарлатти'], catalogues: ['K.', 'Kk.', 'L.', 'P.', 'CZ.'] },
  { id: 'haydn', name: 'Haydn', full: 'Joseph Haydn', imslp: 'Haydn, Joseph', born: 1732, died: 1809, langs: ['de'],
    names: ['Joseph Haydn', 'Franz Joseph Haydn', 'Josef Haydn', 'F. J. Haydn', 'Hayden', 'Гайдн'], catalogues: ['Hob.', 'L.'] },
  { id: 'mendelssohn', name: 'Mendelssohn', full: 'Felix Mendelssohn', imslp: 'Mendelssohn, Felix', born: 1809, died: 1847, langs: ['de'],
    names: ['Felix Mendelssohn', 'Felix Mendelssohn Bartholdy', 'Mendelssohn Bartholdy', 'Mendelssohn-Bartholdy', 'Mendelsohn', 'Мендельсон'], catalogues: ['Op.', 'MWV', 'WoO'] },
  { id: 'tchaikovsky', name: 'Tchaikovsky', full: 'Pyotr Ilyich Tchaikovsky', imslp: 'Tchaikovsky, Pyotr', born: 1840, died: 1893, langs: ['ru'],
    names: ['Pyotr Ilyich Tchaikovsky', 'Peter Ilyich Tchaikovsky', 'Piotr Tchaikovsky', 'Pyotr Tchaikovsky', 'P. I. Tchaikovsky', 'Tchaikowsky', 'Tschaikowsky', 'Tchaïkovski', 'Tchaikovski', 'Chaikovsky', 'Chaykovsky', 'Čajkovskij', 'Czajkowski', 'Пётр Чайковский', 'Чайковский'], catalogues: ['Op.', 'TH', 'ČW', 'CW'] },
  { id: 'shostakovich', name: 'Shostakovich', full: 'Dmitri Shostakovich', imslp: 'Shostakovich, Dmitry', born: 1906, died: 1975, langs: ['ru'],
    names: ['Dmitri Shostakovich', 'Dmitry Shostakovich', 'Dmitrij Schostakowitsch', 'Schostakowitsch', 'Chostakovitch', 'Szostakowicz', 'Šostakovič', 'Shostakovitch', 'Shosty', 'DSCH', 'Дмитрий Шостакович', 'Шостакович'], catalogues: ['Op.'] },
];

module.exports = { COMPOSERS };
