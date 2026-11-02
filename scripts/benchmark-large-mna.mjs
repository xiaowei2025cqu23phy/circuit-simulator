/**
 * Native Node benchmark for LARGER real-element MNA transients (64/96/128/256).
 *
 * Every case is assembled by compileCircuit from actual resistors,
 * capacitors, inductors, PWL diodes and one independent voltage source.
 * No random dense matrix is injected; the MNA dimension follows from the
 * element count and the ideal voltage-source branch current.
 *
 * This is a dense-array core benchmark. It is NOT a sparse industrial MNA
 * benchmark, a UI/browser timing claim, or a physical SPICE comparison.
 *
 * node scripts/benchmark-large-mna.mjs --sizes=64,96,128,256 --repetitions=3
 */
import { performance } from 'node:perf_hooks';
import os from 'node:os';
import { compileCircuit, stepEngine, ptToStr } from '../src/sim/engine.js';
import { makeLargeDiodeBank, makeLargeLadder } from '../src/sim/researchCircuits.js';
import { acceptedMnaResidual } from '../src/sim/mnaResidual.js';

const args=Object.fromEntries(process.argv.slice(2).filter(x=>x.startsWith('--')).map(x=>x.slice(2).split('=')));
const repetitions=Number(args.repetitions ?? 3);
const dt=Number(args.dt ?? 5e-5);
const duration=Number(args.duration ?? .04);
const sizes=(args.sizes ?? '64,96,128,256').split(',').map(Number);
if(!sizes.every(n=>Number.isInteger(n)&&n>=8&&n<=512))throw Error('Invalid MNA sizes');
if(!Number.isInteger(repetitions)||repetitions<2||repetitions>20)throw Error('Invalid repetitions');
if(!Number.isFinite(dt)||dt<=0||dt>.01)throw Error('Invalid dt');
if(!Number.isFinite(duration)||duration<=0||duration>.2)throw Error('Invalid duration');
const steps=Math.round(duration/dt);
if(steps<2||steps>20000)throw Error('Invalid step count');
const solvers=['inverse','lu','inverse-rank1'];
const cpus=os.cpus();
const cpu=(cpus[0]?.model ?? 'unknown').replaceAll(',', ';');

function ladderFor(size,kind){
  const divisor={rc:1,rl:2,rlc:3}[kind];
  if((size-2)%divisor!==0)return null;
  try{return makeLargeLadder(size,{kind});}catch{return null;}
}
const scenarios=[];
for(const size of sizes){
  for(const kind of ['rc','rl','rlc']){
    const elements=ladderFor(size,kind);
    if(elements)scenarios.push({name:kind+'-ladder-'+size,topology:kind+'-ladder',size,elements});
  }
  const diodeCount=(size-2)/2;
  if(Number.isInteger(diodeCount)&&diodeCount>=2){
    for(const loadProfile of ['light','heavy']){
      scenarios.push({
        name:'diode-bank-'+loadProfile+'-'+size,
        topology:'parallel-diode-bank-'+loadProfile,size,
        elements:makeLargeDiodeBank(diodeCount,{loadProfile}),
      });
    }
  }
}

const fields=[
  'circuit','topology','target_size','mna_dimension','element_count',
  'diode_count','capacitor_count','inductor_count','independent_source_count',
  'steps','repetitions','linear_solver','diode_solver','source_sampling',
  'median_compile_ms','median_transient_ms','q1_transient_ms','q3_transient_ms',
  'linear_solves','full_factorizations','rank_one_updates','rank_one_fallbacks',
  'matrix_rebuilds','max_joint_diode_transitions','state_disagreements',
  'unresolved_steps','max_abs_solution_difference_mixed_units',
  'max_abs_probe_voltage_difference_v','max_kcl_residual_a','max_kvl_residual_v',
  'node_version','cpu_model',
];

function buildEngine(elements,solver,extras={}){
  return compileCircuit(elements,dt,{
    diodeSolver:'hysteretic-corrected',linearSolver:solver,
    sourceSampling:'be-end',...extras,
  });
}
function run(elements,solver){
  const startCompile=performance.now();
  const eng=buildEngine(elements,solver);
  const startTransient=performance.now();
  for(let i=0;i<steps;i++)stepEngine(eng);
  const finish=performance.now();
  return {engine:eng,compileMs:startTransient-startCompile,transientMs:finish-startTransient};
}
function quantiles(xs){
  const s=xs.slice().sort((a,b)=>a-b);
  return [s[Math.floor((s.length-1)*.25)],s[Math.floor(s.length/2)],s[Math.ceil((s.length-1)*.75)]];
}

/**
 * One non-timed verification pass: every solver must reproduce the same MNA
 * unknown vector and PWL state sequence, and the reconstructed accepted
 * system must satisfy both KCL (amperes) and KVL (volts) rows.
 */
function verify(elements){
  const engines=solvers.map(s=>buildEngine(elements,s));
  const probe=ptToStr(elements.at(-1).p1);
  let maxUnknown=0,maxProbe=0,maxKcl=0,maxKvl=0,maxJoint=0;
  let previousStates={...engines[0].switchStates};
  for(let k=0;k<steps;k++){
    const dynamicBefore=engines.map(e=>({...e.state}));
    engines.forEach(e=>stepEngine(e));
    const xRef=engines[0].previousSolution;
    for(let q=1;q<3;q++){
      const x=engines[q].previousSolution;
      if(x.length!==xRef.length)throw Error('MNA dimension mismatch');
      for(let i=0;i<x.length;i++)maxUnknown=Math.max(maxUnknown,Math.abs(x[i]-xRef[i]));
      maxProbe=Math.max(maxProbe,
        Math.abs(engines[q].currentNodes[probe]-engines[0].currentNodes[probe]));
      const ids=Object.keys(engines[0].switchStates);
      if(ids.some(id=>engines[q].switchStates[id]!==engines[0].switchStates[id]))
        throw Error('Discrete PWL state mismatch at step '+k);
    }
    const joint=Object.keys(previousStates).filter(id=>
      id.startsWith('diode')&&previousStates[id]!==engines[0].switchStates[id]).length;
    maxJoint=Math.max(maxJoint,joint);
    previousStates={...engines[0].switchStates};
    if(k%53===0||joint>0){
      for(let q=0;q<3;q++){
        const r=acceptedMnaResidual(engines[q],dynamicBefore[q]);
        maxKcl=Math.max(maxKcl,r.kclAbsolute);
        maxKvl=Math.max(maxKvl,r.kvlAbsolute);
        if(!Number.isFinite(r.kclRelative)||r.kclRelative>1e-8)
          throw Error('KCL residual violation at step '+k+': '+r.kclRelative);
        if(!Number.isFinite(r.kvlRelative)||r.kvlRelative>1e-8)
          throw Error('KVL residual violation at step '+k+': '+r.kvlRelative);
      }
    }
  }
  if(maxUnknown>1e-6||!Number.isFinite(maxUnknown)||maxProbe>1e-6||!Number.isFinite(maxProbe))
    throw Error('Linear solver parity exceeded 1e-6: '+maxUnknown+' / '+maxProbe);
  if(engines.some(e=>e.diagnostics.unresolvedSteps>0))
    throw Error('Unresolved diode state in large MNA case');
  return {maxUnknown,maxProbe,maxKcl,maxKvl,maxJoint};
}

function counts(elements){
  const tally=t=>(elements.filter(el=>el.type===t).length);
  return {
    diode_count:tally('diode'),capacitor_count:tally('capacitor'),
    inductor_count:tally('inductor'),
    independent_source_count:tally('voltage')+tally('current'),
  };
}

console.error(JSON.stringify({
  node:process.version,platform:process.platform,cpu,repetitions,dt,steps,
  sizes,caseCount:scenarios.length,
  scope:'native Node dense transient core with real device stamps; NOT sparse, UI, SPICE or physical-device accuracy',
}));
console.log(fields.join(','));
for(const scenario of scenarios){
  const proof=verify(scenario.elements);
  for(const solver of solvers)run(scenario.elements,solver); // JIT warm-up
  const runs={};
  for(let repeat=0;repeat<repetitions;repeat++){
    const cycle=solvers.slice(repeat%3).concat(solvers.slice(0,repeat%3));
    for(const solver of cycle)(runs[solver]??=[]).push(run(scenario.elements,solver));
  }
  for(const solver of solvers){
    const a=runs[solver],diagnostics=a[0].engine.diagnostics;
    const [q1,middle,q3]=quantiles(a.map(r=>r.transientMs));
    const compileMedian=quantiles(a.map(r=>r.compileMs))[1];
    const row={
      circuit:scenario.name,topology:scenario.topology,target_size:scenario.size,
      mna_dimension:a[0].engine.size,element_count:scenario.elements.length,
      ...counts(scenario.elements),
      steps,repetitions,linear_solver:solver,
      diode_solver:'hysteretic-corrected',source_sampling:'be-end',
      median_compile_ms:compileMedian.toFixed(6),
      median_transient_ms:middle.toFixed(6),
      q1_transient_ms:q1.toFixed(6),q3_transient_ms:q3.toFixed(6),
      linear_solves:diagnostics.linearSolves,
      full_factorizations:diagnostics.factorizations,
      rank_one_updates:diagnostics.rankOneUpdates??0,
      rank_one_fallbacks:diagnostics.rankOneFallbacks??0,
      matrix_rebuilds:diagnostics.matrixRebuilds,
      max_joint_diode_transitions:proof.maxJoint,
      state_disagreements:diagnostics.stateDisagreements,
      unresolved_steps:diagnostics.unresolvedSteps,
      max_abs_solution_difference_mixed_units:proof.maxUnknown.toExponential(8),
      max_abs_probe_voltage_difference_v:proof.maxProbe.toExponential(8),
      max_kcl_residual_a:proof.maxKcl.toExponential(8),
      max_kvl_residual_v:proof.maxKvl.toExponential(8),
      node_version:process.version,cpu_model:cpu,
    };
    console.log(fields.map(k=>row[k]).join(','));
  }
}
