function updateLanguage(lang) {
    // load the appropriate language file or set text content based on the lang parameter
    document.documentElement.lang = lang;
    // language file for foo.html is foo-[lang].html
    // path should start from the server root
    const journal_file_path = window.location.pathname.split('/journal/')[1];
    localised_file = "/journal/" + journal_file_path.replace('.html', `-${lang}.html`);
    // Fetch html content (utf-8)
    fetch(localised_file)
        .then(response => {
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            return response.text();
        })
        .then(data => {
            const paste_div = document.getElementById('paste-point');
            paste_div.innerHTML = data;
        })
        .catch(error => {
            console.error('There has been a problem with your fetch operation:', error);
        });
}

updateLanguage(getLanguage());
waitForCondition(
  () => document.getElementById('header-top'),
  () => {
    // Add event listeners to the language buttons
    document.querySelectorAll('#language-menu li').forEach(item => {
      item.addEventListener('click', () => {
        const selectedLang = item.getAttribute('data-lang');
        updateLanguage(selectedLang);
      });
    })
});