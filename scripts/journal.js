function updateLanguage(lang, file_path) {
    // load the appropriate language file or set text content based on the lang parameter
    document.documentElement.lang = lang;
    // language file for foo.html is foo-[lang].html
    // path should start from the server root
    localised_file = file_path.replace('.html', `-${lang}.html`);
    // Fetch html content (utf-8)
    fetch("/"+localised_file)
        .then(response => {
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            return response.text();
        })
        .then(data => {
            const paste_div = document.getElementById('paste-point');
            paste_div.innerHTML = data;
            if (file_path === "gallery.html") {
                // trigger gallery reload
                const reloadElem = document.createElement('div');
                reloadElem.id = 'gallery-reload';
                document.body.appendChild(reloadElem);
            }
            // make the header visible
            const header = document.getElementById("header-container");
            header.style.display = "";
        })
        .catch(error => {
            console.error('There has been a problem with your fetch operation:', error);
        });
}


// read file dir from script arguments
const scriptElement = document.getElementById('journal-script');
const filePath = scriptElement.getAttribute('file_path');
updateLanguage(getLanguage(), filePath);
waitForCondition(
  () => document.getElementById('header-top'),
  () => {
    // Add event listeners to the language buttons
    document.querySelectorAll('#language-menu li').forEach(item => {
      item.addEventListener('click', () => {
        const selectedLang = item.getAttribute('data-lang');
        updateLanguage(selectedLang, filePath);
      });
    })
});