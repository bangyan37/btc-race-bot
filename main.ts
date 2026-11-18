// Slow-trend BTC bot for the bars-replay/v1 harness (cbBTC/USDC, 1-minute bars, long only).
//
// Idea: on a single noisy asset, most of the money is lost by trading too often — every round
// trip pays the 4 bps fee, 2 bps of modelled slippage and the pool impact of the fill. So this
// bot trades rarely and only rides moves that are already established:
//
//   - Indicators: two EMAs over the 1-minute closes, fast span 75 and slow span 200, each
//     seeded at the first close it sees and then updated by the usual 2 / (span + 1) step.
//     Nothing is decided until 202 bars have been seen, so the slow EMA has real history.
//   - Entry: the fast EMA crosses above the slow EMA (it was at or below it on the bar
//     before). The buy spends 50% of equity: half size keeps the fill's own price impact
//     near 5 bps instead of 10, and leaves the other half in cash whatever happens.
//   - Exit, the whole position, on whichever comes first: the fast EMA falls back below
//     the slow EMA, or the close falls 70 bps under the highest close since the buy was
//     decided (a trailing stop that locks the ride when the trend merely pauses).
//   - Guardrail fallback: if bar 1100 of a window arrives and the bot has still never
//     bought (a window that falls from the first bar gives no cross), it takes one small
//     20%-of-equity position on a bar that closes above both the fast EMA and the bar
//     before it, so the entry still makes at least one real trade; the normal exits
//     then apply. On any window with an ordinary cross this rule never fires.
//   - Every order caps its slippage at 250 bps past the close it was decided on: far above
//     any normal minute gap (the dev window's largest open gap is under 20 bps), so orders
//     are not refused in practice, but a wild print cannot fill the bot at any price.
//
// The EMAs run in float64 on + - * / alone, each correctly rounded (IEEE 754), and nothing
// reads the clock, the environment or a random source, so the same bars give the same
// orders, run after run.
//
// Laid out like the kit's baselines: the grader runs `node /bot/main.ts` with this
// directory mounted at /bot; vendor/makefun-bars.ts is a byte-identical copy of the kit's
// sdk/makefun-bars.ts.

import { runBars, type Bar, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const FAST_SPAN = 75;
const SLOW_SPAN = 200;
/** Bars to see before any decision: the slow span plus two. */
const WARM_BARS = SLOW_SPAN + 2;
/** Share of equity one ordinary entry spends: 50%. */
const ENTRY_BPS = 5_000n;
/** Share of equity the late fallback entry spends: 20%. */
const FALLBACK_BPS = 2_000n;
/** Trailing stop: sell when the close is this many bps under the peak close since entry. */
const TRAIL_BPS = 70;
/** Bar (0-based count of bars seen) at which the fallback may first fire. */
const FALLBACK_AFTER = 1100;
const MAX_SLIPPAGE_BPS = 250;

interface Series {
  fast: number | null;
  slow: number | null;
  /** fast - slow on the previous bar, once both EMAs exist. */
  prevGap: number | null;
  /** Highest close since the current position's buy was decided. */
  peak: number;
  /** The close of the bar before the latest one (0 before the first). */
  prevClose: number;
  /** The latest close seen. */
  lastClose: number;
  bars: number;
}

const series = new Map<string, Series>();

function step(span: number, value: number | null, close: number): number {
  if (value === null) return close;
  return value + (2 / (span + 1)) * (close - value);
}

function push(bar: Bar): { s: Series; gap: number | null; crossedUp: boolean } {
  let s = series.get(bar.symbol);
  if (s === undefined) {
    s = { fast: null, slow: null, prevGap: null, peak: 0, prevClose: 0, lastClose: 0, bars: 0 };
    series.set(bar.symbol, s);
  }
  const close = Number(bar.c);
  s.prevClose = s.lastClose;
  s.lastClose = close;
  const before = s.fast !== null && s.slow !== null ? s.fast - s.slow : null;
  s.fast = step(FAST_SPAN, s.fast, close);
  s.slow = step(SLOW_SPAN, s.slow, close);
  s.bars += 1;
  const gap = s.fast - s.slow;
  const crossedUp = before !== null && before <= 0 && gap > 0;
  s.prevGap = before;
  return { s, gap, crossedUp };
}

let boughtOnce = false;

await runBars({
  onBatch(state, batch) {
    const fresh = new Map<string, { s: Series; gap: number | null; crossedUp: boolean; close: number }>();
    for (const bar of batch.bars) {
      const r = push(bar);
      fresh.set(bar.symbol, { ...r, close: Number(bar.c) });
    }
    if (state.warmingUp) return [];
    const orders: (BuyInput | SellInput)[] = [];
    for (const { symbol } of state.hello.symbols) {
      const f = fresh.get(symbol);
      if (f === undefined) continue;
      const held = state.positions.get(symbol);
      if (held !== undefined) boughtOnce = true;
      if (f.s.bars < WARM_BARS) continue;
      if (held !== undefined) {
        if (f.close > f.s.peak) f.s.peak = f.close;
        const trailed = f.s.peak > 0 && f.close * 10_000 <= f.s.peak * (10_000 - TRAIL_BPS);
        if (trailed || (f.gap !== null && f.gap < 0)) {
          orders.push({ side: 'sell', symbol, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
        }
        continue;
      }
      f.s.peak = 0;
      const equity = state.equity;
      if (f.crossedUp) {
        const notional = (equity * ENTRY_BPS) / 10_000n;
        const spend = notional < state.cash ? notional : state.cash;
        if (spend >= BigInt(state.hello.fees.min_notional_quote_units) && spend <= state.weightRoom(symbol)) {
          f.s.peak = f.close;
          boughtOnce = true;
          orders.push({ side: 'buy', symbol, notional_quote_units: spend, max_slippage_bps: MAX_SLIPPAGE_BPS });
        }
      } else if (!boughtOnce && f.s.bars >= FALLBACK_AFTER && f.s.fast !== null && f.close > f.s.fast && f.close > f.s.prevClose) {
        const notional = (equity * FALLBACK_BPS) / 10_000n;
        const spend = notional < state.cash ? notional : state.cash;
        if (spend >= BigInt(state.hello.fees.min_notional_quote_units) && spend <= state.weightRoom(symbol)) {
          f.s.peak = f.close;
          boughtOnce = true;
          orders.push({ side: 'buy', symbol, notional_quote_units: spend, max_slippage_bps: MAX_SLIPPAGE_BPS });
        }
      }
    }
    return orders;
  },
});
