let pages = [];

const headerLoadedEvt = new Event("headerLoaded")

fetch("http://tsioftas.github.io/tsioftolithomata/jsondata/pages.json").then((resp) => resp.json()).then((json) => {
    pages = json["pages"];
}).catch((err) => console.error(err));

// stolen from language.js
function getLanguage() {
  return localStorage.getItem('language') || 'el'; // Προεπιλεγμένη γλώσσα τα Ελληνικά
}

function pageToKey(page) {
  return page.name.toLowerCase().replace(" ", "_")
}

fetch('http://tsioftas.github.io/tsioftolithomata/templates/header.html')
  .then(response => response.text())
  .then(data => {
    document.getElementById('header-container').innerHTML = data;
    window.dispatchEvent(headerLoadedEvt)
    // search
    fetch('http://tsioftas.github.io/tsioftolithomata/jsondata/dict.json')
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
                  window.location.href = result.path;
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

