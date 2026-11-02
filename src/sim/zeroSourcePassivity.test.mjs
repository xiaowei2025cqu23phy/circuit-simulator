import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileCircuit, stepEngine, GMIN } from './engine.js';
import { runShockleyModel } from './researchDiodeModels.js';

/**
 * Zero-source RC–PWL circuit: one node with R, C and a two-state PWL diode to
 * ground. No independent source. These tests check the analytical identities
 * derived from the BE companion model, the passivity violation of the
 * hysteretic PWL law, and the state/cache consistency of the native engine.
 */

const C = 1e-6;
const G_ON = 20;
const V_F = 0.7;
const I_EQ = G_ON * V_F; // 14 A
const G_OFF = 1e-8;
const V_ON = 0.70;
const V_OFF = 0.65;
const R_TAU = 1000;
const NODE = { x: 40, y: 0 };
const GND = { x: 0, y: 0 };

function elements(R) {
  return [
    { id: 'r', type: 'resistor', p1: NODE, p2: GND, value: R },
    { id: 'c', type: 'capacitor', p1: NODE, p2: GND, value: C },
    { id: 'd', type: 'diode', p1: NODE, p2: GND },
    { id: 'g', type: 'ground', p1: GND },
  ];
}

function make({ R = 1000, dt = 1e-4, diodeSolver = 'hysteretic-corrected', v0 = 0.68, on = true } = {}) {
  const engine = compileCircuit(elements(R), dt, {
    diodeSolver, sourceSampling: 'be-end', linearSolver: 'lu',
  });
  engine.state.c = v0;
  engine.switchStates.d = on;
  engine.previousSolution = [v0];
  engine.needsMatrixRebuild = true;
  return engine;
}

function stepRow(engine, h, prevV, R = 1000) {
  stepEngine(engine);
  const v = engine.previousSolution[0];
  const on = Boolean(engine.switchStates.d);
  const iD = on ? G_ON * (v - V_F) : G_OFF * v;
  const dEC = 0.5 * C * (v * v - prevV * prevV);
  const eNum = 0.5 * C * (v - prevV) ** 2;
  const eR = h * v * v / R;
  const eG = h * GMIN * v * v;
  const eD = h * v * iD;
  return { v, on, iD, pD: v * iD, dEC, eNum, eR, eG, eD,
    balance: dEC + eNum + eR + eG + eD };
}

const vStar = R => I_EQ / (G_ON + 1 / R + GMIN);

test('initial ON reaches the theoretical BE steady voltage 0.699965 V', () => {
  const engine = make({ R: 1000, dt: 1e-4 });
  const first = stepRow(engine, 1e-4, 0.68);
  const closedForm = (C / 1e-4 * 0.68 + I_EQ) / (C / 1e-4 + G_ON + 1 / 1000 + GMIN);
  assert.ok(Math.abs(first.v - closedForm) < 1e-12, `${first.v} vs ${closedForm}`);
  assert.ok(Math.abs(first.v - 0.69995502473636) < 1e-9);
  let prevV = first.v;
  for (let k = 0; k < 20; k++) prevV = stepRow(engine, 1e-4, prevV).v;
  assert.ok(Math.abs(prevV - vStar(1000)) < 1e-12, `${prevV} vs ${vStar(1000)}`);
  assert.equal(engine.switchStates.d, true);
});

test('prescribed initial state and matrix cache stay consistent', () => {
  const engine = make({ R: 1000, dt: 1e-4 });
  stepRow(engine, 1e-4, 0.68);
  assert.equal(engine.factorStates.d, true, 'factorization must match the prescribed ON state');
  assert.equal(engine.diagnostics.unresolvedSteps, 0);
  assert.equal(engine.diagnostics.stateDisagreements, 0);
  assert.equal(engine.diagnostics.linearSolves, 1);
  assert.equal(engine.work.solveCalls, 1);
});

test('ON branch delivers power: negative diode power and zero-source charging', () => {
  const engine = make({ R: 1000, dt: 1e-4 });
  let prevV = 0.68;
  let totalDiode = 0, totalCap = 0, minPower = Infinity;
  for (let k = 0; k < 5; k++) {
    const row = stepRow(engine, 1e-4, prevV);
    totalDiode += row.eD;
    totalCap += row.dEC;
    minPower = Math.min(minPower, row.pD);
    prevV = row.v;
  }
  assert.ok(minPower < -6e-4, `min diode power ${minPower} W should be negative`);
  assert.ok(totalDiode < -6e-8, `net diode energy ${totalDiode} J should be delivered`);
  assert.ok(totalCap > 1e-8, `capacitor must be charged from zero source: ${totalCap} J`);
});

test('discrete energy balance closes to machine precision', () => {
  const engine = make({ R: 1000, dt: 1e-4 });
  let prevV = 0.68, maxAbs = 0, sum = 0;
  for (let k = 0; k < 5; k++) {
    const row = stepRow(engine, 1e-4, prevV);
    maxAbs = Math.max(maxAbs, Math.abs(row.balance));
    sum += row.balance;
    prevV = row.v;
  }
  assert.ok(maxAbs < 1e-18, `per-step balance ${maxAbs} J`);
  assert.ok(Math.abs(sum) < 1e-18, `cumulative balance ${sum} J`);
});

test('initial OFF at 0.68 V discharges passively without charging', () => {
  const engine = make({ v0: 0.68, on: false });
  let prevV = 0.68, minPower = Infinity, totalDiode = 0;
  for (let k = 0; k < 5; k++) {
    const row = stepRow(engine, 1e-4, prevV);
    assert.ok(row.v < prevV, 'voltage must decrease');
    assert.equal(row.on, false);
    minPower = Math.min(minPower, row.pD);
    totalDiode += row.eD;
    prevV = row.v;
  }
  assert.ok(minPower >= 0, `OFF diode must not deliver power: ${minPower}`);
  assert.ok(totalDiode >= 0);
  assert.ok(prevV < 0.66);
});

test('OFF at 0 V stays exactly at 0 V', () => {
  const engine = make({ v0: 0, on: false });
  let prevV = 0;
  for (let k = 0; k < 10; k++) {
    const row = stepRow(engine, 1e-4, prevV);
    assert.equal(row.v, 0);
    assert.equal(row.pD, 0);
    assert.equal(row.balance, 0);
    prevV = row.v;
  }
});

test('legacy iterative releases the ON branch, corrected mode does not', () => {
  const legacy = make({ diodeSolver: 'iterative' });
  const corrected = make({ diodeSolver: 'hysteretic-corrected' });
  const legacyRow = stepRow(legacy, 1e-4, 0.68);
  const correctedRow = stepRow(corrected, 1e-4, 0.68);
  assert.equal(legacy.switchStates.d, false, 'iterative must release on negative ON current');
  assert.equal(corrected.switchStates.d, true, 'hysteretic law has no current direction check');
  assert.ok(Math.abs(legacyRow.v - 0.6181812561427) < 1e-6, `${legacyRow.v}`);
  assert.ok(Math.abs(correctedRow.v - 0.6999550247364) < 1e-6);
  assert.ok(Math.abs(legacyRow.v - correctedRow.v) > 0.08);
});

test('four research state modes agree on the ON steady state', () => {
  const values = [];
  for (const mode of ['predicted', 'guarded', 'adaptive', 'hysteretic-corrected']) {
    const engine = make({ diodeSolver: mode });
    let prevV = 0.68;
    for (let k = 0; k < 5; k++) prevV = stepRow(engine, 1e-4, prevV).v;
    assert.equal(engine.switchStates.d, true, mode);
    assert.equal(engine.diagnostics.unresolvedSteps, 0, mode);
    values.push(prevV);
  }
  const spread = Math.max(...values) - Math.min(...values);
  assert.ok(spread < 1e-9, `modes disagree by ${spread} V`);
});

test('resistance scan matches the ON steady-state existence condition', () => {
  // Existing ON fixed point requires v* >= 0.65 V, i.e. R >= 0.65 ohm.
  for (const R of [0.5, 0.65, 1, 1000]) {
    const engine = make({ R, dt: 1e-6 });
    let prevV = 0.68;
    for (let k = 0; k < 2000; k++) prevV = stepRow(engine, 1e-6, prevV, R).v;
    const star = I_EQ / (G_ON + 1 / R);
    if (R === 0.5) {
      assert.equal(engine.switchStates.d, false);
      assert.ok(Math.abs(prevV) < 0.01, `R=0.5 final ${prevV}`);
    } else if (R === 0.65) {
      // exact boundary: double precision evaluates v* just below 0.65 V, and the
      // engine's GMIN term pushes the BE fixed point below the OFF threshold.
      assert.ok(Math.abs(star - V_OFF) < 1e-12, `boundary ${star}`);
      assert.equal(engine.switchStates.d, false);
    } else {
      assert.equal(engine.switchStates.d, true, `R=${R}`);
      assert.ok(Math.abs(prevV - vStar(R)) < 1e-9, `R=${R}: ${prevV} vs ${vStar(R)}`);
      assert.ok(prevV >= V_OFF);
    }
  }
});

test('BE error against the exact ON solution decreases with the step size', () => {
  const tCompare = 5e-8;
  const tau = C / (G_ON + 1 / R_TAU);
  const vStarExact = I_EQ / (G_ON + 1 / R_TAU);
  const exact = vStarExact + (0.68 - vStarExact) * Math.exp(-tCompare / tau);
  const errors = [];
  for (const h of [1e-9, 1e-8, 5e-8]) {
    const engine = make({ dt: h });
    let prevV = 0.68;
    const steps = Math.round(tCompare / h);
    for (let k = 0; k < steps; k++) prevV = stepRow(engine, h, prevV).v;
    errors.push(Math.abs(prevV - exact));
  }
  assert.ok(errors[0] < errors[1] && errors[1] < errors[2],
    `errors not decreasing: ${errors.join(', ')}`);
  // A single 100 us step cannot resolve the ~50 ns transient.
  const coarse = make({ dt: 1e-4 });
  const coarseRow = stepRow(coarse, 1e-4, 0.68);
  assert.ok(Math.abs(coarseRow.v - exact) > 1e-3,
    '100 us step must not be presented as resolving the sub-microsecond transient');
});

test('Shockley diode is passive in the same zero-source circuit', () => {
  const shockley = runShockleyModel(elements(1000), {
    dt: 1e-5, duration: 2e-3, probe: NODE, initialState: { c: 0.68 },
  });
  const shockV = shockley.v[shockley.v.length - 1];
  const legacy = make({ diodeSolver: 'iterative', dt: 1e-5 });
  let prevV = 0.68;
  for (let k = 0; k < 200; k++) prevV = stepRow(legacy, 1e-5, prevV).v;
  assert.ok(shockV < 0.2 && shockV > 0.02, `Shockley should discharge, got ${shockV}`);
  assert.ok(legacy.switchStates.d === false);
  assert.ok(Math.abs(shockV - prevV) < 1e-3,
    `legacy release should track passive diode: ${shockV} vs ${prevV}`);
  assert.equal(shockley.newtonFailures, 0);
});
