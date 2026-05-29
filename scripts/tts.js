// tts.js — read the description (and, on taxon pages, the etymology) aloud.
// Uses the browser-native Web Speech API (speechSynthesis), which ships usable
// el-GR and en-* voices. Ancient Greek (grc) has no off-the-shelf voice, so the
// button hides while the page language is grc.
//
// The page text is filled in client-side by language.js (into .description-text
// and .etymology-text), so we read textContent from the live DOM at click time
// and never need our own copy of the text.

// Fallback labels for when globalDict (dict.json) has not loaded yet.
const TTS_LABELS = {
  el: { 'tts-listen': 'Ακρόαση', 'tts-stop': 'Διακοπή' },
  en: { 'tts-listen': 'Listen', 'tts-stop': 'Stop' },
  grc: { 'tts-listen': 'Ἀκοῦσαι', 'tts-stop': 'Παῦσαι' }
};

// Languages with a usable voice. grc has no voice of its own, so it is read by
// a Modern Greek voice (the living Greek-school reading, not restored classical)
// after its polytonic text is normalized to monotonic — see toMonotonic.
const TTS_SUPPORTED = { el: 'el-GR', en: 'en-GB', grc: 'el-GR' };

// Strip polytonic orthography to a monotonic form Modern Greek voices can read:
// keep acute (carries stress) and diaeresis (carries hiatus), fold grave and
// circumflex onto acute, and drop breathings, iota-subscript, macron and breve.
// Used only for the spoken string; the page text stays polytonic.
function toMonotonic(text) {
  return text.normalize('NFD')
    .replace(/[̀͂]/g, '́')          // grave, perispomeni -> acute
    .replace(/[̓̔̄̆ͅ]/g, '') // psili, dasia, iota-sub, macron, breve
    .normalize('NFC');
}

function ttsLabel(key) {
  const lang = (typeof getLanguage === 'function') ? getLanguage() : 'en';
  if (typeof globalDict === 'object' && globalDict[lang] && key in globalDict[lang]) {
    return globalDict[lang][key];
  }
  return (TTS_LABELS[lang] && TTS_LABELS[lang][key]) || TTS_LABELS.en[key] || key;
}

// Material "volume up" glyph. Inherits colour via currentColor.
const TTS_ICON_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>';
// Material "stop" glyph, shown while speaking.
const TTS_STOP_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor"><path d="M6 6h12v12H6z"/></svg>';

let ttsButton = null;
let ttsSpeaking = false;

// speechSynthesis.getVoices() is often empty on first call and populates
// asynchronously; kick it and let the voiceschanged event refresh the cache.
function ttsVoices() {
  return (window.speechSynthesis && window.speechSynthesis.getVoices()) || [];
}

function pickVoice(bcp47) {
  const voices = ttsVoices();
  const root = bcp47.split('-')[0];
  return voices.find((v) => v.lang === bcp47) ||
         voices.find((v) => v.lang && v.lang.split('-')[0] === root) ||
         null;
}

// Description paragraphs first, then etymology (taxon pages only). Empty <p>
// elements (e.g. before language.js fills them) are skipped.
function gatherParagraphs() {
  const selectors = ['.description-text p', '.etymology-text p'];
  const out = [];
  selectors.forEach((sel) => {
    document.querySelectorAll(sel).forEach((p) => {
      const text = (p.textContent || '').trim();
      if (text) out.push(text);
    });
  });
  return out;
}

function setButtonState(speaking) {
  ttsSpeaking = speaking;
  if (!ttsButton) return;
  const key = speaking ? 'tts-stop' : 'tts-listen';
  const label = ttsLabel(key);
  ttsButton.classList.toggle('is-playing', speaking);
  ttsButton.title = label;
  ttsButton.setAttribute('aria-label', label);
  ttsButton.querySelector('.tts-icon').innerHTML = speaking ? TTS_STOP_SVG : TTS_ICON_SVG;
  ttsButton.querySelector('.tts-text').textContent = label;
}

function stopSpeaking() {
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  setButtonState(false);
}

function startSpeaking() {
  const lang = (typeof getLanguage === 'function') ? getLanguage() : 'en';
  const bcp47 = TTS_SUPPORTED[lang];
  if (!bcp47) return; // unsupported language (grc) — button should be hidden anyway
  const paragraphs = gatherParagraphs();
  if (!paragraphs.length) return;

  window.speechSynthesis.cancel(); // clear any stale queue
  const voice = pickVoice(bcp47);
  paragraphs.forEach((text, i) => {
    const spoken = (lang === 'grc') ? toMonotonic(text) : text;
    const u = new SpeechSynthesisUtterance(spoken);
    u.lang = bcp47;
    if (voice) u.voice = voice;
    u.rate = 0.95;
    if (i === paragraphs.length - 1) {
      u.onend = () => setButtonState(false);
    }
    window.speechSynthesis.speak(u);
  });
  setButtonState(true);
  if (typeof trackEvent === 'function') trackEvent('tts_play', { language: lang });
}

function onButtonClick() {
  if (ttsSpeaking) {
    stopSpeaking();
  } else {
    startSpeaking();
  }
}

// Show the button only when the page language has a voice; hide (and stop) for
// grc or unsupported languages.
function refreshButtonVisibility() {
  if (!ttsButton) return;
  const lang = (typeof getLanguage === 'function') ? getLanguage() : 'en';
  const supported = lang in TTS_SUPPORTED;
  ttsButton.hidden = !supported;
  if (!supported && ttsSpeaking) stopSpeaking();
  // Keep label text in sync with the current language.
  setButtonState(ttsSpeaking);
}

function injectButton() {
  if (!window.speechSynthesis) return; // no Web Speech API — no button
  const anchor = document.querySelector('.description-text');
  if (!anchor) return;

  ttsButton = document.createElement('button');
  ttsButton.type = 'button';
  ttsButton.className = 'tts-button';
  ttsButton.innerHTML = '<span class="tts-icon">' + TTS_ICON_SVG + '</span><span class="tts-text"></span>';
  ttsButton.addEventListener('click', onButtonClick);
  anchor.parentNode.insertBefore(ttsButton, anchor);

  setButtonState(false);
  refreshButtonVisibility();

  // language.js sets document.documentElement.lang on every language switch.
  // Observe it so the button updates its label/visibility and stops playback.
  const observer = new MutationObserver(refreshButtonVisibility);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
}

window.addEventListener('DOMContentLoaded', injectButton);
// Stop audio when leaving the page (cancel persists across some bfcache nav).
window.addEventListener('pagehide', stopSpeaking);
