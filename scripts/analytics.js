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

// cookie banner — hidden entirely on the dedicated /cookies.html page,
// since that page already covers everything the banner offers (and more).
// Wait for DOMContentLoaded because some templates load this script before
// the banner div, so document.getElementById would return null otherwise.
function initCookieBanner() {
  const onCookiesPage = /\/cookies\.html(?:[?#]|$)/.test(location.pathname);

  function showBanner() {
    if (onCookiesPage) return;
    const banner = document.getElementById('cookie-banner');
    if (!banner) return;
    banner.style.display = 'block';
    if (!document.getElementById('cookie-banner-learn-more')) {
      const base = (typeof getBaseURL === 'function') ? getBaseURL() : '';
      const link = document.createElement('a');
      link.id = 'cookie-banner-learn-more';
      link.href = base + '/cookies.html';
      link.style.marginLeft = '0.6em';
      link.style.color = '#9ec1ea';
      link.style.fontSize = '0.9em';
      banner.insertBefore(link, document.getElementById('cookie-banner-accept'));
    }
  }

  const consent = localStorage.getItem('cookie_consent');
  if (consent === null) {
    showBanner();
  } else {
    const consentDate = new Date(localStorage.getItem('cookie_consent_date'));
    const currentDate = new Date();
    const oneMonthInMilliseconds = 1000 * 60 * 60 * 24 * 30;
    if ((currentDate - consentDate) > oneMonthInMilliseconds) {
      showBanner();
    } else if (consent === 'accepted') {
      loadAnalytics();
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCookieBanner);
} else {
  initCookieBanner();
}
