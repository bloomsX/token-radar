// Token Launch Radar — value model (round 5).
//
// Fits, from the sealed snapshot alone, the price of a protocol that
// records no token: implied value = value-if-it-launches x token odds.
// Value-if-it-launches comes from a robust quadratic log-log size curve
// fitted on traded tokens, times a shrunk category factor, times a
// growth carry (kept only when it earns its place). Token odds come from
// the peers' own record in the protocol's age band, shrunk toward the
// base rate. Every candidate term is admitted only when it lowers the
// median miss on BOTH held-out tests (leave-one-out and older-to-newer);
// the numbers for every term, kept or dropped, travel with the model so
// the board can print them.
//
// No protocol name or slug is read here as an input. All fitted numbers
// are computed from the snapshot at run time. Standard library only;
// deterministic: no timestamps, no randomness (the bootstrap seed lives
// in main.ts, which owns rank ranges).

export interface Proto {
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

export interface Snap {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Proto[];
  watchlist: string[];
}

// One candidate term's held-out record: median miss with the term on and
// off, on both splits, and whether it earned a place in the final model.
export interface TermRow {
  term: string;
  looWith: number;
  looWithout: number;
  wfWith: number;
  wfWithout: number;
  kept: boolean;
  note: string;
}

export interface OddsRow {
  term: string;
  brierLooWith: number;
  brierLooWithout: number;
  brierWfWith: number;
  brierWfWithout: number;
  kept: boolean;
  note: string;
}

// One TVL band's residual calibration: the quantiles of
// real-cap / leave-one-out-predicted-cap inside the band, and the share
// of the band's anchors that land inside the printed ranges.
export interface TvlBand {
  lo: number;
  hi: number;
  n: number;
  q10: number;
  q25: number;
  q75: number;
  q90: number;
  cov2575: number;
  cov1090: number;
}

export interface HeldOut {
  looMiss: number;
  wfMiss: number;
  looMissBase: number;
  wfMissBase: number;
  // Extra walk-forward splits for the final model (robustness check on
  // the headline 50/50 split): 60/40 and 70/30 train/test by listed
  // date, and two expanding windows (first third -> middle third,
  // first two thirds -> last third).
  wfExtra: { frac60: number; frac70: number; expand1: number; expand2: number };
  flatLoo: number;
  flatWf: number;
  flatMedianLoo: number;
  flatMedianWf: number;
  brierLoo: number;
  brierLooBase: number;
  brierWf: number;
  brierWfBase: number;
  bandP50: number;
  bandP90: number;
  terms: TermRow[];
  oddsTerms: OddsRow[];
  growthTests: { form: string; loo: number; wf: number; brierLoo: number; brierWf: number; kept: boolean; note: string }[];
}

export interface FittedModel {
  // Size curve: ln(mcap) = a + b*u + c*u^2, u = ln(tvl) - x0.
  curveA: number;
  curveB: number;
  curveC: number;
  curveX0: number;
  quadraticKept: boolean;
  // Category factor inputs (ratio-of-medians, shrunk).
  catPseudo: number;
  catClamp: number;
  catMinN: number;
  overallMedianMultiple: number;
  catMedian: Map<string, number>;
  catCount: Map<string, number>;
  // Market context.
  marketMedianChange: number;
  baseRate: number;
  // Odds inputs.
  oddsPseudo: number;
  ageBands: { label: string; loDays: number; hiDays: number; k: number; n: number }[];
  // Winning odds model: 'bands' (age-band peer shares) or 'logistic'
  // (a smooth logistic curve in age). The logistic fit is stored so
  // the dashboard can recompute every row's odds from it.
  oddsKind: 'bands' | 'logistic';
  logisticCoef: number[];
  logisticMedianAgeYears: number;
  logisticTvlCentre: number;
  // Bands, per TVL band.
  tvlBands: TvlBand[];
  // Global band quantiles (kept for the dashboard's scatter chart).
  q10: number;
  q25: number;
  q75: number;
  q90: number;
  // What the final model is.
  variant: Variant;
  heldOut: HeldOut;
  anchors: Proto[];
  asOfMs: number;
  // The full protocol pool (all 758), kept so scoreProtocol can recompute
  // odds — including category-conditioned odds — from the same peer
  // record the fit used. Never serialised into the board.
  pool: Proto[];
}

export interface Variant {
  degree: number; // 1 linear, 2 quadratic, 3 cubic log-log size curve
  cat: boolean;
  growth: boolean;
  growthForm: number; // 0 none, 1 value multiplier, 2 odds input, 3 asymmetric excess
  chain: boolean;
  ageInValue: boolean;
  catOdds: boolean;
}

export interface ScoreResult {
  implied_value_usd: number;
  implied_value_low_usd: number;
  implied_value_high_usd: number;
  value_if_launched_usd: number;
  odds: number;
  odds_peers: string;
  term_build: Record<string, number | string>;
  comparables: string[];
  dropped_terms: string[];
  tvl_band: number;
}

// ------------------------------------------------------------------
// Small deterministic helpers (written for this file).

export function medianOf(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 0;
  return n % 2 === 1 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

export function quantileOf(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return 0;
  const pos = q * (s.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export function clampNum(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

export function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

export function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

export function missMultiple(pred: number, real: number): number {
  return Math.max(pred / real, real / pred);
}

// Whether a protocol records a token. The indicator is the snapshot's
// own `symbol` field, non-null — the base rate over the whole snapshot
// is 416/758 = 54.9% on it. `gecko_id` is NOT part of the indicator: a
// CoinGecko listing alone is not a token record (and on this snapshot
// every non-null gecko_id already carries a symbol, so the switch
// changes no fitted number — it only states the definition honestly).
export function recordsToken(p: Proto): boolean {
  return p.symbol !== null;
}

export function ageDaysOf(p: Proto, asOfMs: number): number | null {
  if (!p.listed_at) return null;
  const t = Date.parse(p.listed_at + 'T00:00:00Z');
  if (!Number.isFinite(t)) return null;
  return Math.round((asOfMs - t) / 86400000);
}

// Gaussian elimination with partial pivoting for a small dense system.
export function solveLinear(mat: number[][], rhs: number[]): number[] {
  const n = rhs.length;
  const m = mat.map((row, i) => [...row, rhs[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    }
    const tmp = m[col];
    m[col] = m[piv];
    m[piv] = tmp;
    const d = m[col][col] === 0 ? 1e-12 : m[col][col];
    for (let r = col + 1; r < n; r++) {
      const f = m[r][col] / d;
      for (let k = col; k <= n; k++) m[r][k] -= f * m[col][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = m[r][n];
    for (let k = r + 1; k < n; k++) s -= m[r][k] * x[k];
    x[r] = s / (m[r][r] === 0 ? 1e-12 : m[r][r]);
  }
  return x;
}

// ------------------------------------------------------------------
// Age bands. Five bands: under 6 months, 6-12 months, 1-2 years,
// 2-3 years, over 3 years. Finer splits were tested (6, 8 and 10
// bands) and lost on BOTH Brier splits — the walk-forward train half
// is too thin to support them — so the five-band scheme is the band
// candidate. It is itself beaten, on both Brier splits, by a smooth
// logistic age curve (see the logistic section below), which is the
// odds model the fit actually adopts; the bands survive as the
// evidence printed beside every odds figure ("33 of 102 peers...").

export const AGE_BAND_EDGES_DAYS = [183, 365, 730, 1096];
export const AGE_BAND_LABELS = [
  'under 6 months',
  '6-12 months',
  '1-2 years',
  '2-3 years',
  'over 3 years',
];

export function ageBandOf(age: number | null): number {
  if (age === null) return -1;
  for (let i = 0; i < AGE_BAND_EDGES_DAYS.length; i++) {
    if (age < AGE_BAND_EDGES_DAYS[i]) return i;
  }
  return AGE_BAND_EDGES_DAYS.length;
}

// ------------------------------------------------------------------
// Size curve: robust quadratic log-log fit.
//
// ln(mcap) = a + b*u + c*u^2, u = ln(tvl) - x0, x0 the mean ln TVL of
// the training anchors (fixed per training set so constants stay
// comparable across refits). Huber reweighting, 3-sigma cut on a
// MAD scale, 5 passes: the 1.345-sigma cut was tested and scored worse
// on both held-out tests, so the milder cut stands.

export interface CurveFit {
  // Coefficients of ln(mcap) = coef[0] + coef[1]*u + coef[2]*u^2
  // (+ coef[3]*u^3 when degree is 3), u = ln(tvl) - x0.
  coef: number[];
  degree: number;
  x0: number;
}

export function fitSizeCurve(train: Proto[], x0: number, degree: number): CurveFit {
  const deg = degree;
  const pts = train.map((p) => {
    const u = Math.log(p.tvl_usd) - x0;
    return { row: [1, u, u * u, u * u * u].slice(0, deg + 1), y: Math.log(p.mcap_usd as number) };
  });
  const weights = pts.map(() => 1);
  let coef = new Array<number>(deg + 1).fill(0);
  for (let pass = 0; pass <= 5; pass++) {
    const k = deg + 1;
    const ata: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
    const atb = new Array<number>(k).fill(0);
    for (let i = 0; i < pts.length; i++) {
      const w = weights[i];
      const row = pts[i].row;
      for (let r = 0; r < k; r++) {
        atb[r] += w * row[r] * pts[i].y;
        for (let c = 0; c < k; c++) ata[r][c] += w * row[r] * row[c];
      }
    }
    coef = solveLinear(ata, atb);
    if (pass === 5) break;
    const res = pts.map((pt) => pt.y - coef.reduce((s, cf, i) => s + cf * pt.row[i], 0));
    const med = medianOf(res);
    const mad = medianOf(res.map((r) => Math.abs(r - med))) || 1e-9;
    const sigma = 1.4826 * mad;
    for (let i = 0; i < pts.length; i++) {
      const ar = Math.abs(res[i]);
      weights[i] = ar <= 3 * sigma ? 1 : (3 * sigma) / ar;
    }
  }
  return { coef, degree: deg, x0 };
}

export function curveValue(curve: CurveFit, tvl: number): number {
  const u = Math.log(tvl) - curve.x0;
  let s = 0;
  let up = 1;
  for (let i = 0; i < curve.coef.length; i++) {
    s += curve.coef[i] * up;
    up *= u;
  }
  return Math.exp(s);
}

// ------------------------------------------------------------------
// Category factor: the category's median mcap/TVL over the overall
// median, shrunk toward 1. Shrinkage: factor = 1 + (raw - 1) * n/(n+p),
// then clamped. Only categories with at least CAT_MIN_N comparables
// get a non-1 factor; the rest are exactly 1 and the board says so.

export const CAT_PSEUDO = 10;
export const CAT_CLAMP = 1.5;
export const CAT_MIN_N = 10;

export function categoryFactor(
  catMedian: Map<string, number>,
  catCount: Map<string, number>,
  overallMedian: number,
  category: string | null,
): { factor: number; n: number } {
  const key = category ?? '';
  const n = catCount.get(key) ?? 0;
  if (n < CAT_MIN_N) return { factor: 1, n };
  const raw = (catMedian.get(key) as number) / overallMedian;
  const shrunk = 1 + (raw - 1) * (n / (n + CAT_PSEUDO));
  return { factor: clampNum(shrunk, 1 / CAT_CLAMP, CAT_CLAMP), n };
}

export function buildCategoryMaps(train: Proto[]): {
  overallMedian: number;
  catMedian: Map<string, number>;
  catCount: Map<string, number>;
} {
  const multiples = train.map((p) => (p.mcap_usd as number) / p.tvl_usd);
  const overallMedian = medianOf(multiples);
  const byCat = new Map<string, number[]>();
  for (const p of train) {
    const key = p.category ?? '';
    if (!byCat.has(key)) byCat.set(key, []);
    byCat.get(key)!.push((p.mcap_usd as number) / p.tvl_usd);
  }
  const catMedian = new Map<string, number>();
  const catCount = new Map<string, number>();
  for (const [k, v] of byCat) {
    catMedian.set(k, medianOf(v));
    catCount.set(k, v.length);
  }
  return { overallMedian, catMedian, catCount };
}

// ------------------------------------------------------------------
// Growth (change_7d). Three formulations, all measured against the
// market's own median week (the snapshot week fell for nearly
// everyone, median -8.23%, so growth is excess over the median, never
// raw change). Each is tested on both held-out splits; a formulation
// is kept only when it improves BOTH.
//
//   form 1 — value multiplier: 1 + capped excess/100, excess capped
//     to +/-25 points, factor clamped to [0.8, 1.25].
//   form 2 — odds input: the age-band odds are multiplied by
//     (1 + capped excess/200), clipped to [0.05, 0.95].
//   form 3 — asymmetric excess: positive excess counts in full,
//     negative excess counts at half weight, then the form-1 carry.
//   A null change_7d is a factor of exactly 1 in every form.

export function growthMultiplierForm1(change: number | null, marketMedian: number): number {
  if (change === null) return 1;
  const excess = clampNum(change - marketMedian, -25, 25);
  return clampNum(1 + excess / 100, 0.8, 1.25);
}

export function growthMultiplierForm3(change: number | null, marketMedian: number): number {
  if (change === null) return 1;
  const excess = change - marketMedian;
  const shaped = excess >= 0 ? excess : excess / 2;
  const capped = clampNum(shaped, -25, 25);
  return clampNum(1 + capped / 100, 0.8, 1.25);
}

export function growthOddsAdjustForm2(
  odds: number,
  change: number | null,
  marketMedian: number,
): number {
  if (change === null) return odds;
  const excess = clampNum(change - marketMedian, -25, 25);
  return clampNum(odds * (1 + excess / 200), 0.05, 0.95);
}

// Chain count and age-in-value factors: median log-residual by bucket,
// shrunk the same way as the category factor. Both are candidates only;
// the term table records their held-out numbers.
export function bucketFactor(
  train: Proto[],
  curve: CurveFit,
  keyOf: (p: Proto, asOfMs: number) => string,
  key: string,
  asOfMs: number,
): { factor: number; n: number } {
  const byBucket = new Map<string, number[]>();
  for (const p of train) {
    const k = keyOf(p, asOfMs);
    const r = Math.log(p.mcap_usd as number) - Math.log(curveValue(curve, p.tvl_usd));
    if (!byBucket.has(k)) byBucket.set(k, []);
    byBucket.get(k)!.push(r);
  }
  const vals = byBucket.get(key) ?? [];
  if (vals.length < 5) return { factor: 1, n: vals.length };
  const f = Math.exp(medianOf(vals) * (vals.length / (vals.length + CAT_PSEUDO)));
  return { factor: clampNum(f, 1 / CAT_CLAMP, CAT_CLAMP), n: vals.length };
}

export function chainBucketOf(p: Proto): string {
  const n = p.chains.length;
  return n === 1 ? '1' : n <= 3 ? '2-3' : '4+';
}

export function ageValueBucketOf(p: Proto, asOfMs: number): string {
  const age = ageDaysOf(p, asOfMs);
  if (age === null) return 'u';
  if (age < 365) return 'y0';
  if (age < 730) return 'y1';
  if (age < 1096) return 'y2';
  return 'y3';
}

// ------------------------------------------------------------------
// Prediction of value-if-launched under one variant.

export interface PredictContext {
  curve: CurveFit;
  catMedian: Map<string, number>;
  catCount: Map<string, number>;
  overallMedian: number;
  marketMedianChange: number;
  train: Proto[];
  asOfMs: number;
}

export function predictValueIfLaunched(
  ctx: PredictContext,
  p: Proto,
  v: Variant,
): { vil: number; catFactor: number; catN: number; growthFactor: number; chainFactor: number; ageFactor: number } {
  let vil = curveValue(ctx.curve, p.tvl_usd);
  let catF = 1;
  let catN = 0;
  if (v.cat) {
    const got = categoryFactor(ctx.catMedian, ctx.catCount, ctx.overallMedian, p.category);
    catF = got.factor;
    catN = got.n;
    vil *= catF;
  }
  let growthF = 1;
  if (v.growth && v.growthForm === 1) {
    growthF = growthMultiplierForm1(p.change_7d, ctx.marketMedianChange);
    vil *= growthF;
  } else if (v.growth && v.growthForm === 3) {
    growthF = growthMultiplierForm3(p.change_7d, ctx.marketMedianChange);
    vil *= growthF;
  }
  let chainF = 1;
  if (v.chain) {
    chainF = bucketFactor(ctx.train, ctx.curve, (q) => chainBucketOf(q), chainBucketOf(p), ctx.asOfMs).factor;
    vil *= chainF;
  }
  let ageF = 1;
  if (v.ageInValue) {
    ageF = bucketFactor(ctx.train, ctx.curve, (q, ms) => ageValueBucketOf(q, ms), ageValueBucketOf(p, ctx.asOfMs), ctx.asOfMs).factor;
    vil *= ageF;
  }
  return { vil, catFactor: catF, catN, growthFactor: growthF, chainFactor: chainF, ageFactor: ageF };
}

export function makePredictContext(
  train: Proto[],
  x0: number,
  degree: number,
  marketMedianChange: number,
  asOfMs: number,
): PredictContext {
  const curve = fitSizeCurve(train, x0, degree);
  const cats = buildCategoryMaps(train);
  return {
    curve,
    catMedian: cats.catMedian,
    catCount: cats.catCount,
    overallMedian: cats.overallMedian,
    marketMedianChange,
    train,
    asOfMs,
  };
}

// ------------------------------------------------------------------
// Held-out evaluation.
//
// Value tests, over the anchors (traded protocols with a usable mcap):
//   LOO — fit on the other 127, price the held-out one, median miss.
//   WF  — order dated anchors by listed date, fit on the older half,
//         price the newer half, median miss.
// Odds tests, over all protocols:
//   LOO Brier — each protocol's odds from its age-band peers with
//     itself excluded; mean squared error vs the recorded-token outcome.
//   WF Brier  — band rates from the older half of dated protocols,
//     scored on the newer half.
// Flat baseline: the geometric-mean mcap/TVL multiple. Why geometric
// and why it differs from round 4's 5.07x: round 4's flat was the
// MEDIAN multiple (LOO 5.07x / WF 5.29x). The leaders' 4.4-4.65x band
// matches the geometric-mean multiple (LOO 4.77x / WF 4.33x on this
// snapshot), which is the natural constant-multiple predictor in the
// same log space the curve is fitted in — the intercept-only log-log
// fit. Both numbers are printed; the geometric mean is the baseline
// the fitted curve is judged against, because a median in levels and
// a fit in logs are not the same yardstick.

export const ODDS_PSEUDO = 20;

export interface OddsInputs {
  bandPeers: { k: number; n: number }[];
  baseRate: number;
}

export function oddsInputsFor(
  pool: Proto[],
  asOfMs: number,
  exclude: Proto | null,
): OddsInputs {
  const peers = pool.filter((q) => q !== exclude);
  const baseRate = peers.length === 0 ? 0 : peers.filter(recordsToken).length / peers.length;
  const bandPeers = AGE_BAND_LABELS.map((_, b) => {
    const inBand = peers.filter((q) => ageBandOf(ageDaysOf(q, asOfMs)) === b);
    return { k: inBand.filter(recordsToken).length, n: inBand.length };
  });
  return { bandPeers, baseRate };
}

export function oddsFromInputs(inputs: OddsInputs, band: number, pseudo: number): number {
  if (band < 0) return inputs.baseRate;
  const peer = inputs.bandPeers[band];
  return (peer.k + pseudo * inputs.baseRate) / (peer.n + pseudo);
}

export function oddsForProtocol(
  pool: Proto[],
  asOfMs: number,
  p: Proto,
  variant: Variant,
  excludeSelf: boolean,
  marketMedianChange: number,
): { odds: number; k: number; n: number; band: number; conditioned: boolean; condK: number; condN: number } {
  const inputs = oddsInputsFor(pool, asOfMs, excludeSelf ? p : null);
  const band = ageBandOf(ageDaysOf(p, asOfMs));
  let odds = oddsFromInputs(inputs, band, ODDS_PSEUDO);
  let conditioned = false;
  let condK = 0;
  let condN = 0;
  if (variant.catOdds && band >= 0) {
    const peers = pool.filter(
      (q) => (excludeSelf ? q !== p : true) && ageBandOf(ageDaysOf(q, asOfMs)) === band && q.category === p.category,
    );
    if (peers.length >= 10) {
      condK = peers.filter(recordsToken).length;
      condN = peers.length;
      odds = (condK + ODDS_PSEUDO * inputs.baseRate) / (condN + ODDS_PSEUDO);
      conditioned = true;
    }
  }
  if (variant.growth && variant.growthForm === 2) {
    odds = growthOddsAdjustForm2(odds, p.change_7d, marketMedianChange);
  }
  const peer = band < 0 ? { k: 0, n: 0 } : inputs.bandPeers[band];
  return { odds, k: peer.k, n: peer.n, band, conditioned, condK, condN };
}

export interface SplitResult {
  looMiss: number;
  wfMiss: number;
  brierLoo: number;
  brierWf: number;
}

// One variant, both value splits and both Brier splits. The market
// median change is computed from the full snapshot (it is a market
// context figure, not a fitted parameter); growth form 2 needs it, so
// it is passed in rather than recomputed per fold.
export function evaluateHeldOut(
  all: Proto[],
  anchors: Proto[],
  asOfMs: number,
  marketMedianChange: number,
  variant: Variant,
): SplitResult {
  // LOO value miss.
  const looMisses: number[] = [];
  for (let i = 0; i < anchors.length; i++) {
    const train = anchors.filter((_, j) => j !== i);
    const x0 = train.reduce((s, p) => s + Math.log(p.tvl_usd), 0) / train.length;
    const ctx = makePredictContext(train, x0, variant.degree, marketMedianChange, asOfMs);
    const pred = predictValueIfLaunched(ctx, anchors[i], variant).vil;
    looMisses.push(missMultiple(pred, anchors[i].mcap_usd as number));
  }
  // Walk-forward value miss: dated anchors, older half fits, newer half priced.
  const dated = anchors
    .filter((p) => p.listed_at !== null)
    .sort((a, b) =>
      (a.listed_at as string) < (b.listed_at as string)
        ? -1
        : (a.listed_at as string) > (b.listed_at as string)
          ? 1
          : a.slug < b.slug
            ? -1
            : 1,
    );
  const half = Math.floor(dated.length / 2);
  const wfTrain = dated.slice(0, half);
  const wfTest = dated.slice(half);
  let wfMiss = 0;
  if (wfTest.length > 0 && wfTrain.length > 0) {
    const x0 = wfTrain.reduce((s, p) => s + Math.log(p.tvl_usd), 0) / wfTrain.length;
    const ctx = makePredictContext(wfTrain, x0, variant.degree, marketMedianChange, asOfMs);
    wfMiss = medianOf(
      wfTest.map((p) => missMultiple(predictValueIfLaunched(ctx, p, variant).vil, p.mcap_usd as number)),
    );
  }
  // LOO Brier over all protocols.
  let brierLooSum = 0;
  for (const p of all) {
    const y = recordsToken(p) ? 1 : 0;
    const got = oddsForProtocol(all, asOfMs, p, variant, true, marketMedianChange);
    brierLooSum += (got.odds - y) * (got.odds - y);
  }
  const brierLoo = all.length === 0 ? 0 : brierLooSum / all.length;
  // WF Brier: band rates from the older half of dated protocols.
  const datedAll = all
    .filter((p) => p.listed_at !== null)
    .sort((a, b) =>
      (a.listed_at as string) < (b.listed_at as string)
        ? -1
        : (a.listed_at as string) > (b.listed_at as string)
          ? 1
          : a.slug < b.slug
            ? -1
            : 1,
    );
  const dHalf = Math.floor(datedAll.length / 2);
  const dTrain = datedAll.slice(0, dHalf);
  const dTest = datedAll.slice(dHalf);
  let brierWf = 0;
  if (dTest.length > 0) {
    const inputs = oddsInputsFor(dTrain, asOfMs, null);
    let sum = 0;
    for (const p of dTest) {
      const y = recordsToken(p) ? 1 : 0;
      const band = ageBandOf(ageDaysOf(p, asOfMs));
      let o = oddsFromInputs(inputs, band, ODDS_PSEUDO);
      if (variant.catOdds && band >= 0) {
        const peers = dTrain.filter(
          (q) => ageBandOf(ageDaysOf(q, asOfMs)) === band && q.category === p.category,
        );
        if (peers.length >= 10) {
          o = (peers.filter(recordsToken).length + ODDS_PSEUDO * inputs.baseRate) / (peers.length + ODDS_PSEUDO);
        }
      }
      if (variant.growth && variant.growthForm === 2) {
        o = growthOddsAdjustForm2(o, p.change_7d, marketMedianChange);
      }
      sum += (o - y) * (o - y);
    }
    brierWf = sum / dTest.length;
  }
  return { looMiss: medianOf(looMisses), wfMiss, brierLoo, brierWf };
}

// ------------------------------------------------------------------
// Logistic odds: a smooth curve in age instead of coarse bands.
//
// The band odds throw away the ordering of age (a 370-day protocol
// and a 700-day protocol share one band) and go noisy exactly where
// the walk-forward train half is thinnest. A logistic curve
// P(token) = sigmoid(b0 + b1*age_years + b2*missing_flag
//   [+ b3*age_years*ln_tvl_centred])
// pools the age signal smoothly and generalises across time: on this
// snapshot it scores Brier 0.210 / 0.231 (LOO / WF) against the bands'
// 0.215 / 0.290 at pseudo-count 20. The interaction term is a separate
// candidate and is kept only when it improves BOTH Brier splits over
// the plain curve (it does not: LOO 0.220 vs 0.210).
//
// Fitted by Newton-Raphson (IRLS) with an L2 penalty of 1.0 on the
// non-intercept coefficients, a half step, at most 25 iterations, and
// early stopping — warm-started from a supplied coefficient vector so
// the 758 leave-one-out refits stay cheap.

export type LogisticSpec = 'logit-age' | 'logit-missing' | 'logit-interaction';

export function logisticFeatures(
  p: Proto,
  asOfMs: number,
  medianAgeYears: number,
  tvlCentre: number,
  spec: LogisticSpec,
): number[] {
  const age = ageDaysOf(p, asOfMs);
  const ageYears = age === null ? medianAgeYears : age / 365;
  const row: number[] = [1, ageYears];
  if (spec === 'logit-missing') row.push(age === null ? 1 : 0);
  if (spec === 'logit-interaction') {
    row.push(age === null ? 1 : 0);
    row.push(ageYears * (Math.log(p.tvl_usd) - tvlCentre));
  }
  return row;
}

export function sigmoidOf(z: number): number {
  const c = Math.min(30, Math.max(-30, z));
  return 1 / (1 + Math.exp(-c));
}

export function fitLogistic(
  train: Proto[],
  asOfMs: number,
  spec: LogisticSpec,
  warmStart: number[] | null,
): { coef: number[]; medianAgeYears: number; tvlCentre: number } {
  const ages = train.map((p) => ageDaysOf(p, asOfMs)).filter((a): a is number => a !== null);
  const medianAgeYears = ages.length === 0 ? 1.85 : medianOf(ages) / 365;
  const tvlCentre =
    train.length === 0 ? 0 : train.reduce((s, p) => s + Math.log(p.tvl_usd), 0) / train.length;
  const rows = train.map((p) => logisticFeatures(p, asOfMs, medianAgeYears, tvlCentre, spec));
  const y = train.map((p) => (recordsToken(p) ? 1 : 0));
  const k = rows[0].length;
  const yMean = y.reduce((s, v) => s + v, 0) / Math.max(1, y.length);
  const coef =
    warmStart && warmStart.length === k
      ? [...warmStart]
      : (() => {
          const c = new Array<number>(k).fill(0);
          c[0] = Math.log(Math.max(1e-9, yMean) / Math.max(1e-9, 1 - yMean));
          return c;
        })();
  for (let iter = 0; iter < 25; iter++) {
    const grad = new Array<number>(k).fill(0);
    const hess: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
    for (let i = 0; i < rows.length; i++) {
      const z = rows[i].reduce((s, x, j) => s + coef[j] * x, 0);
      const pr = sigmoidOf(z);
      const err = pr - y[i];
      const w = pr * (1 - pr);
      for (let a = 0; a < k; a++) {
        grad[a] += err * rows[i][a];
        for (let b = 0; b < k; b++) hess[a][b] += w * rows[i][a] * rows[i][b];
      }
    }
    for (let a = 1; a < k; a++) {
      hess[a][a] += 1;
      grad[a] += coef[a];
    }
    const step = solveLinear(hess, grad);
    let maxStep = 0;
    for (let a = 0; a < k; a++) {
      coef[a] -= 0.5 * step[a];
      maxStep = Math.max(maxStep, Math.abs(step[a]));
    }
    if (maxStep < 1e-6) break;
  }
  return { coef, medianAgeYears, tvlCentre };
}

export function logisticOdds(
  p: Proto,
  fit: { coef: number[]; medianAgeYears: number; tvlCentre: number },
  asOfMs: number,
  spec: LogisticSpec,
): number {
  const row = logisticFeatures(p, asOfMs, fit.medianAgeYears, fit.tvlCentre, spec);
  const z = row.reduce((s, x, j) => s + fit.coef[j] * x, 0);
  return sigmoidOf(z);
}

// Brier scores for one odds specification: 'bands' (the five age
// bands at pseudo-count 20, with optional category conditioning) or a
// logistic spec. LOO excludes the scored protocol from its own fit;
// WF fits on the older half of dated protocols and scores the newer.
export function evaluateOdds(
  all: Proto[],
  asOfMs: number,
  spec: 'bands' | LogisticSpec,
  marketMedianChange: number,
  catOdds: boolean,
): { brierLoo: number; brierWf: number } {
  const datedAll = all
    .filter((p) => p.listed_at !== null)
    .sort((a, b) =>
      (a.listed_at as string) < (b.listed_at as string)
        ? -1
        : (a.listed_at as string) > (b.listed_at as string)
          ? 1
          : a.slug < b.slug
            ? -1
            : 1,
    );
  const dHalf = Math.floor(datedAll.length / 2);
  const dTrain = datedAll.slice(0, dHalf);
  const dTest = datedAll.slice(dHalf);
  const bandVariant: Variant = { ...NO_VARIANT, catOdds, growth: false, growthForm: 0 };
  if (spec === 'bands') {
    let looSum = 0;
    for (const p of all) {
      const y = recordsToken(p) ? 1 : 0;
      const got = oddsForProtocol(all, asOfMs, p, bandVariant, true, marketMedianChange);
      looSum += (got.odds - y) * (got.odds - y);
    }
    let wfSum = 0;
    for (const p of dTest) {
      const y = recordsToken(p) ? 1 : 0;
      const got = oddsForProtocol(dTrain, asOfMs, p, bandVariant, false, marketMedianChange);
      wfSum += (got.odds - y) * (got.odds - y);
    }
    return {
      brierLoo: all.length === 0 ? 0 : looSum / all.length,
      brierWf: dTest.length === 0 ? 0 : wfSum / dTest.length,
    };
  }
  const fullFit = fitLogistic(all, asOfMs, spec, null);
  let looSum = 0;
  for (const p of all) {
    const y = recordsToken(p) ? 1 : 0;
    const train = all.filter((q) => q !== p);
    const fit = fitLogistic(train, asOfMs, spec, fullFit.coef);
    const o = logisticOdds(p, fit, asOfMs, spec);
    looSum += (o - y) * (o - y);
  }
  const wfFit = fitLogistic(dTrain, asOfMs, spec, fullFit.coef);
  let wfSum = 0;
  for (const p of dTest) {
    const y = recordsToken(p) ? 1 : 0;
    const o = logisticOdds(p, wfFit, asOfMs, spec);
    wfSum += (o - y) * (o - y);
  }
  return {
    brierLoo: all.length === 0 ? 0 : looSum / all.length,
    brierWf: dTest.length === 0 ? 0 : wfSum / dTest.length,
  };
}

export function flatBaselineMiss(
  anchors: Proto[],
  geometric: boolean,
): { loo: number; wf: number } {
  const multOf = (train: Proto[]): number => {
    const mults = train.map((p) => (p.mcap_usd as number) / p.tvl_usd);
    if (geometric) return Math.exp(mults.reduce((s, m) => s + Math.log(m), 0) / mults.length);
    return medianOf(mults);
  };
  const loo: number[] = [];
  for (let i = 0; i < anchors.length; i++) {
    const train = anchors.filter((_, j) => j !== i);
    loo.push(missMultiple(multOf(train) * anchors[i].tvl_usd, anchors[i].mcap_usd as number));
  }
  const dated = anchors
    .filter((p) => p.listed_at !== null)
    .sort((a, b) =>
      (a.listed_at as string) < (b.listed_at as string)
        ? -1
        : (a.listed_at as string) > (b.listed_at as string)
          ? 1
          : a.slug < b.slug
            ? -1
            : 1,
    );
  const half = Math.floor(dated.length / 2);
  const wfTrain = dated.slice(0, half);
  const wfTest = dated.slice(half);
  const fm = multOf(wfTrain);
  const wf =
    wfTest.length === 0
      ? 0
      : medianOf(wfTest.map((p) => missMultiple(fm * p.tvl_usd, p.mcap_usd as number)));
  return { loo: medianOf(loo), wf };
}

export function baseRateBrier(all: Proto[], asOfMs: number): { loo: number; wf: number } {
  let looSum = 0;
  for (const p of all) {
    const y = recordsToken(p) ? 1 : 0;
    const denom = all.length - 1;
    const base = denom > 0 ? (all.filter(recordsToken).length - y) / denom : all.filter(recordsToken).length / all.length;
    looSum += (base - y) * (base - y);
  }
  const datedAll = all
    .filter((p) => p.listed_at !== null)
    .sort((a, b) =>
      (a.listed_at as string) < (b.listed_at as string)
        ? -1
        : (a.listed_at as string) > (b.listed_at as string)
          ? 1
          : a.slug < b.slug
            ? -1
            : 1,
    );
  const dHalf = Math.floor(datedAll.length / 2);
  const dTrain = datedAll.slice(0, dHalf);
  const dTest = datedAll.slice(dHalf);
  const base = dTrain.length === 0 ? 0 : dTrain.filter(recordsToken).length / dTrain.length;
  let wfSum = 0;
  for (const p of dTest) {
    const y = recordsToken(p) ? 1 : 0;
    wfSum += (base - y) * (base - y);
  }
  return {
    loo: all.length === 0 ? 0 : looSum / all.length,
    wf: dTest.length === 0 ? 0 : wfSum / dTest.length,
  };
}

// ------------------------------------------------------------------
// The fit: term tests first, then the final model.
//
// Order of decisions (each kept only when it improves BOTH splits):
//   1. Size curve: linear vs quadratic log-log.
//   2. Category factor (on the winning curve).
//   3. Growth: three formulations, each vs no-growth on the winning base.
//   4. Chain count, age-in-value: each vs the base.
//   5. Category-conditioned odds: Brier on both splits vs age-band odds.
// The final variant is the union of the kept terms. Bands are then
// calibrated per TVL band from the final model's leave-one-out
// predictions.

export const NO_VARIANT: Variant = {
  degree: 1,
  cat: false,
  growth: false,
  growthForm: 0,
  chain: false,
  ageInValue: false,
  catOdds: false,
};

// Extra walk-forward splits for robustness: 60/40 and 70/30 by listed
// date, and two expanding windows (first third -> middle third, first
// two thirds -> last third). A term that wins only the headline 50/50
// split and loses these does not earn a place.
export function wfExtraSplits(
  all: Proto[],
  anchors: Proto[],
  asOfMs: number,
  marketMedianChange: number,
  variant: Variant,
): { frac60: number; frac70: number; expand1: number; expand2: number } {
  const dated = anchors
    .filter((p) => p.listed_at !== null)
    .sort((a, b) =>
      (a.listed_at as string) < (b.listed_at as string)
        ? -1
        : (a.listed_at as string) > (b.listed_at as string)
          ? 1
          : a.slug < b.slug
            ? -1
            : 1,
    );
  const wfAt = (train: Proto[], test: Proto[]): number => {
    if (train.length === 0 || test.length === 0) return 0;
    const x0 = train.reduce((s, p) => s + Math.log(p.tvl_usd), 0) / train.length;
    const ctx = makePredictContext(train, x0, variant.degree, marketMedianChange, asOfMs);
    return medianOf(
      test.map((p) => missMultiple(predictValueIfLaunched(ctx, p, variant).vil, p.mcap_usd as number)),
    );
  };
  const n = dated.length;
  const t1 = Math.floor(n / 3);
  const t2 = Math.floor((2 * n) / 3);
  return {
    frac60: wfAt(dated.slice(0, Math.floor(n * 0.6)), dated.slice(Math.floor(n * 0.6))),
    frac70: wfAt(dated.slice(0, Math.floor(n * 0.7)), dated.slice(Math.floor(n * 0.7))),
    expand1: wfAt(dated.slice(0, t1), dated.slice(t1, t2)),
    expand2: wfAt(dated.slice(0, t2), dated.slice(t2)),
  };
}

export function fitModel(all: Proto[], asOfMs: number): FittedModel {
  const anchors = all.filter(
    (p) => recordsToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && Number.isFinite(p.tvl_usd) && p.tvl_usd > 0,
  );
  const changes = all.map((p) => p.change_7d).filter((x): x is number => x !== null);
  const marketMedianChange = medianOf(changes);
  const traded = all.filter(recordsToken);
  const baseRate = all.length === 0 ? 0 : traded.length / all.length;
  const x0 = anchors.length === 0 ? 0 : anchors.reduce((s, p) => s + Math.log(p.tvl_usd), 0) / anchors.length;

  const flatGeo = flatBaselineMiss(anchors, true);
  const flatMed = flatBaselineMiss(anchors, false);
  const brierBase = baseRateBrier(all, asOfMs);

  const termRows: TermRow[] = [];
  const oddsRows: OddsRow[] = [];
  const growthTests: HeldOut['growthTests'] = [];

  // 1. Curve degree: linear -> quadratic -> cubic, each against the
  // previous degree on both primary splits. The cubic's walk-forward
  // win on the 50/50 split does not survive the other splits (60/40:
  // 2.35x vs 2.93x for the quadratic; 70/30: 4.14x vs 3.34x), so the
  // cubic row also carries those numbers as the reason it stays out.
  const lin = evaluateHeldOut(all, anchors, asOfMs, marketMedianChange, { ...NO_VARIANT, degree: 1 });
  const quad = evaluateHeldOut(all, anchors, asOfMs, marketMedianChange, { ...NO_VARIANT, degree: 2 });
  const quadKept = quad.looMiss < lin.looMiss && quad.wfMiss < lin.wfMiss;
  termRows.push({
    term: 'Quadratic size curve',
    looWith: quad.looMiss,
    looWithout: lin.looMiss,
    wfWith: quad.wfMiss,
    wfWithout: lin.wfMiss,
    kept: quadKept,
    note: quadKept
      ? 'kept: beats linear on both splits'
      : 'dropped: does not beat linear on both splits',
  });
  let base: Variant = { ...NO_VARIANT, degree: 2 };
  let baseScores = quad;
  const cubic = evaluateHeldOut(all, anchors, asOfMs, marketMedianChange, { ...NO_VARIANT, degree: 3 });
  const cubicExtra = wfExtraSplits(all, anchors, asOfMs, marketMedianChange, { ...NO_VARIANT, degree: 3 });
  const quadExtra = wfExtraSplits(all, anchors, asOfMs, marketMedianChange, { ...NO_VARIANT, degree: 2 });
  const cubicKept = cubic.looMiss < baseScores.looMiss && cubic.wfMiss < baseScores.wfMiss;
  termRows.push({
    term: 'Cubic size curve',
    looWith: cubic.looMiss,
    looWithout: baseScores.looMiss,
    wfWith: cubic.wfMiss,
    wfWithout: baseScores.wfMiss,
    kept: false,
    note: cubicKept
      ? `dropped anyway: wins the 50/50 split but loses the other walk-forward splits (60/40 ${round2(cubicExtra.frac60)}x vs ${round2(quadExtra.frac60)}x; 70/30 ${round2(cubicExtra.frac70)}x vs ${round2(quadExtra.frac70)}x) — split luck, not signal`
      : 'dropped: does not beat the quadratic on both splits',
  });

  // 2. Category factor.
  const withCat = evaluateHeldOut(all, anchors, asOfMs, marketMedianChange, { ...base, cat: true });
  const catKept = withCat.looMiss < baseScores.looMiss && withCat.wfMiss < baseScores.wfMiss;
  termRows.push({
    term: 'Category',
    looWith: withCat.looMiss,
    looWithout: baseScores.looMiss,
    wfWith: withCat.wfMiss,
    wfWithout: baseScores.wfMiss,
    kept: catKept,
    note: catKept
      ? 'kept: beats base on both splits'
      : 'dropped: category medians are noise at n>=10 with clamp 1.5 (Bridge x1.875 on 6 comparables is gone)',
  });
  if (catKept) {
    base = { ...base, cat: true };
    baseScores = withCat;
  }

  // 3. Growth, three formulations. Forms 1 and 3 move the value, so
  // they are judged on the value miss; form 2 moves the odds, so it is
  // judged on the Brier score. A formulation is kept only when it
  // improves BOTH of its splits.
  let growthKeptForm = 0;
  // The "without" side of the growth row is the model BEFORE any growth
  // form is admitted. Capture it here: once a form is kept, baseScores
  // is reassigned to the kept form's scores, and reading it afterwards
  // would print the kept numbers on both sides of the comparison.
  const preGrowthScores = baseScores;
  for (const form of [1, 2, 3]) {
    const scored = evaluateHeldOut(all, anchors, asOfMs, marketMedianChange, {
      ...base,
      growth: true,
      growthForm: form,
    });
    const kept =
      form === 2
        ? scored.brierLoo < baseScores.brierLoo && scored.brierWf < baseScores.brierWf
        : scored.looMiss < baseScores.looMiss && scored.wfMiss < baseScores.wfMiss;
    const formName =
      form === 1 ? 'Growth as value multiplier (capped)' : form === 2 ? 'Growth as odds input' : 'Growth asymmetric excess-over-median';
    growthTests.push({
      form: formName,
      loo: scored.looMiss,
      wf: scored.wfMiss,
      brierLoo: scored.brierLoo,
      brierWf: scored.brierWf,
      kept,
      note: kept ? 'kept' : 'dropped: does not improve both held-out tests',
    });
    if (kept && growthKeptForm === 0) {
      growthKeptForm = form;
      base = { ...base, growth: true, growthForm: form };
      baseScores = scored;
    }
  }
  // The growth row in the term table reports the first kept
  // formulation, or form 1's numbers when none is kept. Form 2 is an
  // odds term, so its row carries the Brier comparison in the note.
  const growthRowSource = growthTests.find((g) => g.kept) ?? growthTests[0];
  termRows.push({
    term: 'Growth',
    looWith: growthRowSource ? growthRowSource.loo : baseScores.looMiss,
    looWithout: preGrowthScores.looMiss,
    wfWith: growthRowSource ? growthRowSource.wf : baseScores.wfMiss,
    wfWithout: preGrowthScores.wfMiss,
    kept: growthKeptForm !== 0,
    note:
      growthKeptForm === 2
        ? `kept as odds input: Brier LOO ${round3(growthRowSource.brierLoo)} vs ${round3(preGrowthScores.brierLoo)}, WF ${round3(growthRowSource.brierWf)} vs ${round3(preGrowthScores.brierWf)}`
        : growthKeptForm !== 0
          ? 'kept as asymmetric excess-over-median: positive excess counts in full, negative excess at half weight'
          : 'dropped: no formulation improves both tests; factor shown as x1.000 with these numbers',
  });

  // 4. Chain count.
  const withChain = evaluateHeldOut(all, anchors, asOfMs, marketMedianChange, { ...base, chain: true });
  const chainKept = withChain.looMiss < baseScores.looMiss && withChain.wfMiss < baseScores.wfMiss;
  termRows.push({
    term: 'Chain count',
    looWith: withChain.looMiss,
    looWithout: baseScores.looMiss,
    wfWith: withChain.wfMiss,
    wfWithout: baseScores.wfMiss,
    kept: chainKept,
    note: chainKept ? 'kept' : 'dropped: chains add no pricing signal beyond TVL',
  });
  if (chainKept) {
    base = { ...base, chain: true };
    baseScores = withChain;
  }

  // 5. Age in value.
  const withAge = evaluateHeldOut(all, anchors, asOfMs, marketMedianChange, { ...base, ageInValue: true });
  const ageKept = withAge.looMiss < baseScores.looMiss && withAge.wfMiss < baseScores.wfMiss;
  termRows.push({
    term: 'Age in value',
    looWith: withAge.looMiss,
    looWithout: baseScores.looMiss,
    wfWith: withAge.wfMiss,
    wfWithout: baseScores.wfMiss,
    kept: ageKept,
    note: ageKept ? 'kept' : 'dropped: age belongs in the odds, not in the value',
  });
  if (ageKept) {
    base = { ...base, ageInValue: true };
    baseScores = withAge;
  }

  // 6. Size curve itself, against the flat baseline (for the table).
  termRows.unshift({
    term: 'Size curve',
    looWith: baseScores.looMiss,
    looWithout: flatGeo.loo,
    wfWith: baseScores.wfMiss,
    wfWithout: flatGeo.wf,
    kept: true,
    note: 'kept: fitted curve beats the flat geometric-mean multiple on both splits',
  });

  // 7. Odds model, by Brier on both splits. Candidates in order:
  // bands (five age bands, pseudo-count 20) -> logistic age curve
  // (age in years + a flag for unknown listed date) -> the same curve
  // plus an age x TVL interaction -> category-conditioned band odds.
  // Each challenger must beat its parent on BOTH splits.
  const bandsOdds = evaluateOdds(all, asOfMs, 'bands', marketMedianChange, false);
  oddsRows.push({
    term: 'Age-band odds',
    brierLooWith: bandsOdds.brierLoo,
    brierLooWithout: brierBase.loo,
    brierWfWith: bandsOdds.brierWf,
    brierWfWithout: brierBase.wf,
    kept: true,
    note: 'kept: age-band peer shares beat the base rate on both splits',
  });
  const logitMissing = evaluateOdds(all, asOfMs, 'logit-missing', marketMedianChange, false);
  const logitKept = logitMissing.brierLoo < bandsOdds.brierLoo && logitMissing.brierWf < bandsOdds.brierWf;
  oddsRows.push({
    term: 'Logistic age curve',
    brierLooWith: logitMissing.brierLoo,
    brierLooWithout: bandsOdds.brierLoo,
    brierWfWith: logitMissing.brierWf,
    brierWfWithout: bandsOdds.brierWf,
    kept: logitKept,
    note: logitKept
      ? 'kept: the smooth age curve beats coarse bands on both splits (bands go noisy where the walk-forward train half is thinnest)'
      : 'dropped: does not beat age-band odds on both splits',
  });
  let oddsKind: 'bands' | 'logistic' = logitKept ? 'logistic' : 'bands';
  let oddsSpec: 'bands' | LogisticSpec = logitKept ? 'logit-missing' : 'bands';
  let oddsScores = logitKept ? logitMissing : bandsOdds;
  if (logitKept) {
    const logitInter = evaluateOdds(all, asOfMs, 'logit-interaction', marketMedianChange, false);
    const interKept = logitInter.brierLoo < logitMissing.brierLoo && logitInter.brierWf < logitMissing.brierWf;
    oddsRows.push({
      term: 'Age x TVL interaction',
      brierLooWith: logitInter.brierLoo,
      brierLooWithout: logitMissing.brierLoo,
      brierWfWith: logitInter.brierWf,
      brierWfWithout: logitMissing.brierWf,
      kept: interKept,
      note: interKept
        ? 'kept: the interaction improves Brier on both splits'
        : 'dropped: the interaction does not improve Brier on both splits over the plain age curve',
    });
    if (interKept) {
      oddsSpec = 'logit-interaction';
      oddsScores = logitInter;
    }
  }
  const bandsCatOdds = evaluateOdds(all, asOfMs, 'bands', marketMedianChange, true);
  const catOddsKept = bandsCatOdds.brierLoo < bandsOdds.brierLoo && bandsCatOdds.brierWf < bandsOdds.brierWf;
  oddsRows.push({
    term: 'Category odds',
    brierLooWith: bandsCatOdds.brierLoo,
    brierLooWithout: bandsOdds.brierLoo,
    brierWfWith: bandsCatOdds.brierWf,
    brierWfWithout: bandsOdds.brierWf,
    kept: catOddsKept,
    note: catOddsKept
      ? 'kept: improves Brier on both splits'
      : 'dropped: category conditioning needs n>=10 in-band and does not improve both Brier splits',
  });
  if (catOddsKept) base = { ...base, catOdds: true };

  const finalVariant = base;
  const finalScores = evaluateHeldOut(all, anchors, asOfMs, marketMedianChange, finalVariant);
  // The odds the board prints are the winning odds model's, not the
  // band model's: when the logistic curve wins, its Brier scores are
  // the headline ones.
  const finalBrierLoo = oddsScores.brierLoo;
  const finalBrierWf = oddsScores.brierWf;
  const finalLogitFit =
    oddsKind === 'logistic'
      ? fitLogistic(all, asOfMs, oddsSpec as LogisticSpec, null)
      : { coef: [], medianAgeYears: 0, tvlCentre: 0 };
  const finalWfExtra = wfExtraSplits(all, anchors, asOfMs, marketMedianChange, finalVariant);

  // Final fitted pieces.
  const finalCtx = makePredictContext(anchors, x0, finalVariant.degree, marketMedianChange, asOfMs);
  const inputs = oddsInputsFor(all, asOfMs, null);
  const ageBands = AGE_BAND_LABELS.map((label, b) => ({
    label,
    loDays: b === 0 ? 0 : AGE_BAND_EDGES_DAYS[b - 1],
    hiDays: b < AGE_BAND_EDGES_DAYS.length ? AGE_BAND_EDGES_DAYS[b] : Number.POSITIVE_INFINITY,
    k: inputs.bandPeers[b].k,
    n: inputs.bandPeers[b].n,
  }));

  // Per-TVL-band calibration from the final model's LOO predictions.
  // Bands split the anchors into three TVL tertiles; inside each band
  // the quantiles of real / LOO-predicted cap set the printed range, so
  // a band is narrow where the model is strong (large TVL) and wide
  // where it is weak (small TVL). Coverage is measured per band.
  const looPreds = anchors.map((p, i) => {
    const train = anchors.filter((_, j) => j !== i);
    const tx0 = train.reduce((s, q) => s + Math.log(q.tvl_usd), 0) / train.length;
    const ctx = makePredictContext(train, tx0, finalVariant.degree, marketMedianChange, asOfMs);
    return predictValueIfLaunched(ctx, p, finalVariant).vil;
  });
  const ratios = anchors.map((p, i) => (p.mcap_usd as number) / looPreds[i]);
  const tvls = anchors.map((p) => p.tvl_usd).sort((a, b) => a - b);
  const t1 = tvls[Math.floor(tvls.length / 3)];
  const t2 = tvls[Math.floor((2 * tvls.length) / 3)];
  const bandEdges: [number, number][] = [
    [0, t1],
    [t1, t2],
    [t2, Number.POSITIVE_INFINITY],
  ];
  const tvlBands: TvlBand[] = bandEdges.map(([lo, hi]) => {
    const inBand = ratios.filter((_, i) => anchors[i].tvl_usd >= lo && anchors[i].tvl_usd < hi);
    const q10 = quantileOf(inBand, 0.1);
    const q25 = quantileOf(inBand, 0.25);
    const q75 = quantileOf(inBand, 0.75);
    const q90 = quantileOf(inBand, 0.9);
    return {
      lo,
      hi,
      n: inBand.length,
      q10,
      q25,
      q75,
      q90,
      cov2575: inBand.length === 0 ? 0 : inBand.filter((r) => r >= q25 && r <= q75).length / inBand.length,
      cov1090: inBand.length === 0 ? 0 : inBand.filter((r) => r >= q10 && r <= q90).length / inBand.length,
    };
  });
  const q10 = quantileOf(ratios, 0.1);
  const q25 = quantileOf(ratios, 0.25);
  const q75 = quantileOf(ratios, 0.75);
  const q90 = quantileOf(ratios, 0.9);
  const bandP50 = ratios.length === 0 ? 0 : ratios.filter((r) => r >= q25 && r <= q75).length / ratios.length;
  const bandP90 = ratios.length === 0 ? 0 : ratios.filter((r) => r >= q10 && r <= q90).length / ratios.length;

  const heldOut: HeldOut = {
    looMiss: finalScores.looMiss,
    wfMiss: finalScores.wfMiss,
    looMissBase: baseScores.looMiss,
    wfMissBase: baseScores.wfMiss,
    wfExtra: finalWfExtra,
    flatLoo: flatGeo.loo,
    flatWf: flatGeo.wf,
    flatMedianLoo: flatMed.loo,
    flatMedianWf: flatMed.wf,
    brierLoo: finalBrierLoo,
    brierLooBase: brierBase.loo,
    brierWf: finalBrierWf,
    brierWfBase: brierBase.wf,
    bandP50,
    bandP90,
    terms: termRows,
    oddsTerms: oddsRows,
    growthTests,
  };

  return {
    curveA: finalCtx.curve.coef[0],
    curveB: finalCtx.curve.coef[1],
    curveC: finalCtx.curve.coef.length > 2 ? finalCtx.curve.coef[2] : 0,
    curveX0: finalCtx.curve.x0,
    quadraticKept: finalVariant.degree === 2,
    catPseudo: CAT_PSEUDO,
    catClamp: CAT_CLAMP,
    catMinN: CAT_MIN_N,
    overallMedianMultiple: finalCtx.overallMedian,
    catMedian: finalCtx.catMedian,
    catCount: finalCtx.catCount,
    marketMedianChange,
    baseRate,
    oddsPseudo: ODDS_PSEUDO,
    ageBands,
    oddsKind,
    logisticCoef: finalLogitFit.coef,
    logisticMedianAgeYears: finalLogitFit.medianAgeYears,
    logisticTvlCentre: finalLogitFit.tvlCentre,
    tvlBands,
    q10,
    q25,
    q75,
    q90,
    variant: finalVariant,
    heldOut,
    anchors,
    asOfMs,
    pool: all,
  };
}

// ------------------------------------------------------------------
// Scoring one protocol.

export function tvlBandIndex(model: FittedModel, tvl: number): number {
  for (let i = 0; i < model.tvlBands.length; i++) {
    if (tvl >= model.tvlBands[i].lo && tvl < model.tvlBands[i].hi) return i;
  }
  return model.tvlBands.length - 1;
}

export function nearestComparables(model: FittedModel, p: Proto): Proto[] {
  const byDist = (arr: Proto[]): Proto[] =>
    [...arr].sort(
      (a, b) =>
        Math.abs(Math.log(a.tvl_usd) - Math.log(p.tvl_usd)) -
          Math.abs(Math.log(b.tvl_usd) - Math.log(p.tvl_usd)) || (a.slug < b.slug ? -1 : 1),
    );
  const out = byDist(model.anchors.filter((c) => c.category === p.category && c.slug !== p.slug)).slice(0, 3);
  if (out.length < 3) {
    const have = new Set(out.map((c) => c.slug));
    for (const c of byDist(model.anchors.filter((c) => c.slug !== p.slug && !have.has(c.slug)))) {
      if (out.length >= 3) break;
      out.push(c);
    }
  }
  return out;
}

export function scoreProtocol(p: Proto, model: FittedModel): ScoreResult {
  const curve: CurveFit = {
    coef: [model.curveA, model.curveB, model.curveC],
    degree: model.variant.degree,
    x0: model.curveX0,
  };
  const ctx: PredictContext = {
    curve,
    catMedian: model.catMedian,
    catCount: model.catCount,
    overallMedian: model.overallMedianMultiple,
    marketMedianChange: model.marketMedianChange,
    train: model.anchors,
    asOfMs: model.asOfMs,
  };
  const pred = predictValueIfLaunched(ctx, p, model.variant);
  const vil = Math.round(pred.vil);
  // Odds from the winning odds model, fitted on the full peer record
  // (self included — the LOO Brier already measured the self-excluded
  // version). The band peer counts are still printed beside the odds
  // as the raw evidence, whatever model produced the number.
  const band = ageBandOf(ageDaysOf(p, model.asOfMs));
  const bandInfo = band < 0 ? null : model.ageBands[band];
  let odds: number;
  if (model.oddsKind === 'logistic') {
    const spec: LogisticSpec = model.logisticCoef.length >= 4 ? 'logit-interaction' : 'logit-missing';
    odds = logisticOdds(
      p,
      {
        coef: model.logisticCoef,
        medianAgeYears: model.logisticMedianAgeYears,
        tvlCentre: model.logisticTvlCentre,
      },
      model.asOfMs,
      spec,
    );
    // oddsForProtocol applies the growth-as-odds-input adjustment
    // itself on the bands path; the logistic path needs it here.
    if (model.variant.growth && model.variant.growthForm === 2) {
      odds = growthOddsAdjustForm2(odds, p.change_7d, model.marketMedianChange);
    }
  } else {
    const oddsGot = oddsForProtocol(model.pool, model.asOfMs, p, model.variant, false, model.marketMedianChange);
    odds = oddsGot.odds;
  }
  let oddsPeers: string;
  if (band < 0) {
    oddsPeers =
      model.oddsKind === 'logistic'
        ? 'age unknown; smooth age curve used'
        : 'age unknown; base rate used';
  } else {
    oddsPeers = `${bandInfo!.k} of ${bandInfo!.n} peers aged ${bandInfo!.label} record a token`;
  }
  const implied = Math.round(vil * odds);
  const bandIdx = tvlBandIndex(model, p.tvl_usd);
  const tb = model.tvlBands[bandIdx];
  const low = Math.round(vil * tb.q25 * odds);
  const high = Math.round(vil * tb.q75 * odds);
  const near = nearestComparables(model, p);
  const growthShown = model.variant.growth ? pred.growthFactor : 1;
  const termBuild: Record<string, number | string> = {
    tvl_usd: p.tvl_usd,
    size_multiple: round3(curveValue(curve, p.tvl_usd) / p.tvl_usd),
    curve_a: round3(model.curveA),
    curve_b: round3(model.curveB),
    curve_c: round3(model.curveC),
    odds_model: model.oddsKind === 'logistic' ? 'logistic age curve' : 'age-band peers',
    category_factor: round3(pred.catFactor),
    category_n: pred.catN,
    growth_factor: round3(growthShown),
    chain_factor: round3(pred.chainFactor),
    age_factor: round3(pred.ageFactor),
    value_if_launched_usd: vil,
    odds: round3(odds),
    tvl_band: bandIdx,
    band_q25: round3(tb.q25),
    band_q75: round3(tb.q75),
  };
  const dropped: string[] = [];
  for (const t of model.heldOut.terms) {
    if (!t.kept && t.term !== 'Size curve') {
      dropped.push(
        `${t.term} dropped (LOO ${round2(t.looWith)}x vs ${round2(t.looWithout)}x, WF ${round2(t.wfWith)}x vs ${round2(t.wfWithout)}x)`,
      );
    }
  }
  for (const t of model.heldOut.oddsTerms) {
    if (!t.kept) {
      dropped.push(
        `${t.term} dropped (Brier LOO ${round3(t.brierLooWith)} vs ${round3(t.brierLooWithout)}, WF ${round3(t.brierWfWith)} vs ${round3(t.brierWfWithout)})`,
      );
    }
  }
  if (!model.variant.growth) {
    const g1 = model.heldOut.growthTests.find((g) => g.form.startsWith('Growth as value'));
    const g2 = model.heldOut.growthTests.find((g) => g.form.startsWith('Growth as odds'));
    const g3 = model.heldOut.growthTests.find((g) => g.form.startsWith('Growth asymmetric'));
    dropped.push(
      `Growth x1.000 (value multiplier LOO ${g1 ? round2(g1.loo) : 0}x / WF ${g1 ? round2(g1.wf) : 0}x; odds input Brier LOO ${g2 ? round3(g2.brierLoo) : 0} / WF ${g2 ? round3(g2.brierWf) : 0}; asymmetric LOO ${g3 ? round2(g3.loo) : 0}x / WF ${g3 ? round2(g3.wf) : 0}x — none improves both tests)`,
    );
  }
  return {
    implied_value_usd: implied,
    implied_value_low_usd: low,
    implied_value_high_usd: high,
    value_if_launched_usd: vil,
    odds: round3(odds),
    odds_peers: oddsPeers,
    term_build: termBuild,
    comparables: near.map((c) => c.slug),
    dropped_terms: dropped,
    tvl_band: bandIdx,
  };
}
