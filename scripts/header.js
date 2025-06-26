let pages = [];

const headerLoadedEvt = new Event("headerLoaded")

fetch(getBaseURL() + "/jsondata/pages.json").then((resp) => resp.json()).then((json) => {
    pages = json["pages"];
}).catch((err) => console.error(err));

// stolen from language.js
function getLanguage() {
  return localStorage.getItem('language') || 'el'; // Προεπιλεγμένη γλώσσα τα Ελληνικά
}

function pageToKey(page) {
  return page.name.toLowerCase().replace(" ", "_")
}

// Function to construct the navigation path from window.location.pathname
function getPath() {
  const offset = get_env() == 'dev' ? 2 : 3; // how many elements to skip in the path
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
async function loadTaxonomyTree(taxonomyData) {

  const container = document.getElementById('tree-container');

  function buildTree(node, taxonPath = '') {
    const ul = document.createElement('ul');
    for (const [key, value] of Object.entries(node.subtaxa || {})) {
      // TODO
      const count = 0;
      // const count = sampleCounts[key] || 0; 
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.dataset.icon = getBaseURL() + `/images/thumbnails/thumbs_dir/${capitalize(value.name.el)}_thumb.webp`;
      a.href = `${taxonPath}/${key}/${key}.html`;
      a.textContent = `${value.name?.en || key}`;
      if(count != 0) {
        a.textContent += ` (${count})`;
      }
      a.className = 'tree-node';
      li.appendChild(a);



      if (value.subtaxa) {
        li.appendChild(buildTree(value, `${taxonPath}/${key}`));
      }

      ul.appendChild(li);
    }
    return ul;
  }
  container.appendChild(buildTree({"subtaxa": taxonomyData}, getBaseURL() + '/tree'));
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
  
  console.log("scrolling");
  const header = document.getElementById('header-container');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');

  const headerRect = header.getBoundingClientRect();

  // Clamp to viewport: headerRect.bottom is where the header *visually* ends
  const headerBottom = Math.max(0, Math.min(headerRect.bottom, window.innerHeight));

  sidebar.style.top = `${headerBottom}px`;
  sidebar.style.height = `calc(100vh - ${headerBottom}px - 0.5em)`;

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
  if (!document.getElementById('sidebar').classList.contains('collapsed')) {
    updateSidebarLayout();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSidebar();
});

fetch(getBaseURL() + '/templates/header.html')
  .then(response => response.text())
  .then(data => {
    // insert header html into page
    document.getElementById('header-container').innerHTML = data;
    // sidebar
    fetch(getBaseURL() + '/jsondata/taxonomy.json')
      .then((resp) => resp.json()
        .then(json => loadTaxonomyTree(json)
      )
    );
    // prepare home button
    const homeBtn = document.getElementById("home-btn");
    homeBtn.href = getBaseURL();

    // set the navpath/breadcrumbs
    const pathElement = document.getElementById('navpath');
    pathElement.path = getPath();
    if(pathElement.path.length > 0) {
      pathElement.style.display = "flex";
    }
    window.dispatchEvent(headerLoadedEvt);
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

