/**
 * Pure statistics/validation helpers for the stage-3 performance protocol.
 *
 * Design requirements (from the independent review):
 *   - a record must carry a unique run/process/repetition identity;
 *   - duplicate keys, duplicate headers and incomplete/NaN records are errors,
 *     never silently aggregated;
 *   - independent PROCESSES are the sampling unit for uncertainty intervals,
 *     with the repetitions nested inside each process (cluster bootstrap).
 *
 * This module performs no I/O so it can be unit-tested directly.
 */

export const REQUIRED_FIELDS = Object.freeze([
  'run_id', 'case', 'solver', 'batch', 'order_index', 'rep',
  'transient_ms', 'compile_ms', 'factorizations', 'rank_one_updates',
  'matrix_rebuilds', 'linear_solves', 'heap_used_after_mb', 'rss_after_mb',
  'node_version',
]);

/** Parse a probe CSV with strict header handling. Throws on malformed input. */
export function parseProbeCsv(text, { source = 'csv' } = {}) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error(`空证据文件: ${source}`);
  }
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(',');
  const headerKey = header.join(',');
  const missing = REQUIRED_FIELDS.filter(f => !header.includes(f));
  if (missing.length) {
    throw new Error(`${source}: 缺少必需列 ${missing.join(',')}`);
  }
  const rows = [];
  const seen = new Set();
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',');
    if (cells.length !== header.length) {
      throw new Error(`${source}: 第 ${i + 1} 行列数 ${cells.length} != 表头 ${header.length}`);
    }
    // A repeated header row inside the body means the file was appended to.
    if (cells.join(',') === headerKey) {
      throw new Error(`${source}: 第 ${i + 1} 行是重复表头（禁止向证据文件追加）`);
    }
    const row = {};
    header.forEach((k, j) => { row[k] = cells[j]; });
    const key = `${row.run_id}|${row.case}|${row.solver}|${row.batch}|${row.rep}`;
    if (seen.has(key)) throw new Error(`${source}: 重复记录键 ${key}`);
    seen.add(key);
    for (const field of ['transient_ms', 'compile_ms', 'factorizations', 'linear_solves',
      'heap_used_after_mb', 'rss_after_mb', 'rep', 'batch']) {
      const value = Number(row[field]);
      if (!Number.isFinite(value)) {
        throw new Error(`${source}: 第 ${i + 1} 行 ${field} 非有限数 (${row[field]})`);
      }
    }
    if (Number(row.transient_ms) <= 0) {
      throw new Error(`${source}: 第 ${i + 1} 行 transient_ms 必须为正`);
    }
    rows.push(row);
  }
  if (!rows.length) throw new Error(`${source}: 证据文件没有数据行`);
  return rows;
}

/** Merge rows from several files, rejecting cross-file duplicate keys. */
export function mergeProbeRows(rowsBySource) {
  const merged = [];
  const seen = new Map();
  for (const [source, rows] of Object.entries(rowsBySource)) {
    for (const row of rows) {
      const key = `${row.run_id}|${row.case}|${row.solver}|${row.batch}|${row.rep}`;
      if (seen.has(key)) {
        throw new Error(`跨文件重复记录键 ${key} (${seen.get(key)} 与 ${source})`);
      }
      seen.set(key, source);
      merged.push(row);
    }
  }
  if (!merged.length) throw new Error('没有可聚合的记录');
  return merged;
}

const median = xs => {
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
export { median };

export const quantile = (xs, p) => {
  const s = xs.slice().sort((a, b) => a - b);
  const pos = (s.length - 1) * p;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (pos - lo);
};

/** Deterministic PRNG (mulberry32) so every interval is reproducible. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Cluster bootstrap: resample PROCESSES with replacement and pool their
 * repetitions. Treating the repetitions as independent would understate the
 * uncertainty because they share JIT/machine state.
 */
export function clusterBootstrapMedianCI(samplesByProcess, { rounds = 2000, seed = 1 } = {}) {
  const processes = Object.keys(samplesByProcess).sort();
  if (processes.length < 2) {
    throw new Error('至少需要 2 个独立进程才能给出聚类置信区间');
  }
  for (const id of processes) {
    if (!samplesByProcess[id].length) throw new Error(`进程 ${id} 没有样本`);
  }
  const rand = mulberry32(seed);
  const medians = [];
  for (let r = 0; r < rounds; r++) {
    const pooled = [];
    for (let i = 0; i < processes.length; i++) {
      const pick = processes[Math.floor(rand() * processes.length)];
      pooled.push(...samplesByProcess[pick]);
    }
    medians.push(median(pooled));
  }
  medians.sort((a, b) => a - b);
  return { low: quantile(medians, 0.025), high: quantile(medians, 0.975), rounds };
}

/**
 * Cluster bootstrap of the median RATIO (solver A / solver B) with PAIRED
 * process resampling: a resampled batch index is used for both solvers.
 */
export function clusterBootstrapRatioCI(samplesByProcessA, samplesByProcessB, { rounds = 2000, seed = 1 } = {}) {
  const processes = Object.keys(samplesByProcessA).sort();
  if (processes.length < 2) throw new Error('至少需要 2 个独立进程才能给出比值区间');
  for (const id of processes) {
    if (!samplesByProcessA[id]?.length || !samplesByProcessB[id]?.length) {
      throw new Error(`进程 ${id} 缺少 A/B 样本`);
    }
  }
  const rand = mulberry32(seed);
  const ratios = [];
  for (let r = 0; r < rounds; r++) {
    const pooledA = [], pooledB = [];
    for (let i = 0; i < processes.length; i++) {
      const pick = processes[Math.floor(rand() * processes.length)];
      pooledA.push(...samplesByProcessA[pick]);
      pooledB.push(...samplesByProcessB[pick]);
    }
    ratios.push(median(pooledA) / median(pooledB));
  }
  ratios.sort((a, b) => a - b);
  return { low: quantile(ratios, 0.025), high: quantile(ratios, 0.975), rounds };
}

/** Group rows by case/solver and compute descriptive statistics. */
export function groupRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.case}|${row.solver}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const out = new Map();
  for (const [key, group] of groups) {
    const [caseName, solver] = key.split('|');
    const byProcess = {};
    for (const row of group) {
      const pid = String(row.batch);
      (byProcess[pid] ??= []).push(Number(row.transient_ms));
    }
    const all = group.map(r => Number(r.transient_ms));
    const processMedians = Object.keys(byProcess).sort().map(id => median(byProcess[id]));
    out.set(key, {
      case: caseName, solver,
      samples: all.length,
      processes: processMedians.length,
      median_ms: median(all),
      q1_ms: quantile(all, 0.25),
      q3_ms: quantile(all, 0.75),
      min_ms: Math.min(...all),
      max_ms: Math.max(...all),
      process_medians_ms: processMedians,
      byProcess,
      first: group[0],
    });
  }
  return out;
}
