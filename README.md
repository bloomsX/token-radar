# Token Launch Radar

[![token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/bloomsX/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/bloomsX/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

A token launch radar for the make.fun token-radar-01 bounty: 198 pre-token
protocols ranked by implied value, valued from their own record in the
2026-11-14 DefiLlama snapshot — TVL, seven-day growth, and how long each
protocol has run with no token. Every row carries a costed, timed farm plan.

## How it works

`main.ts` (Node 22, standard library only) reads the snapshot, fits a robust
log-log size curve (Huber-reweighted, 3-sigma threshold) on the 128 traded
tokens with a usable market cap — of 416 traded protocols, 272 record no
market cap, 15 record $0, and 1 records −$1 (a data error), leaving 128.
The curve carries a quadratic term in log-log space
(ln market cap = a + b·u + c·u², u = ln TVL − mean ln TVL), kept only
because it improves BOTH held-out tests against the power-law-only fit
(leave-one-out and walk-forward median miss). The program prices each
pre-token protocol as value-if-launched times token odds (the
shrunk share of peers in the same age band that record a token), calibrates
its P25–P75 / P10–P90 bands from leave-one-out residuals, and ranks the board
by implied value. A growth carry was tested and dropped: it improved
leave-one-out but hurt the walk-forward test, so the model multiplies by no
growth factor anywhere. Farm verdicts follow from the numbers on the same
screen:
FARM when net gain beats the 4% T-bill benchmark and net per hands-on hour
beats $25; THIN when net is positive but below one bar; SKIP when net is zero
or negative.

## Run

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input input/snapshot.json
```

The run writes `board.json`, the dashboard (with generated `data.js`), the
screenshots, and `dossier.json` into the output directory. Two runs write
byte-identical outputs.

## Layout

- `main.ts` — the program (entry point)
- `dashboard/` — `index.html`, `app.css`, `app.js` (data file generated per run)
- `screenshots/` — board, detail, and filtered views at 1440×810
- `vendor/makefun-board.ts` — the kit's dossier library, copied unchanged
