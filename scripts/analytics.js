function setConsent(consent) {
  localStorage.setItem('cookie_consent_date', new Date().toISOString());
  localStorage.setItem('cookie_consent', consent ? 'accepted' : 'declined');
  document.getElementById('cookie-banner').style.display = 'none';
  if (consent) {
    loadAnalytics();
  }
}

function loadAnalytics() {
  // Google Analytics script injection
  const script1 = document.createElement('script');
  script1.setAttribute('async', '');
  script1.src = 'https://www.googletagmanager.com/gtag/js?id=G-D9K6HSR7J7';
  document.head.appendChild(script1);

  const script2 = document.createElement('script');
  script2.innerHTML = `
        window.dataLayer = window.dataLayer || [];
        function gtag(){dataLayer.push(arguments);}
        gtag('js', new Date());
        gtag('config', 'G-D9K6HSR7J7', {
          anonymize_ip: true
        });
    `;
  document.head.appendChild(script2);
}

// GoatCounter — cookieless, privacy-friendly visitor tracking. Loaded
// unconditionally (no consent gate needed) because it stores no cookies
// and collects no personal data. Feeds the counter on the homepage.
(function loadGoatCounter() {
  const gc = document.createElement('script');
  gc.dataset.goatcounter = 'https://tsioftas.goatcounter.com/count';
  gc.async = true;
  gc.src = '//gc.zgo.at/count.js';
  document.head.appendChild(gc);
})();

// cookie banner
const consent = localStorage.getItem('cookie_consent');
if (consent === null) {
  document.getElementById('cookie-banner').style.display = 'block';
} else {
  const consentDate = new Date(localStorage.getItem('cookie_consent_date'));
  const currentDate = new Date();
  // Check if consent was given more than 1 month ago
  const oneMonthInMilliseconds = 1000 * 60 * 60 * 24 * 30;
  if ((currentDate - consentDate) > oneMonthInMilliseconds) {
    document.getElementById('cookie-banner').style.display = 'block';
  } else if (consent === 'accepted') {
    loadAnalytics();
  }
}
