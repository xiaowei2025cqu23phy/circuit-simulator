import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invertMatrix, compileCircuit, stepEngine, ptToStr } from './engine.js';
import { updateInverseForConductanceBranch } from './rankOneUpdate.js';
import { PREDEFINED_CIRCUITS } from './circuits.js';
import { stepEngineWithDiodeRefinement } from './eventRefinement.js';

test('rank-one inverse agrees with explicit inverse after passive diode stamp update', () => {
  const A=[[4,1,0],[1,3,1],[0,1,2]];
  const old=invertMatrix(A);
  const g=2.0;
  const updated=updateInverseForConductanceBranch(old,0,1,g);
  const Anew=A.map(row=>row.slice());
  Anew[0][0]+=g;Anew[1][1]+=g;Anew[0][1]-=g;Anew[1][0]-=g;
  const exact=invertMatrix(Anew);
  assert.ok(updated);
  for(let i=0;i<3;i++)for(let j=0;j<3;j++) {
    assert.ok(Math.abs(updated[i][j]-exact[i][j])<1e-12);
  }
  const grounded=updateInverseForConductanceBranch(old,2,-1,0.5);
  const Ag=A.map(row=>row.slice());Ag[2][2]+=0.5;
  const eg=invertMatrix(Ag);
  for(let i=0;i<3;i++)for(let j=0;j<3;j++) {
    assert.ok(Math.abs(grounded[i][j]-eg[i][j])<1e-12);
  }
});

test('near-singular Sherman-Morrison denominator triggers safe fallback', () => {
  const inv=[[1,0],[0,1]];
  const singularUpdate=updateInverseForConductanceBranch(inv,0,1,-0.5);
  assert.equal(singularUpdate,null);
  assert.throws(()=>updateInverseForConductanceBranch(inv,0,0,1),/端点/);
  assert.throws(()=>updateInverseForConductanceBranch(inv,0,1,Infinity),/有限/);
  assert.throws(()=>updateInverseForConductanceBranch([[1,NaN],[0,1]],0,1,2),/有限方阵/);
});

test('four circuit examples preserve output using opt-in inverse-rank1 solver', () => {
  const scenarios=[
    ['rectifier',{x:320,y:260}],
    ['fullwave_rect',{x:500,y:180}],
    ['diode_clipper',{x:360,y:240}],
    ['freewheel',{x:360,y:260}],
  ];
  for(const [key,p] of scenarios){
    const els=PREDEFINED_CIRCUITS[key].elements;
    for(const solver of ['iterative','predicted','guarded','adaptive','hysteretic-corrected']){
      const old=compileCircuit(els,1e-5,{linearSolver:'inverse',sourceSampling:'be-end',diodeSolver:solver});
      const rank=compileCircuit(els,1e-5,{linearSolver:'inverse-rank1',sourceSampling:'be-end',diodeSolver:solver});
      let max=0;
      for(let i=0;i<4000;i++){
        stepEngine(old);stepEngine(rank);
        max=Math.max(max,Math.abs(old.currentNodes[ptToStr(p)]-rank.currentNodes[ptToStr(p)]));
      }
      assert.ok(max<1e-6,`${key},${solver}: max difference=${max}`);
      assert.equal(old.diagnostics.linearSolves,rank.diagnostics.linearSolves);
      assert.ok(rank.diagnostics.factorizations<=old.diagnostics.factorizations);
      assert.equal(rank.diagnostics.rankOneUpdates+rank.diagnostics.factorizations-1,
        rank.diagnostics.matrixRebuilds,
        'every matrix change should be either a successful rank update or full inversion');
    }
  }
});

test('bridge rectifier near-singular updates are detected rather than accepted', () => {
  const e=compileCircuit(PREDEFINED_CIRCUITS.fullwave_rect.elements,1e-5,{
    diodeSolver:'hysteretic-corrected',sourceSampling:'be-end',linearSolver:'inverse-rank1',
  });
  for(let i=0;i<4000;i++)stepEngine(e);
  assert.ok(e.diagnostics.rankOneUpdates>0);
  assert.ok(e.diagnostics.rankOneFallbacks>0);
  assert.ok(e.diagnostics.factorizations>1);
});

test('inverse-rank1 plus temporal rollback preserves cache coherence', () => {
  const e=compileCircuit(PREDEFINED_CIRCUITS.rectifier.elements,1e-5,{
    diodeSolver:'hysteretic-corrected',sourceSampling:'be-end',linearSolver:'inverse-rank1',
  });
  for(let i=0;i<2000;i++)stepEngineWithDiodeRefinement(e);
  assert.ok(e.diagnostics.eventRejectedSolves>0);
  assert.ok(Number.isFinite(e.currentNodes[ptToStr({x:320,y:260})]));
  assert.equal(e.diagnostics.factorizations+e.diagnostics.rankOneUpdates-1,
    e.diagnostics.matrixRebuilds);
});
