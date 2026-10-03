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

  function groupOf(item) {
    const key = item.t[0];
    if (!key || !data.taxa[key]) return 'unclassified';
    const path = data.taxa[key].path;
    return path[1] || path[0];
  }

  function shelfPack(blocks, targetW, gap) {
    let x = 0, y = 0, rowH = 0;
    blocks.forEach((b) => {
      if (x > 0 && x + b.w > targetW) { x = 0; y += rowH + gap; rowH = 0; }
      b.x = x; b.y = y;
      x += b.w + gap;
      rowH = Math.max(rowH, b.h);
    });
  }

  // How much labels are enlarged on screen at camera scale k (matches the CSS).
  const labelScale = (k) => Math.max(1, 0.55 / k);

  function layoutTree(ls = 1) {
    const groups = new Map();
    data.items.forEach((item, i) => {
      const g = groupOf(item);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(i);
    });
    const pathKey = (i) => {
      const k = data.items[i].t[0];
      return k && data.taxa[k] ? data.taxa[k].path.join('/') : '~';
    };
    const LABEL = Math.max(92, 52 * ls);
    const blocks = [];
    groups.forEach((list, key) => {
      list.sort((a, b) => pathKey(a).localeCompare(pathKey(b)));
      const cols = Math.max(2, Math.ceil(Math.sqrt(list.length * 1.5)));
      const rows = Math.ceil(list.length / cols);
      const name = key === 'unclassified' ? t('unclassified', 'Unclassified') : taxonName(key);
      const labelW = (name.length * 14 + 40) * ls;
      blocks.push({ key, list, cols, w: Math.max(cols * STEP - G, labelW), h: rows * STEP - G + LABEL });
    });
    blocks.sort((a, b) => (a.key === 'unclassified') - (b.key === 'unclassified') || b.list.length - a.list.length);
    const area = blocks.reduce((s, b) => s + (b.w + 90) * (b.h + 90), 0);
    const aspect = Math.max(0.7, Math.min(2.2, root.clientWidth / Math.max(1, root.clientHeight)));
    shelfPack(blocks, Math.sqrt(area * aspect), 90);

    const p = [], lab = [], ord = [];
    blocks.forEach((b) => {
      b.list.forEach((i, j) => {
        p[i] = { x: b.x + (j % b.cols) * STEP, y: b.y + LABEL + Math.floor(j / b.cols) * STEP };
        ord.push(i);
      });
      const tax = data.taxa[b.key];
      const parent = tax && tax.path.length > 1 ? tax.path[0] : null;
      lab.push({
        x: b.x, y: b.y + LABEL - 14, cls: 'lab-group',
        kicker: parent ? taxonName(parent) : '',
        text: b.key === 'unclassified' ? t('unclassified', 'Unclassified') : taxonName(b.key),
        count: b.list.length,
        href: b.key === 'unclassified' ? 'unclassified' : (tax && tax.h),
      });
    });
    return { p, lab, ord, back: [] };
  }

  function bandX(ma, bands, BW) {
    if (ma >= bands[0].from) return 0;
    for (let i = 0; i < bands.length; i++) {
      const b = bands[i];
      if (ma <= b.from && ma >= b.to) return (i + (b.from - ma) / (b.from - b.to)) * BW;
    }
    return bands.length * BW;
  }

  function layoutTime() {
    const bands = data.bands;
    const BW = 300;
    const MAXH = 9;
    // One column group per locality (or per age, for specimens without one).
    const byKey = new Map();
    const undated = [];
    data.items.forEach((item, i) => {
      if (!item.a) { undated.push(i); return; }
      const key = (item.l || '') + '|' + item.a.join('-');
      if (!byKey.has(key)) byKey.set(key, { mid: (item.a[0] + item.a[1]) / 2, list: [], loc: item.l, age: item.a });
      byKey.get(key).list.push(i);
    });
    const cols = Array.from(byKey.values()).sort((a, b) => b.mid - a.mid);
    const p = [], lab = [], ord = [];
    let right = -Infinity;
    let top = 0;
    cols.forEach((c) => {
      const n = Math.ceil(c.list.length / MAXH);
      const w = n * STEP - G;
      const want = bandX(c.mid, bands, BW) - w / 2;
      const x0 = Math.max(want, right + 18);
      c.list.forEach((i, j) => {
        const col = Math.floor(j / MAXH), row = j % MAXH;
        p[i] = { x: x0 + col * STEP, y: -(row + 1) * STEP };
        ord.push(i);
      });
      const h = Math.min(c.list.length, MAXH) * STEP;
      top = Math.max(top, h);
      if (c.loc) lab.push({ x: x0, y: -h - 8, cls: 'lab-col', text: placeName(c.loc), href: data.localities[c.loc] && data.localities[c.loc].h });
      right = x0 + w;
    });
    const endX = Math.max(right, bands.length * BW) + 120;
    undated.forEach((i, j) => {
      p[i] = { x: endX + (j % 4) * STEP, y: -(Math.floor(j / 4) + 1) * STEP };
      ord.push(i);
    });
    if (undated.length) lab.push({ x: endX, y: -Math.ceil(undated.length / 4) * STEP - 10, cls: 'lab-col', text: '?' });

    const H = top + 60;
    const bk = bands.map((b, i) => ({
      type: 'band', x: i * BW, w: BW, y: -H, h: H, c: b.c, ink: b.ink,
      name: t(b.key, b.key.charAt(0).toUpperCase() + b.key.slice(1)), from: b.from,
    }));
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

  function layoutPlace(ls = 1) {
    const locs = data.localities;
    const coords = Object.values(locs).filter((l) => l.lat != null);
    const lon0 = Math.min(...coords.map((l) => l.lon)) - 2;
    const lon1 = Math.max(...coords.map((l) => l.lon)) + 2;
    const merc = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * 180 / Math.PI;
    const latTop = Math.max(...coords.map((l) => merc(l.lat))) + 2;
    const S = 5200 / (lon1 - lon0);
    const proj = (lat, lon) => ({ x: (lon - lon0) * S, y: (latTop - merc(lat)) * S });

    const clusters = new Map();
    const lost = [];
    data.items.forEach((item, i) => {
      const loc = item.l && locs[item.l];
      if (!loc || loc.lat == null) { lost.push(i); return; }
      if (!clusters.has(item.l)) clusters.set(item.l, { id: item.l, list: [], at: proj(loc.lat, loc.lon) });
      clusters.get(item.l).list.push(i);
    });
    const cl = Array.from(clusters.values());
    cl.forEach((c) => {
      c.cols = Math.max(1, Math.ceil(Math.sqrt(c.list.length)));
      // Wide enough for its name as well as its tiles, at the size labels are drawn
      // when the whole map is in view, so neighbouring names do not run together.
      const nameW = (shortPlace(c.id).length * 9.5 + 50) * Math.min(ls, 2);
      c.tilesW = c.cols * STEP - G;
      c.w = Math.max(c.tilesW, nameW);
      c.labelH = Math.max(56, 40 * ls);
      c.h = Math.ceil(c.list.length / c.cols) * STEP - G + c.labelH;
      c.cx = c.at.x; c.cy = c.at.y;
    });
    // Push overlapping clusters apart, each away from the other's centre, so a crowded
    // region spreads out in every direction and keeps its rough shape.
    for (let it = 0; it < 400; it++) {
      let moved = false;
      for (let a = 0; a < cl.length; a++) {
        for (let b = a + 1; b < cl.length; b++) {
          const A = cl[a], B = cl[b];
          const ox = (A.w + B.w) / 2 + 40 - Math.abs(A.cx - B.cx);
          const oy = (A.h + B.h) / 2 + 40 - Math.abs(A.cy - B.cy);
          if (ox > 0 && oy > 0) {
            moved = true;
            let dx = B.cx - A.cx, dy = B.cy - A.cy;
            const d = Math.hypot(dx, dy) || 1;
            if (d < 1) { dx = 1; dy = 0.3; }
            const push = Math.min(ox, oy) * 0.25 + 1;
            A.cx -= dx / d * push; A.cy -= dy / d * push;
            B.cx += dx / d * push; B.cy += dy / d * push;
          }
        }
      }
      if (!moved) break;
    }
    const p = [], lab = [], bk = [], ord = [];
    cl.sort((a, b) => a.cy - b.cy || a.cx - b.cx).forEach((c) => {
      const x0 = c.cx - c.w / 2 + (c.w - c.tilesW) / 2, y0 = c.cy - c.h / 2 + c.labelH;
      c.list.forEach((i, j) => {
        p[i] = { x: x0 + (j % c.cols) * STEP, y: y0 + Math.floor(j / c.cols) * STEP };
        ord.push(i);
      });
      const loc = locs[c.id];
      lab.push({ x: x0, y: y0 - 14, cls: 'lab-place', text: shortPlace(c.id), kicker: loc.flag, href: loc.h, count: c.list.length });
      bk.push({ type: 'pin', x: c.at.x, y: c.at.y, x2: c.cx, y2: c.cy, c: loc.c });
    });
    // The countries, faintly, where their localities are.
    const countries = new Map();
    cl.forEach((c) => {
      const cc = locs[c.id].cc;
      if (!cc) return;
      if (!countries.has(cc)) countries.set(cc, { x: 0, y: 0, n: 0 });
      const e = countries.get(cc); e.x += c.at.x; e.y += c.at.y; e.n++;
    });
    // Named above the clusters they gather, as the overview's legend.
    cl.forEach((c) => {
      const e = countries.get(locs[c.id].cc);
      if (e) e.top = Math.min(e.top === undefined ? Infinity : e.top, c.cy - c.h / 2);
    });
    // At the overview's scale a name is this big in world units; neighbours that would
    // touch are stacked rather than overprinted.
    const kFit = ls > 1 ? 0.55 / ls : 0.55;
    const placed = [];
    Array.from(countries.entries())
      .map(([cc, e]) => ({ name: t(cc, cc.toUpperCase()), x: e.x / e.n, y: e.top - 30 }))
      .sort((a, b) => b.y - a.y)
      .forEach((c) => {
        const w = (c.name.length * 16 + 24) / kFit, h = 40 / kFit;
        let moved = true;
        while (moved) {
          moved = false;
          for (const o of placed) {
            if (Math.abs(o.x - c.x) < (o.w + w) / 2 && Math.abs(o.y - c.y) < h) { c.y = o.y - h; moved = true; }
          }
        }
        placed.push({ ...c, w });
        bk.push({ type: 'country', x: c.x, y: c.y, name: c.name, h });
      });
    // Graticule every five degrees.
    const yMax = Math.max(...cl.map((c) => c.cy + c.h)) + 200;
    for (let lon = Math.ceil(lon0 / 5) * 5; lon <= lon1; lon += 5) bk.push({ type: 'meridian', x: (lon - lon0) * S, y: -200, h: yMax + 200, label: lon + '°' });
    for (let lat = 25; lat <= 65; lat += 5) {
      const y = (latTop - merc(lat)) * S;
      if (y > -200 && y < yMax) bk.push({ type: 'parallel', x: -200, y, w: (lon1 - lon0) * S + 400, label: lat + '°' });
    }
    const lx = -260;
    lost.forEach((i, j) => { p[i] = { x: lx + (j % 3) * STEP, y: yMax - 200 + Math.floor(j / 3) * STEP }; ord.push(i); });
    if (lost.length) lab.push({ x: lx, y: yMax - 214, cls: 'lab-place', text: '?' });
    return { p, lab, ord, back: bk };
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

  function drawBack(list) {
    back.textContent = '';
    const svgNS = 'http://www.w3.org/2000/svg';
    let svg = null;
    list.forEach((b) => {
      if (b.type === 'band') {
        const e = el('div', 'fb-band' + (b.v ? ' is-v' : ''), back);
        e.style.cssText = `transform:translate(${b.x}px,${b.y}px);width:${b.w}px;height:${b.h}px;--band:${b.c};--band-ink:${b.ink}`;
        el('span', 'fb-band-name', e).textContent = b.name;
        el('span', 'fb-band-age', e).textContent = String(+b.from.toFixed(1));
      } else if (b.type === 'meridian' || b.type === 'parallel') {
        const e = el('div', 'fb-grat fb-' + b.type, back);
        e.style.cssText = b.type === 'meridian'
          ? `transform:translate(${b.x}px,${b.y}px);height:${b.h}px`
          : `transform:translate(${b.x}px,${b.y}px);width:${b.w}px`;
        el('span', 'fb-grat-label', e).textContent = b.label;
      } else if (b.type === 'country') {
        const e = el('div', 'fb-country', back);
        e.style.transform = `translate(${b.x}px, ${b.y}px)`;
        el('span', 'fb-country-name', e).textContent = b.name;
      } else if (b.type === 'pin') {
        if (!svg) {
          svg = document.createElementNS(svgNS, 'svg');
          svg.setAttribute('class', 'fb-pins');
          back.appendChild(svg);
        }
        const line = document.createElementNS(svgNS, 'line');
        line.setAttribute('x1', b.x); line.setAttribute('y1', b.y);
        line.setAttribute('x2', b.x2); line.setAttribute('y2', b.y2);
        svg.appendChild(line);
        const dot = document.createElementNS(svgNS, 'circle');
        dot.setAttribute('cx', b.x); dot.setAttribute('cy', b.y); dot.setAttribute('r', 7);
        dot.style.setProperty('--pin', b.c || 'var(--uv)');
        svg.appendChild(dot);
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
        b.y1 = Math.max(b.y1, bk.y + bk.h + (bk.v ? 0 : 80));
      } else if (bk.type === 'country') {
        b.y0 = Math.min(b.y0, bk.y - bk.h);
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

  function apply() {
    world.style.transform = `translate3d(${cam.x}px, ${cam.y}px, 0) scale(${cam.k})`;
    root.style.setProperty('--k', cam.k);
    root.style.setProperty('--gx', cam.x + 'px');
    root.style.setProperty('--gy', cam.y + 'px');
    root.style.setProperty('--gs', (40 * cam.k) + 'px');
    root.classList.toggle('is-near', T * cam.k > 44);
    root.classList.toggle('is-mid', T * cam.k > 24);
    scheduleHires();
  }

  function fitView(b) {
    const narrow = root.clientWidth < 760;
    const pad = Math.min(96, root.clientWidth * 0.06);
    const top = narrow ? 130 : 128, bottom = narrow ? 210 : 172;
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

  root.addEventListener('dblclick', (e) => {
    if (e.target.closest('.field-ui, .sheet')) return;
    const r = root.getBoundingClientRect();
    const k = Math.min(kLimits()[1], cam.k * 2.2);
    const px = e.clientX - r.left, py = e.clientY - r.top;
    flyTo({ k, x: px - (px - cam.x) * (k / cam.k), y: py - (py - cam.y) * (k / cam.k) }, 420);
  });

  world.addEventListener('click', (e) => {
    const tile = e.target.closest('.tile');
    if (!tile) return;
    if (suppressClick) { e.preventDefault(); return; }
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
    $('.sheet-full').href = full.src;
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
