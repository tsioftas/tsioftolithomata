// The field: every specimen in the collection on one canvas, arranged by tree, by time
// or by place. The tiles are prerendered links (see index.html.template); this script
// positions them, moves the camera and opens a specimen in the side sheet.
(function () {
  'use strict';

  const root = document.getElementById('field');
  if (!root) return;
  const world = root.querySelector('.field-world');
  const back = root.querySelector('.field-back');
  const labels = root.querySelector('.field-labels');
  // The tree's circle names ride above the tiles, in a layer of their own.
  const ringLayer = document.createElement('div');
  ringLayer.className = 'field-ring-labels';
  world.appendChild(ringLayer);
  const tiles = Array.from(world.querySelectorAll('.tile'));
  const tip = document.getElementById('field-tip');
  const sheet = document.getElementById('field-sheet');
  const html = document.documentElement;
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const T = 64;          // a tile, in world units
  const G = 6;           // the gap between tiles
  const STEP = T + G;
  const HIRES = 92;      // on-screen size past which a tile swaps in its photograph

  let data = null;
  let basemap = null;    // coastlines for the place view (jsondata/basemap.json)
  let mode = 'tree';
  let pos = [];          // per tile: {x, y}
  let order = [];        // tile indices in reading order for the current mode
  let box = { x0: 0, y0: 0, x1: 1, y1: 1 };
  const cam = { x: 0, y: 0, k: 0.5 };

  const lang = () => (typeof getLanguage === 'function' ? getLanguage() : 'en');
  const dict = () => (typeof globalDict !== 'undefined' && globalDict[lang()]) || {};
  function t(key, fallback) {
    const d = dict();
    return key in d ? d[key] : (fallback !== undefined ? fallback : key);
  }
  function taxonName(key) {
    if (!key) return t('unclassified', 'Unclassified');
    const name = t(key, key);
    const extinct = data && data.taxa[key] && data.taxa[key].x;
    return (extinct ? '†' : '') + name.charAt(0).toUpperCase() + name.slice(1);
  }
  function placeName(id) {
    const loc = data.localities[id];
    if (!loc) return '';
    return loc.name[lang()] || loc.name.en || id;
  }

  // A place's name up to its first comma: "Lyme Regis", not "Lyme Regis, Dorset".
  const shortPlace = (id) => placeName(id).split(',')[0];

  // ── Layouts ────────────────────────────────────────────────────────────────
  // Each returns positions for every tile, the labels to draw and the backdrop.

  // How much labels are enlarged on screen at camera scale k (matches the CSS).
  const labelScale = (k) => Math.max(1, 0.55 / k);

  // Grid cells nearest a centre first, so a group of n tiles forms a round blob.
  const DISC = (() => {
    const cells = [];
    for (let y = -12; y <= 12; y++) for (let x = -12; x <= 12; x++) cells.push([x * STEP, y * STEP]);
    return cells.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]) || a[1] - b[1] || a[0] - b[0]);
  })();

  // The tree as nested circles: Life holds the kingdoms, a kingdom its phyla, and so
  // on down to the specimens, which sit in the circle of the taxon they were
  // identified as. Each level's names surface as the camera comes close enough
  // (see updateCircleLabels), so zooming in is descending the tree.
  function layoutTree() {
    const life = { key: '', children: new Map(), items: [] };
    data.items.forEach((item, i) => {
      const key = item.t[0];
      const path = key && data.taxa[key] ? data.taxa[key].path : ['unclassified'];
      let node = life;
      path.forEach((k) => {
        if (!node.children.has(k)) node.children.set(k, { key: k, children: new Map(), items: [] });
        node = node.children.get(k);
      });
      node.items.push(i);
    });
    // A taxon holding specimens of its own as well as subgroups gets an inner group
    // for those (drawn without a circle). A chain of taxa with one subgroup each (an order holding a single family holding
    // a single genus) is one circle, named for its deepest member with the head of the
    // chain above it: nesting that adds nothing but rings would only waste the space.
    const toTree = (node) => {
      const kids = Array.from(node.children.values()).map(toTree);
      if (node.items.length && kids.length) kids.push({ key: node.key, self: true, items: node.items, children: [] });
      if (node.key && kids.length === 1 && !node.items.length && !kids[0].self) {
        return { ...kids[0], chain: [node.key].concat(kids[0].chain || []) };
      }
      return { key: node.key, items: kids.length ? [] : node.items, children: kids };
    };
    const tree = toTree(life);

    const h = d3.hierarchy(tree, (d) => (d.children.length ? d.children : null));
    h.each((n) => {
      n.count = 0;
      if (!n.children) {
        const cells = DISC.slice(0, n.data.items.length);
        n.data.cells = cells;
        n.data.r = Math.max(...cells.map((c) => Math.hypot(c[0], c[1]))) + T * 0.75 + 10;
      }
    });
    h.leaves().forEach((l) => l.ancestors().forEach((a) => { a.count += l.data.items.length; }));
    d3.pack()
      .radius((n) => n.data.r)
      .padding((n) => (n.depth === 0 ? 40 : n.depth === 1 ? 26 : 14))(h);

    const p = [], ord = [], bk = [];
    h.leaves().forEach((l) => {
      l.data.items.forEach((i, j) => {
        p[i] = { x: l.x + l.data.cells[j][0] - T / 2, y: l.y + l.data.cells[j][1] - T / 2 };
        ord.push(i);
      });
    });
    let id = 0;
    h.each((n) => { n.id = id++; });
    h.each((n) => {
      const key = n.data.key;
      const name = n.depth === 0 ? t('tree-of-life', 'Tree of Life')
        : key === 'unclassified' ? t('unclassified', 'Unclassified') : taxonName(key);
      bk.push({
        // The specimens a taxon holds beside its subgroups are a group inside its
        // circle but no circle of their own: one bubble per taxon.
        type: 'circle', id: n.id, parent: n.parent ? n.parent.id : -1,
        x: n.x, y: n.y, r: n.r, depth: n.depth, hidden: !!n.data.self,
        name, kicker: n.data.chain ? taxonName(n.data.chain[0]) : '', count: n.count, leaf: !n.children,
        href: key === 'unclassified' ? 'unclassified' : (data.taxa[key] && data.taxa[key].h),
      });
    });
    return { p, lab: [], ord, back: bk };
  }

  function layoutTime(ls = 1) {
    const bands = data.bands;
    const MAXH = 9;          // tiles per column before it wraps into another
    const PAD = 22;          // a band's inner margin
    const GAP = 14;          // between two localities' columns
    const spans = (a) => bands.filter((b) => a[1] < b.from && a[0] > b.to).length;

    // One column per locality and age. A specimen dated only to a bracket wider than
    // two intervals (glacial till, unidentified) cannot honestly stand in any one of
    // them, so those go to a group of their own after the chart.
    const byKey = new Map();
    const undated = [], broad = [];
    data.items.forEach((item, i) => {
      if (!item.a) { undated.push(i); return; }
      const key = (item.l || '') + '|' + item.a.join('-');
      if (!byKey.has(key)) byKey.set(key, { mid: (item.a[0] + item.a[1]) / 2, list: [], loc: item.l, age: item.a });
      byKey.get(key).list.push(i);
    });
    const perBand = bands.map(() => []);
    byKey.forEach((c) => {
      c.n = Math.ceil(c.list.length / MAXH);
      c.w = c.n * STEP - G;
      if (spans(c.age) > 2) { broad.push(c); return; }
      let k = bands.findIndex((b) => c.mid <= b.from && c.mid >= b.to);
      if (k < 0) k = c.mid > bands[0].from ? 0 : bands.length - 1;
      perBand[k].push(c);
    });

    // Each band is as wide as what stands in it needs, and every column stays inside
    // its own band: near where its age falls, shifted only as far as its neighbours force.
    const p = [], lab = [], ord = [];
    const bk = [];
    let x = 0, top = 0;
    bands.forEach((b, k) => {
      const cols = perBand[k].sort((c1, c2) => c2.mid - c1.mid);
      const need = cols.reduce((s, c) => s + c.w, 0) + GAP * Math.max(0, cols.length - 1) + PAD * 2;
      const W = Math.max(cols.length ? 200 : 110, need);
      const inner = W - PAD * 2;
      cols.forEach((c) => {
        const frac = (b.from - c.mid) / (b.from - b.to);
        c.x = x + PAD + frac * inner - c.w / 2;
      });
      for (let i = 0; i < cols.length; i++) {
        const lo = i ? cols[i - 1].x + cols[i - 1].w + GAP : x + PAD;
        cols[i].x = Math.max(cols[i].x, lo);
      }
      for (let i = cols.length - 1; i >= 0; i--) {
        const hi = i < cols.length - 1 ? cols[i + 1].x - GAP - cols[i].w : x + W - PAD - cols[i].w;
        cols[i].x = Math.min(cols[i].x, hi);
      }
      cols.forEach((c) => {
        c.list.forEach((i, j) => {
          p[i] = { x: c.x + Math.floor(j / MAXH) * STEP, y: -((j % MAXH) + 1) * STEP };
          ord.push(i);
        });
        const h = Math.min(c.list.length, MAXH) * STEP;
        top = Math.max(top, h);
        if (c.loc) lab.push({ x: c.x, y: -h - 8, cls: 'lab-col', text: placeName(c.loc), href: data.localities[c.loc] && data.localities[c.loc].h });
      });
      bk.push({ type: 'band', x, w: W, c: b.c, ink: b.ink, from: b.from,
                name: t(b.key, b.key.charAt(0).toUpperCase() + b.key.slice(1)) });
      x += W;
    });

    // After the chart: the wide brackets, each labelled with what it is known to span,
    // then the undated.
    let ex = x + 140;
    broad.sort((c1, c2) => c2.mid - c1.mid).forEach((c) => {
      c.list.forEach((i, j) => {
        p[i] = { x: ex + Math.floor(j / MAXH) * STEP, y: -((j % MAXH) + 1) * STEP };
        ord.push(i);
      });
      const h = Math.min(c.list.length, MAXH) * STEP;
      top = Math.max(top, h);
      const text = `${+c.age[0].toFixed(1)}–${+c.age[1].toFixed(1)} ${t('ma-unit', 'Ma')}`;
      const kicker = c.loc ? shortPlace(c.loc) : '';
      lab.push({ x: ex, y: -h - 10, cls: 'lab-broad', text, kicker });
      // Spaced by the wider of the column and its label at the size it is drawn.
      ex += Math.max(c.w, Math.max(text.length * 8, kicker.length * 6.5) * ls) + 36;
    });
    undated.forEach((i, j) => {
      p[i] = { x: ex + (j % 4) * STEP, y: -(Math.floor(j / 4) + 1) * STEP };
      ord.push(i);
    });
    if (undated.length) lab.push({ x: ex, y: -Math.ceil(undated.length / 4) * STEP - 10, cls: 'lab-broad', text: '?' });

    const H = top + 60;
    bk.forEach((b) => { b.y = -H; b.h = H; });
    // A portrait screen turns the chart on its side: time runs down the page, oldest
    // at the top, and the reader drags down through it.
    if (root.clientWidth < root.clientHeight * 0.9) {
      p.forEach((q) => { if (q) { const x = q.x; q.x = -q.y - STEP; q.y = x; } });
      lab.forEach((l) => { const x = l.x; l.x = -l.y + 4; l.y = x + 30; });
      bk.forEach((b) => { const x = b.x; b.x = 0; b.y = x; b.h = b.w; b.w = H; b.v = true; });
      return { p, lab, ord, back: bk, fitWidth: true };
    }
    return { p, lab, ord, back: bk };
  }

  // A group of n tiles as a round blob: its cell offsets and the circle around it.
  function blob(n) {
    const cells = DISC.slice(0, n);
    return { cells, r: Math.max(...cells.map((c) => Math.hypot(c[0], c[1]))) + T * 0.75 + 10 };
  }

  // Push overlapping circles apart while a weak spring pulls each back towards where
  // it belongs, so a crowded region spreads out but keeps its shape. `move(c, dx, dy)`
  // lets a parent carry its children with it.
  function relax(list, gap, spring, move) {
    for (let it = 0; it < 360; it++) {
      for (let a = 0; a < list.length; a++) {
        for (let b = a + 1; b < list.length; b++) {
          const A = list[a], B = list[b];
          let dx = B.x - A.x, dy = B.y - A.y;
          let d = Math.hypot(dx, dy);
          const need = A.r + B.r + gap;
          if (d >= need) continue;
          if (d < 0.01) { dx = 1; dy = 0.5; d = Math.hypot(dx, dy); }
          const push = (need - d) / 2;
          move(A, -dx / d * push, -dy / d * push);
          move(B, dx / d * push, dy / d * push);
        }
      }
      list.forEach((c) => move(c, (c.hx - c.x) * spring, (c.hy - c.y) * spring));
    }
  }

  // The collection on the map, nested like the tree: a circle per country where the
  // country is, holding a circle per locality laid out from its own coordinates.
  // Zooming in hands the naming down from countries to localities.
  function layoutPlace() {
    const locs = data.localities;
    const coords = Object.values(locs).filter((l) => l.lat != null);
    const lon0 = Math.min(...coords.map((l) => +l.lon)) - 2;
    const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * 180 / Math.PI;
    const latTop = Math.max(...coords.map((l) => merc(+l.lat))) + 2;
    const S = 130;   // world units per degree
    const proj = (lat, lon) => ({ x: (+lon - lon0) * S, y: (latTop - merc(+lat)) * S });

    const byLoc = new Map();
    const lost = [];
    data.items.forEach((item, i) => {
      const loc = item.l && locs[item.l];
      if (!loc || loc.lat == null) { lost.push(i); return; }
      if (!byLoc.has(item.l)) byLoc.set(item.l, []);
      byLoc.get(item.l).push(i);
    });

    const countries = new Map();
    byLoc.forEach((list, id) => {
      const loc = locs[id];
      const at = proj(loc.lat, loc.lon);
      const b = blob(list.length);
      const c = { id, list, cells: b.cells, r: b.r, x: at.x, y: at.y, hx: at.x, hy: at.y };
      const cc = loc.cc || '?';
      if (!countries.has(cc)) countries.set(cc, { cc, kids: [], flag: loc.flag });
      countries.get(cc).kids.push(c);
    });
    if (lost.length) {
      const b = blob(lost.length);
      countries.set('?', { cc: '?', kids: [{ id: null, list: lost, cells: b.cells, r: b.r, x: 0, y: 0, hx: 0, hy: 0 }] });
    }

    const step = (c, dx, dy) => { c.x += dx; c.y += dy; };
    const CPAD = 46;
    const cl = Array.from(countries.values());
    cl.forEach((k) => {
      relax(k.kids, 18, 0.04, step);
      const e = d3.packEnclose(k.kids);
      k.x = k.hx = e.x; k.y = k.hy = e.y; k.r = e.r + CPAD;
    });
    // The localities without a place sit apart, under the rest.
    const unknown = countries.get('?');
    if (unknown) {
      const others = cl.filter((k) => k !== unknown);
      const left = Math.min(...others.map((k) => k.x - k.r)), bottom = Math.max(...others.map((k) => k.y + k.r));
      const dx = left + unknown.r - unknown.x, dy = bottom + unknown.r + 120 - unknown.y;
      unknown.x += dx; unknown.y += dy; unknown.hx = unknown.x; unknown.hy = unknown.y;
      unknown.kids.forEach((c) => step(c, dx, dy));
    }
    relax(cl, 80, 0.03, (k, dx, dy) => { step(k, dx, dy); k.kids.forEach((c) => step(c, dx, dy)); });
    const all = d3.packEnclose(cl);

    const p = [], ord = [], bk = [];
    if (basemap) {
      const path = (pts, close) => pts.map((q, n) => {
        const r = proj(q[1], q[0]);
        return (n ? 'L' : 'M') + r.x.toFixed(0) + ' ' + r.y.toFixed(0);
      }).join('') + (close ? 'Z' : '');
      const [w, s, e, n] = basemap.bbox;
      const nw = proj(n, w), se = proj(s, e);
      bk.push({
        type: 'land',
        box: [nw.x, nw.y, se.x, se.y],
        land: basemap.land.map((ring) => path(ring, true)).join(''),
        borders: basemap.borders.map((line) => path(line, false)).join(''),
      });
    }
    // Circles go root first, then each level, so a circle's id is its index.
    bk.push({ type: 'circle', id: 0, parent: -1, x: all.x, y: all.y, r: all.r + 60, depth: 0,
              hidden: true, name: t('map', 'Map'), count: data.items.length, leaf: false });
    cl.sort((a, b) => b.kids.reduce((s, c) => s + c.list.length, 0) - a.kids.reduce((s, c) => s + c.list.length, 0));
    cl.forEach((k) => {
      k.cid = bk.filter((b) => b.type === 'circle').length;
      bk.push({ type: 'circle', id: k.cid, parent: 0, x: k.x, y: k.y, r: k.r, depth: 1,
                name: k.cc === '?' ? t('άγνωστο', 'Unknown') : `${k.flag || ''} ${t(k.cc, k.cc.toUpperCase())}`.trim(),
                count: k.kids.reduce((s, c) => s + c.list.length, 0), leaf: false });
    });
    cl.forEach((k) => {
      k.kids.sort((a, b) => b.list.length - a.list.length).forEach((c) => {
        const id = bk.filter((b) => b.type === 'circle').length;
        // The specimens without a locality are a group inside "Unknown", not a
        // second circle of the same name.
        bk.push({ type: 'circle', id, parent: k.cid, x: c.x, y: c.y, r: c.r, depth: 2, leaf: true,
                  hidden: !c.id, name: c.id ? shortPlace(c.id) : '', count: c.list.length,
                  href: c.id ? locs[c.id].h : null });
        c.list.forEach((i, j) => {
          p[i] = { x: c.x + c.cells[j][0] - T / 2, y: c.y + c.cells[j][1] - T / 2 };
          ord.push(i);
        });
      });
    });
    return { p, lab: [], ord, back: bk };
  }

  const LAYOUTS = { tree: layoutTree, time: layoutTime, place: layoutPlace };

  // ── Drawing ────────────────────────────────────────────────────────────────

  function el(tag, cls, parent) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (parent) parent.appendChild(e);
    return e;
  }

  function drawLabels(list) {
    labels.textContent = '';
    list.forEach((l) => {
      const e = el(l.href ? 'a' : 'span', 'field-label ' + l.cls, labels);
      if (l.href) e.href = window.documentHref(l.href);
      e.style.transform = `translate(${l.x}px, ${l.y}px)`;
      const inner = el('span', 'field-label-inner', e);
      if (l.kicker) el('span', 'field-label-kicker', inner).textContent = l.kicker;
      el('span', 'field-label-text', inner).textContent = l.text;
      if (l.count) el('span', 'field-label-count', inner).textContent = l.count;
    });
  }

  let circleLabels = [];
  let circles = [];
  function drawBack(list) {
    back.textContent = '';
    ringLayer.textContent = '';
    circleLabels = [];
    focusId = -1;   // a new arrangement redraws its breadcrumb
    circles = list.filter((b) => b.type === 'circle');
    const svgNS = 'http://www.w3.org/2000/svg';
    let rings = null;
    // An SVG has to be as big as what it draws: one sized to nothing with its
    // overflow showing is not painted at all once the world is scaled.
    const sized = (cls, x0, y0, x1, y1) => {
      const s = document.createElementNS(svgNS, 'svg');
      s.setAttribute('class', cls);
      s.setAttribute('viewBox', `${x0} ${y0} ${x1 - x0} ${y1 - y0}`);
      s.style.cssText = `left:${x0}px;top:${y0}px;width:${x1 - x0}px;height:${y1 - y0}px`;
      return s;
    };
    list.forEach((b) => {
      if (b.type === 'land') {
        const [x0, y0, x1, y1] = b.box;
        const map = sized('fb-map', x0, y0, x1, y1);
        // The crop fades out towards its edges through a radial fill, not a mask: a
        // mask over a layer this size is more than a phone's GPU will take.
        const r = Math.max(x1 - x0, y1 - y0) / 2;
        map.innerHTML = `<defs>
          <radialGradient id="fb-land-fade" gradientUnits="userSpaceOnUse" cx="${(x0 + x1) / 2}" cy="${(y0 + y1) / 2}" r="${r}">
            <stop offset="0.55" class="fb-land-stop"/><stop offset="1" class="fb-land-stop" stop-opacity="0"/></radialGradient>
          <radialGradient id="fb-coast-fade" gradientUnits="userSpaceOnUse" cx="${(x0 + x1) / 2}" cy="${(y0 + y1) / 2}" r="${r}">
            <stop offset="0.55" class="fb-coast-stop"/><stop offset="1" class="fb-coast-stop" stop-opacity="0"/></radialGradient>
        </defs>`;
        const land = document.createElementNS(svgNS, 'path');
        land.setAttribute('class', 'fb-land');
        land.setAttribute('d', b.land);
        const borders = document.createElementNS(svgNS, 'path');
        borders.setAttribute('class', 'fb-borders');
        borders.setAttribute('d', b.borders);
        map.append(land, borders);
        back.appendChild(map);
      } else if (b.type === 'circle') {
        if (!rings) {
          // The first circle is the outermost, so it bounds them all.
          rings = sized('fb-rings', b.x - b.r - 4, b.y - b.r - 4, b.x + b.r + 4, b.y + b.r + 4);
          back.appendChild(rings);
        }
        if (b.hidden) return;
        const c = document.createElementNS(svgNS, 'circle');
        c.setAttribute('cx', b.x.toFixed(1)); c.setAttribute('cy', b.y.toFixed(1)); c.setAttribute('r', b.r.toFixed(1));
        c.setAttribute('class', `fb-ring d${Math.min(b.depth, 5)}${b.leaf ? ' is-leaf' : ''}`);
        rings.appendChild(c);
        const e = el('div', 'fb-ring-label', ringLayer);
        e.style.transform = `translate(${b.x}px, ${b.y - b.r}px)`;
        e.dataset.ring = circleLabels.length;
        const inner = el('span', 'fb-ring-inner', e);
        if (b.kicker) el('span', 'fb-ring-kicker', inner).textContent = b.kicker + ' ›';
        el('span', 'fb-ring-name', inner).textContent = b.name;
        el('span', 'fb-ring-count', inner).textContent = b.count;
        if (b.href) {
          const a = el('a', 'fb-ring-link', inner);
          a.href = window.documentHref(b.href);
          a.setAttribute('aria-label', b.name);
          a.textContent = '↗';
        }
        circleLabels.push({ el: e, b, shown: false });
      } else if (b.type === 'band') {
        const e = el('div', 'fb-band' + (b.v ? ' is-v' : ''), back);
        e.style.cssText = `transform:translate(${b.x}px,${b.y}px);width:${b.w}px;height:${b.h}px;--band:${b.c};--band-ink:${b.ink}`;
        el('span', 'fb-band-name', e).textContent = b.name;
        el('span', 'fb-band-age', e).textContent = String(+b.from.toFixed(1));
      }
    });
  }

  function boundsOf(out) {
    const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    out.p.forEach((q) => {
      if (!q) return;
      b.x0 = Math.min(b.x0, q.x); b.y0 = Math.min(b.y0, q.y);
      b.x1 = Math.max(b.x1, q.x + T); b.y1 = Math.max(b.y1, q.y + T);
    });
    out.lab.forEach((l) => { if (l.cls !== 'lab-col') b.y0 = Math.min(b.y0, l.y - 40); });
    // The time chart's bands belong in the frame too, with their names under them,
    // and the outermost circle of the tree or the map with its own.
    out.back.forEach((bk) => {
      if (bk.type === 'circle' && bk.depth === 0) {
        b.x0 = Math.min(b.x0, bk.x - bk.r); b.x1 = Math.max(b.x1, bk.x + bk.r);
        b.y0 = Math.min(b.y0, bk.y - bk.r - 30); b.y1 = Math.max(b.y1, bk.y + bk.r);
      } else if (bk.type === 'band') {
        b.x0 = Math.min(b.x0, bk.x); b.x1 = Math.max(b.x1, bk.x + bk.w);
        b.y0 = Math.min(b.y0, bk.y);
        b.y1 = Math.max(b.y1, bk.y + bk.h + (bk.v ? 0 : 80));
      }
    });
    b.fitWidth = !!out.fitWidth;
    return b;
  }

  function arrange(next, animate) {
    mode = next;
    root.dataset.mode = mode;
    document.querySelectorAll('[data-field-mode]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.fieldMode === mode));
    });
    // Laid out twice: once to learn how far out the camera will be, then again with
    // room for the labels at the size they will be drawn there.
    let out = LAYOUTS[mode](1);
    const first = boundsOf(out);
    out = LAYOUTS[mode](labelScale(fitView(first).k));
    const prev = pos;
    pos = out.p;
    order = out.ord;
    box = boundsOf(out);

    // Tiles travel with a delay that grows with distance from the centre, so a
    // rearrangement ripples outwards rather than lurching all at once.
    const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
    const reach = Math.hypot(box.x1 - box.x0, box.y1 - box.y0) || 1;
    tiles.forEach((tile, i) => {
      const q = pos[i];
      if (!q) { tile.hidden = true; return; }
      tile.style.transitionDelay = animate && !still
        ? Math.round((Math.hypot(q.x - cx, q.y - cy) / reach) * 420 + Math.random() * 120) + 'ms'
        : '0ms';
      tile.style.transform = `translate(${q.x}px, ${q.y}px)`;
    });
    root.classList.toggle('is-moving', !!(animate && prev.length));
    labels.classList.add('is-hidden');
    drawBack(out.back);
    setTimeout(() => {
      drawLabels(out.lab);
      labels.classList.remove('is-hidden');
      root.classList.remove('is-moving');
    }, animate && !still ? 700 : 0);
    try { history.replaceState(null, '', mode === 'tree' ? location.pathname + location.search : '#' + mode); } catch (e) { /* file:// */ }
  }

  // ── Camera ─────────────────────────────────────────────────────────────────

  // Per frame only the world's transform changes. The scale the labels read (--k) is
  // set on their own small layers, never on the field, whose 410 tiles would all be
  // restyled with it; the tiles get it once the camera comes to rest.
  let near = null, mid = null, settleTimer = null;
  function apply() {
    world.style.transform = `translate3d(${cam.x}px, ${cam.y}px, 0) scale(${cam.k})`;
    labels.style.setProperty('--k', cam.k);
    back.style.setProperty('--k', cam.k);
    ringLayer.style.setProperty('--k', cam.k);
    const n = T * cam.k > 44, m = T * cam.k > 24;
    if (n !== near) { near = n; root.classList.toggle('is-near', n); }
    if (m !== mid) { mid = m; root.classList.toggle('is-mid', m); }
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => world.style.setProperty('--k', cam.k), 120);
    scheduleHires();
    if (circleLabels.length && !labelFrame) labelFrame = requestAnimationFrame(updateCircleLabels);
  }

  // A circle's name shows while the circle is big enough on screen to hold it and
  // not yet so big that it is the whole view: zooming in hands the naming down a level.
  // The circle in focus is the smallest one around the centre of the view that still
  // fills a good part of it. Its subgroups are named, and the path down to it is
  // shown as a breadcrumb, so it is always plain where in the tree you are.
  let labelFrame = 0;
  let focusId = -1;
  const crumbs = document.getElementById('field-path');
  // The part of the view a circle is framed in, clear of the controls above and below.
  const frameSpan = () => Math.min(root.clientWidth, root.clientHeight - 200);
  function updateCircleLabels() {
    labelFrame = 0;
    const span = frameSpan();
    const wx = (root.clientWidth / 2 - cam.x) / cam.k, wy = (root.clientHeight / 2 - cam.y) / cam.k;
    let focus = circles[0];
    circles.forEach((c) => {
      // 0.4 of the view: below what flyToCircle frames a circle at (0.45), above the
      // whole tree's own size at the opening fit, so the view opens on Life.
      if (!c.hidden && c.r * cam.k >= span * 0.4 && c.r < focus.r && Math.hypot(wx - c.x, wy - c.y) <= c.r) focus = c;
    });
    // Largest circles claim their label's place first; a smaller one whose label
    // would land on a taken place stays unnamed until the camera spreads them apart.
    const taken = [];
    circleLabels
      .filter((c) => c.b.parent === focus.id && c.b.r * cam.k > 14)
      .sort((a, b) => b.b.r - a.b.r)
      .forEach((c) => {
        const w = c.b.name.length * 9 + (c.b.href ? 78 : 50) + (c.b.kicker ? c.b.kicker.length * 6 : 0);
        const x = c.b.x * cam.k + cam.x - w / 2, y = (c.b.y - c.b.r) * cam.k + cam.y + 10;
        const box = { x0: x - 4, y0: y - 4, x1: x + w + 4, y1: y + 30 };
        c.want = !taken.some((o) => box.x0 < o.x1 && box.x1 > o.x0 && box.y0 < o.y1 && box.y1 > o.y0);
        if (c.want) taken.push(box);
      });
    circleLabels.forEach((c) => {
      const show = !!c.want && c.b.parent === focus.id && c.b.r * cam.k > 14;
      c.want = false;
      if (show !== c.shown) { c.shown = show; c.el.classList.toggle('is-shown', show); }
    });
    if (focus.id !== focusId) { focusId = focus.id; drawCrumbs(focus); }
  }

  if (crumbs) crumbs.addEventListener('click', (e) => {
    const step = e.target.closest('[data-ring]');
    if (step && circles[+step.dataset.ring]) flyToCircle(circles[+step.dataset.ring]);
  });

  function drawCrumbs(focus) {
    if (!crumbs) return;
    const chain = [];
    for (let c = focus; c; c = c.parent >= 0 ? circles[c.parent] : null) chain.unshift(c);
    crumbs.textContent = '';
    chain.forEach((c, n) => {
      if (n) el('span', 'field-path-sep', crumbs).textContent = '/';
      const b = el('button', 'field-path-step', crumbs);
      b.type = 'button';
      b.textContent = c.name;
      b.dataset.ring = c.id;
      if (n === chain.length - 1) b.setAttribute('aria-current', 'true');
    });
    if (focus.href && focus.depth) {
      const a = el('a', 'field-path-open', crumbs);
      a.href = window.documentHref(focus.href);
      a.textContent = '↗';
      a.setAttribute('aria-label', focus.name);
    }
  }

  // The smallest circle under a point, for diving into it.
  function circleAt(sx, sy) {
    const r = root.getBoundingClientRect();
    const wx = (sx - r.left - cam.x) / cam.k, wy = (sy - r.top - cam.y) / cam.k;
    let best = null;
    circles.forEach((c) => {
      if (!c.hidden && Math.hypot(wx - c.x, wy - c.y) <= c.r && (!best || c.r < best.r)) best = c;
    });
    return best;
  }

  function flyToCircle(c) {
    const k = Math.min(4, Math.max(kLimits()[0], (frameSpan() * 0.9) / (2 * c.r)));
    flyTo({ k, x: root.clientWidth / 2 - c.x * k, y: (root.clientHeight + 40) / 2 - c.y * k }, 750);
  }

  function fitView(b) {
    const narrow = root.clientWidth < 760;
    const pad = Math.min(96, root.clientWidth * 0.06);
    // The tree has its breadcrumb under the mode switch to keep clear of.
    const top = (narrow ? 130 : 128) + (mode !== 'time' ? 44 : 0), bottom = narrow ? 210 : 172;
    const W = root.clientWidth - pad * 2, H = root.clientHeight - top - bottom;
    if (b.fitWidth) {
      const k = Math.min(W / (b.x1 - b.x0), 2.4);
      return { k, x: pad + (W - (b.x1 - b.x0) * k) / 2 - b.x0 * k, y: top - b.y0 * k };
    }
    const k = Math.min(W / (b.x1 - b.x0), H / (b.y1 - b.y0), 2.4);
    return {
      k,
      x: pad + (W - (b.x1 - b.x0) * k) / 2 - b.x0 * k,
      y: top + (H - (b.y1 - b.y0) * k) / 2 - b.y0 * k,
    };
  }

  let anim = null;
  function flyTo(target, ms) {
    cancelAnimationFrame(anim);
    if (still || !ms) { Object.assign(cam, target); apply(); return Promise.resolve(); }
    const from = { ...cam };
    const t0 = performance.now();
    return new Promise((done) => {
      const step = (now) => {
        const p = Math.min(1, (now - t0) / ms);
        const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
        cam.k = from.k * Math.pow(target.k / from.k, e);
        cam.x = from.x + (target.x - from.x) * e;
        cam.y = from.y + (target.y - from.y) * e;
        apply();
        if (p < 1) anim = requestAnimationFrame(step); else done();
      };
      anim = requestAnimationFrame(step);
    });
  }

  function fit(ms) { return flyTo(fitView(box), ms); }

  function kLimits() {
    const f = fitView(box).k;
    return [Math.min(f * 0.6, 0.15), 4];
  }

  function zoomAt(sx, sy, factor) {
    const [lo, hi] = kLimits();
    const k = Math.max(lo, Math.min(hi, cam.k * factor));
    const r = root.getBoundingClientRect();
    const px = sx - r.left, py = sy - r.top;
    cam.x = px - (px - cam.x) * (k / cam.k);
    cam.y = py - (py - cam.y) * (k / cam.k);
    cam.k = k;
    apply();
  }

  // Photographs for the tiles big enough on screen to deserve one.
  let hiresTimer = null;
  function scheduleHires() {
    clearTimeout(hiresTimer);
    hiresTimer = setTimeout(loadHires, 140);
  }
  function loadHires() {
    if (!data || T * cam.k < HIRES) return;
    const W = root.clientWidth, H = root.clientHeight;
    tiles.forEach((tile, i) => {
      if (tile.dataset.hires || !pos[i]) return;
      const sx = pos[i].x * cam.k + cam.x, sy = pos[i].y * cam.k + cam.y;
      if (sx > W || sy > H || sx + T * cam.k < 0 || sy + T * cam.k < 0) return;
      const ph = data.items[i].p[0];
      tile.dataset.hires = '1';
      const img = new Image();
      img.alt = '';
      img.decoding = 'async';
      img.onload = () => tile.classList.add('has-hires');
      img.src = window.assetHref('/' + ph[0] + '/thumbs_dir/' + ph[1] + '_thumb.webp');
      tile.appendChild(img);
    });
  }

  // ── Input ──────────────────────────────────────────────────────────────────

  const pointers = new Map();
  let drag = null;
  let suppressClick = false;
  let velocity = { x: 0, y: 0 };
  let lastMove = 0;
  let glide = null;

  root.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.field-ui, .sheet, .field-label')) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    cancelAnimationFrame(anim);
    cancelAnimationFrame(glide);
    // A primary pointer starts a new gesture. Anything still tracked is stale (an up
    // the browser never delivered), and left in would turn the next tap into a pinch
    // that swallows the click: on phones, every tap after the first drag.
    if (e.isPrimary) pointers.clear();
    // Once the reader starts moving around, the intro steps out of the way (phones).
    root.classList.add('is-exploring');
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // Captured only once it is a drag (or a pinch): capturing on press would retarget
    // the click away from the tile that was tapped.
    if (pointers.size === 2) root.setPointerCapture(e.pointerId);
    if (pointers.size === 1) {
      drag = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, moved: false };
      velocity = { x: 0, y: 0 };
    } else if (pointers.size === 2) {
      const [a, b] = Array.from(pointers.values());
      drag = { pinch: Math.hypot(a.x - b.x, a.y - b.y), k: cam.k, moved: true };
    }
  });

  root.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) {
      if (e.pointerType === 'mouse') hover(e);
      return;
    }
    const prev = pointers.get(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!drag) return;
    if (pointers.size === 2 && drag.pinch) {
      const [a, b] = Array.from(pointers.values());
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, (drag.k * d / drag.pinch) / cam.k);
      return;
    }
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) > 5) {
      drag.moved = true;
      root.classList.add('is-dragging');
      try { root.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }
      hideTip();
    }
    if (drag.moved && !drag.pinch) {
      const now = performance.now();
      const dt = Math.max(1, now - lastMove);
      velocity = { x: (e.clientX - prev.x) / dt, y: (e.clientY - prev.y) / dt };
      lastMove = now;
      cam.x = drag.cx + dx;
      cam.y = drag.cy + dy;
      apply();
    }
  });

  function release(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size > 0) {
      const [a] = Array.from(pointers.values());
      drag = { x: a.x, y: a.y, cx: cam.x, cy: cam.y, moved: true };
      return;
    }
    root.classList.remove('is-dragging');
    if (drag && !drag.moved && e.type === 'pointerup' && e.pointerType !== 'mouse') {
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      if (hit && !hit.closest('a.fb-ring-link') && tapAt(hit, e.clientX, e.clientY)) tappedAt = performance.now();
    }
    if (drag && drag.moved) {
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 60);
      if (!still && performance.now() - lastMove < 80) {
        let v = { ...velocity };
        const step = () => {
          v.x *= 0.92; v.y *= 0.92;
          cam.x += v.x * 16; cam.y += v.y * 16;
          apply();
          if (Math.hypot(v.x, v.y) > 0.02) glide = requestAnimationFrame(step);
        };
        glide = requestAnimationFrame(step);
      }
    }
    drag = null;
  }
  root.addEventListener('pointerup', release);
  root.addEventListener('pointercancel', release);

  root.addEventListener('wheel', (e) => {
    if (e.target.closest('.sheet, .field-ui')) return;
    e.preventDefault();
    cancelAnimationFrame(glide);
    // Trackpads pan with two fingers and zoom with a pinch (ctrlKey); a wheel zooms.
    const trackpadPan = !e.ctrlKey && e.deltaMode === 0 && Math.abs(e.deltaX) > 0;
    if (trackpadPan) {
      cam.x -= e.deltaX; cam.y -= e.deltaY; apply();
    } else {
      const unit = e.deltaMode === 1 ? 16 : 1;
      zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.012 : 0.0018)));
    }
  }, { passive: false });

  // In the tree and on the map, a click on a circle (or its name) flies into it.
  root.addEventListener('click', (e) => {
    if (suppressClick || performance.now() - tappedAt < 600) return;
    if (e.target.closest('.tile')) return;
    tapAt(e.target, e.clientX, e.clientY);
  });

  // What a tap or click on the field does: a tile opens its specimen; in the tree or
  // on the map, a circle or its name is flown into. Touch taps are handled on release
  // (see release()), because a phone swallows the click of a tap that follows a fling.
  let tappedAt = 0;
  function tapAt(target, x, y) {
    const tile = target.closest('.tile');
    if (tile) { openSheet(tiles.indexOf(tile)); return true; }
    if (mode === 'time' || target.closest('.field-ui, .sheet, a')) return false;
    const label = target.closest('.fb-ring-label');
    const c = label ? circleLabels[+label.dataset.ring].b : circleAt(x, y);
    if (c) { flyToCircle(c); return true; }
    return false;
  }

  root.addEventListener('dblclick', (e) => {
    if (mode !== 'time' || e.target.closest('.field-ui, .sheet')) return;
    const r = root.getBoundingClientRect();
    const k = Math.min(kLimits()[1], cam.k * 2.2);
    const px = e.clientX - r.left, py = e.clientY - r.top;
    flyTo({ k, x: px - (px - cam.x) * (k / cam.k), y: py - (py - cam.y) * (k / cam.k) }, 420);
  });

  world.addEventListener('click', (e) => {
    const tile = e.target.closest('.tile');
    if (!tile) return;
    if (suppressClick || performance.now() - tappedAt < 600) { e.preventDefault(); return; }
    // A modified click opens the specimen's page as a link would.
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    openSheet(tiles.indexOf(tile));
  });
  labels.addEventListener('click', (e) => { if (suppressClick) e.preventDefault(); });

  // ── The tooltip ──
  let tipFor = -1;
  function hover(e) {
    const tile = e.target.closest && e.target.closest('.tile');
    if (!tile || !data || root.classList.contains('is-dragging')) { hideTip(); return; }
    const i = tiles.indexOf(tile);
    if (i !== tipFor) {
      tipFor = i;
      const item = data.items[i];
      tip.querySelector('.tip-taxon').textContent = item.t.length ? item.t.map(taxonName).join(', ') : t('unclassified', 'Unclassified');
      tip.querySelector('.tip-meta').textContent = [
        item.l ? placeName(item.l) : '',
        item.a ? ageText(item.a) : '',
      ].filter(Boolean).join(' · ');
      tip.hidden = false;
    }
    const r = root.getBoundingClientRect();
    const x = Math.min(e.clientX - r.left + 16, root.clientWidth - tip.offsetWidth - 12);
    const y = Math.min(e.clientY - r.top + 18, root.clientHeight - tip.offsetHeight - 12);
    tip.style.transform = `translate(${x}px, ${y}px)`;
  }
  function hideTip() { tipFor = -1; if (tip) tip.hidden = true; }
  root.addEventListener('pointerleave', hideTip);

  function ageText(a) {
    const age = a[0] === a[1] ? { about: a[0] } : { from: a[0], to: a[1] };
    return typeof window.formatAgeQuantity === 'function' ? window.formatAgeQuantity(age, lang()) : `${a[0]}–${a[1]} Ma`;
  }
  function bandOf(a) {
    const mid = (a[0] + a[1]) / 2;
    return data.bands.find((b) => mid <= b.from && mid >= b.to);
  }

  // ── The sheet ──────────────────────────────────────────────────────────────
  let captionsPromise = null;
  const captions = () => captionsPromise || (captionsPromise =
    window.fetchJSONCached(window.assetHref('/jsondata/field-captions.json')).catch(() => []));
  let current = -1;
  let photo = 0;
  let sheetReturn = null;
  const $ = (s) => sheet.querySelector(s);

  function openSheet(i) {
    if (i < 0 || !data) return;
    if (current < 0) sheetReturn = document.activeElement;
    current = i;
    photo = 0;
    const item = data.items[i];
    tiles.forEach((tl) => tl.classList.remove('is-current'));
    tiles[i].classList.add('is-current');

    const taxa = $('.sheet-taxa');
    taxa.textContent = '';
    (item.t.length ? item.t : [null]).forEach((key, n) => {
      if (n) taxa.append(', ');
      const a = el('a', '', taxa);
      a.href = window.documentHref(key ? (data.taxa[key].h || '') : 'unclassified');
      a.textContent = taxonName(key);
    });
    const path = $('.sheet-path');
    path.textContent = '';
    const first = item.t[0] && data.taxa[item.t[0]];
    if (first) first.path.slice(0, -1).forEach((key) => {
      const a = el('a', '', path);
      a.href = window.documentHref((data.taxa[key] && data.taxa[key].h) || '');
      a.textContent = taxonName(key);
    });

    const place = $('.sheet-place');
    const loc = item.l && data.localities[item.l];
    place.hidden = !loc;
    if (loc) {
      place.href = window.documentHref(loc.h);
      $('.sheet-place-flag').textContent = loc.flag || '';
      $('.sheet-place-name').textContent = placeName(item.l);
    }
    const when = $('.sheet-when');
    when.hidden = !item.a;
    if (item.a) {
      const band = bandOf(item.a);
      $('.sheet-age').textContent = ageText(item.a);
      $('.sheet-band').textContent = band ? t(band.key, band.key) : '';
      when.style.setProperty('--band', band ? band.c : 'var(--fg-3)');
    }
    $('.sheet-new').hidden = !item.n;
    $('.sheet-open').href = window.documentHref(item.h);
    $('.sheet-id').textContent = item.id;
    showPhoto();

    sheet.hidden = false;
    requestAnimationFrame(() => sheet.classList.add('is-open'));
    html.classList.add('sheet-open');
    hideTip();
    $('.sheet-close').focus({ preventScroll: true });
    revealTile(i);
  }

  function showPhoto() {
    const item = data.items[current];
    const ph = item.p[photo];
    const img = $('.sheet-photo');
    img.classList.remove('is-loaded');
    // The tile's own thumbnail first, the full photograph as soon as it arrives.
    img.src = window.assetHref('/' + ph[0] + '/thumbs_dir/' + ph[1] + '_thumb.webp');
    const full = new Image();
    const want = current, which = photo;
    full.onload = () => { if (want === current && which === photo) { img.src = full.src; img.classList.add('is-loaded'); } };
    full.src = window.assetHref('/' + ph[0] + '/' + ph[1] + '.jpg');
    $('.sheet-caption').textContent = '';
    captions().then((all) => {
      if (want !== current || which !== photo) return;
      const c = all[current] && all[current][photo];
      $('.sheet-caption').textContent = (c && (c[lang()] || c.en)) || '';
    });
    $('.sheet-count').textContent = item.p.length > 1 ? `${photo + 1} / ${item.p.length}` : '';
    sheet.classList.toggle('has-many', item.p.length > 1);
  }

  function stepPhoto(d) {
    const n = data.items[current].p.length;
    if (n < 2) return;
    photo = (photo + d + n) % n;
    showPhoto();
  }

  function stepSpecimen(d) {
    const at = order.indexOf(current);
    openSheet(order[(at + d + order.length) % order.length]);
  }

  // Bring the open tile into view beside the sheet if it is off screen.
  function revealTile(i) {
    const q = pos[i];
    const sheetW = window.innerWidth > 760 ? sheet.offsetWidth || 420 : 0;
    const sheetH = window.innerWidth > 760 ? 0 : window.innerHeight * 0.55;
    const W = root.clientWidth - sheetW, H = root.clientHeight - sheetH;
    const sx = q.x * cam.k + cam.x, sy = q.y * cam.k + cam.y, s = T * cam.k;
    if (sx > 40 && sy > 100 && sx + s < W - 40 && sy + s < H - 40 && s > 30) return;
    const k = Math.max(cam.k, 1.1);
    flyTo({ k, x: W / 2 - (q.x + T / 2) * k, y: (H + 60) / 2 - (q.y + T / 2) * k }, 650);
  }

  function closeSheet() {
    if (current < 0) return;
    tiles[current].classList.remove('is-current');
    current = -1;
    sheet.classList.remove('is-open');
    html.classList.remove('sheet-open');
    setTimeout(() => { if (current < 0) sheet.hidden = true; }, still ? 0 : 380);
    if (sheetReturn && sheetReturn.focus) sheetReturn.focus({ preventScroll: true });
  }

  sheet.addEventListener('click', (e) => {
    if (e.target.closest('.sheet-close')) closeSheet();
    else if (e.target.closest('.sheet-prev-photo')) stepPhoto(-1);
    else if (e.target.closest('.sheet-next-photo')) stepPhoto(1);
    else if (e.target.closest('.sheet-prev')) stepSpecimen(-1);
    else if (e.target.closest('.sheet-next')) stepSpecimen(1);
  });

  // Swipe the photograph on a phone.
  let swipe = null;
  $('.sheet-media').addEventListener('pointerdown', (e) => { swipe = { x: e.clientX, y: e.clientY }; });
  $('.sheet-media').addEventListener('pointerup', (e) => {
    if (!swipe) return;
    const dx = e.clientX - swipe.x;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(e.clientY - swipe.y)) stepPhoto(dx < 0 ? 1 : -1);
    swipe = null;
  });

  // ── Controls ───────────────────────────────────────────────────────────────

  document.addEventListener('click', (e) => {
    const m = e.target.closest('[data-field-mode]');
    if (m && data) {
      if (m.dataset.fieldMode === mode) { fit(600); return; }
      closeSheet();
      arrange(m.dataset.fieldMode, true);
      fit(900);
      return;
    }
    const z = e.target.closest('[data-field-zoom]');
    if (z && data) {
      const r = root.getBoundingClientRect();
      const v = z.dataset.fieldZoom;
      if (v === 'fit') fit(600);
      else {
        const f = v === 'in' ? 1.6 : 1 / 1.6;
        const [lo, hi] = kLimits();
        const k = Math.max(lo, Math.min(hi, cam.k * f));
        const px = r.width / 2, py = r.height / 2;
        flyTo({ k, x: px - (px - cam.x) * (k / cam.k), y: py - (py - cam.y) * (k / cam.k) }, 320);
      }
      return;
    }
    if (e.target.closest('[data-field-random]') && data) {
      const i = Math.floor(Math.random() * tiles.length);
      const q = pos[i];
      const k = Math.max(1.4, cam.k);
      const W = root.clientWidth - (window.innerWidth > 760 ? 440 : 0);
      const H = root.clientHeight - (window.innerWidth > 760 ? 0 : window.innerHeight * 0.55);
      flyTo({ k, x: W / 2 - (q.x + T / 2) * k, y: (H + 60) / 2 - (q.y + T / 2) * k }, 1100).then(() => openSheet(i));
    }
  });

  document.addEventListener('keydown', (e) => {
    const a = document.activeElement;
    if (a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)) return;
    if (['palette-open', 'drawer-open', 'about-open'].some((c) => html.classList.contains(c))) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (current >= 0) {
      if (e.key === 'Escape') { closeSheet(); e.preventDefault(); return; }
      if (e.key === 'ArrowRight') { stepSpecimen(1); e.preventDefault(); return; }
      if (e.key === 'ArrowLeft') { stepSpecimen(-1); e.preventDefault(); return; }
    }
    const pan = 90;
    const map = { ArrowLeft: [pan, 0], ArrowRight: [-pan, 0], ArrowUp: [0, pan], ArrowDown: [0, -pan] };
    if (map[e.key]) { cam.x += map[e.key][0]; cam.y += map[e.key][1]; apply(); e.preventDefault(); return; }
    const r = root.getBoundingClientRect();
    if (e.key === '+' || e.key === '=') zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.3);
    else if (e.key === '-') zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1 / 1.3);
    else if (e.key === '0') fit(500);
    else if (e.key === '1' || e.key === '2' || e.key === '3') {
      const next = ['tree', 'time', 'place'][+e.key - 1];
      if (next !== mode && data) { closeSheet(); arrange(next, true); fit(900); }
    } else if (e.key.toLowerCase() === 'r') {
      const btn = document.querySelector('[data-field-random]');
      if (btn) btn.click();
    }
  });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (data) { arrange(mode, false); fit(0); } }, 180);
  });

  // ── About the collection ───────────────────────────────────────────────────
  const about = document.getElementById('about');
  let aboutReturn = null;
  function openAbout() {
    if (!about || !about.hidden) return;
    // The taxa count borrows the field's own label rather than a second copy of it.
    const taxaLabel = document.getElementById('stat-taxa-label');
    about.querySelector('.about-taxa-label').textContent = taxaLabel ? taxaLabel.textContent : '';
    closeSheet();
    aboutReturn = document.activeElement;
    about.hidden = false;
    requestAnimationFrame(() => about.classList.add('is-open'));
    html.classList.add('about-open');
    about.querySelector('.about-close').focus({ preventScroll: true });
  }
  function closeAbout() {
    if (!about || about.hidden) return;
    about.classList.remove('is-open');
    html.classList.remove('about-open');
    setTimeout(() => { about.hidden = true; }, still ? 0 : 420);
    if (aboutReturn && aboutReturn.focus) aboutReturn.focus({ preventScroll: true });
  }
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-open-about]')) openAbout();
    else if (e.target.closest('[data-close-about]')) closeAbout();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAbout(); });

  // ── Start ──────────────────────────────────────────────────────────────────

  const wanted = location.hash.replace('#', '');
  if (LAYOUTS[wanted]) mode = wanted;
  window.addEventListener('hashchange', () => {
    const next = location.hash.replace('#', '') || 'tree';
    if (data && LAYOUTS[next] && next !== mode) { closeSheet(); arrange(next, true); fit(900); }
  });

  // Labels are measured in the reader's language, so the dictionary is waited for
  // (briefly: a slow one is not worth holding the collection back for).
  const dictReady = new Promise((done) => {
    const t0 = Date.now();
    const poll = () => {
      if ((typeof globalDictLoaded !== 'undefined' && globalDictLoaded) || Date.now() - t0 > 1500) done();
      else setTimeout(poll, 50);
    };
    poll();
  });

  Promise.all([
    window.fetchJSONCached(window.assetHref('/jsondata/field.json')),
    window.fetchJSONCached(window.assetHref('/jsondata/basemap.json')).catch(() => null),
    dictReady,
  ]).then(([d, map]) => {
    data = d;
    basemap = map;
    // The tiles enter from a tight knot at the centre the first time: the
    // collection assembling itself, once.
    arrange(mode, false);
    Object.assign(cam, fitView(box));
    apply();
    if (!still) {
      const cx = (box.x0 + box.x1) / 2 - T / 2, cy = (box.y0 + box.y1) / 2 - T / 2;
      const reach = Math.hypot(box.x1 - box.x0, box.y1 - box.y0) || 1;
      tiles.forEach((tile) => {
        tile.style.transition = 'none';
        tile.style.transform = `translate(${cx}px, ${cy}px) scale(0.2)`;
      });
      world.getBoundingClientRect();   // commit the knot before letting it go
      tiles.forEach((tile, i) => {
        const q = pos[i];
        if (!q) return;
        tile.style.transition = '';
        tile.style.transitionDelay = Math.round((Math.hypot(q.x - cx, q.y - cy) / reach) * 700 + Math.random() * 160) + 'ms';
        tile.style.transform = `translate(${q.x}px, ${q.y}px)`;
      });
    }
    requestAnimationFrame(() => root.classList.add('is-ready'));
  }).catch((err) => console.error('field:', err));
})();
