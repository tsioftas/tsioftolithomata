// Site chrome: the search palette, drawer triggers, header state and the marks
// that say which page the reader is on. Loaded last on every page.
(function () {
  'use strict';
  const root = document.documentElement;

  // The bar gains its hairline (and, on the homepage, its ground) once the page moves.
  const onScroll = () => root.classList.toggle('is-scrolled', window.scrollY > 8);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  // Current page: exact match, or anywhere inside the journal.
  const norm = (p) => decodeURI(p).replace(/\.html$/, '').replace(/\/index$/, '/');
  const here = norm(location.pathname);
  document.querySelectorAll('[data-nav]').forEach((a) => {
    const there = norm(a.pathname);
    const inside = a.dataset.nav === 'journal' && here.startsWith(there);
    if (here === there || inside) a.setAttribute('aria-current', 'page');
  });

  // ── Search palette ──
  const palette = document.getElementById('search-palette');
  const input = document.getElementById('search-input');
  let returnFocus = null;

  function openSearch() {
    if (!palette || !palette.hidden) return;
    if (typeof closeSidebar === 'function') closeSidebar();
    returnFocus = document.activeElement;
    palette.hidden = false;
    root.classList.add('palette-open');
    input.focus({ preventScroll: true });
    input.select();
  }

  function closeSearch() {
    if (!palette || palette.hidden) return;
    palette.hidden = true;
    root.classList.remove('palette-open');
    if (returnFocus && returnFocus.focus) returnFocus.focus({ preventScroll: true });
  }
  window.openSearch = openSearch;
  window.closeSearch = closeSearch;

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-open-search]')) {
      e.preventDefault();
      openSearch();
    } else if (e.target.closest('[data-close-search]')) {
      closeSearch();
    } else if (e.target.closest('[data-open-drawer]')) {
      e.preventDefault();
      closeSearch();
      if (typeof toggleSidebar === 'function') toggleSidebar();
    }
  });

  document.addEventListener('keydown', (e) => {
    const el = document.activeElement;
    const typing = el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
    if ((e.key === '/' && !typing) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) {
      if (root.classList.contains('collection-open')) return;
      e.preventDefault();
      openSearch();
    } else if (e.key === 'Escape') {
      closeSearch();
    } else if (e.key === 'Tab' && palette && !palette.hidden) {
      // Keep focus inside the dialog.
      const items = palette.querySelectorAll('input, button, a[href], li');
      const focusable = Array.from(items).filter((n) => n.offsetParent !== null && n.tagName !== 'LI');
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && el === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && el === last) { e.preventDefault(); first.focus(); }
    }
  });

  // Picking a result navigates away; leave the palette closed if the page comes back from bfcache.
  window.addEventListener('pageshow', () => { if (palette) { palette.hidden = true; root.classList.remove('palette-open'); } });
})();
