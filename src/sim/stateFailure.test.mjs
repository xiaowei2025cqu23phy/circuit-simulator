import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileCircuit, stepEngine } from './engine.js';
import { PREDEFINED_CIRCUITS } from './circuits.js';
import { acceptedMnaResidual } from './mnaResidual.js';
import { stepEngineWithDiodeRefinement } from './eventRefinement.js';

const base = { sourceSampling: 'be-end', linearSolver: 'lu' };

/** Run and check that every committed step is self-consistent with its states. */
function runAndAudit(engine, steps, { expectFailures = false } = {}) {
  const baselineFailures = engine.diagnostics.stateIterationFailures;
  const baselineUnresolved = engine.diagnostics.unresolvedSteps;
  let failures = 0, maxKcl = 0, maxKvl = 0;
  for (let k = 0; k < steps; k++) {
    const historyBefore = { ...engine.state };
    stepEngine(engine);
    if (!engine.lastStepConverged) failures += 1;
    const residual = acceptedMnaResidual(engine, historyBefore);
    maxKcl = Math.max(maxKcl, residual.kclAbsolute);
    maxKvl = Math.max(maxKvl, residual.kvlAbsolute);
  }
  assert.equal(engine.diagnostics.stateIterationFailures - baselineFailures, failures,
    'failure counter must match lastStepConverged flags');
  assert.equal(engine.diagnostics.unresolvedSteps - baselineUnresolved, failures);
  if (expectFailures) assert.ok(failures > 0, 'expected at least one exhausted iteration');
  return { failures, maxKcl, maxKvl };
}

test('exhausted state iteration commits a self-consistent solution and flags the step', () => {
  for (const name of ['rectifier', 'freewheel', 'diode_clipper']) {
    const engine = compileCircuit(PREDEFINED_CIRCUITS[name].elements, 1e-4, {
      ...base, diodeSolver: 'hysteretic-corrected', maxStateIterations: 1,
    });
    const audit = runAndAudit(engine, 300, { expectFailures: true });
    assert.ok(audit.maxKcl < 1e-8,
      `${name}: KCL residual after failed steps ${audit.maxKcl}`);
    assert.ok(audit.maxKvl < 1e-8,
      `${name}: KVL residual after failed steps ${audit.maxKvl}`);
    assert.ok(engine.work.solveCalls === engine.diagnostics.linearSolves);
    assert.ok(engine.previousSolution.every(Number.isFinite));
  }
});

test('a failed step does not leave a stale matrix cache for the next step', () => {
  const engine = compileCircuit(PREDEFINED_CIRCUITS.rectifier.elements, 1e-4, {
    ...base, diodeSolver: 'hysteretic-corrected', maxStateIterations: 1,
  });
  runAndAudit(engine, 120, { expectFailures: true });
  // Continue well past the failure region and re-audit.
  const audit = runAndAudit(engine, 200);
  assert.ok(audit.maxKcl < 1e-8, `post-failure KCL ${audit.maxKcl}`);
  assert.ok(audit.maxKvl < 1e-8, `post-failure KVL ${audit.maxKvl}`);
});

test('predicted mode never exhausts the iteration cap', () => {
  const engine = compileCircuit(PREDEFINED_CIRCUITS.rectifier.elements, 1e-4, {
    ...base, diodeSolver: 'predicted', maxStateIterations: 1,
  });
  const audit = runAndAudit(engine, 200);
  assert.equal(audit.failures, 0);
  assert.equal(engine.lastStepConverged, true);
});

test('legacy iterative failure path is also self-consistent', () => {
  const engine = compileCircuit(PREDEFINED_CIRCUITS.freewheel.elements, 1e-4, {
    ...base, diodeSolver: 'iterative', maxStateIterations: 1,
  });
  const audit = runAndAudit(engine, 300);
  assert.ok(audit.failures > 0, 'legacy rule should also hit the cap in this fixture');
  assert.ok(audit.maxKcl < 1e-8);
  assert.ok(audit.maxKvl < 1e-8);
});

test('event refinement with an exhausted inner iteration keeps the accounting identity', () => {
  const engine = compileCircuit(PREDEFINED_CIRCUITS.rectifier.elements, 1e-4, {
    ...base, diodeSolver: 'hysteretic-corrected', maxStateIterations: 1,
  });
  let segmentChecks = 0;
  for (let k = 0; k < 200; k++) {
    stepEngineWithDiodeRefinement(engine, null, { maxHalvings: 4 });
    const segment = engine.lastAcceptedSegment;
    assert.ok(segment);
    const residual = acceptedMnaResidual(engine, segment.historyBefore, { dt: segment.dt });
    assert.ok(residual.kclAbsolute < 1e-8,
      `refined segment KCL residual ${residual.kclAbsolute}`);
    segmentChecks += 1;
  }
  assert.ok(segmentChecks === 200);
  const d = engine.diagnostics;
  assert.equal(engine.work.solveCalls, d.linearSolves + d.eventRejectedSolves,
    'work counter must equal accepted + rejected solves');
  assert.equal(engine.work.factorizationCalls + 1,
    d.factorizations + d.eventRejectedFactorizations);
});

test('invalid iteration caps are rejected', () => {
  for (const bad of [0, -1, 1.5, 65]) {
    assert.throws(() => compileCircuit(PREDEFINED_CIRCUITS.rectifier.elements, 1e-5, {
      ...base, diodeSolver: 'hysteretic-corrected', maxStateIterations: bad,
    }), /迭代/);
  }
  // The default remains 12 and does not change ordinary behaviour.
  const engine = compileCircuit(PREDEFINED_CIRCUITS.rectifier.elements, 1e-5, {
    ...base, diodeSolver: 'hysteretic-corrected',
  });
  assert.equal(engine.maxStateIterations, 12);
});
