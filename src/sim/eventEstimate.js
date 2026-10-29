/**
 * Local event-time ESTIMATOR for a two-threshold PWL diode.
 *
 * Interpolates the previous accepted diode voltage and a frozen-state BE
 * trial endpoint voltage. It is only a linear-in-time SECANT estimate,
 * NOT a proved bracket or physical Shockley switching root.
 */
import { DIODE_ON_VOLTAGE, DIODE_OFF_VOLTAGE, endpointDiodeUpdates } from './statePrediction.js';
import { stepEngine } from './engine.js';
import { snapshotEngine, restoreEngine } from './eventRefinement.js';

function vdiode(el, x) {
  return (el.n1 >= 0 ? x[el.n1] : 0)
    - (el.n2 >= 0 ? x[el.n2] : 0);
}

/**
 * Crossings of the state-specific threshold on an AFFINE voltage segment.
 * A crossing of the opposite threshold is irrelevant to the current state.
 */
export function estimatePwlDiodeCrossings(validEls, startStates, startX, trialX, {
  turnOn = DIODE_ON_VOLTAGE,
  turnOff = DIODE_OFF_VOLTAGE,
  minimumFraction = 0.01,
} = {}) {
  if (!(Number.isFinite(turnOn) && Number.isFinite(turnOff) && turnOff < turnOn)) {
    throw new Error('事件阈值必须满足 turnOff < turnOn');
  }
  if (!(Number.isFinite(minimumFraction) && minimumFraction >= 0 && minimumFraction < 0.5)) {
    throw new Error('最小事件比例无效');
  }
  if (!startX || !trialX) return [];
  const crossings = [];
  for (const el of validEls) {
    if (el.type !== 'diode') continue;
    const on = Boolean(startStates[el.id]);
    const threshold = on ? turnOff : turnOn;
    const v0 = vdiode(el, startX);
    const v1 = vdiode(el, trialX);
    if (!Number.isFinite(v0) || !Number.isFinite(v1)) continue;
    const crosses = on ? (v0 >= threshold && v1 < threshold)
      : (v0 <= threshold && v1 > threshold);
    if (!crosses || v1 === v0) continue;
    const alpha = (threshold - v0) / (v1 - v0);
    if (alpha <= minimumFraction || alpha >= 1 - minimumFraction) continue;
    crossings.push({
      id: el.id,
      fraction: alpha,
      threshold,
      fromOn: on,
      toOn: !on,
      vStart: v0,
      vFrozenEnd: v1,
    });
  }
  return crossings.sort((a, b) => a.fraction - b.fraction);
}

function containsKnownDiscontinuity(eng, h) {
  const start = eng.t, end = start + h;
  const tol = h * 1e-9;
  for (const el of eng.validEls) {
    if (el.type === 'switch') {
      // A manual/unknown switch is unsupported by affine interpolation.
      if (el.control !== 'time') return true;
      for (const field of ['timeOn', 'timeOff']) {
        const value = Number(el[field]);
        if (Number.isFinite(value) && value > start + tol && value < end - tol) return true;
      }
    }
    if (el.type === 'voltage' || el.type === 'current') {
      // Only smooth sine and constant forcing are permitted in this
      // first-order secant study; known STEP, PULSE etc need breakpoints.
      if (!['DC', 'AC'].includes(el.waveType ?? 'DC')) return true;
    }
  }
  return false;
}

/**
 * OPT-IN estimated-event segment solve (matching BE-end PWL).
 *
 * Stable steps use one frozen-state solve. When the frozen-state trial crosses
 * a threshold inside the step, discard that trial, solve a pre-event substep,
 * switch the earliest estimated diode and solve the remainder with endpoint
 * correction. If no credible crossing or an unsupported discontinuity is
 * detected, fall back to the regular endpoint-corrected BE step.
 *
 * This is a heuristic algorithm; a secant crossing is not a certified event
 * bracket. The endpoint-corrected fallback is the safety baseline.
 *
 * Returns the number of ACCEPTED substeps (1 or 2).
 */
export function stepEngineWithEstimatedDiodeEvent(eng, probeId = null, {
  minimumFraction = 0.01,
} = {}) {
  if (eng.diodeSolver !== 'hysteretic-corrected') {
    throw new Error('事件估计仅支持 hysteretic-corrected 基准求解策略');
  }
  if (eng.sourceSampling !== 'be-end') {
    throw new Error('事件估计要求 BE 终点采样 sourceSampling=be-end');
  }
  if (!Number.isFinite(minimumFraction) || minimumFraction < 0 || minimumFraction >= 0.5) {
    throw new Error('事件细分边界比例必须在 0 到 0.5 之间');
  }
  const dt = eng.nominalDt ?? eng.dt;
  if (!Number.isFinite(dt) || dt <= 0) throw new Error('标称时间步长必须为正');
  const diodeElements = eng.validEls.filter(el => el.type === 'diode');
  if (!diodeElements.length) {
    stepEngine(eng, probeId);
    return 1;
  }
  const diagnosticKeys = ['estimatedTrialRejects', 'estimatedTrialSolves',
    'estimatedTrialFactorizations', 'estimatedEvents', 'estimatedFallbacks',
    'estimatedAcceptedSplits'];
  for (const key of diagnosticKeys) {
    if (!Number.isFinite(eng.diagnostics[key])) eng.diagnostics[key] = 0;
  }

  // Do not infer an interior root from t=0 state initialization.
  if (!eng.previousSolution || containsKnownDiscontinuity(eng, dt)) {
    eng.diagnostics.estimatedFallbacks++;
    if (eng.dt !== dt) { eng.dt = dt; eng.needsMatrixRebuild = true; }
    stepEngine(eng, probeId);
    return 1;
  }
  const initial = snapshotEngine(eng);
  const previousVoltages = initial.previousSolution;
  try {
    if (eng.dt !== dt) { eng.dt = dt; eng.needsMatrixRebuild = true; }
    // Trial with all prior diode states frozen (disable pre-step predictor).
    eng.diodeSolver = 'predicted';
    eng.previousSolution = null;
    stepEngine(eng, probeId);
    eng.diodeSolver = 'hysteretic-corrected';
    const trialX = eng.previousSolution.slice();

    const crossings = estimatePwlDiodeCrossings(
      diodeElements, initial.switchStates, previousVoltages, trialX,
      { minimumFraction },
    );
    const endpointViolations = endpointDiodeUpdates(
      diodeElements, initial.switchStates, trialX, 0,
    );
    if (!crossings.length) {
      if (!endpointViolations.length) return 1; // trial accepted: just one linear solve.
      // Existing violation but no interior crossing; use corrected solver.
      const rejectedSolves = eng.diagnostics.linearSolves - initial.diagnostics.linearSolves;
      const rejectedFactors = eng.diagnostics.factorizations - initial.diagnostics.factorizations;
      restoreEngine(eng, initial);
      eng.diagnostics.estimatedTrialSolves += rejectedSolves;
      eng.diagnostics.estimatedTrialFactorizations += rejectedFactors;
      eng.diagnostics.estimatedTrialRejects++;
      eng.diagnostics.estimatedFallbacks++;
      if (eng.dt !== dt) { eng.dt = dt; eng.needsMatrixRebuild = true; }
      stepEngine(eng, probeId);
      return 1;
    }

    const event = crossings[0];
    const rejectedSolves = eng.diagnostics.linearSolves - initial.diagnostics.linearSolves;
    const rejectedFactors = eng.diagnostics.factorizations - initial.diagnostics.factorizations;
    restoreEngine(eng, initial);
    eng.diagnostics.estimatedTrialSolves += rejectedSolves;
    eng.diagnostics.estimatedTrialFactorizations += rejectedFactors;
    eng.diagnostics.estimatedTrialRejects++;

    // Before the estimated transition, solve using only the OLD diode states.
    const hBefore = dt * event.fraction;
    eng.dt = hBefore;
    eng.needsMatrixRebuild = true;
    eng.diodeSolver = 'predicted';
    eng.previousSolution = null;
    stepEngine(eng, probeId);

    // At the estimated event, change only the earliest crossing diode.
    eng.switchStates[event.id] = event.toOn;
    eng.needsMatrixRebuild = true;
    eng.dt = dt - hBefore;
    // Freeze pre-prediction during the first remainder step to avoid
    // undoing the explicit event switch at the previous substep voltage.
    eng.previousSolution = null;
    eng.diodeSolver = 'hysteretic-corrected';
    stepEngine(eng, probeId);

    eng.diagnostics.estimatedEvents++;
    eng.diagnostics.estimatedAcceptedSplits++;
    eng.diagnostics.estimatedLastTime = initial.t + hBefore;
    eng.diagnostics.estimatedLastFraction = event.fraction;
    eng.diagnostics.estimatedLastDiode = event.id;
    if (eng.dt !== dt) { eng.dt = dt; eng.needsMatrixRebuild = true; }
    return 2;
  } catch (error) {
    restoreEngine(eng, initial);
    throw error;
  }
}
