fetch(getBaseURL() + '/templates/footer.html')
  .then(response => response.text())
  .then(data => {
    waitForCondition(
      () => document.getElementById('footer-container'),
      () => {
        document.getElementById('footer-container').innerHTML = data;
        const credits = document.getElementById('footer-credits-link');
        if (credits) credits.href = getBaseURL() + '/acknowledgements.html';
      }
    );
  }).catch((err) => console.error(err));
