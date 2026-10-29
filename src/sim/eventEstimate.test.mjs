import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileCircuit, stepEngine, ptToStr } from './engine.js';
import { estimatePwlDiodeCrossings, stepEngineWithEstimatedDiodeEvent } from './eventEstimate.js';
import { PREDEFINED_CIRCUITS } from './circuits.js';

test('diode secant crossing: state-directed ON and OFF thresholds', () => {
  const els=[{type:'diode',id:'d',n1:0,n2:1}];
  const x0=[0.6,0], x1=[0.9,0];
  const on=estimatePwlDiodeCrossings(els,{d:false},x0,x1);
  assert.equal(on.length,1);
  assert.ok(Math.abs(on[0].fraction - 1/3)<1e-12);
  assert.equal(on[0].toOn,true);
  assert.equal(on[0].threshold,0.70);

  const off=estimatePwlDiodeCrossings(els,{d:true},[0.8,0],[0.5,0]);
  assert.equal(off.length,1);
  assert.ok(Math.abs(off[0].fraction - 0.5)<1e-12);
  assert.equal(off[0].toOn,false);
  assert.equal(off[0].threshold,0.65);

  assert.equal(estimatePwlDiodeCrossings(els,{d:true},x0,x1).length,0);
  assert.equal(estimatePwlDiodeCrossings(els,{d:false},[0.6,0],[0.65,0]).length,0);
});

test('candidate estimator sorts simultaneous events by earliest predicted crossing', () => {
  const els=[
    {type:'diode',id:'a',n1:0,n2:-1},
    {type:'diode',id:'b',n1:1,n2:-1},
  ];
  const crossing=estimatePwlDiodeCrossings(els,{a:false,b:false},[0.6,0.4],[0.8,0.8]);
  assert.deepEqual(crossing.map(x=>x.id),['a','b']);
  assert.ok(crossing[0].fraction<crossing[1].fraction);
});

test('secant estimator has explicit finite/near-edge safeguards', () => {
  const e=[{id:'d',type:'diode',n1:0,n2:-1}];
  assert.equal(estimatePwlDiodeCrossings(e,{d:false},null,[1]).length,0);
  assert.equal(estimatePwlDiodeCrossings(e,{d:false},[0.69],[0.71],{minimumFraction:0.49}).length,0);
  assert.equal(estimatePwlDiodeCrossings(e,{d:false},[NaN],[0.8]).length,0);
  assert.throws(()=>estimatePwlDiodeCrossings(e,{d:false},[0],[1],{minimumFraction:0.5}),/比例/);
  assert.throws(()=>estimatePwlDiodeCrossings(e,{d:false},[0],[1],{turnOff:0.8,turnOn:0.7}),/阈值/);
});

test('no crossing uses one accepted linear solve per normal step', () => {
  const elements=PREDEFINED_CIRCUITS.rectifier.elements;
  const eng=compileCircuit(elements,1e-5,{
    diodeSolver:'hysteretic-corrected',linearSolver:'lu',sourceSampling:'be-end',
  });
  // First step uses endpoint correction for initialization.
  stepEngineWithEstimatedDiodeEvent(eng);
  const pre=eng.diagnostics.linearSolves;
  const count=stepEngineWithEstimatedDiodeEvent(eng);
  assert.equal(count,1);
  assert.equal(eng.diagnostics.linearSolves-pre,1);
  assert.equal(eng.diagnostics.estimatedEvents,0);
});

test('rectifier secant event triggers and preserves numerical finite states', () => {
  const eng=compileCircuit(PREDEFINED_CIRCUITS.rectifier.elements,1e-5,{
    diodeSolver:'hysteretic-corrected',linearSolver:'lu',sourceSampling:'be-end',
  });
  let accepted=0;
  for(let i=0;i<4000;i++)accepted+=stepEngineWithEstimatedDiodeEvent(eng,'t1');
  const d=eng.diagnostics;
  assert.ok(d.estimatedEvents>=1);
  assert.equal(d.estimatedEvents,d.estimatedAcceptedSplits);
  assert.equal(d.estimatedTrialRejects,d.estimatedEvents);
  assert.equal(eng.history.length,accepted);
  assert.equal(eng.diagnostics.steps,accepted);
  assert.ok(eng.history.every((v,i)=>i===0 || v.t>eng.history[i-1].t));
  assert.ok(Math.abs(eng.t-0.04)<1e-9);
  assert.equal(d.unresolvedSteps,0);
  assert.ok(Number.isFinite(eng.currentNodes[ptToStr({x:320,y:260})]));
  assert.ok(d.estimatedLastFraction>0 && d.estimatedLastFraction<1);
  assert.ok(d.factorizations>d.estimatedAcceptedSplits);
});

test('freewheel known switch discontinuity forces endpoint-corrected fallback', () => {
  const eng=compileCircuit(PREDEFINED_CIRCUITS.freewheel.elements,1e-5,{
    diodeSolver:'hysteretic-corrected',linearSolver:'lu',sourceSampling:'be-end',
  });
  for(let i=0;i<1800;i++)stepEngineWithEstimatedDiodeEvent(eng);
  assert.equal(eng.diagnostics.estimatedEvents,0);
  assert.equal(eng.diagnostics.estimatedFallbacks>=2,true);
  assert.equal(eng.diagnostics.stateDisagreements,0);
  assert.equal(eng.diagnostics.unresolvedSteps,0);
  assert.ok(eng.currentNodes[ptToStr({x:360,y:260})]>-2);
});

test('incompatible solver and source-time convention are rejected', () => {
  const els=PREDEFINED_CIRCUITS.rectifier.elements;
  const base=compileCircuit(els,1e-5,{diodeSolver:'predicted',sourceSampling:'be-end'});
  assert.throws(()=>stepEngineWithEstimatedDiodeEvent(base),/仅支持/);
  const legacy=compileCircuit(els,1e-5,{diodeSolver:'hysteretic-corrected'});
  assert.throws(()=>stepEngineWithEstimatedDiodeEvent(legacy),/BE/);
  const valid=compileCircuit(els,1e-5,{diodeSolver:'hysteretic-corrected',sourceSampling:'be-end'});
  assert.throws(()=>stepEngineWithEstimatedDiodeEvent(valid,null,{minimumFraction:-0.5}),/比例/);
});
