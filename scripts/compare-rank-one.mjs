/**
 * Compare explicit full Gauss-Jordan inverse rebuilding to rank-one
 * Sherman-Morrison inverse compensation when ONLY diode conductance stamps
 * change. Both use the same PWL device model, input clock and state policy.
 *
 * Run: node scripts/compare-rank-one.mjs > rank_one_comparison.csv
 *
 * Wall-clock timings require repeated normal Node runs on the SAME machine;
 * inverse-count changes are not automatically time speedups.
 */
import { performance } from 'node:perf_hooks';
import { compileCircuit, stepEngine, ptToStr } from '../src/sim/engine.js';
import { PREDEFINED_CIRCUITS } from '../src/sim/circuits.js';

const scenarios=[
  ['rectifier',{x:320,y:260}],
  ['fullwave_rect',{x:500,y:180}],
  ['diode_clipper',{x:360,y:240}],
  ['freewheel',{x:360,y:260}],
];
const modes=['iterative','predicted','guarded','adaptive','hysteretic-corrected'];
const h=1e-5,T=0.04,repetitions=5;
const cols=[
  'circuit','mode','linear_solver','steps',
  'median_elapsed_ms','linear_solves','complete_inversions',
  'rank_one_updates','rank_one_fallbacks','matrix_state_changes',
  'max_abs_voltage_delta_v','rmse_voltage_delta_v','node_version',
];

function simulate(elements,probe,mode,linearSolver){
  const engine=compileCircuit(elements,h,{
    diodeSolver:mode,linearSolver,sourceSampling:'be-end',
  });
  const values=[],point=ptToStr(probe);
  const begin=performance.now();
  for(let k=0;k<Math.round(T/h);k++){
    stepEngine(engine);
    values.push(engine.currentNodes[point]);
  }
  return {values,elapsed:performance.now()-begin,diagnostics:engine.diagnostics};
}
const median=values=>values.slice().sort((a,b)=>a-b)[Math.floor(values.length/2)];

console.log(cols.join(','));
for(const [key,probe] of scenarios){
  const elements=PREDEFINED_CIRCUITS[key].elements;
  for(const mode of modes){
    const pair={};
    for(const linearSolver of ['inverse','inverse-rank1']){
      pair[linearSolver]=Array.from({length:repetitions},()=>simulate(elements,probe,mode,linearSolver));
    }
    let sq=0,max=0;
    const a=pair.inverse[0].values,b=pair['inverse-rank1'][0].values;
    for(let k=0;k<a.length;k++){
      const dv=a[k]-b[k];sq+=dv*dv;max=Math.max(max,Math.abs(dv));
    }
    if(max>1e-6)throw new Error('Rank-one inverse disagrees: '+key+' / '+mode+' / '+max);
    for(const linearSolver of ['inverse','inverse-rank1']){
      const d=pair[linearSolver][0].diagnostics;
      const row={
        circuit:key,mode,linear_solver:linearSolver,
        steps:a.length,
        median_elapsed_ms:median(pair[linearSolver].map(x=>x.elapsed)).toFixed(6),
        linear_solves:d.linearSolves,
        complete_inversions:d.factorizations,
        rank_one_updates:d.rankOneUpdates,
        rank_one_fallbacks:d.rankOneFallbacks,
        matrix_state_changes:d.matrixRebuilds,
        max_abs_voltage_delta_v:max.toExponential(7),
        rmse_voltage_delta_v:Math.sqrt(sq/a.length).toExponential(7),
        node_version:process.version,
      };
      console.log(cols.map(col=>row[col]).join(','));
    }
  }
}
