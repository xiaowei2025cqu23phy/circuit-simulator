import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileCircuit, stepEngine } from './engine.js';
import { makeParallelDiodeBank } from './researchCircuits.js';

const options = extra => ({
  diodeSolver: 'hysteretic-corrected', sourceSampling: 'be-end', ...extra,
});

test('recordTiming is off by default and leaves diagnostics untouched', () => {
  const elements = makeParallelDiodeBank(4);
  const plain = compileCircuit(elements, 5e-5, options({ linearSolver: 'inverse' }));
  assert.equal(plain.recordTiming, false);
  assert.equal(plain.timing, null);
  for (let i = 0; i < 40; i++) stepEngine(plain);
  assert.ok(plain.diagnostics.linearSolves >= 40);
  assert.equal(plain.diagnostics.steps, 40);
});

test('recordTiming rejects non-boolean values', () => {
  assert.throws(
    () => compileCircuit(makeParallelDiodeBank(4), 5e-5, options({ recordTiming: 1 })),
    /recordTiming/,
  );
});

test('recordTiming accumulates phase timings consistent with diagnostics counters', () => {
  for (const linearSolver of ['inverse', 'lu', 'inverse-rank1']) {
    const elements = makeParallelDiodeBank(6, { loadProfile: 'heavy' });
    const engine = compileCircuit(elements, 5e-5, options({ linearSolver, recordTiming: true }));
    assert.ok(engine.timing, 'timing object must exist when enabled');
    for (let i = 0; i < 300; i++) stepEngine(engine);
    const t = engine.timing;
    const d = engine.diagnostics;
    assert.equal(t.linearSolves, d.linearSolves);
    assert.equal(t.factorizations, d.factorizations - 1,
      'initial compile counts one factorization in diagnostics; timing counts rebuilds only');
    assert.equal(t.rankOneUpdates, d.rankOneUpdates);
    for (const key of ['matrixRebuildMs', 'factorizeMs', 'rankOneUpdateMs',
      'rhsAssemblyMs', 'rhsSolveMs']) {
      assert.ok(Number.isFinite(t[key]) && t[key] >= 0, `${key} must be finite and non-negative`);
    }
    const phaseSum = t.factorizeMs + t.rankOneUpdateMs + t.rhsAssemblyMs + t.rhsSolveMs;
    assert.ok(Number.isFinite(phaseSum) && phaseSum > 0, 'phase timings must accumulate');
    if (linearSolver === 'inverse-rank1') {
      assert.ok(t.rankOneAttempts >= t.rankOneUpdates,
        'attempted updates must be at least the successful ones');
    } else {
      assert.equal(t.rankOneAttempts, 0);
      assert.equal(t.rankOneUpdates, 0);
    }
  }
});

test('recordTiming does not change the numerical result', () => {
  const elements = makeParallelDiodeBank(8, { loadProfile: 'heavy' });
  const plain = compileCircuit(elements, 5e-5, options({ linearSolver: 'inverse-rank1' }));
  const timed = compileCircuit(elements, 5e-5, options({ linearSolver: 'inverse-rank1', recordTiming: true }));
  let maxDifference = 0;
  for (let i = 0; i < 400; i++) {
    stepEngine(plain);
    stepEngine(timed);
    for (let j = 0; j < plain.previousSolution.length; j++) {
      maxDifference = Math.max(maxDifference,
        Math.abs(plain.previousSolution[j] - timed.previousSolution[j]));
    }
  }
  assert.equal(maxDifference, 0, 'instrumentation must be numerically transparent');
  assert.deepEqual(plain.switchStates, timed.switchStates);
});
