// A specimen playlist over the explorer's data. No gallery HTML or duplicate index.
'use strict';
window.createCollectionSlideshow = function ({ data, captions, lang, t, taxonName, placeName, ageText, indices, beforeOpen }) {
  const dialog = document.getElementById('collection-slideshow');
  const start = document.querySelector('[data-field-slideshow]');
  const $ = selector => dialog.querySelector(selector);
  const image = $('.slide-image');
  let playlist = [], at = 0, view = 0, playing = false, ready = false;
  let timer = null, generation = 0, returnFocus = null;
  const preloads = new Map();
  // Each specimen opens on a random view, kept per round so going back shows the same one.
  const picked = new Map();
  const viewFor = i => {
    if (!picked.has(i)) picked.set(i, Math.floor(Math.random() * data.items[i].p.length));
    return picked.get(i);
  };
  const item = () => data.items[playlist[at]];
  const url = (photo, thumb = false) => window.assetHref('/' + photo[0]
    + (thumb ? '/thumbs_dir/' : '/') + photo[1] + (thumb ? '_thumb.webp' : '.jpg'));

  function shuffled(list) {
    const result = [...new Set(list)].filter(i => data.items[i].p.length);
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
  function preloadNext() {
    if (playlist.length < 2) return;
    const upcoming = playlist[(at + 1) % playlist.length];
    const src = url(data.items[upcoming].p[viewFor(upcoming)]);
    if (preloads.has(src)) return;
    const next = new Image();
    next.src = src;
    preloads.set(src, next);
    if (preloads.size > 2) preloads.delete(preloads.keys().next().value);
  }
  function schedule() {
    clearTimeout(timer);
    if (!dialog.open || !playing || !ready || document.hidden) return;
    timer = setTimeout(() => step(1), -Number($('.slide-speed input').value) * 1000);
  }
  function setPlaying(value) {
    playing = value && playlist.length > 1;
    $('.slide-play').textContent = t(playing ? 'slide-pause' : 'slide-play');
    $('.slide-play').setAttribute('aria-pressed', String(playing));
    $('.slide-position').setAttribute('aria-live', playing ? 'off' : 'polite');
    schedule();
  }
  function labelControls() {
    dialog.querySelectorAll('[data-slide-label]').forEach(el => { el.textContent = t(el.dataset.slideLabel); });
    dialog.querySelectorAll('[data-slide-aria]').forEach(el => { el.setAttribute('aria-label', t(el.dataset.slideAria)); });
    setPlaying(playing);
  }
  function link(parent, href, label) {
    const a = document.createElement('a');
    a.href = window.documentHref(href);
    a.textContent = label;
    parent.append(a);
  }
  function describe() {
    const specimen = item();
    $('.slide-id').textContent = specimen.id;
    $('.slide-position').textContent = `${at + 1} / ${playlist.length}`;
    const taxa = $('.slide-taxa');
    taxa.replaceChildren();
    (specimen.t.length ? specimen.t : [null]).forEach((key, i) => {
      if (i) taxa.append(', ');
      link(taxa, key ? data.taxa[key].h : 'unclassified', taxonName(key));
    });
    $('.slide-age').textContent = specimen.a ? ageText(specimen.a) : '';
    const loc = data.localities[specimen.l];
    $('.slide-place').hidden = !loc;
    if (loc) {
      $('.slide-place').textContent = `${loc.flag || ''} ${placeName(specimen.l)}`.trim();
      $('.slide-place').href = window.documentHref(loc.h);
    }
    $('.slide-link').href = window.documentHref(specimen.h);
    $('.slide-views').hidden = specimen.p.length < 2;
    const thumbs = $('.slide-thumbnails');
    thumbs.replaceChildren();
    specimen.p.forEach((photo, i) => {
      if (specimen.p.length < 2) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('aria-label', `${t('slide-photo')} ${i + 1} / ${specimen.p.length}`);
      button.setAttribute('aria-pressed', String(i === view));
      const thumb = document.createElement('img');
      thumb.src = url(photo, true); thumb.alt = ''; thumb.loading = 'lazy';
      button.append(thumb);
      button.addEventListener('click', () => {
        setPlaying(false);
        view = i;
        thumbs.querySelectorAll('button').forEach((b, j) => b.setAttribute('aria-pressed', String(i === j)));
        showPhoto();
      });
      thumbs.append(button);
    });
    for (const selector of ['.slide-prev', '.slide-next', '.slide-play', '.slide-shuffle']) {
      $(selector).disabled = playlist.length < 2;
    }
  }
  function showPhoto() {
    const token = ++generation;
    const specimen = item(), index = playlist[at], photoIndex = view;
    ready = false;
    clearTimeout(timer);
    $('.slide-stage').setAttribute('aria-busy', 'true');
    $('.slide-error').hidden = true;
    $('.slide-caption').textContent = '';
    image.alt = (specimen.t.length ? specimen.t : [null]).map(taxonName).join(', ') + ` · ${specimen.id}`;
    image.src = url(specimen.p[view], true);
    const full = new Image();
    full.onload = () => {
      if (token !== generation || !dialog.open) return;
      image.src = full.src;
      ready = true;
      $('.slide-stage').setAttribute('aria-busy', 'false');
      preloadNext();
      schedule();
    };
    full.onerror = () => {
      if (token !== generation || !dialog.open) return;
      $('.slide-error').hidden = false;
      $('.slide-stage').setAttribute('aria-busy', 'false');
      setPlaying(false);
    };
    full.src = url(specimen.p[view]);
    captions().then(all => {
      if (token !== generation || !dialog.open) return;
      const caption = all[index] && all[index][photoIndex];
      const text = caption && (caption[lang()] || caption.en) || '';
      $('.slide-caption').textContent = text;
      if (text) image.alt = text;
    });
  }
  function showSpecimen() {
    view = viewFor(playlist[at]);
    $('.slide-content').scrollTop = 0;
    $('.slide-details').scrollTop = 0;
    describe();
    showPhoto();
  }
  function step(direction) {
    at = (at + direction + playlist.length) % playlist.length;
    showSpecimen();
  }
  function open() {
    if (dialog.open) return;
    playlist = shuffled(indices());
    if (!playlist.length) return;
    picked.clear();
    returnFocus = document.activeElement;
    beforeOpen();
    at = 0; playing = false;
    labelControls();
    dialog.showModal();
    window.overlayOpened(close);
    showSpecimen();
    $('.slide-close').focus();
  }
  function stop() {
    ++generation;
    setPlaying(false);
    ready = false;
    preloads.clear();
    window.overlayClosed();
    if (returnFocus && returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
  }
  function close() { if (dialog.open) dialog.close(); }
  // Native dialog gives us a focus trap and makes the canvas and header inert.
  dialog.addEventListener('close', stop);
  dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
  $('.slide-close').addEventListener('click', close);
  start.addEventListener('click', open);
  $('.slide-prev').addEventListener('click', () => step(-1));
  $('.slide-next').addEventListener('click', () => step(1));
  $('.slide-play').addEventListener('click', () => setPlaying(!playing));
  const speed = $('.slide-speed input');
  const speedText = () => {
    speed.setAttribute('aria-valuetext', `${-speed.value} s`);
    speed.style.setProperty('--fill', (speed.value - speed.min) / (speed.max - speed.min) * 100 + '%');
  };
  speedText();
  speed.addEventListener('input', speedText);
  speed.addEventListener('change', schedule);
  $('.slide-shuffle').addEventListener('click', () => {
    const previous = playlist[at];
    playlist = shuffled(playlist);
    if (playlist.length > 1 && playlist[0] === previous) playlist.push(playlist.shift());
    picked.clear();
    at = 0;
    showSpecimen();
  });
  dialog.addEventListener('keydown', e => {
    // Do not send gallery keys or search shortcuts to the canvas behind the dialog.
    e.stopPropagation();
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.matches('select, input')) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    if (e.key === ' ' && !e.target.closest('button, a')) { e.preventDefault(); setPlaying(!playing); }
  });
  let swipe = null;
  $('.slide-stage').addEventListener('pointerdown', e => { swipe = { x: e.clientX, y: e.clientY }; });
  $('.slide-stage').addEventListener('pointercancel', () => { swipe = null; });
  $('.slide-stage').addEventListener('pointerup', e => {
    if (swipe && Math.abs(e.clientX - swipe.x) > 50 && Math.abs(e.clientY - swipe.y) < 60) {
      step(e.clientX < swipe.x ? 1 : -1);
    }
    swipe = null;
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) setPlaying(false); });
  window.addEventListener('pagehide', () => { setPlaying(false); });
  function refresh() { start.disabled = !indices().some(i => data.items[i].p.length); }
  refresh();
  return {
    isOpen: () => dialog.open, refresh, open,
    relabel: () => { if (dialog.open) { labelControls(); describe(); showPhoto(); } },
  };
};
