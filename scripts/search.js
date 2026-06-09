let pages = [];

fetch(getBaseURL() + "/jsondata/pages.json")
  .then((resp) => resp.json())
  .then((json) => { pages = json["pages"]; })
  .catch((err) => console.error(err));

function pageToKey(page) {
  return page.name.toLowerCase().replace(" ", "_");
}

waitForCondition(
  () => document.getElementById('search-input'),
  () => {
    Promise.all([
      fetchJSONCached(getBaseURL() + '/jsondata/dict.json'),
      fetchJSONCached(getBaseURL() + '/jsondata/taxa_icons.json').catch(() => ({})),
    ]).then(([translateDict, taxaIcons]) => {
      const searchInput = document.getElementById('search-input');
      const searchResults = document.getElementById('search-results');

      let currentResults = [];
      let highlightedIndex = -1;
      let searchDebounce;

      function setHighlight(idx) {
        const items = searchResults.querySelectorAll('li');
        items.forEach((el, i) => el.classList.toggle('highlighted', i === idx));
        highlightedIndex = idx;
        if (idx >= 0 && items[idx]) {
          items[idx].scrollIntoView({ block: 'nearest' });
        }
      }

      function closeDropdown() {
        searchResults.style.display = 'none';
        searchResults.innerHTML = '';
        currentResults = [];
        highlightedIndex = -1;
      }

      function selectResult(result) {
        const resultType = result.path.startsWith('/tree/') ? 'taxon'
          : result.path.startsWith('/localities/') ? 'locality' : 'page';
        trackEvent('search_select', { result_type: resultType, path: result.path });
        window.location.href = getBaseURL() + result.path;
      }

      searchInput.addEventListener('input', () => {
        const searchTerm = searchInput.value.toLowerCase();
        searchResults.innerHTML = '';
        currentResults = [];
        highlightedIndex = -1;

        if (searchTerm.length >= 3) {
          const results = pages.filter(page => {
            const key = pageToKey(page);
            return languageCodes.map((lang) => {
              const translation = translateDict[lang] && translateDict[lang][key];
              return translation ? translation.toLowerCase() : "";
            }).some((s) => s.includes(searchTerm));
          });

          // Debounced so we log committed searches, not every keystroke.
          // results_count === 0 surfaces searches that find nothing (collection gaps).
          clearTimeout(searchDebounce);
          searchDebounce = setTimeout(() => {
            trackEvent('search', { search_term: searchTerm, results_count: results.length });
          }, 800);

          if (results.length > 0) {
            currentResults = results;
            searchResults.style.display = 'block';
            const siteLanguage = getLanguage();
            results.forEach((result, i) => {
              const li = document.createElement('li');
              const key = pageToKey(result);
              const label = translateDict[siteLanguage][key];
              const iconUrl = taxaIcons[key];
              const iconHTML = iconUrl
                ? `<img class="search-result-icon" src="${iconUrl}" alt="" loading="lazy">`
                : `<span class="search-result-icon-placeholder"></span>`;
              li.innerHTML = `${iconHTML}<span>${label}</span>`;
              li.addEventListener('click', () => selectResult(result));
              li.addEventListener('mouseenter', () => setHighlight(i));
              searchResults.appendChild(li);
            });
            setHighlight(0);
          } else {
            searchResults.style.display = 'none';
          }
        } else {
          searchResults.style.display = 'none';
        }
      });

      searchInput.addEventListener('keydown', (e) => {
        if (searchResults.style.display === 'none' || currentResults.length === 0) {
          if (e.key === 'Escape') {
            closeDropdown();
            e.preventDefault();
          }
          return;
        }
        switch (e.key) {
          case 'ArrowDown':
            setHighlight(Math.min(currentResults.length - 1, highlightedIndex + 1));
            e.preventDefault();
            break;
          case 'ArrowUp':
            setHighlight(Math.max(0, highlightedIndex - 1));
            e.preventDefault();
            break;
          case 'Enter':
            if (highlightedIndex >= 0 && currentResults[highlightedIndex]) {
              selectResult(currentResults[highlightedIndex]);
              e.preventDefault();
            }
            break;
          case 'Escape':
            closeDropdown();
            e.preventDefault();
            break;
        }
      });
    });
  }
);
