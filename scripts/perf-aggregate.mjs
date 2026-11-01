/**
 * Aggregate one (and only one) stage-3 performance run directory.
 *
 * Strictness (from the independent review):
 *   - the run directory must contain metadata.json with a run_id;
 *   - every raw file is parsed with header/duplicate/incomplete validation;
 *   - duplicate (run,case,solver,batch,rep) keys are fatal;
 *   - uncertainty intervals use a CLUSTER bootstrap over independent
 *     processes (repetitions nested inside a process are NOT independent);
 *   - no silent NaN: any malformed number aborts the aggregation.
 *
 * node scripts/perf-aggregate.mjs --run=research/perf-runs/<runId>
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseProbeCsv, mergeProbeRows, groupRows, clusterBootstrapMedianCI,
  clusterBootstrapRatioCI, quantile, median,
} from '../src/sim/perfStats.js';

const args = Object.fromEntries(process.argv.slice(2)
  .filter(x => x.startsWith('--')).map(x => x.slice(2).split('=')));
const runDir = args.run;
if (!runDir) throw new Error('必须指定 --run=<运行目录>');
const seed = Number(args.seed ?? 20261031);
const rounds = Number(args.bootstrap ?? 2000);

const metadataPath = join(runDir, 'metadata.json');
let metadata;
try {
  metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
} catch (error) {
  throw new Error(`缺少或无法解析 ${metadataPath}: ${error.message}`);
}
if (!metadata.run_id) throw new Error('metadata.json 缺少 run_id');

const rawDir = join(runDir, 'raw');
const files = readdirSync(rawDir).filter(f => f.endsWith('.csv')).sort();
if (!files.length) throw new Error(`运行目录没有原始 CSV: ${rawDir}`);

const rowsBySource = {};
for (const file of files) {
  const rows = parseProbeCsv(readFileSync(join(rawDir, file), 'utf8'), { source: file });
  for (const row of rows) {
    if (row.run_id !== metadata.run_id) {
      throw new Error(`${file}: run_id ${row.run_id} 与 metadata ${metadata.run_id} 不一致`);
    }
  }
  rowsBySource[file] = rows;
}
const rows = mergeProbeRows(rowsBySource);
const groups = groupRows(rows);

// Every case must expose the same set of independent processes for a fair
// paired comparison.
const cases = [...new Set(rows.map(r => r.case))].sort();
const solvers = [...new Set(rows.map(r => r.solver))].sort();
const summaryRows = [];
const comparisons = {};
for (const caseName of cases) {
  const bySolver = {};
  for (const solver of solvers) {
    const group = groups.get(`${caseName}|${solver}`);
    if (!group) throw new Error(`${caseName}/${solver}: 缺少记录`);
    if (group.processes < 2) {
      throw new Error(`${caseName}/${solver}: 只有 ${group.processes} 个独立进程，无法给出聚类区间`);
    }
    const ci = clusterBootstrapMedianCI(group.byProcess, { rounds, seed: seed + caseName.length });
    bySolver[solver] = { group, ci };
    const first = group.first;
    summaryRows.push({
      run_id: metadata.run_id,
      case: caseName,
      solver,
      workload_class: first.workload_class,
      mna_dimension: first.mna_dimension,
      samples: group.samples,
      processes: group.processes,
      repetitions_per_process: group.samples / group.processes,
      median_ms: group.median_ms.toFixed(6),
      q1_ms: group.q1_ms.toFixed(6),
      q3_ms: group.q3_ms.toFixed(6),
      cluster_ci_low_ms: ci.low.toFixed(6),
      cluster_ci_high_ms: ci.high.toFixed(6),
      process_medians_ms: group.process_medians_ms.map(v => v.toFixed(3)).join(';'),
      factorizations: first.factorizations,
      rank_one_updates: first.rank_one_updates,
      rank_one_cap_skips: first.rank_one_cap_skips,
      rank_one_failures: first.rank_one_failures,
      matrix_rebuilds: first.matrix_rebuilds,
      linear_solves: first.linear_solves,
      work_solve_calls: first.work_solve_calls,
      heap_used_after_mb: median(rows.filter(r => r.case === caseName && r.solver === solver)
        .map(r => Number(r.heap_used_after_mb))).toFixed(3),
      rss_after_mb: Math.max(...rows.filter(r => r.case === caseName && r.solver === solver)
        .map(r => Number(r.rss_after_mb))).toFixed(3),
      node_version: first.node_version,
      cpu_model: first.cpu_model,
    });
  }
  // Paired cluster bootstrap of the rank-one/LU ratio.
  if (bySolver['inverse-rank1'] && bySolver.lu) {
    const ratioCi = clusterBootstrapRatioCI(
      bySolver['inverse-rank1'].group.byProcess, bySolver.lu.group.byProcess,
      { rounds, seed: seed + 7 + caseName.length },
    );
    const point = bySolver['inverse-rank1'].group.median_ms / bySolver.lu.group.median_ms;
    // Evidence threshold declared in advance: the whole 95% interval must be
    // on one side of 1, otherwise the comparison is inconclusive.
    const verdict = ratioCi.high < 1 ? 'rank_one_faster'
      : ratioCi.low > 1 ? 'lu_faster'
        : 'inconclusive';
    comparisons[caseName] = {
      workload_class: bySolver['inverse-rank1'].group.first.workload_class,
      rank_one_median_ms: bySolver['inverse-rank1'].group.median_ms,
      lu_median_ms: bySolver.lu.median_ms,
      ratio: point,
      ratio_ci95: [ratioCi.low, ratioCi.high],
      verdict,
      processes: bySolver.lu.group.processes,
    };
  }
}

const summaryFields = Object.keys(summaryRows[0]);
writeFileSync(join(runDir, 'summary.csv'),
  summaryFields.join(',') + '\n' + summaryRows.map(r => summaryFields.map(k => r[k]).join(',')).join('\n') + '\n');
const summary = {
  run_id: metadata.run_id,
  metadata,
  statistics: {
    unit: 'independent process (cluster bootstrap over batches)',
    bootstrap_rounds: rounds,
    seed,
    evidence_threshold: 'paper-level claim only when the 95% cluster CI excludes 1',
  },
  comparisons,
  groups: summaryRows,
};
writeFileSync(join(runDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');

console.log(`run ${metadata.run_id}: ${rows.length} samples, ${summaryRows.length} groups, ${cases.length} cases`);
for (const [caseName, c] of Object.entries(comparisons)) {
  console.log(`${caseName.padEnd(18)} class=${String(c.workload_class).padEnd(28)} ` +
    `rank1/LU=${c.ratio.toFixed(3)} CI=[${c.ratio_ci95.map(v => v.toFixed(3)).join(', ')}] -> ${c.verdict}`);
}
