let pages = [];

const headerLoadedEvt = new Event("headerLoaded")

fetch(getBaseURL() + "/jsondata/pages.json").then((resp) => resp.json()).then((json) => {
    pages = json["pages"];
}).catch((err) => console.error(err));

// ΧXX: stolen from language.js. need to update both functions for changes
function getLanguage() {
  return localStorage.getItem('language') || 'en'; // Προεπιλεγμένη γλώσσα τα Αγγλικά
}

function pageToKey(page) {
  return page.name.toLowerCase().replace(" ", "_")
}

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
      }
  });
}

// sidebar
let taxonomyData = null;
let samplesData = null;

async function loadTaxonomyTree(taxData, samples) {
  if (taxonomyData === null) taxonomyData = taxData;
  if (samplesData === null) samplesData = samples;
  if (taxonomyData === null || samplesData === null) return;

  const container = document.getElementById("tree-container");
  container.innerHTML = ""; // avoid duplicates if called again

  function sampleCountForTaxonKey(key) {
    return Object.keys(samplesData).filter((sampleId) => {
      const sample = samplesData[sampleId];
      const lt = sample.lowest_taxa;
      return Array.isArray(lt) ? lt.includes(key) : lt === key;
    }).length;
  }

  function buildTree(node, taxonPath = "") {
    const ul = document.createElement("ul");

    for (const [key, value] of Object.entries(node.subtaxa || {})) {
      const hasChildren = !!(value && value.subtaxa && Object.keys(value.subtaxa).length);
      const count = sampleCountForTaxonKey(key);

      const li = document.createElement("li");
      li.classList.add("tree-item");
      if (hasChildren) li.classList.add("has-children");
      // default collapse logic
      // 1. if in the parent path of the current page, expand
      const currentPath = window.location.href;
      if (currentPath.startsWith(taxonPath + `/${key}/`)) {
        // part of the current path, expand
      } else if (taxonPath != getBaseURL() + "/tree") {
        // else expand top-level nodes only
        li.classList.add("is-collapsed"); // default to collapsed
      }

      // toggle button (only for nodes with children)
      let toggleBtn = null;
      if (hasChildren) {
        toggleBtn = document.createElement("button");
        toggleBtn.type = "button";
        toggleBtn.className = "tree-toggle";
        toggleBtn.setAttribute("aria-label", "Expand/collapse");
        toggleBtn.setAttribute("aria-expanded", "true");
        li.appendChild(toggleBtn);
      } else {
        // spacer to align nodes that do not have a toggle
        const spacer = document.createElement("span");
        spacer.className = "tree-toggle-spacer";
        li.appendChild(spacer);
      }

      // link
      const a = document.createElement("a");
      a.dataset.icon = getBaseURL() + `/images/thumbnails/thumbs_dir/${capitalize(value.name.el)}_thumb.webp`;
      a.href = `${taxonPath}/${key}/${key}.html`;
      a.id = `tree-node-${key}`;
      a.className = "tree-node";
      a.count = count;
      a.extinct = value.extinct || false;

      const label = (value.name?.en || key) + (count ? ` (${count})` : "");
      a.textContent = label;

      li.appendChild(a);

      // children
      if (hasChildren) {
        const childUl = buildTree(value, `${taxonPath}/${key}`);
        childUl.classList.add("tree-children");
        li.appendChild(childUl);
      }

      ul.appendChild(li);
    }

    return ul;
  }

  container.appendChild(buildTree({ subtaxa: taxonomyData }, getBaseURL() + "/tree"));

  // Event delegation for toggles
  container.addEventListener("click", (e) => {
    const btn = e.target.closest(".tree-toggle");
    if (!btn) return;

    const li = btn.closest("li");
    const childUl = li.querySelector(":scope > ul.tree-children");
    if (!childUl) return;

    const isCollapsed = li.classList.toggle("is-collapsed");
    btn.setAttribute("aria-expanded", String(!isCollapsed));
  });
}


document.addEventListener('mouseover', function (e) {
  if (!e.target.classList.contains('tree-node')) return;

  const iconUrl = e.target.dataset.icon;
  if (!iconUrl) return;

  const img = document.createElement('img');
  const imgsize = 100;
  img.src = iconUrl;
  img.style.position = 'fixed';
  img.style.width = `${imgsize}px`;
  img.style.height = `${imgsize}px`;
  img.style.objectFit = 'contain';
  img.style.border = '1px solid #ccc';
  img.style.background = '#fff';
  img.style.zIndex = 9999;
  img.classList.add('hover-icon-preview');

  // Get viewport dimensions
  const padding = 10;
  const { clientX, clientY } = e;
  const maxX = window.innerWidth - imgsize - padding;
  const maxY = window.innerHeight - imgsize - padding;

  img.style.left = `${Math.min(clientX + 10, maxX)}px`;
  img.style.top = `${Math.min(clientY + 10, maxY)}px`;

  document.body.appendChild(img);

  e.target.addEventListener('mouseleave', () => {
    document.querySelectorAll('.hover-icon-preview').forEach(el => el.remove());
  }, { once: true });
});


function updateSidebarLayout() {
  const header = document.getElementById('header-container');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');

  const headerRect = header.getBoundingClientRect();

  // Clamp to viewport: headerRect.bottom is where the header *visually* ends
  const headerBottom = Math.max(0, Math.min(headerRect.bottom, window.innerHeight));

  sidebar.style.top = `${headerBottom}px`;
  sidebar.style.height = `calc(100vh - ${headerBottom}px - 2em)`;

  const sidebarWidth = sidebar.offsetWidth;

  overlay.style.left = `${sidebarWidth}px`;
  overlay.style.width = `calc(100% - ${sidebarWidth}px)`;
  overlay.style.top = `${headerBottom}px`;
  overlay.style.height = `calc(100vh - ${headerBottom}px)`;
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  const isOpening = sidebar.classList.contains('collapsed');

  if (isOpening) updateSidebarLayout();

  sidebar.classList.toggle('collapsed');
  overlay.classList.toggle('hidden', sidebar.classList.contains('collapsed'));
}

function closeSidebar() {
  document.getElementById('sidebar').classList.add('collapsed');
  document.getElementById('sidebar-overlay').classList.add('hidden');
}

window.addEventListener('resize', () => {
  if (!document.getElementById('sidebar').classList.contains('collapsed')) {
    updateSidebarLayout();
  }
});

window.addEventListener('scroll', () => {
  const sidebar = document.getElementById('sidebar');
  if (sidebar && !sidebar.classList.contains('collapsed')) {
    updateSidebarLayout();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSidebar();
});

// for cookies
function setConsent(consent) {
    localStorage.setItem('cookie_consent_date', new Date().toISOString());
    localStorage.setItem('cookie_consent', consent ? 'accepted' : 'declined');
    document.getElementById('cookie-banner').style.display = 'none';
    if (consent) {
        loadAnalytics();
    }
}

function loadAnalytics() {
    // Google Analytics script injection
    const script1 = document.createElement('script');
    script1.setAttribute('async', '');
    script1.src = 'https://www.googletagmanager.com/gtag/js?id=G-D9K6HSR7J7';
    document.head.appendChild(script1);

    const script2 = document.createElement('script');
    script2.innerHTML = `
        window.dataLayer = window.dataLayer || [];
        function gtag(){dataLayer.push(arguments);}
        gtag('js', new Date());
        gtag('config', 'G-D9K6HSR7J7', {
          anonymize_ip: true
        });
    `;
    document.head.appendChild(script2);
}

fetch(getBaseURL() + '/templates/header.html')
  .then(response => response.text())
  .then(data => {
    // insert header html into page
    document.getElementById('header-container').innerHTML = data;
    // cookie banner
    const consent = localStorage.getItem('cookie_consent');
    if (consent === null) {
        document.getElementById('cookie-banner').style.display = 'block';
    } else {
      const consentDate = new Date(localStorage.getItem('cookie_consent_date'));
      const currentDate = new Date();
      // Check if consent was given more than 1 month ago
      const oneMonthInMilliseconds = 1000 * 60 * 60 * 24 * 30;
      if ((currentDate - consentDate) > oneMonthInMilliseconds) {
        document.getElementById('cookie-banner').style.display = 'block';
      } else if (consent === 'accepted') {
        loadAnalytics();
      }
    }

    // sidebar
    fetch(getBaseURL() + '/jsondata/taxonomy.json')
      .then((resp) => resp.json()
        .then(json => loadTaxonomyTree(json, null)
      )
    );
    fetch(getBaseURL() + '/jsondata/samples_info.json')
      .then((resp) => resp.json()
        .then(json => loadTaxonomyTree(null, json)
      )
    );
    // prepare header buttons
    const homeBtn = document.getElementById("home-btn");
    homeBtn.href = getBaseURL();
    const mapBtn = document.getElementById("map-btn");
    mapBtn.href = getBaseURL() + "/map.html";

    // set the navpath/breadcrumbs
    const pathElement = document.getElementById('navpath');
    
    const pathParts = window.location.pathname.split('/');
    if (!pathParts.includes('tree')) {
        if(navpath) {
            navpath.style.display = "none";
        }
    } else {
      pathElement.path = getPath();
      if(pathElement.path.length > 0) {
        pathElement.style.display = "flex";
      }
    }
    // search
    fetch(getBaseURL() + '/jsondata/dict.json')
      .then(response => response.json())
      .then(translateDict => {
        const searchInput = document.getElementById('search-input');
        const searchResults = document.getElementById('search-results');
        searchInput.addEventListener('input', () => {
          const searchTerm = searchInput.value.toLowerCase();
          searchResults.innerHTML = ''; 
      
          if (searchTerm.length >= 3) {
            const results = pages.filter(page => {
              const key = pageToKey(page);
              return _LANGUAGES.map((lang) => {
                const translation = translateDict[lang][key];
                console.assert(translation, `Missing translation for '${key}' in language '${lang}'.`);
                return translation.toLowerCase();
              }).some((s) => s.includes(searchTerm))
            });
        
            if (results.length > 0) {
              searchResults.style.display = 'block';
              results.forEach(result => {
                const li = document.createElement('li');
                const siteLanguage = getLanguage();
                li.textContent = translateDict[siteLanguage][pageToKey(result)];
                li.addEventListener('click', () => {
                  window.location.href = getBaseURL() + result.path;
                });
                searchResults.appendChild(li);
              });
            } else {
              searchResults.style.display = 'none';
            }
          } else {
            searchResults.style.display = 'none';
          }
        });
    });
});

