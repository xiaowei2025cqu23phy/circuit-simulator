import { test } from 'node:test';
import assert from 'node:assert/strict';
import { factorizeLU, solveLU, matrixResidualInfinityNorm } from './linearSolve.js';
import { compileCircuit, stepEngine, ptToStr } from './engine.js';
import { PREDEFINED_CIRCUITS } from './circuits.js';

test('LU with partial pivoting handles required row exchange', () => {
  const A = [[0, 2, 1], [1, 1, 0], [2, 0, 1]];
  const b = [3, 2, 4];
  const factors = factorizeLU(A);
  assert.ok(factors, 'factorization should exist');
  const x = solveLU(factors, b);
  assert.ok(matrixResidualInfinityNorm(A, x, b) < 1e-12);
  assert.ok(factors.permutation[0] !== 0, 'first pivot should exchange rows');
});

test('LU detects singularity and rejects malformed inputs', () => {
  assert.equal(factorizeLU([[1, 2], [2, 4]]), null);
  assert.throws(() => factorizeLU([[1, 2], [3]]), /方阵/);
  assert.throws(() => factorizeLU([[1]], 0), /主元/);
  assert.throws(() => solveLU(null, [1]), /不可用/);
  assert.throws(() => solveLU(factorizeLU([[1]]), [1, 2]), /维数/);
});

test('LU reuse is equivalent to direct solve for multiple RHS', () => {
  const A = [[7, -3, 0], [2, 5, 1], [0, -4, 9]];
  const lu = factorizeLU(A);
  for (const b of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 5, 7]]) {
    const x = solveLU(lu, b);
    assert.ok(matrixResidualInfinityNorm(A, x, b) < 1e-12);
  }
});

test('LU-backed circuit agrees with inverse MNA through switching events', () => {
  const testCases = [
    ['rectifier', { x: 320, y: 260 }],
    ['fullwave_rect', { x: 500, y: 180 }],
    ['diode_clipper', { x: 360, y: 240 }],
    ['freewheel', { x: 360, y: 260 }],
  ];
  for (const [key, probe] of testCases) {
    const els = PREDEFINED_CIRCUITS[key].elements;
    for (const diodeSolver of ['iterative', 'predicted', 'guarded', 'adaptive', 'hysteretic-corrected']) {
      const inverse = compileCircuit(els, 1e-5, { linearSolver: 'inverse', diodeSolver });
      const lu = compileCircuit(els, 1e-5, { linearSolver: 'lu', diodeSolver });
      let maxDifference = 0;
      for (let k = 0; k < 2000; k++) {
        stepEngine(inverse);
        stepEngine(lu);
        const v1 = inverse.currentNodes[ptToStr(probe)];
        const v2 = lu.currentNodes[ptToStr(probe)];
        assert.ok(Number.isFinite(v1) && Number.isFinite(v2));
        maxDifference = Math.max(maxDifference, Math.abs(v1 - v2));
      }
      assert.ok(maxDifference < 1e-5, `${key}/${diodeSolver}: ΔV=${maxDifference} V`);
      assert.equal(lu.diagnostics.steps, 2000);
      assert.equal(lu.diagnostics.factorizations, lu.diagnostics.matrixRebuilds + 1);
      assert.equal(inverse.diagnostics.linearSolves, lu.diagnostics.linearSolves);
    }
  }
});

test('unknown linear solver is rejected without changing defaults', () => {
  assert.throws(
    () => compileCircuit(PREDEFINED_CIRCUITS.rectifier.elements, 1e-5, { linearSolver: 'invalid' }),
    /线性求解/,
  );
  assert.equal(compileCircuit(PREDEFINED_CIRCUITS.rectifier.elements).linearSolver, 'inverse');
});
