/**
 * Reproduce the nearly singular Sherman-Morrison denominator ablation.
 * Explicitly probes guards 1e-8, 1e-6, 1e-4 under SAME bridge PWL topology.
 *
 * Run: node scripts/rank-one-guard-ablation.mjs > guard_ablation.csv
 * No real timing or SPICE physics claim.
 */
import { compileCircuit, stepEngine, ptToStr } from '../src/sim/engine.js';
import { PREDEFINED_CIRCUITS } from '../src/sim/circuits.js';

const modes=['guarded','hysteretic-corrected'];
const floors=[1e-8,1e-6,1e-4];
const T=0.04,h=1e-5;
const cols=['mode','floor','linear_solver','max_abs_voltage_delta_v','rmse_voltage_delta_v',
  'linear_solves','complete_inversions','rank_one_updates','rank_one_fallbacks',
  'matrix_state_changes','unresolved_steps'];
console.log(cols.join(','));
for(const mode of modes){
  const els=PREDEFINED_CIRCUITS.fullwave_rect.elements,probe=ptToStr({x:500,y:180});
  const baseline=compileCircuit(els,h,{diodeSolver:mode,linearSolver:'inverse',sourceSampling:'be-end'});
  const reference=[];
  for(let k=0;k<Math.round(T/h);k++){stepEngine(baseline);reference.push(baseline.currentNodes[probe]);}
  for(const floor of floors){
    const e=compileCircuit(els,h,{
      diodeSolver:mode,linearSolver:'inverse-rank1',sourceSampling:'be-end',
      rankOneDenominatorFloor:floor,
    });
    let sum=0,max=0;
    for(let k=0;k<reference.length;k++){
      stepEngine(e);
      const dv=e.currentNodes[probe]-reference[k];
      sum+=dv*dv;max=Math.max(max,Math.abs(dv));
    }
    const d=e.diagnostics,row={
      mode,floor,linear_solver:'inverse-rank1',
      max_abs_voltage_delta_v:max.toPrecision(12),
      rmse_voltage_delta_v:Math.sqrt(sum/reference.length).toPrecision(12),
      linear_solves:d.linearSolves,complete_inversions:d.factorizations,
      rank_one_updates:d.rankOneUpdates,rank_one_fallbacks:d.rankOneFallbacks,
      matrix_state_changes:d.matrixRebuilds,unresolved_steps:d.unresolvedSteps,
    };
    console.log(cols.map(key=>row[key]).join(','));
  }
}
