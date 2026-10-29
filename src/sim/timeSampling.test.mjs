import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileCircuit, stepEngine, ptToStr } from './engine.js';
import { stepEngineWithDiodeRefinement } from './eventRefinement.js';
import { PREDEFINED_CIRCUITS } from './circuits.js';

function acRC() {
  const p = (x, y) => ({ x, y });
  return [
    { id:'v', type:'voltage', p1:p(0,0), p2:p(0,40), value:5, waveType:'AC', freq:1000 },
    { id:'r', type:'resistor', p1:p(0,0), p2:p(40,0), value:1000 },
    { id:'c', type:'capacitor', p1:p(40,0), p2:p(40,40), value:1e-6 },
    { id:'w', type:'wire', p1:p(40,40), p2:p(0,40) },
    { id:'g', type:'ground', p1:p(0,40) },
  ];
}

test('backward-Euler endpoint source sampling matches one-step RC companion equation', () => {
  const dt = 1e-4;
  const end = compileCircuit(acRC(), dt, { sourceSampling: 'be-end', linearSolver: 'lu' });
  const legacy = compileCircuit(acRC(), dt, { linearSolver: 'lu' });
  stepEngine(end, 'c');
  stepEngine(legacy, 'c');
  const p = ptToStr({ x:40, y:0 });
  const vin = 5*Math.sin(2*Math.PI*1000*dt);
  const expected = vin * dt/(1000*1e-6+dt);
  assert.ok(Math.abs(end.currentNodes[p]-expected) < 1e-9);
  assert.ok(Math.abs(legacy.currentNodes[p]) < 1e-12);
  assert.equal(end.lastMeasured.t, dt);
  assert.equal(legacy.lastMeasured.t, 0);
  assert.equal(legacy.sourceSampling, 'legacy-start');
});

test('sampling mode rejects invalid values and preserves original default', () => {
  assert.throws(() => compileCircuit(acRC(), 1e-5, { sourceSampling:'unknown' }), /采样/);
  const e=compileCircuit(acRC(), 1e-5);
  assert.equal(e.sourceSampling, 'legacy-start');
});

test('end-sampled PWL reference and event splitting execute for four circuits', () => {
  const cases=[
    ['rectifier', {x:320,y:260}],
    ['fullwave_rect', {x:500,y:180}],
    ['diode_clipper', {x:360,y:240}],
    ['freewheel', {x:360,y:260}],
  ];
  for (const [key, probe] of cases) {
    const eng=compileCircuit(PREDEFINED_CIRCUITS[key].elements, 1e-5, {
      diodeSolver:'hysteretic-corrected', linearSolver:'lu', sourceSampling:'be-end',
    });
    const point=ptToStr(probe);
    for(let i=0;i<1700;i++)stepEngineWithDiodeRefinement(eng);
    assert.ok(Number.isFinite(eng.currentNodes[point]));
    assert.equal(eng.diagnostics.stateDisagreements,0);
    assert.equal(eng.diagnostics.unresolvedSteps,0);
    assert.ok(Math.abs(eng.t - 0.017)<1e-11);
  }
});
