/**
 * Deriv tick stream helpers shared by ManualTrader, BotIframe, etc.
 * Avoids `forget_all` on component unmount (breaks other mounted pages).
 */

export function isAlreadySubscribedTickError(err: unknown): boolean {
  const e = err as { code?: string; message?: string; error?: { code?: string; message?: string } };
  const code = e?.code ?? e?.error?.code ?? '';
  const msg = String(e?.message ?? e?.error?.message ?? '');
  return code === 'AlreadySubscribed' || msg.includes('already subscribed');
}

type DerivApiLike = {
  send: (req: Record<string, unknown>) => Promise<Record<string, unknown> | undefined>;
};

export async function forgetDerivSubscription(api: DerivApiLike | null | undefined, subscriptionId: string | null) {
  if (!api || !subscriptionId) return;
  try {
    await api.send({ forget: subscriptionId });
  } catch {
    /* noop */
  }
}

/** Clears server-side tick streams — use before re-subscribe after AlreadySubscribed, not on unmount. */
export async function forgetAllDerivTickStreams(api: DerivApiLike | null | undefined) {
  if (!api) return;
  try {
    await api.send({ forget_all: 'ticks' });
  } catch {
    /* noop */
  }
}

export async function forgetAllDerivCandleStreams(api: DerivApiLike | null | undefined) {
  if (!api) return;
  try {
    await api.send({ forget_all: 'candles' });
  } catch {
    /* noop */
  }
}

/** Live tick stream only (`ticks` API) — use when `ticks_history` returns AlreadySubscribed. */
export async function subscribeDerivLiveTicks(
  api: DerivApiLike,
  symbol: string
): Promise<{ subscriptionId: string | null; error?: unknown }> {
  const resp = await api.send({ ticks: symbol, subscribe: 1 });
  if (resp?.error) {
    return { subscriptionId: null, error: resp.error };
  }
  const subscriptionId = resp?.subscription?.id ? String(resp.subscription.id) : null;
  return { subscriptionId };
}

/**
 * Hard reset + live `ticks` subscribe. Call after AlreadySubscribed or when ticks go silent.
 */
export async function recoverDerivLiveTickStream(
  api: DerivApiLike,
  symbol: string
): Promise<{ subscriptionId: string | null; error?: unknown }> {
  await forgetAllDerivTickStreams(api);
  return subscribeDerivLiveTicks(api, symbol);
}
