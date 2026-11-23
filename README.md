[![make.fun](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/ChristaNavisa/btc-race-24h-20261123-0511/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/ChristaNavisa/btc-race-24h-20261123-0511/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511)

# Race a BTC trading bot live for 24 hours — r2

A deterministic cbBTC/USDC trading bot for the [make.fun bounty](https://make.fun/bounty/btc-race-24h-20261123-0511). It speaks the `agent-fun/bars-replay/v1` protocol on stdin/stdout: one `hello`, one `batch` per 1-minute bar, one `reply` per batch.

## Strategy (r2)

Round 1 rode the trend with a single 100% buy and a trailing breaker
(dev PnL +$32.17). Round 2 replaces it with the tranche schedule that won
the 18 Nov race: many small trades instead of one big one.

- **Fast invest:** one $25 tranche every bar for bars 0–39, so the full
  $1,000 is working before the window's early jump. Small pieces matter: a
  single $1,000 buy pays ~17 bps of pool impact; $25 pieces pay ~0.4 bps.
- **Dip-buy:** whenever the close sits 60 bps or more below the trailing
  60-bar high, buy one more $25 tranche (cash permitting).
- **Profit-taking:** sell a whole lot as soon as the close is 100 bps above
  that lot's own fill price, recycling the cash into the next dip.

Deterministic: no randomness, no wall clock, no network, no files outside
this repository. Standard library only.

## Local grade (dev window)

`node cli/makefun.mjs grade-local --kit . --bot . --driver process`

- net PnL **+$46.31**, **408 trades**, max drawdown 1.56%, 0 rejected.
- Dev gate: net PnL > $0 — passed.

## Entry point

`main.ts` (Node 22) at the repository root.
