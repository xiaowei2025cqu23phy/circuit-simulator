/**
 * Research-only diode transition localization by rejected trial and temporal
 * bisection. This is NOT exact event-root finding. The event time is bracketed
 * by a refined BE substep (under the existing numerical model/clock scheme).
 *
 * Only supports endpoint-corrected/adaptive/guarded diode state solvers.
 * The original main stepEngine API remains unchanged.
 */
import { stepEngine, HISTORY_MAX } from './engine.js';

const cloneDiagnostics = d => ({ ...d });
const DIODE_SOLVERS = new Set(['hysteretic-corrected', 'adaptive', 'guarded']);

function snapshotEngine(e) {
  const longHistory = e.history.length >= HISTORY_MAX ? e.history.slice() : null;
  return {
    t: e.t,
    dt: e.dt,
    state: { ...e.state },
    switchStates: { ...e.switchStates },
    currentNodes: { ...e.currentNodes },
    previousSolution: e.previousSolution?.slice() ?? null,
    needsMatrixRebuild: e.needsMatrixRebuild,
    A_inv: e.A_inv,
    luFactors: e.luFactors,
    history: e.history,
    historyLength: e.history.length,
    longHistory,
    lastMeasured: e.lastMeasured,
    eventAwareTime: e.eventAwareTime,
    diagnostics: cloneDiagnostics(e.diagnostics),
  };
}
function restoreEngine(e, s) {
  e.t = s.t;
  e.dt = s.dt;
  e.state = s.state;
  e.switchStates = s.switchStates;
  e.currentNodes = s.currentNodes;
  e.previousSolution = s.previousSolution;
  e.needsMatrixRebuild = s.needsMatrixRebuild;
  e.A_inv = s.A_inv;
  e.luFactors = s.luFactors;
  e.history = s.longHistory ?? s.history;
  if (!s.longHistory) e.history.length = s.historyLength;
  e.lastMeasured = s.lastMeasured;
  e.eventAwareTime = s.eventAwareTime;
  e.diagnostics = cloneDiagnostics(s.diagnostics);
}

/**
 * Commit one nominal step, potentially replacing any diode transition trial
 * with two half-sized BE steps. For maxHalvings=k, each transition is bracketed
 * in a substep no shorter than nominalDt/2^k.
 *
 * Diagnostic accounting:
 *   linearSolves, factorizations = committed (accepted) work
 *   eventRejectedSolves, eventRejectedFactorizations = rejected trial work
 *   eventRejectedTrials = number of rolled-back trial segments
 *   eventAcceptedSubsteps = accepted segments smaller than nominalDt
 *   eventDepthLimitHits = transitions accepted at the recursion limit
 *   eventLastBracket* = final accepted switching subinterval (not an exact root)
 *
 * Event detection is based on a CHANGE in a committed trial's diode state,
 * and therefore depends on the finite-state PWL approximation.
 *
 * @returns Number of accepted substeps replacing one nominal step.
 */
export function stepEngineWithDiodeRefinement(eng, probeId = null, {
  maxHalvings = 6,
} = {}) {
  if (!DIODE_SOLVERS.has(eng.diodeSolver)) {
    throw new Error('二极管事件细分要求 guarded、adaptive 或 hysteretic-corrected 模式');
  }
  if (!Number.isInteger(maxHalvings) || maxHalvings < 0 || maxHalvings > 16) {
    throw new Error('事件细分深度必须为 0 到 16 的整数');
  }
  const nominalDt = eng.nominalDt ?? eng.dt;
  if (!Number.isFinite(nominalDt) || nominalDt <= 0) {
    throw new Error('标称时间步长必须为正有限数');
  }
  const diodeIds = eng.validEls.filter(el => el.type === 'diode').map(el => el.id);
  const required = ['eventRejectedSolves', 'eventRejectedFactorizations',
    'eventRejectedTrials', 'eventAcceptedSubsteps', 'eventDepthLimitHits',
    'eventTransitionCount'];
  for (const key of required) {
    if (!Number.isFinite(eng.diagnostics[key])) eng.diagnostics[key] = 0;
  }
  const before = snapshotEngine(eng);
  let accepted = 0;

  function runSegment(h, depth) {
    const start = snapshotEngine(eng);
    const originalStates = diodeIds.map(id => Boolean(eng.switchStates[id]));
    const hasInitialHistory = start.previousSolution !== null;
    if (eng.dt !== h) {
      eng.dt = h;
      eng.needsMatrixRebuild = true;
    }
    try {
      stepEngine(eng, probeId);
    } catch (err) {
      restoreEngine(eng, start);
      throw err;
    }
    const switched = diodeIds.some((id, index) => Boolean(eng.switchStates[id]) !== originalStates[index]);
    // A first-step DC state initialization has no bracketed interior event.
    // Do not shrink it repeatedly just to choose its initial state.
    if (switched && hasInitialHistory && depth < maxHalvings) {
      const discardedSolves = eng.diagnostics.linearSolves - start.diagnostics.linearSolves;
      const discardedFactors = eng.diagnostics.factorizations - start.diagnostics.factorizations;
      restoreEngine(eng, start);
      eng.diagnostics.eventRejectedSolves += discardedSolves;
      eng.diagnostics.eventRejectedFactorizations += discardedFactors;
      eng.diagnostics.eventRejectedTrials += 1;
      runSegment(h / 2, depth + 1);
      runSegment(h / 2, depth + 1);
    } else {
      accepted += 1;
      if (depth > 0) eng.diagnostics.eventAcceptedSubsteps += 1;
      if (switched && hasInitialHistory) {
        eng.diagnostics.eventTransitionCount += 1;
        eng.diagnostics.eventLastBracketStart = start.t;
        eng.diagnostics.eventLastBracketEnd = eng.t;
        eng.diagnostics.eventLastBracketWidth = h;
        if (depth >= maxHalvings) eng.diagnostics.eventDepthLimitHits += 1;
      }
    }
  }

  try {
    runSegment(nominalDt, 0);
    // Restore nominal size only as a pending change; companion matrix belongs
    // to the LAST accepted substep until the next call rebuilds it.
    if (eng.dt !== nominalDt) {
      eng.dt = nominalDt;
      eng.needsMatrixRebuild = true;
    }
    return accepted;
  } catch (err) {
    restoreEngine(eng, before); // whole nominal step transaction
    throw err;
  }
}
