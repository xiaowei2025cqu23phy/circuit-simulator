import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileCircuit, stepEngine, ptToStr } from './engine.js';
import { makeParallelDiodeBank, makeLargeDiodeBank, makeReactiveLadder, makeLargeLadder } from './researchCircuits.js';
import { acceptedMnaResidual } from './mnaResidual.js';

const researchOptions = (linearSolver, extras={}) => ({
  diodeSolver:'hysteretic-corrected',
  linearSolver, sourceSampling:'be-end', ...extras,
});

function maxDifference(x,y){
  if(x.length!==y.length)throw Error('Solutions have different dimensions');
  return x.reduce((max,v,i)=>Math.max(max,Math.abs(v-y[i])),0);
}

test('deterministic electrical fixtures have a grounded voltage source and valid MNA sizes',()=>{
  assert.equal(compileCircuit(makeParallelDiodeBank(12),5e-5,researchOptions('lu')).size,26);
  assert.equal(compileCircuit(makeReactiveLadder(16,{kind:'rc'}),5e-5,researchOptions('lu')).size,18);
  assert.equal(compileCircuit(makeReactiveLadder(16,{kind:'rl'}),5e-5,researchOptions('lu')).size,34);
  assert.equal(compileCircuit(makeReactiveLadder(16,{kind:'rlc'}),5e-5,researchOptions('lu')).size,50);
  assert.throws(()=>makeParallelDiodeBank(1),/无效/);
  assert.throws(()=>makeParallelDiodeBank(80),/无效/);
  assert.throws(()=>makeParallelDiodeBank(4,{loadProfile:'unknown'}),/无效/);
  assert.throws(()=>makeReactiveLadder(3,{kind:'unknown'}),/无效/);
  assert.throws(()=>makeReactiveLadder(0),/无效/);
});

test('12 diode branches switch in one BE step; inverse, LU and rank-one stay equivalent',()=>{
  const els=makeParallelDiodeBank(12);
  const engines=['inverse','lu','inverse-rank1'].map(linearSolver=>
    compileCircuit(els,5e-5,researchOptions(linearSolver)));
  let last={...engines[0].switchStates};
  let simultaneous=0,maxDiff=0,maxResidual=0;
  for(let i=0;i<800;i++){
    const previous=engines.map(e=>({...e.state}));
    engines.forEach(e=>stepEngine(e));
    const changed=Object.keys(last).filter(id=>last[id]!==engines[0].switchStates[id]).length;
    simultaneous=Math.max(simultaneous,changed);
    last={...engines[0].switchStates};
    for(let k=1;k<engines.length;k++){
      maxDiff=Math.max(maxDiff,maxDifference(engines[0].previousSolution,engines[k].previousSolution));
      assert.deepEqual(engines[k].switchStates,engines[0].switchStates);
    }
    if(changed || i%37===0){
      engines.forEach((e,k)=>{
        const r=acceptedMnaResidual(e,previous[k]);
        assert.ok(Number.isFinite(r.absolute));
        maxResidual=Math.max(maxResidual,r.absolute);
      });
    }
  }
  assert.equal(simultaneous,12,'should exercise a genuinely simultaneous multi-diode stamp update');
  assert.ok(maxDiff<1e-7,'three linear backends must agree at all MNA unknowns');
  assert.ok(maxResidual<1e-8,'accepted BE MNA equation residual should stay small');
  assert.ok(engines.every(e=>e.diagnostics.unresolvedSteps===0));
  assert.ok(engines.every(e=>e.diagnostics.stateDisagreements===0));
  assert.equal(engines[2].diagnostics.factorizations,1);
  assert.ok(engines[2].diagnostics.rankOneUpdates>=12);
  assert.equal(engines[2].diagnostics.rankOneFallbacks,0);
});

test('RC / RL / RLC staged MNA networks preserve voltage AND inductor branch currents',()=>{
  for(const kind of ['rc','rl','rlc']){
    for(const stages of [2,8,16]){
      const elements=makeReactiveLadder(stages,{kind});
      const engines=['inverse','lu','inverse-rank1'].map(linearSolver=>
        compileCircuit(elements,5e-5,researchOptions(linearSolver)));
      let maxDifferenceAcrossBackends=0,maxResidual=0;
      for(let step=0;step<100;step++){
        const previous=engines.map(e=>({...e.state}));
        engines.forEach(e=>stepEngine(e));
        for(let i=1;i<3;i++){
          maxDifferenceAcrossBackends=Math.max(maxDifferenceAcrossBackends,
            maxDifference(engines[0].previousSolution,engines[i].previousSolution));
        }
        if(step%9===0){
          engines.forEach((e,j)=>{
            maxResidual=Math.max(maxResidual,acceptedMnaResidual(e,previous[j]).absolute);
          });
        }
      }
      assert.ok(maxDifferenceAcrossBackends<1e-8,
        'backend disagreement on '+kind+'/'+stages+': '+maxDifferenceAcrossBackends);
      assert.ok(maxResidual<1e-8,'large MNA residual on '+kind+'/'+stages+': '+maxResidual);
      assert.ok(engines.every(e=>e.diagnostics.unresolvedSteps===0));
      assert.ok(engines.every(e=>e.diagnostics.linearSolves===100));
      assert.ok(Number.isFinite(engines[0].currentNodes[ptToStr(elements.at(-1).p1)]));
    }
  }
});

test('limiting cumulative rank-one updates forces a full rebuild for a 12-diode joint transition',()=>{
  const elements=makeParallelDiodeBank(12);
  const reference=compileCircuit(elements,5e-5,researchOptions('inverse'));
  const capped=compileCircuit(elements,5e-5,researchOptions('inverse-rank1',
    {maxRankOneUpdates:4}));
  let biggest=0;
  for(let i=0;i<400;i++){
    stepEngine(reference);stepEngine(capped);
    biggest=Math.max(biggest,maxDifference(reference.previousSolution,capped.previousSolution));
  }
  assert.ok(biggest<1e-8);
  assert.ok(capped.diagnostics.factorizations>=2);
  assert.equal(capped.diagnostics.rankOneUpdates,0);
  assert.equal(capped.diagnostics.unresolvedSteps,0);
});

test('timed switch and multi-diode changes do not reuse an obsolete inverse cache',()=>{
  const elements=makeParallelDiodeBank(4);
  elements.push({
    id:'timed',type:'switch',p1:{x:160,y:80},p2:{x:0,y:0},
    control:'time',timeOn:0.01,timeOff:0.02,state:false,
  });
  const reference=compileCircuit(elements,5e-5,researchOptions('inverse'));
  const rank1=compileCircuit(elements,5e-5,researchOptions('inverse-rank1'));
  let diff=0;
  for(let i=0;i<800;i++){
    const old={...rank1.state};
    stepEngine(reference);stepEngine(rank1);
    diff=Math.max(diff,maxDifference(reference.previousSolution,rank1.previousSolution));
    assert.deepEqual(reference.switchStates,rank1.switchStates);
    if(i%29===0)assert.ok(acceptedMnaResidual(rank1,old).absolute<1e-8);
  }
  assert.ok(diff<1e-8);
  assert.ok(rank1.diagnostics.factorizations>=3,
    'timed switch state change must trigger full matrix inversions');
  assert.ok(rank1.diagnostics.unresolvedSteps===0);
  assert.deepEqual(rank1.factorStates,rank1.switchStates);
});

test('independent MNA residual detects missing capacitor history and rejects unsupported clock',()=>{
  const elements=makeReactiveLadder(3,{kind:'rc'});
  const e=compileCircuit(elements,5e-5,researchOptions('lu'));
  assert.throws(()=>acceptedMnaResidual(e,{}),/残量/);
  for(let i=0;i<60;i++)stepEngine(e);
  const previous={...e.state};
  stepEngine(e);
  assert.ok(acceptedMnaResidual(e,previous).absolute<1e-9);
  assert.throws(()=>acceptedMnaResidual(e,{}),/动态元件历史状态/,
    'an incomplete pre-step history must be rejected, not treated as zero');
  const zeroed=Object.fromEntries(Object.keys(previous).map(id=>[id,0]));
  assert.ok(acceptedMnaResidual(e,zeroed).absolute>1e-4,
    'zeroing the (complete) previous capacitor history MUST alter the equation residual');
  const legacy=compileCircuit(elements,5e-5,{
    diodeSolver:'hysteretic-corrected',sourceSampling:'legacy-start',
  });
  stepEngine(legacy);
  assert.throws(()=>acceptedMnaResidual(legacy,{}),/BE/);
});

test('MNA residual reports KCL ampere rows and KVL volt rows separately',()=>{
  const elements=makeReactiveLadder(6,{kind:'rlc'});
  const e=compileCircuit(elements,5e-5,researchOptions('lu'));
  for(let i=0;i<80;i++)stepEngine(e);
  const previous={...e.state};
  stepEngine(e);
  const r=acceptedMnaResidual(e,previous);
  assert.equal(r.nodeRowCount,e.N);
  assert.equal(r.branchRowCount,e.M);
  assert.equal(r.nodeRowCount+r.branchRowCount,e.size);
  assert.ok(r.branchRowCount>0,'RLC ladder must have KVL branch-current rows');
  assert.ok(Number.isFinite(r.kclAbsolute)&&Number.isFinite(r.kvlAbsolute));
  assert.ok(r.kclAbsolute<1e-9,'KCL residual should be tiny: '+r.kclAbsolute);
  assert.ok(r.kvlAbsolute<1e-9,'KVL residual should be tiny: '+r.kvlAbsolute);
  assert.ok(Number.isFinite(r.kclRelative)&&Number.isFinite(r.kvlRelative));
  assert.ok(Math.abs(r.absolute-Math.max(r.kclAbsolute,r.kvlAbsolute))<1e-30,
    'legacy mixed scalar must remain the max of the dimension-correct norms');
  // The inductor branch currents are independent unknowns, so at least one
  // KVL row actually carries a non-trivial current history.
  const currents=elements.filter(el=>el.type==='inductor')
    .map(el=>e.previousSolution[e.branchMap[el.id]]);
  assert.ok(currents.some(v=>Math.abs(v)>1e-6),
    'inductor branch currents must be part of the compared MNA unknown vector');
});

test('64/96/128-dimensional real-element fixtures solve with dimension-correct residuals',()=>{
  for(const kind of ['rc','rl']){
    for(const size of [64,96,128]){
      const elements=makeLargeLadder(size,{kind});
      const engines=['inverse','lu','inverse-rank1'].map(linearSolver=>
        compileCircuit(elements,5e-5,researchOptions(linearSolver)));
      assert.equal(engines[0].size,size,'compiled dimension for '+kind+'/'+size);
      let maxDiff=0,maxKcl=0,maxKvl=0;
      for(let step=0;step<200;step++){
        const previous=engines.map(e=>({...e.state}));
        engines.forEach(e=>stepEngine(e));
        for(let i=1;i<3;i++){
          maxDiff=Math.max(maxDiff,
            maxDifference(engines[0].previousSolution,engines[i].previousSolution));
        }
        if(step%37===0){
          engines.forEach((e,j)=>{
            const r=acceptedMnaResidual(e,previous[j]);
            maxKcl=Math.max(maxKcl,r.kclAbsolute);
            maxKvl=Math.max(maxKvl,r.kvlAbsolute);
          });
        }
      }
      assert.ok(maxDiff<1e-8,kind+'/'+size+' backend disagreement: '+maxDiff);
      assert.ok(maxKcl<1e-8,kind+'/'+size+' KCL residual: '+maxKcl);
      assert.ok(maxKvl<1e-8,kind+'/'+size+' KVL residual: '+maxKvl);
      assert.ok(engines.every(e=>e.diagnostics.unresolvedSteps===0));
      assert.ok(Number.isFinite(engines[0].currentNodes[ptToStr(elements.at(-1).p1)]));
    }
  }
  // A 128-dimensional diode bank (63 real PWL branches) exercises joint switching.
  const bank=makeLargeDiodeBank(63);
  const e=compileCircuit(bank,5e-5,researchOptions('inverse-rank1'));
  assert.equal(e.size,128);
  let joint=0;
  let previous={...e.switchStates};
  for(let step=0;step<400;step++){
    stepEngine(e);
    const changed=Object.keys(previous)
      .filter(id=>id.startsWith('diode')&&previous[id]!==e.switchStates[id]).length;
    joint=Math.max(joint,changed);
    previous={...e.switchStates};
  }
  assert.equal(joint,63,'all 63 PWL branches should switch in one nominal step');
  assert.equal(e.diagnostics.unresolvedSteps,0);
  // The default 32-update cap cannot absorb a 63-branch joint transition, so
  // the engine must rebuild instead of attempting an incomplete update chain.
  assert.equal(e.diagnostics.rankOneUpdates,0);
  assert.ok(e.diagnostics.factorizations>=2,'capped bank must rebuild the matrix');
  // With the cap raised the same transition is handled by 63 rank-one updates.
  const wide=compileCircuit(bank,5e-5,researchOptions('inverse-rank1',{maxRankOneUpdates:512}));
  let previousWide={...wide.switchStates};
  let jointWide=0;
  for(let step=0;step<400;step++){
    stepEngine(wide);
    const changed=Object.keys(previousWide)
      .filter(id=>id.startsWith('diode')&&previousWide[id]!==wide.switchStates[id]).length;
    jointWide=Math.max(jointWide,changed);
    previousWide={...wide.switchStates};
  }
  assert.equal(jointWide,63);
  assert.ok(wide.diagnostics.rankOneUpdates>=63,'raised cap should allow the joint update');
  assert.equal(wide.diagnostics.rankOneFallbacks,0);
  assert.equal(wide.diagnostics.unresolvedSteps,0);
  assert.ok(maxDifference(e.previousSolution,wide.previousSolution)<1e-8,
    'capped rebuild and wide rank-one paths must agree on the same PWL system');
});


test('heavy-load 12-diode bank repeatedly opens and closes with accurate MNA cache updates',()=>{
  const elements=makeParallelDiodeBank(12,{loadProfile:'heavy'});
  const engines=['inverse','lu','inverse-rank1'].map(linearSolver=>
    compileCircuit(elements,5e-5,researchOptions(linearSolver)));
  let previous={...engines[0].switchStates};
  let switchedOn=0,switchedOff=0,maxJoint=0,maxUnknownDiff=0,maxResidual=0;
  for(let step=0;step<800;step++){
    const histories=engines.map(e=>({...e.state}));
    engines.forEach(e=>stepEngine(e));
    let switched=0;
    for(const id of Object.keys(previous).filter(k=>k.startsWith('diode'))){
      if(previous[id]!==engines[0].switchStates[id]){
        switched++;
        if(engines[0].switchStates[id])switchedOn++;
        else switchedOff++;
      }
    }
    maxJoint=Math.max(maxJoint,switched);
    previous={...engines[0].switchStates};
    for(let i=1;i<3;i++){
      maxUnknownDiff=Math.max(maxUnknownDiff,
        maxDifference(engines[0].previousSolution,engines[i].previousSolution));
      assert.deepEqual(engines[0].switchStates,engines[i].switchStates);
    }
    if(switched || step%41===0){
      engines.forEach((e,i)=>{
        maxResidual=Math.max(maxResidual,acceptedMnaResidual(e,histories[i]).absolute);
      });
    }
  }
  assert.ok(switchedOn>=24,'two AC cycles must reopen all 12 PWL branches');
  assert.ok(switchedOff>=24,'two AC cycles must close all 12 PWL branches');
  assert.equal(maxJoint,12);
  assert.ok(maxUnknownDiff<1e-7);
  assert.ok(maxResidual<1e-8);
  assert.ok(engines.every(e=>e.diagnostics.unresolvedSteps===0));
  assert.ok(engines.every(e=>e.diagnostics.stateDisagreements===0));
  const rank=engines[2].diagnostics;
  assert.ok(rank.rankOneUpdates>=24,'updates should be reused across multiple transitions');
  assert.ok(rank.factorizations>=2,
    'maxRankOneUpdates must force occasional full inverse reconstruction');
  assert.ok(rank.factorizations<engines[0].diagnostics.factorizations);
});
