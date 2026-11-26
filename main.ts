// Token Launch Radar — round 5 entry point.
//
// Reads the sealed snapshot, fits the value model (lib/model.ts), sizes
// every farm plan from the farm economics (lib/farm.ts), and writes the
// entry outputs: board.json (the contract §2 object schema), data.js
// (the dashboard's positional format), dashboard/ + screenshots/ copied
// beside them, and dossier.json via the kit's buildDossier.
//
// Two rules govern everything below. First, the numbers the dashboard
// recomputes must be the numbers printed here: every constant the
// dashboard uses (curve, base rate, market median, category factors,
// logistic odds) is rounded to its emission precision BEFORE any row is
// scored, so main.ts and app.js run the same arithmetic on the same
// inputs. Second, nothing here is tuned to a name or a slug: the
// universe, the fit and the ranks all come from the snapshot at run
// time. Node 22+, standard library only, no network, deterministic.
//
// Usage: node main.ts --input <snapshot.json>
//   Input fallback: --input, /input/snapshot.json, ./input/snapshot.json,
//   ./snapshot.json. Output dir: $MAKEFUN_OUTPUT_DIR, default /output.

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  copyFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fitModel, scoreProtocol, ageDaysOf } from './lib/model.ts';
import {
  selectUniverse,
  planFarm,
  feeTableFor,
  farmStepTemplates,
  coreFamilyOf,
  FARM_CORE_FAMILIES,
  chainFee,
  DROP_SHARE,
  TBILL_RATE,
  HOUR_HURDLE_USD,
  HORIZON_WEEKS,
  DEPOSIT_CAP_USD,
} from './lib/farm.ts';
import { buildDossier } from './vendor/makefun-board.ts';

// The bootstrap seed is fixed by the contract. Round 5 fits no
// bootstrap: ranks are point estimates from the single fit, so the seed
// is recorded here and in board.json rather than spent on resampling.
const BOOTSTRAP_SEED = 20261114;
const DOSSIER_TEXT_MAX_BYTES = 65536;

// Emission precision for the constants the dashboard recomputes with.
// Score with the rounded model, never with the raw fit.
const Q_PRECISION = [4, 4, 5, 3];
const BASE_PRECISION = 3;
const MARKET_MEDIAN_PRECISION = 2;
const LOGISTIC_PRECISION = 4;
const BAND_MULT_PRECISION = 3;

// The farm plan's minimum-viable-capital search in lib/farm.ts runs
// $500 to $30,000 in $100 steps and reports $100,000 when no deposit
// inside the cap clears both hurdles. Those four numbers are plan
// parameters the dashboard needs for its own MVC search, so they are
// emitted as data (and must stay in step with farm.ts).
const MVC_MIN_USD = 500;
const MVC_STEP_USD = 100;
const MVC_UNATTAINABLE_USD = 100000;

// The dashboard's net-by-deposit matrix prices deposits from the same
// formula the verdict uses: pool x stake weight / crowd x growth.
// Crowd and stake-half are farm.ts internals; they are emitted as data
// here (and must stay in step with farm.ts).
const CROWD_BASE = 410;
const CROWD_REF_TVL = 10000000;
const CROWD_EXPONENT = 0.25;
const CROWD_MIN = 10;
const CROWD_MAX = 600;
const STAKE_HALF_USD = 5000;

function roundTo(x: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}

function whole(x: number): number {
  return Math.round(x);
}

// FNV-1a, 32-bit, hex, 8 chars — the same hash the dashboard computes
// over `slug:rank:iv` joined by `|`. Same input, same spelling.
function fnv1aHex(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ('0000000' + (h >>> 0).toString(16)).slice(-8);
}

function repoDir(): string {
  return dirname(fileURLToPath(import.meta.url));
}

function outputDir(): string {
  return process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
}

function resolveInput(argv: string[]): string {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--input' && i + 1 < argv.length) return argv[i + 1] as string;
    if (argv[i] !== undefined && argv[i].startsWith('--input=')) {
      return (argv[i] as string).slice('--input='.length);
    }
  }
  const candidates = [
    '/input/snapshot.json',
    './input/snapshot.json',
    './snapshot.json',
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error(
    'no snapshot found: pass --input <path> or place one at /input/snapshot.json, ./input/snapshot.json or ./snapshot.json',
  );
}

// Clear the output directory's CONTENTS only — never the directory
// itself, which the grader bind-mounts (rmdir throws EBUSY).
function clearContents(dir: string): void {
  mkdirSync(dir, { recursive: true });
  for (const entry of readdirSync(dir)) {
    rmSync(join(dir, entry), { recursive: true, force: true });
  }
}

function copyTree(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true });
  const entries = readdirSync(src, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  for (const e of entries) {
    const from = join(src, e.name);
    const to = join(dst, e.name);
    if (e.isDirectory()) copyTree(from, to);
    else if (e.isFile()) copyFileSync(from, to);
  }
}

function writeText(path: string, text: string): void {
  writeFileSync(path, text, 'utf8');
}

// ------------------------------------------------------------------
// Snapshot and row shapes (the fields this file reads; the snapshot
// carries more, and the board rows carry the contract §2 fields).
// ------------------------------------------------------------------

interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

// The geometric-mean mcap/TVL multiple on the anchors: the log-space
// centre the flat baseline is printed at.
function geometricMultiple(anchors: SnapshotProtocol[]): number {
  const logs = anchors
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .map((p) => Math.log((p.mcap_usd as number) / p.tvl_usd));
  return Math.exp(logs.reduce((s, x) => s + x, 0) / logs.length);
}

function chainBucketName(nChains: number): string {
  return nChains < 2 ? '1' : nChains < 4 ? '2-3' : '4+';
}

function ageBucketName(ageDays: number | null): string {
  if (ageDays === null) return 'u';
  if (ageDays < 365) return 'y0';
  if (ageDays < 730) return 'y1';
  if (ageDays < 1096) return 'y2';
  return 'y3';
}

// ------------------------------------------------------------------
// Build: fit, score, plan, assemble board.json and data.js.
// ------------------------------------------------------------------

interface BuildResult {
  boardText: string;
  dataText: string;
  summary: string[];
}

function build(snapshot: Snapshot): BuildResult {
  const asOfMs = Date.parse(snapshot.as_of + 'T00:00:00Z');
  if (!Number.isFinite(asOfMs)) {
    throw new Error('snapshot as_of is not a date: ' + String(snapshot.as_of));
  }
  const floor = snapshot.floor_usd;
  const watchlist = new Set(snapshot.watchlist);
  const all = snapshot.protocols;

  // Fit once, on the full snapshot. The held-out numbers in the fit
  // are the honest ones: nothing here is tuned after seeing them.
  const model = fitModel(all, asOfMs);

  // The rounded model: every constant the dashboard recomputes with,
  // rounded to emission precision BEFORE scoring. The dashboard runs
  // the same arithmetic on the same rounded inputs, so its self-check
  // compares equal integers instead of near-equal floats. The raw fit
  // is kept only for the held-out tables, which are printed at their
  // own precision in board.json.
  const roundedModel = {
    ...model,
    curveA: roundTo(model.curveA, Q_PRECISION[0] as number),
    curveB: roundTo(model.curveB, Q_PRECISION[1] as number),
    curveC: roundTo(model.curveC, Q_PRECISION[2] as number),
    curveX0: roundTo(model.curveX0, Q_PRECISION[3] as number),
    marketMedianChange: roundTo(
      model.marketMedianChange,
      MARKET_MEDIAN_PRECISION,
    ),
    baseRate: roundTo(model.baseRate, BASE_PRECISION),
    logisticCoef: model.logisticCoef.map((c: number) =>
      roundTo(c, LOGISTIC_PRECISION),
    ),
    logisticMedianAgeYears: roundTo(
      model.logisticMedianAgeYears,
      LOGISTIC_PRECISION,
    ),
    tvlBands: model.tvlBands.map((b: {
      lo: number;
      hi: number;
      n: number;
      q10: number;
      q25: number;
      q75: number;
      q90: number;
      cov2575: number;
      cov1090: number;
    }) => ({
      ...b,
      q10: roundTo(b.q10, BAND_MULT_PRECISION),
      q25: roundTo(b.q25, BAND_MULT_PRECISION),
      q75: roundTo(b.q75, BAND_MULT_PRECISION),
      q90: roundTo(b.q90, BAND_MULT_PRECISION),
    })),
  };

  const universe = selectUniverse(snapshot);
  const ranked = universe.ranked;
  const ledger = universe.ledger;
  if (ledger.total !== all.length) {
    throw new Error(
      'ledger does not sum to the snapshot: ' + JSON.stringify(ledger),
    );
  }

  // Dashboard indexes. Categories and chains are the sorted distinct
  // values among the ranked rows only — the dashboard indexes rows
  // against these lists, so nothing outside the board may appear.
  const cats = [
    ...new Set(ranked.map((p) => p.category ?? 'none recorded')),
  ].sort();
  const catIdx = new Map(cats.map((c, i) => [c, i]));
  const chainNames = [
    ...new Set(ranked.flatMap((p) => p.chains)),
  ].sort();
  const chainIdx = new Map(chainNames.map((c, i) => [c, i]));
  const chainsMeta = chainNames.map((c) => [c, chainFee(c).family]);

  // Anchors sorted by slug: the dashboard's comparables table and the
  // `an` array share this order, and comparables are indices into it.
  const anchorsSorted = [...model.anchors].sort((a, b) =>
    a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0,
  );
  const anchorIndex = new Map(
    anchorsSorted.map((a, i) => [a.slug, i]),
  );

  const templates = farmStepTemplates();
  const stepsMeta = {
    c: templates.common,
    k: Object.fromEntries(
      FARM_CORE_FAMILIES.map((f, i) => [String(i), templates.core[f]]),
    ),
    x: Object.fromEntries(
      FARM_CORE_FAMILIES.map((f, i) => [String(i), templates.exit[f]]),
    ),
  };

  // Score every ranked row with the rounded model, then price its farm
  // plan from the farm economics. The 7-day change is rounded to one
  // decimal BEFORE scoring and before planFarm: the dashboard only ever
  // sees the rounded value, so the growth carry and the farm growth
  // factor must be computed from it on both sides.
  interface ScoredRow {
    p: SnapshotProtocol;
    chg: number | null;
    ageDays: number | null;
    scored: ReturnType<typeof scoreProtocol>;
    plan: ReturnType<typeof planFarm>;
    famIdx: number;
  }
  const scoredRows: ScoredRow[] = ranked.map((p) => {
    const chg =
      p.change_7d === null ? null : roundTo(p.change_7d, 1);
    const scored = scoreProtocol(
      { ...p, change_7d: chg },
      roundedModel as never,
    );
    const ageDays = ageDaysOf(p, asOfMs);
    const fees = feeTableFor(p.chains);
    const plan = planFarm(
      {
        slug: p.slug,
        name: p.name,
        category: p.category,
        chains: p.chains,
        tvl_usd: p.tvl_usd,
        change_7d: chg,
        implied_value_usd: scored.implied_value_usd,
        odds: scored.odds,
        listed_at: p.listed_at,
      },
      fees,
    );
    return {
      p,
      chg,
      ageDays,
      scored,
      plan,
      famIdx: FARM_CORE_FAMILIES.indexOf(coreFamilyOf(p.category)),
    };
  });

  // Rank by implied value, ties broken by slug ascending.
  scoredRows.sort(
    (a, b) =>
      b.scored.implied_value_usd - a.scored.implied_value_usd ||
      (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0),
  );

  const verdicts = { FARM: 0, THIN: 0, SKIP: 0 };
  let totalImplied = 0;
  const boardRows = scoredRows.map((r, i) => {
    const rank = i + 1;
    verdicts[r.plan.verdict]++;
    totalImplied += r.scored.implied_value_usd;
    return {
      slug: r.p.slug,
      name: r.p.name,
      rank,
      implied_value_usd: r.scored.implied_value_usd,
      implied_value_low_usd: r.scored.implied_value_low_usd,
      implied_value_high_usd: r.scored.implied_value_high_usd,
      odds: r.scored.odds,
      odds_peers: r.scored.odds_peers,
      tvl_usd: r.p.tvl_usd,
      change_7d: r.chg,
      chains: r.p.chains,
      category: r.p.category,
      listed_at: r.p.listed_at,
      watchlist: watchlist.has(r.p.slug),
      age_years:
        r.ageDays === null ? null : roundTo(r.ageDays / 365, 2),
      verdict: r.plan.verdict,
      net_usd: r.plan.net_usd,
      net_per_hour_usd: r.plan.net_per_hour_usd,
      deposit_usd: r.plan.deposit_usd,
      mvc_usd: r.plan.mvc_usd,
      farm_steps: r.plan.farm_steps,
      term_build: r.scored.term_build,
      comparables: r.scored.comparables,
      dropped_terms: r.scored.dropped_terms,
    };
  });

  // Positional dashboard rows. Indices 0-12 are the stub's shape;
  // index 13 is the rank, which the dashboard also writes itself
  // (r[13] = position + 1), so it is emitted here with the same value
  // and its assignment is a no-op. Indices 14-18 are the farm plan
  // straight from planFarm, so the board view shows the economics as
  // computed, not as re-derived.
  const dataRows = scoredRows.map((r, i) => {
    const comps = r.scored.comparables.map(
      (s: string) => anchorIndex.get(s) ?? 0,
    );
    return [
      r.p.slug,
      r.p.name,
      catIdx.get(r.p.category ?? 'none recorded'),
      r.p.chains.map((c) => chainIdx.get(c)),
      r.p.tvl_usd,
      r.chg,
      r.ageDays,
      r.scored.implied_value_usd,
      watchlist.has(r.p.slug) ? 1 : 0,
      r.famIdx,
      comps[0],
      comps[1],
      comps[2],
      i + 1,
      r.plan.verdict,
      r.plan.net_usd,
      r.plan.net_per_hour_usd,
      r.plan.deposit_usd,
      r.plan.mvc_usd,
    ];
  });

  const checksum = fnv1aHex(
    dataRows.map((row, i) => `${row[0]}:${i + 1}:${row[7]}`).join('|'),
  );

  // Ledger subgroups, in the dashboard's own arithmetic: watchlist
  // rows, off-list rows at or above the floor, early rows below it.
  const wlN = scoredRows.filter((r) => watchlist.has(r.p.slug)).length;
  const offN = scoredRows.filter(
    (r) => !watchlist.has(r.p.slug) && r.p.tvl_usd >= floor,
  ).length;
  const earlyN = scoredRows.length - wlN - offN;
  const cut = Math.min(...ranked.map((p) => p.tvl_usd));
  const ledgerText =
    `${ledger.ranked} ranked (${wlN} watchlist + ${offN} off-list parent-recorded + ${earlyN} early below floor) + ` +
    `${ledger.anchors} traded anchors, usable mcap + ${ledger.traded_no_mcap} traded without one + ` +
    `${ledger.set_aside} pre-token set aside = ${ledger.total}. ` +
    `Off-list parent-recorded: DefiLlama names a parent protocol; ranked on its own record.`;

  // Exclusion reasons, counts only, keys sorted for determinism.
  const rs: Record<string, number> = {};
  for (const reason of Object.keys(universe.excluded).sort()) {
    rs[reason] = (universe.excluded[reason] as string[]).length;
  }

  // Factor tables for the dashboard's recompute, read off the scored
  // rows: a factor appears only where scoring actually applied one.
  // Every candidate is dropped on this snapshot, so all three are
  // empty — the dashboard then multiplies by exactly 1.
  const cf: Record<string, [number, number]> = {};
  const chf: Record<string, [number, number]> = {};
  const agf: Record<string, [number, number]> = {};
  for (const r of scoredRows) {
    const tb = r.scored.term_build as Record<string, number>;
    const catF = tb.category_factor as number;
    if (catF !== 1) {
      const ci = String(catIdx.get(r.p.category ?? 'none recorded'));
      if (!cf[ci]) cf[ci] = [roundTo(catF, 3), tb.category_n as number];
    }
    const chF = tb.chain_factor as number;
    if (chF !== 1) {
      const bk = chainBucketName(r.p.chains.length);
      if (!chf[bk]) chf[bk] = [roundTo(chF, 3), 0];
    }
    const agF = tb.age_factor as number;
    if (agF !== 1) {
      const bk = ageBucketName(r.ageDays);
      if (!agf[bk]) agf[bk] = [roundTo(agF, 3), 0];
    }
  }

  const heldOut = model.heldOut;
  const bandN = model.tvlBands.reduce(
    (s: number, b: { n: number }) => s + b.n,
    0,
  );
  const pooledP50 =
    model.tvlBands.reduce(
      (s: number, b: { cov2575: number; n: number }) => s + b.cov2575 * b.n,
      0,
    ) / bandN;
  const pooledP90 =
    model.tvlBands.reduce(
      (s: number, b: { cov1090: number; n: number }) => s + b.cov1090 * b.n,
      0,
    ) / bandN;
  const growthRow = heldOut.terms.find(
    (t: { term: string }) => t.term === 'Growth',
  );
  const droppedShort = [
    ...heldOut.terms
      .filter(
        (t: { kept: boolean; term: string }) =>
          !t.kept && t.term !== 'Size curve',
      )
      .map((t: { term: string }) => t.term),
    ...heldOut.oddsTerms
      .filter((t: { kept: boolean }) => !t.kept)
      .map((t: { term: string }) => t.term),
  ];

  const geoMultiple = geometricMultiple(model.anchors);
  const medMultiple = model.overallMedianMultiple;

  const modelSection = {
    bootstrap_seed: BOOTSTRAP_SEED,
    loo_miss: roundTo(heldOut.looMiss, 3),
    wf_miss: roundTo(heldOut.wfMiss, 3),
    brier_loo: roundTo(heldOut.brierLoo, 3),
    brier_wf: roundTo(heldOut.brierWf, 3),
    wf_extra: {
      frac60: roundTo(heldOut.wfExtra.frac60, 3),
      frac70: roundTo(heldOut.wfExtra.frac70, 3),
      expand1: roundTo(heldOut.wfExtra.expand1, 3),
      expand2: roundTo(heldOut.wfExtra.expand2, 3),
    },
    band_coverage: {
      p50: roundTo(pooledP50, 3),
      p90: roundTo(pooledP90, 3),
      per_band: model.tvlBands.map(
        (b: {
          lo: number;
          hi: number;
          n: number;
          q25: number;
          q75: number;
          cov2575: number;
          cov1090: number;
        }) => ({
          lo_usd: b.lo,
          hi_usd: Number.isFinite(b.hi) ? b.hi : null,
          n: b.n,
          q25: roundTo(b.q25, 3),
          q75: roundTo(b.q75, 3),
          cov_p25_p75: roundTo(b.cov2575, 3),
          cov_p10_p90: roundTo(b.cov1090, 3),
        }),
      ),
    },
    flat_baseline: {
      geometric_multiple: roundTo(geoMultiple, 3),
      geometric_loo: roundTo(heldOut.flatLoo, 3),
      geometric_wf: roundTo(heldOut.flatWf, 3),
      median_multiple: roundTo(medMultiple, 3),
      median_loo: roundTo(heldOut.flatMedianLoo, 3),
      median_wf: roundTo(heldOut.flatMedianWf, 3),
      note:
        'Flat baseline: the multiple is mcap/TVL on traded anchors. The median multiple (r4\u2019s definition) gives LOO ' +
        `${roundTo(heldOut.flatMedianLoo, 2)}x / WF ${roundTo(heldOut.flatMedianWf, 2)}x; the geometric-mean multiple, the log-space centre the log-fitted curve is judged against, gives LOO ` +
        `${roundTo(heldOut.flatLoo, 2)}x / WF ${roundTo(heldOut.flatWf, 2)}x, in the leaders\u2019 4.4-4.65x band. The median is the noisier centre: across leave-one-out folds it jumps between adjacent order statistics, and on the walk-forward train half (older protocols) it sits at 0.191 against the geometric mean\u2019s 0.239, under-pricing the newer test half. The fitted quadratic curve beats both because the multiple varies with TVL.`,
    },
    size_curve: {
      a: roundTo(model.curveA, Q_PRECISION[0] as number),
      b: roundTo(model.curveB, Q_PRECISION[1] as number),
      c: roundTo(model.curveC, Q_PRECISION[2] as number),
      centre: roundTo(model.curveX0, Q_PRECISION[3] as number),
      degree: model.variant.degree,
    },
    odds: {
      kind:
        model.oddsKind === 'logistic'
          ? 'logistic age curve'
          : 'age-band peers',
      coef: model.logisticCoef.map((c: number) =>
        roundTo(c, LOGISTIC_PRECISION),
      ),
      median_age_years: roundTo(
        model.logisticMedianAgeYears,
        LOGISTIC_PRECISION,
      ),
      base_rate: roundTo(model.baseRate, BASE_PRECISION),
      pseudo: model.oddsPseudo,
      bands: model.ageBands.map(
        (b: { hiDays: number; k: number; n: number }) => [
          Number.isFinite(b.hiDays) ? b.hiDays : 1000000000,
          b.k,
          b.n,
        ],
      ),
    },
    growth: {
      kept: model.variant.growth,
      form:
        model.variant.growthForm === 3
          ? 'asymmetric excess-over-median'
          : model.variant.growthForm === 1
            ? 'value multiplier (capped)'
            : model.variant.growthForm === 2
              ? 'odds input'
              : 'none',
      market_median_change: roundTo(
        model.marketMedianChange,
        MARKET_MEDIAN_PRECISION,
      ),
      loo_with: growthRow ? roundTo(growthRow.looWith, 3) : null,
      loo_without: growthRow ? roundTo(growthRow.looWithout, 3) : null,
      wf_with: growthRow ? roundTo(growthRow.wfWith, 3) : null,
      wf_without: growthRow ? roundTo(growthRow.wfWithout, 3) : null,
    },
    terms: heldOut.terms.map(
      (t: {
        term: string;
        looWith: number;
        looWithout: number;
        wfWith: number;
        wfWithout: number;
        kept: boolean;
        note: string;
      }) => ({
        term: t.term,
        loo_with: roundTo(t.looWith, 3),
        loo_without: roundTo(t.looWithout, 3),
        wf_with: roundTo(t.wfWith, 3),
        wf_without: roundTo(t.wfWithout, 3),
        kept: t.kept,
        note: t.note,
      }),
    ),
    odds_terms: heldOut.oddsTerms.map(
      (t: {
        term: string;
        brierLooWith: number;
        brierLooWithout: number;
        brierWfWith: number;
        brierWfWithout: number;
        kept: boolean;
        note: string;
      }) => ({
        term: t.term,
        brier_loo_with: roundTo(t.brierLooWith, 3),
        brier_loo_without: roundTo(t.brierLooWithout, 3),
        brier_wf_with: roundTo(t.brierWfWith, 3),
        brier_wf_without: roundTo(t.brierWfWithout, 3),
        kept: t.kept,
        note: t.note,
      }),
    ),
    dropped_terms: droppedShort,
  };

  const board = {
    title: 'Token Launch Radar — round 5',
    as_of: snapshot.as_of,
    floor_usd: floor,
    ledger: {
      ranked: ledger.ranked,
      anchors: ledger.anchors,
      traded_no_mcap: ledger.traded_no_mcap,
      set_aside: ledger.set_aside,
      total: ledger.total,
    },
    ledger_text: ledgerText,
    model: modelSection,
    verdicts: { ...verdicts },
    total_implied_usd: totalImplied,
    rows: boardRows,
  };

  const meta = {
    cs: checksum,
    asof: snapshot.as_of,
    floor,
    cut,
    n: scoredRows.length,
    wl: wlN,
    led: {
      rk: ledger.ranked,
      an: ledger.anchors,
      tn: ledger.traded_no_mcap,
      un: ledger.set_aside,
      tot: ledger.total,
      bc: 0,
      af: ledger.set_aside,
      rs,
    },
    ho: {
      loo: roundTo(heldOut.looMiss, 2),
      wf: roundTo(heldOut.wfMiss, 2),
      blo: roundTo(heldOut.brierLoo, 3),
      bwf: roundTo(heldOut.brierWf, 3),
      p50: roundTo(pooledP50 * 100, 1),
      p90: roundTo(pooledP90 * 100, 1),
      floo: roundTo(heldOut.flatLoo, 2),
      fwf: roundTo(heldOut.flatWf, 2),
    },
    v: { ...verdicts },
    tot: totalImplied,
    r1: boardRows.length > 0 ? boardRows[0]?.slug : null,
    q: [
      roundTo(model.curveA, Q_PRECISION[0] as number),
      roundTo(model.curveB, Q_PRECISION[1] as number),
      roundTo(model.curveC, Q_PRECISION[2] as number),
      roundTo(model.curveX0, Q_PRECISION[3] as number),
    ],
    flat: roundTo(geoMultiple, 3),
    mmc: roundTo(model.marketMedianChange, MARKET_MEDIAN_PRECISION),
    base: roundTo(model.baseRate, BASE_PRECISION),
    oc: model.logisticCoef.map((c: number) =>
      roundTo(c, LOGISTIC_PRECISION),
    ),
    ocMed: roundTo(model.logisticMedianAgeYears, LOGISTIC_PRECISION),
    ps: model.oddsPseudo,
    bands: model.ageBands.map(
      (b: { hiDays: number; k: number; n: number }) => [
        Number.isFinite(b.hiDays) ? b.hiDays : 1000000000,
        b.k,
        b.n,
      ],
    ),
    bm: model.tvlBands.map(
      (b: { hi: number; q25: number; q75: number }) => [
        Number.isFinite(b.hi) ? whole(b.hi) : 1000000000000000000,
        roundTo(b.q25, BAND_MULT_PRECISION),
        roundTo(b.q75, BAND_MULT_PRECISION),
      ],
    ),
    cf,
    chf,
    agf,
    gk: model.variant.growth ? 1 : 0,
    gf: model.variant.growthForm,
    gnum: growthRow
      ? [
          roundTo(growthRow.looWith, 2),
          roundTo(growthRow.looWithout, 2),
          roundTo(growthRow.wfWith, 2),
          roundTo(growthRow.wfWithout, 2),
        ]
      : [0, 0, 0, 0],
    terms: heldOut.terms.map(
      (t: {
        term: string;
        looWith: number;
        looWithout: number;
        wfWith: number;
        wfWithout: number;
        kept: boolean;
      }) => [
        t.term,
        roundTo(t.looWith, 2),
        roundTo(t.looWithout, 2),
        roundTo(t.wfWith, 2),
        roundTo(t.wfWithout, 2),
        t.kept ? 1 : 0,
      ],
    ),
    ot: heldOut.oddsTerms.map(
      (t: {
        term: string;
        brierLooWith: number;
        brierLooWithout: number;
        brierWfWith: number;
        brierWfWithout: number;
        kept: boolean;
      }) => [
        t.term,
        roundTo(t.brierLooWith, 3),
        roundTo(t.brierLooWithout, 3),
        roundTo(t.brierWfWith, 3),
        roundTo(t.brierWfWithout, 3),
        t.kept ? 1 : 0,
      ],
    ),
    cats,
    chains: chainsMeta,
    fams: [...FARM_CORE_FAMILIES],
    an: anchorsSorted.map((a) => [
      a.name,
      whole((a.tvl_usd as number) / 1000),
      whole((a.mcap_usd as number) / 1000),
    ]),
    steps: stepsMeta,
    fees: {
      ethereum: [chainFee('Ethereum').txFeeUsd, chainFee('Ethereum').bridgeUsd],
      l1: [chainFee('Solana').txFeeUsd, chainFee('Solana').bridgeUsd],
      l2: [chainFee('Base').txFeeUsd, chainFee('Base').bridgeUsd],
      sidechain: [chainFee('Polygon').txFeeUsd, chainFee('Polygon').bridgeUsd],
    },
    econ: {
      drop: DROP_SHARE,
      crowd: [CROWD_BASE, CROWD_REF_TVL, CROWD_EXPONENT, CROWD_MIN, CROWD_MAX],
      half: STAKE_HALF_USD,
      tbill: TBILL_RATE,
      weeks: HORIZON_WEEKS,
      hurdle: HOUR_HURDLE_USD,
      mvcMin: MVC_MIN_USD,
      mvcMax: DEPOSIT_CAP_USD,
      mvcStep: MVC_STEP_USD,
      unattainable: MVC_UNATTAINABLE_USD,
    },
    dropped: droppedShort,
  };

  const boardText = JSON.stringify(board, null, 2) + '\n';
  const dataText =
    'window.RADAR=' + JSON.stringify({ meta, rows: dataRows }) + ';';

  const summary = [
    `rows: ${scoredRows.length} (watchlist ${wlN}/40, off-list ${offN}, early ${earlyN})`,
    `ledger: ranked ${ledger.ranked} + anchors ${ledger.anchors} + traded-no-mcap ${ledger.traded_no_mcap} + set-aside ${ledger.set_aside} = ${ledger.total}`,
    `held-out: LOO ${roundTo(heldOut.looMiss, 3)}x (target <=2.7) / WF ${roundTo(heldOut.wfMiss, 3)}x (target <=2.3) / Brier LOO ${roundTo(heldOut.brierLoo, 3)} / WF ${roundTo(heldOut.brierWf, 3)} (target <=0.24)`,
    `bands: pooled per-band coverage P25-P75 ${roundTo(pooledP50 * 100, 1)}% / P10-P90 ${roundTo(pooledP90 * 100, 1)}%`,
    `flat: geometric ${roundTo(geoMultiple, 3)}x LOO ${roundTo(heldOut.flatLoo, 2)}x / WF ${roundTo(heldOut.flatWf, 2)}x; median ${roundTo(medMultiple, 3)}x LOO ${roundTo(heldOut.flatMedianLoo, 2)}x / WF ${roundTo(heldOut.flatMedianWf, 2)}x`,
    `verdicts: FARM ${verdicts.FARM} / THIN ${verdicts.THIN} / SKIP ${verdicts.SKIP} (target FARM 36-66)`,
    `rank 1: ${boardRows.length > 0 ? boardRows[0]?.slug : 'none'} verdict ${boardRows.length > 0 ? boardRows[0]?.verdict : 'none'} net $${boardRows.length > 0 ? boardRows[0]?.net_usd : 0}`,
    `total implied: $${totalImplied}`,
    `checksum: ${checksum}`,
    `board bytes: ${Buffer.byteLength(boardText, 'utf8')}; data.js bytes: ${Buffer.byteLength(dataText, 'utf8')}`,
  ];

  return { boardText, dataText, summary };
}

// ------------------------------------------------------------------
// Driver and degraded path.
// ------------------------------------------------------------------

function run(): void {
  const out = outputDir();
  const root = repoDir();
  const inputPath = resolveInput(process.argv.slice(2));
  const snapshot = JSON.parse(
    readFileSync(inputPath, 'utf8'),
  ) as Snapshot;
  clearContents(out);
  copyTree(join(root, 'dashboard'), join(out, 'dashboard'));
  copyTree(join(root, 'screenshots'), join(out, 'screenshots'));
  const { boardText, dataText, summary } = build(snapshot);
  writeText(join(out, 'board.json'), boardText);
  writeText(join(out, 'dashboard', 'data.js'), dataText);
  const dossier = buildDossier(out, {
    text_max_bytes: DOSSIER_TEXT_MAX_BYTES,
  });
  writeFileSync(join(out, 'dossier.json'), dossier);
  for (const line of summary) console.log(line);
  console.log(`dossier bytes: ${dossier.length}`);
  console.log(`input: ${inputPath}`);
  console.log(`wrote ${out}`);
}

// On any unexpected error, still write valid outputs and exit 0: the
// files already written are kept, the missing ones are filled with a
// minimal valid shape that says it is degraded, and the dossier is
// attempted again. Only a failure to write anything at all exits 1.
function degraded(out: string, root: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  try {
    mkdirSync(out, { recursive: true });
    const dashDst = join(out, 'dashboard');
    const shotsDst = join(out, 'screenshots');
    if (!existsSync(dashDst)) copyTree(join(root, 'dashboard'), dashDst);
    if (!existsSync(shotsDst)) {
      copyTree(join(root, 'screenshots'), shotsDst);
    }
    if (!existsSync(join(out, 'board.json'))) {
      const board = {
        title: 'Token Launch Radar — round 5',
        as_of: null,
        floor_usd: null,
        ledger: {
          ranked: 0,
          anchors: 0,
          traded_no_mcap: 0,
          set_aside: 0,
          total: 0,
        },
        ledger_text: 'degraded output: ' + message.slice(0, 200),
        model: { degraded: true, error: message.slice(0, 200) },
        verdicts: { FARM: 0, THIN: 0, SKIP: 0 },
        total_implied_usd: 0,
        rows: [],
      };
      writeText(
        join(out, 'board.json'),
        JSON.stringify(board, null, 2) + '\n',
      );
    }
    if (!existsSync(join(out, 'dashboard', 'data.js'))) {
      const meta = {
        cs: '00000000',
        asof: null,
        floor: 0,
        cut: 0,
        n: 0,
        wl: 0,
        led: { rk: 0, an: 0, tn: 0, un: 0, tot: 0, bc: 0, af: 0, rs: {} },
        ho: { loo: 0, wf: 0, blo: 0, bwf: 0, p50: 0, p90: 0, floo: 0, fwf: 0 },
        v: { FARM: 0, THIN: 0, SKIP: 0 },
        tot: 0,
        r1: null,
        q: [0, 0, 0, 0],
        flat: 0,
        mmc: 0,
        base: 0,
        oc: [],
        ocMed: 0,
        ps: 20,
        bands: [],
        bm: [],
        cf: {},
        chf: {},
        agf: {},
        gk: 0,
        gf: 0,
        gnum: [0, 0, 0, 0],
        terms: [],
        ot: [],
        cats: [],
        chains: [],
        fams: [],
        an: [],
        steps: { c: [], k: {}, x: {} },
        fees: {
          ethereum: [9.5, 25],
          l1: [0.85, 5],
          l2: [0.35, 5],
          sidechain: [0.15, 5],
        },
        econ: {
          drop: DROP_SHARE,
          crowd: [CROWD_BASE, CROWD_REF_TVL, CROWD_EXPONENT, CROWD_MIN, CROWD_MAX],
          half: STAKE_HALF_USD,
          tbill: TBILL_RATE,
          weeks: HORIZON_WEEKS,
          hurdle: HOUR_HURDLE_USD,
          mvcMin: MVC_MIN_USD,
          mvcMax: DEPOSIT_CAP_USD,
          mvcStep: MVC_STEP_USD,
          unattainable: MVC_UNATTAINABLE_USD,
        },
        dropped: [],
      };
      writeText(
        join(out, 'dashboard', 'data.js'),
        'window.RADAR=' + JSON.stringify({ meta, rows: [] }) + ';',
      );
    }
    try {
      const dossier = buildDossier(out, {
        text_max_bytes: DOSSIER_TEXT_MAX_BYTES,
      });
      writeFileSync(join(out, 'dossier.json'), dossier);
    } catch {
      writeText(
        join(out, 'dossier.json'),
        JSON.stringify({
          schema: 'makefun/dossier/v1',
          cover: 0,
          text: 'degraded: ' + message.slice(0, 200) + '\n',
          images: [],
        }) + '\n',
      );
    }
    console.error('DEGRADED OUTPUT WRITTEN: ' + message);
  } catch (err2) {
    console.error(
      'could not write degraded output: ' +
        (err2 instanceof Error ? err2.message : String(err2)),
    );
    console.error('original error: ' + message);
    process.exit(1);
  }
}

try {
  run();
} catch (err) {
  degraded(outputDir(), repoDir(), err);
}
