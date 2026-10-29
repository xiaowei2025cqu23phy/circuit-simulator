/**
 * Compare dense Gauss-Jordan inverse reuse against dense partial-pivot LU reuse.
 * Both solve EXACTLY the same MNA/PWL circuit; no physical-model comparison.
 *
 * node scripts/compare-linear-solvers.mjs > lu_comparison.csv
 * Run multiple times on an idle machine; report CPU, Node version, median & IQR.
 */
import { performance } from 'node:perf_hooks';
import { compileCircuit, stepEngine, ptToStr } from '../src/sim/engine.js';
import { PREDEFINED_CIRCUITS } from '../src/sim/circuits.js';

const cases = [
  ['rectifier', { x: 320, y: 260 }],
  ['fullwave_rect', { x: 500, y: 180 }],
  ['diode_clipper', { x: 360, y: 240 }],
  ['freewheel', { x: 360, y: 260 }],
];
const modes = ['iterative', 'predicted', 'guarded', 'adaptive', 'hysteretic-corrected'];
const dt = 1e-5, duration = 0.04, repetitions = 5;

function simulate(elements, probe, diodeSolver, linearSolver) {
  const compilationStart = performance.now();
  const engine = compileCircuit(elements, dt, { diodeSolver, linearSolver, sourceSampling: 'be-end' });
  const compileMs = performance.now() - compilationStart;
  const trace = [];
  const start = performance.now();
  for (let i = 0; i < Math.round(duration / dt); i++) {
    stepEngine(engine);
    trace.push(engine.currentNodes[ptToStr(probe)]);
  }
  return {
    trace, compileMs, solveMs: performance.now() - start,
    diagnostics: { ...engine.diagnostics },
  };
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
const keys = [
  'circuit','diode_solver','linear_solver','source_sampling','steps','median_compile_ms','median_simulate_ms',
  'linear_solves','factorizations','matrix_rebuilds','max_abs_voltage_difference_v',
  'rmse_difference_v','unresolved_steps','node_version',
];
console.log(keys.join(','));
for (const [name, probe] of cases) {
  for (const diodeSolver of modes) {
    const els = PREDEFINED_CIRCUITS[name].elements;
    const results = {};
    for (const linearSolver of ['inverse', 'lu']) {
      results[linearSolver] = Array.from({ length: repetitions },
        () => simulate(els, probe, diodeSolver, linearSolver));
    }
    const firstInverse = results.inverse[0], firstLU = results.lu[0];
    let sum = 0, maxAbs = 0;
    for (let i = 0; i < firstLU.trace.length; i++) {
      const delta = firstLU.trace[i] - firstInverse.trace[i];
      sum += delta * delta;
      maxAbs = Math.max(maxAbs, Math.abs(delta));
    }
    if (maxAbs > 1e-5) {
      throw new Error(`LU/inverse voltage mismatch ${name}/${diodeSolver}: ${maxAbs} V`);
    }
    for (const linearSolver of ['inverse', 'lu']) {
      const result = results[linearSolver][0];
      const row = {
        circuit: name, diode_solver: diodeSolver, linear_solver: linearSolver,
        source_sampling: 'be-end',
        steps: result.trace.length,
        median_compile_ms: median(results[linearSolver].map(x => x.compileMs)).toFixed(6),
        median_simulate_ms: median(results[linearSolver].map(x => x.solveMs)).toFixed(6),
        linear_solves: result.diagnostics.linearSolves,
        factorizations: result.diagnostics.factorizations,
        matrix_rebuilds: result.diagnostics.matrixRebuilds,
        max_abs_voltage_difference_v: maxAbs.toExponential(5),
        rmse_difference_v: Math.sqrt(sum / firstLU.trace.length).toExponential(5),
        unresolved_steps: result.diagnostics.unresolvedSteps,
        node_version: process.version,
      };
      console.log(keys.map(k => row[k]).join(','));
    }
  }
}
