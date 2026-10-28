import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileCircuit, stepEngine } from './engine.js';
import { predictDiodeStates, countDiodeStateDisagreements } from './statePrediction.js';

const point = (x, y) => ({ x, y });
const diodeCircuit = () => [
  { id: 'v', type: 'voltage', p1: point(0,0), p2: point(0,40), value: 5 },
  { id: 'r', type: 'resistor', p1: point(0,0), p2: point(40,0), value: 1000 },
  { id: 'd', type: 'diode', p1: point(40,0), p2: point(80,0) },
  { id: 'load', type: 'resistor', p1: point(80,0), p2: point(80,40), value: 1000 },
  { id: 'w', type: 'wire', p1: point(80,40), p2: point(0,40) },
  { id: 'g', type: 'ground', p1: point(0,40) },
];

test('迟滞预测只依赖上一时间步电压，并且保留死区内状态', () => {
  const els = [{ id: 'd', type: 'diode', n1: 0, n2: -1 }];
  const states = { d: false };
  assert.equal(predictDiodeStates(els, states, [0.72]), 1);
  assert.equal(states.d, true);
  assert.equal(predictDiodeStates(els, states, [0.68]), 0);
  assert.equal(states.d, true);
  assert.equal(predictDiodeStates(els, states, [0.64]), 1);
  assert.equal(states.d, false);
  assert.equal(countDiodeStateDisagreements(els, states, [0.75]), 1);
});

test('新模式每一步只求解一次线性方程组，默认模式保持迭代', () => {
  const predicted = compileCircuit(diodeCircuit(), 1e-5, { diodeSolver: 'predicted' });
  const iterative = compileCircuit(diodeCircuit(), 1e-5);
  for (let i = 0; i < 10; i++) {
    stepEngine(predicted, 'load');
    stepEngine(iterative, 'load');
  }
  assert.equal(predicted.diagnostics.steps, 10);
  assert.equal(predicted.diagnostics.linearSolves, 10);
  assert.equal(iterative.diagnostics.steps, 10);
  assert.ok(iterative.diagnostics.linearSolves >= 10);
  assert.ok(Number.isFinite(predicted.lastMeasured.v));
  assert.ok(Number.isFinite(iterative.lastMeasured.v));
});

test('闭合开关的测量电流使用与矩阵一致的 0.01Ω 电阻', () => {
  const els = [
    { id: 'v', type: 'voltage', p1: point(0,0), p2: point(0,40), value: 5 },
    { id: 'sw', type: 'switch', p1: point(0,0), p2: point(40,0), state: true },
    { id: 'r', type: 'resistor', p1: point(40,0), p2: point(40,40), value: 1000 },
    { id: 'w', type: 'wire', p1: point(40,40), p2: point(0,40) },
    { id: 'g', type: 'ground', p1: point(0,40) },
  ];
  const eng = compileCircuit(els);
  stepEngine(eng, 'sw');
  assert.ok(Math.abs(eng.lastMeasured.i - 5 / 1000.01) < 1e-8);
});
