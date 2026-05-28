/** Win/loss feedback — matches paths used across the app (`BotIframe`, `multiple.tsx`, etc.). */

function playShortTone(freq: number, durationMs: number, wave: OscillatorType = 'sine'): void {
  try {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(0.11, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durationMs / 1000);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + durationMs / 1000);
  } catch {
    /* ignore */
  }
}

function syntheticWinLoss(won: boolean): void {
  if (won) {
    playShortTone(784, 130, 'sine');
    window.setTimeout(() => playShortTone(988, 150, 'sine'), 65);
  } else {
    playShortTone(185, 300, 'triangle');
  }
}

function playDomIfPresent(audioId: string): Promise<void> {
  const el = document.getElementById(audioId) as HTMLAudioElement | null;
  if (!el) return Promise.reject(new Error('no audio element'));
  el.volume = 0.45;
  el.currentTime = 0;
  return el.play().then(() => undefined);
}

function playPublicMp3(won: boolean): Promise<void> {
  const a = new Audio(won ? '/sounds/success.mp3' : '/sounds/fail.mp3');
  a.volume = 0.5;
  return a.play().then(() => undefined);
}

/**
 * Prefer bundled `<Audio />` clips (always deployed) over `/sounds/*.mp3` (often missing on Hostinger).
 * Falls back to short synthesized tones — never blocks trading on a 404/500.
 */
export function playTradeResultSound(won: boolean): void {
  void playDomIfPresent(won ? 'earned-money' : 'error')
    .catch(() => playPublicMp3(won))
    .catch(() => {
      syntheticWinLoss(won);
    });
}
