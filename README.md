# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/bloomsX/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/bloomsX/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: a Node 22 program that reads a frozen DefiLlama snapshot
(758 protocols, 40 on the watchlist), ranks the pre-token protocols by implied
value, prices a concrete farm plan for each one, and writes a self-checking
dashboard. Round 5: 197 ranked rows, ledger 197 + 128 + 288 + 145 = 758,
Sentora Curator ranked #2, 54 FARM / 92 THIN / 51 SKIP, rank-1 Steakhouse
Financial FARM (net +$3,859). Held-out, computed at run time and printed on
the board: LOO miss 3.39x, walk-forward miss 2.61x, Brier LOO 0.210 /
walk-forward 0.231, per-TVL-band coverage 48.4% / 76.6%. The value model fits
a robust quadratic log-log curve on 128 traded anchors, keeps seven-day growth
as an asymmetric excess-over-median carry (kept only because it improves both
held-out splits), and models token odds with a logistic age curve
(pseudo-count 20). Farm economics use an MVC-aware deposit rule with
per-chain-family fees, so large protocols can FARM instead of always SKIP.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Requires Node 22.18 or later (standard library only, no network, no
dependencies). The program writes `board.json`, the dashboard's `data.js`,
copies `dashboard/` and `screenshots/` into the output directory, and writes
`dossier.json` via the kit's `buildDossier`. Two runs from a clean output
directory are byte-identical.

---

<sub>Entered on [make.fun](https://make.fun/?ref=r4pcp2sw&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
