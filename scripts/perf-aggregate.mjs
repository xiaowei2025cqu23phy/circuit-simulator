/**
 * Aggregate raw stage-3 performance rows produced by scripts/perf-probe.mjs.
 *
 * Input : a directory of CSV files (one per process batch), each row a single
 *         measured repetition with phase timings and work counters.
 * Output: research/round9-stage3-performance.csv (group statistics)
 *         research/round9-stage3-performance-summary.json (paired ratios/CI)
 *
 * Statistics: pooled median/Q1/Q3, per-process medians, bootstrap 95% CI of
 * the median (seeded, reproducible), and a rank-one/LU ratio with CI.
 * No winner is declared when the intervals overlap.
 *
 * node scripts/perf-aggregate.mjs --dir=research/perf-raw \
 *   --out=research/round9-stage3-performance.csv
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2)
  .filter(x => x.startsWith('--')).map(x => x.slice(2).split('=')));
const dir = args.dir ?? 'research/perf-raw';
const outCsv = args.out ?? 'research/round9-stage3-performance.csv';
const outJson = args.summary ?? 'research/round9-stage3-performance-summary.json';
const bootstrapRounds = Number(args.bootstrap ?? 2000);

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const header = lines[0].split(',');
  // Ignore non-result CSVs that may live in the same directory (e.g. the
  // order manifest); only files exposing a transient timing column are data.
  if (!header.includes('transient_ms')) return [];
  return lines.slice(1).map(line => {
    const cells = line.split(',');
    const row = {};
    header.forEach((k, i) => { row[k] = cells[i]; });
    return row;
  });
}

const rows = [];
for (const name of readdirSync(dir).filter(f => f.endsWith('.csv'))) {
  if (name.startsWith('order-manifest')) continue;
  const fileRows = parseCsv(readFileSync(join(dir, name), 'utf8'));
  for (const row of fileRows) rows.push({ ...row, source_file: name });
}
if (!rows.length) throw new Error('no raw rows found in ' + dir);

const num = v => Number(v);
const median = xs => {
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const quantile = (xs, p) => {
  const s = xs.slice().sort((a, b) => a - b);
  const pos = (s.length - 1) * p;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (pos - lo);
};
// Deterministic PRNG so the CI is reproducible across runs.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function bootstrapMedianCI(xs, rounds = bootstrapRounds) {
  const rand = mulberry32(0x5EED + xs.length);
  const medians = [];
  for (let r = 0; r < rounds; r++) {
    const sample = new Array(xs.length);
    for (let i = 0; i < xs.length; i++) sample[i] = xs[Math.floor(rand() * xs.length)];
    medians.push(median(sample));
  }
  medians.sort((a, b) => a - b);
  return [quantile(medians, 0.025), quantile(medians, 0.975)];
}

const groups = new Map();
for (const row of rows) {
  const key = row.case + '|' + row.solver;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(row);
}

const fields = [
  'case', 'solver', 'workload_class', 'mna_dimension', 'diode_count',
  'samples', 'processes', 'repetitions_per_process', 'batches',
  'median_transient_ms', 'q1_transient_ms', 'q3_transient_ms',
  'median_ci_low_ms', 'median_ci_high_ms', 'min_transient_ms', 'max_transient_ms',
  'per_process_medians_ms', 'median_compile_ms',
  'median_matrix_rebuild_ms', 'median_factorize_ms', 'median_rank_one_update_ms',
  'median_rhs_assembly_ms', 'median_rhs_solve_ms',
  'factorize_share', 'rank_one_share', 'rhs_solve_share',
  'factorizations', 'rank_one_attempts', 'rank_one_updates',
  'rank_one_cap_skips', 'rank_one_failures', 'matrix_rebuilds', 'linear_solves',
  'state_disagreements', 'unresolved_steps', 'max_kcl_residual_a', 'max_kvl_residual_v',
  'median_heap_used_mb', 'max_rss_mb', 'gc_available', 'node_version', 'cpu_model',
];

const aggregate = [];
for (const [key, group] of groups) {
  const [caseName, solver] = key.split('|');
  const times = group.map(r => num(r.transient_ms));
  const compiles = group.map(r => num(r.compile_ms));
  const rebuilds = group.map(r => num(r.matrix_rebuild_ms));
  const factors = group.map(r => num(r.factorize_ms));
  const rankOnes = group.map(r => num(r.rank_one_update_ms));
  const rhsAssembly = group.map(r => num(r.rhs_assembly_ms));
  const rhsSolve = group.map(r => num(r.rhs_solve_ms));
  const medTransient = median(times);
  const [ciLow, ciHigh] = bootstrapMedianCI(times);
  const processIds = [...new Set(group.map(r => r.batch + ':' + r.order_index))];
  const perProcess = processIds.map(id => {
    const subset = group.filter(r => (r.batch + ':' + r.order_index) === id).map(r => num(r.transient_ms));
    return `${id}=${median(subset).toFixed(3)}`;
  });
  const first = group[0];
  aggregate.push({
    case: caseName, solver,
    workload_class: first.workload_class,
    mna_dimension: first.mna_dimension, diode_count: first.diode_count,
    samples: group.length, processes: processIds.length,
    repetitions_per_process: Math.max(...group.map(r => num(r.rep))) + 1,
    batches: new Set(group.map(r => r.batch)).size,
    median_transient_ms: medTransient.toFixed(6),
    q1_transient_ms: quantile(times, 0.25).toFixed(6),
    q3_transient_ms: quantile(times, 0.75).toFixed(6),
    median_ci_low_ms: ciLow.toFixed(6),
    median_ci_high_ms: ciHigh.toFixed(6),
    min_transient_ms: Math.min(...times).toFixed(6),
    max_transient_ms: Math.max(...times).toFixed(6),
    per_process_medians_ms: perProcess.join(';'),
    median_compile_ms: median(compiles).toFixed(6),
    median_matrix_rebuild_ms: median(rebuilds).toFixed(6),
    median_factorize_ms: median(factors).toFixed(6),
    median_rank_one_update_ms: median(rankOnes).toFixed(6),
    median_rhs_assembly_ms: median(rhsAssembly).toFixed(6),
    median_rhs_solve_ms: median(rhsSolve).toFixed(6),
    factorize_share: (median(factors) / medTransient).toFixed(6),
    rank_one_share: (median(rankOnes) / medTransient).toFixed(6),
    rhs_solve_share: (median(rhsSolve) / medTransient).toFixed(6),
    factorizations: first.factorizations,
    rank_one_attempts: first.rank_one_attempts,
    rank_one_updates: first.rank_one_updates,
    rank_one_cap_skips: first.rank_one_cap_skips,
    rank_one_failures: first.rank_one_failures,
    matrix_rebuilds: first.matrix_rebuilds,
    linear_solves: first.linear_solves,
    state_disagreements: first.state_disagreements,
    unresolved_steps: first.unresolved_steps,
    max_kcl_residual_a: group.map(r => num(r.max_abs_kcl_residual_a))
      .reduce((a, b) => Math.max(a, b), 0).toExponential(6),
    max_kvl_residual_v: group.map(r => num(r.max_abs_kvl_residual_v))
      .reduce((a, b) => Math.max(a, b), 0).toExponential(6),
    median_heap_used_mb: median(group.map(r => num(r.heap_used_after_mb))).toFixed(3),
    max_rss_mb: Math.max(...group.map(r => num(r.rss_after_mb))).toFixed(3),
    gc_available: first.gc_available,
    node_version: first.node_version, cpu_model: first.cpu_model,
  });
}

// Paired comparisons within each case: inverse-rank1 vs LU vs inverse.
const cases = [...new Set(aggregate.map(r => r.case))];
const summary = { generatedAt: new Date().toISOString(), bootstrapRounds, cases: {} };
for (const caseName of cases) {
  const byCase = Object.fromEntries(aggregate.filter(r => r.case === caseName).map(r => [r.solver, r]));
  const lu = byCase.lu, rank1 = byCase['inverse-rank1'], inv = byCase.inverse;
  if (!lu || !rank1) continue;
  const ratioPoint = num(rank1.median_transient_ms) / num(lu.median_transient_ms);
  // Bootstrap the ratio from the independent sample pools.
  const luSamples = rows.filter(r => r.case === caseName && r.solver === 'lu').map(r => num(r.transient_ms));
  const r1Samples = rows.filter(r => r.case === caseName && r.solver === 'inverse-rank1').map(r => num(r.transient_ms));
  const rand = mulberry32(0xC0FFEE + caseName.length);
  const ratios = [];
  for (let r = 0; r < bootstrapRounds; r++) {
    const draw = xs => {
      const s = new Array(xs.length);
      for (let i = 0; i < xs.length; i++) s[i] = xs[Math.floor(rand() * xs.length)];
      return s;
    };
    ratios.push(median(draw(r1Samples)) / median(draw(luSamples)));
  }
  ratios.sort((a, b) => a - b);
  summary.cases[caseName] = {
    workload_class: rank1.workload_class,
    rank_one_updates: Number(rank1.rank_one_updates),
    factorizations: { inverse: Number(inv?.factorizations ?? NaN), lu: Number(lu.factorizations), rank1: Number(rank1.factorizations) },
    median_ms: {
      inverse: Number(inv?.median_transient_ms ?? NaN),
      lu: Number(lu.median_transient_ms),
      rank1: Number(rank1.median_transient_ms),
    },
    rank1_over_lu: {
      point: ratioPoint,
      ci95: [quantile(ratios, 0.025), quantile(ratios, 0.975)],
      verdict: ratioPoint < 1 && quantile(ratios, 0.975) < 1 ? 'rank1 faster (CI excludes 1)'
        : ratioPoint > 1 && quantile(ratios, 0.025) > 1 ? 'LU faster (CI excludes 1)'
          : 'inconclusive (CI includes 1)',
    },
    lu_over_inverse: inv ? Number(lu.median_transient_ms) / Number(inv.median_transient_ms) : null,
  };
}

writeFileSync(outCsv, fields.join(',') + '\n' +
  aggregate.map(r => fields.map(k => r[k]).join(',')).join('\n') + '\n');
writeFileSync(outJson, JSON.stringify(summary, null, 2) + '\n');
console.log(`aggregated ${rows.length} raw repetitions into ${aggregate.length} groups`);
for (const [caseName, info] of Object.entries(summary.cases)) {
  console.log(`${caseName}: class=${info.workload_class} rank1/LU=${info.rank1_over_lu.point.toFixed(3)} ` +
    `CI=[${info.rank1_over_lu.ci95.map(v => v.toFixed(3)).join(', ')}] ${info.rank1_over_lu.verdict}`);
}
