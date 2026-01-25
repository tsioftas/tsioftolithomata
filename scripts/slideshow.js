// listen to event when gallery is initialized
document.addEventListener("galleryInitialized", function() {
    initialize_slideshow();
});

function initialize_slideshow() {
    // Slideshow functionality
    const slideshowModal = document.getElementById('slideshow-modal');
    const slideshowImage = document.getElementById('slideshow-image');
    const slideshowCaption = document.getElementById('slideshow-caption');
    const slideshowStartBtn = document.getElementById('slideshow-start-btn');
    const slideshowCloseBtn = document.getElementById('slideshow-close-btn');
    const slideshowPrevBtn = document.getElementById('slideshow-prev');
    const slideshowNextBtn = document.getElementById('slideshow-next');
    const slideshowPlayPauseBtn = document.getElementById('slideshow-play-pause');
    const slideshowCurrent = document.getElementById('slideshow-current');
    const slideshowTotal = document.getElementById('slideshow-total');

    let slideshowImages = [];
    let currentSlide = 0;
    let isPlaying = true;
    let slideshowInterval = null;
    const SLIDESHOW_DELAY = 5 * 1000; // 5 seconds per image

    function collectAllImages() {
        const images = [];
        document.querySelectorAll('a.gallery-item').forEach(link => {
            images.push({
                src: link.getAttribute('data-src'),
                caption: link.getAttribute('data-caption')
            });
        });
        return images;
    }

    function shuffleArray(array) {
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }

    function startSlideshow() {
        slideshowImages = shuffleArray(collectAllImages());
        if (slideshowImages.length === 0) return;

        currentSlide = 0;
        slideshowTotal.textContent = slideshowImages.length;
        slideshowModal.classList.add('active');
        isPlaying = true;
        updateSlide();
        autoPlay();
        document.body.style.overflow = 'hidden';
    }

    function closeSlideshow() {
        slideshowModal.classList.remove('active');
        if (slideshowInterval) clearInterval(slideshowInterval);
        isPlaying = false;
        document.body.style.overflow = '';
    }

    function updateSlide() {
        const slide = slideshowImages[currentSlide];
        slideshowImage.src = slide.src;
        slideshowCaption.textContent = slide.caption;
        slideshowCurrent.textContent = currentSlide + 1;
    }

    function nextSlide() {
        currentSlide = (currentSlide + 1) % slideshowImages.length;
        updateSlide();
        if (isPlaying) {
            if (slideshowInterval) clearInterval(slideshowInterval);
            autoPlay();
        }
    }

    function prevSlide() {
        currentSlide = (currentSlide - 1 + slideshowImages.length) % slideshowImages.length;
        updateSlide();
        if (isPlaying) {
            if (slideshowInterval) clearInterval(slideshowInterval);
            autoPlay();
        }
    }

    function togglePlayPause() {
        isPlaying = !isPlaying;
        if (isPlaying) {
            slideshowPlayPauseBtn.textContent = '⏸ Pause';
            autoPlay();
        } else {
            slideshowPlayPauseBtn.textContent = '▶ Play';
            if (slideshowInterval) clearInterval(slideshowInterval);
        }
    }

    function autoPlay() {
        if (slideshowInterval) clearInterval(slideshowInterval);
        slideshowInterval = setInterval(nextSlide, SLIDESHOW_DELAY);
    }

    // Event listeners
    slideshowStartBtn.addEventListener('click', startSlideshow);
    slideshowCloseBtn.addEventListener('click', closeSlideshow);
    slideshowNextBtn.addEventListener('click', nextSlide);
    slideshowPrevBtn.addEventListener('click', prevSlide);
    slideshowPlayPauseBtn.addEventListener('click', togglePlayPause);

    // Keyboard controls
    document.addEventListener('keydown', (e) => {
        if (!slideshowModal.classList.contains('active')) return;
        if (e.key === 'ArrowRight') nextSlide();
        if (e.key === 'ArrowLeft') prevSlide();
        if (e.key === ' ') {
            e.preventDefault();
            togglePlayPause();
        }
        if (e.key === 'Escape') closeSlideshow();
    });
}