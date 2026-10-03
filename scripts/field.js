// The field: every specimen in the collection on one canvas, arranged by tree, by time
// or by place. The tiles are prerendered links (see index.html.template); this script
// positions them, moves the camera and opens a specimen in the side sheet.
(function () {
  'use strict';

  const root = document.getElementById('field');
  const fieldEl = root;   // for code where `root` names a tree's root
  if (!root) return;
  const world = root.querySelector('.field-world');
  const back = root.querySelector('.field-back');
  const labels = root.querySelector('.field-labels');
  // The tree's node names ride above the tiles, in a layer of their own.
  const ringLayer = document.createElement('div');
  ringLayer.className = 'field-node-labels';
  // In screen space, not inside the zoomed world: text scaled with the camera is
  // drawn small and magnified, and comes out blurred.
  root.insertBefore(ringLayer, root.querySelector('.field-ui'));
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

  // The tree of life as a decision tree: Life at the top, one level down for each
  // rank that forks, and the specimens hanging in stacks from the tips along one
  // baseline. A specimen holding several fossils hangs under each of their taxa (the
  // extra copies are "echo" tiles). Names surface as their branches spread on screen
  // (see updateNodeLabels), so zooming in is following a branch down.
  function layoutTree() {
    const life = { key: '', kids: new Map(), items: [] };
    data.items.forEach((item, i) => {
      const taxa = item.t.length ? item.t : [null];
      taxa.forEach((key, j) => {
        const path = key && data.taxa[key] ? data.taxa[key].path : ['unclassified'];
        let node = life;
        path.forEach((k) => {
          if (!node.kids.has(k)) node.kids.set(k, { key: k, kids: new Map(), items: [] });
          node = node.kids.get(k);
        });
        node.items.push({ i, e: j ? echoOf(i, j) : -1 });
      });
    });

    // Flatten into nodes, depth first. The specimens a taxon holds beside its
    // subgroups hang from a short unnamed twig, so the taxon is still one node.
    const nodes = [];
    const order = (a, b) => (a.key === 'unclassified') - (b.key === 'unclassified') || a.key.localeCompare(b.key);
    const visit = (src, parent, depth) => {
      // A run of taxa with one subgroup each and nothing of their own is one node,
      // named for its last member.
      while (src.key && !src.items.length && src.kids.size === 1) src = src.kids.values().next().value;
      const n = { id: nodes.length, parent, key: src.key, depth, children: [], items: [], count: 0, twig: !!src.twig };
      nodes.push(n);
      if (parent) parent.children.push(n);
      const kids = Array.from(src.kids.values()).sort(order);
      if (src.items.length && kids.length) kids.push({ key: src.key, kids: new Map(), items: src.items, twig: true });
      if (kids.length) kids.forEach((k) => visit(k, n, depth + 1));
      else n.items = src.items;
      return n;
    };
    const root = visit(life, null, 0);
    const leaves = nodes.filter((n) => !n.children.length);
    leaves.forEach((l) => { for (let a = l; a; a = a.parent) a.count += l.items.length; });

    // Tips left to right, each as wide as its stack; a wider gap between kingdoms.
    const GAP = 40, KGAP = 200, MINW = 64, STACK = 70;
    const maxDepth = Math.max(...leaves.map((l) => l.depth));
    const kingdom = (n) => { while (n.parent && n.parent.parent) n = n.parent; return n; };
    let x = 0, lastK = null;
    leaves.forEach((l) => {
      const k = kingdom(l);
      if (lastK && k !== lastK) x += KGAP - GAP;
      lastK = k;
      const n = l.items.length;
      l.cols = Math.max(1, Math.ceil(Math.sqrt(n / 2.5)));
      const w = l.cols * STEP - G;
      l.bw = Math.max(w, MINW);
      l.x = x + l.bw / 2;
      l.x0s = l.x - w / 2;
      x += l.bw + GAP;
    });
    // The levels are spaced so the whole tree has the shape of the screen: the first
    // view shows all of it, and its branches open up as the camera goes in.
    const stackH = Math.max(...leaves.map((l) => Math.ceil(l.items.length / l.cols))) * STEP + STACK;
    const aspect = Math.max(0.35, (fieldEl.clientHeight - 360) / Math.max(1, fieldEl.clientWidth - 80));
    // A portrait screen cannot show a tree this wide whole: there it is fitted to the
    // height, centred on Life, and swiped through sideways.
    const portrait = fieldEl.clientWidth < fieldEl.clientHeight;
    // Levels by the square root of depth: the first forks, which the overview is
    // about, get the height; deep ones sit close to the specimens, so a branch flown
    // into is mostly specimens rather than long empty stems.
    const treeH = portrait ? 2600 : Math.min(4200, Math.max(1400, x * aspect - stackH));
    const depthY = (d) => treeH * Math.sqrt(d / maxDepth);
    const base = treeH;
    leaves.forEach((l) => { l.y = base; });
    const placeFork = (n) => {
      if (!n.children.length) return;
      n.children.forEach(placeFork);
      n.x = (n.children[0].x + n.children[n.children.length - 1].x) / 2;
      n.y = depthY(n.depth);
    };
    placeFork(root);

    const p = [], pe = [], ord = [], links = [];
    leaves.forEach((l) => {
      l.items.forEach((ref, j) => {
        const q = { x: l.x0s + (j % l.cols) * STEP, y: l.y + STACK + Math.floor(j / l.cols) * STEP };
        if (ref.e < 0) { p[ref.i] = q; ord.push(ref.i); } else pe[ref.e] = q;
      });
      l.bottom = l.y + STACK + Math.ceil(l.items.length / l.cols) * STEP;
      links.push(`M${l.x} ${l.y}V${l.y + STACK - 14}`);
    });
    // Org-chart elbows: down from a fork, along a bar, down to each child.
    nodes.forEach((n) => {
      if (!n.children.length) return;
      // The bar sits halfway down to the nearest child.
      const my = n.y + (Math.min(...n.children.map((c) => c.y)) - n.y) * 0.5;
      const c0 = n.children[0], c1 = n.children[n.children.length - 1];
      links.push(`M${n.x} ${n.y}V${my}M${c0.x} ${my}H${c1.x}`);
      n.children.forEach((c) => links.push(`M${c.x} ${my}V${c.y}`));
    });

    const reach = (n) => {
      if (!n.children.length) {
        n.box = { x0: n.x - n.bw / 2, y0: n.y - 40, x1: n.x + n.bw / 2, y1: n.bottom };
        return n.box;
      }
      const boxes = n.children.map(reach);
      n.box = boxes.reduce((b, c) => ({ x0: Math.min(b.x0, c.x0), y0: b.y0, x1: Math.max(b.x1, c.x1), y1: Math.max(b.y1, c.y1) }),
        { x0: n.x, y0: n.y - 60, x1: n.x, y1: n.y });
      return n.box;
    };
    reach(root);

    const bk = [{ type: 'tree', links, box: root.box }];
    nodes.forEach((n) => {
      const key = n.key;
      bk.push({
        type: 'node', id: n.id, parent: n.parent ? n.parent.id : -1, depth: n.depth,
        // A tip's name is anchored just above its stack, where its stem ends.
        x: n.x, y: n.children.length || !n.depth ? n.y : n.y + STACK - 18,
        box: n.box, count: n.count, leaf: !n.children.length, hidden: n.twig,
        width: n.box.x1 - n.box.x0,
        name: n.depth === 0 ? t('tree-of-life', 'Tree of Life')
          : key === 'unclassified' ? t('unclassified', 'Unclassified') : taxonName(key),
        icon: data.taxa[key] && data.taxa[key].i,
        href: key === 'unclassified' ? 'unclassified' : (data.taxa[key] && data.taxa[key].h),
      });
    });
    return { p, pe, lab: [], ord, back: bk, fitHeight: portrait, focusX: root.x };
  }

  // ── Echo tiles: the second, third… place a multi-fossil specimen hangs in ──
  const echoes = [];
  const echoIndex = new Map();
  function echoOf(i, j) {
    const key = i + ':' + j;
    if (echoIndex.has(key)) return echoIndex.get(key);
    const el = tiles[i].cloneNode(false);
    el.classList.add('is-echo');
    el.dataset.item = i;
    el.removeAttribute('id');
    tiles[i].parentNode.appendChild(el);
    echoes.push({ el, i });
    echoIndex.set(key, echoes.length - 1);
    return echoes.length - 1;
  }
  // The specimen a tile stands for, whether it is the tile itself or an echo of it.
  const itemOf = (tile) => (tile.dataset.item !== undefined ? +tile.dataset.item : tiles.indexOf(tile));

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

  const MODES = ['tree', 'time'];

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

  let nodeLabels = [];
  let nodes = [];
  let bandNames = [];
  function drawBack(list) {
    back.textContent = '';
    ringLayer.textContent = '';
    nodeLabels = [];
    bandNames = [];
    focusId = -1;   // a new arrangement redraws its breadcrumb
    nodes = list.filter((b) => b.type === 'node');
    const svgNS = 'http://www.w3.org/2000/svg';
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
      if (b.type === 'tree') {
        const { x0, y0, x1, y1 } = b.box;
        const s = sized('fb-tree', x0 - 40, y0 - 40, x1 + 40, y1 + 40);
        const path = document.createElementNS(svgNS, 'path');
        path.setAttribute('class', 'fb-branches');
        path.setAttribute('d', b.links.join(''));
        s.appendChild(path);
        back.appendChild(s);
      } else if (b.type === 'node') {
        if (b.hidden) return;
        // The node's mark and name: its silhouette, the name and how many specimens
        // hang below it, held at one size on screen whatever the zoom.
        const e = el('div', 'fb-node' + (b.leaf ? ' is-leaf' : '') + (b.leaf && b.depth > 1 ? ' is-tip' : '') + (b.depth === 0 ? ' is-root' : ''), ringLayer);
        e.dataset.node = b.id;
        const inner = el('span', 'fb-node-inner', e);
        if (b.icon) {
          const img = el('img', 'fb-node-icon', inner);
          img.src = b.icon; img.alt = ''; img.loading = 'lazy';
        } else {
          el('span', 'fb-node-dot', inner);
        }
        const text = el('span', 'fb-node-text', inner);
        el('span', 'fb-node-name', text).textContent = b.name;
        el('span', 'fb-node-count', text).textContent = b.count;
        if (b.href) {
          const a = el('a', 'fb-node-link', inner);
          a.href = window.documentHref(b.href);
          a.setAttribute('aria-label', b.name);
          a.textContent = '↗';
        }
        nodeLabels.push({ el: e, b, shown: null });
      } else if (b.type === 'band') {
        const e = el('div', 'fb-band' + (b.v ? ' is-v' : ''), back);
        e.style.cssText = `transform:translate(${b.x}px,${b.y}px);width:${b.w}px;height:${b.h}px;--band:${b.c};--band-ink:${b.ink}`;
        const name = el('span', 'fb-band-name', e);
        name.textContent = b.name;
        if (!b.v) bandNames.push({ el: e, name, w: b.w, nat: 0, tall: false });
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
    // The time chart's bands belong in the frame too, with their names under them.
    out.back.forEach((bk) => {
      if (bk.type === 'band') {
        b.x0 = Math.min(b.x0, bk.x); b.x1 = Math.max(b.x1, bk.x + bk.w);
        b.y0 = Math.min(b.y0, bk.y);
        // An upright name hangs further below its band.
        const tall = bk.name.length * 16 + 40;
        b.y1 = Math.max(b.y1, bk.y + bk.h + (bk.v ? 0 : bk.w < tall ? tall : 80));
      }
    });
    (out.pe || []).forEach((q) => {
      if (!q) return;
      b.x0 = Math.min(b.x0, q.x); b.x1 = Math.max(b.x1, q.x + T); b.y1 = Math.max(b.y1, q.y + T);
    });
    out.back.forEach((bk) => { if (bk.type === 'node' && bk.depth === 0) b.y0 = Math.min(b.y0, bk.y - 50); });
    b.fitWidth = !!out.fitWidth;
    b.fitHeight = !!out.fitHeight;
    b.focusX = out.focusX;
    return b;
  }

  function arrange(next, animate) {
    // The mode comes from the page (a button, the URL hash); only the known ones run.
    mode = next === 'time' ? 'time' : 'tree';
    const layout = mode === 'time' ? layoutTime : layoutTree;
    root.dataset.mode = mode;
    document.querySelectorAll('[data-field-mode]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.fieldMode === mode));
    });
    // Laid out twice: once to learn how far out the camera will be, then again with
    // room for the labels at the size they will be drawn there.
    let out = layout(1);
    const first = boundsOf(out);
    out = layout(labelScale(fitView(first).k));
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
    // Echoes appear only where their arrangement places them (the tree); elsewhere
    // they fold back into the tile they copy.
    echoes.forEach((e, n) => {
      const q = (out.pe || [])[n];
      e.el.classList.toggle('is-folded', !q);
      const at = q || pos[e.i];
      if (at) e.el.style.transform = `translate(${at.x}px, ${at.y}px)`;
    });
    echoPos = out.pe || [];
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
    const n = T * cam.k > 44, m = T * cam.k > 24;
    if (n !== near) { near = n; root.classList.toggle('is-near', n); }
    if (m !== mid) { mid = m; root.classList.toggle('is-mid', m); }
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      world.style.setProperty('--k', cam.k);
      back.style.setProperty('--ks', cam.k);
    }, 120);
    scheduleHires();
    // Labels move with the camera in the same frame, so they never trail behind it.
    if (nodeLabels.length) updateNodeLabels();
    if (bandNames.length) fitBandNames();
  }

  // An era name too long for its band at the size it is drawn stands upright
  // under it instead of being cut short.
  function fitBandNames() {
    const s = Math.max(1, 0.5 / cam.k);
    bandNames.forEach((b) => {
      if (!b.nat) b.nat = b.name.scrollWidth + 4;
      const tall = b.nat * s > b.w - 16;
      if (tall !== b.tall) { b.tall = tall; b.el.classList.toggle('is-tall', tall); }
    });
  }

  // A node is named once its branch spreads wide enough on screen to give the name
  // room, so zooming in brings out the finer branches. Names are placed greedily,
  // shallowest first; one that would land on another waits for more room.
  // The node in focus is the furthest one out whose sector holds the centre of the
  // view and still spans a good part of it; the path to it is the breadcrumb.
  let labelFrame = 0;
  let focusId = -1;
  let clearTopCache = null;
  window.addEventListener('resize', () => { clearTopCache = null; });
  const crumbs = document.getElementById('field-path');
  // The part of the view a branch is framed in, clear of the controls above and below.
  const frameSpan = () => Math.min(root.clientWidth, root.clientHeight - 200);
  function updateNodeLabels() {
    labelFrame = 0;
    const W = root.clientWidth, H = root.clientHeight;
    // Measured once per resize, not per frame: reading layout here forces one.
    if (clearTopCache === null) {
      const crumbBox = crumbs && crumbs.getBoundingClientRect();
      clearTopCache = crumbBox && crumbBox.height ? crumbBox.bottom - root.getBoundingClientRect().top + 6 : 130;
    }
    const clearTop = clearTopCache;
    const clearBottom = W < 760 ? 210 : 24;
    const taken = [];
    nodeLabels
      .slice()
      .sort((a, b) => a.b.depth - b.b.depth || b.b.count - a.b.count)
      .forEach((c) => {
        const b = c.b;
        const sx = b.x * cam.k + cam.x, sy = b.y * cam.k + cam.y;
        const w = b.name.length * 8.5 + (b.href ? 92 : 64);
        // Life and the kingdoms are always named when there is space; a deeper fork
        // once its branch is wider on screen than its name, a tip once its stack is.
        // A tip's name runs up its stem, so it needs the stem's breadth, not its length.
        const tip = b.leaf && b.depth > 1;
        const room = b.depth <= 1 || (tip ? b.width * cam.k > 26 : b.width * cam.k > w + 24);
        const box = tip
          ? { x0: sx - 15, y0: sy - 12 - w, x1: sx + 15, y1: sy - 8 }
          : { x0: sx - w / 2, y0: sy - 16, x1: sx + w / 2, y1: sy + 16 };
        // A name is shown whole or not at all: never cut by the screen's edge or
        // hidden under the controls above and below.
        const onScreen = box.x0 > 8 && box.x1 < W - 8 && box.y0 > clearTop && box.y1 < H - clearBottom;
        c.want = room && onScreen && !taken.some((o) => box.x0 < o.x1 && box.x1 > o.x0 && box.y0 < o.y1 && box.y1 > o.y0);
        if (c.want) taken.push(box);
      });
    nodeLabels.forEach((c) => {
      if (c.want) c.el.style.transform = `translate(${(c.b.x * cam.k + cam.x).toFixed(1)}px, ${(c.b.y * cam.k + cam.y).toFixed(1)}px)`;
      if (c.want !== c.shown) { c.shown = c.want; c.el.classList.toggle('is-shown', c.want); }
    });

    const wx = (W / 2 - cam.x) / cam.k, wy = (H / 2 - cam.y) / cam.k;
    // A node flown to stays in focus until the reader moves on their own; otherwise
    // the focus follows the centre of the view.
    let focus = pinnedFocus || nodes[0];
    if (!pinnedFocus) nodes.forEach((n) => {
      if (n.hidden || n.depth <= focus.depth) return;
      // The deepest branch under the centre of the view that still spans a good part of it.
      const under = wx >= n.box.x0 && wx <= n.box.x1 && wy >= n.y - 60;
      if (under && n.width * cam.k >= W * 0.6) focus = n;
    });
    if (focus.id !== focusId) { focusId = focus.id; drawCrumbs(focus); clearTopCache = null; }
  }

  if (crumbs) crumbs.addEventListener('click', (e) => {
    const step = e.target.closest('[data-node]');
    if (step && nodes[+step.dataset.node]) flyToNode(nodes[+step.dataset.node]);
  });

  function drawCrumbs(focus) {
    if (!crumbs) return;
    const chain = [];
    for (let n = focus; n; n = n.parent >= 0 ? nodes[n.parent] : null) chain.unshift(n);
    crumbs.textContent = '';
    chain.forEach((n, i) => {
      if (i) el('span', 'field-path-sep', crumbs).textContent = '/';
      const b = el('button', 'field-path-step', crumbs);
      b.type = 'button';
      b.textContent = n.name;
      b.dataset.node = n.id;
      if (i === chain.length - 1) b.setAttribute('aria-current', 'true');
    });
    if (focus.href && focus.depth) {
      const a = el('a', 'field-path-open', crumbs);
      a.href = window.documentHref(focus.href);
      a.textContent = '↗';
      a.setAttribute('aria-label', focus.name);
    }
  }

  // Frame a node's whole branch, from its fork to the specimens at its tips.
  let pinnedFocus = null;
  function flyToNode(n) {
    const target = fitView({ ...n.box, fitWidth: false });
    target.k = Math.min(target.k, 3);
    pinnedFocus = n.depth ? n : null;
    flyTo(target, 750).then(() => { if (!labelFrame) labelFrame = requestAnimationFrame(updateNodeLabels); });
  }
  const unpin = () => { pinnedFocus = null; };
  root.addEventListener('wheel', unpin, { passive: true });
  root.addEventListener('pointerdown', (e) => { if (!e.target.closest('.fb-node, .field-ui')) unpin(); });

  function fitView(b) {
    const narrow = root.clientWidth < 760;
    const pad = Math.min(96, root.clientWidth * 0.06);
    // The tree has its breadcrumb under the mode switch to keep clear of.
    const top = (narrow ? 130 : 128) + (mode !== 'time' ? 44 : 0), bottom = narrow ? 210 : 172;
    const W = root.clientWidth - pad * 2, H = root.clientHeight - top - bottom;
    if (b.fitHeight) {
      const k = Math.min(H / (b.y1 - b.y0), 2.4);
      return { k, x: pad + W / 2 - b.focusX * k, y: top - b.y0 * k };
    }
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
  let echoPos = [];
  function loadHires() {
    if (!data || T * cam.k < HIRES) return;
    const W = root.clientWidth, H = root.clientHeight;
    const all = tiles.map((tile, i) => [tile, i, pos[i]]).concat(echoes.map((e, n) => [e.el, e.i, echoPos[n]]));
    all.forEach(([tile, i, at]) => {
      if (tile.dataset.hires || !at) return;
      const sx = at.x * cam.k + cam.x, sy = at.y * cam.k + cam.y;
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
      if (hit && !hit.closest('a.fb-node-link') && tapAt(hit)) tappedAt = performance.now();
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

  // In the tree, a click on a node's name flies to its branch.
  root.addEventListener('click', (e) => {
    if (suppressClick || performance.now() - tappedAt < 600) return;
    if (e.target.closest('.tile')) return;
    tapAt(e.target);
  });

  // What a tap or click on the field does: a tile opens its specimen; in the tree, a
  // node's name flies to its branch. Touch taps are handled on release (see
  // release()), because a phone swallows the click of a tap that follows a fling.
  let tappedAt = 0;
  function tapAt(target) {
    const tile = target.closest('.tile');
    if (tile) { openSheet(itemOf(tile)); return true; }
    if (mode === 'time' || target.closest('.field-ui, .sheet, a')) return false;
    const label = target.closest('.fb-node');
    if (label && nodes[+label.dataset.node]) { flyToNode(nodes[+label.dataset.node]); return true; }
    return false;
  }

  root.addEventListener('dblclick', (e) => {
    if (e.target.closest('.field-ui, .sheet, .fb-node')) return;
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
    openSheet(itemOf(tile));
  });
  labels.addEventListener('click', (e) => { if (suppressClick) e.preventDefault(); });

  // ── The tooltip ──
  let tipFor = -1;
  function hover(e) {
    const tile = e.target.closest && e.target.closest('.tile');
    if (!tile || !data || root.classList.contains('is-dragging')) { hideTip(); return; }
    const i = itemOf(tile);
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
  // The intervals an age overlaps, oldest first. A specimen dated only to a wide
  // bracket overlaps several, and naming the one its midpoint falls in would assert
  // an age nobody knows (glacial till dated 359–66 Ma is not "Triassic").
  function bandsOf(a) {
    // Half a million years of grace: a bracket rounded to 359 Ma has not entered the
    // Devonian, which ends at 358.9.
    return data.bands.filter((b) => a[1] < b.from - 0.5 && a[0] > b.to + 0.5);
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
      // A point age sits in one interval even on a boundary; a range names its span.
      const spanned = bandsOf(item.a);
      const bands = spanned.length ? spanned : data.bands.filter((b) => item.a[0] <= b.from && item.a[0] >= b.to).slice(0, 1);
      const first = bands[0], last = bands[bands.length - 1];
      $('.sheet-age').textContent = ageText(item.a);
      $('.sheet-band').textContent = !first ? ''
        : first === last ? t(first.key, first.key) : `${t(first.key, first.key)}–${t(last.key, last.key)}`;
      when.style.setProperty('--band', first && first === last ? first.c : 'var(--ink-3)');
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
      pinnedFocus = null;
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
    else if (e.key === '1' || e.key === '2') {
      const next = ['tree', 'time'][+e.key - 1];
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
  if (MODES.includes(wanted)) mode = wanted;
  window.addEventListener('hashchange', () => {
    const next = location.hash.replace('#', '') || 'tree';
    if (data && MODES.includes(next) && next !== mode) { closeSheet(); arrange(next, true); fit(900); }
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

  Promise.all([window.fetchJSONCached(window.assetHref('/jsondata/field.json')), dictReady]).then(([d]) => {
    data = d;
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
