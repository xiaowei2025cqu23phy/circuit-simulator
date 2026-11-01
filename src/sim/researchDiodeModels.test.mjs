import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  thermalVoltage, resolveShockley, pwlCalibrationAt,
  SHOCKLEY_DEFAULTS, PWL_DEFAULTS, runStateModel, runShockleyModel,
  NGSPICE_DEFAULT_TEMPERATURE_K,
} from './researchDiodeModels.js';
import { makeParallelDiodeBank } from './researchCircuits.js';

test('thermal voltage matches the ngspice default temperature', () => {
  const vt = thermalVoltage(NGSPICE_DEFAULT_TEMPERATURE_K);
  // k*T/q at 300.15 K = 25.864925786... mV
  assert.ok(Math.abs(vt - 0.025864925786328753) < 1e-15, `vt=${vt}`);
  const p = resolveShockley();
  assert.equal(p.temperatureK, NGSPICE_DEFAULT_TEMPERATURE_K);
  assert.equal(p.vt, vt);
  // The superseded measurements used 25.852 mV, i.e. 300.0 K (mismatch).
  assert.ok(Math.abs(SHOCKLEY_DEFAULTS.temperatureK - 300.0) > 0.1);
});

test('PWL calibration passes through the reference point with the right slope', () => {
  for (const iRef of [1e-6, 1e-4, 1e-3, 1e-2]) {
    const cal = pwlCalibrationAt(iRef);
    // 1. Reference current is delivered exactly by i(v) = gOn*(v - vf).
    const iAtRef = cal.gOn * (cal.vRef - cal.vf);
    assert.ok(Math.abs(iAtRef - iRef) <= 1e-12 * Math.max(1, iRef),
      `iRef=${iRef}: got ${iAtRef}`);
    // 2. Slope equals the Shockley differential conductance at the reference.
    assert.equal(cal.checkSlope, cal.gRef);
    // 3. Intercept identity V0 = Vref - Iref/gRef.
    assert.ok(Math.abs(cal.vf - (cal.vRef - iRef / cal.gRef)) < 1e-15);
    // 4. gRef equals (Is+Iref)/(n*Vt).
    const p = resolveShockley();
    assert.ok(Math.abs(cal.gRef - (p.is + iRef) / (p.n * p.vt)) < 1e-15);
    // 5. The tangent line of a convex exponential lies BELOW the curve on both
    //    sides of the tangency point, and stays positive below the knee (the
    //    single-slope model cannot be negative).
    const vUp = cal.vRef + 0.01;
    const vDown = cal.vRef - 0.01;
    const iShockley = v => p.is * (Math.exp(v / (p.n * p.vt)) - 1);
    const line = v => cal.gOn * (v - cal.vf);
    assert.ok(line(vUp) < iShockley(vUp), 'tangent must lie below the convex curve above the knee');
    assert.ok(line(vDown) < iShockley(vDown), 'tangent must lie below the convex curve below the knee');
    assert.ok(line(vDown) > 0, 'single-slope branch cannot represent the exponential cutoff');
  }
});

test('the superseded calibration formula demonstrably gives zero reference current', () => {
  // This reproduces the defect that was found in the previous report:
  // using V0 = Vref (instead of Vref - Iref/gRef) makes i(Vref) = 0.
  const p = resolveShockley();
  const nVt = p.n * p.vt;
  const iRef = 1e-3;
  const vRef = nVt * Math.log1p(iRef / p.is);
  const gRef = (p.is + iRef) / nVt;
  const buggyCurrent = gRef * (vRef - vRef);
  assert.equal(buggyCurrent, 0);
  const corrected = pwlCalibrationAt(iRef);
  assert.ok(Math.abs(corrected.vf - vRef) > nVt * 0.9,
    'corrected intercept must differ from Vref by about n*Vt');
});

test('unilateral PWL keeps the ON current non-negative', () => {
  const elements = makeParallelDiodeBank(4, { loadProfile: 'heavy' });
  const a = runStateModel(elements, { dt: 5e-5, duration: 0.04, rule: 'hysteretic', probe: { x: 160, y: 80 } });
  const b = runStateModel(elements, { dt: 5e-5, duration: 0.04, rule: 'unidirectional', probe: { x: 160, y: 80 } });
  assert.ok(a.negativeOnSamples > 0, 'baseline model should expose reverse ON current in this fixture');
  assert.equal(b.negativeOnSamples, 0);
  assert.ok(b.minOnCurrent >= -1e-15, `unilateral min ON current ${b.minOnCurrent}`);
  assert.equal(a.unresolvedSteps, 0);
  assert.equal(b.unresolvedSteps, 0);
});

test('Shockley Newton solver converges and reports a small nonlinear residual', () => {
  const elements = [
    { id: 'v', type: 'voltage', p1: { x: 0, y: 0 }, p2: { x: 0, y: 40 },
      value: 1, offset: 1, waveType: 'AC', freq: 200 },
    { id: 'r', type: 'resistor', p1: { x: 0, y: 0 }, p2: { x: 40, y: 0 }, value: 1000 },
    { id: 'c', type: 'capacitor', p1: { x: 40, y: 0 }, p2: { x: 40, y: 40 }, value: 1e-6 },
    { id: 'd', type: 'diode', p1: { x: 40, y: 0 }, p2: { x: 40, y: 40 } },
    { id: 'w', type: 'wire', p1: { x: 40, y: 40 }, p2: { x: 0, y: 40 } },
    { id: 'g', type: 'ground', p1: { x: 0, y: 40 } },
  ];
  const run = runShockleyModel(elements, { dt: 1e-4, duration: 0.004, probe: { x: 40, y: 0 } });
  assert.equal(run.newtonFailures, 0);
  assert.ok(run.maxKcl < 1e-9, `KCL residual ${run.maxKcl}`);
  assert.ok(run.maxNewtonPerStep <= 30, `Newton iterations ${run.maxNewtonPerStep}`);
  assert.ok(run.v.every(Number.isFinite));
});
