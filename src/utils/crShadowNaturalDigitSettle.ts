/**
 * CR7557018 shadow digit trades: settle from real `ticks_history` + `proposal` only
 * (no `decideFlipVirtualPair` / after-fact governor).
 */
import { autotradeStrategyLastDigitFromQuote } from '@/pages/autotrade/autotradeStrategyTickDigitFormat';
import type ClientStore from '@/stores/client-store';
import {
  ALLOWED_BOT_IFRAME_LOGINID,
  runWithCrShadowLock,
  tryDebitCrShadowSync,
} from '@/utils/crVirtualBalanceShadow';

export type NaturalDigitShadowParams = {
  contract_type: string;
  duration: number;
  symbol: string;
  barrier?: string;
  stake: number;
  currency?: string;
};

function lastDigit(quote: number, market: string): number {
  return autotradeStrategyLastDigitFromQuote(quote, market);
}

function naturalWin(
  contractType: string,
  market: string,
  entryQuote: number,
  exitQuote: number,
  barrier?: string
): boolean {
  const b = barrier != null && barrier !== '' ? Number(barrier) : NaN;
  const ldX = lastDigit(exitQuote, market);

  switch (contractType) {
    case 'DIGITEVEN':
      return ldX % 2 === 0;
    case 'DIGITODD':
      return ldX % 2 === 1;
    case 'CALL':
      return exitQuote > entryQuote;
    case 'PUT':
      return exitQuote < entryQuote;
    case 'DIGITOVER':
      return Number.isFinite(b) && ldX > b;
    case 'DIGITUNDER':
      return Number.isFinite(b) && ldX < b;
    case 'DIGITMATCH':
      return Number.isFinite(b) && ldX === b;
    case 'DIGITDIFF':
      return Number.isFinite(b) && ldX !== b;
    default:
      return false;
  }
}

export type NaturalDigitShadowResult = {
  virtId: string;
  ask: number;
  payout: number;
  win: boolean;
  net: number;
  entryEpoch: number;
  exitEpoch: number;
  entryQuote: number;
  exitQuote: number;
};

/**
 * Uses `send` like `api_base.api.send`. Debits shadow balance on success.
 */
export async function settleNaturalDigitShadowTrade(
  send: (msg: Record<string, unknown>) => Promise<any>,
  client: ClientStore,
  params: NaturalDigitShadowParams
): Promise<NaturalDigitShadowResult> {
  const { contract_type, duration, symbol, barrier, stake } = params;
  const currency = params.currency ?? 'USD';
  const dur = Math.max(1, Math.floor(Number(duration) || 1));
  const count = Math.min(5000, dur + 8);

  const proposalResp = await send({
    proposal: 1,
    amount: stake,
    basis: 'stake',
    currency,
    contract_type,
    duration: dur,
    duration_unit: 't',
    symbol,
    ...(barrier != null && barrier !== '' ? { barrier: String(barrier) } : {}),
  });
  if (proposalResp?.error) throw new Error(proposalResp.error?.message || 'Proposal failed');

  const pr = proposalResp.proposal as { ask_price?: number; payout?: number };
  const ask = Number(pr.ask_price ?? stake);
  const payout = Number(pr.payout ?? stake * 1.95);

  const hist = await send({
    ticks_history: symbol,
    style: 'ticks',
    count,
    end: 'latest',
  });
  if (hist?.error) throw new Error(hist.error?.message || 'Ticks history failed');

  const prices = (hist.history?.prices as number[] | undefined)?.map(Number) ?? [];
  const times = (hist.history?.times as number[] | undefined)?.map(Number) ?? [];
  if (prices.length < dur + 1 || times.length < dur + 1) {
    throw new Error('Not enough ticks to settle (virtual)');
  }

  const i0 = prices.length - 1 - dur;
  const entryQuote = prices[i0];
  const exitQuote = prices[prices.length - 1];
  const entryEpoch = times[i0];
  const exitEpoch = times[times.length - 1];

  const win = naturalWin(contract_type, symbol, entryQuote, exitQuote, barrier);

  const debitOk = await runWithCrShadowLock(() => tryDebitCrShadowSync(client, ALLOWED_BOT_IFRAME_LOGINID, ask));
  if (!debitOk) throw new Error('Insufficient balance');

  const net = Number((win ? payout - ask : -ask).toFixed(2));
  const virtId = `v-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return {
    virtId,
    ask,
    payout,
    win,
    net,
    entryEpoch,
    exitEpoch,
    entryQuote,
    exitQuote,
  };
}
