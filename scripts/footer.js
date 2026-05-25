fetch(getBaseURL() + '/templates/footer.html')
  .then(response => response.text())
  .then(data => {
    waitForCondition(
      () => document.getElementById('footer-container'),
      () => {
        document.getElementById('footer-container').innerHTML = data;
      }
    );
  }).catch((err) => console.error(err));
