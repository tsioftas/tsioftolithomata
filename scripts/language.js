// environment
const isPrivateIP = (ip) => {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) return false;

  const [a, b] = parts;

  return (
    a === 10 || // 10.x.x.x
    (a === 172 && b >= 16 && b <= 31) || // 172.16.x.x - 172.31.x.x
    (a === 192 && b === 168) || // 192.168.x.x
    a === 127 // loopback 127.x.x.x
  );
}

const is_local = (hostname) => {
  return hostname === "localhost" || isPrivateIP(hostname)
}

const get_env = () => {
    return is_local(window.location.hostname) ? 'dev' : 'prod';
}

const getBaseURL = () => {
    return get_env() === 'dev' ? `http://${window.location.hostname}:8000` : 'https://apolithomata.com';
}

const getRelativePath = (absolutePath) => {
  const currentPath = window.location.pathname;
  const pathSegments = currentPath.split('/').filter(segment => segment && segment !== "tsioftolithomata"); // Split and remove empty segments
  let prefix = '';
  // Determine how many levels to go up
  for (let i = 0; i < pathSegments.length - 1; i++) {
      prefix += '/..';
  }
  return prefix + absolutePath;
}

//language.js
var doc = document;
let navPathLoaded = false;
let navPath = null;
let globalDict = {};
let globalDictLoaded = false;

const _LANGUAGES = ["el", "en", "grc"];
const languages_dict = {
    "el": {
      "thumb": "GR_thumb.png",
      "alt": "Greek",
      "text": "Ελληνικά"
    },
    "en": {
      "thumb": "UK_thumb.png",
      "alt": "English",
      "text": "English"
    },
    "grc": {
      "thumb": "GRC_thumb.png",
      "alt": "Ancient Greek",
      "text": "Ἑλληνική ἀρχαία"
    }
  };  

function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

// Function to set the language
function setLanguage(lang) {
  localStorage.setItem('language', lang);
  applyLanguage(lang);
}
  
function getLanguage() {
  return localStorage.getItem('language') || 'en';
}

function constructTimeStr(age, lang) {
  let timeStr = "";
  if ("prefix" in age) {
    console.assert(age["prefix"] in globalDict[lang], `Missing translation for '${age["prefix"]}' in language '${lang}'.`);
    timeStr += `${capitalize(globalDict[lang][age["prefix"]])} `;
  }
  console.assert(age["period"] in globalDict[lang], `Missing translation for '${age["period"]}' in language '${lang}'.`);
  timeStr += `${globalDict[lang][age["period"]]}, `;
  if ("about" in age) {
    timeStr += `~${age["about"]} ${globalDict[lang]["mya"]}`;
  } else if ("from" in age && "to" in age) {
    timeStr += `${age["from"]}-${age["to"]} ${globalDict[lang]["mya"]}`;
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
    const location = `${localityData['name'][lang]}, ${countryData[localityData['country']]["name"][lang]}`;
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
  if (lang_toggle !== null) {
    lang_toggle.innerHTML = `<img src="${getBaseURL() + "/images/flags/" + languages_dict[lang].thumb}" width="20" alt="${languages_dict[lang].alt}"> ${languages_dict[lang].text} ▼`;
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
    } else if (key in globalDict[lang]) {
      elem.textContent = globalDict[lang][key];
    } else {
      console.error("Missing translation for \"" + key + "\" in language '" + lang + "'");
    }
    if (elem.parentElement.classList.contains("description-text")) {
      // Ειδική περίπτωση για μεγάλες περιγραφές: μόνο το ένα από τα στοιχεία ενεργοποιεί την εικόνα
      if (key.endsWith("-περιγραφή-1")) {
        const page_image = doc.getElementById(key + "-εικόνα");
        page_image.style.display = "block";
        page_image.style.visibility = "visible";
      }
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

function updateHeaderNav(lang) {
  document.getElementById('home-btn').innerHTML = globalDict[lang]['home'];
  document.getElementById('map-btn').innerHTML = globalDict[lang]['map'];
  document.getElementById('journal-btn').innerHTML = globalDict[lang]['journal'];

  const pathElement = document.getElementById('navpath');
  pathElement.innerHTML = "";
  if (!navPath) return;
  navPath.forEach((item, index) => {
    const translated = globalDict[lang][item.name];
    console.assert(translated, `Missing translation for ${item.name} in language '${lang}'.`);
    if (index != 0) {
      pathElement.innerHTML += "<span>/</span>";
    }
    pathElement.innerHTML = pathElement.innerHTML + `<a href="${item.link}">${translated}</a>`;
  });
}

function updateSidebarTree(lang) {
  waitForCondition(
    () => document.getElementById('sidebar'),
    () => {
      const sidebar = document.getElementById('sidebar');
      const traverse_fun = (root) => {
        if (!root) return;
        root.querySelectorAll('li').forEach((sidebarItem) => {
          const link = sidebarItem.querySelector('a');
          // link id is in the form of "tree-node-<id>"
          const id = link.id.replace('tree-node-', '');
          const translation = globalDict[lang][id];
          console.assert(translation, `Missing translation for ${id} in language '${lang}'.`);
          link.textContent = globalDict[lang][id];
          const count = Number(link.dataset.sampleCount || 0);
          if (count > 0) {
            link.textContent += ` (${count}🦴)`;
          }
          if (link.dataset.extinct === '1') {
            link.textContent = "†" + link.textContent;
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
    searchInput.placeholder = globalDict[lang]['search-placeholder'];
  }
}

function updateFooter(lang) {
  const footer_elements = ["footer-name", "footer-source"];
  waitForCondition(
    () => document.getElementById(footer_elements[0]),
    () => {
      for (const elem_id of footer_elements) {
        if (elem_id in globalDict[lang]) {
          document.getElementById(elem_id).innerText = globalDict[lang][elem_id];
        } else {
          console.error(`Missing translation for ${elem_id} in language '${lang}'.`);
        }
      }
    }
  );
}

function updateRandomSampleTitle(lang) {
  const titleElem = document.getElementById('τυχαίο-δείγμα-τίτλος');
  if (!titleElem || !titleElem.dataset.unprocessedTitle) return;
  const randomTitle = titleElem.dataset.unprocessedTitle;
  console.assert(randomTitle in globalDict[lang], `Missing translation for ${randomTitle} in ${lang}`);
  titleElem.textContent = titleElem.dataset.extinct === '1' ? "†" : "";
  titleElem.textContent += globalDict[lang][randomTitle];
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
  const subelements = ["cookie-banner-text", "cookie-banner-accept", "cookie-banner-decline"];
  subelements.forEach((subelem) => {
    const elem = doc.getElementById(subelem);
    if (!elem) {
      console.error(`Missing element with id ${subelem}`);
      return;
    }
    console.assert(subelem in globalDict[lang], `Missing translation for ${subelem} in language '${lang}'.`);
    elem.textContent = globalDict[lang][subelem];
  });
}

function applyLanguage(lang) {
  updateLanguageDropdown(lang);

  const thisScript = document.getElementById('language-script');
  const dictPath = thisScript.getAttribute('dict');
  let keys = thisScript.getAttribute('keys');
  if (keys !== "") {
    keys = keys.split(',');
  }
  const galleryLength = Number(thisScript.getAttribute('galleryLength'));

  fetch(getBaseURL() + dictPath)
    .then(response => response.json())
    .then(translations => {
      updatePageKeys(lang, translations, keys);
      updateGalleryCaptions(lang, translations, galleryLength);
      if (navPathLoaded && globalDictLoaded) {
        updateHeaderNav(lang);
        updateSidebarTree(lang);
      }
      updateSearchPlaceholder(lang);
      updateFooter(lang);
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
  () => doc.getElementById('header-top'),
  () => {
    const curr_lang = getLanguage();

    // Prepare breadcrumbs(navpath) for translation
    navPathLoaded = true;
    applyLanguage(curr_lang);

    // Prepare language selection dropdown options
    const language_menu = document.getElementById("language-menu");
    language_menu.innerHTML = Object.entries(languages_dict).reduce(
      (accumulator, [current_key, current_dict]) => {
        return accumulator
          + `    <li data-lang="${current_key}">\n`
          + `        <img src="${getBaseURL() + "/images/flags/" + current_dict.thumb}" width="20" alt="${current_dict.alt}"> ${current_dict.text}\n`
          + `    </li>\n`;
      },
      ""
    );

    const toggleBtn = document.getElementById('language-toggle');
    toggleBtn.addEventListener('click', () => {
      language_menu.style.display = language_menu.style.display === 'block' ? 'none' : 'block';
    });

    // Add event listeners to the language buttons
    document.querySelectorAll('#language-menu li').forEach(item => {
      item.addEventListener('click', () => {
        const selectedLang = item.getAttribute('data-lang');
        language_menu.style.display = 'none';
        setLanguage(selectedLang);
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

fetch(getBaseURL() + "/jsondata/dict.json")
  .then((response) => response.json()
  .then((jsondict) => {
    globalDict = jsondict;
    globalDictLoaded = true;
    applyLanguage(getLanguage());
  }));
