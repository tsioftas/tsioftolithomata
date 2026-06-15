// tts.js — read the description (and, on taxon pages, the etymology) aloud,
// with a small transport player: play/pause, skip back/forward, a seek bar and
// a playback-speed control.
//
// Uses the browser-native Web Speech API (speechSynthesis). el and en use their
// own voices; Ancient Greek (grc) has no voice of its own, so it is read by a
// Modern Greek voice after its polytonic text is normalized to monotonic.
//
// speechSynthesis is not a media element (no timeline/seek/duration), so we
// drive playback ourselves: the text is split into sentence "chunks" spoken one
// at a time with a position index. That gives real pause/resume, skipping, a
// mid-playback speed change and a progress bar. The trade-offs are inherent to
// the API: seeking snaps to sentence boundaries, and within-sentence progress
// relies on `onboundary` word events (which some engines do not fire — there
// the bar advances once per sentence).
//
// The page text is filled in client-side by language.js (into .description-text
// and .etymology-text), so we read textContent from the live DOM at play time.

// Fallback labels for when globalDict (dict.json) has not loaded yet.
const TTS_LABELS = {
  el: { 'tts-listen': 'Ακρόαση', 'tts-play': 'Αναπαραγωγή', 'tts-pause': 'Παύση', 'tts-back': 'Προηγούμενη', 'tts-forward': 'Επόμενη', 'tts-speed': 'Ταχύτητα', 'tts-seek': 'Πρόοδος' },
  en: { 'tts-listen': 'Listen', 'tts-play': 'Play', 'tts-pause': 'Pause', 'tts-back': 'Back', 'tts-forward': 'Forward', 'tts-speed': 'Speed', 'tts-seek': 'Progress' },
  grc: { 'tts-listen': 'Ἀκοῦσαι', 'tts-play': 'Ἀκοῦσαι', 'tts-pause': 'Παῦσαι', 'tts-back': 'Ὀπίσω', 'tts-forward': 'Πρόσω', 'tts-speed': 'Τάχος', 'tts-seek': 'Πρόοδος' },
  cyp: { 'tts-listen': 'Άκουσε', 'tts-play': 'Παίξε', 'tts-pause': 'Σταμάτα', 'tts-back': 'Πίσω', 'tts-forward': 'Μπρος', 'tts-speed': 'Ταχύτητα', 'tts-seek': 'Πρόοδος' }
};

// Languages with a usable voice. grc has no voice of its own, so it is read by
// a Modern Greek voice (the living Greek-school reading, not restored classical)
// after its polytonic text is normalized to monotonic — see toMonotonic.
const TTS_SUPPORTED = { el: 'el-GR', en: 'en-GB', grc: 'el-GR' };

// Cypriot has no Web Speech voice; it is narrated by pre-generated WAV files
// (the variety-tts model), listed in audio/cyp/manifest.json keyed by the exact
// paragraph element id the player reads. Loaded once; until then cyp stays
// hidden. See the "Cypriot audio engine" section below.
let ttsManifest = null;        // {id: {file, duration, hash}} once fetched
let ttsManifestLoaded = false;
let ttsObserverSet = false;    // the lang-change observer is installed only once

function ttsLang() {
  return (typeof getLanguage === 'function') ? getLanguage() : 'en';
}

function loadManifest() {
  const base = (typeof getBaseURL === 'function') ? getBaseURL() : '';
  fetch(base + '/audio/cyp/manifest.json')
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}))
    .then((m) => { ttsManifest = m || {}; ttsManifestLoaded = true; refreshVisibility(); });
}

// Playback-rate presets the speed button cycles through (wraps to the start).
const TTS_RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];

// Strip polytonic orthography to a monotonic form Modern Greek voices can read:
// keep acute (carries stress) and diaeresis (carries hiatus), fold grave and
// circumflex onto acute, and drop breathings, iota-subscript, macron and breve.
// Used only for the spoken string; the page text stays polytonic.
function toMonotonic(text) {
  return text.normalize('NFD')
    .replace(/[̀͂]/g, '́')          // grave, perispomeni -> acute
    .replace(/[̓̔̄̆ͅ]/g, '') // psili, dasia, iota-sub, macron, breve
    .normalize('NFC');
}

function ttsLabel(key) {
  const lang = (typeof getLanguage === 'function') ? getLanguage() : 'en';
  if (typeof globalDict === 'object' && globalDict[lang] && key in globalDict[lang]) {
    return globalDict[lang][key];
  }
  return (TTS_LABELS[lang] && TTS_LABELS[lang][key]) || TTS_LABELS.en[key] || key;
}

// Material transport glyphs. Inherit colour via currentColor.
const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
// fast-rewind / fast-forward (double triangle, no track-change bar) — these
// mean "seek within the current audio", not "switch track".
const ICON_PREV = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor"><path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z"/></svg>';
const ICON_NEXT = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor"><path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z"/></svg>';
// Speaker glyph for the collapsed "Listen" pill (the idle entry point).
const ICON_SPEAKER = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>';

// speechSynthesis.getVoices() is often empty on first call and populates
// asynchronously; let the voiceschanged event refresh the cache.
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
  const selectors = ['.description-text p', '.etymology-text p',
                     '.journal-entry-content p', '.journal-entry-content li'];
  const out = [];
  selectors.forEach((sel) => {
    document.querySelectorAll(sel).forEach((p) => {
      const text = (p.textContent || '').trim();
      if (text) out.push(text);
    });
  });
  return out;
}

// Split a paragraph into sentence chunks, keeping the terminal punctuation.
// Recognises Latin .!? plus the ellipsis, the Greek question mark ';' and the
// ano teleia '·'. Whitespace-only fragments are dropped by the caller.
function splitSentences(paragraph) {
  const matches = paragraph.match(/[^.!?…;·]+[.!?…;·]*\s*/g);
  return matches ? matches.map((s) => s.trim()).filter(Boolean) : [paragraph];
}

// ---- Player ---------------------------------------------------------------

const player = {
  el: null,        // .tts-player container
  listenBtn: null, // collapsed "Listen" pill (idle entry point)
  listenText: null, // its text label span
  playBtn: null,
  seek: null,      // <input type=range>
  rateBtn: null,   // speed button; tapping it cycles through TTS_RATES
  chunks: [],      // spoken sentence strings
  prefix: [],      // prefix-sum of chunk char lengths
  total: 0,        // total chars (for progress mapping)
  index: 0,
  state: 'idle',   // 'idle' | 'playing' | 'paused'
  engine: 'speech', // 'speech' (el/en/grc, Web Speech) | 'audio' (cyp, WAV files)
  audioItems: [],  // [{id, audio: HTMLAudioElement, duration}] for the cyp engine
  audioTotal: 1,   // summed paragraph durations (for seek mapping)
  rate: 1,
  gen: 0,          // bumped on every (re)speak so stale handlers no-op
  seeking: false,  // true while the user drags the seek bar
  keepAlive: null, // stall-recovery watchdog interval
  // Stall recovery: detect an utterance that died without firing end/error.
  chunkIssuedAt: 0, // timestamp the current chunk's speak() was issued
  stallChunk: -1,  // index the watchdog last tried to recover
  stallCount: 0,   // consecutive recovery attempts on stallChunk
  // Progress estimation: the seek thumb is interpolated from elapsed time,
  // anchored to the last known true position (sentence start, or a boundary
  // event when the engine fires them), so it glides smoothly either way.
  anchorChars: 0,  // char offset in current chunk at the last anchor
  anchorTime: 0,   // timestamp (ms) of that anchor
  chunkStart: 0,   // timestamp the current sentence started (for calibration)
  cps: 14,         // chars/second estimate, self-calibrated per voice
  rafId: null
};

function loadRate() {
  const stored = parseFloat(localStorage.getItem('tts-rate'));
  player.rate = TTS_RATES.includes(stored) ? stored : 1;
}

function buildChunks(lang) {
  const chunks = [];
  gatherParagraphs().forEach((para) => {
    splitSentences(para).forEach((s) => {
      chunks.push(lang === 'grc' ? toMonotonic(s) : s);
    });
  });
  player.chunks = chunks;
  player.prefix = [];
  let acc = 0;
  chunks.forEach((c) => { player.prefix.push(acc); acc += c.length; });
  player.total = acc || 1;
}

function setSeek(fraction) {
  if (player.seeking || !player.seek) return;
  player.seek.value = String(Math.max(0, Math.min(1, fraction)) * Number(player.seek.max));
}

// Smoothly interpolate the thumb within the current sentence from elapsed time,
// anchored to the last known true position (sentence start, or a boundary event
// where the engine fires them). This keeps the bar gliding even on voices that
// only report at sentence ends.
function tick() {
  if (player.state !== 'playing') { player.rafId = null; return; }
  const chunkLen = player.chunks[player.index] ? player.chunks[player.index].length : 1;
  const elapsed = (performance.now() - player.anchorTime) / 1000;
  const predicted = player.anchorChars + elapsed * player.cps * player.rate;
  const pos = Math.max(player.anchorChars, Math.min(predicted, chunkLen * 0.985));
  setSeek((player.prefix[player.index] + pos) / player.total);
  player.rafId = requestAnimationFrame(tick);
}

function startProgress() {
  if (!player.rafId) player.rafId = requestAnimationFrame(tick);
}

function stopProgress() {
  if (player.rafId) { cancelAnimationFrame(player.rafId); player.rafId = null; }
}

function startKeepAlive() {
  stopKeepAlive();
  // Health watchdog: while we believe we are playing, (1) resume() to clear
  // Chrome's spontaneous-pause bug (a no-op when already speaking), and (2)
  // detect a chunk that silently died — the engine sometimes drops an utterance
  // without firing end or error, which would otherwise stall playback until the
  // user manually skips. When that happens, re-speak the current sentence; if it
  // keeps failing, step past it rather than loop forever.
  player.keepAlive = setInterval(() => {
    if (player.state !== 'playing') return;
    window.speechSynthesis.resume();
    const settling = (performance.now() - player.chunkIssuedAt) < 2000;
    if (settling || window.speechSynthesis.speaking || window.speechSynthesis.pending) return;
    // Stalled: nothing is speaking or queued, but we think we are playing.
    if (player.stallChunk === player.index) player.stallCount++;
    else { player.stallChunk = player.index; player.stallCount = 1; }
    if (player.stallCount > 2 && player.index < player.chunks.length - 1) {
      speakFrom(player.index + 1);
    } else {
      speakFrom(player.index);
    }
  }, 3000);
}

function stopKeepAlive() {
  if (player.keepAlive) { clearInterval(player.keepAlive); player.keepAlive = null; }
}

function speakFrom(i) {
  if (!player.chunks.length) return;
  player.index = Math.max(0, Math.min(i, player.chunks.length - 1));
  const now = performance.now();
  player.anchorChars = 0;
  player.anchorTime = now;
  player.chunkStart = now;
  setSeek(player.prefix[player.index] / player.total);

  const lang = (typeof getLanguage === 'function') ? getLanguage() : 'en';
  const bcp47 = TTS_SUPPORTED[lang];
  const voice = pickVoice(bcp47);
  const myGen = ++player.gen;

  window.speechSynthesis.cancel();
  // Chrome drops a speak() issued synchronously right after cancel().
  setTimeout(() => {
    if (myGen !== player.gen) return; // superseded before we got here
    const u = new SpeechSynthesisUtterance(player.chunks[player.index]);
    u.lang = bcp47;
    if (voice) u.voice = voice;
    u.rate = player.rate;
    u.onstart = () => {
      if (myGen !== player.gen) return;
      const t = performance.now();
      player.anchorTime = t;
      player.chunkStart = t;
      player.stallChunk = -1; // speech confirmed live — clear stall tracking
      player.stallCount = 0;
    };
    u.onboundary = (e) => {
      if (myGen !== player.gen) return;
      if (typeof e.charIndex === 'number') {
        player.anchorChars = e.charIndex; // truth correction; tick() interpolates forward
        player.anchorTime = performance.now();
      }
    };
    u.onend = () => {
      if (myGen !== player.gen) return; // cancelled/superseded — ignore
      // Calibrate chars/sec from the real sentence duration for a better next estimate.
      const chunkLen = player.chunks[player.index].length;
      const dur = (performance.now() - player.chunkStart) / 1000;
      if (dur > 0.2 && chunkLen > 20) {
        const measured = chunkLen / dur / player.rate;
        if (measured > 3 && measured < 40) player.cps = 0.7 * player.cps + 0.3 * measured;
      }
      if (player.index < player.chunks.length - 1) {
        speakFrom(player.index + 1);
      } else {
        speechFinish();
      }
    };
    u.onerror = () => {
      if (myGen !== player.gen) return; // our own cancel (skip/seek/pause/rate) — ignore
      // Genuine synthesis failure on this chunk: keep going rather than stall.
      if (player.index < player.chunks.length - 1) speakFrom(player.index + 1);
      else speechFinish();
    };
    player.chunkIssuedAt = performance.now();
    window.speechSynthesis.speak(u);
  }, 0);

  player.state = 'playing';
  reflectState();
  startKeepAlive();
  startProgress();
}

function speechPlay() {
  if (player.state === 'playing') return;
  if (player.state === 'paused') {
    speakFrom(player.index); // re-speak the current sentence from its start
    return;
  }
  // idle → build and start
  buildChunks((typeof getLanguage === 'function') ? getLanguage() : 'en');
  if (!player.chunks.length) return;
  speakFrom(0);
  if (typeof trackEvent === 'function') {
    trackEvent('tts_play', { language: (typeof getLanguage === 'function') ? getLanguage() : 'en' });
  }
}

function speechPause() {
  if (player.state !== 'playing') return;
  // speechSynthesis.pause() is a no-op on many engines (mobile, Linux/espeak),
  // so we pause by cancelling and remembering the position; resume re-speaks
  // the current sentence. gen++ stops the cancelled utterance's onend from
  // advancing. The seek thumb is left frozen where it is.
  player.gen++;
  window.speechSynthesis.cancel();
  player.state = 'paused';
  reflectState();
  stopKeepAlive();
  stopProgress();
}

function togglePlay() {
  (player.state === 'playing') ? pause() : play();
}

function speechFinish() {
  player.gen++;            // invalidate any in-flight handlers
  window.speechSynthesis.cancel();
  player.state = 'idle';
  player.index = 0;
  player.anchorChars = 0;
  stopKeepAlive();
  stopProgress();
  setSeek(0);
  reflectState();
}

// Move the position to a sentence without disturbing the play/pause state: when
// playing it (re)speaks from there; when paused it just repositions the index
// and seek thumb and waits for resume. This keeps "paused" silent — we can't
// rely on speechSynthesis.pause() (a no-op on mobile/Linux-espeak), so we never
// start an utterance we'd then have to pause.
function goToChunk(target) {
  target = Math.max(0, Math.min(target, player.chunks.length - 1));
  if (player.state === 'paused') {
    player.index = target;
    player.anchorChars = 0;
    setSeek(player.prefix[target] / player.total);
  } else {
    speakFrom(target);
  }
}

// Skip back: while playing, restart the current sentence if we are well into it,
// else step to the previous one. While paused, always step to the previous.
function speechBack() {
  if (player.state === 'idle') return;
  if (player.state === 'paused') { goToChunk(player.index - 1); return; }
  const intoSentence = (performance.now() - player.chunkStart) > 1500;
  goToChunk((intoSentence || player.index === 0) ? player.index : player.index - 1);
}

function speechForward() {
  if (player.state === 'idle') return;
  if (player.index >= player.chunks.length - 1) { speechFinish(); return; }
  goToChunk(player.index + 1);
}

function onSeekInput() { player.seeking = true; }

function speechSeekChange() {
  player.seeking = false;
  if (player.state === 'idle') {
    // Seeking before playing: build chunks so we can map the position.
    buildChunks((typeof getLanguage === 'function') ? getLanguage() : 'en');
    if (!player.chunks.length) return;
  }
  const fraction = Number(player.seek.value) / Number(player.seek.max);
  const targetChar = fraction * player.total;
  let target = 0;
  for (let i = 0; i < player.chunks.length; i++) {
    if (player.prefix[i] <= targetChar) target = i; else break;
  }
  goToChunk(target);
}

// ---- Cypriot audio engine (pre-generated WAV files) -----------------------
//
// For cyp there is no Web Speech voice, so each narratable paragraph is an
// HTMLAudioElement built from audio/cyp/manifest.json (keyed by the paragraph's
// element id). Paragraphs play in sequence; native currentTime/duration/
// playbackRate make seek and speed trivial. The transport DOM, icons, labels
// and rate presets are shared with the speech engine; only the dispatched verbs
// (play/pause/back/forward/seek/finish) differ.

// The <p> elements the player narrates, in order, with their ids (which match
// the manifest keys). Empty paragraphs and any without an id are skipped.
function gatherParagraphEls() {
  const selectors = ['.description-text p', '.etymology-text p',
                     '.journal-entry-content p', '.journal-entry-content li'];
  const out = [];
  selectors.forEach((sel) => {
    document.querySelectorAll(sel).forEach((p) => {
      if (p.id && (p.textContent || '').trim()) out.push(p);
    });
  });
  return out;
}

// cyp is "supported" only when the manifest actually has audio for a paragraph
// on this page (the user may not have authored a Cypriot description yet).
function audioHasNarration() {
  if (!ttsManifest) return false;
  return gatherParagraphEls().some((p) => ttsManifest[p.id]);
}

function buildAudioItems() {
  const base = (typeof getBaseURL === 'function') ? getBaseURL() : '';
  const items = [];
  gatherParagraphEls().forEach((p) => {
    const entry = ttsManifest && ttsManifest[p.id];
    if (!entry) return;
    const audio = new Audio(base + '/' + entry.file);
    audio.preload = 'metadata';
    audio.playbackRate = player.rate;
    items.push({ id: p.id, audio, duration: entry.duration || 0 });
  });
  player.audioItems = items;
  player.audioTotal = items.reduce((a, it) => a + (it.duration || 0), 0) || 1;
}

function audioPauseAll(reset) {
  (player.audioItems || []).forEach((it) => {
    it.audio.pause();
    if (reset) { try { it.audio.currentTime = 0; } catch (e) { /* metadata not ready */ } }
  });
}

// Seconds elapsed before the current paragraph, for mapping currentTime onto the
// whole-narration seek bar.
function audioElapsedBefore(idx) {
  let before = 0;
  for (let i = 0; i < idx; i++) before += player.audioItems[i].duration || 0;
  return before;
}

function audioUpdateSeek() {
  const it = player.audioItems[player.index];
  if (!it) return;
  setSeek((audioElapsedBefore(player.index) + (it.audio.currentTime || 0)) / player.audioTotal);
}

// Play paragraph `idx` from `offset` seconds, stopping every other paragraph.
function audioPlayFrom(idx, offset) {
  const items = player.audioItems;
  if (!items.length) return;
  const target = Math.max(0, Math.min(idx, items.length - 1));
  items.forEach((it, i) => { if (i !== target) { it.audio.pause(); try { it.audio.currentTime = 0; } catch (e) {} } });
  player.index = target;
  const it = items[target];
  it.audio.playbackRate = player.rate;
  try { it.audio.currentTime = offset || 0; } catch (e) { /* set again on loadedmetadata */ }
  it.audio.onended = () => {
    if (player.engine !== 'audio') return;
    if (player.index < items.length - 1) audioPlayFrom(player.index + 1, 0);
    else audioFinish();
  };
  it.audio.ontimeupdate = () => {
    if (player.engine === 'audio' && !player.seeking) audioUpdateSeek();
  };
  const p = it.audio.play();
  if (p && p.catch) p.catch(() => {});
  player.state = 'playing';
  reflectState();
}

// Reposition while paused: set the index and seek thumb without starting audio.
function audioGotoPaused(idx, offset) {
  const target = Math.max(0, Math.min(idx, player.audioItems.length - 1));
  player.audioItems.forEach((it, i) => { it.audio.pause(); if (i !== target) { try { it.audio.currentTime = 0; } catch (e) {} } });
  player.index = target;
  try { player.audioItems[target].audio.currentTime = offset || 0; } catch (e) {}
  setSeek((audioElapsedBefore(target) + (offset || 0)) / player.audioTotal);
}

function audioPlay() {
  if (player.state === 'playing') return;
  if (player.state === 'paused') {
    const it = player.audioItems[player.index];
    if (it) {
      it.audio.playbackRate = player.rate;
      const p = it.audio.play();
      if (p && p.catch) p.catch(() => {});
    }
    player.state = 'playing';
    reflectState();
    return;
  }
  buildAudioItems();
  if (!player.audioItems.length) return;
  audioPlayFrom(0, 0);
  if (typeof trackEvent === 'function') trackEvent('tts_play', { language: 'cyp' });
}

function audioPause() {
  if (player.state !== 'playing') return;
  const it = player.audioItems[player.index];
  if (it) it.audio.pause();
  player.state = 'paused';
  reflectState();
}

function audioBack() {
  if (player.state === 'idle') return;
  if (player.state === 'paused') { audioGotoPaused(player.index - 1, 0); return; }
  const it = player.audioItems[player.index];
  const into = it && it.audio.currentTime > 1.5;
  audioPlayFrom((into || player.index === 0) ? player.index : player.index - 1, 0);
}

function audioForward() {
  if (player.state === 'idle') return;
  if (player.index >= player.audioItems.length - 1) { audioFinish(); return; }
  if (player.state === 'paused') { audioGotoPaused(player.index + 1, 0); return; }
  audioPlayFrom(player.index + 1, 0);
}

function audioSeekChange() {
  player.seeking = false;
  if (player.state === 'idle') {
    buildAudioItems();
    if (!player.audioItems.length) return;
  }
  const fraction = Number(player.seek.value) / Number(player.seek.max);
  const targetSec = fraction * player.audioTotal;
  let idx = 0, before = 0;
  for (let i = 0; i < player.audioItems.length; i++) {
    const d = player.audioItems[i].duration || 0;
    if (targetSec <= before + d || i === player.audioItems.length - 1) { idx = i; break; }
    before += d;
  }
  const offset = Math.max(0, targetSec - before);
  if (player.state === 'paused') audioGotoPaused(idx, offset);
  else audioPlayFrom(idx, offset); // idle seek starts playback, matching the speech engine
}

function audioFinish() {
  audioPauseAll(true);
  player.state = 'idle';
  player.index = 0;
  setSeek(0);
  reflectState();
}

// ---- Engine dispatch ------------------------------------------------------
// The transport buttons and language-change reset call these; they route to the
// audio engine for cyp and the Web Speech engine for el/en/grc.
function play()        { (player.engine === 'audio') ? audioPlay()       : speechPlay(); }
function pause()       { (player.engine === 'audio') ? audioPause()      : speechPause(); }
function back()        { (player.engine === 'audio') ? audioBack()       : speechBack(); }
function forward()     { (player.engine === 'audio') ? audioForward()    : speechForward(); }
function finish()      { (player.engine === 'audio') ? audioFinish()     : speechFinish(); }
function onSeekChange(){ (player.engine === 'audio') ? audioSeekChange() : speechSeekChange(); }

// Advance to the next preset rate, wrapping around. Rate can't change on a live
// utterance, so re-speak the current sentence while playing; a paused player
// picks up the new rate when it resumes.
function cycleRate() {
  const i = TTS_RATES.indexOf(player.rate);
  player.rate = TTS_RATES[(i + 1) % TTS_RATES.length];
  localStorage.setItem('tts-rate', String(player.rate));
  player.rateBtn.textContent = player.rate + '×';
  if (player.engine === 'audio') {
    // HTMLAudioElement.playbackRate changes live — no re-issue needed.
    player.audioItems.forEach((it) => { it.audio.playbackRate = player.rate; });
    return;
  }
  if (player.state === 'playing') speakFrom(player.index);
}

// Sync button icons/labels with the current state and language.
function reflectState() {
  if (!player.el) return;
  const playing = player.state === 'playing';
  // Collapse to the "Listen" pill when idle; expand to the transport otherwise.
  player.el.classList.toggle('is-active', player.state !== 'idle');
  player.el.classList.toggle('is-playing', playing);
  player.playBtn.innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
  const playLabel = ttsLabel(playing ? 'tts-pause' : 'tts-play');
  player.playBtn.title = playLabel;
  player.playBtn.setAttribute('aria-label', playLabel);
  const listenLabel = ttsLabel('tts-listen');
  player.listenText.textContent = listenLabel;
  player.listenBtn.title = listenLabel;
  player.listenBtn.setAttribute('aria-label', listenLabel);
}

function refreshLabels() {
  if (!player.el) return;
  reflectState();
  player.backBtn.title = player.backBtn.ariaLabel = ttsLabel('tts-back');
  player.fwdBtn.title = player.fwdBtn.ariaLabel = ttsLabel('tts-forward');
  player.rateBtn.title = player.rateBtn.ariaLabel = ttsLabel('tts-speed');
  player.seek.setAttribute('aria-label', ttsLabel('tts-seek'));
}

// Show the player only when the page language has a voice; hide (and stop) for
// unsupported languages, and reset on any language switch.
function refreshVisibility() {
  if (!player.el) return;
  const lang = ttsLang();
  // The language (and the page text) just changed — hard-stop whichever engine
  // was running, from either side, before switching, then reset the transport.
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  player.gen++;
  audioPauseAll(true);
  stopKeepAlive();
  stopProgress();
  player.state = 'idle';
  player.index = 0;
  player.anchorChars = 0;
  player.engine = (lang === 'cyp') ? 'audio' : 'speech';
  const supported = (player.engine === 'audio')
    ? (ttsManifestLoaded && audioHasNarration())
    : (!!window.speechSynthesis && lang in TTS_SUPPORTED);
  player.el.hidden = !supported;
  setSeek(0);
  refreshLabels();
}

function mkButton(cls, icon) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'tts-ctl ' + cls;
  if (icon) b.innerHTML = icon;
  return b;
}

function injectPlayer() {
  // The player needs either a Web Speech voice (el/en/grc) or the cyp audio
  // engine (HTMLAudioElement) — both are effectively always present, but bail
  // if neither exists.
  if (!window.speechSynthesis && !window.Audio) return;
  // Taxon/locality pages anchor at .description-text; journal entries at
  // .journal-entry-content (the player is inserted just before it).
  const anchor = document.querySelector('.description-text') ||
                 document.querySelector('.journal-entry-content');
  if (!anchor) return;

  loadRate();
  loadManifest();

  player.el = document.createElement('div');
  player.el.className = 'tts-player';
  player.el.setAttribute('role', 'group');

  // Collapsed entry point: a "Listen" pill (speaker icon + label). Pressing it
  // starts playback, which expands the player to the full transport.
  player.listenBtn = document.createElement('button');
  player.listenBtn.type = 'button';
  player.listenBtn.className = 'tts-listen';
  player.listenBtn.innerHTML = '<span class="tts-icon">' + ICON_SPEAKER + '</span><span class="tts-text"></span>';
  player.listenText = player.listenBtn.querySelector('.tts-text');

  player.playBtn = mkButton('tts-play', ICON_PLAY);
  player.backBtn = mkButton('tts-back', ICON_PREV);
  player.fwdBtn = mkButton('tts-fwd', ICON_NEXT);

  player.seek = document.createElement('input');
  player.seek.type = 'range';
  player.seek.className = 'tts-seek';
  player.seek.min = '0';
  player.seek.max = '1000';
  player.seek.value = '0';
  player.seek.step = '1';

  // Speed control: a button showing the current rate; tapping it cycles presets.
  player.rateBtn = mkButton('tts-rate', '');
  player.rateBtn.textContent = player.rate + '×';

  player.listenBtn.addEventListener('click', play);
  player.playBtn.addEventListener('click', togglePlay);
  player.backBtn.addEventListener('click', back);
  player.fwdBtn.addEventListener('click', forward);
  player.seek.addEventListener('input', onSeekInput);
  player.seek.addEventListener('change', onSeekChange);
  player.rateBtn.addEventListener('click', cycleRate);

  // Transport row, shown only while active; the pill replaces it when idle.
  const transport = document.createElement('div');
  transport.className = 'tts-transport';
  transport.append(player.playBtn, player.backBtn, player.fwdBtn, player.seek, player.rateBtn);
  player.el.append(player.listenBtn, transport);
  anchor.parentNode.insertBefore(player.el, anchor);

  refreshVisibility();

  // language.js sets document.documentElement.lang on every language switch;
  // observe it to reset/relabel and toggle visibility. Set up once — on the
  // journal shell the player is rebuilt per switch (see initTTS), so guard
  // against stacking observers.
  if (!ttsObserverSet) {
    const observer = new MutationObserver(refreshVisibility);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    ttsObserverSet = true;
  }
}

// Journal entry pages are rendered into the language-switching shell, which
// replaces the article (and any player we injected) on every switch. journal.js
// calls this after each injection to (re)build the player against fresh content.
function initTTS() {
  if (player.el && player.el.parentNode) player.el.parentNode.removeChild(player.el);
  player.el = null;
  injectPlayer();
}
window.initJournalTTS = initTTS;

window.addEventListener('DOMContentLoaded', injectPlayer);
// Stop audio when leaving the page (cancel persists across some bfcache nav).
window.addEventListener('pagehide', () => {
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  (player.audioItems || []).forEach((it) => it.audio.pause());
});
