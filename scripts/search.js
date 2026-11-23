// Header search over taxa and localities. Forgives accents, breathings, case and small typos.

const SEARCH_MAX_RESULTS = 12;
const KEYWORD_WEIGHT = 0.6;

let searchEntries = [];

// Accents, breathings and final sigma vanish; vowels that sound alike in Modern Greek fold together.
function searchNormalize(s) {
  return s.normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/ς/g, "σ")
    .replace(/ου/g, "u")
    .replace(/([αε])υ/g, "$1β")
    .replace(/ει|οι|η|υ/g, "ι")
    .replace(/ω/g, "ο")
    .replace(/αι/g, "ε")
    .replace(/(.)\1/g, "$1");
}

function searchTokens(s) {
  return searchNormalize(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

// Damerau-Levenshtein distance of `a` against the closest prefix of `b`.
function prefixDistance(a, b) {
  const prev2 = new Array(b.length + 1).fill(0);
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        cur[j] = Math.min(cur[j], prev2[j - 2] + 1);
      }
    }
    prev2.splice(0, prev2.length, ...prev);
    prev = cur;
  }
  return Math.min(...prev);
}

// Score of one query token against one text token; 0 means no match.
function tokenScore(q, t) {
  if (t === q) return 100;
  if (t.startsWith(q)) return 90;
  if (q.length >= 3 && t.includes(q)) return 70;
  if (q.length < 4) return 0;
  const allowed = q.length >= 7 ? 2 : 1;
  const d = prefixDistance(q, t);
  return d <= allowed ? 60 - 15 * d : 0;
}

// Every query token must match some token of the text; the text scores their mean.
function textScore(queryTokens, textTokens) {
  let total = 0;
  for (const q of queryTokens) {
    let best = 0;
    for (const t of textTokens) best = Math.max(best, tokenScore(q, t));
    if (!best) return 0;
    total += best;
  }
  return total / queryTokens.length;
}

function prepareEntry(entry) {
  return {
    ...entry,
    nameTokens: Object.values(entry.names).map(searchTokens),
    keywordTokens: entry.keywords.map(searchTokens),
  };
}

function scoreEntry(entry, queryTokens) {
  let best = 0;
  for (const tokens of entry.nameTokens) best = Math.max(best, textScore(queryTokens, tokens));
  for (const tokens of entry.keywordTokens) {
    best = Math.max(best, KEYWORD_WEIGHT * textScore(queryTokens, tokens));
  }
  return best;
}

function searchIndex(query) {
  const queryTokens = searchTokens(query);
  if (!queryTokens.length) return [];
  return searchEntries
    .map((entry) => ({ entry, score: scoreEntry(entry, queryTokens) }))
    .filter((r) => r.score > 0)
    // On a tie a place wins: a query that names a country or region is most likely after one.
    .sort((a, b) => b.score - a.score || (b.entry.kind === 'locality') - (a.entry.kind === 'locality'))
    .slice(0, SEARCH_MAX_RESULTS)
    .map((r) => r.entry);
}

const SEARCH_PIN_SVG = '<svg class="search-result-icon search-result-pin" viewBox="0 0 24 24" aria-hidden="true">'
  + '<path d="M12 21.5s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11z"/><circle cx="12" cy="10.2" r="2.6"/></svg>';

waitForCondition(
  () => document.getElementById('search-input'),
  () => {
    Promise.all([
      fetchJSONCached(getBaseURL() + '/jsondata/search_index.json'),
      fetchJSONCached(getBaseURL() + '/jsondata/taxa_icons.json').catch(() => ({})),
    ]).then(([index, taxaIcons]) => {
      searchEntries = index.entries.map(prepareEntry);
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
        trackEvent('search_select', { result_type: result.kind, path: result.path });
        window.location.href = documentHref(result.path);
      }

      function resultItem(result, i) {
        const li = document.createElement('li');
        const lang = getLanguage();
        let iconHTML;
        if (result.kind === 'locality') {
          iconHTML = SEARCH_PIN_SVG;
        } else if (taxaIcons[result.key]) {
          iconHTML = `<img class="search-result-icon" src="${taxaIcons[result.key]}" alt="" loading="lazy">`;
        } else {
          iconHTML = '<span class="search-result-icon-placeholder"></span>';
        }
        const label = document.createElement('span');
        label.textContent = resolveTranslation(lang, result.names, lang);
        li.innerHTML = iconHTML;
        li.appendChild(label);
        li.addEventListener('click', () => selectResult(result));
        li.addEventListener('mouseenter', () => setHighlight(i));
        return li;
      }

      searchInput.addEventListener('input', () => {
        const searchTerm = searchInput.value.trim();
        searchResults.innerHTML = '';
        currentResults = [];
        highlightedIndex = -1;

        if (searchNormalize(searchTerm).length < 2) {
          searchResults.style.display = 'none';
          return;
        }
        const results = searchIndex(searchTerm);

        // Debounced so we log committed searches, not every keystroke.
        // results_count === 0 surfaces searches that find nothing (collection gaps).
        clearTimeout(searchDebounce);
        searchDebounce = setTimeout(() => {
          trackEvent('search', { search_term: searchTerm.toLowerCase(), results_count: results.length });
        }, 800);

        if (!results.length) {
          searchResults.style.display = 'none';
          return;
        }
        currentResults = results;
        searchResults.style.display = 'block';
        results.forEach((result, i) => searchResults.appendChild(resultItem(result, i)));
        setHighlight(0);
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
