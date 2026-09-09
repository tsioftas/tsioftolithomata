// Sorting for the journal index. The page ships newest first; "most read"
// reorders the list in place from the counts the build baked into each item,
// so the toggle costs no request and works with the reader offline.
(function initJournalSort() {
  const list = document.querySelector('.journal-index-list');
  const buttons = document.querySelectorAll('.journal-sort-btn');
  if (!list || !buttons.length) return;

  const items = Array.from(list.children);

  function byDate(a, b) {
    return b.dataset.date.localeCompare(a.dataset.date);
  }

  function sortBy(mode) {
    const ordered = items.slice().sort((a, b) => (
      mode === 'views'
        ? (Number(b.dataset.views) - Number(a.dataset.views)) || byDate(a, b)
        : byDate(a, b)
    ));
    ordered.forEach(item => list.appendChild(item));
  }

  buttons.forEach(button => {
    button.addEventListener('click', () => {
      buttons.forEach(other => {
        const active = other === button;
        other.classList.toggle('is-active', active);
        other.setAttribute('aria-pressed', String(active));
      });
      sortBy(button.dataset.sort);
    });
  });
})();
