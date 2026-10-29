import { test } from 'node:test';
import assert from 'node:assert/strict';
import { factorizeLU, solveLU, matrixResidualInfinityNorm } from './linearSolve.js';
import { compileCircuit, stepEngine, stepEngineAtScheduledEvents, ptToStr } from './engine.js';
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

test('scheduled ON and OFF switch times are aligned without changing default stepping', () => {
  const point = (x,y) => ({ x,y });
  const elements = [
    { id:'v', type:'voltage', p1:point(0,0), p2:point(0,40), value:5 },
    { id:'sw', type:'switch', control:'time', timeOn:0.0015, timeOff:0.0035,
      state:true, p1:point(0,0), p2:point(40,0) },
    { id:'r', type:'resistor', p1:point(40,0), p2:point(40,40), value:1000 },
    { id:'w', type:'wire', p1:point(40,40), p2:point(0,40) },
    { id:'g', type:'ground', p1:point(0,40) },
  ];
  for (const linearSolver of ['inverse','lu']) {
    const e = compileCircuit(elements, 0.001, { linearSolver });
    assert.equal(stepEngineAtScheduledEvents(e), 0.001); // t = 1ms
    assert.ok(Math.abs(stepEngineAtScheduledEvents(e) - 0.0005) < 1e-12); // t = 1.5ms
    assert.ok(Math.abs(e.t - 0.0015) < 1e-12);
    assert.equal(e.diagnostics.alignedTimeEvents, 1);
    stepEngineAtScheduledEvents(e); // begins at ON event
    assert.equal(e.switchStates.sw, true);
    stepEngineAtScheduledEvents(e); // ends at 3.5ms, OFF event
    assert.ok(Math.abs(e.t - 0.0035) < 1e-12);
    stepEngineAtScheduledEvents(e); // begins at OFF event
    assert.equal(e.switchStates.sw, false);
    assert.equal(e.diagnostics.factorizations, e.diagnostics.matrixRebuilds + 1);
    assert.ok(Number.isFinite(e.currentNodes[ptToStr(point(40,0))]));
  }
});

test('known timed event is reached by an isolated short BE step in freewheel circuit', () => {
  const e = compileCircuit(PREDEFINED_CIRCUITS.freewheel.elements, 0.004,
    { diodeSolver: 'hysteretic-corrected', linearSolver: 'lu' });
  for (let i=0; i<4; i++) stepEngineAtScheduledEvents(e);
  assert.ok(Math.abs(e.t - 0.015) < 1e-12);
  assert.equal(e.diagnostics.alignedTimeEvents, 1);
  stepEngineAtScheduledEvents(e);
  assert.equal(e.switchStates.sw1, false);
  assert.ok(Number.isFinite(e.currentNodes[ptToStr({ x:360,y:260 })]));
});

test('scheduled-event wrapper is not a diode threshold event locator', () => {
  const e = compileCircuit(PREDEFINED_CIRCUITS.diode_clipper.elements, 1e-5,
    { diodeSolver:'predicted',linearSolver:'lu' });
  for (let k = 0; k < 50; k++) {
    assert.equal(stepEngineAtScheduledEvents(e), 1e-5);
  }
  assert.equal(e.diagnostics.alignedTimeEvents, 0);
});
