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
  });

  // Everything the page knows about, which is the window it opens with.
  const ends = [];
  if (data.range) ends.push(data.range.from, data.range.to);
  localities.forEach((l) => ends.push(l.from, l.to));
  if (!ends.length) return;
  const full = { from: Math.max(...ends), to: Math.min(...ends) };
  // A page whose whole span is one instant has no scale to draw.
  if (full.from <= full.to) full.to = Math.max(full.from - 1, 0);

  const fmt = (v) => `${Number(v.toFixed(3))}`;
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
    if (!band) return padded;
    const floor = (band.from - band.to) * 1.15;
    if (padded.from - padded.to >= floor) return padded;
    // Grown around the middle of the locality, so it stays where the reader's eye is.
    const middle = (from + to) / 2;
    return { from: middle + floor / 2, to: Math.max(middle - floor / 2, 0) };
  };

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
    el.appendChild(label);
    bandsBox.appendChild(el);
    return { band, el, label };
  });

  const hereEls = localities.map((locality) => {
    const el = document.createElement('span');
    el.className = 'deep-time-rail-seg' + (locality.point ? ' deep-time-rail-seg-point' : '');
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
      const needed = band.name.length * 6.2 + 8;
      const abbrMin = compact ? 17 : 22;
      label.textContent = !compact && height >= needed ? band.name
        : height >= abbrMin ? band.abbr : '';
    });
    if (data.range) {
      place(rangeMark, data.range.from, data.range.to);
      rangeMark.classList.toggle('deep-time-rail-range-open', data.range.from > win.from);
      lane.hidden = false;
    } else {
      lane.hidden = true;
    }
    hereEls.forEach(({ locality, el }) => {
      const visible = locality.to <= win.from && locality.from >= win.to;
      el.hidden = !visible;
      if (visible) place(el, locality.from, locality.to);
    });
    edgeTop.textContent = `${fmt(win.from)} ${data.unit}`;
    edgeBottom.textContent = `${fmt(win.to)} ${data.unit}`;
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
  function onScroll() {
    const middle = window.innerHeight / 2;
    let best = null;
    let bestDistance = Infinity;
    cards.forEach((card, id) => {
      const box = card.getBoundingClientRect();
      if (box.bottom < 0 || box.top > window.innerHeight) return;
      const distance = Math.abs((box.top + box.bottom) / 2 - middle);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = id;
      }
    });
    if (best === active) return;
    if (active) {
      const previous = cards.get(active);
      if (previous) previous.classList.remove('locality-block-current');
    }
    active = best;
    hereEls.forEach(({ locality, el }) => {
      el.classList.toggle('deep-time-rail-seg-active', locality.id === active);
    });
    const locality = localities.find((l) => l.id === active);
    if (locality) {
      cards.get(active).classList.add('locality-block-current');
      setWindow(pad(locality.from, locality.to));
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
    const box = column.getBoundingClientRect();
    if (box.left >= RAIL_W + 16) {
      root.dataset.railInset = '0';
      rail.style.left = `${box.left - RAIL_W - 12}px`;
    } else {
      root.dataset.railInset = '1';
      rail.style.left = `${box.left + 6}px`;
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
    render();
    onScroll();
  }

  start();
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', () => {
    start();
    schedule();
  });
})();
