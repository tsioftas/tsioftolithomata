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
    return get_env() === 'dev' ? `http://${window.location.hostname}:8000` : 'https://tsioftas.github.io/tsioftolithomata';
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
  
// Function to get the language
function getLanguage() {
  return localStorage.getItem('language') || 'el'; // Προεπιλεγμένη γλώσσα τα Ελληνικά
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
  
// Function to apply the selected language to the page
function applyLanguage(lang) {
  // update dropdown default view
  const lang_toggle = document.getElementById("language-toggle");
  if(lang_toggle !== null) {
    lang_toggle.innerHTML = `<img src="${getBaseURL() + "/images/flags/" + languages_dict[lang].thumb}" width="20" alt="${languages_dict[lang].alt}"> ${languages_dict[lang].text} ▼`;
  }

  const thisScript = document.getElementById('language-script');
  dictPath = thisScript.getAttribute('dict');
  keys = thisScript.getAttribute('keys').split(',');
  galleryLength = Number(thisScript.getAttribute('galleryLength'));
  fetch(getBaseURL() + dictPath)
  .then(response => response.json())
  .then(translations => {
      keys.forEach(key => {
          const elem = doc.getElementById(key);
          if (elem) {
            if (key in translations[lang]) {
              elem.textContent = translations[lang][key];
            } else if (key in globalDict[lang]) {
              elem.textContent = globalDict[lang][key];
            } else {
              console.error("Missing translation for \"" + key + "\" in language '" + lang + "'");
            }
            if (elem.parentElement.classList.contains("description-text")) {
              // Ειδική περίπτωση για μεγάλες περιγραφές
              // θέλουμε μόνο το ένα από τα στοιχεία να ενεργοποιεί
              if (key.endsWith("-περιγραφή-1")) {
                const page_image = doc.getElementById(key + "-εικόνα");
                // Ειδική περίπτωση για την εικόνα της σελίδας, της οποίας το μέγεθος εξαρτάται από το μέγεθος της παραγράφου
                page_image.style.display = "block";
                page_image.style.visibility = "visible";
              }
            }
          } else {
            console.error("Missing element \"" + key + "\" from page")
          }
      })

      // Ειδική περίπτωση για την γκαλερί
      if (galleryLength > 0) {
          for (let i = 1; i <= galleryLength; i++) {
              item = doc.getElementById('gallery-img-' + i);
              const translatedCaption = translations[lang]['gallery'][i-1];
              item.setAttribute('data-sub-html', translatedCaption);
          }
      }

      // Ειδική περίπτωση για την κεφαλίδα (πλήκτρα πλοήγησης) + sidebar
      if (navPathLoaded && globalDictLoaded) {
        const homeBtn = document.getElementById('home-btn');
        homeBtn.innerHTML = globalDict[lang]['home']
        const mapBtn = document.getElementById('map-btn');
        mapBtn.innerHTML = globalDict[lang]['map']

        const pathElement = document.getElementById('navpath');
        pathElement.innerHTML = "";
        pathElement.path.forEach((item, index) => {
          const translated = globalDict[lang][item.name];
          console.assert(translated, `Missing translation for ${item.name} in language '${lang}'.`)
          if(index != 0) {
            pathElement.innerHTML += "<span>/</span>"
          }
          pathElement.innerHTML = pathElement.innerHTML + `<a href="${item.link}">${translated}</a>`;
        });
        const sidebar = document.getElementById('sidebar');
        if(sidebar) {
          const traverse_fun = (root) => {
            if(!root) return;
            // for each li child of root
            root.querySelectorAll('li').forEach((sidebarItem) => {
              const link = sidebarItem.querySelector('a');
              // link id is in the form of "tree-node-<id>"
              const id = link.id.replace('tree-node-', '');
              const translation = globalDict[lang][id];
              console.assert(translation, `Missing translation for ${id} in language '${lang}'.`);
              link.textContent = globalDict[lang][id];
              if (link.count > 0) {
                link.textContent += ` (${link.count}🦴)`;
              }
              if (link.extinct) {
                link.textContent = "†" + link.textContent;
              }
              if(root.ul) {
                // not a leaf node
                traverse_fun(root.querySelector('ul'));
              }
            });
          }
          traverse_fun(sidebar.querySelector('div[id="tree-container"]').querySelector('ul'));
        }
      }

      // Ειδική περίπτωση για το κουτί αναζήτησης
      const searchInput = document.getElementById('search-input');
      if (searchInput) {
        searchInput.placeholder = globalDict[lang]['search-placeholder'];
      }

      // Υποσέλιδο      
      if ('footer-name' in globalDict[lang]) {
        const footerName = document.getElementById('footer-name');  
        footerName.innerText = globalDict[lang]['footer-name'];
      } else {
        console.error(`Missing translation for footer-name in language '${lang}'.`);
      }

      // Τυχαίο δείγμα
      const randomSampleTitleElement = document.getElementById('τυχαίο-δείγμα-τίτλος');
      if (randomSampleTitleElement && "unprocessed_title" in randomSampleTitleElement) {
        let randomTitle = randomSampleTitleElement.unprocessed_title;
        console.assert(randomTitle in globalDict[lang], `Missing translation for ${randomTitle} in ${lang}`);
        randomSampleTitleElement.textContent = "";
        if(randomSampleTitleElement.extinct) {
          randomSampleTitleElement.textContent = "†";
        }
        randomSampleTitleElement.textContent += globalDict[lang][randomTitle];
      }

      // Τοποθεσίες δειγμάτων
      const allElems = doc.querySelectorAll('*');
      allElems.forEach((elem) => {
        if (!elem.id || !elem.id.startsWith('locality-')) {
          return;
        }
        const locality = elem;
        const localityId = locality.id.replace('locality-', '');
        constructLocalityStr(localityId, lang).then((locality_str) => {
          console.log(locality_str);
          locality.innerText = locality_str;
        });
      });
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
