import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseProbeCsv, mergeProbeRows, groupRows,
  clusterBootstrapMedianCI, clusterBootstrapRatioCI, median, quantile,
} from './perfStats.js';

const HEADER = 'run_id,process_id,sample_id,case,mna_dimension,element_count,diode_count,' +
  'has_timed_switch,solver,batch,order_index,rep,warmup,seed,compile_ms,transient_ms,' +
  'matrix_rebuild_ms,factorize_ms,rank_one_update_ms,rhs_assembly_ms,rhs_solve_ms,' +
  'factorizations,rank_one_attempts,rank_one_updates,rank_one_cap_skips,rank_one_failures,' +
  'matrix_rebuilds,linear_solves,work_solve_calls,state_disagreements,unresolved_steps,' +
  'max_abs_kcl_residual_a,max_abs_kvl_residual_v,workload_class,heap_used_before_mb,' +
  'heap_used_after_mb,rss_after_mb,gc_available,node_version,cpu_model';

function row({ run = 'r1', caseName = 'c1', solver = 'lu', batch = 1, rep = 1, transient = 10 } = {}) {
  const cells = HEADER.split(',').map(k => {
    switch (k) {
      case 'run_id': return run;
      case 'process_id': return `b${batch}`;
      case 'sample_id': return `${run}:${caseName}:${solver}:b${batch}:r${rep}`;
      case 'case': return caseName;
      case 'solver': return solver;
      case 'batch': return String(batch);
      case 'rep': return String(rep);
      case 'transient_ms': return String(transient);
      case 'compile_ms': return '1';
      case 'factorizations': return '1';
      case 'rank_one_updates': return '0';
      case 'matrix_rebuilds': return '0';
      case 'linear_solves': return '800';
      case 'work_solve_calls': return '800';
      case 'heap_used_after_mb': return '5';
      case 'rss_after_mb': return '40';
      case 'node_version': return 'v26.8.1';
      default: return '0';
    }
  });
  return cells.join(',');
}

test('parser rejects duplicated header rows (append contamination)', () => {
  const csv = [HEADER, row(), HEADER, row({ rep: 2 })].join('\n');
  assert.throws(() => parseProbeCsv(csv, { source: 'dup.csv' }), /重复表头/);
});

test('parser rejects duplicate record keys and incomplete rows', () => {
  assert.throws(
    () => parseProbeCsv([HEADER, row(), row()].join('\n'), { source: 'dup-key.csv' }),
    /重复记录键/,
  );
  const missingColumn = HEADER.replace(',node_version', '');
  assert.throws(() => parseProbeCsv([missingColumn, row()].join('\n'), { source: 'missing.csv' }),
    /缺少必需列/);
  const shortRow = row().split(',').slice(0, -2).join(',');
  assert.throws(() => parseProbeCsv([HEADER, shortRow].join('\n'), { source: 'short.csv' }),
    /列数/);
  const nanRow = row().split(',');
  nanRow[HEADER.split(',').indexOf('transient_ms')] = 'NaN';
  assert.throws(() => parseProbeCsv([HEADER, nanRow.join(',')].join('\n'), { source: 'nan.csv' }),
    /非有限数/);
  const zeroRow = row().split(',');
  zeroRow[HEADER.split(',').indexOf('transient_ms')] = '0';
  assert.throws(() => parseProbeCsv([HEADER, zeroRow.join(',')].join('\n'), { source: 'zero.csv' }),
    /必须为正/);
});

test('cross-file duplicate keys are rejected during merge', () => {
  const a = parseProbeCsv([HEADER, row()].join('\n'), { source: 'a.csv' });
  const b = parseProbeCsv([HEADER, row({ rep: 1 })].join('\n'), { source: 'b.csv' });
  assert.throws(() => mergeProbeRows({ 'a.csv': a, 'b.csv': b }), /跨文件重复/);
});

test('cluster bootstrap reflects process-level spread, not repetition count', () => {
  const byProcess = {
    b1: [10, 10, 10, 10],
    b2: [20, 20, 20, 20],
    b3: [30, 30, 30, 30],
  };
  const ci = clusterBootstrapMedianCI(byProcess, { rounds: 500, seed: 1 });
  // Naive pooling would give a very narrow interval around 20; the cluster CI
  // must span the process medians.
  assert.ok(ci.low <= 15, `ci.low=${ci.low}`);
  assert.ok(ci.high >= 25, `ci.high=${ci.high}`);
  const again = clusterBootstrapMedianCI(byProcess, { rounds: 500, seed: 1 });
  assert.deepEqual(ci, again, 'same seed must reproduce the interval');
  assert.throws(() => clusterBootstrapMedianCI({ b1: [1, 2] }), /至少需要 2 个独立进程/);
});

test('paired ratio bootstrap keeps solver pairing per process', () => {
  const a = { b1: [12], b2: [24], b3: [36] };
  const b = { b1: [10], b2: [20], b3: [30] };
  const ci = clusterBootstrapRatioCI(a, b, { rounds: 300, seed: 3 });
  assert.ok(Math.abs(ci.low - 1.2) < 1e-12, `low=${ci.low}`);
  assert.ok(Math.abs(ci.high - 1.2) < 1e-12, `high=${ci.high}`);
});

test('grouping never produces NaN and keeps per-process medians', () => {
  const rows = [];
  for (let batch = 1; batch <= 2; batch++) {
    for (let rep = 1; rep <= 3; rep++) {
      rows.push({ run_id: 'r1', case: 'c1', solver: 'lu', batch: String(batch), rep: String(rep),
        transient_ms: String(10 * batch + rep) });
    }
  }
  const groups = groupRows(rows);
  const g = groups.get('c1|lu');
  assert.equal(g.samples, 6);
  assert.equal(g.processes, 2);
  assert.ok(Number.isFinite(g.median_ms));
  assert.ok(Number.isFinite(quantile([1, 2, 3], 0.5)));
  assert.deepEqual(g.process_medians_ms.sort((x, y) => x - y), [12, 22]);
  assert.equal(median([1, 2, 3, 4]), 2.5);
});
