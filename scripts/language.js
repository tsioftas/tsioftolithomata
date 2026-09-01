// Memoize same-URL JSON fetches so shared data files (dict.json, taxa_icons.json, …)
// are downloaded once per page instead of by each script that needs them.
window.fetchJSONCached = window.fetchJSONCached || function (url) {
  window.__jsonCache = window.__jsonCache || {};
  return window.__jsonCache[url] || (window.__jsonCache[url] = fetch(url).then((r) => r.json()));
};

// Where this copy of the site begins.
//
// This used to be guessed from the hostname: a private IP or localhost meant the
// dev server on port 8000, anything else meant https://apolithomata.com. That is
// two assumptions — that production is only ever served from that one host, and
// that the site always sits at the root of it — and both are wrong for a
// deployment served from a subdirectory, such as a pull-request preview under
// /previews/pr-123/, where every link and fetch would escape into production.
//
// The generator already knows the answer for each page (root_relative_prefix in
// chrome_context) and writes it onto <html data-site-root>. Resolving that
// against the current document works on any host, at any depth, with no
// environment detection at all.
function siteRoot() {
  const declared = document.documentElement.dataset.siteRoot;
  try {
    return new URL(declared || './', window.location.href);
  } catch (e) {
    return new URL('/', window.location.href);
  }
}

const getBaseURL = () => siteRoot().href.replace(/\/$/, '');

// Companion to documentHref for things that exist once for the whole site: images,
// audio, stylesheets. They are never mirrored per language, so this just addresses
// them from the root.
//
// This replaces a getRelativePath() that counted the segments of location.pathname to
// build a ../ chain. That arithmetic assumed every page sat at a known depth, which
// stopped being true when the language mirrors added a directory: on /el/index.html it
// produced "/..images/…", the image 404'd, and the browser drew the alt text instead.
// Counting depth is what broke, so nothing counts depth any more.
function assetHref(path) {
  return siteUrl(String(path).replace(/^\/+/, ''));
}
window.assetHref = assetHref;

//language.js
var doc = document;
let navPathLoaded = false;
let navPath = null;
let globalDict = {};
let globalDictLoaded = false;

// Supported languages are defined once in jsondata/languages.json (shared with the
// Python site generator) and fetched at startup. languageCodes is exposed globally so
// other scripts (e.g. search.js) iterate the same list.
let languagesDict = {};
let languageCodes = [];
let languagesLoaded = false;

// A "partial" language (e.g. Cypriot) is still being translated; any string it is
// missing is rendered as its marker so the gaps are visible rather than silently
// falling back to another language.
function resolveTranslation(lang, dict, key) {
  if (dict && key in dict) return dict[key];
  if (languagesDict[lang] && languagesDict[lang].partial) {
    return languagesDict[lang].marker || "[αμετάφραστο]";
  }
  console.error("Missing translation for \"" + key + "\" in language '" + lang + "'");
  return "";
}

// Resolve a per-language value object (e.g. {el: ..., en: ..., grc: ...}) for `lang`,
// rendering the marker for a partial language that is missing the value.
function resolveValue(lang, obj) {
  if (obj && obj[lang]) return obj[lang];
  if (languagesDict[lang] && languagesDict[lang].partial) {
    return languagesDict[lang].marker || "[αμετάφραστο]";
  }
  return obj ? obj[lang] : "";
}

function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

// The language the page's HTML was generated in, or null for the language fragments
// that still arrive empty. While the visitor is reading in this language there is
// nothing for applyLanguage to write: the markup already says it.
const prerenderedLang = document.documentElement.dataset.prerenderedLang || null;

// Documents (taxa, localities, the homepage) exist once per language and say which one
// they are through their hreflang alternates: there the URL decides, and switching
// language means going to the sibling URL.
//
// Apps (the quiz, the map) and the gallery/journal shells have a single URL and no
// alternates, because navigating away would throw away quiz progress or map filters.
// There the stored preference decides and the page repaints in place.
const langFixedByUrl = document.querySelector('link[rel="alternate"][hreflang]') !== null;
const defaultLang = document.documentElement.dataset.defaultLang || 'en';

let languageOverridden = false;

// THE one way to build a link to a page from JavaScript. Documents exist once per
// language — the default at the site root, the rest mirrored under /<lang>/ — so a URL
// assembled by hand silently drops the reader back into English. Every script that
// builds a page link must go through this; pyscripts/check_page_links.py fails the
// build if one stops doing so.
//
// `path` is site-root-relative, with or without a leading slash
// ("/tree/animalia/animalia.html").
// `lang` overrides the language to link into; callers that already know it pass it,
// everyone else gets the one currently being read.
function documentHref(path, lang) {
  return siteUrl(languageDir(lang) + String(path).replace(/^\/+/, ''));
}
window.documentHref = documentHref;

// The directory a page of the current language lives in: "" for the default language,
// "el/" for the rest. The code comes off the DOM, so it is checked against the shape a
// language code actually has rather than trusted — see siteUrl for why that matters.
function languageDir(lang) {
  const code = lang || getLanguage();
  if (!code || code === defaultLang || !/^[a-z]{2,3}$/.test(code)) return '';
  return code + '/';
}

// Resolve a site-root-relative path against this copy of the site, and refuse anything
// that resolves outside it.
//
// Every input here ultimately comes out of the DOM — the language stamped on <html>, a
// link's data-doc-path, a locality's url from the embedded dataset — and pasting DOM
// text straight into an href is what CodeQL's js/xss-through-dom flags. Concatenating
// strings, a value like "javascript:alert(1)" or "//example.com" would have become a
// working link; resolving through the URL API and comparing origins cannot.
//
// The containment check is against siteRoot() rather than the bare origin, so a path
// containing "../" cannot climb out of a preview deployment and into production. On a
// site served from the root the two are the same test.
function siteUrl(relative) {
  const root = siteRoot();
  try {
    const url = new URL(relative, root);
    const contained = url.origin === root.origin && url.pathname.startsWith(root.pathname);
    return contained ? url.href : root.href;
  } catch (e) {
    return root.href;
  }
}

// Function to set the language
function setLanguage(lang) {
  localStorage.setItem('language', lang);
  // From here on the markup no longer matches what the generator wrote, so every
  // later applyLanguage has to do the full repaint even if the visitor switches back.
  languageOverridden = true;
  applyLanguage(lang);
  // Only the explicit-switch path goes through here; applyLanguage on page load
  // does not, so this measures deliberate switches, not the default language.
  trackEvent('language_changed', { language: lang });
}
  
function getLanguage() {
  // On a per-language document the URL is the authority: the reader is looking at
  // /el/tree/…/mollusca.html, so the language is Greek whatever localStorage says.
  // Everywhere else the stored preference decides, as it always did.
  if (langFixedByUrl) return prerenderedLang;
  return localStorage.getItem('language') || prerenderedLang || 'en';
}

// An age range or estimate in a unit that suits its size. Below a million years,
// "0.129-0.0117 million years ago" leaves the reader counting decimal places to
// work out the scale. The unit comes from the oldest bound so a range is never
// expressed in two units at once, and thousands are used rather than plain years
// so no thousands separator is needed — those differ by language.
//
// The site generator applies the same rule in Python (format_age_quantity); the
// two must agree, because the same age can be rendered by either.
function formatAgeQuantity(age, lang) {
  const oldest = "about" in age ? age["about"] : age["from"];
  if (oldest === undefined || oldest === null) return "";
  const thousands = oldest < 1;
  const unit = resolveTranslation(lang, globalDict[lang], thousands ? "kya" : "mya");
  const scale = thousands ? 1000 : 1;
  const q = (v) => String(Number((v * scale).toFixed(thousands ? 3 : 6)));
  return "about" in age
    ? `~${q(age["about"])} ${unit}`
    : `${q(age["from"])}–${q(age["to"])} ${unit}`;
}
window.formatAgeQuantity = formatAgeQuantity;

function constructTimeStr(age, lang) {
  let timeStr = "";
  if ("prefix" in age) {
    timeStr += `${capitalize(resolveTranslation(lang, globalDict[lang], age["prefix"]))} `;
  }
  timeStr += `${resolveTranslation(lang, globalDict[lang], age["period"])}, `;
  const quantity = formatAgeQuantity(age, lang);
  if (quantity) {
    timeStr += quantity;
  } else {
    console.error(`Invalid age format: ${JSON.stringify(age)}`);
    return ""; // Return empty string if age is invalid
  }
  return timeStr;
}

function constructLocalityStr(localityId, lang) {
  return fetch(getBaseURL() + `/jsondata/geochronology.json`)
  .then(response => response.json())
  .then(geochronology => {
    const localityData = geochronology["localities"][localityId];
    if (!localityData) {
      console.error(`No data found for locality ID: ${localityId}`);
      return localityId; // Return the ID if no data is found
    }
    const countryData = geochronology["countries"];
    const location = `${resolveValue(lang, localityData['name'])}, ${resolveValue(lang, countryData[localityData['country']]["name"])}`;
    const time = constructTimeStr(localityData['age'], lang);
    return `${location}. ${time}`
  })
  .catch(error => {
    console.error(`Error fetching geochronology data: ${error}`);
    return localityId; // Return the ID if an error occurs
  });
}
  
function updateLanguageDropdown(lang) {
  const lang_toggle = document.getElementById("language-toggle");
  const cfg = languagesDict[lang];
  if (lang_toggle !== null && cfg) {
    lang_toggle.innerHTML = `<img src="${getBaseURL() + "/images/flags/" + cfg.thumb}" width="20" alt="${cfg.alt}"> ${cfg.label} ▼`;
  }
}

function updatePageKeys(lang, translations, keys) {
  if (keys === "") return;
  keys.forEach(key => {
    const elem = doc.getElementById(key);
    if (!elem) {
      console.error("Missing element \"" + key + "\" from page");
      return;
    }
    if (key in translations[lang]) {
      elem.textContent = translations[lang][key];
    } else {
      elem.textContent = resolveTranslation(lang, globalDict[lang], key);
    }
  });
}

function updateGalleryCaptions(lang, translations, galleryLength) {
  if (galleryLength <= 0) return;
  for (let i = 1; i <= galleryLength; i++) {
    const item = doc.getElementById('gallery-img-' + i);
    item.setAttribute('data-sub-html', translations[lang]['gallery'][i - 1]);
  }
}

// Each specimen's lightGallery instance (taxon/locality pages) bakes the slide captions
// (subHtml) into its dynamicEl when it is first opened, so rewriting the data-sub-html
// attributes above does not reach an instance that was already created. Tear the cached
// instances down here; openGallery() rebuilds them from the fresh attributes on next open.
function resetLightGalleries() {
  doc.querySelectorAll('[id^="hidden-gallery-"]').forEach((el) => {
    if (el._lgInstance) {
      el._lgInstance.destroy();
      el._lgInstance = null;
    }
  });
}

// Fill the localized label on every "purchased" thumbnail badge. The badge markup is
// emitted language-neutral by the site generator; the label text comes from the shared
// dict.json key `acquisition-purchased` so it tracks the active language (and the partial
// language marker via resolveTranslation).
function updatePurchasedBadges(lang) {
  const badges = doc.querySelectorAll('.purchased-badge');
  if (!badges.length) return;
  const label = resolveTranslation(lang, globalDict[lang], 'acquisition-purchased');
  badges.forEach((badge) => {
    const labelEl = badge.querySelector('.purchased-badge-label');
    if (labelEl) labelEl.textContent = label;
    badge.title = label;
    badge.setAttribute('aria-label', label);
  });
}

function updateHeaderNav(lang) {
  // Home is an icon button: localize its label without clobbering the SVG.
  const homeBtn = document.getElementById('home-btn');
  if (homeBtn) {
    const homeLabel = resolveTranslation(lang, globalDict[lang], 'home');
    homeBtn.title = homeLabel;
    homeBtn.setAttribute('aria-label', homeLabel);
  }

  document.getElementById('map-btn').innerHTML = resolveTranslation(lang, globalDict[lang], 'map');
  document.getElementById('journal-btn').innerHTML = resolveTranslation(lang, globalDict[lang], 'journal');
  const quizBtn = document.getElementById('quiz-btn');
  if (quizBtn) quizBtn.innerHTML = resolveTranslation(lang, globalDict[lang], 'quiz');

  const treeHeading = document.getElementById('drawer-tree-heading');
  if (treeHeading) treeHeading.textContent = resolveTranslation(lang, globalDict[lang], 'tree-of-life');

  const pathElement = document.getElementById('navpath');
  pathElement.innerHTML = "";
  if (!navPath) return;
  const icons = window.TAXON_ICON_URLS || {};
  navPath.forEach((item, index) => {
    const translated = resolveTranslation(lang, globalDict[lang], item.name);
    if (index != 0) {
      const sep = document.createElement('span');
      sep.className = 'crumb-sep';
      sep.textContent = '›'; // ›
      pathElement.appendChild(sep);
    }

    const isLast = index === navPath.length - 1;
    const crumb = document.createElement(isLast ? 'span' : 'a');
    crumb.className = isLast ? 'crumb current' : 'crumb';
    if (!isLast) crumb.href = item.link;

    const iconUrl = icons[item.name];
    if (iconUrl) {
      const img = document.createElement('img');
      img.className = 'crumb-icon';
      img.src = iconUrl;
      img.alt = '';
      img.loading = 'lazy';
      crumb.appendChild(img);
    }
    const label = document.createElement('span');
    label.className = 'crumb-label';
    label.textContent = translated;
    crumb.appendChild(label);

    pathElement.appendChild(crumb);
  });
}

function updateSidebarTree(lang) {
  waitForCondition(
    () => document.getElementById('sidebar') && globalDictLoaded,
    () => {
      const sidebar = document.getElementById('sidebar');
      const traverse_fun = (root) => {
        if (!root) return;
        root.querySelectorAll('li').forEach((sidebarItem) => {
          const link = sidebarItem.querySelector('a');
          // link id is in the form of "tree-node-<id>"
          const id = link.id.replace('tree-node-', '');
          const translation = resolveTranslation(lang, globalDict[lang], id);
          // Update only the label span so the icon/count nodes survive language switches.
          const labelEl = link.querySelector('.node-label');
          const prefix = link.dataset.extinct === '1' ? '†' : '';
          labelEl.textContent = prefix + translation;
          const countEl = link.querySelector('.node-count');
          const count = Number(link.dataset.sampleCount || 0);
          if (countEl) {
            countEl.textContent = count > 0 ? String(count) : '';
            countEl.style.display = count > 0 ? '' : 'none';
          }
          if (root.ul) {
            traverse_fun(root.querySelector('ul'));
          }
        });
      };
      traverse_fun(sidebar.querySelector('div[id="tree-container"]').querySelector('ul'));
      sidebar.style.display = "block";
    }
  );
}

function updateSearchPlaceholder(lang) {
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.placeholder = resolveTranslation(lang, globalDict[lang], 'search-placeholder');
  }
}

// Point the chrome's links to per-language documents at the language being read.
// Only needed where the language is a stored preference rather than part of the URL:
// the quiz, the map, and the gallery/journal shells are rendered once, in the default
// language, so without this their footer and home links would always land on English.
function updateDocumentLinks(lang) {
  if (langFixedByUrl) return;
  doc.querySelectorAll('[data-doc-path]').forEach((el) => {
    el.href = documentHref(el.dataset.docPath, lang);
  });
}

function updateFooter(lang) {
  const footer_elements = ["footer-name", "footer-source", "footer-credits", "footer-cookies"];
  waitForCondition(
    () => document.getElementById(footer_elements[0]),
    () => {
      for (const elem_id of footer_elements) {
        document.getElementById(elem_id).innerText = resolveTranslation(lang, globalDict[lang], elem_id);
      }
    }
  );
}

function updateRandomSampleTitle(lang) {
  const titleElem = document.getElementById('τυχαίο-δείγμα-τίτλος');
  if (!titleElem || !titleElem.dataset.unprocessedTitle) return;
  const randomTitle = titleElem.dataset.unprocessedTitle;
  titleElem.textContent = titleElem.dataset.extinct === '1' ? "†" : "";
  titleElem.textContent += resolveTranslation(lang, globalDict[lang], randomTitle);
}

function updateLocalityStrings(lang) {
  doc.querySelectorAll('[id^="locality-"]').forEach((locality) => {
    const localityId = locality.id.replace('locality-', '');
    constructLocalityStr(localityId, lang).then((locality_str) => {
      locality.innerText = locality_str;
    });
  });
}

function updateCookieBanner(lang) {
  const cookieBanner = doc.getElementById('cookie-banner');
  if (!cookieBanner) return;
  // Required elements (always present in the banner template).
  const required = ["cookie-banner-text", "cookie-banner-accept", "cookie-banner-decline"];
  // Optional elements (injected only when the banner actually shows).
  const optional = ["cookie-banner-learn-more"];
  required.forEach((subelem) => {
    const elem = doc.getElementById(subelem);
    if (!elem) {
      console.error(`Missing element with id ${subelem}`);
      return;
    }
    elem.textContent = resolveTranslation(lang, globalDict[lang], subelem);
  });
  optional.forEach((subelem) => {
    const elem = doc.getElementById(subelem);
    if (!elem) return;  // silently skip when not present
    if (subelem in globalDict[lang]) elem.textContent = globalDict[lang][subelem];
  });
}

function applyLanguage(lang) {
  document.documentElement.lang = lang;
  updateLanguageDropdown(lang);

  const thisScript = document.getElementById('language-script');
  const dictPath = thisScript.getAttribute('dict');
  let keys = thisScript.getAttribute('keys');
  if (keys !== "") {
    keys = keys.split(',');
  }
  const galleryLength = Number(thisScript.getAttribute('galleryLength'));

  // Page text, breadcrumbs, header labels, search placeholder and footer are written
  // into the HTML by the site generator. Re-writing them with identical strings costs
  // a visible breadcrumb rebuild, so skip those while the rendered language still
  // stands. Everything else below is built client-side and always has to run.
  const alreadyRendered = !languageOverridden && lang === prerenderedLang;

  // A page with no dict path has nothing to fetch: the taxon and locality pages say so,
  // because their JSON is a build-time input now rather than a runtime one. Everything
  // it used to carry is in the markup — the strings through prefill_translations, and
  // the gallery captions in data-sub-html — and the language of those pages cannot
  // change without leaving them, so downloading it, 84 kB on the largest, only arrived
  // at the page as already rendered.
  const pageDict = dictPath
    ? fetch(getBaseURL() + dictPath).then(response => response.json())
    : Promise.resolve({});

  pageDict
    .then(translations => {
      if (!alreadyRendered) updatePageKeys(lang, translations, keys);
      if (dictPath) updateGalleryCaptions(lang, translations, galleryLength);
      resetLightGalleries();
      updatePurchasedBadges(lang);
      if (navPathLoaded && globalDictLoaded) {
        if (!alreadyRendered) updateHeaderNav(lang);
        updateSidebarTree(lang);
      }
      updateDocumentLinks(lang);
      if (!alreadyRendered) {
        updateSearchPlaceholder(lang);
        updateFooter(lang);
      }
      updateRandomSampleTitle(lang);
      updateLocalityStrings(lang);
      updateCookieBanner(lang);
    });
}

// On page load, apply the selected language
window.addEventListener('DOMContentLoaded', () => {
  const lang = getLanguage();
  applyLanguage(lang);
});

function waitForCondition(checkFn, callback, {
  interval = 200,
  timeout = 5000
} = {}) {
  const start = Date.now();

  const timer = setInterval(() => {
    if (checkFn()) {
      clearInterval(timer);
      callback();
    } else if (Date.now() - start > timeout) {
      clearInterval(timer);
      console.warn('waitForCondition: Timeout exceeded');
    }
  }, interval);
}

waitForCondition(
  () => doc.getElementById('header-top') && languagesLoaded,
  () => {
    const curr_lang = getLanguage();

    // Prepare breadcrumbs(navpath) for translation
    navPathLoaded = true;
    applyLanguage(curr_lang);

    // Prepare language selection dropdown options. A per-language page ships the menu
    // already built, as real links to its sibling URLs; only the shells need it here.
    const language_menu = document.getElementById("language-menu");
    const menuIsPrerendered = language_menu.querySelector('a[hreflang]') !== null;
    if (!menuIsPrerendered) {
      language_menu.innerHTML = Object.entries(languagesDict).reduce(
        (accumulator, [current_key, current_dict]) => {
          return accumulator
            + `    <li data-lang="${current_key}">\n`
            + `        <img src="${getBaseURL() + "/images/flags/" + current_dict.thumb}" width="20" alt="${current_dict.alt}"> ${current_dict.label}\n`
            + `    </li>\n`;
        },
        ""
      );
    }

    const toggleBtn = document.getElementById('language-toggle');
    toggleBtn.addEventListener('click', () => {
      language_menu.style.display = language_menu.style.display === 'block' ? 'none' : 'block';
    });

    // Add event listeners to the language buttons. Where the menu is prerendered the
    // entries are links, so the browser does the navigating; all we do is remember the
    // choice, which is what the redirect in <head> reads on the next page.
    document.querySelectorAll('#language-menu li').forEach(item => {
      item.addEventListener('click', () => {
        const selectedLang = item.getAttribute('data-lang');
        language_menu.style.display = 'none';
        if (menuIsPrerendered) {
          localStorage.setItem('language', selectedLang);
          trackEvent('language_changed', { language: selectedLang });
        } else {
          setLanguage(selectedLang);
        }
      });
    });

    // Hide menu if clicking outside
    document.addEventListener('click', (e) => {
      if (!toggleBtn.contains(e.target) && !language_menu.contains(e.target)) {
        language_menu.style.display = 'none';
      }
    });
  }
);

fetch(getBaseURL() + "/jsondata/languages.json")
  .then((response) => response.json())
  .then((langs) => {
    languagesDict = langs;
    languageCodes = Object.keys(langs);
    languagesLoaded = true;
    applyLanguage(getLanguage());
  });

// Every name a page can put on screen, in one lookup: taxon names come from
// taxonomy.json (via the generated taxa_names.json) and the interface from dict.json.
// Anything resolving a taxon out of dict.json alone goes blind to every taxon added
// since the names moved, which is how the search box stopped finding them, so this is
// the only place either file is read.
function fetchGlobalDict() {
  return Promise.all([
    fetchJSONCached(getBaseURL() + "/jsondata/dict.json"),
    fetchJSONCached(getBaseURL() + "/jsondata/taxa_names.json").catch(() => ({})),
  ]).then(([jsondict, taxaNames]) => {
    const merged = {};
    for (const lang in jsondict) {
      merged[lang] = Object.assign({}, taxaNames[lang], jsondict[lang]);
    }
    return merged;
  });
}

fetchGlobalDict().then((merged) => {
  globalDict = merged;
  globalDictLoaded = true;
  applyLanguage(getLanguage());
});
