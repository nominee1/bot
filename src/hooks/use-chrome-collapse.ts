import { useEffect } from 'react';

/** Scroll-linked hide of the fake Chrome omnibox (0 → bar height). */
export const useChromeCollapse = (resetKey: string) => {
    useEffect(() => {
        const root = document.documentElement;
        let lastY = window.scrollY;
        let collapse = 0;
        let frame = 0;

        const maxCollapse = () => {
            if (window.matchMedia('(min-width: 768px)').matches) return 0;
            const bar = document.querySelector('.chrome-url-bars-mobile');
            return bar instanceof HTMLElement ? bar.offsetHeight : 0;
        };

        const apply = (next: number) => {
            collapse = next;
            root.style.setProperty('--chrome-collapse', `${next}px`);
        };

        const onScroll = () => {
            if (frame) return;
            frame = window.requestAnimationFrame(() => {
                frame = 0;
                const max = maxCollapse();
                const y = Math.max(0, window.scrollY);
                if (max <= 0) {
                    lastY = y;
                    if (collapse !== 0) apply(0);
                    return;
                }
                if (y <= 0) {
                    lastY = 0;
                    if (collapse !== 0) apply(0);
                    return;
                }
                const next = Math.min(max, Math.max(0, collapse + (y - lastY)));
                lastY = y;
                if (next !== collapse) apply(next);
            });
        };

        apply(0);
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => {
            window.removeEventListener('scroll', onScroll);
            if (frame) window.cancelAnimationFrame(frame);
            root.style.setProperty('--chrome-collapse', '0px');
        };
    }, [resetKey]);
};
