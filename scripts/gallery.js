function init_gallery() {
    // Initialize lightgallery for each locality section
    const gallery = document.querySelectorAll('[id^="gallery-kokos"]')[0]
    lightGallery(gallery, {
        plugins: [lgZoom],
        speed: 500,
        selector: 'a.gallery-item'
    });
    // fire an event to indicate gallery has been initialized
    const event = new CustomEvent("galleryInitialized");
    document.dispatchEvent(event);
    console.log("Gallery initialized.");
}

// Use a MutationObserver to watch for the addition of the reload element.
const observer = new MutationObserver(mutations => {
    mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
            if (node.id === 'gallery-reload') {
                // remove reload element
                node.parentNode.removeChild(node);
                init_gallery();
            }
        });
    });
});

observer.observe(document.body, { childList: true });