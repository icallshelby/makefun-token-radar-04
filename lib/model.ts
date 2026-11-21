// The token radar model "radar-5": rubric-first radar with peer-estimated odds.
// Follows DESIGN-V4.md exactly.

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

export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_weight: number;
  max_breadth_chains: number;
  // v4 Assumptions
  p_qualify: number;
  farmer_allocation_fdv: number;
  annual_opportunity_cost: number;
  p_shrinkage_m: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 150,
  maturity_floor: 0.55,
  maturity_range: 0.45,
  maturity_days: 1460,
  unknown_age_days: 365,
  breadth_weight: 0.02,
  max_breadth_chains: 10,
  p_qualify: 0.5,
  farmer_allocation_fdv: 0.05,
  annual_opportunity_cost: 0.05,
  p_shrinkage_m: 20,
};

export const MODEL_VERSION = 'radar-5';

export interface OOSMetric {
  median_f: number;
  mean_log_err: number;
  p90_log_err: number;
  r2: number;
  n: number;
}

export interface OOSResult {
  time_split: Record<string, OOSMetric>;
  random_split: Record<string, OOSMetric>;
  walk_forward_1: Record<string, OOSMetric>;
  walk_forward_2: Record<string, OOSMetric>;
  loo_median_f: number;
}

export interface PTokenBucket {
  age_band: string;
  tvl_band: string;
  n: number;
  n_token: number;
  p_raw: number;
  p_shrunk: number;
}

export interface CategoryData {
  category: string;
  n: number;
  shift: number;
  comps: { name: string; ratio: number }[];
}

export interface CurveCoefficients {
  a: number;
  b: number;
  b_ci: [number, number];
}

export interface CalibrationData {
  curve: CurveCoefficients;
  categories: CategoryData[];
  global_median: number;
  oos: OOSResult;
  p_token_table: PTokenBucket[];
  p_global: number;
  priors_ablation: string;
}

export interface FarmLedgerStep {
  text: string;
  cost_usd: number;
  time: string;
}

export interface FarmLedger {
  steps: FarmLedgerStep[];
  total_cost_usd: number;
  opportunity_cost_usd: number;
  expected_value_usd: number;
  net_if_launches: number;
  net_if_never: number;
  net_expected_usd: number;
  break_even_p: number;
  verdict: 'FARM' | 'WATCH' | 'SKIP';
  reason: string;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  implied_value_usd: number;
  p_token: number;
  candidate: boolean;
  bootstrap_band: [number, number];
  rank_range: [number, number];
  net_farm_usd: number;
  verdict: 'FARM' | 'WATCH' | 'SKIP';
  model: {
    curve_base: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    p_token: number;
  };
  farm_ledger: FarmLedger;
}

export interface NonCandidateRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  curve_base: number;
  reason: string;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  calibration: CalibrationData;
  rows: BoardRow[];
  non_candidates: NonCandidateRow[];
  live: any[];
  oos: OOSResult;
  accounting: {
    total: number;
    pre_token: number;
    candidates: number;
    non_candidates: number;
    token_recorded: number;
    live_shown: number;
    watchlist_covered: number;
  };
}

const DAY_MS = 86_400_000;

function mulberry32(a: number) {
  return function() {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

function computeMedian(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function fitOLS(xs: number[], ys: number[]): { a: number; b: number; r2: number } {
  const n = xs.length;
  if (n < 2) return { a: 0, b: 0, r2: 0 };
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0, sumYY = 0;
  for (let i = 0; i < n; i++) {
    sumX += xs[i]!;
    sumY += ys[i]!;
    sumXY += xs[i]! * ys[i]!;
    sumXX += xs[i]! * xs[i]!;
    sumYY += ys[i]! * ys[i]!;
  }
  const b = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const a = (sumY - b * sumX) / n;
  
  const yMean = sumY / n;
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < n; i++) {
    const yPred = a + b * xs[i]!;
    ssRes += (ys[i]! - yPred) ** 2;
    ssTot += (ys[i]! - yMean) ** 2;
  }
  const r2 = ssTot === 0 ? 1 : 1 - (ssRes / ssTot);
  return { a, b, r2 };
}

function getMetric(actuals: number[], preds: number[]): OOSMetric {
  const n = actuals.length;
  if (n === 0) return { median_f: 0, mean_log_err: 0, p90_log_err: 0, r2: 0, n: 0 };
  const logErrors = actuals.map((a, i) => Math.abs(Math.log10(preds[i]! / a)));
  const medianLogErr = computeMedian(logErrors);
  const meanLogErr = logErrors.reduce((a, b) => a + b, 0) / n;
  const p90LogErr = [...logErrors].sort((a, b) => a - b)[Math.floor(n * 0.9)] ?? 0;
  
  const logActuals = actuals.map(a => Math.log10(a));
  const logPreds = preds.map(p => Math.log10(p));
  const { r2 } = fitOLS(logPreds, logActuals);

  return {
    median_f: Math.pow(10, medianLogErr),
    mean_log_err: meanLogErr,
    p90_log_err: p90LogErr,
    r2,
    n
  };
}

function getMultipliers(p: SnapshotProtocol, asOf: string, model: ModelConstants) {
  const age = ageDays(asOf, p.listed_at);
  const rawGrowth = finite(p.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = growthPct >= 0 ? 1 + (growthPct / 100) * model.growth_weight : 1 + (growthPct / 100) * 0.9;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + model.maturity_range * (Math.log(1 + Math.min(ageForModel, model.maturity_days)) / Math.log(1 + model.maturity_days));
  const breadthMult = 1 + model.breadth_weight * Math.min(Math.max(p.chains.length - 1, 0), model.max_breadth_chains);
  return { growthMult, maturityMult, breadthMult, age };
}

function getPTokenBuckets(protocols: SnapshotProtocol[], asOf: string, model: ModelConstants) {
  const getAgeBand = (age: number | null) => {
    if (age === null) return 'unknown';
    if (age < 365) return '<1y';
    if (age < 730) return '1-2y';
    if (age < 1095) return '2-3y';
    return '>=3y';
  };
  const getTVLBand = (tvl: number) => {
    if (tvl < 5e7) return '$5-50M';
    if (tvl < 2e8) return '$50-200M';
    return '>=$200M';
  };

  const buckets = new Map<string, { n: number, n_token: number }>();
  const ageBands = ['<1y', '1-2y', '2-3y', '>=3y', 'unknown'];
  const tvlBands = ['$5-50M', '$50-200M', '>=$200M'];

  for (const ab of ageBands) {
    for (const tb of tvlBands) {
      buckets.set(`${ab}|${tb}`, { n: 0, n_token: 0 });
    }
  }

  let totalN = 0, totalToken = 0;
  for (const p of protocols) {
    const age = ageDays(asOf, p.listed_at);
    const ab = getAgeBand(age);
    const tb = getTVLBand(p.tvl_usd);
    const key = `${ab}|${tb}`;
    const b = buckets.get(key);
    if (b) {
      b.n++;
      if (!isPreToken(p)) b.n_token++;
      totalN++;
      if (!isPreToken(p)) totalToken++;
    }
  }

  const pGlobal = totalN > 0 ? totalToken / totalN : 0.4;
  const table: PTokenBucket[] = [];
  for (const [key, b] of buckets.entries()) {
    const [age_band, tvl_band] = key.split('|');
    const p_raw = b.n > 0 ? b.n_token / b.n : pGlobal;
    const p_shrunk = (b.n * p_raw + model.p_shrinkage_m * pGlobal) / (b.n + model.p_shrinkage_m);
    table.push({
      age_band: age_band!,
      tvl_band: tvl_band!,
      n: b.n,
      n_token: b.n_token,
      p_raw: round4(p_raw),
      p_shrunk: Math.max(0.05, Math.min(0.95, round4(p_shrunk)))
    });
  }

  return { table, pGlobal, getAgeBand, getTVLBand };
}

export function computeCalibration(snapshot: Snapshot, model: ModelConstants): CalibrationData {
  const comps = snapshot.protocols.filter(p => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const pTokenInfo = getPTokenBuckets(snapshot.protocols, snapshot.as_of, model);

  const predict = (p: SnapshotProtocol, a: number, b: number, shifts: Map<string, number>, withPriors: boolean) => {
    const shift = shifts.get(p.category ?? 'General') ?? 0;
    let base = Math.pow(10, a + b * Math.log10(p.tvl_usd) + shift);
    base = Math.max(p.tvl_usd * 0.03, Math.min(p.tvl_usd * 0.80, base));
    if (!withPriors) return Math.max(1, base);
    
    const priors = getMultipliers(p, snapshot.as_of, model);
    const ab = pTokenInfo.getAgeBand(priors.age);
    const tb = pTokenInfo.getTVLBand(p.tvl_usd);
    const pt = pTokenInfo.table.find(t => t.age_band === ab && t.tvl_band === tb)?.p_shrunk ?? pTokenInfo.pGlobal;
    
    let val = base * priors.growthMult * priors.maturityMult * priors.breadthMult * pt;
    return Math.max(1, val);
  };

  const runOOS = (train: SnapshotProtocol[], test: SnapshotProtocol[]) => {
    const testComps = test.filter(p => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
    const actuals = testComps.map(p => p.mcap_usd!);
    
    const trainComps = train.filter(p => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
    const globalMedian = computeMedian(trainComps.map(p => p.mcap_usd! / p.tvl_usd));
    const predsGlobal = testComps.map(p => p.tvl_usd * globalMedian);

    const catMedians = new Map<string, number>();
    const byCat = new Map<string, number[]>();
    for (const p of trainComps) {
      const cat = p.category ?? 'General';
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat)!.push(p.mcap_usd! / p.tvl_usd);
    }
    for (const [cat, rs] of byCat.entries()) {
      if (rs.length >= 5) catMedians.set(cat, computeMedian(rs));
    }
    const predsR3 = testComps.map(p => (catMedians.get(p.category ?? 'General') ?? globalMedian) * p.tvl_usd);

    const xs = trainComps.map(p => Math.log10(p.tvl_usd));
    const ys = trainComps.map(p => Math.log10(p.mcap_usd!));
    const fit = fitOLS(xs, ys);
    const resids = trainComps.map(p => Math.log10(p.mcap_usd!) - (fit.a + fit.b * Math.log10(p.tvl_usd)));
    const trainShifts = new Map<string, number>();
    const byCatRes = new Map<string, number[]>();
    for (let i = 0; i < trainComps.length; i++) {
      const cat = trainComps[i]!.category ?? 'General';
      if (!byCatRes.has(cat)) byCatRes.set(cat, []);
      byCatRes.get(cat)!.push(resids[i]!);
    }
    for (const [cat, res] of byCatRes.entries()) {
      if (res.length >= 5) trainShifts.set(cat, Math.max(-0.30, Math.min(0.30, computeMedian(res))));
    }

    return {
      global: getMetric(actuals, predsGlobal),
      radar3: getMetric(actuals, predsR3),
      radar5_no_priors: getMetric(actuals, testComps.map(p => predict(p, fit.a, fit.b, trainShifts, false))),
      radar5_with_priors: getMetric(actuals, testComps.map(p => predict(p, fit.a, fit.b, trainShifts, true)))
    };
  };

  // 1. Time split
  const sorted = [...comps].sort((a, b) => (a.listed_at ? Date.parse(a.listed_at) : 0) - (b.listed_at ? Date.parse(b.listed_at) : 0));
  const mid = Math.floor(sorted.length / 2);
  const oosTime = runOOS(sorted.slice(0, mid), sorted.slice(mid));

  // 2. Random split
  const rng = mulberry32(hashString(snapshot.as_of));
  const shuffled = [...comps];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  const splitIdx = Math.floor(shuffled.length * 0.8);
  const oosRand = runOOS(shuffled.slice(0, splitIdx), shuffled.slice(splitIdx));

  // 3. Walk-forward
  const q1 = Math.floor(sorted.length / 3);
  const q2 = Math.floor(2 * sorted.length / 3);
  const oosWF1 = runOOS(sorted.slice(0, q1), sorted.slice(q1, q2));
  const oosWF2 = runOOS(sorted.slice(0, q2), sorted.slice(q2));

  // 4. LOO on 40
  const looComps = shuffled.slice(0, 40);
  const looErrors: number[] = [];
  for (let i = 0; i < looComps.length; i++) {
    const trainLOO = looComps.filter((_, j) => i !== j);
    const testLOO = [looComps[i]!];
    const res = runOOS(trainLOO, testLOO);
    looErrors.push(res.radar5_with_priors.mean_log_err);
  }

  const oos: OOSResult = {
    time_split: oosTime,
    random_split: oosRand,
    walk_forward_1: oosWF1,
    walk_forward_2: oosWF2,
    loo_median_f: Math.pow(10, computeMedian(looErrors))
  };

  const ablation = `radar-5 vs radar-3 (time split): ${round2(oosTime.radar5_with_priors.median_f)}x vs ${round2(oosTime.radar3.median_f)}x. priors kept per rubric.`;

  // Final Fit
  const xs = comps.map(p => Math.log10(p.tvl_usd));
  const ys = comps.map(p => Math.log10(p.mcap_usd!));
  const { a, b } = fitOLS(xs, ys);
  
  const b_samples: number[] = [];
  const fitRng = mulberry32(hashString(snapshot.as_of + "_fit"));
  for (let i = 0; i < 200; i++) {
    const bxs: number[] = [], bys: number[] = [];
    for (let j = 0; j < comps.length; j++) {
      const idx = Math.floor(fitRng() * comps.length);
      bxs.push(xs[idx]!);
      bys.push(ys[idx]!);
    }
    b_samples.push(fitOLS(bxs, bys).b);
  }
  b_samples.sort((a, b) => a - b);

  const resids = comps.map(p => Math.log10(p.mcap_usd!) - (a + b * Math.log10(p.tvl_usd)));
  const catResids = new Map<string, { resids: number[], comps: {name: string, ratio: number}[] }>();
  for (let i = 0; i < comps.length; i++) {
    const cat = comps[i]!.category ?? 'General';
    if (!catResids.has(cat)) catResids.set(cat, { resids: [], comps: [] });
    catResids.get(cat)!.resids.push(resids[i]!);
    catResids.get(cat)!.comps.push({ name: comps[i]!.name, ratio: round4(comps[i]!.mcap_usd! / comps[i]!.tvl_usd) });
  }

  const categories: CategoryData[] = [];
  for (const [cat, data] of catResids.entries()) {
    const shift = data.resids.length >= 5 ? Math.max(-0.30, Math.min(0.30, computeMedian(data.resids))) : 0;
    data.comps.sort((a, b) => b.ratio - a.ratio);
    categories.push({ category: cat, n: data.resids.length, shift, comps: data.comps });
  }

  return {
    curve: { a, b, b_ci: [b_samples[20]!, b_samples[180]!] },
    categories,
    global_median: computeMedian(comps.map(p => p.mcap_usd! / p.tvl_usd)),
    oos,
    p_token_table: pTokenInfo.table,
    p_global: pTokenInfo.pGlobal,
    priors_ablation: ablation
  };
}

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const EXCLUDED_CATEGORIES = new Set(['bridge', 'canonical bridge', 'liquid staking', 'liquid restaking', 'restaked btc', 'cex']);
const EXCHANGES = ['binance', 'coinbase', 'bybit', 'kraken', 'bitget', 'okx', 'bitfinex', 'gemini'];
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_STAKED = /\b(wrapped|staked|staking)\b/i;

export function isEligible(p: SnapshotProtocol): boolean {
  const cat = (p.category ?? '').toLowerCase();
  if (EXCLUDED_CATEGORIES.has(cat)) return false;
  const name = p.name;
  const lowerName = name.toLowerCase();
  if (WRAPPED_STAKED.test(name)) return false;
  for (const ex of EXCHANGES) {
    if (lowerName === ex || lowerName.startsWith(ex + ' ') || lowerName.startsWith(ex + '-')) return false;
  }
  if (VERSIONED.test(name)) return false;
  return true;
}

export function getGasTable(chain: string): number {
  const c = chain.toLowerCase();
  if (c.includes('ethereum')) return 2.0;
  if (c.includes('solana')) return 0.05;
  if (c.includes('bsc') || c.includes('binance')) return 0.15;
  if (c.includes('polygon')) return 0.05;
  if (c.includes('arbitrum')) return 0.1;
  if (c.includes('optimism')) return 0.1;
  if (c.includes('base')) return 0.05;
  if (c.includes('avalanche')) return 0.15;
  return 0.1;
}

function getNonCandidateReason(p: SnapshotProtocol): string {
  const cat = (p.category ?? '').toLowerCase();
  if (EXCLUDED_CATEGORIES.has(cat)) return `Category: ${p.category}`;
  const name = p.name;
  const lowerName = name.toLowerCase();
  if (WRAPPED_STAKED.test(name)) return `Wrapped/Staked pattern`;
  for (const ex of EXCHANGES) {
    if (lowerName === ex || lowerName.startsWith(ex + ' ') || lowerName.startsWith(ex + '-')) return `Exchange name: ${ex}`;
  }
  if (VERSIONED.test(name)) return `Versioned suffix`;
  return `Not a launch candidate`;
}

export function buildFarmLedger(p: SnapshotProtocol, age: number | null, implied: number, p_token: number, model: ModelConstants): FarmLedger {
  const chain = p.chains[0] || 'Mainnet';
  const gas = getGasTable(chain);
  const capital = p.tvl_usd >= 2e8 ? 500 : p.tvl_usd >= 5e7 ? 250 : 100;
  const hold = age === null ? 30 : age < 180 ? 60 : age < 365 ? 45 : 30;
  
  const steps: FarmLedgerStep[] = [
    { text: `Deposit $${capital} into ${p.name} on ${chain} to bootstrap activity.`, cost_usd: gas, time: '10m' },
    { text: `Maintain active interaction across ${p.chains.length} chains weekly.`, cost_usd: gas * 4, time: '5m' },
    { text: `Hold the principal balance undisturbed for at least ${hold} days.`, cost_usd: 0, time: `${hold}d` },
    { text: `Monitor protocol governance and update security parameters monthly.`, cost_usd: 0, time: '15m' },
    { text: `Verify eligibility on official claim portals once snapshot is live.`, cost_usd: 0, time: '5m' },
    { text: `Review smart contract audit status for the ${p.category} implementation.`, cost_usd: 0, time: '20m' },
    { text: `Log all transaction hashes and timestamps for compliance record.`, cost_usd: 0, time: '5m' }
  ];

  const cost_gas = steps.reduce((a, b) => a + b.cost_usd, 0);
  const cost_opp = capital * model.annual_opportunity_cost * (hold / 365);
  const total_cost = cost_gas + cost_opp;

  // K1: per-farmer dilution
  // Assumption: average $1,000 deposit per farmer; farmer count saturates at 50,000
  const n_farmers = Math.min(50000, Math.max(100, Math.round(p.tvl_usd / 1000)));
  const val_if_launched = p_token > 0 ? implied / p_token : implied;
  const ev_per_farmer = (val_if_launched * model.farmer_allocation_fdv * model.p_qualify * p_token) / n_farmers;
  const net_expected = ev_per_farmer - total_cost;
  const net_if_never = -total_cost;
  const net_if_launches = (val_if_launched * model.farmer_allocation_fdv * model.p_qualify) / n_farmers - total_cost;

  const total_cost_usd = round2(total_cost);
  const opportunity_cost_usd = round2(cost_opp);
  const expected_value_usd = round2(ev_per_farmer);
  const net_if_launches_usd = round2(net_if_launches);
  const net_if_never_usd = round2(net_if_never);
  const net_expected_usd = round2(net_expected);

  const break_even_p = (total_cost * n_farmers) / (val_if_launched * model.farmer_allocation_fdv * model.p_qualify);

  let verdict: 'FARM' | 'WATCH' | 'SKIP' = 'SKIP';
  if (net_expected_usd >= 10 && p_token >= 0.30) verdict = 'FARM';
  else if (net_expected_usd >= 0) verdict = 'WATCH';

  return {
    steps,
    total_cost_usd,
    opportunity_cost_usd,
    expected_value_usd,
    net_if_launches: net_if_launches_usd,
    net_if_never: net_if_never_usd,
    net_expected_usd,
    break_even_p: round4(break_even_p),
    verdict,
    reason: `Net expected $${net_expected_usd} per farmer (N=${n_farmers}) with P(token) ${round2(p_token)}.`
  };
}

export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const cal = computeCalibration(snapshot, model);
  const rng = mulberry32(hashString(snapshot.as_of + "_radar"));
  
  const getRowData = (p: SnapshotProtocol) => {
    const shift = cal.categories.find(c => c.category === (p.category ?? 'General'))?.shift ?? 0;
    let curve_base = Math.pow(10, cal.curve.a + cal.curve.b * Math.log10(p.tvl_usd) + shift);
    curve_base = Math.max(p.tvl_usd * 0.03, Math.min(p.tvl_usd * 0.80, curve_base));
    
    const priors = getMultipliers(p, snapshot.as_of, model);
    const ab = getPTokenBuckets(snapshot.protocols, snapshot.as_of, model).getAgeBand(priors.age);
    const tb = getPTokenBuckets(snapshot.protocols, snapshot.as_of, model).getTVLBand(p.tvl_usd);
    const pt = cal.p_token_table.find(t => t.age_band === ab && t.tvl_band === tb)?.p_shrunk ?? cal.p_global;
    
    const implied = curve_base * priors.growthMult * priors.maturityMult * priors.breadthMult * pt;
    return { implied: Math.round(implied), pt, curve_base, priors };
  };

  const comps = snapshot.protocols.filter(p => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const allPreTokens = snapshot.protocols.filter(p => isPreToken(p));
  const candidatePreTokens = allPreTokens.filter(p => isEligible(p));
  const nonCandidatePreTokens = allPreTokens.filter(p => !isEligible(p));

  const bootVal: number[][] = candidatePreTokens.map(() => []);
  const bootRank: number[][] = candidatePreTokens.map(() => []);

  for (let i = 0; i < 200; i++) {
    const sample: SnapshotProtocol[] = [];
    for (let j = 0; j < comps.length; j++) sample.push(comps[Math.floor(rng() * comps.length)]!);
    const { a, b } = fitOLS(sample.map(p => Math.log10(p.tvl_usd)), sample.map(p => Math.log10(p.mcap_usd!)));
    
    const resids = sample.map(p => Math.log10(p.mcap_usd!) - (a + b * Math.log10(p.tvl_usd)));
    const sShifts = new Map<string, number>();
    const byCat = new Map<string, number[]>();
    for (let j = 0; j < sample.length; j++) {
      const cat = sample[j]!.category ?? 'General';
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat)!.push(resids[j]!);
    }
    for (const [cat, res] of byCat.entries()) if (res.length >= 5) sShifts.set(cat, Math.max(-0.30, Math.min(0.30, computeMedian(res))));

    const currentRefitValues = candidatePreTokens.map((p, idx) => {
      const shift = sShifts.get(p.category ?? 'General') ?? 0;
      let base = Math.pow(10, a + b * Math.log10(p.tvl_usd) + shift);
      base = Math.max(p.tvl_usd * 0.03, Math.min(p.tvl_usd * 0.80, base));
      const priors = getMultipliers(p, snapshot.as_of, model);
      const ab = getPTokenBuckets(snapshot.protocols, snapshot.as_of, model).getAgeBand(priors.age);
      const tb = getPTokenBuckets(snapshot.protocols, snapshot.as_of, model).getTVLBand(p.tvl_usd);
      const pt = cal.p_token_table.find(t => t.age_band === ab && t.tvl_band === tb)?.p_shrunk ?? cal.p_global;
      const val = Math.round(base * priors.growthMult * priors.maturityMult * priors.breadthMult * pt);
      bootVal[idx]!.push(val);
      return { val, idx };
    });

    currentRefitValues.sort((a, b) => b.val - a.val);
    currentRefitValues.forEach((item, rankIdx) => {
      bootRank[item.idx]!.push(rankIdx + 1);
    });
  }

  const board: BoardRow[] = candidatePreTokens.map((p, idx) => {
    const { implied, pt, curve_base, priors } = getRowData(p);
    const bVals = bootVal[idx]!.sort((a, b) => a - b);
    const bRanks = bootRank[idx]!.sort((a, b) => a - b);
    const ledger = buildFarmLedger(p, priors.age, implied, pt, model);
    
    return {
      rank: 0,
      slug: p.slug, name: p.name, category: p.category, chains: p.chains,
      tvl_usd: p.tvl_usd, change_7d: p.change_7d, age_days: priors.age,
      implied_value_usd: implied, p_token: pt, candidate: true,
      bootstrap_band: [bVals[20]!, bVals[180]!],
      rank_range: [bRanks[20]!, bRanks[180]!],
      net_farm_usd: ledger.net_expected_usd,
      verdict: ledger.verdict,
      model: {
        curve_base: Math.round(curve_base),
        growth_multiplier: round6(priors.growthMult),
        maturity_multiplier: round6(priors.maturityMult),
        breadth_multiplier: round6(priors.breadthMult),
        p_token: pt
      },
      farm_ledger: ledger
    };
  });

  board.sort((a, b) => b.implied_value_usd - a.implied_value_usd || a.slug.localeCompare(b.slug));
  board.forEach((r, i) => r.rank = i + 1);

  const nonCandidates: NonCandidateRow[] = nonCandidatePreTokens.map(p => {
    const shift = cal.categories.find(c => c.category === (p.category ?? 'General'))?.shift ?? 0;
    let curve_base = Math.pow(10, cal.curve.a + cal.curve.b * Math.log10(p.tvl_usd) + shift);
    curve_base = Math.max(p.tvl_usd * 0.03, Math.min(p.tvl_usd * 0.80, curve_base));
    return {
      slug: p.slug,
      name: p.name,
      category: p.category,
      tvl_usd: p.tvl_usd,
      curve_base: Math.round(curve_base),
      reason: getNonCandidateReason(p)
    };
  });
  nonCandidates.sort((a, b) => b.tvl_usd - a.tvl_usd);

  const watchlist = new Set(snapshot.watchlist);
  const radar: RadarData = {
    as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd,
    model, model_version: MODEL_VERSION, calibration: cal, rows: board,
    non_candidates: nonCandidates,
    live: snapshot.protocols.filter(p => !isPreToken(p)).sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0)).slice(0, 24),
    oos: cal.oos,
    accounting: {
      total: snapshot.protocols.length,
      pre_token: allPreTokens.length,
      candidates: board.length,
      non_candidates: nonCandidates.length,
      token_recorded: snapshot.protocols.length - allPreTokens.length,
      live_shown: 24,
      watchlist_covered: board.filter(r => watchlist.has(r.slug)).length
    }
  };

  return { board, radar };
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length !== 198) return `expected 198 board rows, got ${board.length}`;
  const watchlist = new Set(snapshot.watchlist);
  const covered = board.filter(r => watchlist.has(r.slug)).length;
  if (covered !== 40) return `expected 40/40 watchlist, got ${covered}`;
  
  const verdicts = new Set(board.map(r => r.verdict));
  if (!verdicts.has('SKIP') || !verdicts.has('WATCH')) return `verdict distribution degenerate: missing SKIP or WATCH`;
  const farmCount = board.filter(r => r.verdict === 'FARM').length;
  if (farmCount >= board.length * 0.95) return `verdict distribution degenerate: too many FARM (${farmCount})`;

  for (let i = 0; i < board.length; i++) {
    const r = board[i]!;
    if (r.rank !== i + 1) return `rank mismatch at ${i}`;
    if (i > 0 && r.implied_value_usd > board[i-1]!.implied_value_usd) return `implied value non-increasing at ${r.rank}`;
    
    const m = r.model;
    const calc = m.curve_base * m.growth_multiplier * m.maturity_multiplier * m.breadth_multiplier * m.p_token;
    if (Math.abs(calc - r.implied_value_usd) / r.implied_value_usd > 0.01) return `factor chain mismatch at ${r.rank}: ${calc} vs ${r.implied_value_usd}`;
  }
  return null;
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

export function parseSnapshot(text: string): Snapshot {
  const o = JSON.parse(text);
  return {
    as_of: o.as_of, source: o.source, floor_usd: o.floor_usd,
    protocols: o.protocols.map((p: any) => ({
      slug: p.slug, name: p.name, category: p.category ?? null,
      chains: p.chains ?? [], tvl_usd: p.tvl_usd,
      change_7d: p.change_7d ?? null, mcap_usd: p.mcap_usd ?? null,
      listed_at: p.listed_at ?? null, gecko_id: p.gecko_id ?? null,
      symbol: p.symbol ?? null
    })),
    watchlist: o.watchlist
  };
}
