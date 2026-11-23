"""Peak-rider bot for the cbBTC/USDC 24h race (agent-fun/bars-replay/v1).

The bot speaks the bars-replay protocol on stdin/stdout: one `hello` line
first, then one `batch` per 1-minute bar, then `done`. Each `batch` carries
the bar that just closed, the fills of the orders sent on the previous
batch, and the account. The bot answers every batch with exactly one reply
echoing its seq, carrying its orders for the next bar.

Strategy (chosen from the dev window's own numbers, 1440 one-minute bars):
  * The dev window trends up +3.64% with a max peak-to-trough drawdown of
    197.8 bps. Every fast trend filter tried on it (EMA cross, SMA trend)
    lost money to whipsaw (-$49..-$147); dip-buy mean reversion was flat
    (-$4..+$1.50); plain buy-and-hold made +$32.17. So the bot rides the
    trend: it buys 100% of its cash on the first tradable batch.
  * A trailing circuit breaker protects the race window: while holding, the
    bot tracks the running peak close; if a close falls 200 bps or more
    below that peak it sells the whole position and stays in cash for the
    rest of the window. On the dev window the breaker never fires (max
    drawdown 197.8 bps < 200 bps), so dev PnL equals buy-and-hold. On a
    mirrored downtrend window the same rule cuts the loss from -$38.39
    (buy-and-hold) to -$14.14. No re-entry: re-entering after a stop-out
    tested worse on every falling scenario.
  * Cost of one full round trip is ~26-34 bps (4 bps fee + 2 bps slippage
    + pool impact each way), so the bot trades at most twice: one buy,
    at most one sell. No re-entry, no tranche churn.

All decisions are pure integer arithmetic on the bar closes the harness
sends; no clock, no environment, no randomness, so two runs on the same
data produce byte-identical orders.
"""

import json
import sys

PROTOCOL = "agent-fun/bars-replay/v1"
SYMBOL = "CBBTC"

# Trailing stop: sell everything once a close is this far below the peak.
STOP_BPS = 200
# Max slippage vs the latest close an order tolerates (fill = next bar open
# +/- 2 bps slippage + own impact; 1-minute moves observed <= 72 bps).
MAX_SLIPPAGE_BPS = 500


def main():
    cash = 0
    qty = 0
    peak_close = None
    stopped_out = False
    order_no = 0
    warmup_bars = 0
    out = sys.stdout

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        msg = json.loads(line)
        kind = msg.get("type")

        if kind == "hello":
            if msg.get("protocol") != PROTOCOL:
                raise ValueError("unexpected protocol: %r" % (msg.get("protocol"),))
            cash = int(msg["capital"]["quote_units"])
            warmup_bars = int(msg.get("warmup_bars", 0))
            continue

        if kind == "done":
            break

        if kind != "batch":
            raise ValueError("unexpected message type: %r" % (kind,))

        seq = msg["seq"]
        account = msg["account"]
        cash = int(account["cash_quote_units"])
        positions = account.get("positions", [])
        qty = 0
        for pos in positions:
            if pos["symbol"] == SYMBOL:
                qty = int(pos["qty"])
                break

        close = None
        for bar in msg.get("bars", []):
            if bar["symbol"] == SYMBOL:
                close = int(bar["c"])
                break

        orders = []
        tradable = seq >= warmup_bars
        if tradable and close is not None:
            if qty == 0 and not stopped_out:
                # First tradable batch: ride the trend with all cash.
                # A rejected buy (e.g. a warmup batch miscounted) leaves
                # qty at 0, so the next batch simply tries again.
                if cash >= 1_000_000:
                    order_no += 1
                    orders.append({
                        "side": "buy",
                        "client_id": "b%d" % order_no,
                        "symbol": SYMBOL,
                        "notional_quote_units": str(cash),
                        "max_slippage_bps": MAX_SLIPPAGE_BPS,
                    })
            elif qty > 0:
                if peak_close is None or close > peak_close:
                    peak_close = close
                drawdown_bps = (peak_close - close) * 10_000 // peak_close
                if drawdown_bps >= STOP_BPS:
                    # Circuit breaker: exit everything, stay in cash.
                    stopped_out = True
                    order_no += 1
                    orders.append({
                        "side": "sell",
                        "client_id": "s%d" % order_no,
                        "symbol": SYMBOL,
                        "qty": str(qty),
                        "max_slippage_bps": MAX_SLIPPAGE_BPS,
                    })

        out.write(json.dumps(
            {"type": "reply", "seq": seq, "orders": orders},
            separators=(",", ":"),
        ) + "\n")
        out.flush()


if __name__ == "__main__":
    main()
