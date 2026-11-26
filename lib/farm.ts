// Universe selection and farm economics for the token launch radar (round 5).
//
// This module owns two things and nothing else:
//   1. Which snapshot protocols get ranked (selectUniverse), with a ledger
//      that accounts for every protocol in the snapshot exactly once.
//   2. What it costs to farm one ranked protocol, what the launch is
//      expected to pay the farmer, and whether the plan clears its hurdles
//      (planFarm), with per-chain fees from the snapshot's own chains field.
//
// The value model (implied value, odds) lives in main.ts and is passed in
// here as a plain number. Nothing in this file names a protocol: every rule
// below reads only the snapshot's own fields (category, name shape, chains,
// TVL, 7-day change, token record). A protocol is included or excluded by
// what its record says, never by its slug.
//
// Money conventions: whole US dollars everywhere except per-hour pay, which
// carries two decimals. Horizon is 12 weeks. The risk-free comparison is a
// 4% annual T-bill rate over that horizon. A plan is worth farming (FARM)
// only when its net beats the T-bill return on the same deposit AND pays
// more than $25 per hands-on hour. Anything else that still nets positive
// is THIN; a plan that nets zero or negative is SKIP.

// ---------------------------------------------------------------------------
// Shared input shapes (structural: any object with these fields will do).
// ---------------------------------------------------------------------------

export interface SnapshotProtocol {
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

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

// What planFarm needs for one ranked row. implied_value_usd and odds come
// from the value model in main.ts; everything else is the snapshot record.
export interface FarmRowInput {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  implied_value_usd: number;
  odds: number;
  listed_at: string | null;
}

export interface UniverseLedger {
  ranked: number;
  anchors: number;
  traded_no_mcap: number;
  set_aside: number;
  total: number;
}

export interface UniverseResult {
  ranked: SnapshotProtocol[];
  ledger: UniverseLedger;
  excluded: Record<string, string[]>;
}

// ---------------------------------------------------------------------------
// Universe selection (D1).
//
// The board is built from the pre-token protocols (no token recorded: both
// gecko_id and symbol null) in three passes, in this order:
//
//   (a) Every watchlist slug, unconditionally. The watchlist is the house
//       rule's own list and it is the floor of the board, never the ceiling.
//   (b) Pre-token protocols at or above the floor that the watchlist leaves
//       out ONLY because DefiLlama names a parent protocol for them. The
//       snapshot does not carry the parent field, so this group is found by
//       elimination: a protocol that passes every visible watchlist rule
//       (category, name shape, exchange prefix) yet is not on the list can
//       only have failed the one rule the snapshot cannot show — the parent
//       record. The largest member of this group is a $2.76B protocol;
//       the group is ranked on its own record, exactly like a watchlist row.
//   (c) Pre-token protocols below the floor that pass the same visible
//       rules, largest TVL first, with no cutoff: every clean below-floor
//       protocol is ranked.
//
// Excluded throughout, with the reason visible in the protocol's own record:
//   - category CEX (a centralised exchange is not a token launch);
//   - category Liquid Staking, Liquid Restaking or Restaked BTC (a staked
//     product of a token that already trades);
//   - any category containing "Bridge" (Bridge, Canonical Bridge, Cross
//     Chain Bridge: a bridged asset, not a new protocol);
//   - a name carrying a whole word "wrapped", "staked" or "staking";
//   - a name ending in a version marker ("V2", "v2", "2.0" and the like);
//   - a name beginning with an exchange's name (Binance, Coinbase, Bybit,
//     Kraken, Bitget, OKX, Bitfinex, Gemini).
//
// The ledger partitions the whole snapshot, so its groups always add up to
// the snapshot size: ranked + traded anchors + traded without a usable
// market cap + pre-token set aside. "Traded" means a token is recorded
// (gecko_id or symbol non-null). An anchor is a traded protocol whose
// market cap is a usable positive number (mcap_usd > 0); a traded protocol
// with a null, zero or negative market cap cannot anchor the value curve.
// Every count is recomputed from the snapshot on each run; nothing here is
// a hardcoded total.
// ---------------------------------------------------------------------------

const EXCLUDED_CATEGORIES_LIQUID_STAKING = new Set([
  "Liquid Staking",
  "Liquid Restaking",
  "Restaked BTC",
]);

const EXCHANGE_PREFIXES = [
  "Binance",
  "Coinbase",
  "Bybit",
  "Kraken",
  "Bitget",
  "OKX",
  "Bitfinex",
  "Gemini",
];

const WRAPPED_OR_STAKED_WORD = /\b(wrapped|staked|staking)\b/i;
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

// The single exclusion reason for a protocol, or null when no visible rule
// excludes it. Reasons are checked in a fixed order so each excluded
// protocol lands in exactly one group for the ledger breakdown.
export function exclusionReason(p: SnapshotProtocol): string | null {
  const cat = p.category ?? "";
  if (cat === "CEX") return "CEX";
  if (EXCLUDED_CATEGORIES_LIQUID_STAKING.has(cat)) {
    return "Liquid Staking family";
  }
  if (cat.indexOf("Bridge") !== -1) return "Bridge family";
  if (WRAPPED_OR_STAKED_WORD.test(p.name)) return "wrapped/staked name";
  if (VERSION_SUFFIX.test(p.name)) return "versioned name";
  for (const prefix of EXCHANGE_PREFIXES) {
    if (p.name.indexOf(prefix) === 0) return "exchange-prefix name";
  }
  return null;
}

function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

function byTvlDescThenSlug(a: SnapshotProtocol, b: SnapshotProtocol): number {
  return b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
}

export function selectUniverse(snapshot: Snapshot): UniverseResult {
  const floor = snapshot.floor_usd;
  const watchlist = new Set(snapshot.watchlist);
  const bySlug = new Map<string, SnapshotProtocol>();
  for (const p of snapshot.protocols) bySlug.set(p.slug, p);

  const ranked: SnapshotProtocol[] = [];
  const seen = new Set<string>();
  const take = (p: SnapshotProtocol): void => {
    if (!seen.has(p.slug)) {
      seen.add(p.slug);
      ranked.push(p);
    }
  };

  // (a) The whole watchlist, unconditionally.
  for (const slug of snapshot.watchlist) {
    const p = bySlug.get(slug);
    if (p) take(p);
  }

  // (b) Above the floor, off the watchlist, excluded by no visible rule:
  // the only watchlist rule left is the parent record, so these are the
  // parent-recorded protocols, ranked on their own record.
  const parentRecorded: SnapshotProtocol[] = [];
  // (c) Below the floor, passing the visible rules, largest TVL first.
  const belowFloorClean: SnapshotProtocol[] = [];
  const excluded: Record<string, string[]> = {};
  const exclude = (p: SnapshotProtocol, reason: string): void => {
    if (!excluded[reason]) excluded[reason] = [];
    excluded[reason].push(p.slug);
  };

  for (const p of snapshot.protocols) {
    if (!recordsNoToken(p)) continue; // traded: ledgered below, never ranked
    if (seen.has(p.slug)) continue; // already taken as watchlist
    const reason = exclusionReason(p);
    if (reason !== null) {
      exclude(p, reason);
      continue;
    }
    if (p.tvl_usd >= floor) parentRecorded.push(p);
    else belowFloorClean.push(p);
  }
  parentRecorded.sort(byTvlDescThenSlug);
  for (const p of parentRecorded) take(p);
  belowFloorClean.sort(byTvlDescThenSlug);
  for (const p of belowFloorClean) take(p);

  // Keep the ranked pool itself in TVL order (largest first); main.ts
  // re-sorts by implied value when it assigns ranks.
  ranked.sort(byTvlDescThenSlug);
  for (const reason of Object.keys(excluded)) excluded[reason].sort();

  // Ledger: every protocol in exactly one group, counted from the data.
  let anchors = 0;
  let tradedNoMcap = 0;
  let preToken = 0;
  for (const p of snapshot.protocols) {
    if (recordsNoToken(p)) {
      preToken++;
    } else if (p.mcap_usd !== null && p.mcap_usd > 0) {
      anchors++;
    } else {
      tradedNoMcap++;
    }
  }
  const setAside = preToken - ranked.length;
  const ledger: UniverseLedger = {
    ranked: ranked.length,
    anchors,
    traded_no_mcap: tradedNoMcap,
    set_aside: setAside,
    total: ranked.length + anchors + tradedNoMcap + setAside,
  };
  return { ranked, ledger, excluded };
}

// ---------------------------------------------------------------------------
// Per-chain fees (D3).
//
// The fee table is built from the snapshot's own `chains` field: the chain
// family of each chain name decides the transaction price the farm plan
// pays. There is no flat fee: an Ethereum-mainnet step costs roughly
// twenty-five times a rollup step, and the plan totals show it.
//
// Families and planning prices (USD per transaction, November 2026 —
// planning estimates for a plain transfer/approval-class transaction on
// each family, not live quotes; the snapshot carries no gas data, so the
// table is keyed by the family the chain name belongs to):
//   - Ethereum mainnet ......... $9.50/tx, $25.00 to move funds on/off.
//     The only chain in the snapshot priced as expensive L1: a single
//     mainnet transaction regularly costs several dollars.
//   - Other L1s ................ $0.85/tx, $5.00 to move funds on/off.
//     Solana, Sui, Aptos, Near, Tron, Bitcoin, Cosmos chains and every
//     chain the table does not name: fast, cheap base layers.
//   - Rollups (L2s) ............ $0.35/tx, $5.00 to move funds on/off.
//     Arbitrum, Optimism, Base, zkSync Era, Linea, Scroll, Unichain, Ink,
//     Blast, Mode, Starknet, Taiko, Zora, Soneium, Abstract, Katana,
//     MegaETH, Plasma, Stable, Tempo, Robinhood Chain, World Chain,
//     X Layer, Op_Bnb, Boba, Metis, Mantle, Polygon zkEVM, zkLink,
//     Immutable zkEVM, Astar zkEVM, Cronos zkEVM, Fuel, Eclipse, Kroma,
//     Zircuit, Manta: execution inherits Ethereum security at rollup gas.
//   - Sidechains ............... $0.15/tx, $5.00 to move funds on/off.
//     Polygon, Binance (BSC), Avalanche, Fantom, xDai, Cronos, Celo,
//     Harmony, Kava, Moonbeam, Moonriver, Evmos, Aurora, Fuse, Velas,
//     Wanchain, IoTeX, Oasis, Theta, Klaytn, Ronin, Bittorrent: their own
//     validator sets and near-zero gas.
//
// The plan farms on the protocol's first listed chain — the chain DefiLlama
// lists first, where the bulk of the protocol's TVL sits — so the fee a
// row pays is the fee of the chain its money actually lives on. A row on
// Ethereum pays mainnet gas on every step; a row on Base pays rollup gas.
// ---------------------------------------------------------------------------

export type ChainFamily = "ethereum" | "l1" | "l2" | "sidechain";

export interface ChainFee {
  family: ChainFamily;
  txFeeUsd: number;
  bridgeUsd: number;
}

export interface FeeTable {
  // The chain the plan farms on (first chain in the row's chains list).
  primaryChain: string;
  primary: ChainFee;
  // One entry per chain the protocol lists, in the same order.
  byChain: ChainFee[];
  // Farm-plan rhythm shared by every row: 4 on-chain actions a week.
  txPerWeek: number;
  horizonWeeks: number;
}

const ROLLUP_CHAINS = new Set([
  "Arbitrum", "Optimism", "Base", "zkSync Era", "Linea", "Scroll",
  "Unichain", "Ink", "Blast", "Mode", "Starknet", "Taiko", "Zora",
  "Soneium", "Abstract", "Katana", "MegaETH", "Plasma", "Stable",
  "Tempo", "Robinhood Chain", "World Chain", "X Layer", "Op_Bnb",
  "Boba", "Metis", "Mantle", "Polygon zkEVM", "zkLink",
  "Immutable zkEVM", "Astar zkEVM", "Cronos zkEVM", "Fuel",
  "Eclipse", "Kroma", "Zircuit", "Manta",
]);

const SIDECHAIN_CHAINS = new Set([
  "Polygon", "Binance", "Avalanche", "Fantom", "xDai", "Cronos",
  "Celo", "Harmony", "Kava", "Moonbeam", "Moonriver", "Evmos",
  "Aurora", "Fuse", "Velas", "Wanchain", "IoTeX", "Oasis", "Theta",
  "Klaytn", "Ronin", "Bittorrent",
]);

export function chainFee(chain: string): ChainFee {
  if (chain === "Ethereum") {
    return { family: "ethereum", txFeeUsd: 9.5, bridgeUsd: 25 };
  }
  if (ROLLUP_CHAINS.has(chain)) {
    return { family: "l2", txFeeUsd: 0.35, bridgeUsd: 5 };
  }
  if (SIDECHAIN_CHAINS.has(chain)) {
    return { family: "sidechain", txFeeUsd: 0.15, bridgeUsd: 5 };
  }
  return { family: "l1", txFeeUsd: 0.85, bridgeUsd: 5 };
}

export function feeTableFor(chains: string[]): FeeTable {
  const list = chains && chains.length > 0 ? chains : ["Ethereum"];
  return {
    primaryChain: list[0],
    primary: chainFee(list[0]),
    byChain: list.map((c) => chainFee(c)),
    txPerWeek: 4,
    horizonWeeks: 12,
  };
}

// ---------------------------------------------------------------------------
// Farm economics (F1-F4).
//
// The expected payout is the farmer's slice of the launch airdrop:
//
//   airdrop pool  = DROP_SHARE (7%) of the row's implied value;
//   farmer crowd  = CROWD_BASE x (TVL / $10M) ^ 0.25 farmers, clamped to
//                   [10, 600]. The crowd grows SUBLINEARLY with TVL: most
//                   incremental TVL is passive vault and institutional
//                   capital, not new farmers chasing the same airdrop, so
//                   doubling TVL does not double the number of mouths to
//                   feed. A $2.8B protocol has ~600 farmers in this model;
//                   an $8M protocol has ~390. (The clamp binds at the top:
//                   the largest protocols all face the same 600-farmer
//                   crowd, which is what lets the biggest rows pay at all.)
//   stake weight  = deposit / (deposit + STAKE_HALF). A $5,000 deposit
//                   earns half a full farmer's share; $30,000 earns six
//                   sevenths; $1,000 earns a sixth. The share saturates:
//                   beyond ~$30,000 extra capital buys almost no extra
//                   points, which is why the net-by-deposit matrix flattens
//                   at the top instead of rising forever.
//   growth factor = 1 + change_7d / 100, clamped to [0.75, 1.25]. A
//                   protocol growing into its launch accrues points faster;
//                   one shrinking 20% in a week accrues slower. Rows with
//                   no reported 7-day change get a factor of exactly 1.
//
//   gross(deposit) = pool x stake weight / crowd x growth factor.
//
// Deposit rule (F1): the plan size is 0.025% of TVL, clamped to
// [$1,000, $20,000]. The minimum viable capital (MVC) is the smallest
// deposit, in $100 steps from $500 to $30,000, at which the plan clears
// BOTH hurdles (net beats the T-bill return on that deposit, and net per
// hands-on hour beats $25). When such a deposit exists at or below
// $30,000, the plan is sized to max(plan size, MVC) — the deposit where
// the plan pays. When no deposit up to $30,000 clears both hurdles, MVC
// is reported as $100,000 (unattainable inside the cap) and the plan runs
// at its plan size, which is why such a row lands THIN or SKIP.
//
// Verdict: FARM iff net > T-bill(deposit) AND net/hour > $25; THIN iff
// net > $0 but a hurdle fails; SKIP iff net <= $0. The T-bill hurdle is
// deposit x 4% x 12/52. Net is gross minus the plan's total fees; every
// fee in the steps below is a real on-chain cost from the fee table, and
// the weekly step charges the weekly rhythm (4 transactions a week for
// 12 weeks) instead of a token $0.50/week.
// ---------------------------------------------------------------------------

export const HORIZON_WEEKS = 12;
export const TBILL_RATE = 0.04;
export const HOUR_HURDLE_USD = 25;
export const DEPOSIT_CAP_USD = 30000;
export const DROP_SHARE = 0.07;
const CROWD_BASE = 410;
const CROWD_REF_TVL = 10000000;
const CROWD_EXPONENT = 0.25;
const CROWD_MIN = 10;
const CROWD_MAX = 600;
const STAKE_HALF = 5000;
const PLAN_FRACTION = 0.00025;
const PLAN_MIN_USD = 1000;
const PLAN_CAP_USD = 20000;
const MVC_UNATTAINABLE_USD = 100000;
const MVC_STEP_USD = 100;
const MVC_MIN_USD = 500;

const clampNum = (x: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, x));
const round2 = (x: number): number => Math.round(x * 100) / 100;
const wholeDollars = (n: number): string =>
  "$" + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

function growthFactor(change7d: number | null): number {
  if (change7d === null || !Number.isFinite(change7d)) return 1;
  return clampNum(1 + change7d / 100, 0.75, 1.25);
}

function farmerCrowd(tvlUsd: number): number {
  const raw = CROWD_BASE * Math.pow(Math.max(tvlUsd, 1) / CROWD_REF_TVL, CROWD_EXPONENT);
  return clampNum(raw, CROWD_MIN, CROWD_MAX);
}

// Expected airdrop value at a given deposit and drop share. Exported so
// the dashboard can price the net-by-deposit matrix (deposits
// $1,000 / $5,000 / $10,000 / $30,000 x drop shares 3.5% / 7% / 14%)
// from the same formula the verdict uses — one formula, one answer.
export function airdropGrossUsd(
  row: FarmRowInput,
  depositUsd: number,
  dropShare: number,
): number {
  if (!(row.implied_value_usd > 0) || !(row.tvl_usd > 0) || !(depositUsd > 0)) {
    return 0;
  }
  const pool = dropShare * row.implied_value_usd;
  const weight = depositUsd / (depositUsd + STAKE_HALF);
  return (pool * weight) / farmerCrowd(row.tvl_usd) * growthFactor(row.change_7d);
}

export function planSizeUsd(tvlUsd: number): number {
  return Math.round(clampNum(tvlUsd * PLAN_FRACTION, PLAN_MIN_USD, PLAN_CAP_USD));
}

function tbillUsd(depositUsd: number): number {
  return depositUsd * TBILL_RATE * (HORIZON_WEEKS / 52);
}

// ---------------------------------------------------------------------------
// Farm steps.
//
// Ten steps per row. Each step states its dollar cost and its hands-on
// time, and the totals at the foot of the plan are the sums the verdict
// is computed from — the numbers in the text and the numbers in the
// verdict are the same numbers, because both come from this one builder.
//
// Step 4 is the core action and names the real thing being done for the
// protocol's category family: a curator vault for Risk Curators and
// capital allocators, a lending market for Lending, a liquidity pool for
// Dexs and Derivatives, a collateral vault for CDP, a tokenised-asset
// holding for RWA and Payments, a native venue for Chain rows. No step
// ever says only "deposit into the protocol".
// ---------------------------------------------------------------------------

type StepSpec = [string, number, number]; // [text, feeUsd, handsOnMinutes]

function coreAction(category: string | null): string {
  switch (category) {
    case "Lending":
      return "Lend {D} of stablecoins in the {N} lending market on {C} and keep the position below the liquidation line for 12 weeks.";
    case "Dexs":
    case "Derivatives":
    case "Basis Trading":
      return "Provide {D} of stablecoin liquidity to the {N} pool on {C}, then route a small swap through that pool each week so the position counts as active.";
    case "CDP":
    case "CeDeFi":
    case "Insurance":
      return "Lock {D} of collateral in the {N} vault on {C}, mint the protocol's asset against it, and hold the minted asset for 12 weeks.";
    case "RWA":
    case "Payments":
      return "Hold {D} of the tokenised asset through {N} on {C} for 12 weeks, keeping the position in the same wallet that earns the points.";
    case "Chain":
      return "Bridge {D} to {C} and use the {N} native venue for 12 weeks, keeping the position open for the whole horizon.";
    default:
      return "Allocate {D} to a {N} curator vault on {C} and hold the vault receipt token for 12 weeks.";
  }
}

function buildSteps(
  row: FarmRowInput,
  depositUsd: number,
  fees: FeeTable,
): { steps: string[]; totalFeesUsd: number; handsOnHours: number } {
  const tx = fees.primary.txFeeUsd;
  const bridge = fees.primary.bridgeUsd;
  const chain = fees.primaryChain;
  const weeklyFee = fees.txPerWeek * fees.horizonWeeks * tx;
  const depText = wholeDollars(depositUsd);
  const fill = (t: string): string =>
    t.replaceAll("{N}", row.name).replaceAll("{D}", depText).replaceAll("{C}", chain);

  const specs: StepSpec[] = [
    [
      "Open a fresh wallet for {N}; fund it with {D} from an exchange withdrawal onto {C}.",
      bridge,
      15,
    ],
    [
      "Open {N} from its DefiLlama page, match the vault contract addresses shown there, and never sign an approval sent in a message.",
      0,
      15,
    ],
    [
      "Approve the stablecoin spend for {N} on {C} so the vault contract can pull {D}.",
      tx,
      8,
    ],
    [coreAction(row.category), 2 * tx, 15],
    [
      "Opt the position into {N} points on {C} and confirm the points balance shows the deposit before leaving the page.",
      2 * tx,
      10,
    ],
    [
      "Repeat the weekly upkeep for {N} on {C} for 12 weeks: claim accrued points, top up or rebalance the position, and record each transaction — " +
        fees.txPerWeek +
        " on-chain actions a week, every week of the horizon.",
      weeklyFee,
      720,
    ],
    [
      "Check {N} weekly: exit early if its TVL falls 30% below the level at entry or if withdrawals pause for more than a day.",
      0,
      45,
    ],
    [
      "Log every {N} transaction — date, hash, asset, amount, fee — in one sheet, for the claim and for tax.",
      0,
      30,
    ],
    [
      "Claim only on {N}'s own site, reached from its DefiLlama page; never pay a third party to claim.",
      tx,
      15,
    ],
    [
      "Unwind the {N} position on {C}, move the funds back to the exchange, and close the position. Cost includes the exit transactions and the move off {C}.",
      2 * tx + bridge,
      30,
    ],
  ];

  const steps: string[] = [];
  let totalFees = 0;
  let totalMinutes = 0;
  for (const [text, fee, minutes] of specs) {
    totalFees += fee;
    totalMinutes += minutes;
    const costText = " Cost $" + fee.toFixed(2) + ".";
    const timeText = " Time " + minutes + " min hands-on.";
    steps.push(fill(text) + costText + timeText);
  }
  const totalFeesText =
    "Plan total: $" +
    totalFees.toFixed(2) +
    " in fees over 12 weeks, " +
    totalMinutes +
    " min hands-on (" +
    (totalMinutes / 60).toFixed(1) +
    " hours).";
  // The total rides on the last step so the plan states its own sum.
  steps[steps.length - 1] = steps[steps.length - 1] + " " + totalFeesText;
  return {
    steps,
    totalFeesUsd: totalFees,
    handsOnHours: totalMinutes / 60,
  };
}

// ---------------------------------------------------------------------------
// planFarm.
// ---------------------------------------------------------------------------

export interface FarmPlan {
  verdict: "FARM" | "THIN" | "SKIP";
  net_usd: number;
  net_per_hour_usd: number;
  deposit_usd: number;
  mvc_usd: number;
  farm_steps: string[];
  // The plan's own inputs, for the dashboard's live re-pricing and for
  // cross-checking the step totals: total fees in dollars, hands-on
  // minutes over the 12 weeks, the farmer crowd the gross is split
  // across, and the growth factor applied to this row's change_7d.
  // Display values only — the verdict and net above are computed from
  // the unrounded internals, never from these rounded fields.
  fees_usd: number;
  hands_on_minutes: number;
  crowd: number;
  growth_factor: number;
}

function clearsBothHurdles(
  row: FarmRowInput,
  depositUsd: number,
  totalFeesUsd: number,
  handsOnHours: number,
): boolean {
  const net = airdropGrossUsd(row, depositUsd, DROP_SHARE) - totalFeesUsd;
  return net > tbillUsd(depositUsd) && net / handsOnHours > HOUR_HURDLE_USD;
}

function minimumViableCapital(
  row: FarmRowInput,
  totalFeesUsd: number,
  handsOnHours: number,
): number {
  for (let dep = MVC_MIN_USD; dep <= DEPOSIT_CAP_USD; dep += MVC_STEP_USD) {
    if (clearsBothHurdles(row, dep, totalFeesUsd, handsOnHours)) return dep;
  }
  return MVC_UNATTAINABLE_USD;
}

export function planFarm(row: FarmRowInput, fees: FeeTable): FarmPlan {
  const planSize = planSizeUsd(row.tvl_usd);
  // Fees and hours depend only on the chain family, not on the deposit,
  // so they are fixed before the deposit is sized.
  const probe = buildSteps(row, planSize, fees);
  const totalFeesUsd = probe.totalFeesUsd;
  const handsOnHours = probe.handsOnHours;

  const mvc = minimumViableCapital(row, totalFeesUsd, handsOnHours);
  const depositUsd = mvc <= DEPOSIT_CAP_USD
    ? Math.max(planSize, mvc)
    : planSize;

  const built = buildSteps(row, depositUsd, fees);
  const gross = airdropGrossUsd(row, depositUsd, DROP_SHARE);
  const net = Math.round(gross - built.totalFeesUsd);
  const netPerHour = round2(net / built.handsOnHours);
  const verdict: FarmPlan["verdict"] =
    net > tbillUsd(depositUsd) && netPerHour > HOUR_HURDLE_USD
      ? "FARM"
      : net > 0
        ? "THIN"
        : "SKIP";
  return {
    verdict,
    net_usd: net,
    net_per_hour_usd: netPerHour,
    deposit_usd: depositUsd,
    mvc_usd: mvc,
    farm_steps: built.steps,
    fees_usd: round2(totalFeesUsd),
    hands_on_minutes: Math.round(handsOnHours * 60),
    crowd: round2(farmerCrowd(row.tvl_usd)),
    growth_factor: Math.round(growthFactor(row.change_7d) * 10000) / 10000,
  };
}

// ---------------------------------------------------------------------------
// Step templates for the dashboard (D3, additive export).
//
// The same ten steps buildSteps writes, as templates instead of filled
// text: [text, txCoeff, bridgeCoeff, handsOnMinutes, waitMinutes]. A
// step's dollar cost is txCoeff x the chain's tx fee plus bridgeCoeff x
// its bridge fee, so the dashboard prices every step from the fee table
// instead of carrying its own copy of the economics. Placeholders are
// {N} name, {D} deposit, {C} chain — the dashboard fills them exactly
// as buildSteps does. No step waits: waitMinutes is 0 throughout.
// The weekly upkeep charges 48 transactions (4 a week x 12 weeks).
// `common` holds the eight shared steps in plan order (buildSteps
// indices 0, 1, 2, 4, 5, 6, 7, 8); `core` holds the category-family
// action (index 3) per family; `exit` holds the unwind step (index 9),
// which is the same text for every family.
// ---------------------------------------------------------------------------

export type FarmStepTemplate = [string, number, number, number, number];

export interface FarmStepTemplates {
  common: FarmStepTemplate[];
  core: Record<string, FarmStepTemplate>;
  exit: Record<string, FarmStepTemplate>;
}

// The six core-action families, in the same order coreAction switches
// on them. A row's family index on the dashboard is its position here.
export const FARM_CORE_FAMILIES: string[] = [
  "Lending",
  "DEX",
  "Collateral",
  "Tokenised",
  "Chain",
  "Curator",
];

export function coreFamilyOf(category: string | null): string {
  switch (category) {
    case "Lending":
      return "Lending";
    case "Dexs":
    case "Derivatives":
    case "Basis Trading":
      return "DEX";
    case "CDP":
    case "CeDeFi":
    case "Insurance":
      return "Collateral";
    case "RWA":
    case "Payments":
      return "Tokenised";
    case "Chain":
      return "Chain";
    default:
      return "Curator";
  }
}

export function farmStepTemplates(): FarmStepTemplates {
  const common: FarmStepTemplate[] = [
    [
      "Open a fresh wallet for {N}; fund it with {D} from an exchange withdrawal onto {C}.",
      0,
      1,
      15,
      0,
    ],
    [
      "Open {N} from its DefiLlama page, match the vault contract addresses shown there, and never sign an approval sent in a message.",
      0,
      0,
      15,
      0,
    ],
    [
      "Approve the stablecoin spend for {N} on {C} so the vault contract can pull {D}.",
      1,
      0,
      8,
      0,
    ],
    [
      "Opt the position into {N} points on {C} and confirm the points balance shows the deposit before leaving the page.",
      2,
      0,
      10,
      0,
    ],
    [
      "Repeat the weekly upkeep for {N} on {C} for 12 weeks: claim accrued points, top up or rebalance the position, and record each transaction — 4 on-chain actions a week, every week of the horizon.",
      48,
      0,
      720,
      0,
    ],
    [
      "Check {N} weekly: exit early if its TVL falls 30% below the level at entry or if withdrawals pause for more than a day.",
      0,
      0,
      45,
      0,
    ],
    [
      "Log every {N} transaction — date, hash, asset, amount, fee — in one sheet, for the claim and for tax.",
      0,
      0,
      30,
      0,
    ],
    [
      "Claim only on {N}'s own site, reached from its DefiLlama page; never pay a third party to claim.",
      1,
      0,
      15,
      0,
    ],
  ];
  const core: Record<string, FarmStepTemplate> = {
    Lending: [
      "Lend {D} of stablecoins in the {N} lending market on {C} and keep the position below the liquidation line for 12 weeks.",
      2,
      0,
      15,
      0,
    ],
    DEX: [
      "Provide {D} of stablecoin liquidity to the {N} pool on {C}, then route a small swap through that pool each week so the position counts as active.",
      2,
      0,
      15,
      0,
    ],
    Collateral: [
      "Lock {D} of collateral in the {N} vault on {C}, mint the protocol's asset against it, and hold the minted asset for 12 weeks.",
      2,
      0,
      15,
      0,
    ],
    Tokenised: [
      "Hold {D} of the tokenised asset through {N} on {C} for 12 weeks, keeping the position in the same wallet that earns the points.",
      2,
      0,
      15,
      0,
    ],
    Chain: [
      "Bridge {D} to {C} and use the {N} native venue for 12 weeks, keeping the position open for the whole horizon.",
      2,
      0,
      15,
      0,
    ],
    Curator: [
      "Allocate {D} to a {N} curator vault on {C} and hold the vault receipt token for 12 weeks.",
      2,
      0,
      15,
      0,
    ],
  };
  const exitStep: FarmStepTemplate = [
    "Unwind the {N} position on {C}, move the funds back to the exchange, and close the position. Cost includes the exit transactions and the move off {C}.",
    2,
    1,
    30,
    0,
  ];
  const exit: Record<string, FarmStepTemplate> = {};
  for (const fam of FARM_CORE_FAMILIES) exit[fam] = exitStep;
  return { common, core, exit };
}
