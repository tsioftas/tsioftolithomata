// share.js — page-level and per-specimen sharing.
// Uses the native share sheet (navigator.share) when available, otherwise
// copies the link to the clipboard and shows a brief toast.
// Also focuses + highlights a specimen when the URL carries a #sample-<id> hash.

// Fallback labels for when globalDict (dict.json) has not loaded yet.
const SHARE_LABELS = {
  el: { 'link-copied': 'Ο σύνδεσμος αντιγράφηκε', 'share-page': 'Κοινοποίηση', 'share-sample': 'Κοινοποίηση δείγματος' },
  en: { 'link-copied': 'Link copied', 'share-page': 'Share', 'share-sample': 'Share specimen' },
  grc: { 'link-copied': 'Ὁ σύνδεσμος ἀντεγράφη', 'share-page': 'Κοινῶσαι', 'share-sample': 'Κοινῶσαι τὸ δεῖγμα' }
};

function shareLabel(key) {
  const lang = (typeof getLanguage === 'function') ? getLanguage() : 'en';
  if (typeof globalDict === 'object' && globalDict[lang] && key in globalDict[lang]) {
    return globalDict[lang][key];
  }
  return (SHARE_LABELS[lang] && SHARE_LABELS[lang][key]) || SHARE_LABELS.en[key] || key;
}

function showToast(msg) {
  let toast = document.getElementById('share-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'share-toast';
    toast.className = 'share-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  // Force a reflow so re-triggering restarts the transition.
  void toast.offsetWidth;
  toast.classList.add('share-toast-visible');
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => toast.classList.remove('share-toast-visible'), 2500);
}

// The standard "share" glyph (Material). Inherits colour via currentColor.
const SHARE_ICON_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"/></svg>';

// Last-resort copy for browsers without the async Clipboard API (e.g. pages
// served over plain http, where navigator.clipboard/navigator.share are absent).
function legacyCopy(url) {
  const ta = document.createElement('textarea');
  ta.value = url;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '-1000px';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    showToast(shareLabel('link-copied'));
  } catch (e) {
    window.prompt(shareLabel('link-copied'), url);
  }
  document.body.removeChild(ta);
}

function shareLink(url, title) {
  if (typeof trackEvent === 'function') trackEvent('share', { url: url });
  if (navigator.share) {
    navigator.share({ title: title, url: url }).catch(() => {});
    return;
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url)
      .then(() => showToast(shareLabel('link-copied')))
      .catch(() => legacyCopy(url));
    return;
  }
  legacyCopy(url);
}

// Absolute URL pointing at a specific specimen on the current page.
// The "gallery=1" marker tells the recipient's page to auto-open the lightbox;
// "img=<n>" selects the slide that was open when sharing (omitted for the
// first image to keep URLs clean). Random-sample links carry neither, so they
// only scroll + highlight.
function canonicalSampleUrl(sampleId, imgIndex) {
  let url = window.location.origin + window.location.pathname + '?gallery=1';
  if (imgIndex) url += '&img=' + imgIndex;
  return url + '#sample-' + sampleId;
}

// Inject a share button into the lightGallery toolbar that shares a deep link
// to the open specimen. `elem` is the hidden-gallery container passed to lightGallery.
function attachLightboxShare(elem, sampleId) {
  if (!elem || !sampleId || elem._shareBound) return;
  elem._shareBound = true;
  elem.addEventListener('lgAfterOpen', () => {
    // openGallery creates a fresh lightGallery instance each time and closed
    // lightboxes stay in the DOM (display:none). Target the currently-visible
    // one (fall back to the most recently created) rather than the first.
    const toolbars = Array.from(document.querySelectorAll('.lg-toolbar'));
    const toolbar = toolbars.find((t) => t.offsetParent !== null) || toolbars[toolbars.length - 1];
    if (!toolbar || toolbar.querySelector('.lg-share-btn')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'lg-icon lg-share-btn';
    btn.title = shareLabel('share-sample');
    btn.setAttribute('aria-label', shareLabel('share-sample'));
    btn.innerHTML = SHARE_ICON_SVG;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      // lightGallery tracks the open slide on the instance as `.index`.
      const inst = elem._lgInstance;
      const imgIndex = (inst && typeof inst.index === 'number') ? inst.index : 0;
      shareLink(canonicalSampleUrl(sampleId, imgIndex), document.title);
    });
    // Append (rather than prepend) so the native, right-floated close (X) button
    // stays at the far top-right; the share button sits just to its left.
    toolbar.appendChild(btn);
  });
}

// On arrival with a #sample-<id> hash, reveal, scroll to and highlight the specimen.
function focusSampleFromHash() {
  const hash = window.location.hash;
  if (!hash || hash.indexOf('#sample-') !== 0) return;
  const id = decodeURIComponent(hash.slice(1)); // e.g. "sample-CY_1"
  const elem = document.getElementById(id);
  if (!elem) return;
  // Open any collapsed <details> ancestors so the specimen is visible.
  let parent = elem.parentElement;
  while (parent) {
    if (parent.tagName === 'DETAILS') parent.open = true;
    parent = parent.parentElement;
  }
  elem.scrollIntoView({ behavior: 'smooth', block: 'center' });
  // Keep exactly one specimen highlighted; the highlight persists until the
  // user follows a link to a different specimen.
  document.querySelectorAll('.sample-highlight').forEach((el) => {
    if (el !== elem) el.classList.remove('sample-highlight');
  });
  elem.classList.add('sample-highlight');

  // Shared specimen links carry ?gallery=1 and open the lightbox directly, on
  // the shared slide (img=<n>). Random-sample links omit these and only scroll.
  const params = new URLSearchParams(window.location.search);
  if (params.get('gallery') === '1') {
    const imgIndex = parseInt(params.get('img'), 10) || 0;
    const hidden = elem.querySelector('[id^="hidden-gallery-"]');
    if (hidden && typeof openGallery === 'function') {
      openGallery(Number(hidden.id.replace('hidden-gallery-', '')), imgIndex);
    } else {
      elem.click(); // fallback: triggers the tile's openGallery(...) handler
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  // Defer one frame so fonts/images settle before the smooth scroll.
  requestAnimationFrame(() => setTimeout(focusSampleFromHash, 60));
});
window.addEventListener('hashchange', focusSampleFromHash);
