// Token Launch Radar — main program.
// Reads the sealed snapshot, fits a value model from the snapshot's own
// figures, ranks the pre-token protocols, costs a farm plan per row, and
// writes board.json, the dashboard data file, and dossier.json.
// Standard library only. Deterministic: fixed seeds, fixed sort orders,
// no timestamps, no randomness, no absolute paths in any output.

import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SEED = 20261114;
const BOOTSTRAPS = 200;
const ODDS_PSEUDO = 5; // peers of shrinkage toward the base rate
const CAT_PSEUDO = 5; // pseudo-count shrinking category factors toward 1
const DROP_SHARE = 0.07;
const HORIZON_WEEKS = 12;
const TBILL = 0.04;
const HOUR_HURDLE = 25;

interface Proto {
  slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null;
  listed_at: string | null; gecko_id: string | null; symbol: string | null;
}
interface Snap { as_of: string; source: string; floor_usd: number; protocols: Proto[]; watchlist: string[]; }

// ---------- small deterministic helpers ----------
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 0;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};
const quantile = (xs: number[], q: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return 0;
  const pos = q * (s.length - 1);
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
};
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const r2 = (x: number): number => Math.round(x * 100) / 100;
const r3 = (x: number): number => Math.round(x * 1000) / 1000;
const commas = (n: number): string => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const mulberry32 = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
// FNV-1a 32-bit, hex — the board checksum the page recomputes.
const fnv1a = (s: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return ('0000000' + (h >>> 0).toString(16)).slice(-8);
};
const miss = (pred: number, real: number): number => Math.max(pred / real, real / pred);

// ---------- args / input ----------
const args = process.argv.slice(2);
let inputPath = '/input/snapshot.json';
for (let i = 0; i < args.length; i++) if (args[i] === '--input' && args[i + 1]) inputPath = args[i + 1];
const OUT = process.env.MAKEFUN_OUTPUT_DIR || '/output';
const snap: Snap = JSON.parse(readFileSync(inputPath, 'utf8'));
const protos = snap.protocols;
const floor = snap.floor_usd;
const asOf = new Date(snap.as_of + 'T00:00:00Z').getTime();
const dayMs = 86400000;
const ageDays = (p: Proto): number | null =>
  p.listed_at ? Math.round((asOf - new Date(p.listed_at + 'T00:00:00Z').getTime()) / dayMs) : null;
const recordsToken = (p: Proto): boolean => p.gecko_id !== null || p.symbol !== null;
const isPre = (p: Proto): boolean => !recordsToken(p);

// Age bands: under 6 months, 6-12 months, 1-2 years, 2-3 years, over 3 years.
const bandOf = (age: number | null): number =>
  age === null ? -1 : age < 183 ? 0 : age < 365 ? 1 : age < 730 ? 2 : age < 1096 ? 3 : 4;

// ---------- universe split ----------
const watchSet = new Set(snap.watchlist);
const pre = protos.filter(isPre);
const traded = protos.filter(recordsToken);
const comps = traded.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0);
const tradedNoMcap = traded.length - comps.length;
const early = pre.filter((p) => p.tvl_usd < floor).sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));
const earlyRanked = early.slice(0, 158);
const cutoff = earlyRanked.length ? earlyRanked[earlyRanked.length - 1].tvl_usd : 0;
const belowCutoff = early.length - earlyRanked.length;
const watchProtos = protos.filter((p) => watchSet.has(p.slug));
const rankedPool = [...watchProtos, ...earlyRanked];
const aboveFloorOff = pre.filter((p) => p.tvl_usd >= floor && !watchSet.has(p.slug));

// Ledger reason breakdown for the above-floor off-list protocols, by rule.
const EXCL_CATS = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const reasonOf = (p: Proto): string => {
  if (p.category !== null && EXCL_CATS.has(p.category)) return 'category';
  if (/\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/.test(p.name)) return 'versioned';
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return 'wrapped/staked';
  return 'other';
};
const reasons: Record<string, number> = {};
for (const p of aboveFloorOff) reasons[reasonOf(p)] = (reasons[reasonOf(p)] || 0) + 1;
const ledger = {
  ranked: rankedPool.length, anchors: comps.length, tradedNoMcap,
  unranked: pre.length - rankedPool.length, aboveFloor: aboveFloorOff.length,
  belowCutoff, total: protos.length, cutoff, reasons,
};

// ---------- market context ----------
const changes = protos.map((p) => p.change_7d).filter((x): x is number => x !== null);
const marketMedChg = median(changes);
const baseRate = traded.length / protos.length;
// Age-band peer counts over all protocols with a known listed date.
const bandPeers: { k: number; n: number }[] = [0, 1, 2, 3, 4].map((b) => {
  const peers = protos.filter((p) => bandOf(ageDays(p)) === b);
  return { k: peers.filter(recordsToken).length, n: peers.length };
});
const oddsFor = (band: number): number => {
  if (band < 0) return baseRate;
  const { k, n } = bandPeers[band];
  return (k + ODDS_PSEUDO * baseRate) / (n + ODDS_PSEUDO);
};

// ---------- size curve: robust log-log power law ----------
// fitCurve returns {a, b}: ln(mcap) = a + b * ln(tvl), Huber-reweighted.
// The 3-sigma threshold is deliberate: the classic 1.345-sigma cut
// downweighted the very points that carry the signal, and scored worse
// on BOTH held-out tests (LOO 3.51x / WF 3.18x) than this milder fit.
interface Curve { a: number; b: number; c?: number; x0?: number; }
// Fixed centre for the quadratic term: mean ln TVL over the full
// comparable set, so the (a, b, c) constants are stable across refits.
const X0 = comps.reduce((s, p) => s + Math.log(p.tvl_usd), 0) / comps.length;
function gauss3(A: number[][], b: number[]): number[] {
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let r = col + 1; r < 3; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = col + 1; r < 3; r++) {
      const f = M[r][col] / M[col][col];
      for (let k = col; k < 4; k++) M[r][k] -= f * M[col][k];
    }
  }
  const x = [0, 0, 0];
  for (let r = 2; r >= 0; r--) {
    let s = M[r][3];
    for (let k = r + 1; k < 3; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}
// Quadratic log-log fit: ln(mcap) = a + b*u + c*u^2, u = ln(tvl) - X0.
// Same Huber reweighting (3-sigma, 5 passes) as the power-law fit.
function fitCurveQuad(train: Proto[]): Curve {
  const pts = train.map((p) => {
    const u = Math.log(p.tvl_usd) - X0;
    return { u, y: Math.log(p.mcap_usd as number), w: 1 };
  });
  const solve = (): Curve => {
    let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, t0 = 0, t1 = 0, t2 = 0;
    for (const p of pts) {
      const u = p.u, u2 = u * u, w = p.w;
      s0 += w; s1 += w * u; s2 += w * u2; s3 += w * u2 * u; s4 += w * u2 * u2;
      t0 += w * p.y; t1 += w * u * p.y; t2 += w * u2 * p.y;
    }
    const [a, b, c] = gauss3([[s0, s1, s2], [s1, s2, s3], [s2, s3, s4]], [t0, t1, t2]);
    return { a, b, c, x0: X0 };
  };
  let c = solve();
  for (let it = 0; it < 5; it++) {
    const res = pts.map((p) => p.y - (c.a + c.b * p.u + (c.c as number) * p.u * p.u));
    const med = median(res);
    const mad = median(res.map((r) => Math.abs(r - med))) || 1e-9;
    const s = 1.4826 * mad;
    for (let i = 0; i < pts.length; i++) {
      const ar = Math.abs(res[i]);
      pts[i].w = ar <= 3 * s ? 1 : (3 * s) / ar;
    }
    c = solve();
  }
  return c;
}
function ols(pts: { x: number; y: number; w: number }[]): Curve {
  let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of pts) { sw += p.w; sx += p.w * p.x; sy += p.w * p.y; sxx += p.w * p.x * p.x; sxy += p.w * p.x * p.y; }
  const den = sw * sxx - sx * sx;
  const b = den === 0 ? 0 : (sw * sxy - sx * sy) / den;
  return { a: (sy - b * sx) / sw, b };
}
function fitCurve(train: Proto[]): Curve {
  const pts = train.map((p) => ({ x: Math.log(p.tvl_usd), y: Math.log(p.mcap_usd as number), w: 1 }));
  let c = ols(pts);
  for (let it = 0; it < 5; it++) {
    const res = pts.map((p) => p.y - (c.a + c.b * p.x));
    const med = median(res);
    const mad = median(res.map((r) => Math.abs(r - med))) || 1e-9;
    const s = 1.4826 * mad;
    for (let i = 0; i < pts.length; i++) {
      const ar = Math.abs(res[i]);
      pts[i].w = ar <= 3 * s ? 1 : (3 * s) / ar;
    }
    c = ols(pts);
  }
  return c;
}
interface Model {
  curve: Curve; overallMed: number;
  catMed: Map<string, number>; catN: Map<string, number>;
  chainMed: Map<string, number>; chainN: Map<string, number>;
  ageMed: Map<string, number>; ageN: Map<string, number>;
}
const ageKeyOf = (age: number | null): string =>
  age === null ? 'u' : age < 365 ? 'y0' : age < 730 ? 'y1' : age < 1096 ? 'y2' : 'y3';
function fitModel(train: Proto[], quad = false): Model {
  const mults = train.map((p) => (p.mcap_usd as number) / p.tvl_usd);
  const overallMed = median(mults);
  const catMed = new Map<string, number>(), catN = new Map<string, number>();
  const chainMed = new Map<string, number>(), chainN = new Map<string, number>();
  const ageMed = new Map<string, number>(), ageN = new Map<string, number>();
  const byCat = new Map<string, number[]>(), byChain = new Map<string, number[]>(), byAge = new Map<string, number[]>();
  for (const p of train) {
    const m = (p.mcap_usd as number) / p.tvl_usd;
    const ck = p.category ?? '';
    if (!byCat.has(ck)) byCat.set(ck, []);
    byCat.get(ck)!.push(m);
    const bk = p.chains.length === 1 ? '1' : p.chains.length <= 3 ? '2-3' : '4+';
    if (!byChain.has(bk)) byChain.set(bk, []);
    byChain.get(bk)!.push(m);
    const ak = ageKeyOf(ageDays(p));
    if (!byAge.has(ak)) byAge.set(ak, []);
    byAge.get(ak)!.push(m);
  }
  for (const [k, v] of byCat) { catMed.set(k, median(v)); catN.set(k, v.length); }
  for (const [k, v] of byChain) { chainMed.set(k, median(v)); chainN.set(k, v.length); }
  for (const [k, v] of byAge) { ageMed.set(k, median(v)); ageN.set(k, v.length); }
  return { curve: quad ? fitCurveQuad(train) : fitCurve(train), overallMed, catMed, catN, chainMed, chainN, ageMed, ageN };
}
// The adopted size curve: power law, or quadratic in log-log space when kept.
const curveVal = (m: Model, tvl: number): number => {
  const c = m.curve;
  if (c.c === undefined) return Math.exp(c.a + c.b * Math.log(tvl));
  const u = Math.log(tvl) - (c.x0 as number);
  return Math.exp(c.a + c.b * u + c.c * u * u);
};
const catFactor = (m: Model, cat: string | null): number => {
  const n = m.catN.get(cat ?? '') || 0;
  if (n < 5) return 1;
  const raw = (m.catMed.get(cat ?? '') as number) / m.overallMed;
  return clamp(1 + (raw - 1) * (n / (n + CAT_PSEUDO)), 0.5, 2);
};
const chainFactor = (m: Model, chains: number): number => {
  const bk = chains === 1 ? '1' : chains <= 3 ? '2-3' : '4+';
  const n = m.chainN.get(bk) || 0;
  if (n < 5) return 1;
  const raw = (m.chainMed.get(bk) as number) / m.overallMed;
  return clamp(1 + (raw - 1) * (n / (n + CAT_PSEUDO)), 0.7, 1.4);
};
const growthCarry = (chg: number | null): number => {
  if (chg === null) return 1;
  const excess = clamp(chg - marketMedChg, -25, 25);
  return clamp(1 + excess / 100, 0.8, 1.25);
};
const ageFactor = (m: Model, age: number | null): number => {
  const k = ageKeyOf(age);
  const n = m.ageN.get(k) || 0;
  if (n < 5) return 1;
  const raw = (m.ageMed.get(k) as number) / m.overallMed;
  return clamp(1 + (raw - 1) * (n / (n + CAT_PSEUDO)), 0.5, 2);
};
interface Variant { quad: boolean; cat: boolean; growth: boolean; chain: boolean; age?: boolean; }
const predictVil = (m: Model, p: Proto, v: Variant): number => {
  let pred = curveVal(m, p.tvl_usd);
  if (v.cat) pred *= catFactor(m, p.category);
  if (v.growth) pred *= growthCarry(p.change_7d);
  if (v.chain) pred *= chainFactor(m, p.chains.length);
  if (v.age) pred *= ageFactor(m, ageDays(p));
  return pred;
};
const flatMult = median(comps.map((p) => (p.mcap_usd as number) / p.tvl_usd));

// ---------- held-out tests ----------
// Leave-one-out over the comparables, for one variant.
function looMiss(v: Variant): number {
  const ms: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const train = comps.filter((_, j) => j !== i);
    const m = fitModel(train, v.quad);
    ms.push(miss(predictVil(m, comps[i], v), comps[i].mcap_usd as number));
  }
  return median(ms);
}
function looFlat(): number {
  const ms: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const rest = comps.filter((_, j) => j !== i).map((p) => (p.mcap_usd as number) / p.tvl_usd);
    ms.push(miss(median(rest) * comps[i].tvl_usd, comps[i].mcap_usd as number));
  }
  return median(ms);
}
// Older-to-newer (walk-forward): order the dated comparables by listed date,
// fit on the older half, price the newer half. Protocols with no listed date
// have no date to order by, so they sit out of this test.
const compsByDate = comps.filter((p) => p.listed_at !== null).sort((a, b) =>
  (a.listed_at as string) < (b.listed_at as string) ? -1 : (a.listed_at as string) > (b.listed_at as string) ? 1 : (a.slug < b.slug ? -1 : 1));
const wfHalf = Math.floor(compsByDate.length / 2);
const wfTrain = compsByDate.slice(0, wfHalf);
const wfTest = compsByDate.slice(wfHalf);
function wfMiss(v: Variant): number {
  const m = fitModel(wfTrain, v.quad);
  return median(wfTest.map((p) => miss(predictVil(m, p, v), p.mcap_usd as number)));
}
function wfFlat(): number {
  const fm = median(wfTrain.map((p) => (p.mcap_usd as number) / p.tvl_usd));
  return median(wfTest.map((p) => miss(fm * p.tvl_usd, p.mcap_usd as number)));
}
const BASE: Variant = { quad: false, cat: false, growth: false, chain: false };
const V_CAT: Variant = { ...BASE, cat: true };
const V_GRO: Variant = { ...BASE, growth: true };
const V_CHN: Variant = { ...BASE, chain: true };
const V_AGE: Variant = { ...BASE, age: true };
// A term is kept only when it improves BOTH held-out tests.
// The non-quadratic terms are tested against the power-law base, exactly
// as round 1 adopted them (category kept, the rest dropped). The quadratic
// term is then tested as an addition to that adopted power-law model —
// the comparison the DESIGN.md amendment states (quadratic vs the
// round-1 power-law fit, LOO 3.39x / walk-forward 2.91x) — and kept
// only if it improves BOTH tests against it.
const looBase = looMiss(BASE), wfBase = wfMiss(BASE);
const looFlatM = looFlat(), wfFlatM = wfFlat();
const looCat = looMiss(V_CAT), wfCat = wfMiss(V_CAT);
const looGro = looMiss(V_GRO), wfGro = wfMiss(V_GRO);
const looChn = looMiss(V_CHN), wfChn = wfMiss(V_CHN);
const looAge = looMiss(V_AGE), wfAge = wfMiss(V_AGE);
const catKept = looCat < looBase && wfCat < wfBase;
const growthKept = looGro < looBase && wfGro < wfBase;
const chainKept = looChn < looBase && wfChn < wfBase;
const ageKept = looAge < looBase && wfAge < wfBase;
const PL_FINAL: Variant = { ...BASE, cat: catKept, growth: growthKept, chain: chainKept, age: ageKept };
const looPl = looMiss(PL_FINAL), wfPl = wfMiss(PL_FINAL);
const QUAD_V: Variant = { ...PL_FINAL, quad: true };
const looQuad = looMiss(QUAD_V), wfQuad = wfMiss(QUAD_V);
const quadKept = looQuad < looPl && wfQuad < wfPl;
const FINAL_V: Variant = quadKept ? QUAD_V : PL_FINAL;
const looFinal = quadKept ? looQuad : looPl, wfFinal = quadKept ? wfQuad : wfPl;
// Diagnostic only (not the keep decision): quadratic alone vs power-law alone.
const looQuadOnly = looMiss({ quad: true, cat: false, growth: false, chain: false });
const wfQuadOnly = wfMiss({ quad: true, cat: false, growth: false, chain: false });

// ---------- token odds: Brier scores ----------
// Leave-one-out Brier over all 758 protocols, age-band odds (self excluded).
function brierLoo(catCond: boolean): number {
  let sum = 0;
  for (const p of protos) {
    const y = recordsToken(p) ? 1 : 0;
    const band = bandOf(ageDays(p));
    let o: number;
    if (band < 0) {
      const base = (traded.length - y) / (protos.length - 1);
      o = base;
    } else {
      const peers = protos.filter((q) => q !== p && bandOf(ageDays(q)) === band);
      const n = peers.length, k = peers.filter(recordsToken).length;
      const base = traded.length / protos.length;
      if (catCond) {
        const sub = peers.filter((q) => q.category === p.category);
        if (sub.length >= 10) {
          const sk = sub.filter(recordsToken).length;
          o = (sk + ODDS_PSEUDO * base) / (sub.length + ODDS_PSEUDO);
        } else o = (k + ODDS_PSEUDO * base) / (n + ODDS_PSEUDO);
      } else o = (k + ODDS_PSEUDO * base) / (n + ODDS_PSEUDO);
    }
    sum += (o - y) * (o - y);
  }
  return sum / protos.length;
}
function brierLooBase(): number {
  let sum = 0;
  for (const p of protos) {
    const y = recordsToken(p) ? 1 : 0;
    const base = (traded.length - y) / (protos.length - 1);
    sum += (base - y) * (base - y);
  }
  return sum / protos.length;
}
// Walk-forward Brier: band rates from the older half of dated protocols, scored on the newer half.
const dated = protos.filter((p) => p.listed_at !== null).sort((a, b) =>
  (a.listed_at as string) < (b.listed_at as string) ? -1 : (a.listed_at as string) > (b.listed_at as string) ? 1 : (a.slug < b.slug ? -1 : 1));
const dHalf = Math.floor(dated.length / 2);
const dTrain = dated.slice(0, dHalf), dTest = dated.slice(dHalf);
function brierWf(catCond: boolean): number {
  const base = dTrain.filter(recordsToken).length / dTrain.length;
  let sum = 0;
  for (const p of dTest) {
    const y = recordsToken(p) ? 1 : 0;
    const band = bandOf(ageDays(p));
    const peers = dTrain.filter((q) => bandOf(ageDays(q)) === band);
    let o = peers.length ? (peers.filter(recordsToken).length + ODDS_PSEUDO * base) / (peers.length + ODDS_PSEUDO) : base;
    if (catCond) {
      const sub = peers.filter((q) => q.category === p.category);
      if (sub.length >= 10) o = (sub.filter(recordsToken).length + ODDS_PSEUDO * base) / (sub.length + ODDS_PSEUDO);
    }
    sum += (o - y) * (o - y);
  }
  return sum / dTest.length;
}
function brierWfBase(): number {
  const base = dTrain.filter(recordsToken).length / dTrain.length;
  let sum = 0;
  for (const p of dTest) { const y = recordsToken(p) ? 1 : 0; sum += (base - y) * (base - y); }
  return sum / dTest.length;
}
const brLoo = brierLoo(false), brLooBase = brierLooBase();
const brWf = brierWf(false), brWfBase = brierWfBase();
const brLooCat = brierLoo(true), brWfCat = brierWf(true);
const catOddsKept = brLooCat < brLoo && brWfCat < brWf;

// ---------- final model, bands, bootstrap rank ranges ----------
const finalModel = fitModel(comps, quadKept);
// Leave-one-out predictions of the final model, for calibrated bands.
const looPreds = comps.map((p, i) => {
  const m = fitModel(comps.filter((_, j) => j !== i), quadKept);
  return predictVil(m, p, FINAL_V);
});
const ratios = comps.map((p, i) => (p.mcap_usd as number) / looPreds[i]);
const q10 = quantile(ratios, 0.1), q25 = quantile(ratios, 0.25);
const q75 = quantile(ratios, 0.75), q90 = quantile(ratios, 0.9);
const cov2575 = ratios.filter((r) => r >= q25 && r <= q75).length / ratios.length;
const cov1090 = ratios.filter((r) => r >= q10 && r <= q90).length / ratios.length;

// Nearest traded comparables by TVL, same category first, else overall.
function nearestComps(p: Proto): Proto[] {
  const byDist = (arr: Proto[]) => [...arr].sort((a, b) =>
    Math.abs(Math.log(a.tvl_usd) - Math.log(p.tvl_usd)) - Math.abs(Math.log(b.tvl_usd) - Math.log(p.tvl_usd))
    || (a.slug < b.slug ? -1 : 1));
  const out = byDist(comps.filter((c) => c.category === p.category && c.slug !== p.slug)).slice(0, 3);
  if (out.length < 3) {
    const have = new Set(out.map((c) => c.slug));
    for (const c of byDist(comps.filter((c) => c.slug !== p.slug && !have.has(c.slug)))) {
      if (out.length >= 3) break;
      out.push(c);
    }
  }
  return out;
}

// ---------- farm plans ----------
// Category family: 0 vault/curated, 1 liquidity/swap, 2 mint-and-hold,
// 3 lend/borrow, 4 tokenised asset, 5 chain/infrastructure.
function familyOf(cat: string | null): number {
  if (!cat) return 0;
  if (['Dexs', 'Derivatives', 'Basis Trading'].includes(cat)) return 1;
  if (['Lending'].includes(cat)) return 3;
  if (['CDP', 'CeDeFi', 'Insurance'].includes(cat)) return 2;
  if (['Payments'].includes(cat)) return 4;
  if (['Chain'].includes(cat)) return 5;
  return 0;
}
// Step template: [text with {N} {D} {C} {T}, fee $, hands-on min, waiting min]
type StepT = [string, number, number, number];
const COMMON: StepT[] = [
  ['Open a fresh wallet for {N}; fund it with ${D} from an exchange withdrawal onto {C}.', 2.5, 10, 15],
  ['Open {N} from its DefiLlama page, match its contract addresses, and never sign an approval sent in a message.', 0, 15, 0],
  ['Move ${D} onto {C} for {N} by bridge.', 3, 8, 20],
  ['Make one small qualifying transaction on {N} weekly for 12 weeks.', 6, 36, 0],
  ['Check {N} weekly; exit if TVL falls 30% below ${T} or withdrawals pause.', 0, 24, 0],
  ['Log every {N} transaction \u2014 date, hash, asset, amount, fee \u2014 for claim and tax.', 0, 24, 0],
  ['Claim only on {N}\u2019s own site, reached from its DefiLlama page; never pay to claim.', 2.5, 10, 0],
  ['Withdraw from {N}, move funds to the exchange on {C}, and close the position.', 3.5, 10, 20],
];
const CORE: StepT[] = [
  ['Deposit ${D} into the {N} vault on {C} and hold the receipt token.', 1.5, 10, 0],
  ['Provide ${D} of liquidity on {N} on {C} and swap a little through the pool.', 2, 12, 0],
  ['Mint against ${D} of collateral on {N} on {C} and hold the minted asset for 12 weeks.', 2, 12, 0],
  ['Lend ${D} on {N} on {C} and stay below the liquidation line for 12 weeks.', 1.5, 10, 0],
  ['Hold ${D} of the tokenised asset on {N} on {C} for 12 weeks.', 1.5, 10, 0],
  ['Bridge ${D} to {C} and use {N}\u2019s native venue for 12 weeks.', 2, 10, 0],
];
const TAIL: StepT[] = [
  ['Do not loop the deposit again: one position in {N} is the whole plan.', 0, 5, 0],
  ['Do not add a second pool on {N}: one liquidity position only.', 0, 5, 0],
  ['Do not mint again on the same collateral on {N}: one mint only.', 0, 5, 0],
  ['Do not borrow against the lent ${D} on {N}: one lending position only.', 0, 5, 0],
  ['Do not buy a second tokenised asset on {N}: one holding only.', 0, 5, 0],
  ['Do not bridge a second tranche to {C} for {N}: one deployment only.', 0, 5, 0],
];
function planSteps(p: Proto, dep: number, fam: number): { text: string; fee: number; min: number; wait: number }[] {
  const chain = p.chains[0] || 'its chain';
  const fill = (t: string) => t.replaceAll('{N}', p.name).replaceAll('{D}', commas(dep)).replaceAll('{C}', chain).replaceAll('{T}', commas(p.tvl_usd));
  const all: StepT[] = [COMMON[0], COMMON[1], COMMON[2], CORE[fam], COMMON[3], COMMON[4], COMMON[5], COMMON[6], COMMON[7], TAIL[fam]];
  return all.map(([t, fee, min, wait]) => {
    const time = ' Time ' + min + ' min hands-on' + (wait ? ' + ' + wait + ' min waiting' : '') + '.';
    return { text: fill(t) + ' Cost $' + fee.toFixed(2) + '.' + time, fee, min, wait };
  });
}
const planDeposit = (tvl: number): number => clamp(Math.round(tvl * 0.00025), 1000, 20000);
const sliceFor = (dep: number, share: number, tvl: number, iv: number): number => (dep / tvl) * share * iv;
function verdictOf(net: number, dep: number, mins: number): string {
  if (net <= 0) return 'SKIP';
  const tbill = dep * TBILL * (HORIZON_WEEKS / 52);
  const nph = net / (mins / 60);
  return net > tbill && nph > HOUR_HURDLE ? 'FARM' : 'THIN';
}

// ---------- value every ranked row ----------
interface RowCalc {
  p: Proto; vil: number; odds: number; band: number; iv: number;
  p25: number; p75: number; p10: number; p90: number;
  dep: number; fees: number; mins: number; wait: number;
  net: number; nph: number; verdict: string; mvc: number | null;
  fam: number; steps: string[]; near: Proto[];
}
const calcs: RowCalc[] = rankedPool.map((p) => {
  const vil = Math.round(predictVil(finalModel, p, FINAL_V));
  const band = bandOf(ageDays(p));
  const odds = oddsFor(band);
  const iv = Math.round(vil * odds);
  const fam = familyOf(p.category);
  const dep = planDeposit(p.tvl_usd);
  const steps = planSteps(p, dep, fam);
  const fees = steps.reduce((s, x) => s + x.fee, 0);
  const mins = steps.reduce((s, x) => s + x.min, 0);
  const wait = steps.reduce((s, x) => s + x.wait, 0);
  const net = Math.round(sliceFor(dep, DROP_SHARE, p.tvl_usd, iv) - fees);
  const nph = net / (mins / 60);
  const verdict = verdictOf(net, dep, mins);
  // Minimum viable capital: smallest deposit (nearest $100) where net turns positive.
  const rawMvc = (fees * p.tvl_usd) / (DROP_SHARE * iv);
  const mvc = rawMvc > 30000 ? null : Math.max(100, Math.ceil(rawMvc / 100) * 100);
  return {
    p, vil, odds, band, iv,
    p25: Math.round(vil * q25 * odds), p75: Math.round(vil * q75 * odds),
    p10: Math.round(vil * q10 * odds), p90: Math.round(vil * q90 * odds),
    dep, fees, mins, wait, net, nph, verdict, mvc, fam,
    steps: steps.map((s) => s.text), near: nearestComps(p),
  };
});
// Rank by implied value desc, ties by slug asc.
calcs.sort((a, b) => b.iv - a.iv || (a.p.slug < b.p.slug ? -1 : 1));
calcs.forEach((c, i) => { (c as unknown as { rank: number }).rank = i + 1; });

// ---------- bootstrap rank ranges (fixed seed) ----------
const rng = mulberry32(SEED);
const bootRanks = new Map<string, number[]>();
for (const c of calcs) bootRanks.set(c.p.slug, []);
for (let b = 0; b < BOOTSTRAPS; b++) {
  const sample: Proto[] = [];
  for (let i = 0; i < comps.length; i++) sample.push(comps[Math.floor(rng() * comps.length)]);
  const m = fitModel(sample, quadKept);
  const scored = calcs.map((c) => ({ slug: c.p.slug, iv: predictVil(m, c.p, FINAL_V) * c.odds }));
  scored.sort((a, b2) => b2.iv - a.iv || (a.slug < b2.slug ? -1 : 1));
  scored.forEach((s, i) => bootRanks.get(s.slug)!.push(i + 1));
}
const rankRange = (slug: string): [number, number] => {
  const rs = bootRanks.get(slug) as number[];
  return [Math.round(quantile(rs, 0.05)), Math.round(quantile(rs, 0.95))];
};

// ---------- board.json ----------
const rows = calcs.map((c) => {
  const rank = (c as unknown as { rank: number }).rank;
  const [rlo, rhi] = rankRange(c.p.slug);
  const bp = c.band < 0 ? null : bandPeers[c.band];
  return {
    slug: c.p.slug, name: c.p.name, rank, implied_value_usd: c.iv,
    farm_steps: c.steps,
    tvl_usd: c.p.tvl_usd, change_7d: c.p.change_7d, age_days: ageDays(c.p),
    category: c.p.category, chains: c.p.chains,
    watchlist: watchSet.has(c.p.slug), early: c.p.tvl_usd < floor,
    token_odds: r3(c.odds),
    odds_peers: c.band < 0 ? 'age unknown; base rate used' : `${bp!.k} of ${bp!.n} peers aged ${['under 6 months', '6-12 months', '1-2 years', '2-3 years', 'over 3 years'][c.band]} record a token`,
    value_if_launched_usd: c.vil,
    p25_usd: c.p25, p75_usd: c.p75, p10_usd: c.p10, p90_usd: c.p90,
    rank_low: rlo, rank_high: rhi,
    verdict: c.verdict, net_usd: c.net, net_per_hour_usd: r2(c.nph),
    deposit_usd: c.dep, fees_usd: c.fees, hands_on_minutes: c.mins, waiting_minutes: c.wait,
    min_viable_capital_usd: c.mvc, family: c.fam,
  };
});
const checksum = fnv1a(rows.map((r) => `${r.slug}:${r.rank}:${r.implied_value_usd}`).join('|'));
const totalIv = rows.reduce((s, r) => s + r.implied_value_usd, 0);

// ---------- dashboard data file (compact, generated) ----------
const catNames = [...new Set([...calcs.map((c) => c.p.category), ...comps.map((p) => p.category)].filter((x): x is string => x !== null))].sort();
const catIdx = (c: string | null): number => (c === null ? -1 : catNames.indexOf(c));
const chainNames = [...new Set(calcs.flatMap((c) => c.p.chains))].sort();
const anchorIdx = new Map(comps.map((p, i) => [p.slug, i]));
const meta = {
  // Fitted constants are stored at full precision: the page recomputes every
  // value from them, and rounding them would break that recomputation.
  // The quadratic constants (qq) are stored the same way when kept; the
  // page draws and prices the adopted curve from them.
  a: finalModel.curve.a, b: finalModel.curve.b,
  ...(quadKept ? { qd: 1, qq: [finalModel.curve.a, finalModel.curve.b, finalModel.curve.c, finalModel.curve.x0] } : {}),
  flat: r3(flatMult), mmc: marketMedChg, base: baseRate,
  q: [r3(q10), r3(q25), r3(q75), r3(q90)],
  loo: { m: r2(looFinal), b: r2(looFlatM), wf: r2(wfFinal) },
  br: { loo: r3(brLoo), loob: r3(brLooBase), wf: r3(brWf) },
  cov: [r2(cov2575 * 100), r2(cov1090 * 100)],
  terms: [
    ['Size curve', r2(looBase), r2(looFlatM), r2(wfBase), r2(wfFlatM), 1],
    ['Category', r2(looCat), r2(looBase), r2(wfCat), r2(wfBase), catKept ? 1 : 0],
    ['Growth', r2(looGro), r2(looBase), r2(wfGro), r2(wfBase), growthKept ? 1 : 0],
    ['Chain count', r2(looChn), r2(looBase), r2(wfChn), r2(wfBase), chainKept ? 1 : 0],
    ['Age in value', r2(looAge), r2(looBase), r2(wfAge), r2(wfBase), ageKept ? 1 : 0],
    ['Quadratic size curve', r2(looQuad), r2(looPl), r2(wfQuad), r2(wfPl), quadKept ? 1 : 0],
  ],
  oterms: [
    ['Age-band odds', r3(brLoo), r3(brLooBase), r3(brWf), r3(brWfBase), 1],
    ['Category odds', r3(brLooCat), r3(brLoo), r3(brWfCat), r3(brWf), catOddsKept ? 1 : 0],
  ],
  led: { rk: ledger.ranked, an: ledger.anchors, tn: ledger.tradedNoMcap, un: ledger.unranked, af: ledger.aboveFloor, bc: ledger.belowCutoff, tot: ledger.total, cut: ledger.cutoff, rs: ledger.reasons },
  cats: catNames.map((n) => [n, (finalModel.catN.get(n) || 0) < 5 ? 0 : (finalModel.catMed.get(n) as number) / finalModel.overallMed, finalModel.catN.get(n) || 0]),
  // Chain/age factor tables are carried only when the corresponding term is
  // kept: the page needs them solely for those factors, which are gated on
  // the term flags. Omitting them otherwise saves dossier bytes.
  ...(chainKept ? { ch: ['1', '2-3', '4+'].map((k) => [k, (finalModel.chainN.get(k) || 0) < 5 ? 0 : (finalModel.chainMed.get(k) as number) / finalModel.overallMed, finalModel.chainN.get(k) || 0]) } : {}),
  ...(ageKept ? { ag: ['u', 'y0', 'y1', 'y2', 'y3'].map((k) => [k, (finalModel.ageN.get(k) || 0) < 5 ? 0 : (finalModel.ageMed.get(k) as number) / finalModel.overallMed, finalModel.ageN.get(k) || 0]) } : {}),
  ps: ODDS_PSEUDO,
  mc: [comps.length, traded.filter((p) => p.mcap_usd === null).length, traded.filter((p) => p.mcap_usd === 0).length, traded.filter((p) => p.mcap_usd !== null && (p.mcap_usd as number) < 0).length],
  chains: chainNames,
  bands: bandPeers.map((b) => [b.k, b.n]),
  // Anchor names are carried only for anchors a detail view actually names
  // as a near comparable; the scatter chart plots every anchor by TVL and
  // market cap and never reads the name. All 128 anchors still plot.
  anchors: (() => {
    const used = new Set(calcs.flatMap((c) => c.near.map((n) => anchorIdx.get(n.slug) as number)));
    return comps.map((p, i) => growthKept
      ? [used.has(i) ? p.name : null, Math.round(p.tvl_usd / 1000), Math.round((p.mcap_usd as number) / 1000), catIdx(p.category), p.change_7d === null ? null : Math.round(p.change_7d * 100)]
      : [used.has(i) ? p.name : null, Math.round(p.tvl_usd / 1000), Math.round((p.mcap_usd as number) / 1000), catIdx(p.category)]);
  })(),
  steps: { c: COMMON, k: CORE, t: TAIL },
  sum: checksum, asof: snap.as_of, floor,
  tot: totalIv,
};
const dataRows = calcs.map((c) => {
  const [rlo, rhi] = rankRange(c.p.slug);
  return [
    c.p.slug, c.p.name, catIdx(c.p.category),
    c.p.chains.map((ch) => chainNames.indexOf(ch)),
    c.p.tvl_usd, c.p.change_7d === null ? null : Math.round(c.p.change_7d * 100), ageDays(c.p),
    c.iv, rlo, rhi,
    c.near.map((n) => anchorIdx.get(n.slug) as number), c.fam,
    watchSet.has(c.p.slug) ? 1 : 0,
  ];
});
const dataJs = 'const D=' + JSON.stringify({ m: meta, r: dataRows }) + ';\n';

// ---------- outputs ----------
rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'dashboard'), { recursive: true });
mkdirSync(join(OUT, 'screenshots'), { recursive: true });
writeFileSync(join(OUT, 'board.json'), JSON.stringify({ rows }, null, 2) + '\n');
writeFileSync(join(OUT, 'dashboard', 'data.js'), dataJs);
cpSync(join(ROOT, 'dashboard', 'index.html'), join(OUT, 'dashboard', 'index.html'));
cpSync(join(ROOT, 'dashboard', 'app.css'), join(OUT, 'dashboard', 'app.css'));
cpSync(join(ROOT, 'dashboard', 'app.js'), join(OUT, 'dashboard', 'app.js'));
cpSync(join(ROOT, 'screenshots'), join(OUT, 'screenshots'), { recursive: true });
writeFileSync(join(OUT, 'dossier.json'), buildDossier(OUT, { text_max_bytes: 65536 }));

console.log(JSON.stringify({
  rows: rows.length, watchlist: watchProtos.length, cutoff, totalIv,
  farmCount: rows.filter((r) => r.verdict === 'FARM').length,
  thinCount: rows.filter((r) => r.verdict === 'THIN').length,
  skipCount: rows.filter((r) => r.verdict === 'SKIP').length,
  curve: { a: r3(finalModel.curve.a), b: r3(finalModel.curve.b) }, flatMult: r3(flatMult),
  quad: quadKept ? { a: r3(finalModel.curve.a), b: r3(finalModel.curve.b), c: r3(finalModel.curve.c as number), x0: r3(finalModel.curve.x0 as number), loo: r2(looQuad), wf: r2(wfQuad), kept: quadKept } : { loo: r2(looQuad), wf: r2(wfQuad), kept: quadKept },
  quadRaw: { looQuad, wfQuad, looPl, wfPl, looQuadOnly, wfQuadOnly, looBase, wfBase },
  loo: { final: r2(looFinal), base: r2(looBase), flat: r2(looFlatM) },
  wf: { final: r2(wfFinal), base: r2(wfBase), flat: r2(wfFlatM) },
  kept: { cat: catKept, growth: growthKept, chain: chainKept, age: ageKept, catOdds: catOddsKept },
  brier: { loo: r3(brLoo), looBase: r3(brLooBase), wf: r3(brWf), wfBase: r3(brWfBase), looCat: r3(brLooCat), wfCat: r3(brWfCat) },
  coverage: { p2575: r2(cov2575 * 100), p1090: r2(cov1090 * 100) },
  q: [r3(q10), r3(q25), r3(q75), r3(q90)],
  rank1: rows[0].slug + ' $' + rows[0].implied_value_usd,
  checksum, dataJsBytes: dataJs.length,
}, null, 1));
