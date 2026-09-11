// The back button closes an open lightbox or slideshow instead of leaving the page.
// Opening pushes a history entry; back pops it and closes the overlay.
(function () {
    let closeOpen = null;

    window.overlayOpened = function (close) {
        history.pushState({ overlay: true }, '');
        closeOpen = close;
    };

    // Call from every close path. A close from the UI pops the entry we pushed.
    window.overlayClosed = function () {
        if (!closeOpen) return;
        closeOpen = null;
        if (history.state && history.state.overlay) history.back();
    };

    window.addEventListener('popstate', function () {
        if (!closeOpen) return;
        const close = closeOpen;
        closeOpen = null;
        close();
    });

    // lightGallery fires its events on the element it was built on.
    window.closeLightGalleryOnBack = function (elem, instance) {
        elem.addEventListener('lgBeforeOpen', function () {
            overlayOpened(function () { instance.closeGallery(); });
        });
        elem.addEventListener('lgBeforeClose', overlayClosed);
    };
})();
