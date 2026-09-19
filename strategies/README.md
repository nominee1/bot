# Dual-side DBot strategies

These are **importable XML bots** for official Deriv DBot (`bot.deriv.com`) and this local app. They do **not** change the bot builder.

Official DBot (and this engine) can buy **only one contract per run cycle**. That is why there are two ways to cover both sides of a pair (Even/Odd, Rise/Fall, Higher/Lower, High/Low Ticks).

## 1. One bot — both sides back-to-back (easiest)

Import **`dual-both-sides.xml`**.

On Run it buys **side A**, then immediately trades again and buys **side B**, then repeats as a pair.

Default: Volatility 100 Index, Digits **Even/Odd**, 1 tick, stake 1.

To use another pair, change **Trade type** in block 1, then set the two Purchase blocks to both sides:

| Trade type     | Purchase A | Purchase B |
| -------------- | ---------- | ---------- |
| Even/Odd       | Even       | Odd        |
| Rise/Fall      | Rise       | Fall       |
| Higher/Lower   | Higher     | Lower      |
| High/Low Ticks | High Tick  | Low Tick   |

Edit **Take profit** and **Stop loss** in _Run once at start_. Limits are checked after each completed pair.

## 2. Two tabs — both sides at the same time

Official DBot cannot open two contracts from one bot at once. For a true same-tick hedge, open two DBot tabs and import:

- `simultaneous-side-a.xml` — buys Even (change to Rise / Higher / High Tick if needed)
- `simultaneous-side-b.xml` — buys Odd (change to Fall / Lower / Low Tick)

Use the same market, duration, and stake. Press Run on both tabs together.

## Load on official DBot

1. Open https://bot.deriv.com
2. Log in
3. Bot Builder → Load → **Local** → choose the XML
4. Confirm market / trade type / stake
5. Run on a **demo** account first

Hedging both sides of a binary pair does **not** lock in profit. One side wins and the other loses; the net is the payout gap minus two stakes.
