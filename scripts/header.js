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
  const offset = get_env() == 'dev' ? 1 : 2; // how many elements to skip in the path
  const raw_path = window.location.pathname;
  const path = raw_path.split('/');
  if (raw_path != '/' && raw_path != '/tsioftolithomata/') {
      const file = path.pop();
      console.assert(file.endsWith(".html"), `Path (${path}) should be to .html file`);
  } else {
      path.pop(); // Remove the last element which is an empty string / not needed
  }
  return path.filter((item) => item != 'tree' && item != 'tsioftolithomata').map((item, index) => {
      if (item == '') {
          return {
              name: "home",
              link: getBaseURL(),
          }
      }
      else {
          return {
              name: item,
              link: path.slice(0, index + offset).join('/') + '/' + item + '/' + item + '.html'
          }
      }
  });
}

fetch(getBaseURL() + '/templates/header.html')
  .then(response => response.text())
  .then(data => {
    // insert header html into page
    document.getElementById('header-container').innerHTML = data;
    // set the navpath/breadcrumbs
    const pathElement = document.getElementById('navpath');
    pathElement.path = getPath();
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

