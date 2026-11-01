/**
 * One independent process of the stage-3 performance protocol.
 *
 * Safety rules (from the independent review):
 *   - every invocation belongs to exactly one run id;
 *   - it writes ONE new CSV file and refuses to overwrite an existing one;
 *   - it never appends to an existing file (no duplicated headers);
 *   - every row carries run_id / process_id / sample_id.
 *
 * node --expose-gc scripts/perf-probe.mjs \
 *   --run-id=<id> --case=heavy-24 --solver=inverse-rank1 --reps=3 --warmup=1 \
 *   --batch=1 --order=0 --seed=12345 --out=research/perf-runs/<id>/raw/heavy-24__inverse-rank1__b1.csv
 */
import { performance } from 'node:perf_hooks';
import os from 'node:os';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { compileCircuit, stepEngine } from '../src/sim/engine.js';
import { makeLargeDiodeBank, makeLargeLadder, makeParallelDiodeBank } from '../src/sim/researchCircuits.js';
import { acceptedMnaResidual } from '../src/sim/mnaResidual.js';

const args = Object.fromEntries(process.argv.slice(2)
  .filter(x => x.startsWith('--')).map(x => x.slice(2).split('=')));
const runId = args['run-id'];
const caseName = args.case;
const solver = args.solver;
const reps = Number(args.reps ?? 3);
const warmup = Number(args.warmup ?? 1);
const batch = Number(args.batch ?? 1);
const order = Number(args.order ?? 0);
const seed = Number(args.seed ?? 0);
const outPath = args.out;
const dt = 5e-5;
const duration = 0.04;

if (!runId || !/^[A-Za-z0-9._-]+$/.test(runId)) throw new Error('run-id 缺失或非法');
if (!caseName || !solver || !outPath) throw new Error('case/solver/out required');
if (!['inverse', 'lu', 'inverse-rank1'].includes(solver)) throw new Error('bad solver');
if (!Number.isInteger(reps) || reps < 1 || reps > 20) throw new Error('bad reps');
if (!Number.isInteger(warmup) || warmup < 0 || warmup > 5) throw new Error('bad warmup');
if (!Number.isInteger(batch) || batch < 1) throw new Error('bad batch');
if (!Number.isInteger(order) || order < 0) throw new Error('bad order');
if (!Number.isFinite(seed)) throw new Error('bad seed');
// Refuse to touch an existing evidence file: a second run must use a new run id.
if (existsSync(outPath)) {
  throw new Error(`证据文件已存在，拒绝覆盖或追加: ${outPath}`);
}
const steps = Math.round(duration / dt);

/** Deterministic case catalogue (same circuits as the published protocol). */
const CASES = {
  'rc-64': () => makeLargeLadder(64, { kind: 'rc' }),
  'rc-256': () => makeLargeLadder(256, { kind: 'rc' }),
  'light-96': () => makeLargeDiodeBank(47, { loadProfile: 'light' }),
  'light-128': () => makeLargeDiodeBank(63, { loadProfile: 'light' }),
  'light-256': () => makeLargeDiodeBank(127, { loadProfile: 'light' }),
  'heavy-12': () => makeParallelDiodeBank(12, { loadProfile: 'heavy' }),
  'heavy-24': () => makeParallelDiodeBank(24, { loadProfile: 'heavy' }),
  'heavy-64': () => makeLargeDiodeBank(31, { loadProfile: 'heavy' }),
  'heavy-128': () => makeLargeDiodeBank(63, { loadProfile: 'heavy' }),
  'heavy-256': () => makeLargeDiodeBank(127, { loadProfile: 'heavy' }),
  'timed-switch-24': () => {
    const elements = makeParallelDiodeBank(24, { loadProfile: 'light' });
    elements.push({
      id: 'timed', type: 'switch', p1: { x: 160, y: 80 }, p2: { x: 0, y: 0 },
      control: 'time', timeOn: 0.005, timeOff: 0.015, state: false,
    });
    return elements;
  },
};
if (!CASES[caseName]) throw new Error('unknown case: ' + caseName);
const elements = CASES[caseName]();

const fields = [
  'run_id', 'process_id', 'sample_id', 'case', 'mna_dimension', 'element_count',
  'diode_count', 'has_timed_switch', 'solver', 'batch', 'order_index', 'rep',
  'warmup', 'seed', 'compile_ms', 'transient_ms',
  'matrix_rebuild_ms', 'factorize_ms', 'rank_one_update_ms',
  'rhs_assembly_ms', 'rhs_solve_ms',
  'factorizations', 'rank_one_attempts', 'rank_one_updates', 'rank_one_cap_skips',
  'rank_one_failures', 'matrix_rebuilds', 'linear_solves', 'work_solve_calls',
  'state_disagreements', 'unresolved_steps',
  'max_abs_kcl_residual_a', 'max_abs_kvl_residual_v', 'workload_class',
  'heap_used_before_mb', 'heap_used_after_mb', 'rss_after_mb', 'gc_available',
  'node_version', 'cpu_model',
];

function classify(diagnostics, timing) {
  const hasTimedSwitch = elements.some(el => el.type === 'switch' && el.control === 'time');
  if (timing.rankOneFailures > 0) return 'E_near_singular_fallback';
  if (hasTimedSwitch && diagnostics.matrixRebuilds > 0) return 'F_timed_switch_rebuild';
  if (timing.rankOneUpdates > 0 && diagnostics.factorizations > 1) return 'D_rank_one_plus_rebuild';
  if (timing.rankOneUpdates > 0) return 'C_rank_one_only';
  if (timing.rankOneCapSkips > 0) return 'B_state_change_cap_skipped';
  if (diagnostics.matrixRebuilds > 0) return 'B_state_change_fallback_or_skip';
  return 'A_no_state_change';
}

function runOnce() {
  const t0 = performance.now();
  const engine = compileCircuit(elements, dt, {
    diodeSolver: 'hysteretic-corrected', linearSolver: solver,
    sourceSampling: 'be-end', recordTiming: true,
  });
  const t1 = performance.now();
  for (let k = 0; k < steps; k++) stepEngine(engine);
  const t2 = performance.now();
  if (engine.diagnostics.unresolvedSteps > 0) {
    throw new Error(`${caseName}/${solver}: unresolved diode state in timed run`);
  }
  // Accounting identity: monotonic counter == accepted + rejected work.
  const expected = engine.diagnostics.linearSolves + (engine.diagnostics.eventRejectedSolves ?? 0);
  if (engine.work.solveCalls !== expected) {
    throw new Error(`${caseName}/${solver}: solve accounting mismatch ${engine.work.solveCalls} != ${expected}`);
  }
  return { engine, compileMs: t1 - t0, transientMs: t2 - t1 };
}

/** Residual diagnostic on a separate deterministic replay (not timed). */
function residualProbe() {
  const engine = compileCircuit(elements, dt, {
    diodeSolver: 'hysteretic-corrected', linearSolver: solver, sourceSampling: 'be-end',
  });
  let maxKcl = 0, maxKvl = 0;
  for (let k = 0; k < steps; k++) {
    const historyBefore = { ...engine.state };
    stepEngine(engine);
    if (k % 113 === 0 || k === steps - 1) {
      const residual = acceptedMnaResidual(engine, historyBefore);
      maxKcl = Math.max(maxKcl, residual.kclAbsolute);
      maxKvl = Math.max(maxKvl, residual.kvlAbsolute);
    }
  }
  return { maxKcl, maxKvl };
}

if (typeof global.gc === 'function') global.gc();
const residual = residualProbe();

const rows = [];
for (let w = 0; w < warmup; w++) runOnce();
for (let rep = 0; rep < reps; rep++) {
  if (typeof global.gc === 'function') global.gc();
  const heapBefore = process.memoryUsage();
  const result = runOnce();
  const heapAfter = process.memoryUsage();
  const timing = result.engine.timing;
  const diagnostics = result.engine.diagnostics;
  const processId = `b${batch}o${order}`;
  rows.push({
    run_id: runId, process_id: processId,
    sample_id: `${runId}:${caseName}:${solver}:${processId}:r${rep}`,
    case: caseName, mna_dimension: result.engine.size,
    element_count: elements.length,
    diode_count: elements.filter(el => el.type === 'diode').length,
    has_timed_switch: elements.some(el => el.type === 'switch' && el.control === 'time'),
    solver, batch, order_index: order, rep, warmup, seed,
    compile_ms: result.compileMs.toFixed(6),
    transient_ms: result.transientMs.toFixed(6),
    matrix_rebuild_ms: timing.matrixRebuildMs.toFixed(6),
    factorize_ms: timing.factorizeMs.toFixed(6),
    rank_one_update_ms: timing.rankOneUpdateMs.toFixed(6),
    rhs_assembly_ms: timing.rhsAssemblyMs.toFixed(6),
    rhs_solve_ms: timing.rhsSolveMs.toFixed(6),
    factorizations: diagnostics.factorizations,
    rank_one_attempts: timing.rankOneAttempts,
    rank_one_updates: diagnostics.rankOneUpdates,
    rank_one_cap_skips: timing.rankOneCapSkips,
    rank_one_failures: timing.rankOneFailures,
    matrix_rebuilds: diagnostics.matrixRebuilds,
    linear_solves: diagnostics.linearSolves,
    work_solve_calls: result.engine.work.solveCalls,
    state_disagreements: diagnostics.stateDisagreements,
    unresolved_steps: diagnostics.unresolvedSteps,
    max_abs_kcl_residual_a: residual.maxKcl.toExponential(6),
    max_abs_kvl_residual_v: residual.maxKvl.toExponential(6),
    workload_class: classify(diagnostics, timing),
    heap_used_before_mb: (heapBefore.heapUsed / 1024 ** 2).toFixed(3),
    heap_used_after_mb: (heapAfter.heapUsed / 1024 ** 2).toFixed(3),
    rss_after_mb: (heapAfter.rss / 1024 ** 2).toFixed(3),
    gc_available: typeof global.gc === 'function',
    node_version: process.version,
    cpu_model: (os.cpus()[0]?.model ?? 'unknown').replaceAll(',', ';').trim(),
  });
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, fields.join(',') + '\n' +
  rows.map(row => fields.map(k => row[k]).join(',')).join('\n') + '\n', { flag: 'wx' });
console.error(JSON.stringify({
  run_id: runId, case: caseName, solver, batch, order, reps, warmup, seed,
  steps, mna_dimension: rows[0]?.mna_dimension, node: process.version,
  class: rows[0]?.workload_class,
}));
