/**
 * Dense LU with row partial pivoting for small MNA systems.
 *
 * P A = L U.  Row permutations are stored as the original row indices at
 * each *final* permuted row.  A factorization is reusable as long as MNA
 * topology, conductances, device PWL states, and dt are unchanged.
 *
 * This module intentionally does not claim sparse-LU complexity.
 */
export function factorizeLU(matrix, pivotTolerance = 1e-14) {
  const n = matrix.length;
  if (!Number.isFinite(pivotTolerance) || pivotTolerance <= 0) {
    throw new Error('LU 主元容差必须是正有限数');
  }
  if (n === 0) return { lu: [], permutation: [] };
  if (!matrix.every(row => Array.isArray(row) && row.length === n)) {
    throw new Error('LU 需要方阵');
  }
  const lu = matrix.map(row => row.slice());
  if (lu.some(row => row.some(value => !Number.isFinite(value)))) return null;
  const permutation = Array.from({ length: n }, (_, i) => i);

  for (let k = 0; k < n; k++) {
    let pivotRow = k;
    for (let i = k + 1; i < n; i++) {
      if (Math.abs(lu[i][k]) > Math.abs(lu[pivotRow][k])) pivotRow = i;
    }
    if (Math.abs(lu[pivotRow][k]) <= pivotTolerance) return null;
    if (pivotRow !== k) {
      [lu[k], lu[pivotRow]] = [lu[pivotRow], lu[k]];
      [permutation[k], permutation[pivotRow]] = [permutation[pivotRow], permutation[k]];
    }
    for (let i = k + 1; i < n; i++) {
      const l = lu[i][k] / lu[k][k];
      lu[i][k] = l;
      for (let j = k + 1; j < n; j++) {
        lu[i][j] -= l * lu[k][j];
      }
    }
  }
  return { lu, permutation };
}

/** Solve A x = b using a factorization from factorizeLU(A). */
export function solveLU(factors, rhs) {
  if (!factors) throw new Error('LU 分解不可用');
  const { lu, permutation } = factors;
  const n = lu.length;
  if (!Array.isArray(rhs) || rhs.length !== n) throw new Error('LU 右端向量维数错误');
  // Forward substitution: L y = P b.
  const y = new Array(n);
  for (let i = 0; i < n; i++) {
    let value = rhs[permutation[i]];
    if (!Number.isFinite(value)) throw new Error('LU 右端向量存在非法值');
    for (let j = 0; j < i; j++) value -= lu[i][j] * y[j];
    y[i] = value;
  }
  // Back substitution: U x = y.
  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let value = y[i];
    for (let j = i + 1; j < n; j++) value -= lu[i][j] * x[j];
    if (!Number.isFinite(lu[i][i]) || lu[i][i] === 0) throw new Error('LU 主元非法');
    x[i] = value / lu[i][i];
    if (!Number.isFinite(x[i])) throw new Error('LU 求解产生非有限解');
  }
  return x;
}

export function matrixResidualInfinityNorm(matrix, x, rhs) {
  let max = 0;
  for (let i = 0; i < matrix.length; i++) {
    const row = matrix[i];
    let value = -rhs[i];
    for (let j = 0; j < row.length; j++) value += row[j] * x[j];
    max = Math.max(max, Math.abs(value));
  }
  return max;
}
