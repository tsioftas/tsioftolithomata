// The homepage band expanded to the whole collection. A click on the band keeps
// every tile on screen where it is, fades the page out from under it, and scatters
// the rest of the collection in around the clicked tile. Lives at #collection.

(function () {
  'use strict';

  var BLOCK = 10;      // as MOSAIC_BLOCK / MOSAIC_FILLED in generate_site.py:
  var FILLED = 3;      // three photographs in every ten cells, like the band
  var TINTS = 6;
  var STAGGER = 450;   // ms of delay from the clicked tile to the farthest one
  var FLIGHT = 900;    // must match .m-cell.c-fly in style.css
  var FADE = 400;      // must match the opacity transition on #collection
  var GROW = 450;      // must match #collection-card.c-grow

  var band = document.getElementById('hero-grid');
  var view = document.getElementById('collection');
  if (!band || !view) return;
  var grid = document.getElementById('collection-grid');
  var closeBtn = document.getElementById('collection-close');
  var card = document.getElementById('collection-card');
  var cardPhoto = document.getElementById('card-photo');
  var scrim = document.getElementById('collection-scrim');
  var root = document.documentElement;
  var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var groups = null;
  var pathGroup = {};    // thumbnail path -> group index, to read the band's photographs
  var isOpen = false;
  var pushed = false;    // whether the #collection history entry is ours to go back from
  var generation = 0;    // bumped on every open and close, so stale timers do nothing
  var details = null;    // promise of collection.json, fetched on the first open
  var cardTile = null;   // the tile the open card grew out of
  var cardGen = 0;

  var ready = window.fetchJSONCached(window.assetHref('/jsondata/mosaic.json')).then(function (data) {
    groups = data;
    groups.forEach(function (group, index) {
      thumbs(group).forEach(function (path) { pathGroup[path] = index; });
    });
  });

  function thumbs(group) {
    var out = [];
    group.dirs.forEach(function (pair) {
      pair[1].forEach(function (name) { out.push(pair[0] + '/thumbs_dir/' + name + '_thumb.webp'); });
    });
    return out;
  }

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function tile(tint, index, photo) {
    if (index < 0) {
      var plain = document.createElement('div');
      plain.className = 'm-cell m-t' + tint;
      return plain;
    }
    var a = document.createElement('a');
    a.className = 'm-cell m-t' + tint;
    a.href = window.documentHref(groups[index].href);
    a.dataset.group = index;
    a.dataset.photo = photo;
    var img = new Image();
    img.alt = '';
    img.decoding = 'async';
    img.loading = 'lazy';
    img.src = window.assetHref('/' + photo);
    a.appendChild(img);
    return a;
  }

  // What a band cell shows right now: its tint, and the photograph on top unless it
  // is on its way out.
  function readBandCell(el) {
    var tint = +(el.className.match(/m-t(\d)/) || [0, 1])[1];
    var imgs = el.querySelectorAll('img:not(.m-out)');
    var img = imgs[imgs.length - 1];
    if (!img) return { tint: tint, index: -1 };
    var path = decodeURIComponent(img.getAttribute('src')).replace(/^.*?(images\/)/, '$1');
    return path in pathGroup ? { tint: tint, index: pathGroup[path], photo: path } : { tint: tint, index: -1 };
  }

  // Lays the collection out so the band's visible rows land on the same pixels, and
  // returns the cells that were not on screen before, for the scatter, and the copy of
  // the band cell that was clicked, if any.
  function build(clicked) {
    var cols = getComputedStyle(band).gridTemplateColumns.split(' ').length;
    var rowH = band.firstElementChild.getBoundingClientRect().height;
    var top = band.getBoundingClientRect().top;
    var bandRows = Math.ceil(band.clientHeight / rowH);
    // The grid starts this far down the view, so its rows line up with the band's.
    var offset = ((top % rowH) + rowH) % rowH;
    var shift = Math.round((top - offset) / rowH);   // view row = band row + shift

    var fixed = {};        // view cell index -> band cell state
    var taken = {};
    for (var r = 0; r < bandRows; r++) {
      if (r + shift < 0) continue;
      for (var c = 0; c < cols; c++) {
        var el = band.children[r * cols + c];
        if (!el) continue;
        var state = readBandCell(el);
        state.el = el;
        fixed[(r + shift) * cols + c] = state;
        if (state.index >= 0) taken[state.index] = true;
      }
    }

    var pool = shuffle(groups.map(function (_, i) { return i; }).filter(function (i) { return !taken[i]; }));
    var fresh = [];
    var free = 0;          // free cells seen, for the three-in-ten stratification
    var filled = null;
    grid.style.paddingTop = offset + 'px';
    grid.textContent = '';

    // Runs until every specimen is placed, then finishes the row so the end is a
    // clean edge. The band's own rows are always laid down, however few remain.
    var minCells = (Math.max(0, bandRows + shift)) * cols;
    var copy = null;       // the clicked band cell's counterpart in the view
    for (var i = 0; pool.length || i % cols || i < minCells; i++) {
      var cell;
      if (fixed[i]) {
        var f = fixed[i];
        cell = tile(f.tint, f.index, f.photo);
        if (f.el === clicked) copy = cell;
      } else {
        if (free % BLOCK === 0) filled = shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, FILLED);
        var index = filled.indexOf(free % BLOCK) >= 0 && pool.length ? pool.pop() : -1;
        var photos = index >= 0 ? thumbs(groups[index]) : null;
        cell = tile(1 + Math.floor(Math.random() * TINTS), index,
                    photos && photos[Math.floor(Math.random() * photos.length)]);
        free++;
        fresh.push({ el: cell, row: Math.floor(i / cols), col: i % cols });
      }
      grid.appendChild(cell);
    }
    return { fresh: fresh, copy: copy, rowH: rowH, offset: offset, colW: band.clientWidth / cols };
  }

  function scatter(layout, origin) {
    var reach = Math.hypot(window.innerWidth, window.innerHeight);
    var flying = [];
    layout.fresh.forEach(function (f) {
      var x = (f.col + 0.5) * layout.colW;
      var y = layout.offset + (f.row + 0.5) * layout.rowH;
      if (y - layout.rowH > window.innerHeight) return;   // off screen: just there
      var dx = x - origin.x, dy = y - origin.y;
      var d = Math.hypot(dx, dy) || 1;
      var throw_ = 120 + Math.random() * 220;
      f.el.style.setProperty('--dx', (dx / d * throw_).toFixed(1) + 'px');
      f.el.style.setProperty('--dy', (dy / d * throw_).toFixed(1) + 'px');
      f.el.style.transitionDelay = Math.round(d / reach * STAGGER + Math.random() * 120) + 'ms';
      f.el.classList.add('c-in');
      flying.push(f.el);
    });
    var gen = generation;
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (gen !== generation) return;
        flying.forEach(function (el) { el.classList.add('c-fly'); el.classList.remove('c-in'); });
        setTimeout(function () {
          if (gen !== generation) return;
          flying.forEach(function (el) {
            el.classList.remove('c-fly');
            el.style.transitionDelay = '';
          });
        }, FLIGHT + STAGGER + 200);
      });
    });
  }

  // `clicked` is the band cell the visitor clicked; a photograph opens straight into
  // its card, so one click reaches the specimen.
  function open(origin, clicked) {
    ready.then(function () {
      if (isOpen) return;
      isOpen = true;
      generation++;
      view.classList.remove('closing');
      // Measured before the page is locked: the lock takes the scrollbar away.
      var layout = build(clicked);
      view.hidden = false;
      view.scrollTop = 0;
      root.classList.add('collection-open');
      details = details || window.fetchJSONCached(window.assetHref('/jsondata/collection.json'));
      if (!still) {
        scatter(layout, origin || { x: window.innerWidth / 2, y: window.innerHeight / 2 });
      }
      closeBtn.focus({ preventScroll: true });
      if (layout.copy && layout.copy.tagName === 'A') openCard(layout.copy);
    });
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    var gen = ++generation;
    dropCard();
    root.classList.remove('collection-open');
    view.classList.add('closing');
    setTimeout(function () {
      if (gen !== generation) return;
      view.hidden = true;
      view.classList.remove('closing');
      grid.textContent = '';
    }, still ? 0 : FADE);
  }

  // ── The card ────────────────────────────────────────────────────────────────

  function name(key) {
    var lang = getLanguage();
    return capitalize(resolveTranslation(lang, globalDict[lang], key));
  }

  function link(text, href) {
    var a = document.createElement('a');
    a.href = window.documentHref(href);
    a.textContent = text;
    return a;
  }

  function fillCard(group, info, data) {
    var lang = getLanguage();
    var localities = data.localities;
    var taxa = document.getElementById('card-taxa');
    taxa.textContent = '';
    if (!info.taxa.length) taxa.appendChild(link(name('αταξινόμητα'), 'unclassified'));
    info.taxa.forEach(function (key, i) {
      if (i) taxa.appendChild(document.createTextNode(' · '));
      taxa.appendChild(link(name(key), data.taxa[key].href));
    });

    // The first taxon's silhouette and illustration stand for the specimen.
    var first = info.taxa.length ? data.taxa[info.taxa[0]] : {};
    var icon = document.getElementById('card-icon');
    icon.hidden = !first.icon;
    if (first.icon) icon.src = first.icon;
    document.getElementById('card-art').style.backgroundImage =
      first.art ? 'url("' + window.assetHref('/' + first.art) + '")' : '';

    var place = document.getElementById('card-locality');
    var loc = info.locality && localities[info.locality];
    place.hidden = !loc;
    if (loc) {
      place.href = window.documentHref(loc.href);
      // A partial language shows its marker for a gap, as everywhere else.
      place.textContent = loc.name[lang] || (languagesDict[lang] || {}).marker || loc.name.en;
    }
    // The age as the card's headline figure, its unit and period underneath:
    // "13.6–11.6" over "MYA · MIDDLE MIOCENE".
    var age = info.age;
    var quantity = age ? window.formatAgeQuantity(age, lang) : '';
    document.getElementById('card-when').hidden = !quantity && !first.icon;
    var unit = resolveTranslation(lang, globalDict[lang], (age && ('about' in age ? age.about : age.from) < 1) ? 'kya' : 'mya');
    var label = quantity ? [unit] : [];
    var known = function (key) { return key && globalDict[lang] && key in globalDict[lang]; };
    if (age && known(age.period)) {
      // "Middle Miocene": the prefix agrees with the period name in every language.
      var period = resolveTranslation(lang, globalDict[lang], age.period);
      label.push(known(age.prefix) ? name(age.prefix) + ' ' + period : capitalize(period));
    }
    document.getElementById('card-age-num').textContent = quantity.replace(' ' + unit, '');
    document.getElementById('card-age-label').textContent = label.join(' · ');

    document.getElementById('card-specimen').href = window.documentHref(group.href);
  }

  // The transform that lays the card's photograph over the tile it came from. The
  // offset* figures ignore transforms, so this holds even while the card is moving.
  function tileTransform(tile) {
    var t = tile.getBoundingClientRect();
    return 'translate(' + (t.left - card.offsetLeft) + 'px,' + (t.top - card.offsetTop) + 'px) scale(' +
      (t.width / card.offsetWidth) + ',' + (t.height / cardPhoto.offsetHeight) + ')';
  }

  function openCard(tile) {
    var index = +tile.dataset.group;
    var gen = ++cardGen;
    details.then(function (data) {
      if (gen !== cardGen || !isOpen) return;
      fillCard(groups[index], data.groups[index], data);

      // The thumbnail is already decoded, so the card grows with a picture in it;
      // the full photograph replaces it once it arrives.
      var img = cardPhoto.querySelector('img');
      var photo = tile.dataset.photo;
      img.src = window.assetHref('/' + photo);
      var full = new Image();
      full.onload = function () { if (gen === cardGen) img.src = full.src; };
      full.src = window.assetHref('/' + photo.replace(/thumbs_dir\/(.*)_thumb\.webp$/, '$1.jpg'));

      cardTile = tile;
      card.hidden = false;
      root.classList.add('card-open');
      if (!still) {
        card.classList.add('c-small');
        card.style.transform = tileTransform(tile);
        card.getBoundingClientRect();   // commit the start before transitioning
        card.classList.add('c-grow');
        card.style.transform = '';
        card.classList.remove('c-small');
      }
      tile.style.visibility = 'hidden';
      cardPhoto.focus({ preventScroll: true });
    });
  }

  // Shrinks the card back into its tile.
  function closeCard() {
    if (!cardTile) return;
    var tile = cardTile;
    var gen = ++cardGen;
    root.classList.remove('card-open');
    if (still) return dropCard();
    card.classList.add('c-grow', 'c-small');
    card.style.transform = tileTransform(tile);
    setTimeout(function () { if (gen === cardGen) dropCard(); }, GROW);
    tile.focus({ preventScroll: true });
  }

  // Gone at once, wherever it was: for closing the whole collection under it.
  function dropCard() {
    cardGen++;
    root.classList.remove('card-open');
    card.hidden = true;
    card.classList.remove('c-grow', 'c-small');
    card.style.transform = '';
    if (cardTile) cardTile.style.visibility = '';
    cardTile = null;
  }

  grid.addEventListener('click', function (e) {
    var tile = e.target.closest('a.m-cell');
    // A modified click still opens the specimen's page, in a new tab or window.
    if (!tile || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    if (!cardTile) openCard(tile);
  });
  cardPhoto.addEventListener('click', closeCard);
  scrim.addEventListener('click', closeCard);

  // The history entry is pushed by the click, so back closes the view; a visitor who
  // arrived on #collection has nothing of ours behind them, and the hash is just cleared.
  function dismiss() {
    if (pushed) {
      history.back();
    } else {
      history.replaceState(null, '', location.pathname + location.search);
      close();
    }
  }

  band.addEventListener('click', function (e) {
    var cell = e.target.closest('.m-cell');
    var rect = (cell || band).getBoundingClientRect();
    history.pushState(null, '', '#collection');
    pushed = true;
    open({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }, cell);
  });

  window.addEventListener('popstate', function () {
    if (location.hash === '#collection') {
      // Forward into an entry the click pushed earlier: still ours.
      pushed = true;
      open(null);
    } else {
      pushed = false;
      close();
    }
  });

  closeBtn.addEventListener('click', dismiss);
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !isOpen) return;
    if (cardTile) closeCard();
    else dismiss();
  });

  if (location.hash === '#collection') open(null);
})();
