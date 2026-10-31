/**
 * Stage-3 SAME-DEVICE-MODEL comparison of HSP state algorithms.
 *
 * All modes below share ONE device law: the hysteretic 0.70/0.65 V two-state
 * PWL diode, the same backward-Euler companion, the same source sampling and
 * the same initial conditions. The legacy `iterative` mode is deliberately
 * EXCLUDED: it uses a different state law (reverse-current release), so mixing
 * it into this table would confound device-model difference with algorithm
 * difference (see research/round9-stage3-diode-reverse-current.csv).
 *
 * Modes under test:
 *   predicted              one linear solve per step, state from x_{k-1}
 *   guarded                endpoint check with a fixed 15 mV tolerance
 *   adaptive               endpoint check with a voltage-jump-driven tolerance
 *   hysteretic-corrected   endpoint fixpoint under the SAME law (= full iteration)
 *   corrected+refinement   the same fixpoint plus recursive substep splitting
 *
 * Output: research/round9-stage3-same-model.csv
 * Run: node scripts/compare-hsp-same-model.mjs [--reps=3]
 */
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { compileCircuit, stepEngine, ptToStr } from '../src/sim/engine.js';
import { PREDEFINED_CIRCUITS } from '../src/sim/circuits.js';
import { stepEngineWithDiodeRefinement } from '../src/sim/eventRefinement.js';
import { acceptedMnaResidual } from '../src/sim/mnaResidual.js';
import { makeParallelDiodeBank } from '../src/sim/researchCircuits.js';

const args = Object.fromEntries(process.argv.slice(2)
  .filter(x => x.startsWith('--')).map(x => x.slice(2).split('=')));
const reps = Number(args.reps ?? 3);
const outPath = args.out ?? 'research/round9-stage3-same-model.csv';
const duration = 0.04;
const referenceDt = 1e-6;
const testDts = [1e-5, 5e-5, 1e-4];
const modes = ['predicted', 'guarded', 'adaptive', 'hysteretic-corrected'];
const probePoint = { rectifier: { x: 320, y: 260 }, fullwave_rect: { x: 500, y: 180 },
  diode_clipper: { x: 360, y: 240 }, freewheel: { x: 360, y: 260 } };

const scenarios = [];
for (const [key, probe] of Object.entries(probePoint)) {
  scenarios.push({ name: key, elements: PREDEFINED_CIRCUITS[key].elements, probe });
}
scenarios.push({ name: 'diode-bank-12-heavy',
  elements: makeParallelDiodeBank(12, { loadProfile: 'heavy' }), probe: { x: 160, y: 80 } });
scenarios.push({ name: 'diode-bank-24-heavy',
  elements: makeParallelDiodeBank(24, { loadProfile: 'heavy' }), probe: { x: 160, y: 80 } });

function makeEngine(elements, dt, mode, refinement = false) {
  const engine = compileCircuit(elements, dt, {
    diodeSolver: mode, correctionGuard: 0.015, adaptiveScale: 0.2,
    sourceSampling: 'be-end', linearSolver: 'lu',
  });
  return { engine, refinement };
}
function stepOnce(handle) {
  if (handle.refinement) stepEngineWithDiodeRefinement(handle.engine, null, { maxHalvings: 6 });
  else stepEngine(handle.engine);
}

/** Fine-grid reference generated with the SAME device law and the same law fixpoint. */
function buildReference(elements, probe) {
  const handle = makeEngine(elements, referenceDt, 'hysteretic-corrected');
  const steps = Math.round(duration / referenceDt);
  const values = new Float64Array(steps);
  for (let k = 0; k < steps; k++) {
    stepOnce(handle);
    values[k] = handle.engine.currentNodes[ptToStr(probe)] ?? 0;
  }
  if (handle.engine.diagnostics.unresolvedSteps > 0) {
    throw new Error('reference contains unresolved steps: ' + handle.engine.diagnostics.unresolvedSteps);
  }
  return values;
}

function simulate(elements, probe, dt, mode, refinement) {
  const handle = makeEngine(elements, dt, mode, refinement);
  const steps = Math.round(duration / dt);
  const values = new Float64Array(steps);
  let maxKcl = 0, maxKvl = 0;
  const begin = performance.now();
  for (let k = 0; k < steps; k++) {
    const historyBefore = { ...handle.engine.state };
    stepOnce(handle);
    values[k] = handle.engine.currentNodes[ptToStr(probe)] ?? 0;
    if (k % 61 === 0 || k === steps - 1) {
      const residual = acceptedMnaResidual(handle.engine, historyBefore);
      maxKcl = Math.max(maxKcl, residual.kclAbsolute);
      maxKvl = Math.max(maxKvl, residual.kvlAbsolute);
    }
  }
  const elapsed = performance.now() - begin;
  const d = handle.engine.diagnostics;
  return {
    values, elapsed, steps,
    linearSolves: d.linearSolves, stateCorrections: d.stateCorrections,
    stepsWithCorrections: d.stepsWithCorrections,
    stateDisagreements: d.stateDisagreements, adaptiveTightenedSteps: d.adaptiveTightenedSteps,
    unresolvedSteps: d.unresolvedSteps, factorizations: d.factorizations,
    maxKcl, maxKvl,
  };
}

function compare(samples, reference, dt) {
  const ratio = Math.round(dt / referenceDt);
  let sum = 0, max = 0;
  for (let i = 0; i < samples.length; i++) {
    const ref = reference[(i + 1) * ratio - 1];
    const delta = samples[i] - ref;
    sum += delta * delta;
    max = Math.max(max, Math.abs(delta));
  }
  return { rmse: Math.sqrt(sum / samples.length), max };
}
const median = xs => {
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const rows = [];
for (const scenario of scenarios) {
  const reference = buildReference(scenario.elements, scenario.probe);
  for (const dt of testDts) {
    for (const mode of modes) {
      for (const refinement of [false, true]) {
        if (refinement && mode !== 'hysteretic-corrected') continue;
        const runs = [];
        for (let rep = 0; rep < reps; rep++) {
          runs.push(simulate(scenario.elements, scenario.probe, dt, mode, refinement));
        }
        const first = runs[0];
        const metrics = compare(first.values, reference, dt);
        const d = first;
        rows.push({
          circuit: scenario.name,
          device_law: 'hysteretic_pwl_0.70_0.65',
          mode: refinement ? mode + '+refinement' : mode,
          dt_us: (dt * 1e6).toFixed(3),
          steps: d.steps,
          reference_dt_us: (referenceDt * 1e6).toFixed(3),
          rmse_v: metrics.rmse.toExponential(8),
          max_abs_error_v: metrics.max.toExponential(8),
          median_elapsed_ms: median(runs.map(r => r.elapsed)).toFixed(4),
          linear_solves: d.linearSolves,
          solves_per_step: (d.linearSolves / d.steps).toFixed(6),
          state_corrections: d.stateCorrections,
          steps_with_corrections: d.stepsWithCorrections,
          state_disagreements: d.stateDisagreements,
          adaptive_tightened_steps: d.adaptiveTightenedSteps,
          unresolved_steps: d.unresolvedSteps,
          factorizations: d.factorizations,
          max_kcl_residual_a: d.maxKcl.toExponential(6),
          max_kvl_residual_v: d.maxKvl.toExponential(6),
          node_version: process.version,
        });
      }
    }
  }
}

const fields = Object.keys(rows[0]);
writeFileSync(outPath, fields.join(',') + '\n' +
  rows.map(r => fields.map(k => r[k]).join(',')).join('\n') + '\n');
console.log(`wrote ${rows.length} same-model rows -> ${outPath}`);
