/* Words the catalogue build and the search share.

   GENRES: each genre's English singular, then the forms it is written in (plural and singular,
   English, French, German, Italian, Polish, Norwegian, Russian). The build uses them to name the
   pieces of a set ("Preludes" makes "Prelude in D-flat major"); search uses them so "étude",
   "etude", "study" and "этюд" find the same pieces. Longer names come first so "prelude and
   fugue" wins over "prelude".

   TEMPO: words that open a tempo marking. A section of a set whose text starts with one of these
   is a tempo ("Sostenuto"), not a name ("Träumerei"). */
'use strict';

const GENRES = [
  ['Prelude and Fugue', 'preludes and fugues', 'prelude and fugue', 'präludium und fuge', 'präludien und fugen', 'prélude et fugue', 'préludes et fugues', 'preludio e fuga', 'прелюдия и фуга', 'прелюдии и фуги'],
  ['Prelude and Fughetta', 'preludes and fughettas', 'prelude and fughetta', 'präludium und fughette'],
  ['Fantasia and Fugue', 'fantasia and fugue', 'fantasie und fuge', 'fantasy and fugue'],
  ['Étude-tableau', 'études-tableaux', 'etudes-tableaux', 'étude-tableau', 'etude-tableau', 'этюды-картины', 'этюд-картина', 'study-picture', 'study-pictures'],
  ['Song Without Words', 'songs without words', 'song without words', 'lieder ohne worte', 'lied ohne worte', 'romances sans paroles', 'romance sans paroles', 'песни без слов', 'песня без слов'],
  ['Lyric Piece', 'lyric pieces', 'lyric piece', 'lyriske stykker', 'lyrisk stykke', 'lyrische stücke', 'lyrisches stück', 'pièces lyriques', 'pièce lyrique'],
  ['Moment musical', 'moments musicaux', 'moment musical', 'musical moments', 'musical moment', 'musikalische momente'],
  ['Hungarian Rhapsody', 'hungarian rhapsodies', 'hungarian rhapsody', 'rhapsodies hongroises', 'rhapsodie hongroise', 'ungarische rhapsodien', 'ungarische rhapsodie', 'magyar rapszódia', 'венгерские рапсодии', 'венгерская рапсодия'],
  ['German Dance', 'german dances', 'german dance', 'deutsche tänze', 'deutscher tanz', 'deutsche', 'deutscher'],
  ['Fantasy Piece', 'fantasiestücke', 'fantasiestück', 'fantasy pieces', 'fantasy piece', 'morceaux fantastiques'],
  ['Piano Sonata', 'piano sonatas', 'piano sonata', 'klaviersonaten', 'klaviersonate', 'sonates pour piano', 'фортепианная соната', 'фортепианные сонаты'],
  ['Keyboard Sonata', 'keyboard sonatas', 'keyboard sonata', 'sonate per clavicembalo', 'essercizi'],
  ['Prelude', 'preludes', 'prelude', 'préludes', 'prélude', 'präludien', 'präludium', 'praeludium', 'praeludia', 'preludi', 'preludio', 'preludium', 'прелюдии', 'прелюдия', 'прелюдий'],
  ['Fugue', 'fugues', 'fugue', 'fugen', 'fuge', 'fughe', 'fuga', 'фуги', 'фуга'],
  ['Fughetta', 'fughettas', 'fughetta', 'fughette'],
  ['Étude', 'études', 'etudes', 'étude', 'etude', 'studies', 'study', 'studien', 'studie', 'etüden', 'etüde', 'studi', 'studio', 'etiudy', 'etiuda', 'этюды', 'этюд'],
  ['Mazurka', 'mazurkas', 'mazurka', 'mazurken', 'mazurki', 'mazurek', 'мазурки', 'мазурка'],
  ['Nocturne', 'nocturnes', 'nocturne', 'notturni', 'notturno', 'nokturny', 'nokturn', 'ноктюрны', 'ноктюрн'],
  ['Waltz', 'waltzes', 'waltz', 'valses', 'valse', 'walzer', 'valzer', 'walce', 'walc', 'вальсы', 'вальс'],
  ['Polonaise', 'polonaises', 'polonaise', 'polonäsen', 'polonäse', 'polonezy', 'polonez', 'polacca', 'полонезы', 'полонез'],
  ['Impromptu', 'impromptus', 'impromptu', 'improvvisi', 'improvviso', 'impromptu', 'экспромты', 'экспромт'],
  ['Ballade', 'ballades', 'ballade', 'balladen', 'ballads', 'ballad', 'ballate', 'ballata', 'ballady', 'ballada', 'баллады', 'баллада'],
  ['Scherzo', 'scherzos', 'scherzi', 'scherzo', 'скерцо'],
  ['Invention', 'inventions', 'invention', 'inventionen', 'inventio', 'invenzioni', 'invenzione', 'инвенции', 'инвенция'],
  ['Sinfonia', 'sinfonias', 'sinfonia', 'sinfonien', 'three-part inventions', 'three-part invention', 'синфонии', 'синфония'],
  ['Partita', 'partitas', 'partita', 'partiten', 'партиты', 'партита'],
  ['English Suite', 'english suites', 'english suite', 'englische suiten', 'englische suite', 'suites anglaises', 'suite anglaise'],
  ['French Suite', 'french suites', 'french suite', 'französische suiten', 'französische suite', 'suites françaises', 'suite française'],
  ['Suite', 'suites', 'suite', 'suiten', 'сюиты', 'сюита'],
  ['Sonatina', 'sonatinas', 'sonatina', 'sonatinen', 'sonatine', 'sonatines', 'сонатины', 'сонатина'],
  ['Sonata', 'sonatas', 'sonata', 'sonaten', 'sonate', 'sonates', 'сонаты', 'соната'],
  ['Variations', 'variations', 'variation', 'variationen', 'variazioni', 'wariacje', 'вариации'],
  ['Fantasy', 'fantasies', 'fantasy', 'fantasias', 'fantasia', 'fantasie', 'fantasien', 'fantaisie', 'fantaisies', 'fantazja', 'фантазия', 'фантазии'],
  ['Impromptu-fantasy', 'fantaisie-impromptu', 'fantasie-impromptu', 'fantasy-impromptu', 'fantasy impromptu'],
  ['Rhapsody', 'rhapsodies', 'rhapsody', 'rhapsodien', 'rhapsodie', 'rapsodie', 'rapsodia', 'рапсодии', 'рапсодия'],
  ['Intermezzo', 'intermezzi', 'intermezzos', 'intermezzo', 'интермеццо'],
  ['Capriccio', 'capriccios', 'capricci', 'capriccio', 'caprices', 'caprice', 'каприччио'],
  ['Bagatelle', 'bagatelles', 'bagatelle', 'bagatellen', 'багатели', 'багатель'],
  ['Consolation', 'consolations', 'consolation', 'tröstungen', 'утешения', 'утешение'],
  ['Liebestraum', 'liebesträume', 'liebestraum', 'dreams of love', 'dream of love', 'rêves d\'amour', 'rêve d\'amour', 'грёзы любви'],
  ['Novellette', 'novelletten', 'novellette', 'novelettes', 'novelette'],
  ['Romance', 'romances', 'romance', 'romanzen', 'romanze', 'романсы', 'романс'],
  ['Humoresque', 'humoresques', 'humoresque', 'humoreske', 'humoresken', 'юмореска'],
  ['Arabesque', 'arabesques', 'arabesque', 'arabeske', 'арабески', 'арабеска'],
  ['Barcarolle', 'barcarolles', 'barcarolle', 'barcarola', 'баркаролы', 'баркарола'],
  ['Berceuse', 'berceuses', 'berceuse', 'lullaby', 'lullabies', 'wiegenlied', 'колыбельная'],
  ['Rondo', 'rondos', 'rondo', 'rondeau', 'рондо'],
  ['Minuet', 'minuets', 'minuet', 'menuets', 'menuet', 'menuette', 'menuett', 'minuetto', 'menuetto', 'менуэты', 'менуэт'],
  ['Ländler', 'ländler', 'landler'],
  ['Écossaise', 'écossaises', 'ecossaises', 'écossaise', 'ecossaise', 'экосезы', 'экосез'],
  ['March', 'marches', 'march', 'märsche', 'marsch', 'marche', 'marcia', 'марши', 'марш'],
  ['Toccata', 'toccatas', 'toccata', 'toccate', 'токката'],
  ['Canon', 'canons', 'canon', 'kanons', 'kanon', 'каноны', 'канон'],
  ['Gigue', 'gigues', 'gigue', 'giga'],
  ['Gavotte', 'gavottes', 'gavotte', 'gavotta', 'гавот'],
  ['Allemande', 'allemandes', 'allemande'],
  ['Courante', 'courantes', 'courante', 'corrente'],
  ['Sarabande', 'sarabandes', 'sarabande', 'sarabanda'],
  ['Bourrée', 'bourrées', 'bourrée', 'bourree'],
  ['Musette', 'musettes', 'musette'],
  ['Overture', 'overtures', 'overture', 'ouverture', 'ouvertüre'],
  ['Concerto', 'concertos', 'concerti', 'concerto', 'konzert', 'konzerte'],
  ['Poem', 'poems', 'poem', 'poèmes', 'poème', 'поэмы', 'поэма'],
  ['Dance', 'dances', 'dance', 'tänze', 'tanz', 'danses', 'danse', 'danze', 'tańce', 'танцы', 'танец'],
  ['Piece', 'pieces', 'piece', 'klavierstücke', 'klavierstück', 'stücke', 'stück', 'morceaux', 'morceau', 'pièces', 'pièce', 'pezzi', 'pezzo', 'utwory', 'пьесы', 'пьеса'],
  ['Album Leaf', 'album leaves', 'album leaf', 'albumblätter', 'albumblatt', 'feuillets d\'album', 'feuillet d\'album', 'albumblad'],
  ['Song', 'songs', 'song', 'lieder', 'lied', 'chansons', 'chanson', 'песни', 'песня'],
];

const TEMPO = /^(m\.?\s?m\.?|allegr|andant|adagi|lent|larg|prest|vivac|viv|moderat|sostenut|agitat|maestos|grav|cantabil|tempo|molto|poco|più|piu|meno|con |sotto voce|assai|animat|tranquill|appassionat|affettuos|misterios|mesto|dolce|espressiv|risolut|giocos|scherzando|leggier|maestoso|marcato|pesante|semplice|calmat|comodo|commodo|furios|impetuos|lusingando|non troppo|quasi|sempre|senza|alla |all'|a tempo|rubato|rapido|veloce|tempestos|vigoros|languid|lugubr|patetic|religios|sostenu|teneramente|dolent|serioso|grazios|innocent|lento|lent |modéré|modérément|animé|vif|très|tres |assez|un peu|sans |retenu|calme|doux|lourd|mouvement|au mouvement|gai|sehr|mässig|massig|langsam|schnell|rasch|lebhaft|ruhig|innig|bewegt|nicht|mit |ziemlich|etwas|kräftig|zart|feurig|munter|kräftig|maestoso|allegro|andante|темп|медленно|быстро|умеренно|оживлённо)/i;

/* a title naming a collection of independent pieces (plural genres, and cycles known by name):
   its sections are pieces, not movements, even when IMSLP gives no "24 preludes" header */
const PLURAL = /\b(preludes|préludes|präludien|preludi|etudes|études|studies|studien|mazurkas|mazurken|nocturnes|notturni|waltzes|valses|walzer|polonaises|impromptus|ballades|balladen|scherzos|scherzi|inventions|sinfonias|bagatelles|bagatellen|intermezzi|rhapsodies|rhapsodien|moments musicaux|songs|lieder|pieces|stücke|klavierstücke|fantasiestücke|morceaux|pièces|pezzi|dances|tänze|danses|ländler|écossaises|ecossaises|minuets|menuets|menuette|marches|märsche|consolations|liebesträume|novelletten|romances|romanzen|albumblätter|kinderszenen|waldszenen|carnaval|papillons|kreisleriana|davidsbündlertänze|bunte blätter|nachtstücke|images|estampes|miroirs|children's corner|seasons|années de pèlerinage|harmonies|légendes|caprices|humoresques|arabesques|sarcasms|visions fugitives|aphorisms|poems|poèmes|pastels|silhouettes|tableaux|lyric pieces|lyriske stykker|slåtter|aquarelles)\b/i;

module.exports = { GENRES, TEMPO, PLURAL };
