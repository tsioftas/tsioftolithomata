/* The vertical deep-time rail on a taxon page.
 *
 * One scale, down the margin, oldest at the top — the same direction the locality
 * cards run. Three things sit on it: the ICS bands, the taxon's known range as a
 * hairline, and the collection's localities as heavy segments. The window is not
 * fixed: at the top of the page it holds everything the page knows about, and as a
 * locality card comes into view it eases to that locality's own span, which is the
 * "different window per locality" the page-level chart cannot give. The active
 * locality's segment lights up, and its card lights up with it.
 *
 * The rail is a second reading of what the horizontal chart already says, so it
 * renders only where there is margin to hold it and only when JavaScript runs;
 * data-deep-time on <html> decides which of the two the page is showing.
 */
(function () {
  // Only the rail reading of the page does this work; the bar reading leaves the
  // aside hidden and spends nothing on scroll.
  if (document.documentElement.dataset.deepTime !== 'rail') return;
  const rail = document.querySelector('.deep-time-rail');
  const payload = document.getElementById('deep-time-rail-data');
  if (!rail || !payload) return;

  const data = JSON.parse(payload.textContent);
  const bandsBox = rail.querySelector('.deep-time-rail-bands');
  const lane = rail.querySelector('.deep-time-rail-lane');
  const rangeMark = rail.querySelector('.deep-time-rail-range');
  const hereBox = rail.querySelector('.deep-time-rail-here');
  const edgeTop = rail.querySelector('.deep-time-rail-edge-top');
  const edgeBottom = rail.querySelector('.deep-time-rail-edge-bottom');
  const nowMark = rail.querySelector('.deep-time-rail-now');

  const localities = data.localities || [];
  const cards = new Map();
  document.querySelectorAll('.locality-block[data-locality]').forEach((card) => {
    cards.set(card.dataset.locality, card);
    // Opening a card is not a scroll, so nothing recomputed and the rail stayed on
    // whichever locality had been nearest a moment ago. It is also the plainest
    // statement of what the reader is looking at, so it takes the window.
    card.addEventListener('toggle', () => schedule());
  });

  // Everything the page knows about, which is the window it opens with.
  const ends = [];
  if (data.range) ends.push(data.range.from, data.range.to);
  localities.forEach((l) => ends.push(l.from, l.to));
  if (!ends.length) return;
  // Never past the oldest band: the chart is the Phanerozoic, and a range that starts
  // before it - Animalia, Cnidaria, Plantae - fades out at that edge rather than
  // hanging over a strip with no bands in it. The horizontal reading does the same.
  const total = Math.max(...data.bands.map((b) => b.from));
  const full = { from: Math.min(Math.max(...ends), total), to: Math.min(...ends) };
  // A page whose whole span is one instant has no scale to draw.
  if (full.from <= full.to) full.to = Math.max(full.from - 1, 0);

  const fmt = (v) => `${Number(v.toFixed(3))}`;
  // The window's own ends are the page's span plus padding, not measurements, so
  // they are printed short: three significant figures is as much as they mean, and
  // "424" reads at a glance where "424.35" does not.
  const fmtEdge = (v) => {
    if (v <= 0) return '0';
    const digits = v >= 100 ? 0 : v >= 10 ? 1 : 2;
    return `${Number(v.toFixed(digits))}`;
  };
  const containing = (ma) => data.bands.find((b) => b.from >= ma && ma >= b.to);
  const pad = (from, to) => {
    // A locality window is its span plus half of it either side — but never tighter
    // than the band it sits in. Taallalt is three million years inside the
    // Silurian, and a window that tight is one colour from top to bottom: the
    // reader learns where they are from a band they can see the ends of, with its
    // neighbours showing at the edges.
    const span = from - to;
    const padded = span > 0
      ? { from: from + span * 0.5, to: Math.max(to - span * 0.5, 0) }
      : { from: from + 3, to: Math.max(to - 3, 0) };
    const band = containing(from) || containing(to);
    const floor = band ? (band.from - band.to) * 1.15 : 0;
    if (band && padded.from - padded.to < floor) {
      // Grown around the middle of the locality, so it stays where the reader's eye is.
      const middle = (from + to) / 2;
      padded.from = middle + floor / 2;
      padded.to = Math.max(middle - floor / 2, 0);
    }
    return clamp(padded);
  };

  // Padding is half the span either side, which is context around one narrow
  // locality and waste around a wide set of them: two cards in view on the Anthozoa
  // page, 438 Ma apart, asked for a window reaching 656 Ma - a hundred and twenty
  // million years of blank above the oldest band the chart has. The window never
  // opens past what the page itself knows about, which always includes the taxon's
  // own range, so nothing is ever clipped and nothing empty is ever shown.
  const clamp = (w) => ({
    from: Math.min(w.from, full.from),
    to: Math.max(w.to, full.to),
  });

  let win = { ...full };

  function place(el, from, to) {
    // Oldest at the top: 0% is the window's older end.
    const span = win.from - win.to;
    const top = ((win.from - Math.min(from, win.from)) / span) * 100;
    const bottom = ((win.from - Math.max(to, win.to)) / span) * 100;
    el.style.top = `${Math.max(top, 0)}%`;
    el.style.height = `${Math.max(bottom - Math.max(top, 0), 0)}%`;
  }

  // Bands are built once; only their positions change with the window.
  const bandEls = data.bands.map((band) => {
    const el = document.createElement('span');
    el.className = 'deep-time-rail-band';
    el.style.background = band.color;
    el.title = `${band.name} · ${fmt(band.from)}–${fmt(band.to)} ${data.unit}`;
    const label = document.createElement('i');
    // Dark ink on the pale bands, light on the deep ones: the commission's colours
    // run from near-white to bottle green and one ink cannot read on both.
    label.style.color = band.ink || 'rgba(0, 0, 0, 0.68)';
    el.appendChild(label);
    bandsBox.appendChild(el);
    return { band, el, label };
  });

  // Where the subtaxa are known from, hatched exactly as the horizontal chart hatches
  // them: that sameness is what makes the rail readable without a legend of its own,
  // since the chart with its legend is on the same screen. Behind the taxon's line.
  const subEls = (data.subtaxa || []).map((span) => {
    const el = document.createElement('span');
    el.className = 'deep-time-rail-sub' + (span.derived ? ' deep-time-rail-sub-erratic' : '');
    lane.insertBefore(el, rangeMark);
    return { span, el };
  });

  const hereEls = localities.map((locality) => {
    const el = document.createElement('span');
    el.className = 'deep-time-rail-seg'
      + (locality.point ? ' deep-time-rail-seg-point' : '')
      + (locality.derived ? ' deep-time-rail-seg-erratic' : '');
    if (locality.color) el.style.setProperty('--seg', locality.color);
    el.dataset.locality = locality.id;
    const card = cards.get(locality.id);
    // The card's heading is filled by the language script, which may not have run
    // yet, so the id stands in until it has.
    const heading = card && card.querySelector('.locality-name');
    el.title = (heading && heading.textContent.trim()) || locality.id;
    if (heading) el.addEventListener('pointerenter', () => {
      el.title = heading.textContent.trim() || locality.id;
    });
    // Clicking the rail is the shortest way from "when" to "what came from there".
    el.addEventListener('click', () => {
      if (!card) return;
      card.open = true;
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    hereBox.appendChild(el);
    return { locality, el };
  });

  // The rail's own key. A phone has no hover to explain a mark, so one tap on the
  // rail names all three in the shapes the chart's legend uses. It closes on the next
  // tap or the next scroll, because it is an answer to a question, not furniture.
  const keyBox = rail.querySelector('.deep-time-rail-key');
  function buildKey() {
    const rows = [];
    // What the page is about first, then its subgroups, then the range they sit in.
    if (localities.length) rows.push(['here', data.here_label, '']);
    if (subEls.length) rows.push(['sub', data.subtaxa_label, '']);
    if (data.range) {
      rows.push(['range', data.range_label, `${fmtEdge(data.range.from)}–${fmtEdge(data.range.to)} ${data.unit}`]);
    }
    const carried = localities.some((l) => l.derived)
      || (data.subtaxa || []).some((span) => span.derived);
    if (carried) rows.push(['erratic', data.derived_label, '']);
    // Built as nodes rather than as a string of HTML: the names come out of the
    // page's own JSON, and text read from the document and handed back to innerHTML
    // is exactly the round trip CodeQL's js/xss-through-dom is about. textContent
    // cannot become markup.
    rows.forEach(([kind, name, note]) => {
      const row = document.createElement('span');
      row.className = 'deep-time-rail-key-row';
      const swatch = document.createElement('i');
      swatch.className = `deep-time-rail-key-${kind}`;
      row.appendChild(swatch);
      row.appendChild(document.createTextNode(note ? `${name || ''} ${note}` : (name || '')));
      keyBox.appendChild(row);
    });
  }
  buildKey();
  function closeKey() {
    keyBox.hidden = true;
  }
  // Shown once a session, unprompted: a reader who has never seen the rail has no
  // reason to tap it, and marks nobody can name are the thing that was wrong with it.
  function offerKey() {
    try {
      if (sessionStorage.getItem('deeptime-key-seen')) return;
      sessionStorage.setItem('deeptime-key-seen', '1');
    } catch (e) { /* private mode: offer it and move on */ }
    keyBox.hidden = false;
  }
  rail.addEventListener('click', (event) => {
    if (event.target.closest('.deep-time-rail-seg')) return;
    keyBox.hidden = !keyBox.hidden;
  });

  function render() {
    const span = win.from - win.to;
    const px = rail.clientHeight || 1;
    bandEls.forEach(({ band, el, label }) => {
      const top = Math.min(band.from, win.from);
      const bottom = Math.max(band.to, win.to);
      if (top <= bottom) {
        el.hidden = true;
        return;
      }
      el.hidden = false;
      place(el, band.from, band.to);
      // As much of the name as the band's height can hold, set upright: about
      // 6.2px per character plus a little air, then the abbreviation, then nothing
      // rather than a name clipped mid-word. The slim rail never has the width for
      // a whole name, so it goes straight to the abbreviation.
      const height = ((top - bottom) / span) * px;
      // Set sideways the label's width is its line box, so even the phone's narrower
      // band column can hold a whole name — what decides is the band's height.
      const perChar = compact ? 5.6 : 6.2;
      const needed = band.name.length * perChar + 8;
      const abbrMin = compact ? 17 : 22;
      label.textContent = height >= needed ? band.name : height >= abbrMin ? band.abbr : '';
    });
    if (data.range) {
      place(rangeMark, data.range.from, data.range.to);
      rangeMark.classList.toggle('deep-time-rail-range-open', data.range.from > win.from);
      rangeMark.hidden = false;
    } else {
      rangeMark.hidden = true;
    }

    lane.hidden = !data.range && !subEls.length;
    subEls.forEach(({ span, el }) => {
      const visible = span.to <= win.from && span.from >= win.to;
      el.hidden = !visible;
      if (visible) place(el, span.from, span.to);
    });
    hereEls.forEach(({ locality, el }) => {
      const visible = locality.to <= win.from && locality.from >= win.to;
      el.hidden = !visible;
      if (visible) place(el, locality.from, locality.to);
    });
    // The unit once, on the older end: both ends are the same scale, and on a phone
    // the second copy costs more room than it earns.
    edgeTop.textContent = `${fmtEdge(win.from)} ${data.unit}`;
    // The present is a word, not a zero — the same word the chart prints under its
    // own right-hand end.
    edgeBottom.textContent = win.to <= 0 ? (data.now_label || '0') : fmtEdge(win.to);
    nowMark.hidden = win.to > 0;
  }

  function setWindow(next) {
    if (next.from === win.from && next.to === win.to) return;
    win = next;
    render();
  }

  // Which locality the reader is on: the card nearest the middle of the viewport
  // among those actually in it. Cards are collapsed until opened, so several can
  // be in view at once and "first intersecting" jumps around.
  let active = null;
  let shown = '';
  function onScroll() {
    // Every locality on screen, not only the one nearest the middle: landing on the
    // Aves page put the window on the Paleocene while a Miocene card sat in view
    // underneath, and a window that hides what the reader can see is lying to them.
    // The nearest card is still the active one, for the highlight.
    const middle = window.innerHeight / 2;
    const visible = [];
    let best = null;
    let bestDistance = Infinity;
    cards.forEach((card, id) => {
      const box = card.getBoundingClientRect();
      if (box.bottom < 0 || box.top > window.innerHeight) return;
      const locality = localities.find((l) => l.id === id);
      if (locality) visible.push(locality);
      const distance = Math.abs((box.top + box.bottom) / 2 - middle);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = id;
      }
    });
    // An open card is an explicit choice and wins the window and the highlight; with
    // none open the window covers everything on screen, so a card the reader can see
    // is never left off the scale.
    const opened = visible.filter((l) => {
      const card = cards.get(l.id);
      return card && card.open;
    });
    // Till is not a window to zoom to: its bracket is as wide as the rocks the ice
    // crossed, and taking the scale there would flatten everything else. It still
    // draws, and it still highlights; it just does not decide the scale.
    const situ = (list) => list.filter((l) => !l.derived);
    const focus = situ(opened).length ? situ(opened)
      : opened.length ? [] : situ(visible);
    if (opened.length) {
      let closest = null;
      let closestDistance = Infinity;
      opened.forEach((l) => {
        const box = cards.get(l.id).getBoundingClientRect();
        const distance = Math.abs((box.top + box.bottom) / 2 - middle);
        if (distance < closestDistance) {
          closestDistance = distance;
          closest = l.id;
        }
      });
      best = closest;
    }
    const key = focus.map((l) => l.id).join(',');
    if (best === active && key === shown) return;
    if (active && active !== best) {
      const previous = cards.get(active);
      if (previous) previous.classList.remove('locality-block-current');
    }
    active = best;
    shown = key;
    const onScreen = new Set(focus.map((l) => l.id));
    hereEls.forEach(({ locality, el }) => {
      el.classList.toggle('deep-time-rail-seg-active', locality.id === active);
      el.classList.toggle('deep-time-rail-seg-shown', onScreen.has(locality.id));
    });
    const card = active && cards.get(active);
    if (card) card.classList.add('locality-block-current');
    if (focus.length) {
      setWindow(pad(Math.max(...focus.map((l) => l.from)), Math.min(...focus.map((l) => l.to))));
    } else {
      setWindow({ ...full });
    }
  }

  let queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      closeKey();
      clearChrome();
      onScroll();
    });
  }

  // Where the rail goes is measured, not assumed: a taxon page's column is wider
  // than the rest of the site's, and a reader's window is whatever it is. It sits
  // in the margin when the column leaves one, otherwise inset at the column's
  // edge with the text pushed clear of it.
  const RAIL_W = 46;
  const root = document.documentElement;
  const column = document.querySelector('main');

  // The header scrolls away with the page while the rail is fixed, so at the top of
  // the page the two want the same strip of screen — worst on a phone, where the
  // header is two rows tall. The rail's top is measured from the header's bottom
  // edge every time we look, and leaves room for its own end label above it.
  const header = document.querySelector('#header-container') || document.querySelector('header');
  const footer = document.querySelector('footer');
  const LABEL_ROOM = 22;
  const MIN_EDGE = 10;
  function clearChrome() {
    const top = header ? header.getBoundingClientRect().bottom : 0;
    rail.style.top = `${Math.max(top + 6, MIN_EDGE) + LABEL_ROOM}px`;
    // The footer comes up into the rail's strip at the end of the page the same way
    // the header sits in it at the start, so the rail gives way to both.
    const reach = footer ? window.innerHeight - footer.getBoundingClientRect().top : 0;
    rail.style.bottom = `${Math.max(reach + 6, MIN_EDGE) + LABEL_ROOM}px`;
  }

  let compact = false;
  function fit() {
    if (!column) return false;
    // A phone has no margin to spare but plenty of height, which is the shape the
    // rail wants: it goes slim, at the right edge, with the text padded clear of
    // it. A wide window puts it in the margin the column leaves.
    compact = window.innerWidth < 900;
    root.dataset.railSize = compact ? 'compact' : 'full';
    if (compact) {
      root.dataset.railInset = '1';
      rail.style.left = '';
      return true;
    }
    // On the right, at every width: the phone's rail is pinned to that edge and the
    // desktop one now keeps it company, so the reading does not change sides with the
    // window. In the margin the column leaves, or against its inner edge with the
    // text padded clear when there is no margin to leave.
    const box = column.getBoundingClientRect();
    if (window.innerWidth - box.right >= RAIL_W + 16) {
      root.dataset.railInset = '0';
      rail.style.left = `${box.right + 12}px`;
    } else {
      root.dataset.railInset = '1';
      rail.style.left = `${box.right - RAIL_W - 6}px`;
    }
    return true;
  }

  function start() {
    if (!fit()) {
      // The bar is the fallback, and the page has to be told so it stops hiding it.
      rail.removeAttribute('data-ready');
      root.dataset.railActive = '0';
      return;
    }
    rail.dataset.ready = '1';
    root.dataset.railActive = '1';
    clearChrome();
    render();
    onScroll();
    offerKey();
  }

  start();
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', () => {
    start();
    schedule();
  });
})();
