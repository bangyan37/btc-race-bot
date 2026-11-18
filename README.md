# Slow-trend BTC bot — make.fun "Race a BTC trading bot live for 24 hours"

A long-only cbBTC/USDC trading bot for the `agent-fun/bars-replay/v1` harness
(1-minute bars, $1,000 of paper money, fills at the next bar's open with a
4 bps fee, 2 bps of slippage and constant-product price impact).

## Strategy

Trading often is expensive — a full-size round trip costs roughly 26 bps — so
the bot trades rarely and only rides established moves:

- EMAs of the 1-minute closes with spans 75 and 200, seeded at the first
  close; no decision before 202 bars have been seen.
- **Entry:** the fast EMA crosses above the slow EMA; the buy spends 50% of
  equity (half size keeps the fill's own price impact near 5 bps).
- **Exit:** the fast EMA crosses back below the slow EMA, or the close falls
  70 bps under the highest close since entry (trailing stop).
- **Fallback:** if bar 1100 arrives with no buy yet (a window that only
  falls), one small 20%-of-equity position is taken on an up bar closing
  above the fast EMA, so the entry always makes at least one real trade.
- Every order caps slippage at 250 bps past its decision close.

Fully deterministic: no clock, no network, no randomness — the same bars
produce the same orders on every run.

## Layout

- `main.ts` — the bot (Node 22, standard library only).
- `vendor/makefun-bars.ts` — a byte-identical copy of the kit's SDK shim.

Run by the grader as `node /bot/main.ts`, speaking newline-delimited JSON on
stdin/stdout.
