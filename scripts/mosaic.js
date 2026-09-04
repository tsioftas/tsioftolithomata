// The homepage band. The opening frame is prerendered by the generator (see
// mosaic_first_frame in generate_site.py), so this file never builds the mosaic —
// it only keeps it moving, fading photographs in and out of cells that are already
// on the page.
//
// Two things it is careful about:
//   * one specimen is never in two cells at once, which is what the grouping in
//     jsondata/mosaic.json is for — the items of a batch share a group because the
//     batch's own photographs show all of them together;
//   * the share of filled cells is drawn independently of the current state. Deciding
//     it from whether a cell is already filled makes the two transition probabilities
//     disagree and the band silts up to about half full whatever the setting says.

(function () {
  'use strict';

  var FILL = 20;        // % of cells holding a photograph
  var INTERVAL = 6000;  // ms between a cell's decisions, before jitter
  var JITTER = 0.7;     // ±70% of the interval, so the grid does not pulse in lockstep
  var FADE = 1100;      // must match the transition on .m-cell img in style.css

  var grid = document.getElementById('hero-grid');
  if (!grid) return;

  var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (still) return;

  // Cells past the bottom of the band are clipped by overflow:hidden. They exist so
  // the same markup can serve every breakpoint; swapping photographs into them would
  // be invisible work and wasted downloads.
  var cells = [];
  var groups = [];        // [[dir, [filename, ...]], ...] per specimen
  var pathGroup = {};     // full thumbnail path -> group index
  var onScreen = {};      // group indices currently claimed by a cell

  function photosOf(index) {
    var out = [];
    groups[index].forEach(function (pair) {
      pair[1].forEach(function (name) {
        out.push(pair[0] + '/thumbs_dir/' + name + '_thumb.webp');
      });
    });
    return out;
  }

  // Rejection sampling: a few dozen cells against four hundred specimens collide
  // rarely, so retrying beats maintaining a shuffled free list. The scan afterwards
  // keeps this terminating if the grid ever outgrows the collection.
  function pickGroup() {
    for (var i = 0; i < 60; i++) {
      var index = Math.floor(Math.random() * groups.length);
      if (!onScreen[index]) return index;
    }
    for (var j = 0; j < groups.length; j++) {
      if (!onScreen[j]) return j;
    }
    return -1;
  }

  function show(cell) {
    var index = pickGroup();
    if (index < 0) return;
    // Claimed before the image loads, so two cells ticking in the same frame cannot
    // both take the same specimen.
    if (cell.group >= 0) delete onScreen[cell.group];
    cell.group = index;
    onScreen[index] = true;
    // Marked here rather than on reveal: decoding takes time, and a cell on its way
    // to filled must not be counted empty in the meantime.
    cell.filled = true;

    var photos = photosOf(index);
    var img = new Image();
    img.alt = '';
    img.decoding = 'async';
    img.className = 'm-in';
    img.src = window.assetHref('/' + photos[Math.floor(Math.random() * photos.length)]);

    var reveal = function () {
      cell.el.appendChild(img);
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { img.classList.remove('m-in'); });
      });
      // Retire everything underneath once the incoming layer is fully opaque.
      setTimeout(function () {
        var layers = cell.el.querySelectorAll('img');
        for (var i = 0; i < layers.length - 1; i++) layers[i].remove();
      }, FADE + 60);
    };
    if (img.decode) img.decode().then(reveal).catch(reveal);
    else img.onload = reveal;
  }

  function hide(cell) {
    cell.filled = false;
    // Released only once the photograph has actually gone, otherwise the specimen
    // could reappear elsewhere while it is still visible here.
    var released = cell.group;
    cell.group = -1;
    if (released >= 0) setTimeout(function () { delete onScreen[released]; }, FADE + 60);
    cell.el.querySelectorAll('img').forEach(function (img) {
      img.classList.add('m-out');
      setTimeout(function () { img.remove(); }, FADE + 60);
    });
  }

  function tick(cell) {
    if (Math.random() * 100 < FILL) show(cell);
    else if (cell.filled) hide(cell);
  }

  function schedule(cell, first) {
    // The first tick is spread over a whole interval so the band does not turn over
    // all at once a few seconds after the page opens.
    var delay = first ? INTERVAL * (0.3 + Math.random() * 1.7)
                      : INTERVAL * (1 - JITTER + Math.random() * 2 * JITTER);
    setTimeout(function () { tick(cell); schedule(cell, false); }, Math.max(600, delay));
  }

  function start(data) {
    groups = data;
    groups.forEach(function (group, index) {
      group.forEach(function (pair) {
        pair[1].forEach(function (name) {
          pathGroup[pair[0] + '/thumbs_dir/' + name + '_thumb.webp'] = index;
        });
      });
    });

    var height = grid.clientHeight;
    Array.prototype.forEach.call(grid.children, function (el) {
      if (el.offsetTop >= height) return;
      var img = el.querySelector('img');
      // The prerendered frame says which specimen a cell holds only through the src,
      // so the claim is recovered from the path rather than from a data attribute.
      var key = img ? decodeURIComponent(img.getAttribute('src')).replace(/^.*?(images\/)/, '$1') : null;
      var group = key && key in pathGroup ? pathGroup[key] : -1;
      if (group >= 0) onScreen[group] = true;
      var cell = { el: el, filled: !!img, group: group };
      cells.push(cell);
      schedule(cell, true);
    });
  }

  fetch(window.assetHref('/jsondata/mosaic.json'))
    .then(function (r) { return r.json(); })
    .then(start)
    .catch(function () {});
})();
