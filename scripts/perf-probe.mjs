/**
 * One independent process of the stage-3 performance protocol.
 *
 * Each invocation compiles and runs a single (case, solver) configuration,
 * records every repetition separately, and appends CSV rows to --out.
 * The parent shell launches several batches per configuration so that process
 * boundaries, JIT warm-up and machine noise are visible in the raw data.
 *
 * node --expose-gc scripts/perf-probe.mjs \
 *   --case=heavy-24 --solver=inverse-rank1 --reps=3 --warmup=1 \
 *   --batch=1 --order=0 --out=research/perf-raw/heavy-24__inverse-rank1__b1.csv
 *
 * This is a dense native-Node core measurement. It is NOT a browser/UI claim,
 * a sparse industrial MNA claim, or a physical-device accuracy claim.
 */
import { performance } from 'node:perf_hooks';
import os from 'node:os';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { compileCircuit, stepEngine } from '../src/sim/engine.js';
import { makeLargeDiodeBank, makeLargeLadder, makeParallelDiodeBank } from '../src/sim/researchCircuits.js';
import { acceptedMnaResidual } from '../src/sim/mnaResidual.js';

const args = Object.fromEntries(process.argv.slice(2)
  .filter(x => x.startsWith('--')).map(x => x.slice(2).split('=')));
const caseName = args.case;
const solver = args.solver;
const reps = Number(args.reps ?? 3);
const warmup = Number(args.warmup ?? 1);
const batch = Number(args.batch ?? 1);
const order = Number(args.order ?? 0);
const outPath = args.out;
const dt = 5e-5;
const duration = 0.04;
if (!caseName || !solver || !outPath) throw new Error('case/solver/out required');
if (!['inverse', 'lu', 'inverse-rank1'].includes(solver)) throw new Error('bad solver');
if (!Number.isInteger(reps) || reps < 1 || reps > 20) throw new Error('bad reps');
if (!Number.isInteger(warmup) || warmup < 0 || warmup > 5) throw new Error('bad warmup');
const steps = Math.round(duration / dt);

/** Deterministic case catalogue shared with the aggregator. */
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
  'case', 'mna_dimension', 'element_count', 'diode_count', 'has_timed_switch',
  'solver', 'batch', 'order_index', 'rep', 'warmup',
  'compile_ms', 'transient_ms',
  'matrix_rebuild_ms', 'factorize_ms', 'rank_one_update_ms',
  'rhs_assembly_ms', 'rhs_solve_ms',
  'factorizations', 'rank_one_attempts', 'rank_one_updates', 'rank_one_cap_skips',
  'rank_one_failures', 'matrix_rebuilds', 'linear_solves',
  'state_disagreements', 'unresolved_steps', 'max_abs_kcl_residual_a',
  'max_abs_kvl_residual_v', 'workload_class',
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
  return { engine, compileMs: t1 - t0, transientMs: t2 - t1 };
}

/** Residual check on a short deterministic replay (avoid timing the diagnostic). */
function residualProbe() {
  const engine = compileCircuit(elements, dt, {
    diodeSolver: 'hysteretic-corrected', linearSolver: solver,
    sourceSampling: 'be-end',
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
  rows.push({
    case: caseName, mna_dimension: result.engine.size,
    element_count: elements.length,
    diode_count: elements.filter(el => el.type === 'diode').length,
    has_timed_switch: elements.some(el => el.type === 'switch' && el.control === 'time'),
    solver, batch, order_index: order, rep, warmup,
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
const header = fields.join(',') + '\n';
const body = rows.map(row => fields.map(k => row[k]).join(',')).join('\n') + '\n';
appendFileSync(outPath, (rows.length ? header + body : ''));
console.error(JSON.stringify({
  case: caseName, solver, batch, order, reps, warmup, steps,
  mna_dimension: rows[0]?.mna_dimension, node: process.version,
  class: rows[0]?.workload_class,
}));
