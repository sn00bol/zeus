export function initializeScrollbar({
    scrollElement,
    scrollbar,
    thumb,
    axis = 'vertical',
    layoutTrack = () => {},
    onScrollableChange = () => {},
    onScroll = () => {},
    onPointerDown = () => {},
    observe = [],
}) {
    const horizontal = axis === 'horizontal';
    let dragging = false;
    let dragOffset = 0;
    let hideTimer;
    const listenerController = new AbortController();
    const { signal } = listenerController;
    const resizeObserver = new ResizeObserver(update);

    function update() {
        layoutTrack();
        const maxScroll = horizontal
            ? scrollElement.scrollWidth - scrollElement.clientWidth
            : scrollElement.scrollHeight - scrollElement.clientHeight;
        const trackSize = horizontal ? scrollbar.clientWidth : scrollbar.clientHeight;
        if (maxScroll <= 1 || trackSize <= 0) {
            onScrollableChange(false);
            scrollbar.classList.remove('visible');
            scrollbar.tabIndex = -1;
            return;
        }

        onScrollableChange(true);
        scrollbar.tabIndex = 0;
        const thumbSize = Math.min(
            trackSize,
            Math.max(30, trackSize * (
                horizontal
                    ? scrollElement.clientWidth / scrollElement.scrollWidth
                    : scrollElement.clientHeight / scrollElement.scrollHeight
            )),
        );
        const thumbTravel = trackSize - thumbSize;
        const progress = (horizontal ? scrollElement.scrollLeft : scrollElement.scrollTop) / maxScroll;
        thumb.style[horizontal ? 'width' : 'height'] = `${thumbSize}px`;
        thumb.style[horizontal ? 'left' : 'top'] = `${thumbTravel * progress}px`;
        scrollbar.setAttribute('aria-valuenow', String(Math.round(progress * 1000)));
    }

    function show() {
        const maxScroll = horizontal
            ? scrollElement.scrollWidth - scrollElement.clientWidth
            : scrollElement.scrollHeight - scrollElement.clientHeight;
        if (maxScroll <= 1) return;
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
        const maxScroll = horizontal
            ? scrollElement.scrollWidth - scrollElement.clientWidth
            : scrollElement.scrollHeight - scrollElement.clientHeight;
        const trackSize = horizontal ? bounds.width : bounds.height;
        const thumbSize = horizontal ? thumb.offsetWidth : thumb.offsetHeight;
        const thumbTravel = trackSize - thumbSize;
        if (maxScroll <= 0 || thumbTravel <= 0) return;
        const offset = centerThumb ? thumbSize / 2 : dragOffset;
        const pointerPosition = horizontal ? clientY - bounds.left : clientY - bounds.top;
        const thumbTop = Math.max(0, Math.min(
            thumbTravel,
            pointerPosition - offset,
        ));
        if (horizontal) scrollElement.scrollLeft = thumbTop / thumbTravel * maxScroll;
        else scrollElement.scrollTop = thumbTop / thumbTravel * maxScroll;
    }

    scrollElement.addEventListener('scroll', () => {
        onScroll();
        update();
        show();
    }, { passive: true, signal });

    scrollbar.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        event.preventDefault();
        onPointerDown(event);
        dragging = true;
        scrollbar.setPointerCapture(event.pointerId);
        const thumbBounds = thumb.getBoundingClientRect();
        const onThumb = event.target === thumb;
        const pointerPosition = horizontal ? event.clientX : event.clientY;
        const thumbStart = horizontal ? thumbBounds.left : thumbBounds.top;
        dragOffset = onThumb ? pointerPosition - thumbStart : 0;
        if (!onThumb) setScrollFromPointer(pointerPosition, true);
        show();
    }, { signal });
    scrollbar.addEventListener('pointermove', event => {
        if (dragging) setScrollFromPointer(horizontal ? event.clientX : event.clientY);
    }, { signal });

    const stopDragging = () => {
        if (!dragging) return;
        dragging = false;
        show();
    };
    scrollbar.addEventListener('pointerup', stopDragging, { signal });
    scrollbar.addEventListener('pointercancel', stopDragging, { signal });
    scrollbar.addEventListener('keydown', event => {
        const scrollPosition = horizontal ? 'scrollLeft' : 'scrollTop';
        const pageSize = (horizontal ? scrollElement.clientWidth : scrollElement.clientHeight) * 0.85;
        if ((!horizontal && event.key === 'ArrowUp') || (horizontal && event.key === 'ArrowLeft')) {
            scrollElement[scrollPosition] -= 40;
        } else if ((!horizontal && event.key === 'ArrowDown') || (horizontal && event.key === 'ArrowRight')) {
            scrollElement[scrollPosition] += 40;
        } else if (event.key === 'PageUp') scrollElement[scrollPosition] -= pageSize;
        else if (event.key === 'PageDown') scrollElement[scrollPosition] += pageSize;
        else if (event.key === 'Home') scrollElement[scrollPosition] = 0;
        else if (event.key === 'End') {
            scrollElement[scrollPosition] = horizontal ? scrollElement.scrollWidth : scrollElement.scrollHeight;
        } else return;
        event.preventDefault();
        show();
    }, { signal });

    window.addEventListener('resize', update);
    resizeObserver.observe(scrollElement);
    for (const element of observe) resizeObserver.observe(element);
    update();

    return {
        update,
        hide() {
            scrollbar.classList.remove('visible');
            scrollbar.tabIndex = -1;
        },
        destroy() {
            if (hideTimer) window.clearTimeout(hideTimer);
            listenerController.abort();
            resizeObserver.disconnect();
            window.removeEventListener('resize', update);
        },
    };
}
