// Function to construct the navigation path from window.location.pathname
function getPath() {
  const raw_path = window.location.pathname;
  const path = raw_path.split('/');
  if (raw_path != '/' && raw_path != '/tsioftolithomata/') {
    const file = path.pop();
    console.assert(file.endsWith(".html"), `Path (${path}) should be to .html file`);
  } else {
    path.pop(); // Remove the last element which is an empty string / not needed
  }
  // A page in a language mirror is at /el/tree/…, so its first segment is the language
  // directory rather than a taxon. Taken from the page's own stamp, which is exact,
  // instead of guessing from a list of codes.
  const pageLang = document.documentElement.dataset.prerenderedLang;
  const siteDefault = document.documentElement.dataset.defaultLang || 'en';
  const names = path.filter((item) => item != '' && item != 'tree'
                                      && item != 'tsioftolithomata'
                                      && !(pageLang && pageLang !== siteDefault && item === pageLang));
  return names.map((item, index) => ({
    name: item,
    // documentHref keeps the trail inside the language being read.
    link: documentHref('tree/' + names.slice(0, index + 1).join('/') + '/' + item),
  }));
}

// Fill phylopic icons into already-rendered breadcrumbs (handles the case where
// the icon data finishes loading after the crumbs were first painted).
function decorateBreadcrumbIcons() {
  const pathElement = document.getElementById('navpath');
  if (!pathElement || typeof navPath === 'undefined' || !navPath) return;
  const icons = window.TAXON_ICON_URLS || {};
  pathElement.querySelectorAll('.crumb').forEach((crumb, i) => {
    if (crumb.querySelector('.crumb-icon')) return;
    const url = icons[navPath[i] && navPath[i].name];
    if (!url) return;
    const img = document.createElement('img');
    img.className = 'crumb-icon';
    img.src = url;
    img.alt = '';
    img.loading = 'lazy';
    crumb.insertBefore(img, crumb.firstChild);
  });
}

// Per-taxon phylopic icons, shared with search/explore. Used to decorate breadcrumbs.
if (!window.TAXON_ICON_URLS) {
  fetchJSONCached(getBaseURL() + '/jsondata/taxa_icons.json')
    .then(icons => { window.TAXON_ICON_URLS = icons; decorateBreadcrumbIcons(); })
    .catch(() => { window.TAXON_ICON_URLS = window.TAXON_ICON_URLS || {}; });
}

// Record the trail for the current page so a language switch can re-label the
// breadcrumbs. Whether they are shown, and what they say, is decided by the generator
// and is already in the HTML: this must not touch either, or the trail would depend on
// JavaScript again.
function initNavPath() {
  if (!document.getElementById('navpath')) return;
  if (!window.location.pathname.split('/').includes('tree')) return;
  navPath = getPath();
}

// Generated pages ship the header already rendered (see chrome_context in the site
// generator), so there is no fetch and no headerless first paint. The fetch below is
// the fallback for the language fragments under journal/ and the gallery-<lang> files,
// which are viewable standalone and still carry an empty #header-container.
function headerAlreadyRendered() {
  return !!document.querySelector('#header-container header');
}

if (headerAlreadyRendered()) {
  initNavPath();
} else {
  fetch(getBaseURL() + '/templates/header.html')
    .then(response => response.text())
    .then(data => {
      waitForCondition(
        () => document.getElementById('header-container'),
        () => {
          if (headerAlreadyRendered()) {
            initNavPath();
            return;
          }
          document.getElementById('header-container').innerHTML = data;
          initNavPath();
        }
      );
    });
}

// ── Header behaviour ─────────────────────────────────────────────────────────
(function () {
  const header = document.getElementById('site-header');
  if (!header) return;

  // The section the reader is in, marked in the primary navigation.
  const path = window.location.pathname.replace(/\.html$/, '');
  const section = /\/gallery(-\w+)?$/.test(path) ? 'gallery'
    : /\/map$/.test(path) ? 'map'
    : /\/quiz$/.test(path) ? 'quiz'
    : /\/journal\//.test(path) ? 'journal'
    : /\/tree\//.test(path) ? 'tree'
    : null;
  if (section) {
    header.querySelectorAll(`[data-nav="${section}"]`).forEach((el) => {
      el.classList.add('is-current');
      if (el.tagName === 'A') el.setAttribute('aria-current', 'page');
    });
  }

  // Narrow screens keep the search field folded behind an icon.
  const toggle = document.getElementById('search-toggle');
  const input = document.getElementById('search-input');
  const setSearchOpen = (open) => {
    header.classList.toggle('search-open', open);
    if (toggle) toggle.setAttribute('aria-expanded', String(open));
    if (open && input) input.focus();
  };
  if (toggle) toggle.addEventListener('click', () => setSearchOpen(!header.classList.contains('search-open')));
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && header.classList.contains('search-open')) setSearchOpen(false);
    });
    input.addEventListener('blur', () => {
      // Late enough for a tap on a result to land first.
      setTimeout(() => {
        if (!header.contains(document.activeElement) && !input.value) setSearchOpen(false);
      }, 200);
    });
  }

  // "/" jumps to the search field, as on most catalogues.
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (!input) return;
    e.preventDefault();
    if (window.getComputedStyle(input).visibility === 'hidden' || input.offsetParent === null) setSearchOpen(true);
    else input.focus();
  });

  // The header rests flat on the page and lifts once the page moves under it. On a
  // phone it also steps aside while reading down and returns on the way back up.
  const narrow = window.matchMedia('(max-width: 760px)');
  let lastY = window.scrollY;
  let ticking = false;
  const onScroll = () => {
    const y = window.scrollY;
    header.classList.toggle('is-scrolled', y > 4);
    const busy = header.classList.contains('search-open')
      || document.documentElement.classList.contains('drawer-open')
      || header.contains(document.activeElement);
    if (narrow.matches && !busy && y > 160 && y > lastY + 4) header.classList.add('is-tucked');
    else if (y < lastY - 4 || y <= 160 || busy) header.classList.remove('is-tucked');
    lastY = y;
    ticking = false;
  };
  window.addEventListener('scroll', () => {
    if (!ticking) { ticking = true; requestAnimationFrame(onScroll); }
  }, { passive: true });
  onScroll();
})();
