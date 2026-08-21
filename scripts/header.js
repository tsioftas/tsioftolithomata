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
    link: documentHref('tree/' + names.slice(0, index + 1).join('/') + '/' + item + '.html'),
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
