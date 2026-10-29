// Reproducible comparison of four methods under ONE hysteretic PWL law.
// `node scripts/compare-hsp-mna.mjs > results.csv`
// No SPICE validation is implied; the fine-grid reference uses the same PWL
// device model, BE endpoint-sampled forcing, and corrected algorithm at smaller dt.
import { performance } from 'node:perf_hooks';
import { compileCircuit, stepEngine, ptToStr } from '../src/sim/engine.js';
import { PREDEFINED_CIRCUITS } from '../src/sim/circuits.js';

const cases = [
  { key: 'rectifier', probe: { x: 320, y: 260 } },
  { key: 'fullwave_rect', probe: { x: 500, y: 180 } },
  { key: 'diode_clipper', probe: { x: 360, y: 240 } },
  { key: 'freewheel', probe: { x: 360, y: 260 } },
];
const duration = 0.04;
const referenceDt = 1e-6;
const testDts = [1e-5, 5e-5, 1e-4];
const guardedThreshold = 0.015; // V: ignore endpoint-state violations <= 15 mV
const modes = ['predicted', 'guarded', 'adaptive', 'hysteretic-corrected'];
const adaptiveScale = 0.2; // V; sensitivity scale for adaptive candidate
const repetitions = 3;

function run(elements, mode, dt, probe) {
  const eng = compileCircuit(elements, dt, {
    diodeSolver: mode,
    correctionGuard: guardedThreshold,
    adaptiveScale,
    sourceSampling: 'be-end',
    linearSolver: 'lu',
  });
  const voltage = [];
  const steps = Math.round(duration / dt);
  let error = '';
  const t0 = performance.now();
  for (let k = 0; k < steps; k++) {
    try {
      stepEngine(eng);
      voltage.push(eng.currentNodes[ptToStr(probe)] ?? 0);
    } catch (err) {
      error = String(err instanceof Error ? err.message : err);
      break;
    }
  }
  return { voltage, elapsedMs: performance.now() - t0, diagnostics: { ...eng.diagnostics }, error };
}

function rmseAgainstReference(samples, ref, dt) {
  const ratio = Math.round(dt / referenceDt);
  if (samples.length === 0) return { rmse: NaN, maxError: NaN };
  let sum = 0, maxError = 0;
  for (let i = 0; i < samples.length; i++) {
    // Same end-of-step sampling time.
    const refIndex = (i + 1) * ratio - 1;
    const delta = samples[i] - ref[refIndex];
    sum += delta * delta;
    maxError = Math.max(maxError, Math.abs(delta));
  }
  return { rmse: Math.sqrt(sum / samples.length), maxError };
}

const rows = [];
for (const { key, probe } of cases) {
  const elements = PREDEFINED_CIRCUITS[key]?.elements;
  if (!elements) throw new Error('Missing circuit ' + key);
  const reference = run(elements, 'hysteretic-corrected', referenceDt, probe);
  if (reference.error || reference.diagnostics.unresolvedSteps) {
    // The reference is not a gold standard if states fail to settle.
    // Keep documenting its failure, and do not report misleading RMSE.
    throw new Error('Reference invalid for ' + key + ': ' + reference.error
      + ', unresolved=' + reference.diagnostics.unresolvedSteps);
  }
  for (const dt of testDts) {
    for (const mode of modes) {
      const samples = [];
      for (let repetition = 0; repetition < repetitions; repetition++) {
        samples.push(run(elements, mode, dt, probe));
      }
      const result = samples[0];
      const times = samples.map(s => s.elapsedMs).sort((a,b) => a-b);
      const d = result.diagnostics;
      const metrics = rmseAgainstReference(result.voltage, reference.voltage, dt);
      rows.push({
        circuit: key, dt_us: Math.round(dt * 1e6), mode,
        source_sampling: 'be-end', linear_solver: 'lu',
        steps: result.voltage.length,
        median_elapsed_ms: times[Math.floor(times.length / 2)].toFixed(5),
        linear_solves: d.linearSolves,
        solves_per_step: (d.linearSolves / Math.max(result.voltage.length, 1)).toFixed(6),
        matrix_rebuilds: d.matrixRebuilds,
        state_disagreements: d.stateDisagreements,
        state_corrections: d.stateCorrections,
        adaptive_tightened_steps: d.adaptiveTightenedSteps,
        unresolved_steps: d.unresolvedSteps,
        rmse_v: metrics.rmse.toPrecision(8), max_abs_error_v: metrics.maxError.toPrecision(8),
        error: JSON.stringify(result.error),
      });
    }
  }
}
const fields = Object.keys(rows[0]);
console.log(fields.join(','));
for (const row of rows) console.log(fields.map(key => row[key]).join(','));
