/**
 * Research-only diode laws for MODEL-DIFFERENCE studies.
 *
 * Model A (reference in the papers): two-state hysteretic PWL
 *   ON : i = g_on*(v - V_F), g_on = 20 S, V_F = 0.70 V
 *   OFF: i = g_off*v,         g_off = 1e-8 S
 *   state: ON while v >= 0.65 V, OFF while v <= 0.70 V (50 mV hysteresis)
 *   -> allows a NEGATIVE ON current inside the hysteresis band.
 *
 * Model B (this round): two-state PWL with a unilateral-current rule
 *   same branches and thresholds, but an ON branch is released as soon as
 *   i_D < 0, so i_D >= 0 holds by construction. Boundary chattering is
 *   counted, not hidden.
 *
 * Model C (this round): continuous Shockley diode
 *   i = I_S*(exp(v/(n*V_T)) - 1), solved by damped Newton-Raphson.
 *   Shockley has a finite reverse saturation current -I_S, so it is NOT
 *   mathematically unilateral either; it is the conventional physical model,
 *   not a strict i>=0 constraint.
 *
 * All models share the same backward-Euler companion discretization, the same
 * independent MNA assembly and the same time grid, so their differences
 * isolate the device law rather than the linear algebra.
 *
 * This is isolated research code: the shipped engine and its default diode law
 * are untouched.
 */
import { compileCircuit, ptToStr } from './engine.js';
import { assembleLinear, solveDense, elementVoltage, maxRowResidual } from './independentMna.js';

export const PWL_DEFAULTS = Object.freeze({
  gOn: 20, gOff: 1e-8, vf: 0.7, vOn: 0.7, vOff: 0.65,
});
export const SHOCKLEY_DEFAULTS = Object.freeze({
  is: 1e-12, n: 1.8, vt: 0.025852, expLimit: 60,
});

function probeIndex(eng, point) {
  if (!point) return -1;
  const root = eng.dsu.find(ptToStr(point));
  if (root === eng.finalGroundRoot) return -2;
  return eng.nodeMap[root] ?? -1;
}

function makeTopology(elements, dt) {
  return compileCircuit(elements, dt, {
    diodeSolver: 'hysteretic-corrected', sourceSampling: 'be-end', linearSolver: 'inverse',
  });
}

function updateTimedSwitches(eng, sampleTime) {
  for (const el of eng.validEls) {
    if (el.type !== 'switch' || el.control !== 'time') continue;
    eng.switchStates[el.id] = sampleTime >= (el.timeOn ?? 0) && sampleTime < (el.timeOff ?? Infinity);
  }
}

/** Residual split of the TRUE nonlinear system A x + i_d(x) - b. */
function nonlinearResidual(A, b, x, diodeEls, diodeCurrent, nodeRows) {
  const F = new Array(A.length).fill(0);
  for (let i = 0; i < A.length; i++) {
    let ax = 0;
    for (let j = 0; j < A.length; j++) ax += A[i][j] * x[j];
    F[i] = ax - b[i];
  }
  for (const el of diodeEls) {
    const i = diodeCurrent(elementVoltage(el, x));
    if (el.n1 >= 0) F[el.n1] += i;
    if (el.n2 >= 0) F[el.n2] -= i;
  }
  let kcl = 0, kvl = 0;
  for (let i = 0; i < F.length; i++) {
    if (i < nodeRows) kcl = Math.max(kcl, Math.abs(F[i]));
    else kvl = Math.max(kvl, Math.abs(F[i]));
  }
  return { kcl, kvl };
}

/**
 * Model A or B: two-state PWL with a fixed-point state resolution per step.
 * rule: 'hysteretic' (Model A) | 'unidirectional' (Model B)
 */
export function runStateModel(elements, {
  dt = 5e-5, duration = 0.04, rule = 'hysteretic',
  params = {}, probe = null, maxStateIterations = 24,
} = {}) {
  const p = { ...PWL_DEFAULTS, ...params };
  const eng = makeTopology(elements, dt);
  const steps = Math.round(duration / dt);
  const probeIdx = probeIndex(eng, probe);
  const diodeEls = eng.validEls.filter(el => el.type === 'diode');
  const state = {};
  const on = {};
  for (const el of diodeEls) on[el.id] = false;
  const t = new Float64Array(steps);
  const v = new Float64Array(steps);
  const minOnCurrentPerStep = new Float64Array(steps);
  let solves = 0, stateIterations = 0, stateChanges = 0, unresolvedSteps = 0;
  let chatterSteps = 0, negativeOnSamples = 0, onSamples = 0;
  let minOnCurrent = Infinity;
  let maxKcl = 0, maxKvl = 0;

  for (let k = 0; k < steps; k++) {
    eng.t = k * dt;
    updateTimedSwitches(eng, eng.t + dt);
    let x = null, converged = false, iterations = 0;
    for (let iter = 0; iter < maxStateIterations; iter++) {
      const { A, b } = assembleLinear(eng, state, {
        includeDiodes: true,
        diodeConductance: el => (on[el.id] ? p.gOn : p.gOff),
        diodeCurrent: el => (on[el.id] ? p.gOn * p.vf : 0),
      });
      x = solveDense(A, b);
      solves += 1;
      iterations += 1;
      const residual = maxRowResidual(A, b, x, { nodeRows: eng.N });
      maxKcl = Math.max(maxKcl, residual.kcl);
      maxKvl = Math.max(maxKvl, residual.kvl);
      let changed = false;
      for (const el of diodeEls) {
        const vD = elementVoltage(el, x);
        const wasOn = on[el.id];
        const iD = wasOn ? p.gOn * (vD - p.vf) : p.gOff * vD;
        let nextOn = wasOn ? vD >= p.vOff : vD > p.vOn;
        if (rule === 'unidirectional' && wasOn && iD < 0) nextOn = false;
        if (nextOn !== wasOn) {
          on[el.id] = nextOn;
          changed = true;
          stateChanges += 1;
        }
      }
      if (!changed) { converged = true; break; }
    }
    stateIterations += iterations;
    if (!converged) {
      unresolvedSteps += 1;
      chatterSteps += 1;
    }
    for (const el of eng.validEls) {
      if (el.type === 'capacitor') state[el.id] = elementVoltage(el, x);
      else if (el.type === 'inductor') state[el.id] = x[eng.branchMap[el.id]];
    }
    t[k] = eng.t + dt;
    v[k] = probeIdx === -2 ? 0 : (probeIdx >= 0 ? x[probeIdx] : 0);
    minOnCurrentPerStep[k] = 0;
    for (const el of diodeEls) {
      if (!on[el.id]) continue;
      const vD = elementVoltage(el, x);
      const iD = p.gOn * (vD - p.vf);
      onSamples += 1;
      if (iD < 0) negativeOnSamples += 1;
      if (iD < minOnCurrent) minOnCurrent = iD;
      minOnCurrentPerStep[k] = Math.min(minOnCurrentPerStep[k], iD);
    }
  }

  return {
    model: rule === 'unidirectional' ? 'B_unidirectional_pwl' : 'A_hysteretic_pwl',
    t, v, minOnCurrentPerStep, finalStates: { ...on }, steps, solves,
    stateIterations, stateChanges, unresolvedSteps, chatterSteps,
    negativeOnSamples, onSamples,
    minOnCurrent: Number.isFinite(minOnCurrent) ? minOnCurrent : 0,
    maxKcl, maxKvl, size: eng.size, probeIdx,
  };
}

/**
 * Model C: continuous Shockley diode, damped Newton-Raphson per time step.
 */
export function runShockleyModel(elements, {
  dt = 5e-5, duration = 0.04, params = {}, probe = null,
  maxNewtonIterations = 50, stepTolerance = 1e-12, residualTolerance = 1e-10,
} = {}) {
  const p = { ...SHOCKLEY_DEFAULTS, ...params };
  const eng = makeTopology(elements, dt);
  const steps = Math.round(duration / dt);
  const probeIdx = probeIndex(eng, probe);
  const diodeEls = eng.validEls.filter(el => el.type === 'diode');
  const state = {};
  const t = new Float64Array(steps);
  const v = new Float64Array(steps);
  let solves = 0, newtonIterations = 0, newtonFailures = 0;
  let maxNewtonPerStep = 0;
  let maxKcl = 0, maxKvl = 0;
  let minDiodeCurrent = Infinity, negativeDiodeSamples = 0, diodeSamples = 0;
  let previousSolution = null;

  const diodeCurrent = vD => {
    const arg = Math.min(vD / (p.n * p.vt), p.expLimit);
    return p.is * (Math.exp(arg) - 1);
  };
  const diodeConductance = vD => {
    const arg = Math.min(vD / (p.n * p.vt), p.expLimit);
    return (p.is / (p.n * p.vt)) * Math.exp(arg);
  };

  for (let k = 0; k < steps; k++) {
    eng.t = k * dt;
    updateTimedSwitches(eng, eng.t + dt);
    const { A, b } = assembleLinear(eng, state);
    let x = previousSolution ? previousSolution.slice() : new Array(eng.size).fill(0);
    let converged = false;
    let iterations = 0;
    for (let iter = 0; iter < maxNewtonIterations; iter++) {
      iterations = iter + 1;
      const F = new Array(eng.size).fill(0);
      for (let i = 0; i < eng.size; i++) {
        let ax = 0;
        for (let j = 0; j < eng.size; j++) ax += A[i][j] * x[j];
        F[i] = b[i] - ax;
      }
      const J = A.map(row => row.slice());
      for (const el of diodeEls) {
        const vD = elementVoltage(el, x);
        const i = diodeCurrent(vD);
        const g = diodeConductance(vD);
        if (el.n1 >= 0) F[el.n1] -= i;
        if (el.n2 >= 0) F[el.n2] += i;
        if (el.n1 >= 0) J[el.n1][el.n1] += g;
        if (el.n2 >= 0) J[el.n2][el.n2] += g;
        if (el.n1 >= 0 && el.n2 >= 0) { J[el.n1][el.n2] -= g; J[el.n2][el.n1] -= g; }
      }
      let dx;
      try {
        dx = solveDense(J, F);
      } catch {
        break;
      }
      solves += 1;
      let maxStep = 0;
      for (let i = 0; i < eng.size; i++) maxStep = Math.max(maxStep, Math.abs(dx[i]));
      const damping = maxStep > 1 ? 1 / maxStep : 1;
      for (let i = 0; i < eng.size; i++) x[i] += damping * dx[i];
      if (maxStep < stepTolerance) {
        const residual = nonlinearResidual(A, b, x, diodeEls, diodeCurrent, eng.N);
        maxKcl = Math.max(maxKcl, residual.kcl);
        maxKvl = Math.max(maxKvl, residual.kvl);
        if (residual.kcl < residualTolerance) { converged = true; break; }
      }
    }
    newtonIterations += iterations;
    maxNewtonPerStep = Math.max(maxNewtonPerStep, iterations);
    if (!converged) newtonFailures += 1;
    previousSolution = x.slice();
    for (const el of eng.validEls) {
      if (el.type === 'capacitor') state[el.id] = elementVoltage(el, x);
      else if (el.type === 'inductor') state[el.id] = x[eng.branchMap[el.id]];
    }
    t[k] = eng.t + dt;
    v[k] = probeIdx === -2 ? 0 : (probeIdx >= 0 ? x[probeIdx] : 0);
    for (const el of diodeEls) {
      const i = diodeCurrent(elementVoltage(el, x));
      diodeSamples += 1;
      if (i < 0) negativeDiodeSamples += 1;
      if (i < minDiodeCurrent) minDiodeCurrent = i;
    }
  }

  return {
    model: 'C_shockley', t, v, finalStates: {}, steps, solves,
    newtonIterations, maxNewtonPerStep, newtonFailures,
    maxKcl, maxKvl,
    minDiodeCurrent: Number.isFinite(minDiodeCurrent) ? minDiodeCurrent : 0,
    negativeDiodeSamples, diodeSamples, size: eng.size, probeIdx,
  };
}

/** Analytic PWL DC current for Vs -> R -> diode to ground. */
export function pwlDcCurrent(vs, { rSeries = 1000, params = {} } = {}) {
  const p = { ...PWL_DEFAULTS, ...params };
  return vs.map(source => {
    const iOff = source / (rSeries + 1 / p.gOff);
    const vOff = iOff / p.gOff;
    if (vOff <= p.vf) return iOff;
    return (source - p.vf) / (rSeries + 1 / p.gOn);
  });
}

/** Analytic Shockley DC current for the same series circuit (monotone bisection). */
export function shockleyDcCurrent(vs, { rSeries = 1000, params = {} } = {}) {
  const p = { ...SHOCKLEY_DEFAULTS, ...params };
  const f = (i, source) => i * rSeries + p.n * p.vt * Math.log1p(i / p.is) - source;
  return vs.map(source => {
    let lo = 0, hi = Math.max(source / rSeries, 1e-12);
    for (let e = 0; e < 200 && f(hi, source) <= 0; e++) hi *= 2;
    for (let it = 0; it < 300; it++) {
      const mid = 0.5 * (lo + hi);
      if (f(mid, source) > 0) hi = mid; else lo = mid;
    }
    return 0.5 * (lo + hi);
  });
}
