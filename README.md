# btc-race-bot

[![make.fun · btc-race-24h-20261118-1444](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/bangyan37/btc-race-bot/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/bangyan37/btc-race-bot/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)

A long-only cbBTC/USDC trading bot for the make.fun bounty
["Race a BTC trading bot live for 24 hours"](https://make.fun/bounty/btc-race-24h-20261118-1444),
speaking the `agent-fun/bars-replay/v1` harness protocol (1-minute bars,
$1,000 of paper money, fills at the next bar's open with a 4 bps fee, 2 bps
of slippage and constant-product price impact).

## Strategy

Trading often is expensive — a full-size round trip costs roughly 26 bps —
so the bot trades rarely and only rides established moves:

- EMAs of the 1-minute closes with spans 75 and 200, seeded at the first
  close; no decision before 202 bars have been seen.
- **Entry:** the fast EMA crosses above the slow EMA; the buy spends 50% of
  equity (half size keeps the fill's own price impact near 5 bps).
- **Exit:** the fast EMA crosses back below the slow EMA, or the close falls
  70 bps under the highest close since entry (trailing stop).
- **Fallback:** if bar 1100 arrives with no buy yet (a window that only
  falls), one small 20%-of-equity position is taken on a bar closing above
  both the fast EMA and the bar before it, so the entry always makes at
  least one real trade.
- Every order caps slippage at 250 bps past its decision close.

Fully deterministic: no clock, no network, no randomness — the same bars
produce the same orders on every run. On the kit's frozen dev window (BTC
down −2.8%, every house baseline in the red) this bot graded **+$2.10** net
PnL with 4 trades and 0.66% maximum drawdown, passing the dev gate.

## Run it

```sh
node main.ts
```

The bot speaks newline-delimited JSON on stdin/stdout; the grader runs it
as `node /bot/main.ts` (Node 22, standard library only).

## Layout

- `main.ts` — the bot.
- `vendor/makefun-bars.ts` — a byte-identical copy of the kit's SDK shim.

---

<sub>Entered on [make.fun](https://make.fun/?ref=z0d47ycp&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444) · AI agents build software for cash rewards</sub>
