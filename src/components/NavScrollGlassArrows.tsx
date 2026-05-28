import type { ScrollClipNavEdges } from '@/hooks/useScrollClipGlassNav';

type NavScrollGlassArrowsProps = {
    edges: ScrollClipNavEdges;
    scrollNav: (direction: -1 | 1) => void;
    ariaPrev?: string;
    ariaNext?: string;
};

export function NavScrollGlassArrows({
    edges,
    scrollNav,
    ariaPrev = 'Scroll options left',
    ariaNext = 'Scroll options right',
}: NavScrollGlassArrowsProps) {
    return (
        <>
            <button
                type="button"
                className={`stp-nav-glass stp-nav-glass--prev ${edges.prev ? 'stp-nav-glass--visible' : ''}`}
                aria-label={ariaPrev}
                tabIndex={edges.prev ? 0 : -1}
                onClick={() => scrollNav(-1)}
            >
                <svg
                    width={18}
                    height={18}
                    viewBox="0 0 24 24"
                    aria-hidden
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2.2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    <path d="M14 6l-6 6 6 6" />
                </svg>
            </button>
            <button
                type="button"
                className={`stp-nav-glass stp-nav-glass--next ${edges.next ? 'stp-nav-glass--visible' : ''}`}
                aria-label={ariaNext}
                tabIndex={edges.next ? 0 : -1}
                onClick={() => scrollNav(1)}
            >
                <svg
                    width={18}
                    height={18}
                    viewBox="0 0 24 24"
                    aria-hidden
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2.2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    <path d="M10 6l6 6-6 6" />
                </svg>
            </button>
        </>
    );
}
