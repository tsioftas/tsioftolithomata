// Function to construct the navigation path from window.location.pathname
function getPath() {
  const offset = 2; // how many elements to skip in the path
  const raw_path = window.location.pathname;
  const path = raw_path.split('/');
  if (raw_path != '/' && raw_path != '/tsioftolithomata/') {
    const file = path.pop();
    console.assert(file.endsWith(".html"), `Path (${path}) should be to .html file`);
  } else {
    path.pop(); // Remove the last element which is an empty string / not needed
  }
  return path.filter((item) => item != '' && item != 'tree' && item != 'tsioftolithomata').map((item, index) => {
    return {
      name: item,
      link: path.slice(0, index + offset).join('/') + '/' + item + '/' + item + '.html'
    };
  });
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
  fetch(getBaseURL() + '/jsondata/taxa_icons.json')
    .then(r => r.json())
    .then(icons => { window.TAXON_ICON_URLS = icons; decorateBreadcrumbIcons(); })
    .catch(() => { window.TAXON_ICON_URLS = window.TAXON_ICON_URLS || {}; });
}

fetch(getBaseURL() + '/templates/header.html')
  .then(response => response.text())
  .then(data => {
    waitForCondition(
      () => document.getElementById('header-container'),
      () => {
        document.getElementById('header-container').innerHTML = data;
        document.getElementById("home-btn").href = getBaseURL();
        document.getElementById("map-btn").href = getBaseURL() + "/map.html";
        document.getElementById("journal-btn").href = getBaseURL() + "/journal/index.html";
        document.getElementById("quiz-btn").href = getBaseURL() + "/quiz.html";

        const pathElement = document.getElementById('navpath');
        const pathParts = window.location.pathname.split('/');
        if (!pathParts.includes('tree')) {
          if (pathElement) {
            pathElement.style.display = "none";
          }
        } else {
          navPath = getPath();
          if (navPath.length > 0) {
            pathElement.style.display = "flex";
          }
        }
      }
    );
  });
