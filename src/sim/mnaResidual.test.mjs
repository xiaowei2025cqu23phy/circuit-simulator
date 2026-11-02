import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileCircuit, stepEngine } from './engine.js';
import { acceptedMnaResidual } from './mnaResidual.js';

const point = (x, y) => ({ x, y });
const researchOptions = (linearSolver = 'lu') => ({
  diodeSolver: 'hysteretic-corrected', linearSolver, sourceSampling: 'be-end',
});

/** 5 V ideal source feeding a 1 kΩ resistor to ground: no C, no L. */
function resistiveCircuit() {
  return [
    { id: 'v', type: 'voltage', p1: point(0, 0), p2: point(0, 40), value: 5 },
    { id: 'r', type: 'resistor', p1: point(0, 0), p2: point(40, 0), value: 1000 },
    { id: 'w1', type: 'wire', p1: point(40, 0), p2: point(40, 40) },
    { id: 'w2', type: 'wire', p1: point(40, 40), p2: point(0, 40) },
    { id: 'g', type: 'ground', p1: point(40, 40) },
  ];
}

/** RC low-pass: capacitor only (plus the source branch current unknown). */
function capacitorOnlyCircuit() {
  return [
    { id: 'v', type: 'voltage', p1: point(0, 0), p2: point(0, 40), value: 5 },
    { id: 'r', type: 'resistor', p1: point(0, 0), p2: point(40, 0), value: 1000 },
    { id: 'c', type: 'capacitor', p1: point(40, 0), p2: point(40, 40), value: 1e-6 },
    { id: 'w1', type: 'wire', p1: point(40, 40), p2: point(0, 40) },
    { id: 'g', type: 'ground', p1: point(0, 40) },
  ];
}

/** RL: inductor only (the inductor itself adds a branch-current unknown). */
function inductorOnlyCircuit() {
  return [
    { id: 'v', type: 'voltage', p1: point(0, 0), p2: point(0, 40), value: 5 },
    { id: 'l', type: 'inductor', p1: point(0, 0), p2: point(40, 0), value: 1e-3 },
    { id: 'r', type: 'resistor', p1: point(40, 0), p2: point(40, 40), value: 100 },
    { id: 'w1', type: 'wire', p1: point(40, 40), p2: point(0, 40) },
    { id: 'g', type: 'ground', p1: point(0, 40) },
  ];
}

/** Mixed RLC network: both dynamic element kinds present. */
function mixedCircuit() {
  return [
    { id: 'v', type: 'voltage', p1: point(0, 0), p2: point(0, 40), value: 5 },
    { id: 'l', type: 'inductor', p1: point(0, 0), p2: point(40, 0), value: 1e-3 },
    { id: 'r', type: 'resistor', p1: point(40, 0), p2: point(80, 0), value: 50 },
    { id: 'c', type: 'capacitor', p1: point(80, 0), p2: point(80, 40), value: 1e-6 },
    { id: 'w1', type: 'wire', p1: point(80, 40), p2: point(0, 40) },
    { id: 'g', type: 'ground', p1: point(0, 40) },
  ];
}

test('pure resistive circuit has no dynamic history and stays valid after step 2', () => {
  const engine = compileCircuit(resistiveCircuit(), 1e-4, researchOptions());
  assert.equal(engine.validEls.filter(el => ['capacitor', 'inductor'].includes(el.type)).length, 0);
  for (let step = 1; step <= 3; step++) {
    const historyBefore = { ...engine.state };
    stepEngine(engine);
    const residual = acceptedMnaResidual(engine, historyBefore);
    assert.ok(Number.isFinite(residual.absolute), `step ${step} residual must be finite`);
    assert.ok(residual.absolute < 1e-12, `step ${step} residual ${residual.absolute}`);
    assert.ok(residual.kclAbsolute < 1e-12);
    assert.ok(residual.kvlAbsolute < 1e-12);
    assert.equal(engine.diagnostics.steps, step);
  }
});

test('capacitor-only and inductor-only circuits accept first-step empty history', () => {
  for (const build of [capacitorOnlyCircuit, inductorOnlyCircuit]) {
    const engine = compileCircuit(build(), 1e-5, researchOptions());
    const first = { ...engine.state };
    assert.deepEqual(first, {}, 'initial dynamic history is empty by definition');
    stepEngine(engine);
    const firstResidual = acceptedMnaResidual(engine, first);
    assert.ok(firstResidual.absolute < 1e-9, `first step residual ${firstResidual.absolute}`);
    const second = { ...engine.state };
    assert.ok(Object.keys(second).length > 0, 'dynamic history must be captured after step 1');
    stepEngine(engine);
    const secondResidual = acceptedMnaResidual(engine, second);
    assert.ok(secondResidual.absolute < 1e-9, `second step residual ${secondResidual.absolute}`);
  }
});

test('partial, missing and non-finite dynamic history are rejected', () => {
  const engine = compileCircuit(mixedCircuit(), 1e-5, researchOptions());
  for (let i = 0; i < 3; i++) stepEngine(engine);
  const complete = { ...engine.state };
  assert.ok(Object.keys(complete).length >= 2, 'mixed network must expose both history kinds');
  const ids = Object.keys(complete);
  const partial = { [ids[0]]: complete[ids[0]] };
  assert.throws(() => acceptedMnaResidual(engine, partial), /不完整/);
  assert.throws(() => acceptedMnaResidual(engine, {}), /缺少动态元件历史状态/);
  const nonFinite = { ...complete, [ids[0]]: NaN };
  assert.throws(() => acceptedMnaResidual(engine, nonFinite), /非有限/);
  const infinite = { ...complete, [ids[ids.length - 1]]: Infinity };
  assert.throws(() => acceptedMnaResidual(engine, infinite), /非有限/);
});

test('zeroed but complete dynamic history changes the residual (not silently accepted)', () => {
  const engine = compileCircuit(mixedCircuit(), 1e-5, researchOptions());
  for (let i = 0; i < 40; i++) stepEngine(engine);
  const complete = { ...engine.state };
  stepEngine(engine);
  const correct = acceptedMnaResidual(engine, complete);
  assert.ok(correct.absolute < 1e-9);
  const zeroed = Object.fromEntries(Object.keys(complete).map(id => [id, 0]));
  const wrong = acceptedMnaResidual(engine, zeroed);
  assert.ok(wrong.absolute > 1e-6, `zeroed history must be detectable: ${wrong.absolute}`);
});

test('invalid engine state, sampling convention and step size are rejected', () => {
  const elements = capacitorOnlyCircuit();
  assert.throws(
    () => acceptedMnaResidual(compileCircuit(elements, 1e-5, {
      diodeSolver: 'hysteretic-corrected', sourceSampling: 'legacy-start',
    }), {}),
    /BE/,
  );
  const engine = compileCircuit(elements, 1e-5, researchOptions());
  stepEngine(engine);
  // First accepted step: empty history is the legitimate zero initial state.
  assert.ok(Number.isFinite(acceptedMnaResidual(engine, {}).absolute));
  stepEngine(engine);
  assert.throws(() => acceptedMnaResidual(engine, {}), /缺少动态元件历史状态/);

  const broken = compileCircuit(elements, 1e-5, researchOptions());
  stepEngine(broken);
  const saved = broken.previousSolution;
  broken.previousSolution = null;
  assert.throws(() => acceptedMnaResidual(broken, {}), /已接受解/);
  broken.previousSolution = [NaN, NaN, NaN];
  assert.throws(() => acceptedMnaResidual(broken, {}), /非有限值/);
  broken.previousSolution = saved;

  const badDt = compileCircuit(elements, 1e-5, researchOptions());
  stepEngine(badDt);
  badDt.dt = 0;
  assert.throws(() => acceptedMnaResidual(badDt, {}), /时间步长/);
});

test('KCL rows are amperes and KVL rows are volts (dimension probe)', () => {
  // Resistive divider: node row is KCL (amps), source branch row is KVL (volts).
  const engine = compileCircuit(resistiveCircuit(), 1e-4, researchOptions());
  stepEngine(engine);
  const historyBefore = { ...engine.state };
  stepEngine(engine);
  const base = acceptedMnaResidual(engine, historyBefore);
  assert.equal(base.nodeRowCount, engine.N);
  assert.equal(base.branchRowCount, engine.M);
  assert.equal(base.nodeRowCount + base.branchRowCount, engine.size);

  const conductance = 1 / 1000;      // 1 kΩ resistor
  const deltaV = 1e-6;               // perturb one node voltage by 1 µV
  const nodeIndex = 0;
  const perturbedSolution = engine.previousSolution.slice();
  perturbedSolution[nodeIndex] += deltaV;
  const saved = engine.previousSolution;
  engine.previousSolution = perturbedSolution;
  const perturbed = acceptedMnaResidual(engine, historyBefore);
  engine.previousSolution = saved;

  const kclChange = Math.abs(perturbed.kclAbsolute - base.kclAbsolute);
  const kvlChange = Math.abs(perturbed.kvlAbsolute - base.kvlAbsolute);
  // KCL row sees conductance * voltage → amperes (plus GMIN*δ).
  assert.ok(Math.abs(kclChange - (conductance + 1e-12) * deltaV) < 1e-4 * deltaV * conductance,
    `KCL change should be in amperes: ${kclChange}`);
  // KVL row is v_node - 5 V → volts, unit gain.
  assert.ok(Math.abs(kvlChange - deltaV) < 1e-12,
    `KVL change should be in volts with unit gain: ${kvlChange}`);
});
