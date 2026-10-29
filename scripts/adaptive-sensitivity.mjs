// Adaptive correction-scale sensitivity analysis (same PWL model).
// Run: node scripts/adaptive-sensitivity.mjs > adaptive_sensitivity.csv
import { compileCircuit, stepEngine, ptToStr } from '../src/sim/engine.js';
import { PREDEFINED_CIRCUITS } from '../src/sim/circuits.js';

const circuits = [
  ['rectifier', { x: 320, y: 260 }],
  ['fullwave_rect', { x: 500, y: 180 }],
  ['diode_clipper', { x: 360, y: 240 }],
  ['freewheel', { x: 360, y: 260 }],
];
const scales = [0.02, 0.1, 0.2, 1, 10]; // volts
const duration = 0.04, dt = 1e-5, refDt = 1e-6;
function simulate(elements, probe, timestep, mode, scale) {
  const eng = compileCircuit(elements, timestep, {
    diodeSolver: mode,
    correctionGuard: 0.015,
    adaptiveScale: scale,
    sourceSampling: 'be-end',
    linearSolver: 'lu',
  });
  const samples = [];
  for (let i = 0; i < Math.round(duration / timestep); i++) {
    stepEngine(eng);
    samples.push(eng.currentNodes[ptToStr(probe)] ?? 0);
  }
  return { samples, diagnostics: { ...eng.diagnostics } };
}
console.log('circuit,source_sampling,scale_v,rmse_v,linear_solves,state_disagreements,unresolved_steps');
for (const [key, probe] of circuits) {
  const elements = PREDEFINED_CIRCUITS[key].elements;
  const reference = simulate(elements, probe, refDt, 'hysteretic-corrected', 0.2);
  if (reference.diagnostics.unresolvedSteps) throw new Error('invalid reference for ' + key);
  for (const scale of scales) {
    const result = simulate(elements, probe, dt, 'adaptive', scale);
    let sum = 0;
    for (let i = 0; i < result.samples.length; i++) {
      const delta = result.samples[i] - reference.samples[(i + 1) * 10 - 1];
      sum += delta * delta;
    }
    const d = result.diagnostics;
    console.log([
      key, 'be-end', scale, Math.sqrt(sum / result.samples.length).toPrecision(9),
      d.linearSolves, d.stateDisagreements, d.unresolvedSteps,
    ].join(','));
  }
}
