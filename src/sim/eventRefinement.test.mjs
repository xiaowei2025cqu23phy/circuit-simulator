import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileCircuit, stepEngine, ptToStr } from './engine.js';
import { stepEngineWithDiodeRefinement } from './eventRefinement.js';
import { PREDEFINED_CIRCUITS } from './circuits.js';

test('event-refined diode transition brackets a substep and accounts for rejected work', () => {
  const e = compileCircuit(PREDEFINED_CIRCUITS.rectifier.elements, 1e-5, {
    diodeSolver: 'hysteretic-corrected', linearSolver: 'lu',
  });
  let accepted = 0;
  for (let i = 0; i < 4000; i++) accepted += stepEngineWithDiodeRefinement(e, null, { maxHalvings: 6 });
  assert.equal(e.diagnostics.eventTransitionCount, 4);
  assert.equal(e.diagnostics.eventDepthLimitHits, 4);
  assert.ok(e.diagnostics.eventLastBracketWidth <= 1e-5 / 64 + 1e-15);
  assert.ok(e.diagnostics.eventLastBracketEnd > e.diagnostics.eventLastBracketStart);
  assert.ok(e.diagnostics.eventRejectedTrials > 0);
  assert.ok(e.diagnostics.eventRejectedSolves > 0);
  assert.equal(accepted, e.diagnostics.steps);
  assert.equal(e.diagnostics.stateDisagreements, 0);
  assert.equal(e.diagnostics.unresolvedSteps, 0);
  assert.ok(Math.abs(e.t - 0.04) < 1e-10);
  assert.equal(e.diagnostics.factorizations, e.diagnostics.matrixRebuilds + 1);
});

test('rejected trial probe samples never leak into committed history', () => {
  const e = compileCircuit(PREDEFINED_CIRCUITS.freewheel.elements, 1e-5, {
    diodeSolver: 'hysteretic-corrected', linearSolver: 'inverse',
  });
  let count = 0;
  for (let i = 0; i < 1800; i++) count += stepEngineWithDiodeRefinement(e, 't1');
  assert.ok(e.diagnostics.eventRejectedTrials >= 1);
  assert.equal(e.history.length, count);
  assert.equal(e.diagnostics.steps, count);
  assert.equal(e.diagnostics.eventTransitionCount, 1);
  assert.ok(e.history.every((v, i) => i === 0 || v.t > e.history[i - 1].t));
  assert.ok(Number.isFinite(e.lastMeasured.v));
});

test('startup transition is an initial condition, not an interior root', () => {
  const p = (x,y) => ({ x,y });
  const els = [
    { id:'v', type:'voltage',p1:p(0,0),p2:p(0,40),value:5 },
    { id:'r', type:'resistor',p1:p(0,0),p2:p(40,0),value:1000 },
    { id:'d', type:'diode',p1:p(40,0),p2:p(80,0) },
    { id:'load', type:'resistor',p1:p(80,0),p2:p(80,40),value:1000 },
    { id:'w', type:'wire',p1:p(80,40),p2:p(0,40) },
    { id:'g', type:'ground',p1:p(0,40) },
  ];
  const e = compileCircuit(els, 1e-4, { diodeSolver:'hysteretic-corrected', linearSolver:'lu' });
  const accepted = stepEngineWithDiodeRefinement(e);
  assert.equal(accepted, 1);
  assert.equal(e.diagnostics.eventRejectedTrials, 0);
  assert.equal(e.diagnostics.eventTransitionCount, 0);
  assert.equal(e.switchStates.d, true);
});

test('event depth zero reproduces ordinary corrected steps', () => {
  const elements = PREDEFINED_CIRCUITS.fullwave_rect.elements;
  const baseline = compileCircuit(elements, 5e-5, { diodeSolver:'hysteretic-corrected', linearSolver:'lu' });
  const eventMode = compileCircuit(elements, 5e-5, { diodeSolver:'hysteretic-corrected', linearSolver:'lu' });
  for (let i = 0; i < 600; i++) {
    stepEngine(baseline);
    assert.equal(stepEngineWithDiodeRefinement(eventMode, null, { maxHalvings:0 }), 1);
    const key = ptToStr({ x:500,y:180 });
    assert.ok(Math.abs(baseline.currentNodes[key] - eventMode.currentNodes[key]) < 1e-12);
  }
  assert.equal(eventMode.diagnostics.eventRejectedSolves, 0);
  assert.equal(eventMode.diagnostics.linearSolves, baseline.diagnostics.linearSolves);
});

test('incompatible mode and invalid refinement depth are rejected', () => {
  const e = compileCircuit(PREDEFINED_CIRCUITS.rectifier.elements, 1e-5, { diodeSolver: 'predicted' });
  assert.throws(() => stepEngineWithDiodeRefinement(e), /要求/);
  const corrected = compileCircuit(PREDEFINED_CIRCUITS.rectifier.elements, 1e-5,
    { diodeSolver:'hysteretic-corrected' });
  assert.throws(() => stepEngineWithDiodeRefinement(corrected, null, {maxHalvings:17}), /深度/);
  assert.throws(() => stepEngineWithDiodeRefinement(corrected, null, {maxHalvings:-1}), /深度/);
});
