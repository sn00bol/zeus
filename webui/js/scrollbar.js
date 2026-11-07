export function initializeScrollbar({
    scrollElement,
    scrollbar,
    thumb,
    layoutTrack = () => {},
    onScrollableChange = () => {},
    onScroll = () => {},
    onPointerDown = () => {},
    observe = [],
}) {
    let dragging = false;
    let dragOffset = 0;
    let hideTimer;

    function update() {
        layoutTrack();
        const maxScroll = scrollElement.scrollHeight - scrollElement.clientHeight;
        const trackHeight = scrollbar.clientHeight;
        if (maxScroll <= 1 || trackHeight <= 0) {
            onScrollableChange(false);
            scrollbar.classList.remove('visible');
            scrollbar.tabIndex = -1;
            return;
        }

        onScrollableChange(true);
        scrollbar.tabIndex = 0;
        const thumbHeight = Math.min(
            trackHeight,
            Math.max(30, trackHeight * scrollElement.clientHeight / scrollElement.scrollHeight),
        );
        const thumbTravel = trackHeight - thumbHeight;
        const progress = scrollElement.scrollTop / maxScroll;
        thumb.style.height = `${thumbHeight}px`;
        thumb.style.top = `${thumbTravel * progress}px`;
        scrollbar.setAttribute('aria-valuenow', String(Math.round(progress * 1000)));
    }

    function show() {
        if (scrollElement.scrollHeight <= scrollElement.clientHeight + 1) return;
        scrollbar.classList.add('visible');
        if (hideTimer) window.clearTimeout(hideTimer);
        hideTimer = window.setTimeout(() => {
            if (!dragging && !scrollbar.matches(':focus-visible')) {
                scrollbar.classList.remove('visible');
            }
        }, 900);
    }

    function setScrollFromPointer(clientY, centerThumb = false) {
        const bounds = scrollbar.getBoundingClientRect();
        const maxScroll = scrollElement.scrollHeight - scrollElement.clientHeight;
        const thumbTravel = bounds.height - thumb.offsetHeight;
        if (maxScroll <= 0 || thumbTravel <= 0) return;
        const offset = centerThumb ? thumb.offsetHeight / 2 : dragOffset;
        const thumbTop = Math.max(0, Math.min(
            thumbTravel,
            clientY - bounds.top - offset,
        ));
        scrollElement.scrollTop = thumbTop / thumbTravel * maxScroll;
    }

    scrollElement.addEventListener('scroll', () => {
        onScroll();
        update();
        show();
    }, { passive: true });

    scrollbar.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        event.preventDefault();
        onPointerDown(event);
        dragging = true;
        scrollbar.setPointerCapture(event.pointerId);
        const thumbBounds = thumb.getBoundingClientRect();
        const onThumb = event.target === thumb;
        dragOffset = onThumb ? event.clientY - thumbBounds.top : thumb.offsetHeight / 2;
        if (!onThumb) setScrollFromPointer(event.clientY, true);
        show();
    });
    scrollbar.addEventListener('pointermove', event => {
        if (dragging) setScrollFromPointer(event.clientY);
    });

    const stopDragging = () => {
        if (!dragging) return;
        dragging = false;
        show();
    };
    scrollbar.addEventListener('pointerup', stopDragging);
    scrollbar.addEventListener('pointercancel', stopDragging);
    scrollbar.addEventListener('keydown', event => {
        const page = scrollElement.clientHeight * 0.85;
        if (event.key === 'ArrowUp') scrollElement.scrollTop -= 40;
        else if (event.key === 'ArrowDown') scrollElement.scrollTop += 40;
        else if (event.key === 'PageUp') scrollElement.scrollTop -= page;
        else if (event.key === 'PageDown') scrollElement.scrollTop += page;
        else if (event.key === 'Home') scrollElement.scrollTop = 0;
        else if (event.key === 'End') scrollElement.scrollTop = scrollElement.scrollHeight;
        else return;
        event.preventDefault();
        show();
    });

    window.addEventListener('resize', update);
    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(scrollElement);
    for (const element of observe) resizeObserver.observe(element);
    update();

    return {
        update,
        hide() {
            scrollbar.classList.remove('visible');
            scrollbar.tabIndex = -1;
        },
    };
}
