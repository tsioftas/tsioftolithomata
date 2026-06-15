// Makes the images inside a journal entry open in lightGallery when clicked.
// All figures of an entry are collected into a single dynamic gallery, so the
// reader can swipe/zoom through them starting from whichever one they clicked.
//
// This runs both on the standalone localised pages (via DOMContentLoaded) and on
// the language-switching shell, where journal.js injects the content and then
// calls window.initJournalGallery() explicitly (injected <script> tags do not
// execute, so the shell must own the initialisation).

(function () {
    function buildGallery() {
        const content = document.querySelector('.journal-entry-content');
        if (!content) {
            return;
        }

        const items = [];
        content.querySelectorAll('figure').forEach(function (figure) {
            const img = figure.querySelector('img');
            if (!img) {
                return;
            }
            const caption = figure.querySelector('figcaption');
            const index = items.length;
            items.push({
                src: img.getAttribute('src'),
                thumb: img.getAttribute('src'),
                subHtml: caption ? caption.innerHTML : ''
            });
            img.style.cursor = 'zoom-in';
            img.addEventListener('click', function () {
                openAt(index);
            });
        });

        if (!items.length) {
            return;
        }

        let holder = document.getElementById('journal-lg-holder');
        if (!holder) {
            holder = document.createElement('div');
            holder.id = 'journal-lg-holder';
            holder.style.display = 'none';
            document.body.appendChild(holder);
        }

        function openAt(index) {
            if (!holder._lgInstance) {
                holder._lgInstance = lightGallery(holder, {
                    dynamic: true,
                    plugins: [lgZoom],
                    thumbnail: true,
                    loop: true,
                    dynamicEl: items
                });
            }
            holder._lgInstance.openGallery(index);
        }
    }

    function initJournalGallery() {
        // lightGallery may still be loading (especially right after a fetch on
        // the shell); wait for it before wiring things up.
        if (typeof lightGallery === 'undefined' || typeof lgZoom === 'undefined') {
            return setTimeout(initJournalGallery, 100);
        }
        // Drop any instance from a previous language so it doesn't pile up.
        const previous = document.getElementById('journal-lg-holder');
        if (previous) {
            if (previous._lgInstance) {
                try { previous._lgInstance.destroy(); } catch (e) { /* noop */ }
            }
            previous.remove();
        }
        buildGallery();
    }

    window.initJournalGallery = initJournalGallery;
    document.addEventListener('DOMContentLoaded', initJournalGallery);
})();
