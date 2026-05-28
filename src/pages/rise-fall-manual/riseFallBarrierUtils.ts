/** Barrier offset helpers — aligned with `VanillaCallPut.tsx`. */

export const RISE_FALL_CUSTOM_BARRIER = '__custom__';

export function normalizeBarrierOffset(raw: string): string | null {
    const t = String(raw ?? '').trim();
    if (!t) return null;

    const n = Number(t);
    if (!Number.isFinite(n)) return null;

    const sign = n >= 0 ? '+' : '';
    return `${sign}${n.toFixed(2)}`;
}

export function parseAvailableBarriersFromError(msg: string): string[] | null {
    const m = msg.match(/Barriers available are\s+(.+?)(?:\.\s*|$)/i);
    if (!m) return null;

    const list = m[1]
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);

    const cleaned = list
        .map(x => normalizeBarrierOffset(x) ?? x)
        .filter(x => /^[-+]\d+(\.\d+)?$/.test(x) || /^\d+(\.\d+)?$/.test(x));

    return cleaned.length ? cleaned : list.length ? list : null;
}

export function parseBarrierOffsetNumber(raw: string): number | null {
    const t = String(raw ?? '').trim().replace(/^\+/, '');
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
}

/** Numeric delta from offset string (`+0.10` → 0.1) added to the live quote. */
export function parseBarrierOffsetDelta(raw: string): number {
    const n = parseBarrierOffsetNumber(raw);
    return n !== null ? n : 0;
}

/** HL preview barrier: current spot + selected offset (moves with every tick). */
export function computeLiveBarrierFromOffset(liveQuote: number, barrierOffset: string): number | null {
    if (!Number.isFinite(liveQuote)) return null;
    return liveQuote + parseBarrierOffsetDelta(barrierOffset);
}

/** Default HL offset: smallest strictly positive choice, else `+0.00`, else first. */
export function pickLeastPositiveBarrier(choices: string[]): string {
    if (!choices.length) return '+0.00';

    const positive = choices
        .map(raw => ({ raw, n: parseBarrierOffsetNumber(raw) }))
        .filter((x): x is { raw: string; n: number } => x.n !== null && x.n > 0)
        .sort((a, b) => a.n - b.n);

    if (positive.length) return positive[0].raw;

    const zero = choices.find(c => parseBarrierOffsetNumber(c) === 0);
    if (zero) return zero;

    return choices[0];
}

export function pickNextBarrier(choices: string[], current: string, preferLeastPositive = false): string {
    if (current && choices.includes(current)) return current;
    if (preferLeastPositive) return pickLeastPositiveBarrier(choices);
    if (choices.includes('+0.00')) return '+0.00';
    return choices[0] ?? '+0.00';
}
