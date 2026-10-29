/**
 * Seventh-round reproducible numerical experiment:
 * previous-step state prediction vs corrected endpoint vs bisection vs
 * frozen-state secant event estimator, all with the SAME PWL diode law,
 * BE end-time forcing and the same fine-grid PWL reference.
 *
 * Run: node scripts/compare-event-estimate.mjs > event_estimate.csv
 * "rejected_trial_solves" are actual additional linear system evaluations.
 * This is NOT a speed benchmark or external SPICE physical accuracy test.
 */
import { compileCircuit, stepEngine, ptToStr } from '../src/sim/engine.js';
import { stepEngineWithDiodeRefinement } from '../src/sim/eventRefinement.js';
import { stepEngineWithEstimatedDiodeEvent } from '../src/sim/eventEstimate.js';
import { PREDEFINED_CIRCUITS } from '../src/sim/circuits.js';

const circuits = [
  ['rectifier', { x:320, y:260 }],
  ['fullwave_rect', { x:500, y:180 }],
  ['diode_clipper', { x:360, y:240 }],
  ['freewheel', { x:360, y:260 }],
];
const duration = 0.04;
const referenceDt = 1e-6;
const stepSizes = [1e-5,5e-5,1e-4];
const methods = ['predicted','endpoint','bisection','secant'];
const fields = [
  'circuit','dt_us','method','nominal_steps','accepted_substeps',
  'rmse_v','max_abs_error_v','accepted_linear_solves','rejected_trial_solves',
  'total_linear_solves','accepted_factorizations','rejected_trial_factorizations',
  'total_factorizations','state_disagreements','unresolved_steps',
  'event_estimates','event_bisection_transitions',
];

function simulate(elements, point, h, method) {
  const eng = compileCircuit(elements,h,{
    diodeSolver: method === 'predicted' ? 'predicted' : 'hysteretic-corrected',
    linearSolver:'lu',
    sourceSampling:'be-end',
  });
  const probe=ptToStr(point);
  const data=[];
  for(let k=0;k<Math.round(duration/h);k++){
    if(method==='bisection') stepEngineWithDiodeRefinement(eng,null,{maxHalvings:6});
    else if(method==='secant') stepEngineWithEstimatedDiodeEvent(eng,null,{minimumFraction:0.01});
    else stepEngine(eng);
    data.push(eng.currentNodes[probe]??0);
  }
  if(eng.diagnostics.unresolvedSteps) throw new Error('Unresolved step in '+method);
  return {data,diag:eng.diagnostics};
}

console.log(fields.join(','));
for(const [name,probe] of circuits){
  const elements=PREDEFINED_CIRCUITS[name].elements;
  const reference=simulate(elements,probe,referenceDt,'endpoint').data;
  for(const h of stepSizes){
    const ratio=Math.round(h/referenceDt);
    for(const method of methods){
      const {data,diag:d}=simulate(elements,probe,h,method);
      let sq=0,max=0;
      for(let i=0;i<data.length;i++){
        const dv=data[i]-reference[(i+1)*ratio-1];
        sq+=dv*dv;max=Math.max(max,Math.abs(dv));
      }
      const rejectedSolves=(d.estimatedTrialSolves??0)+(d.eventRejectedSolves??0);
      const rejectedFactors=(d.estimatedTrialFactorizations??0)+(d.eventRejectedFactorizations??0);
      const row={
        circuit:name,dt_us:Math.round(h*1e6),method,nominal_steps:data.length,
        accepted_substeps:d.steps,
        rmse_v:Math.sqrt(sq/data.length).toPrecision(12),
        max_abs_error_v:max.toPrecision(12),
        accepted_linear_solves:d.linearSolves,
        rejected_trial_solves:rejectedSolves,
        total_linear_solves:d.linearSolves+rejectedSolves,
        accepted_factorizations:d.factorizations,
        rejected_trial_factorizations:rejectedFactors,
        total_factorizations:d.factorizations+rejectedFactors,
        state_disagreements:d.stateDisagreements,
        unresolved_steps:d.unresolvedSteps,
        event_estimates:d.estimatedEvents??0,
        event_bisection_transitions:d.eventTransitionCount??0,
      };
      console.log(fields.map(key=>row[key]).join(','));
    }
  }
}
