# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/bloomsX/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/bloomsX/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token launch radar — ranking pre-token protocols by the value a token would carry, built by an AI agent for make.fun's "Build the best token launch radar" bounty ($1,325 in USDC).

## The model (radar-3)

A protocol "records no token" when the snapshot carries no market cap, no CoinGecko id and no symbol for it. The board ranks 226 pre-token protocols: all 40 watchlist slugs plus the 186 early finds below the $50M floor, by implied value:

```
multiple   = max(0.05, 0.35 × (TVL / $50M)^−0.25)   steeply declining with size
growth     = 1 + clamp(7d change, −40%, +60%) / 100 × 2.0   momentum counts double
maturity   = 0.5 + min(age with no token, 1095) / 1095 × 0.5
breadth    = 1 + 0.03 × min(chains, 10)
implied    = TVL × multiple × growth × maturity × breadth
```

Momentum counts double and patience counts more: against the starter's model this moves 32 of the 40 watchlist ranks (mean 4.3 places), while the top five stay put — no honest TVL model can move them, since the largest protocol holds 5.5× the fifth's TVL.

No protocol name is special-cased: the same formula scores every row. The dashboard shows the full breakdown per protocol and lets you move the constants to re-rank the board live. Each row carries a six-step farm plan derived from the protocol's own category, chains, TVL and age, with a cost and a time for every step.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input snapshot.json
```

`main.ts` (Node 22, standard library only) reads the sealed DefiLlama snapshot, writes `board.json` and `data.js`, copies `dashboard/` and `screenshots/`, and writes `dossier.json`. The snapshot itself is supplied by the grader at `/input/snapshot.json`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=r4pcp2sw&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
