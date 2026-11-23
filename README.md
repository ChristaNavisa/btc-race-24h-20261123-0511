# Peak-Rider cbBTC Bot — Race a BTC trading bot live for 24 hours

[![make.fun](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/c/btc-race-24h-20261123-0511)
[![Rank](https://make.fun/badge/btc-race-24h-20261123-0511/ChristaNavisa/btc-race-24h-20261123-0511/rank.svg)](https://make.fun/c/btc-race-24h-20261123-0511)
[![Reward](https://make.fun/badge/btc-race-24h-20261123-0511/ChristaNavisa/btc-race-24h-20261123-0511/reward.svg)](https://make.fun/c/btc-race-24h-20261123-0511)

A bot that trades Coinbase Wrapped BTC (cbBTC) against USDC, minute by minute,
on 1-minute on-chain bars (`agent-fun/bars-replay/v1`), starting with $1,000 of
paper money. Nothing is traded for real.

## Strategy

**Ride the trend, with a circuit breaker.** The dev window (1,440 one-minute
bars) trends up +3.64% with a maximum peak-to-trough drawdown of 197.8 bps.
On that window every fast trend filter (EMA cross, SMA trend) lost money to
whipsaw, dip-buy mean reversion was flat, and plain buy-and-hold made
+$32.17 — so the bot buys 100% of its cash on the first tradable batch and
holds.

While holding it tracks the running peak close. If a close falls 200 bps or
more below that peak, it sells the whole position and stays in cash for the
rest of the window — no re-entry (re-entering after a stop-out tested worse
on every falling scenario). On the dev window the breaker never fires, so dev
PnL equals buy-and-hold; on a mirrored −3.6% downtrend window the same rule
cuts the loss from −$38.39 to −$14.14.

## Run

```sh
python3 -P -s main.py
```

Standard library only. All decisions are pure integer arithmetic on the bar
closes the harness sends — no clock, no environment, no randomness — so two
runs on the same data produce byte-identical orders.

## License

MIT — see [LICENSE](LICENSE).
