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
          document.getElementById('footer-container').innerHTML = data;
          const credits = document.getElementById('footer-credits-link');
          if (credits) credits.href = getBaseURL() + '/acknowledgements.html';
          const cookies = document.getElementById('footer-cookies-link');
          if (cookies) cookies.href = getBaseURL() + '/cookies.html';
        }
      );
    }).catch((err) => console.error(err));
}
