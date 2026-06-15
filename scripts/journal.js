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
            // Parse the localised file and inject only its content. Localised
            // files keep their own header-container/footer-container/cookie-banner
            // so they remain viewable standalone, but those nodes would shadow
            // the populated chrome already in the shell. Strip them here.
            const parsed = new DOMParser().parseFromString(data, 'text/html');
            parsed.body.querySelectorAll('#header-container, #footer-container, #cookie-banner').forEach(el => el.remove());
            const paste_div = document.getElementById('paste-point');
            paste_div.innerHTML = parsed.body.innerHTML;
            // Injected <script> tags don't execute, so wire up the lightGallery
            // for the freshly-pasted journal images from the shell instead.
            if (window.initJournalGallery) {
                window.initJournalGallery();
            }
            if (file_path === "gallery.html") {
                // trigger gallery reload
                const reloadElem = document.createElement('div');
                reloadElem.id = 'gallery-reload';
                document.body.appendChild(reloadElem);
            }
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