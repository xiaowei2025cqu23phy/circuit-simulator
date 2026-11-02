/**
 * Research-only INDEPENDENT MNA assembler and dense solvers.
 *
 * This module intentionally duplicates the engine's stamping rules in a small,
 * auditable form so that diode-model studies can re-solve the same circuit
 * without reusing the engine's linear-solver code. It is used by
 * researchDiodeModels.js and by the reverse-current audit script.
 *
 * Sign convention (same as engine.js):
 *   - branch current from n1 to n2 is positive;
 *   - conductances stamp +g on the diagonal and -g on the off-diagonal;
 *   - a diode ON branch injects I0 = g_on*V_F from ground into n1 and out of n2
 *     so that i = g*v - I0.
 *
 * This is still a dense O(n^3) direct solve. It is not a sparse solver.
 */
import { GMIN, getSourceValue } from './engine.js';

/** Pivoted dense Gauss-Jordan elimination with partial pivoting. */
export function solveDense(A, b) {
  const n = A.length;
  const M = A.map(row => row.slice());
  const x = b.slice();
  for (let k = 0; k < n; k++) {
    let pivot = k;
    for (let i = k + 1; i < n; i++) {
      if (Math.abs(M[i][k]) > Math.abs(M[pivot][k])) pivot = i;
    }
    if (!Number.isFinite(M[pivot][k]) || Math.abs(M[pivot][k]) < 1e-300) {
      throw new Error('独立 MNA 求解遇到奇异主元');
    }
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
    if (!Number.isFinite(out[i])) throw new Error('独立 MNA 求解产生非有限解');
  }
  return out;
}

export function maxRowResidual(A, b, x, { nodeRows = 0 } = {}) {
  let kcl = 0, kvl = 0;
  for (let i = 0; i < A.length; i++) {
    let ax = 0;
    for (let j = 0; j < A.length; j++) ax += A[i][j] * x[j];
    const r = Math.abs(ax - b[i]);
    if (i < nodeRows) kcl = Math.max(kcl, r); else kvl = Math.max(kvl, r);
  }
  return { kcl, kvl };
}

/**
 * Assemble the linear part A (conductances + source branch rows) and RHS b
 * from the pre-step dynamic history. Diode stamps are added by the caller so
 * the same assembly serves multiple diode laws.
 */
export function assembleLinear(eng, stateBefore, {
  includeDiodes = false,
  diodeConductance = () => 0,
  diodeCurrent = () => 0,
} = {}) {
  const n = eng.size;
  const A = Array.from({ length: n }, () => new Array(n).fill(0));
  const b = new Array(n).fill(0);
  const stampG = (n1, n2, g) => {
    if (n1 >= 0) A[n1][n1] += g;
    if (n2 >= 0) A[n2][n2] += g;
    if (n1 >= 0 && n2 >= 0) { A[n1][n2] -= g; A[n2][n1] -= g; }
  };
  for (const el of eng.validEls) {
    const { n1, n2, type, value, id } = el;
    if (type === 'resistor') stampG(n1, n2, 1 / (Number(value) || 1e-3));
    else if (type === 'capacitor') {
      const g = (Number(value) || 1e-6) / eng.dt;
      stampG(n1, n2, g);
      const iHist = g * (stateBefore[id] ?? 0);
      if (n1 >= 0) b[n1] += iHist;
      if (n2 >= 0) b[n2] -= iHist;
    } else if (type === 'switch') {
      stampG(n1, n2, eng.switchStates[id] ? 1 / 0.01 : 1e-8);
    } else if (type === 'voltage') {
      const bi = eng.branchMap[id];
      if (n1 >= 0) { A[n1][bi] += 1; A[bi][n1] += 1; }
      if (n2 >= 0) { A[n2][bi] -= 1; A[bi][n2] -= 1; }
      b[bi] = getSourceValue(el, eng.t + eng.dt);
    } else if (type === 'inductor') {
      const bi = eng.branchMap[id];
      if (n1 >= 0) { A[n1][bi] += 1; A[bi][n1] += 1; }
      if (n2 >= 0) { A[n2][bi] -= 1; A[bi][n2] -= 1; }
      A[bi][bi] = -(Number(value) || 1e-3) / eng.dt;
      b[bi] = -((Number(value) || 1e-3) / eng.dt) * (stateBefore[id] ?? 0);
    } else if (type === 'current') {
      const isrc = getSourceValue(el, eng.t + eng.dt);
      if (n1 >= 0) b[n1] -= isrc;
      if (n2 >= 0) b[n2] += isrc;
    } else if (type === 'diode') {
      if (includeDiodes) {
        stampG(n1, n2, diodeConductance(el));
        const i0 = diodeCurrent(el);
        if (i0 !== 0) {
          if (n1 >= 0) b[n1] += i0;
          if (n2 >= 0) b[n2] -= i0;
        }
      }
    }
  }
  for (let i = 0; i < eng.N; i++) A[i][i] += GMIN;
  return { A, b };
}

/** Voltage across an element from a solution vector, ground-aware. */
export function elementVoltage(el, x) {
  return (el.n1 >= 0 ? x[el.n1] : 0) - (el.n2 >= 0 ? x[el.n2] : 0);
}
