import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileCircuit, stepEngine, ptToStr } from './engine.js';
import { PREDEFINED_CIRCUITS } from './circuits.js';
import { stepEngineWithDiodeRefinement } from './eventRefinement.js';
import { acceptedMnaResidual } from './mnaResidual.js';

const options = { diodeSolver: 'hysteretic-corrected', sourceSampling: 'be-end', linearSolver: 'lu' };

function runRefined(engine, steps) {
  for (let k = 0; k < steps; k++) stepEngineWithDiodeRefinement(engine, null, { maxHalvings: 5 });
}

test('event refinement accounts for accepted AND rejected linear work', () => {
  for (const [name, probe] of [['rectifier', { x: 320, y: 260 }], ['freewheel', { x: 360, y: 260 }]]) {
    const engine = compileCircuit(PREDEFINED_CIRCUITS[name].elements, 1e-4, options);
    runRefined(engine, 400);
    const d = engine.diagnostics;
    assert.ok(d.eventRejectedTrials > 0, `${name}: expected rolled-back trials`);
    assert.ok(d.eventRejectedSolves > 0, `${name}: rejected solves must be counted`);
    assert.ok(d.eventAcceptedSubsteps > 0, `${name}: expected subdivided accepted steps`);
    // The monotonic work counter is never rolled back, so it must equal the
    // accepted work plus every rejected trial solve.
    assert.equal(engine.work.solveCalls, d.linearSolves + d.eventRejectedSolves,
      `${name}: work.solveCalls=${engine.work.solveCalls} vs ` +
      `linearSolves=${d.linearSolves} + rejected=${d.eventRejectedSolves}`);
    assert.equal(engine.work.factorizationCalls + 1,
      d.factorizations + d.eventRejectedFactorizations,
      `${name}: factorization accounting mismatch`);
    void probe;
  }
});

test('the same accounting identity holds for deep (multi-level) refinement', () => {
  const engine = compileCircuit(PREDEFINED_CIRCUITS.freewheel.elements, 2e-3, options);
  for (let k = 0; k < 30; k++) stepEngineWithDiodeRefinement(engine, null, { maxHalvings: 6 });
  const d = engine.diagnostics;
  assert.ok(d.eventRejectedTrials > 0, 'expected rolled-back trial segments');
  assert.ok(d.eventAcceptedSubsteps > 0, 'expected subdivided accepted steps');
  assert.equal(engine.work.solveCalls, d.linearSolves + d.eventRejectedSolves);
  assert.equal(engine.work.factorizationCalls + 1,
    d.factorizations + d.eventRejectedFactorizations);
});

test('accepted-substep residual uses the real substep dt and history', () => {
  const engine = compileCircuit(PREDEFINED_CIRCUITS.rectifier.elements, 1e-4, options);
  let checked = 0;
  for (let k = 0; k < 200; k++) {
    stepEngineWithDiodeRefinement(engine, null, { maxHalvings: 5 });
    const segment = engine.lastAcceptedSegment;
    assert.ok(segment, 'refinement must expose the last accepted segment');
    // The segment must end exactly at the engine clock.
    assert.ok(Math.abs(segment.tEnd - engine.t) < 1e-15);
    if (segment.dt < 1e-4 * 0.999) {
      const residual = acceptedMnaResidual(engine, segment.historyBefore, { dt: segment.dt });
      assert.ok(residual.kclAbsolute < 1e-8,
        `substep KCL residual ${residual.kclAbsolute} at step ${k} (dt=${segment.dt})`);
      assert.ok(residual.kvlAbsolute < 1e-8);
      checked += 1;
    }
  }
  assert.ok(checked > 0, 'expected at least one subdivided substep in this fixture');
});

test('using the whole-step dt for a substep residual is detectably wrong', () => {
  const engine = compileCircuit(PREDEFINED_CIRCUITS.rectifier.elements, 1e-4, options);
  let compared = 0;
  for (let k = 0; k < 200 && compared < 3; k++) {
    stepEngineWithDiodeRefinement(engine, null, { maxHalvings: 5 });
    const segment = engine.lastAcceptedSegment;
    if (segment.dt >= 1e-4 * 0.999) continue;
    const correct = acceptedMnaResidual(engine, segment.historyBefore, { dt: segment.dt });
    const wrongDt = acceptedMnaResidual(engine, segment.historyBefore);
    // The wrong call uses the restored nominal dt; either it throws or the
    // residual differs materially. Both outcomes prove the override matters.
    let wrongValue = null;
    try { wrongValue = wrongDt.kclAbsolute; } catch { wrongValue = NaN; }
    assert.ok(!Number.isFinite(wrongValue) || Math.abs(wrongValue - correct.kclAbsolute) > 1e-12,
      'nominal-dt residual must differ from the real substep residual');
    compared += 1;
  }
  assert.ok(compared > 0);
});

test('refinement keeps the probe finite and records bracket metadata', () => {
  const engine = compileCircuit(PREDEFINED_CIRCUITS.freewheel.elements, 1e-4, options);
  for (let k = 0; k < 200; k++) stepEngineWithDiodeRefinement(engine, null, { maxHalvings: 4 });
  assert.ok(Number.isFinite(engine.currentNodes[ptToStr({ x: 360, y: 260 })]));
  assert.ok(engine.diagnostics.eventTransitionCount >= 1);
  assert.ok(Number.isFinite(engine.diagnostics.eventLastBracketWidth));
});
