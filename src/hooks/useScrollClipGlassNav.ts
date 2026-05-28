import { useCallback, useLayoutEffect, useRef, useState } from 'react';

export type ScrollClipNavEdges = { prev: boolean; next: boolean };

/** Tracks horizontal scroll edges on a rail (mobile) and exposes smooth scroll-by-page — same logic as multi.tsx strategy nav. */
export function useScrollClipGlassNav(layoutKey?: unknown) {
    const navRef = useRef<HTMLElement | null>(null);
    const [edges, setEdges] = useState<ScrollClipNavEdges>({ prev: false, next: false });

    const updateEdges = useCallback(() => {
        const el = navRef.current;
        if (!el) return;
        const { scrollLeft, scrollWidth, clientWidth } = el;
        const maxScroll = scrollWidth - clientWidth;
        const eps = 8;
        setEdges({
            prev: scrollLeft > eps,
            next: maxScroll > eps && scrollLeft < maxScroll - eps,
        });
    }, []);

    useLayoutEffect(() => {
        const el = navRef.current;
        if (!el) return;
        updateEdges();
        el.addEventListener('scroll', updateEdges, { passive: true });
        const ro = new ResizeObserver(() => updateEdges());
        ro.observe(el);
        window.addEventListener('resize', updateEdges);
        return () => {
            el.removeEventListener('scroll', updateEdges);
            ro.disconnect();
            window.removeEventListener('resize', updateEdges);
        };
    }, [updateEdges, layoutKey]);

    const scrollNav = useCallback((direction: -1 | 1) => {
        const el = navRef.current;
        if (!el) return;
        const delta = Math.max(140, Math.floor(el.clientWidth * 0.72)) * direction;
        el.scrollBy({ left: delta, behavior: 'smooth' });
    }, []);

    return { navRef, edges, scrollNav };
}
