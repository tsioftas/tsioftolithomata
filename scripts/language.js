// environment
const get_env = () => {
    return window.location.hostname === 'localhost' ? 'dev' : 'prod';
}

const getBaseURL = () => {
    return get_env() === 'dev' ? 'http://localhost:8000' : 'https://tsioftas.github.io/tsioftolithomata';
}

const getRelativePath = (absolutePath) => {
  const currentPath = window.location.pathname;
  const pathSegments = currentPath.split('/').filter(segment => segment); // Split and remove empty segments

  let dots = '';

  // Determine how many levels to go up
  for (let i = 0; i < pathSegments.length - 1; i++) {
      dots += '../';
  }

  return dots + absolutePath;
}

//language.js
var doc = document;
let navPathLoaded = false;
let docpath = "";
let globalDict = {};

const _LANGUAGES = ["el", "en"];

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
              elem.textContent = translations[lang][key];
            } else {
              console.error("Missing element \"" + key + "\" from page")
            }
        })
        // Ειδική περίπτωση για την γκαλερί
        if (galleryLength > 0) {
            gallery = doc.getElementById('gallery').gal;
            for (let i = 1; i <= galleryLength; i++) {
                item = doc.getElementById('gallery-' + i);
                const translatedCaption = translations[lang]['gallery'][i-1];
                item.setAttribute('data-sub-html', translatedCaption);
            }

            // Destroy the existing lightGallery instance
            gallery.destroy();

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
