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
  let prefix = '.';
  // Determine how many levels to go up
  for (let i = 0; i < pathSegments.length - 1; i++) {
      prefix += '/..';
  }
  return prefix + absolutePath;
}

//language.js
var doc = document;
let navPathLoaded = false;
let docpath = "";
let globalDict = {};

const _LANGUAGES = ["el", "en", "grc"];

function getPathUnit(item_name, translated) {
    if (item_name == "home") {
        return capitalize(translated);
    } else {
      return "/ " + capitalize(translated);
    }
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
  
  // Function to apply the selected language to the page
  function applyLanguage(lang) {
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
                item = doc.getElementById('gallery-' + i);
                const translatedCaption = translations[lang]['gallery'][i-1];
                item.setAttribute('data-sub-html', translatedCaption);
            }

            // Re-initialize lightGallery
            initializeGallery();
        }

        // Ειδική περίπτωση για το μονοπάτι πλοήγησης
        if (navPathLoaded) {
          const pathElement = document.getElementById('navpath');
          pathElement.innerHTML = "";
          docpath.forEach((item, index) => {
            const translated = globalDict[lang][item.name];
            console.assert(translated, `Missing translation for ${item.name} in language '${lang}'.`)
            pathElement.innerHTML = pathElement.innerHTML + `<a href="${item.link}"> ${getPathUnit(item.name, translated)}</a>`;
          });
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
    });
}

// On page load, apply the selected language
window.addEventListener('DOMContentLoaded', () => {
  const lang = getLanguage();
  applyLanguage(lang);
});

window.addEventListener('headerLoaded', () => {
  // Add event listeners to the language buttons
  const enButton = document.getElementById('en-button');
  enButton.innerHTML = "<div class=\"container\"><div><image src=\"" + getRelativePath("/images/flags/UK.png") + "\" width=20></image></div><div class=\"lang-button\">English </div></div>"
  enButton.addEventListener('click', () => {
    setLanguage('en');
  });
  
  const elButton = document.getElementById('el-button')
  elButton.innerHTML = "<div class=\"container\"><div><image src=\"" + getRelativePath("/images/flags/GR.png") + "\" width=20></image></div><div class=\"lang-button\">Ελληνικά </div></div>"
  elButton.addEventListener('click', () => {
    setLanguage('el');
  });

  const grcButton = document.getElementById('grc-button')
  grcButton.innerHTML = "<div class=\"container\"><div><image src=\"" + getRelativePath("/images/flags/GRC.png") + "\" width=40></image></div><div class=\"lang-button\">Ἑλληνική ἀρχαία </div></div>"
  grcButton.addEventListener('click', () => {
    setLanguage('grc');
  });
});

fetch(getBaseURL() + "/jsondata/dict.json")
  .then((response) => response.json()
  .then((jsondict) => {
      globalDict = jsondict;
      window.addEventListener('navPathLoaded', () => {
      const pathElement = document.getElementById('navpath');
      docpath = pathElement.path;
      navPathLoaded = true;
      applyLanguage(getLanguage());
    });
  }));
