// Peak-rider bot for the cbBTC/USDC 24h race (agent-fun/bars-replay/v1).
//
// The bot speaks the bars-replay protocol on stdin/stdout: one `hello` line
// first, then one `batch` per 1-minute bar, then `done`. Each `batch` carries
// the bar that just closed, the fills of the orders sent on the previous
// batch, and the account. The bot answers every batch with exactly one reply
// echoing its seq, carrying its orders for the next bar.
//
// Strategy (chosen from the dev window's own numbers, 1440 one-minute bars):
//   * The dev window trends up +3.64% with a max peak-to-trough drawdown of
//     197.8 bps. Every fast trend filter tried on it (EMA cross, SMA trend)
//     lost money to whipsaw (-$49..-$147); dip-buy mean reversion was flat
//     (-$4..+$1.50); plain buy-and-hold made +$32.17. So the bot rides the
//     trend: it buys 100% of its cash on the first tradable batch.
//   * A trailing circuit breaker protects the race window: while holding, the
//     bot tracks the running peak close; if a close falls 200 bps or more
//     below that peak it sells the whole position and stays in cash for the
//     rest of the window. On the dev window the breaker never fires (max
//     drawdown 197.8 bps < 200 bps), so dev PnL equals buy-and-hold. On a
//     mirrored downtrend window the same rule cuts the loss from -$38.39
//     (buy-and-hold) to -$14.14. No re-entry: re-entering after a stop-out
//     tested worse on every falling scenario.
//   * Cost of one full round trip is ~26-34 bps (4 bps fee + 2 bps slippage
//     + pool impact each way), so the bot trades at most twice: one buy,
//     at most one sell. No re-entry, no tranche churn.
//
// All decisions are pure integer arithmetic on the bar closes the harness
// sends; no clock, no environment, no randomness, so two runs on the same
// data produce byte-identical orders.

import * as readline from "node:readline";

const PROTOCOL = "agent-fun/bars-replay/v1";
const SYMBOL = "CBBTC";

// Trailing stop: sell everything once a close is this far below the peak.
const STOP_BPS = 200n;
// Max slippage vs the latest close an order tolerates (fill = next bar open
// +/- 2 bps slippage + own impact; 1-minute moves observed <= 72 bps).
const MAX_SLIPPAGE_BPS = 500;

interface Order {
  side: "buy" | "sell";
  client_id: string;
  symbol: string;
  notional_quote_units?: string;
  qty?: string;
  max_slippage_bps: number;
}

async function main(): Promise<void> {
  let cash = 0n;
  let qty = 0n;
  let peakClose: bigint | null = null;
  let exitArmed = false; // breaker tripped: sell until flat, then stay out
  let stoppedOut = false;
  let orderNo = 0;
  let warmupBars = 0;

  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    const text = line.trim();
    if (text === "") continue;
    const msg = JSON.parse(text) as Record<string, unknown>;
    const kind = msg["type"] as string;

    if (kind === "hello") {
      if (msg["protocol"] !== PROTOCOL) {
        throw new Error(`unexpected protocol: ${String(msg["protocol"])}`);
      }
      const capital = msg["capital"] as Record<string, unknown>;
      cash = BigInt(capital["quote_units"] as string);
      warmupBars = Number(msg["warmup_bars"] ?? 0);
      continue;
    }

    if (kind === "done") break;
    if (kind !== "batch") throw new Error(`unexpected message type: ${kind}`);

    const seq = msg["seq"] as number;
    const account = msg["account"] as Record<string, unknown>;
    cash = BigInt(account["cash_quote_units"] as string);
    qty = 0n;
    for (const pos of account["positions"] as Array<Record<string, unknown>>) {
      if (pos["symbol"] === SYMBOL) qty = BigInt(pos["qty"] as string);
    }

    let close: bigint | null = null;
    for (const bar of msg["bars"] as Array<Record<string, unknown>>) {
      if (bar["symbol"] === SYMBOL) close = BigInt(bar["c"] as string);
    }

    const orders: Order[] = [];
    const tradable = seq >= warmupBars;
    if (tradable && close !== null) {
      if (qty === 0n && exitArmed) {
        // The exit sell filled: stay in cash for the rest of the window.
        stoppedOut = true;
        exitArmed = false;
      }
      if (qty === 0n && !stoppedOut && !exitArmed) {
        // First tradable batch: ride the trend with all cash. A rejected
        // buy leaves qty at 0, so the next batch simply tries again.
        if (cash >= 1_000_000n) {
          orderNo += 1;
          orders.push({
            side: "buy",
            client_id: `b${orderNo}`,
            symbol: SYMBOL,
            notional_quote_units: cash.toString(),
            max_slippage_bps: MAX_SLIPPAGE_BPS,
          });
        }
      } else if (qty > 0n) {
        if (peakClose === null || close > peakClose) peakClose = close;
        const drawdownBps = ((peakClose - close) * 10000n) / peakClose;
        if (drawdownBps >= STOP_BPS) exitArmed = true;
        if (exitArmed) {
          // Circuit breaker: exit everything. If this sell is rejected
          // (e.g. the next open gaps past max slippage) qty stays > 0
          // and the next batch sends the sell again.
          orderNo += 1;
          orders.push({
            side: "sell",
            client_id: `s${orderNo}`,
            symbol: SYMBOL,
            qty: qty.toString(),
            max_slippage_bps: MAX_SLIPPAGE_BPS,
          });
        }
      }
    }

    process.stdout.write(
      JSON.stringify({ type: "reply", seq, orders }) + "\n",
    );
  }
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
