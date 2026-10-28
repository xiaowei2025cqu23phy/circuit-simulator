// Reproducible algorithm-side comparison. No claims of speedup without a run.
// Usage: node scripts/compare-hsp-mna.mjs > comparison.csv
import { performance } from 'node:perf_hooks';
import { compileCircuit, stepEngine, ptToStr } from '../src/sim/engine.js';
import { PREDEFINED_CIRCUITS } from '../src/sim/circuits.js';

const cases = [
  { key: 'rectifier', probe: { x: 320, y: 260 } },
  { key: 'fullwave_rect', probe: { x: 500, y: 180 } },
  { key: 'diode_clipper', probe: { x: 360, y: 240 } },
  { key: 'freewheel', probe: { x: 360, y: 260 } },
];
const steps = 2000;
const dt = 1e-5;
const point = (p) => ptToStr(p);
function simulate(elements, mode, probe) {
  const engine = compileCircuit(elements, dt, { diodeSolver: mode });
  const voltages = [];
  const begin = performance.now();
  let error = '';
  for (let n = 0; n < steps; n++) {
    try {
      stepEngine(engine);
      voltages.push(engine.currentNodes[point(probe)] ?? 0);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      break;
    }
  }
  return { voltages, ms: performance.now() - begin, stats: engine.diagnostics, error };
}
console.log('circuit,mode,completed_steps,wall_ms,linear_solves,matrix_rebuilds,state_disagreements,unresolved_steps,rmse_vs_iterative_v,error');
for (const { key, probe } of cases) {
  const scenario = PREDEFINED_CIRCUITS[key];
  if (!scenario) throw new Error('Unknown reference circuit: ' + key);
  const baseline = simulate(scenario.elements, 'iterative', probe);
  const candidate = simulate(scenario.elements, 'predicted', probe);
  const n = Math.min(baseline.voltages.length, candidate.voltages.length);
  const rmse = n ? Math.sqrt(Array.from({ length: n }, (_, i) =>
    (baseline.voltages[i] - candidate.voltages[i]) ** 2
  ).reduce((a, b) => a + b, 0) / n) : NaN;
  for (const [mode, result] of [['iterative', baseline], ['predicted', candidate]]) {
    const s = result.stats;
    const row = [key, mode, result.voltages.length, result.ms.toFixed(4),
      s.linearSolves, s.matrixRebuilds, s.stateDisagreements, s.unresolvedSteps,
      mode === 'predicted' ? rmse.toPrecision(8) : 0,
      JSON.stringify(result.error)];
    console.log(row.join(','));
  }
}
