// Document layouts: sticky offsets, the taxon time strip, and journal contents.
(function () {
  'use strict';
  const root = document.documentElement;
  const header = document.querySelector('.site-header');
  const headerHeight = () => header && getComputedStyle(header).position === 'sticky'
    ? header.getBoundingClientRect().height : 0;
  const measureHeader = () => root.style.setProperty('--page-header-height', `${headerHeight()}px`);
  measureHeader();
  if (header) new ResizeObserver(measureHeader).observe(header);
  window.addEventListener('resize', measureHeader);

  document.querySelectorAll('.time-strip').forEach((strip) => {
    const scroller = strip.querySelector('.ts-scroll');
    const edges = () => {
      const max = scroller.scrollWidth - scroller.clientWidth;
      strip.classList.toggle('more-left', scroller.scrollLeft > 4);
      strip.classList.toggle('more-right', scroller.scrollLeft < max - 4);
    };
    if (scroller.scrollWidth > scroller.clientWidth) {
      const first = strip.querySelector('.ts-pin');
      if (first) {
        scroller.style.scrollBehavior = 'auto';
        scroller.scrollLeft = Math.max(0, first.getBoundingClientRect().left
          - scroller.getBoundingClientRect().left - scroller.clientWidth * 0.25);
        scroller.style.scrollBehavior = '';
      }
    }
    edges();
    scroller.addEventListener('scroll', edges, { passive: true });
    new ResizeObserver(edges).observe(scroller);
  });

  const toc = document.querySelector('.journal-toc');
  if (!toc) return;
  const links = Array.from(toc.querySelectorAll('a[href^="#"]'));
  const headings = links.map(a => document.getElementById(decodeURIComponent(a.hash.slice(1))));
  let queued = false;
  const mark = () => {
    queued = false;
    let current = -1;
    headings.forEach((heading, i) => {
      if (heading && heading.getBoundingClientRect().top <= headerHeight() + 100) current = i;
    });
    links.forEach((a, i) => {
      a.classList.toggle('is-current', i === current);
      if (i === current) a.setAttribute('aria-current', 'location');
      else a.removeAttribute('aria-current');
    });
  };
  window.addEventListener('scroll', () => {
    if (!queued) { queued = true; requestAnimationFrame(mark); }
  }, { passive: true });
  mark();
})();
