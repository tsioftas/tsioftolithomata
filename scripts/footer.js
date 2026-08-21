// Generated pages ship the footer already rendered (see chrome_context in the site
// generator), so there is nothing to fetch. The fetch below is the fallback for the
// language fragments under journal/ and the gallery-<lang> files, which are viewable
// standalone and still carry an empty #footer-container.
function footerAlreadyRendered() {
  const container = document.getElementById('footer-container');
  return !!(container && container.querySelector('footer'));
}

if (!footerAlreadyRendered()) {
  fetch(getBaseURL() + '/templates/footer.html')
    .then(response => response.text())
    .then(data => {
      waitForCondition(
        () => document.getElementById('footer-container'),
        () => {
          if (footerAlreadyRendered()) return;
          // The fetched copy already carries its links, and their data-doc-path lets
          // updateDocumentLinks() point them at the language being read, so there is
          // nothing to set here.
          document.getElementById('footer-container').innerHTML = data;
          if (typeof updateDocumentLinks === 'function') updateDocumentLinks(getLanguage());
        }
      );
    }).catch((err) => console.error(err));
}
