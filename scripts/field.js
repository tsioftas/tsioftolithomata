// The collection page: every specimen on one canvas, arranged by taxonomy or by time.
// The tiles are prerendered links (see collection.html.template); this script
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
  // The atlas comes relative to the page and is made absolute here: a url() in a
  // custom property resolves against the stylesheet that uses it (scripts/field.css).
  if (root.dataset.atlas) root.style.setProperty('--atlas', `url("${new URL(root.dataset.atlas, document.baseURI).href}")`);
  const tip = document.getElementById('field-tip');
  const sheet = document.getElementById('field-sheet');
  const html = document.documentElement;
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const T = 64;          // a tile, in world units
  const G = 6;           // the gap between tiles
  const STEP = T + G;
  const HIRES = 92;      // on-screen size past which a tile swaps in its photograph

  let data = null;
  let slideshow = null;
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

  // The tree can be drawn several ways; each is its own layout over the same taxonomy.
  const STYLES = ['branches', 'radial', 'bubbles', 'boxes', 'outline'];
  // Their names in the address, so a link opens the same drawing.
  const STYLE_HASH = ['tree', 'wheel', 'bubbles', 'boxes', 'list'];
  let treeStyle = 'branches';

  // The taxonomy as nodes, depth first. A specimen holding several fossils hangs under
  // each of their taxa (the extra copies are "echo" tiles). The specimens a taxon holds
  // beside its subgroups hang from an unnamed twig, so the taxon is still one node; a
  // run of taxa with one subgroup each and nothing of their own is one node.
  function taxonTree() {
    const life = { key: '', kids: new Map(), items: [] };
    data.items.forEach((item, i) => {
      if (!isShown(i)) return;
      const taxa = item.t.length ? item.t : [null];
      // With clades chosen, a specimen hangs only under its taxa within them: a slab
      // with a fish and a leaf, filtered to Chordata, does not bring Plantae along.
      const kept = taxa.map((key, j) => [key, j]).filter(([key]) => !filters.taxa.size
        || (key ? lineage(key).some((a) => filters.taxa.has(a)) : filters.taxa.has('unclassified')));
      kept.forEach(([key, j], n) => {
        const path = key && data.taxa[key] ? data.taxa[key].path : ['unclassified'];
        let node = life;
        path.forEach((k) => {
          if (!node.kids.has(k)) node.kids.set(k, { key: k, kids: new Map(), items: [] });
          node = node.kids.get(k);
        });
        // The first place it hangs is the tile itself, any further ones its echoes.
        node.items.push({ i, e: n ? echoOf(i, j) : -1 });
      });
    });
    const nodes = [];
    const order = (a, b) => (a.key === 'unclassified') - (b.key === 'unclassified') || a.key.localeCompare(b.key);
    const visit = (src, parent, depth) => {
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
    return { nodes, root, leaves };
  }

  // What every node carries whatever the drawing: its name, mark and link.
  function nodeBack(n) {
    const key = n.key;
    return {
      type: 'node', id: n.id, parent: n.parent ? n.parent.id : -1, depth: n.depth,
      count: n.count, leaf: !n.children.length, hidden: n.twig, box: n.box,
      name: n.depth === 0 ? t('tree-of-life', 'Tree of Life')
        : key === 'unclassified' ? t('unclassified', 'Unclassified') : taxonName(key),
      icon: data.taxa[key] && data.taxa[key].i,
      plate: data.taxa[key] && data.taxa[key].pl,
      // Life and the unclassified have no silhouette: a tree and a question mark.
      glyph: n.depth === 0 ? 'root' : key === 'unclassified' ? '?' : '',
      href: key === 'unclassified' ? 'unclassified' : (data.taxa[key] && data.taxa[key].h),
    };
  }

  // A node's reach: the union of its own box and its children's.
  function reachUp(n, own) {
    if (!n.children.length) { n.box = own(n); return n.box; }
    const boxes = n.children.map((c) => reachUp(c, own));
    n.box = boxes.reduce((b, c) => ({ x0: Math.min(b.x0, c.x0), y0: Math.min(b.y0, c.y0), x1: Math.max(b.x1, c.x1), y1: Math.max(b.y1, c.y1) }), own(n));
    return n.box;
  }

  // Tiles of a group in a grid of `cols`, from (x, y).
  function placeGrid(items, cols, x, y, p, pe, ord) {
    items.forEach((ref, j) => {
      const q = { x: x + (j % cols) * STEP, y: y + Math.floor(j / cols) * STEP };
      if (ref.e < 0) { p[ref.i] = q; ord.push(ref.i); } else pe[ref.e] = q;
    });
  }

  // Grid cells nearest a centre first, so a group of n tiles forms a round blob.
  const DISC = (() => {
    const cells = [];
    for (let y = -14; y <= 14; y++) for (let x = -14; x <= 14; x++) cells.push([x * STEP, y * STEP]);
    return cells.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]) || a[1] - b[1] || a[0] - b[0]);
  })();
  function blob(n) {
    const cells = DISC.slice(0, n);
    return { cells, r: Math.max(...cells.map((c) => Math.hypot(c[0], c[1]))) + T * 0.75 };
  }
  function placeBlob(items, cells, cx, cy, p, pe, ord) {
    items.forEach((ref, j) => {
      const q = { x: cx + cells[j][0] - T / 2, y: cy + cells[j][1] - T / 2 };
      if (ref.e < 0) { p[ref.i] = q; ord.push(ref.i); } else pe[ref.e] = q;
    });
  }

  // Branches: a decision tree, Life at the top, one level down for each rank that
  // forks, and the specimens hanging in stacks from the tips along one baseline.
  // Names surface as their branches spread on screen (see updateNodeLabels).
  function layoutBranches() {
    const { nodes, root, leaves } = taxonTree();

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
    leaves.forEach((l) => { l.y = treeH; });
    const placeFork = (n) => {
      if (!n.children.length) return;
      n.children.forEach(placeFork);
      n.x = (n.children[0].x + n.children[n.children.length - 1].x) / 2;
      n.y = depthY(n.depth);
    };
    placeFork(root);

    const p = [], pe = [], ord = [], links = [];
    leaves.forEach((l) => {
      placeGrid(l.items, l.cols, l.x0s, l.y + STACK, p, pe, ord);
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
    reachUp(root, (n) => (n.children.length
      ? { x0: n.x, y0: n.y - 60, x1: n.x, y1: n.y }
      : { x0: n.x - n.bw / 2, y0: n.y - 40, x1: n.x + n.bw / 2, y1: n.bottom }));

    const bk = [{ type: 'tree', links, box: root.box }];
    nodes.forEach((n) => {
      const w = n.box.x1 - n.box.x0;
      // A tip's name is anchored just above its stack, where its stem ends, and reads
      // up the stem, so it needs the stem's breadth, not its length.
      const tip = !n.children.length && n.depth > 1;
      bk.push({ ...nodeBack(n), x: n.x, y: n.children.length || !n.depth ? n.y : n.y + STACK - 18,
                room: w, span: w, upright: tip });
    });
    return { p, pe, lab: [], ord, back: bk, fitHeight: portrait, focusX: root.x, focusAxis: 'w' };
  }

  // Radial: Life at the centre, a ring further out for each rank, and the specimens
  // clustered at the tips of the branches.
  function layoutRadial() {
    const { nodes, root, leaves } = taxonTree();
    const GAP = 34;
    leaves.forEach((l) => Object.assign(l, blob(l.items.length)));
    const arc = leaves.reduce((s, l) => s + 2 * l.r + GAP, 0);
    const maxDepth = Math.max(...leaves.map((l) => l.depth));
    const R = Math.max(arc / (2 * Math.PI), maxDepth * 260);
    let run = 0;
    leaves.forEach((l) => { l.a = -Math.PI / 2 + ((run + l.r + GAP / 2) / R); run += 2 * l.r + GAP; });
    const placeFork = (n) => {
      if (!n.children.length) return;
      n.children.forEach(placeFork);
      n.a = (n.children[0].a + n.children[n.children.length - 1].a) / 2;
    };
    placeFork(root);
    // Rings by the square root of depth, so the kingdoms are not crowded at the centre.
    const ring = (n) => (n.children.length ? R * Math.sqrt(n.depth / (maxDepth + 0.6)) : R);
    nodes.forEach((n) => { n.rad = ring(n); n.x = n.rad * Math.cos(n.a); n.y = n.rad * Math.sin(n.a); });

    const p = [], pe = [], ord = [], links = [];
    leaves.forEach((l) => {
      const out = R + l.r + 26;
      l.cx = out * Math.cos(l.a); l.cy = out * Math.sin(l.a);
      placeBlob(l.items, l.cells, l.cx, l.cy, p, pe, ord);
      links.push(`M${l.x.toFixed(1)} ${l.y.toFixed(1)}L${((R + 18) * Math.cos(l.a)).toFixed(1)} ${((R + 18) * Math.sin(l.a)).toFixed(1)}`);
    });
    // Each branch: round its parent's ring to the child's angle, then out to the child.
    nodes.forEach((n) => {
      if (!n.parent) return;
      const pa = n.parent, r0 = pa.rad;
      const sx = r0 * Math.cos(n.a), sy = r0 * Math.sin(n.a);
      const turn = r0 > 0 ? `A${r0.toFixed(1)} ${r0.toFixed(1)} 0 0 ${n.a > pa.a ? 1 : 0} ${sx.toFixed(1)} ${sy.toFixed(1)}` : '';
      links.push(`M${pa.x.toFixed(1)} ${pa.y.toFixed(1)}${turn}L${n.x.toFixed(1)} ${n.y.toFixed(1)}`);
    });
    reachUp(root, (n) => (n.children.length
      ? { x0: n.x, y0: n.y, x1: n.x, y1: n.y }
      : { x0: Math.min(n.x, n.cx - n.r), y0: Math.min(n.y, n.cy - n.r), x1: Math.max(n.x, n.cx + n.r), y1: Math.max(n.y, n.cy + n.r) }));
    // Each node's sector, for how far its branch spreads at its own fork.
    const sector = (n) => {
      if (!n.children.length) { const h = (n.r + GAP / 2) / R; n.a0 = n.a - h; n.a1 = n.a + h; return; }
      n.children.forEach(sector);
      n.a0 = n.children[0].a0; n.a1 = n.children[n.children.length - 1].a1;
    };
    sector(root);

    const bk = [{ type: 'tree', links, box: root.box }];
    nodes.forEach((n) => {
      // Forks near the centre are measured no closer in than a third of the way out,
      // or the kingdoms would never have room for a name.
      const room = n.children.length ? (n.a1 - n.a0) * Math.max(n.rad, R * 0.35) : 2 * n.r;
      bk.push({ ...nodeBack(n), x: n.x, y: n.y, room,
                span: Math.max(n.box.x1 - n.box.x0, n.box.y1 - n.box.y0) });
    });
    return { p, pe, lab: [], ord, back: bk, focusAxis: 'min' };
  }

  // Bubbles: each taxon a circle holding its subgroups, the specimens in the
  // innermost ones. Zooming in is going down a level.
  function layoutBubbles() {
    const { nodes, root } = taxonTree();
    const h = d3.hierarchy(root, (n) => (n.children.length ? n.children : null));
    h.each((d) => {
      if (!d.children) Object.assign(d.data, blob(d.data.items.length));
    });
    d3.pack()
      .radius((d) => d.data.r + 10)
      .padding((d) => (d.depth === 0 ? 40 : d.depth === 1 ? 26 : 14))(h);
    const p = [], pe = [], ord = [], rings = [];
    h.each((d) => {
      const n = d.data;
      n.x = d.x; n.y = d.y; n.r = d.r;
      if (!d.children) placeBlob(n.items, n.cells, d.x, d.y, p, pe, ord);
      // A twig's specimens are a group inside their taxon's circle, not a circle.
      if (!n.twig) rings.push({ x: d.x, y: d.y, r: d.r, depth: d.depth, leaf: !d.children });
    });
    nodes.forEach((n) => { n.box = { x0: n.x - n.r, y0: n.y - n.r, x1: n.x + n.r, y1: n.y + n.r }; });
    const bk = [{ type: 'rings', rings, box: root.box }];
    // A circle's name sits on its rim, at the top.
    nodes.forEach((n) => bk.push({ ...nodeBack(n), x: n.x, y: n.y - n.r, room: 2 * n.r, span: 2 * n.r }));
    return { p, pe, lab: [], ord, back: bk, focusAxis: 'min' };
  }

  // Boxes: each taxon a box holding its subgroups' boxes, packed in rows, with the
  // specimens in a grid in the innermost ones.
  function layoutBoxes() {
    const { nodes, root } = taxonTree();
    const PAD = (d) => (d === 0 ? 40 : d === 1 ? 28 : 16);
    const HEAD = (d) => (d === 0 ? 56 : d === 1 ? 46 : 38);
    // Sizes bottom up: a tip as big as its grid, a fork as big as its rows of boxes.
    const size = (n) => {
      if (!n.children.length) {
        n.cols = Math.max(1, Math.ceil(Math.sqrt(n.items.length * 1.3)));
        n.w = n.cols * STEP - G + 2 * PAD(n.depth);
        n.h = Math.ceil(n.items.length / n.cols) * STEP - G + 2 * PAD(n.depth) + (n.twig ? 0 : HEAD(n.depth));
        return;
      }
      n.children.forEach(size);
      const gap = PAD(n.depth);
      const area = n.children.reduce((s, c) => s + (c.w + gap) * (c.h + gap), 0);
      const rowW = Math.max(Math.max(...n.children.map((c) => c.w)), Math.sqrt(area) * 1.25);
      // Shelves: tallest first, left to right, a new row when one is full.
      const kids = n.children.slice().sort((a, b) => b.h - a.h);
      let x = 0, y = 0, row = 0, w = 0;
      kids.forEach((c) => {
        if (x && x + c.w > rowW) { y += row + gap; x = 0; row = 0; }
        c.ox = x; c.oy = y;
        x += c.w + gap; row = Math.max(row, c.h); w = Math.max(w, x - gap);
      });
      n.w = w + 2 * PAD(n.depth);
      n.h = y + row + 2 * PAD(n.depth) + HEAD(n.depth);
    };
    size(root);
    const p = [], pe = [], ord = [], boxes = [];
    const place = (n, x, y) => {
      n.box = { x0: x, y0: y, x1: x + n.w, y1: y + n.h };
      const pad = PAD(n.depth), head = n.twig ? 0 : HEAD(n.depth);
      if (!n.twig) boxes.push({ ...n.box, depth: n.depth, leaf: !n.children.length });
      if (!n.children.length) placeGrid(n.items, n.cols, x + pad, y + pad + head, p, pe, ord);
      else n.children.forEach((c) => place(c, x + pad + c.ox, y + pad + head + c.oy));
    };
    place(root, 0, 0);
    const bk = [{ type: 'boxes', boxes, box: root.box }];
    // A box's name sits at its top left corner.
    nodes.forEach((n) => bk.push({ ...nodeBack(n), x: n.box.x0 + 8, y: n.box.y0 + HEAD(n.depth) / 2,
      room: n.w, span: Math.max(n.w, n.h), left: true }));
    return { p, pe, lab: [], ord, back: bk, focusAxis: 'min' };
  }

  // Outline: the tree as an indented list, read from the top down like a table of
  // contents, each taxon's specimens in a row under its name.
  function layoutOutline() {
    const { nodes, root } = taxonTree();
    // Wider rows on a wide screen, so it is not all one long scroll.
    const IND = 56, ROW = 64, COLS = fieldEl.clientWidth > fieldEl.clientHeight ? 14 : 8;
    const p = [], pe = [], ord = [], links = [];
    let y = 0;
    const visit = (n) => {
      n.x = n.depth * IND;
      if (n.twig) { n.y = y - ROW / 2; } else { n.y = y; y += ROW; }
      if (!n.children.length) {
        placeGrid(n.items, COLS, n.x + 20, y - 18, p, pe, ord);
        n.bottom = y - 18 + Math.ceil(n.items.length / COLS) * STEP;
        y = n.bottom + 34;
      }
      // Its own specimens straight under its name, before its subgroups.
      n.children.slice().sort((a, b) => b.twig - a.twig).forEach(visit);
    };
    visit(root);
    // A rule down from each fork's mark, with a tick to each child.
    nodes.forEach((n) => {
      if (!n.children.length) return;
      const named = n.children.filter((c) => !c.twig);
      if (!named.length) return;
      const x = n.x + 16, last = named[named.length - 1];
      links.push(`M${x} ${n.y + 18}V${last.y}`);
      named.forEach((c) => links.push(`M${x} ${c.y}H${c.x - 4}`));
    });
    reachUp(root, (n) => ({ x0: n.x, y0: n.y - 24, x1: n.children.length ? n.x : n.x + 20 + COLS * STEP, y1: n.children.length ? n.y : n.bottom }));
    const bk = [{ type: 'tree', links, box: root.box }];
    nodes.forEach((n) => bk.push({ ...nodeBack(n), x: n.x, y: n.y, room: Infinity,
      span: n.box.y1 - n.box.y0, left: true }));
    return { p, pe, lab: [], ord, back: bk, fitWidth: true, focusAxis: 'h' };
  }

  function layoutTree() {
    switch (treeStyle) {
      case 'radial': return layoutRadial();
      case 'bubbles': return layoutBubbles();
      case 'boxes': return layoutBoxes();
      case 'outline': return layoutOutline();
      default: return layoutBranches();
    }
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
      if (!isShown(i)) return;
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
    // Turned on its side (portrait, below), a band's name sits inside it at the top:
    // its opening stretch is kept clear for the name at the size it is drawn.
    const portrait = root.clientWidth < root.clientHeight * 0.9;
    const lead = portrait ? Math.round(60 * ls) + 20 : 0;
    bands.forEach((b, k) => {
      const cols = perBand[k].sort((c1, c2) => c2.mid - c1.mid);
      const need = cols.reduce((s, c) => s + c.w, 0) + GAP * Math.max(0, cols.length - 1) + PAD * 2 + lead;
      const W = Math.max(cols.length ? 200 : Math.max(110, lead + 30), need);
      const start = x + PAD + lead;
      const inner = W - PAD * 2 - lead;
      cols.forEach((c) => {
        const frac = (b.from - c.mid) / (b.from - b.to);
        c.x = start + frac * inner - c.w / 2;
      });
      for (let i = 0; i < cols.length; i++) {
        const lo = i ? cols[i - 1].x + cols[i - 1].w + GAP : start;
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
    if (portrait) {
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

  // Where an interval begins, with its unit: thousands of years under a million, so
  // the Holocene reads 11.7 ka rather than 0.
  function bandStart(ma) {
    return ma < 1 ? `${+(ma * 1000).toFixed(1)} ${t('ka-unit', 'ka')}` : `${+ma.toFixed(1)} ${t('ma-unit', 'Ma')}`;
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

  // Life's mark: the root of the tree.
  const TREE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 3.5v17"/><path d="M5 7.5h5.5M5 13h5.5M5 18.5h5.5"/><circle cx="14" cy="7.5" r="2.4"/><circle cx="14" cy="13" r="2.4"/><circle cx="14" cy="18.5" r="2.4"/><path d="M16.4 13h3.1"/></svg>';
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
      } else if (b.type === 'rings' || b.type === 'boxes') {
        const { x0, y0, x1, y1 } = b.box;
        const s = sized('fb-shapes', x0 - 4, y0 - 4, x1 + 4, y1 + 4);
        (b.rings || b.boxes).forEach((r) => {
          const c = document.createElementNS(svgNS, b.rings ? 'circle' : 'rect');
          if (b.rings) {
            c.setAttribute('cx', r.x.toFixed(1)); c.setAttribute('cy', r.y.toFixed(1)); c.setAttribute('r', r.r.toFixed(1));
          } else {
            c.setAttribute('x', r.x0); c.setAttribute('y', r.y0);
            c.setAttribute('width', r.x1 - r.x0); c.setAttribute('height', r.y1 - r.y0);
            c.setAttribute('rx', r.depth ? 10 : 18);
          }
          c.setAttribute('class', `fb-shape d${Math.min(r.depth, 5)}${r.leaf ? ' is-leaf' : ''}`);
          s.appendChild(c);
        });
        back.appendChild(s);
      } else if (b.type === 'node') {
        if (b.hidden) return;
        // The node's mark and name: its silhouette, the name and how many specimens
        // hang below it, held at one size on screen whatever the zoom.
        const e = el('div', 'fb-node' + (b.leaf ? ' is-leaf' : '') + (b.upright ? ' is-tip' : '') + (b.left ? ' is-left' : '') + (b.depth === 0 ? ' is-root' : ''), ringLayer);
        e.dataset.node = b.id;
        const inner = el('span', 'fb-node-inner', e);
        if (b.plate || b.icon) {
          const img = el('img', 'fb-node-icon' + (b.plate ? ' is-plate' : ''), inner);
          img.src = b.plate ? window.assetHref('/' + b.plate) : b.icon; img.alt = ''; img.loading = 'lazy';
        } else if (b.glyph) {
          const g = el('span', 'fb-node-icon fb-node-glyph', inner);
          if (b.glyph === 'root') g.innerHTML = TREE_ICON; else g.textContent = b.glyph;
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
        el('span', 'fb-band-age', e).textContent = bandStart(b.from);
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
    // The whole tree, with room above for Life's name.
    out.back.forEach((bk) => {
      if (bk.type !== 'node' || bk.depth !== 0) return;
      b.x0 = Math.min(b.x0, bk.box.x0); b.x1 = Math.max(b.x1, bk.box.x1);
      b.y0 = Math.min(b.y0, bk.box.y0, bk.y - 50); b.y1 = Math.max(b.y1, bk.box.y1);
    });
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
    root.dataset.style = treeStyle;
    document.querySelectorAll('[data-tree-style]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.treeStyle === treeStyle));
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
      tile.hidden = !q;
      if (!q) return;
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
    focusAxis = out.focusAxis || 'w';
    root.classList.toggle('is-moving', !!(animate && prev.length));
    labels.classList.add('is-hidden');
    drawBack(out.back);
    setTimeout(() => {
      drawLabels(out.lab);
      labels.classList.remove('is-hidden');
      root.classList.remove('is-moving');
    }, animate && !still ? 700 : 0);
    // The tree's drawing is in the address too, so a link opens the same one.
    const hash = mode === 'time' ? '#time' : treeStyle !== 'branches' ? '#' + STYLE_HASH[STYLES.indexOf(treeStyle)] : '';
    try { history.replaceState(history.state, '', location.pathname + location.search + hash); } catch (e) { /* file:// */ }
  }

  // ── Camera ─────────────────────────────────────────────────────────────────

  // Per frame only the world's transform changes. The scale the labels read (--k) is
  // set on their own small layers, never on the field, whose 410 tiles would all be
  // restyled with it; the tiles get it once the camera comes to rest.
  let near = null, mid = null, settleTimer = null;
  // On a touch screen the world is not given a GPU layer of its own: rescaling one
  // that large on every pinch frame outruns a phone's tile memory, and whole regions
  // show blank until redrawn. Painted with the page, it is always drawn at the zoom shown.
  const layered = !window.matchMedia('(pointer: coarse)').matches;
  // The collection stays in view: it can be pushed past an edge, but always keeps
  // at least a quarter of the screen, so there is no panning off into empty space.
  function clampCam() {
    if (!data) return;
    const W = root.clientWidth, H = root.clientHeight;
    cam.x = Math.min(Math.max(cam.x, W * 0.25 - box.x1 * cam.k), W * 0.75 - box.x0 * cam.k);
    cam.y = Math.min(Math.max(cam.y, H * 0.25 - box.y1 * cam.k), H * 0.75 - box.y0 * cam.k);
  }
  function apply() {
    clampCam();
    world.style.transform = layered
      ? `translate3d(${cam.x}px, ${cam.y}px, 0) scale(${cam.k})`
      : `translate(${cam.x}px, ${cam.y}px) scale(${cam.k})`;
    labels.style.setProperty('--k', cam.k);
    back.style.setProperty('--k', cam.k);
    const n = T * cam.k > 44, m = T * cam.k > 24;
    if (n !== near) { near = n; root.classList.toggle('is-near', n); }
    if (m !== mid) { mid = m; root.classList.toggle('is-mid', m); }
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      world.style.setProperty('--k', cam.k);
      back.style.setProperty('--ks', cam.k);
      remember();
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
  let focusAxis = 'w';
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
    const clearBottom = W < 760 ? 90 : 24;
    const taken = [];
    nodeLabels
      .slice()
      .sort((a, b) => a.b.depth - b.b.depth || b.b.count - a.b.count)
      .forEach((c) => {
        const b = c.b;
        const sx = b.x * cam.k + cam.x, sy = b.y * cam.k + cam.y;
        const w = b.name.length * 8.5 + (b.href ? 92 : 64);
        // Life and the kingdoms are always named when there is space; a deeper node
        // once it is wider on screen than its name. A name running up a stem needs
        // only the stem's breadth.
        const tip = b.upright;
        const room = b.depth <= 1 || (tip ? b.room * cam.k > 26 : b.room * cam.k > w + 24);
        const box = tip ? { x0: sx - 21, y0: sy - 12 - w, x1: sx + 21, y1: sy - 8 }
          : b.left ? { x0: sx - 4, y0: sy - 21, x1: sx + w, y1: sy + 21 }
          : { x0: sx - w / 2, y0: sy - 21, x1: sx + w / 2, y1: sy + 21 };
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
    // The deepest node under the centre of the view that still spans a good part of
    // it: across (branches), down (outline) or both (the rest).
    const view = focusAxis === 'w' ? W : focusAxis === 'h' ? H : Math.min(W, H - 200);
    const inX = (n) => wx >= n.box.x0 && wx <= n.box.x1, inY = (n) => wy >= n.box.y0 && wy <= n.box.y1;
    if (!pinnedFocus) nodes.forEach((n) => {
      if (n.hidden || n.depth <= focus.depth) return;
      const under = focusAxis === 'w' ? inX(n) && wy >= n.box.y0 : focusAxis === 'h' ? inY(n) : inX(n) && inY(n);
      if (under && n.span * cam.k >= view * 0.6) focus = n;
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
    const target = fitView({ ...n.box, fitWidth: focusAxis === 'h' });
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
    // Clear of the mode switch, and of the breadcrumb under it in the taxonomy.
    const top = (narrow ? 76 : 70) + (mode !== 'time' ? 44 : 0), bottom = narrow ? 96 : 90;
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
  let lastTap = null, pendingTap = null, lastTouch = 0;
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
    // A second touch soon after a tap, near it, is a double tap: held and dragged
    // it zooms with one finger (down in, up out), as on a map.
    const again = e.pointerType === 'touch' && lastTap && performance.now() - lastTap.t < 300
      && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40;
    if (pointers.size === 1 && again) {
      clearTimeout(pendingTap);
      pendingTap = null;
      drag = { zoom: true, x: e.clientX, y: e.clientY, k0: cam.k, ax: lastTap.x, ay: lastTap.y, moved: false };
      lastTap = null;
    } else if (pointers.size === 1) {
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
    if (drag.zoom) {
      const dy = e.clientY - drag.y;
      if (!drag.moved && Math.abs(dy) > 5) {
        drag.moved = true;
        try { root.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ }
        hideTip();
      }
      if (drag.moved) zoomAt(drag.ax, drag.ay, (drag.k0 * Math.exp(dy * 0.012)) / cam.k);
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
    if (e.pointerType === 'touch') lastTouch = performance.now();
    if (drag && drag.zoom) {
      // A double tap that was not dragged zooms in a step there.
      if (!drag.moved && e.type === 'pointerup') {
        const r = root.getBoundingClientRect();
        const k = Math.min(kLimits()[1], cam.k * 2.2);
        const px = drag.ax - r.left, py = drag.ay - r.top;
        flyTo({ k, x: px - (px - cam.x) * (k / cam.k), y: py - (py - cam.y) * (k / cam.k) }, 320);
      }
      tappedAt = performance.now();
      drag = null;
      return;
    }
    if (drag && !drag.moved && e.type === 'pointerup' && e.pointerType !== 'mouse') {
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      // A tap waits a moment to be sure it is not the first half of a double tap.
      if (hit && !hit.closest('a.fb-node-link')) {
        lastTap = { t: performance.now(), x: e.clientX, y: e.clientY };
        tappedAt = performance.now();   // the browser's own click is not the tap
        clearTimeout(pendingTap);
        pendingTap = setTimeout(() => { pendingTap = null; if (tapAt(hit)) tappedAt = performance.now(); }, 260);
      }
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
    if (tile) { openSheet(itemOf(tile), tile); return true; }
    if (mode === 'time' || target.closest('.field-ui, .sheet, a')) return false;
    const label = target.closest('.fb-node');
    if (label && nodes[+label.dataset.node]) { flyToNode(nodes[+label.dataset.node]); return true; }
    return false;
  }

  root.addEventListener('dblclick', (e) => {
    if (e.target.closest('.field-ui, .sheet, .fb-node')) return;
    if (performance.now() - lastTouch < 800) return;   // handled as a touch double tap
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
    openSheet(itemOf(tile), tile);
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

  // A specimen under several taxa has a copy under each (an echo); the one clicked
  // is the one marked and kept in view, not the first.
  let currentEl = null;
  function placeOf(el, i) {
    const n = el && el.classList.contains('is-echo') ? echoes.findIndex((e) => e.el === el) : -1;
    return n >= 0 && echoPos[n] ? echoPos[n] : pos[i];
  }
  function openSheet(i, from) {
    if (i < 0 || !data) return;
    if (current < 0) sheetReturn = document.activeElement;
    current = i;
    photo = 0;
    const item = data.items[i];
    if (currentEl) currentEl.classList.remove('is-current');
    currentEl = from && from.classList.contains('is-echo') && !from.classList.contains('is-folded') ? from : tiles[i];
    currentEl.classList.add('is-current');

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
    $('.sheet-link').href = window.documentHref(item.h);
    $('.sheet-id').textContent = item.id;
    showPhoto();

    sheet.hidden = false;
    requestAnimationFrame(() => sheet.classList.add('is-open'));
    html.classList.add('sheet-open');
    hideTip();
    $('.sheet-close').focus({ preventScroll: true });
    revealTile(placeOf(currentEl, i));
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
  function revealTile(q) {
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
    if (currentEl) currentEl.classList.remove('is-current');
    currentEl = null;
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
    const st = e.target.closest('[data-tree-style]');
    if (st && data && STYLES.includes(st.dataset.treeStyle)) {
      if (st.dataset.treeStyle === treeStyle && mode === 'tree') { fit(600); return; }
      treeStyle = st.dataset.treeStyle;
      closeSheet(); pinnedFocus = null;
      arrange('tree', true);
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
      // From the specimens in view: a filter narrows the draw too.
      if (!order.length) return;
      const i = order[Math.floor(Math.random() * order.length)];
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
    if (slideshow && slideshow.isOpen()) return;
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

  // A resize keeps the point in view and the zoom against the overview. Phones
  // resize whenever the address bar slides; a height-only change does not re-lay out.
  let resizeTimer = null;
  let lastW = root.clientWidth, lastH = root.clientHeight;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!data) return;
      const W = root.clientWidth, H = root.clientHeight;
      if (W === lastW && H === lastH) return;
      const cx = (lastW / 2 - cam.x) / cam.k, cy = (lastH / 2 - cam.y) / cam.k;
      const rel = cam.k / fitView(box).k;
      if (W !== lastW) {
        arrange(mode, false);
        cam.k = fitView(box).k * rel;
      }
      lastW = W; lastH = H;
      cam.x = W / 2 - cx * cam.k; cam.y = H / 2 - cy * cam.k;
      apply();
    }, 180);
  });

  // ── Filters ────────────────────────────────────────────────────────────────
  // A name, a place, an age: specimens that do not match are left out and the
  // arrangement rebuilds around the rest. Kept in the address (?q=&country=&
  // locality=&age=) so a filtered view can be shared.
  const filters = { q: '', taxa: new Set(), countries: new Set(), localities: new Set(), ages: new Set() };
  // The clades offered without searching: the same as on the map.
  const MAJOR = ['chordata', 'dinosauria', 'mollusca', 'arthropoda', 'echinodermata', 'cnidaria', 'plantae', 'bacteria'];
  const lineage = (k) => (data.taxa[k] && data.taxa[k].path) || [k];
  let shown = null;   // the matching specimens' indices; null when nothing is filtered
  function isShown(i) { return !shown || shown.has(i); }
  const filterEl = document.getElementById('field-filter');
  const filterPanel = document.getElementById('field-filter-panel');
  const filterQ = document.getElementById('field-filter-q');
  const filterCount = filterEl && filterEl.querySelector('.field-filter-count');
  const fold = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  // What a specimen can be found by, in every language: its ID, its taxa and their
  // ancestors, its locality and country. Built once.
  let haystack = null;
  function buildHaystack() {
    const langs = typeof globalDict !== 'undefined' ? Object.keys(globalDict) : [];
    const names = (key) => [key].concat(langs.map((l) => globalDict[l] && globalDict[l][key]).filter(Boolean));
    haystack = data.items.map((item) => {
      const words = [item.id];
      item.t.forEach((k) => ((data.taxa[k] && data.taxa[k].path) || [k]).forEach((a) => words.push(...names(a))));
      if (!item.t.length) words.push(...names('unclassified'));
      const loc = item.l && data.localities[item.l];
      if (loc) {
        words.push(...Object.values(loc.name));
        const c = data.countries && data.countries[loc.cc];
        if (c) words.push(...Object.values(c));
      }
      return fold(words.join(' '));
    });
  }

  function computeShown() {
    const q = fold(filters.q.trim()).split(/\s+/).filter(Boolean);
    const places = filters.countries.size || filters.localities.size;
    if (!q.length && !places && !filters.ages.size && !filters.taxa.size) { shown = null; return; }
    if (!haystack) buildHaystack();
    // Localities chosen within a country narrow it to them; a country alone is all of it.
    const narrowed = new Set([...filters.localities].map((id) => data.localities[id] && data.localities[id].cc));
    shown = new Set();
    data.items.forEach((item, i) => {
      if (q.length && !q.every((w) => haystack[i].includes(w))) return;
      // Clades add up: echinoids or corals.
      if (filters.taxa.size && !(item.t.length
        ? item.t.some((k) => lineage(k).some((a) => filters.taxa.has(a)))
        : filters.taxa.has('unclassified'))) return;
      if (places) {
        const loc = item.l && data.localities[item.l];
        if (!loc || !(filters.localities.has(item.l) || (filters.countries.has(loc.cc) && !narrowed.has(loc.cc)))) return;
      }
      // An age matches when all of it lies within the chosen eras: a bracket that
      // only might be Jurassic is not shown as Jurassic.
      if (filters.ages.size) {
        const bs = item.a ? bandsOf(item.a) : [];
        if (!bs.length || !bs.every((b) => filters.ages.has(b.key))) return;
      }
      shown.add(i);
    });
  }

  function chip(parent, label, on, attrs, swatch, plate) {
    const b = el('button', 'field-chip' + (on ? ' is-on' : ''), parent);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(on));
    Object.entries(attrs).forEach(([k, v]) => { b.dataset[k] = v; });
    if (swatch) el('i', 'field-chip-swatch', b).style.background = swatch;
    if (plate) { const im = el('img', 'field-chip-plate', b); im.src = window.assetHref('/' + plate); im.alt = ''; im.loading = 'lazy'; }
    el('span', '', b).textContent = label;
    return b;
  }
  function drawFilters() {
    if (!filterEl || !data) return;
    const L = lang();
    const pick = (o) => (o && (o[L] || o.en)) || '';
    const label = document.getElementById('field-filter-q-label');
    if (filterQ && label) filterQ.placeholder = label.textContent;
    drawClades();
    const places = filterPanel.querySelector('[data-filter="places"]');
    places.textContent = '';
    const byCountry = {};
    Object.entries(data.localities).forEach(([id, loc]) => { (byCountry[loc.cc] = byCountry[loc.cc] || []).push([id, loc]); });
    Object.keys(byCountry).sort((a, b) => pick(data.countries[a]).localeCompare(pick(data.countries[b]), L)).forEach((cc) => {
      const flag = byCountry[cc][0][1].flag || '';
      chip(places, `${flag} ${pick(data.countries[cc]) || cc}`.trim(), filters.countries.has(cc), { country: cc });
      // A chosen country opens its localities, to narrow it further.
      if (!filters.countries.has(cc) && !byCountry[cc].some(([id]) => filters.localities.has(id))) return;
      const sub = el('div', 'field-chip-sub', places);
      byCountry[cc].sort((a, b) => placeName(a[0]).localeCompare(placeName(b[0]), L))
        .forEach(([id]) => chip(sub, shortPlace(id), filters.localities.has(id), { locality: id }));
    });
    const ages = filterPanel.querySelector('[data-filter="ages"]');
    ages.textContent = '';
    data.bands.forEach((b) => {
      if (!data.items.some((it) => it.a && bandsOf(it.a).some((x) => x.key === b.key))) return;
      chip(ages, t(b.key, b.key), filters.ages.has(b.key), { age: b.key }, b.c);
    });
    const n = shown ? shown.size : data.items.length;
    if (filterCount) filterCount.textContent = shown ? `${n} / ${data.items.length}` : String(n);
    filterEl.classList.toggle('is-filtered', !!shown);
    root.classList.toggle('is-empty', !!shown && !shown.size);
  }

  // Clade chips: the chosen ones, then the major groups; typing in the search box
  // offers the clades whose names match, any of which a tap adds.
  let cladeCount = null;
  function drawClades() {
    const box = filterPanel.querySelector('[data-filter="taxa"]');
    const sug = filterPanel.querySelector('[data-filter="suggest"]');
    if (!box) return;
    if (!cladeCount) {
      cladeCount = {};
      data.items.forEach((it) => it.t.forEach((k) => lineage(k).forEach((a) => { cladeCount[a] = (cladeCount[a] || 0) + 1; })));
    }
    box.textContent = '';
    const keys = [...filters.taxa].concat(MAJOR.filter((k) => data.taxa[k] && !filters.taxa.has(k)));
    keys.forEach((k) => chip(box, k === 'unclassified' ? t('unclassified', 'Unclassified') : taxonName(k), filters.taxa.has(k), { taxon: k }, null, data.taxa[k] && data.taxa[k].pl));
    sug.textContent = '';
    const q = fold((filterQ && filterQ.value || '').trim());
    if (q.length < 2) return;
    const langs = typeof globalDict !== 'undefined' ? Object.keys(globalDict) : [];
    Object.keys(data.taxa)
      .filter((k) => !filters.taxa.has(k) && fold([k].concat(langs.map((l) => globalDict[l] && globalDict[l][k] || '')).join(' ')).includes(q))
      .sort((a, b) => (cladeCount[b] || 0) - (cladeCount[a] || 0))
      .slice(0, 8)
      .forEach((k) => chip(sug, '+ ' + taxonName(k), false, { suggest: k }, null, data.taxa[k].pl));
  }

  function syncQuery() {
    const qs = new URLSearchParams();
    if (filters.q.trim()) qs.set('q', filters.q.trim());
    if (filters.taxa.size) qs.set('taxon', [...filters.taxa].join(','));
    if (filters.countries.size) qs.set('country', [...filters.countries].join(','));
    if (filters.localities.size) qs.set('locality', [...filters.localities].join(','));
    if (filters.ages.size) qs.set('age', [...filters.ages].join(','));
    const search = qs.toString().replace(/%2C/g, ',');
    try { history.replaceState(history.state, '', location.pathname + (search ? '?' + search : '') + location.hash); } catch (e) { /* file:// */ }
  }
  function readFilters(src) {
    filters.q = src.q || '';
    filters.taxa = new Set(src.taxa || []);
    filters.countries = new Set(src.countries || []);
    filters.localities = new Set(src.localities || []);
    filters.ages = new Set(src.ages || []);
  }
  const queryFilters = () => {
    const qs = new URLSearchParams(location.search);
    const list = (k) => (qs.get(k) || '').split(',').filter(Boolean);
    return { q: qs.get('q') || '', taxa: list('taxon'), countries: list('country'), localities: list('locality'), ages: list('age') };
  };

  function applyFilters(animate = true) {
    computeShown();
    if (slideshow) slideshow.refresh();
    drawFilters();
    syncQuery();
    if (shown && !shown.size) {
      // Nothing matches: the canvas empties and says so, rather than laying out nothing.
      tiles.forEach((tile) => { tile.hidden = true; });
      echoes.forEach((e) => e.el.classList.add('is-folded'));
      drawBack([]);
      labels.textContent = '';
      remember();
      return;
    }
    tiles.forEach((tile) => { tile.hidden = false; });
    closeSheet();
    arrange(mode, animate);
    fit(animate ? 900 : 0);
  }

  if (filterEl) {
    const toggle = filterEl.querySelector('.field-filter-toggle');
    const setOpen = (open) => {
      filterPanel.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      if (open && window.innerWidth > 760 && filterQ) filterQ.focus({ preventScroll: true });
    };
    toggle.addEventListener('click', () => setOpen(filterPanel.hidden));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !filterPanel.hidden) setOpen(false); });
    filterPanel.addEventListener('click', (e) => {
      const c = e.target.closest('.field-chip');
      if (c && c.dataset.suggest) {
        // A suggested clade replaces the words typed to find it.
        filters.taxa.add(c.dataset.suggest);
        filters.q = '';
        if (filterQ) filterQ.value = '';
        applyFilters();
      } else if (c) {
        const [set, key] = c.dataset.taxon ? [filters.taxa, c.dataset.taxon]
          : c.dataset.country ? [filters.countries, c.dataset.country]
          : c.dataset.locality ? [filters.localities, c.dataset.locality] : [filters.ages, c.dataset.age];
        if (set.has(key)) set.delete(key); else set.add(key);
        // Unchoosing a country lets go of its localities too.
        if (c.dataset.country && !set.has(key)) {
          Object.entries(data.localities).forEach(([id, loc]) => { if (loc.cc === key) filters.localities.delete(id); });
        }
        applyFilters();
      } else if (e.target.closest('.field-filter-clear') || e.target.closest('.field-empty-clear')) {
        readFilters({});
        if (filterQ) filterQ.value = '';
        applyFilters();
      }
    });
    root.addEventListener('click', (e) => {
      if (e.target.closest('.field-empty-clear')) { readFilters({}); if (filterQ) filterQ.value = ''; applyFilters(); }
    });
    let typing = null;
    if (filterQ) filterQ.addEventListener('input', () => {
      drawClades();
      clearTimeout(typing);
      typing = setTimeout(() => { filters.q = filterQ.value; applyFilters(); }, 250);
    });
  }

  // ── Language ───────────────────────────────────────────────────────────────
  // The page changes language in place (scripts/language.js repaints the chrome);
  // the canvas draws its own names, so it redraws them, keeping the view.
  function relabel() {
    if (!data) return;
    hideTip();
    const keep = { ...cam };
    arrange(mode, false);
    Object.assign(cam, keep);
    apply();
    if (current >= 0) openSheet(current, currentEl);
    if (slideshow) slideshow.relabel();
    drawFilters();
  }
  if (typeof window.setLanguage === 'function') {
    const setLanguage = window.setLanguage;
    window.setLanguage = function (lang) {
      const out = setLanguage.apply(this, arguments);
      setTimeout(relabel, 50);
      return out;
    };
  }
  window.addEventListener('storage', (e) => { if (e.key === 'language') relabel(); });

  // ── Start ──────────────────────────────────────────────────────────────────

  // #time, or one of the tree's drawings (#wheel…); nothing is the first.
  function readHash() {
    const h = location.hash.replace('#', '');
    if (MODES.includes(h)) return { mode: h, style: treeStyle };
    const n = STYLE_HASH.indexOf(h);
    return { mode: 'tree', style: n > 0 ? STYLES[n] : 'branches' };
  }
  // Where the reader left off, on this device (`collection-view` in localStorage):
  // the tab, the drawing and the point in view with its zoom against the overview's.
  // A link with a hash names its own view and wins.
  const SAVED = 'collection-view';
  function remember() {
    if (!data) return;
    const W = root.clientWidth, H = root.clientHeight;
    const view = { mode, style: treeStyle, x: (W / 2 - cam.x) / cam.k, y: (H / 2 - cam.y) / cam.k, k: cam.k / fitView(box).k,
      f: { q: filters.q, taxa: [...filters.taxa], countries: [...filters.countries], localities: [...filters.localities], ages: [...filters.ages] } };
    try { localStorage.setItem(SAVED, JSON.stringify(view)); } catch (e) { /* not remembered */ }
  }
  // #slideshow (the old gallery's address) opens the slideshow over everything.
  // The hash is dropped at once, so a reload or the back button lands on the explorer.
  function takeSlideshowHash() {
    if (location.hash !== '#slideshow') return false;
    try { history.replaceState(history.state, '', location.pathname + location.search); } catch (e) { /* file:// */ }
    return true;
  }
  const startSlideshow = takeSlideshowHash();
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(SAVED)); } catch (e) { saved = null; }
  if (!saved || !MODES.includes(saved.mode) || !STYLES.includes(saved.style) || location.hash || location.search) saved = null;
  ({ mode, style: treeStyle } = saved || readHash());
  window.addEventListener('hashchange', () => {
    if (takeSlideshowHash()) { if (slideshow) slideshow.open(); return; }
    const next = readHash();
    if (!data || (next.mode === mode && next.style === treeStyle)) return;
    treeStyle = next.style;
    closeSheet(); arrange(next.mode, true); fit(900);
  });

  // Labels are measured in the reader's language, so the dictionary is waited for
  // (briefly: a slow one is not worth holding the collection back for).
  const dictReady = new Promise((done) => {
    const t0 = Date.now();
    const poll = () => {
      // The page's own strings (collection.json) merge in after the global ones.
      if ((typeof globalDictLoaded !== 'undefined' && globalDictLoaded && 'slide-play' in dict()) || Date.now() - t0 > 1500) done();
      else setTimeout(poll, 50);
    };
    poll();
  });

  Promise.all([window.fetchJSONCached(window.assetHref('/jsondata/field.json')), dictReady]).then(([d]) => {
    data = d;
    slideshow = window.createCollectionSlideshow({
      data, captions, lang, t, taxonName, placeName, ageText,
      indices: () => data.items.map((_, i) => i).filter(isShown),
      beforeOpen: closeSheet,
    });
    // The tiles enter from a tight knot at the centre the first time: the
    // collection assembling itself, once.
    readFilters(location.search ? queryFilters() : (!startSlideshow && saved && saved.f) || {});
    if (filterQ) filterQ.value = filters.q;
    computeShown();
    if (slideshow) slideshow.refresh();
    drawFilters();
    syncQuery();
    if (shown && !shown.size) { applyFilters(false); requestAnimationFrame(() => root.classList.add('is-ready')); return; }
    arrange(mode, false);
    Object.assign(cam, fitView(box));
    if (saved && [saved.x, saved.y, saved.k].every(Number.isFinite)) {
      const [lo, hi] = kLimits();
      const k = Math.max(lo, Math.min(hi, cam.k * saved.k));
      Object.assign(cam, { k, x: root.clientWidth / 2 - saved.x * k, y: root.clientHeight / 2 - saved.y * k });
    }
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
    if (startSlideshow) slideshow.open();
  }).catch((err) => console.error('field:', err));
})();
