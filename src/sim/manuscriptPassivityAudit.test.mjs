import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileCircuit, stepEngine, GMIN } from './engine.js';
import { acceptedMnaResidual } from './mnaResidual.js';

/**
 * Submission-facing regression tests for the educational HSP–MNA examples.
 *
 * These are NOT measurements of a physical diode. In particular, the
 * hysteretic PWL law may supply power even if the algebraic KCL residual
 * and endpoint state rule are both satisfied.
 *
 * Fixed study version: 0.70/0.65 V hysteresis, gON=20 S, gOFF=1e-8 S.
 * Every residual is reconstructed with the pre-step capacitor history.
 */
const C = 1e-6;
const VF = 0.70;
const GON = 20;
const GOFF = 1e-8;
const NODE = { x: 40, y: 0 };
const GROUND = { x: 0, y: 0 };

function make({ R = 1000, h = 1e-4, v0 = 0.68,
  on = true, mode = 'hysteretic-corrected' } = {}) {
  const elements = [
    { id: 'r', type: 'resistor', p1: NODE, p2: GROUND, value: R },
    { id: 'c', type: 'capacitor', p1: NODE, p2: GROUND, value: C },
    { id: 'd', type: 'diode', p1: NODE, p2: GROUND },
    { id: 'g', type: 'ground', p1: GROUND },
  ];
  const e = compileCircuit(elements, h, {
    diodeSolver: mode, linearSolver: 'lu', sourceSampling: 'be-end',
  });
  e.state.c = v0;
  e.switchStates.d = on;
  e.previousSolution = [v0];
  // The initial factorisation belongs to the default OFF state.
  e.needsMatrixRebuild = true;
  return e;
}

function acceptedStep(e, enteringVoltage) {
  const history = { ...e.state };
  assert.equal(history.c, enteringVoltage);
  stepEngine(e);
  const residual = acceptedMnaResidual(e, history);
  return { v: e.previousSolution[0], on: e.switchStates.d, residual };
}

test('reconstructed KCL residual: initially ON and OFF are distinct valid histories', () => {
  const h = 1e-4;
  for (const on of [true, false]) {
    const e = make({ on, h });
    const { v, on: nextOn, residual } = acceptedStep(e, 0.68);
    const gD = on ? GON : GOFF;
    const affine = on ? GON * VF : 0;
    const expected = (C / h * 0.68 + affine) /
      (C / h + 1 / 1000 + gD + GMIN);
    assert.ok(Math.abs(v - expected) < 1e-12, `v=${v}; expected=${expected}`);
    assert.equal(nextOn, on);
    assert.equal(e.lastStepConverged, true);
    assert.equal(e.diagnostics.stateDisagreements, 0);
    assert.equal(residual.nodeRowCount, 1);
    assert.equal(residual.branchRowCount, 0, 'KVL not applicable without branch rows');
    assert.ok(residual.kclAbsolute < 1e-12,
      `reconstructed KCL residual ${residual.kclAbsolute} A`);
    // This expression is algebraically linked to KCL; it is not
    // an independent statistical validation of the linear solve.
    const iD = gD * v - affine;
    const kcl = C / h * (v - 0.68) + v / 1000 + GMIN * v + iD;
    const deltaE = C * (v * v - 0.68 * 0.68) / 2;
    const beLoss = C * (v - 0.68) ** 2 / 2;
    const energyBalance = deltaE + beLoss +
      h * (v * v / 1000 + GMIN * v * v + v * iD);
    assert.ok(Math.abs(kcl) < 1e-12);
    assert.ok(Math.abs(energyBalance) < 1e-18);
    assert.ok(Math.abs(energyBalance - h * v * kcl) < 1e-18);
  }
});

test('OFF continuous-time reference includes diode leakage and GMIN', () => {
  const R = 1000, h = 1e-5, v0 = 0.68;
  const e = make({ R, h, v0, on: false });
  const { v, on } = acceptedStep(e, v0);
  const conductance = 1 / R + GOFF + GMIN;
  const beExact = v0 / (1 + h * conductance / C);
  const continuousExact = v0 * Math.exp(-h * conductance / C);
  assert.equal(on, false);
  assert.ok(Math.abs(v - beExact) < 1e-12);
  assert.ok(v > continuousExact, 'BE is not the exact continuous solution');
  assert.ok(v - continuousExact < 4e-5);
});

test('negative branch power need not imply rising capacitor energy', () => {
  const e = make({ R: 1, h: 1e-6, on: true, v0: 0.68 });
  const { v, on, residual } = acceptedStep(e, 0.68);
  const iD = GON * (v - VF);
  assert.equal(on, true);
  assert.ok(v > 0.65 && v < 0.68);
  assert.ok(v * iD < 0, 'PWL branch supplies power');
  assert.ok(C * (v * v - 0.68 ** 2) / 2 < 0,
    'capacitor discharges despite negative branch power');
  assert.ok(residual.kclAbsolute < 1e-11);
});

test('legacy negative-current tolerance is not a global passivity guarantee', () => {
  const R = 1e6, h = 1e-5;
  const vStar = GON * VF / (GON + 1 / R + GMIN);
  const e = make({ R, h, v0: vStar, on: true, mode: 'iterative' });
  const { v, on, residual } = acceptedStep(e, vStar);
  const iD = GON * (v - VF);
  assert.equal(on, true, 'legacy should retain this very small reverse current');
  assert.ok(iD < 0 && iD > -1e-6,
    `the negative-current release threshold is -1 µA, got ${iD} A`);
  assert.ok(v * iD < 0, 'the ON model remains non-passive');
  assert.ok(residual.kclAbsolute < 1e-11);
  assert.equal(e.lastStepConverged, true);
});
