/**
 * Independent audit of the reverse ON-state current in the hysteretic PWL diode.
 *
 * Claim under test: with i_D = g_on*(v_D - 0.70), g_on = 1/0.05,
 * and an ON->OFF threshold of 0.65 V, an ON branch may carry negative current
 * down to (0.65-0.70)/0.05 = -1 A while stateDisagreements stays zero.
 *
 * This script does not accept the engine's own diagnostics as the verdict:
 *   1. it reads the accepted MNA unknown vector and the accepted PWL states,
 *   2. it re-assembles the SAME backward-Euler system with an INDEPENDENT
 *      stamping routine and solves it with an INDEPENDENT pivoted
 *      Gauss-Jordan elimination written below,
 *   3. it compares that independent solution with the engine solution and
 *      reports the independent residual.
 * If both agree, the negative ON current is a property of the declared PWL
 * model, not a linear-solver or sign-convention bug in the shipped code.
 *
 * This is a model-consistency audit, NOT a Shockley/ngspice/physical result.
 *
 * node scripts/verify-pwl-reverse-current.mjs
 */
import { compileCircuit, stepEngine, getSourceValue, GMIN } from '../src/sim/engine.js';
import { makeParallelDiodeBank } from '../src/sim/researchCircuits.js';

const G_ON = 1 / 0.05;          // 20 S, matches the engine stamp
const V_F = 0.7;                // PWL forward offset, matches the engine
const I_EQ = V_F * G_ON;        // 14 A, matches the engine RHS
const G_OFF = 1e-8;
const G_SWITCH_ON = 1 / 0.01;

const fields = [
  'load_profile', 'diodes', 'nominal_steps', 'on_state_samples',
  'negative_on_state_samples', 'min_on_state_current_a', 'min_on_step',
  'min_on_vd_v', 'pwl_negative_current_vd_window_v',
  'independent_resolve_max_abs_diff', 'independent_max_row_residual_mixed',
  'engine_min_on_state_current_a', 'engine_matches_independent',
  'state_disagreements', 'unresolved_steps',
];

/** Independent dense solve with partial pivoting; no engine linear code used. */
function independentSolve(A, b) {
  const n = A.length;
  const M = A.map(row => row.slice());
  const x = b.slice();
  for (let k = 0; k < n; k++) {
    let pivot = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(M[i][k]) > Math.abs(M[pivot][k])) pivot = i;
    if (Math.abs(M[pivot][k]) < 1e-300) throw new Error('independent solve: singular pivot');
    if (pivot !== k) {
      [M[k], M[pivot]] = [M[pivot], M[k]];
      [x[k], x[pivot]] = [x[pivot], x[k]];
    }
    for (let i = k + 1; i < n; i++) {
      const f = M[i][k] / M[k][k];
      if (f === 0) continue;
      for (let j = k; j < n; j++) M[i][j] -= f * M[k][j];
      x[i] -= f * x[k];
    }
  }
  const out = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = x[i];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * out[j];
    out[i] = s / M[i][i];
  }
  return out;
}

/**
 * Independent MNA assembly from the element list. Only topology metadata that
 * the engine exposes (node indices, branch map, size) is reused; every
 * numerical stamp is re-derived here from the documented BE rules.
 */
function independentAssemble(eng, stateBefore) {
  const n = eng.size;
  const A = Array.from({ length: n }, () => new Array(n).fill(0));
  const b = new Array(n).fill(0);
  const on = eng.switchStates;
  for (const el of eng.validEls) {
    const { n1, n2, type, value, id } = el;
    const stampG = g => {
      if (n1 >= 0) A[n1][n1] += g;
      if (n2 >= 0) A[n2][n2] += g;
      if (n1 >= 0 && n2 >= 0) { A[n1][n2] -= g; A[n2][n1] -= g; }
    };
    if (type === 'resistor') stampG(1 / (Number(value) || 1e-3));
    else if (type === 'capacitor') {
      const g = (Number(value) || 1e-6) / eng.dt;
      stampG(g);
      const iHist = g * (stateBefore[id] ?? 0);
      if (n1 >= 0) b[n1] += iHist;
      if (n2 >= 0) b[n2] -= iHist;
    } else if (type === 'diode') {
      stampG(on[id] ? G_ON : G_OFF);
      if (on[id]) {
        if (n1 >= 0) b[n1] += I_EQ;
        if (n2 >= 0) b[n2] -= I_EQ;
      }
    } else if (type === 'switch') {
      stampG(on[id] ? G_SWITCH_ON : G_OFF);
    } else if (type === 'voltage') {
      const bi = eng.branchMap[id];
      if (n1 >= 0) { A[n1][bi] += 1; A[bi][n1] += 1; }
      if (n2 >= 0) { A[n2][bi] -= 1; A[bi][n2] -= 1; }
      b[bi] = getSourceValue(el, eng.t);
    } else if (type === 'inductor') {
      const bi = eng.branchMap[id];
      if (n1 >= 0) { A[n1][bi] += 1; A[bi][n1] += 1; }
      if (n2 >= 0) { A[n2][bi] -= 1; A[bi][n2] -= 1; }
      A[bi][bi] = -(Number(value) || 1e-3) / eng.dt;
      b[bi] = -((Number(value) || 1e-3) / eng.dt) * (stateBefore[id] ?? 0);
    } else if (type === 'current') {
      const src = getSourceValue(el, eng.t);
      if (n1 >= 0) b[n1] -= src;
      if (n2 >= 0) b[n2] += src;
    }
  }
  for (let i = 0; i < eng.N; i++) A[i][i] += GMIN;
  return { A, b };
}

function maxRowResidual(A, b, x) {
  let mixed = 0;
  for (let i = 0; i < A.length; i++) {
    let ax = 0;
    for (let j = 0; j < A.length; j++) ax += A[i][j] * x[j];
    mixed = Math.max(mixed, Math.abs(ax - b[i]));
  }
  return mixed;
}

console.log(fields.join(','));
for (const loadProfile of ['light', 'heavy']) {
  const elements = makeParallelDiodeBank(4, { loadProfile });
  const eng = compileCircuit(elements, 5e-5, {
    diodeSolver: 'hysteretic-corrected', sourceSampling: 'be-end', linearSolver: 'lu',
  });
  const steps = 800;
  let onSamples = 0, negative = 0;
  let minI = Infinity, minStep = -1, minVd = NaN;
  let worst = null;
  let engineMinI = Infinity;
  for (let step = 0; step < steps; step++) {
    const before = { ...eng.state };
    stepEngine(eng);
    for (const el of eng.validEls) {
      if (el.type !== 'diode' || !eng.switchStates[el.id]) continue;
      const vD = (el.n1 >= 0 ? eng.previousSolution[el.n1] : 0)
        - (el.n2 >= 0 ? eng.previousSolution[el.n2] : 0);
      const iD = G_ON * (vD - V_F);
      engineMinI = Math.min(engineMinI, iD);
      onSamples += 1;
      if (iD < -1e-5) negative += 1;
      if (iD < minI) {
        minI = iD; minStep = step; minVd = vD;
        worst = {
          before,
          solution: eng.previousSolution.slice(),
          switchStates: { ...eng.switchStates },
          t: eng.t,
        };
      }
    }
  }

  // Rebuild the accepted step independently and re-solve from scratch.
  const probe = compileCircuit(elements, 5e-5, {
    diodeSolver: 'hysteretic-corrected', sourceSampling: 'be-end', linearSolver: 'lu',
  });
  // Recreate the engine's exact accepted context at the worst step by replaying
  // the transient up to that step (deterministic, so this is exact).
  for (let step = 0; step <= minStep; step++) stepEngine(probe);
  const replayDiff = Math.max(...probe.previousSolution.map(
    (v, i) => Math.abs(v - worst.solution[i])));
  const { A, b } = independentAssemble(probe, worst.before);
  const x = independentSolve(A, b);
  const diff = Math.max(...x.map((v, i) => Math.abs(v - worst.solution[i])));
  const independentResidual = maxRowResidual(A, b, x);

  console.log([
    loadProfile, 4, steps, onSamples, negative,
    minI.toPrecision(12), minStep, minVd.toPrecision(12),
    '0.65..0.70',
    diff.toExponential(6), independentResidual.toExponential(6),
    engineMinI.toPrecision(12), diff < 1e-9,
    eng.diagnostics.stateDisagreements, eng.diagnostics.unresolvedSteps,
  ].join(','));
  if (!(replayDiff < 1e-12)) throw new Error('deterministic replay mismatch: ' + replayDiff);
}
