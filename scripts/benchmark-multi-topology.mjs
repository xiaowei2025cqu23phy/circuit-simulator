/**
 * Native Node full TRANSIENT ENGINE multi-topology benchmark.
 *
 * Unlike the isolated algebra-only 8th-round benchmark, this uses
 * compileCircuit + stepEngine with BE capacitor/inductor histories, real
 * PWL diode states, accepted-step MNA residual checks and timed switches.
 *
 * Example:
 *  node scripts/benchmark-multi-topology.mjs > multi_topology.csv
 *  node scripts/benchmark-multi-topology.mjs --repetitions=3 --bank-counts=4,12 --ladder-stages=4,8
 *
 * Includes both light-load one-time and heavy-load repeated diode
 * transitions. Dense MNA; same PWL physics across backends. NOT a ngspice validation,
 * continuous-time exact error bound, or React UI benchmark.
 */
import { performance } from 'node:perf_hooks';
import os from 'node:os';
import { compileCircuit, stepEngine, ptToStr } from '../src/sim/engine.js';
import { makeParallelDiodeBank, makeReactiveLadder } from '../src/sim/researchCircuits.js';
import { acceptedMnaResidual } from '../src/sim/mnaResidual.js';

const args=Object.fromEntries(process.argv.slice(2).filter(x=>x.startsWith('--')).map(x=>x.slice(2).split('=')));
const repetitions=Number(args.repetitions ?? 5);
const dt=Number(args.dt ?? 5e-5);
const duration=Number(args.duration ?? .04);
const parseCounts=(s,defaults)=>String(s??defaults).split(',').map(Number);
const bankCounts=parseCounts(args['bank-counts'],'4,12,24');
const ladderStages=parseCounts(args['ladder-stages'],'4,8,16');
if(!Number.isInteger(repetitions) || repetitions<2 || repetitions>30 ||
   !Number.isFinite(dt) || dt<=0 || dt>.01 ||
   !Number.isFinite(duration) || duration<=0 || duration>1 ||
   ![...bankCounts,...ladderStages].every(n=>Number.isInteger(n)&&n>=2&&n<=64))
  throw Error('Invalid benchmark arguments');
const steps=Math.round(duration/dt);
if(steps<2 || steps>20000) throw Error('Invalid nominal step count');
const solvers=['inverse','lu','inverse-rank1'];
const cpus=os.cpus();
const cpu=(cpus[0]?.model ?? 'unknown').replaceAll(',', ';');
const scenarios=[
  ...bankCounts.map(n=>({name:'diode-bank-'+n,
    topology:'parallel-diode-bank-light',scale:n,elements:makeParallelDiodeBank(n)})),
  ...bankCounts.map(n=>({name:'diode-bank-heavy-'+n,
    topology:'parallel-diode-bank-heavy',scale:n,
    elements:makeParallelDiodeBank(n,{loadProfile:'heavy'})})),
  ...['rc','rl','rlc'].flatMap(kind=>ladderStages.map(n=>({
    name:kind+'-ladder-'+n,topology:kind+'-ladder',scale:n,
    elements:makeReactiveLadder(n,{kind}),
  }))),
];
const fields=[
  'circuit','topology','scale','mna_dimension','element_count',
  'linear_solver','diode_solver','source_sampling','dt_us','steps',
  'repetitions','median_compile_ms','median_transient_ms',
  'q1_transient_ms','q3_transient_ms','linear_solves',
  'full_factorizations','rank_one_updates','rank_one_fallbacks',
  'matrix_rebuilds','max_joint_diode_transitions',
  'state_disagreements','unresolved_steps',
  'max_abs_solution_difference_mixed_units',
  'max_abs_probe_voltage_difference_v',
  'max_raw_mna_residual_mixed_units',
  'max_kcl_residual_a','max_kvl_residual_v',
  'node_version','cpu_model',
];

function buildEngine(elements,solver){
  return compileCircuit(elements,dt,{
    diodeSolver:'hysteretic-corrected',linearSolver:solver,
    sourceSampling:'be-end',
  });
}
function run(elements,solver){
  const startCompile=performance.now();
  const eng=buildEngine(elements,solver);
  const startTransient=performance.now();
  for(let i=0;i<steps;i++)stepEngine(eng);
  const finish=performance.now();
  return {
    engine:eng,compileMs:startTransient-startCompile,
    transientMs:finish-startTransient,
  };
}
function quantiles(xs){
  const s=xs.slice().sort((a,b)=>a-b);
  return [s[Math.floor((s.length-1)*.25)],s[Math.floor(s.length/2)],s[Math.ceil((s.length-1)*.75)]];
}
function verify(elements){
  const engines=solvers.map(s=>buildEngine(elements,s));
  const probe=ptToStr(elements.at(-1).p1);
  let maxUnknown=0,maxProbe=0,maxResidual=0,maxJoint=0,maxKcl=0,maxKvl=0;
  let previousStates={...engines[0].switchStates};
  for(let k=0;k<steps;k++){
    const dynamicBefore=engines.map(e=>({...e.state}));
    engines.forEach(e=>stepEngine(e));
    const xRef=engines[0].previousSolution;
    for(let q=1;q<3;q++){
      const x=engines[q].previousSolution;
      if(x.length!==xRef.length)throw Error('MNA dimension mismatch');
      for(let i=0;i<x.length;i++){
        maxUnknown=Math.max(maxUnknown,Math.abs(x[i]-xRef[i]));
      }
      maxProbe=Math.max(maxProbe,
        Math.abs(engines[q].currentNodes[probe]-engines[0].currentNodes[probe]));
      const ids=Object.keys(engines[0].switchStates);
      if(ids.some(id=>engines[q].switchStates[id]!==engines[0].switchStates[id]))
        throw Error('Discrete PWL state mismatch at step '+k);
    }
    const joint=Object.keys(previousStates).filter(id=>
      id.startsWith('diode') && previousStates[id]!==engines[0].switchStates[id]).length;
    maxJoint=Math.max(maxJoint,joint);
    previousStates={...engines[0].switchStates};
    if(k%37===0 || joint>0){
      for(let q=0;q<3;q++){
        const residual=acceptedMnaResidual(engines[q],dynamicBefore[q]);
        maxResidual=Math.max(maxResidual,residual.absolute);
        maxKcl=Math.max(maxKcl,residual.kclAbsolute);
        maxKvl=Math.max(maxKvl,residual.kvlAbsolute);
        // KCL rows are in amperes and KVL rows in volts; check them separately.
        if(!Number.isFinite(residual.kclRelative) || residual.kclRelative>1e-8)
          throw Error('KCL residual violation at step '+k+': '+residual.kclRelative);
        if(!Number.isFinite(residual.kvlRelative) || residual.kvlRelative>1e-8)
          throw Error('KVL residual violation at step '+k+': '+residual.kvlRelative);
      }
    }
  }
  if(maxUnknown>1e-6 || !Number.isFinite(maxUnknown) ||
     maxProbe>1e-6 || !Number.isFinite(maxProbe))
    throw Error('Linear solver parity exceeded 1e-6: '+maxUnknown+' / '+maxProbe);
  if(engines.some(e=>e.diagnostics.unresolvedSteps>0))
    throw Error('Unresolved diode state in benchmark case');
  return {maxUnknown,maxProbe,maxResidual,maxKcl,maxKvl,maxJoint};
}

console.error(JSON.stringify({
  node:process.version,platform:process.platform,cpu,repetitions,
  dt,steps,caseCount:scenarios.length,
  scope:'native Node core transient, NOT browser UI, SPICE or exact physical device'
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
      circuit:scenario.name,topology:scenario.topology,
      scale:scenario.scale,mna_dimension:a[0].engine.size,
      element_count:scenario.elements.length,
      linear_solver:solver,diode_solver:'hysteretic-corrected',source_sampling:'be-end',
      dt_us:(dt*1e6).toFixed(6),steps,repetitions,
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
      max_raw_mna_residual_mixed_units:proof.maxResidual.toExponential(8),
      max_kcl_residual_a:proof.maxKcl.toExponential(8),
      max_kvl_residual_v:proof.maxKvl.toExponential(8),
      node_version:process.version,cpu_model:cpu,
    };
    console.log(fields.map(k=>row[k]).join(','));
  }
}
