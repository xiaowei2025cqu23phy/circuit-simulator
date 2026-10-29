/**
 * Research diagnostic: numerical PWL hysteresis state consistency is NOT
 * physical diode unilateral-current complementarity.
 *
 * When a PWL diode is ON, its affine branch is i=g_on*(vD-0.7).
 * The chosen OFF threshold 0.65V allows negative ON current down to
 * (0.65-0.70)/0.05 = -1A without a state-violation flag.
 *
 * Run: node scripts/inspect-pwl-current-direction.mjs
 *
 * This diagnostic does not alter any production device law or state.
 * It is NOT external Shockley or ngspice validation.
 */
import { compileCircuit, stepEngine } from '../src/sim/engine.js';
import { makeParallelDiodeBank } from '../src/sim/researchCircuits.js';

const fields=[
  'load_profile','diodes','nominal_steps','on_state_samples',
  'negative_on_state_samples','min_on_state_current_a',
  'total_diode_transitions','state_disagreements','unresolved_steps',
];

console.log(fields.join(','));
for(const loadProfile of ['light','heavy']){
  const e=compileCircuit(makeParallelDiodeBank(4,{loadProfile}),5e-5,{
    diodeSolver:'hysteretic-corrected',
    sourceSampling:'be-end',linearSolver:'lu',
  });
  let min=Infinity,onSamples=0,negative=0,transitions=0;
  let states={...e.switchStates};
  for(let step=0;step<800;step++){
    stepEngine(e);
    for(const el of e.validEls){
      if(el.type!=='diode' || !e.switchStates[el.id])continue;
      const vD=(el.n1>=0?e.previousSolution[el.n1]:0)-
        (el.n2>=0?e.previousSolution[el.n2]:0);
      const iD=(vD-0.7)/0.05;
      onSamples++;
      min=Math.min(min,iD);
      if(iD < -1e-5)negative++;
    }
    transitions+=Object.keys(states).filter(k=>
      k.startsWith('diode') && states[k]!==e.switchStates[k]).length;
    states={...e.switchStates};
  }
  const row={
    load_profile:loadProfile,diodes:4,nominal_steps:800,
    on_state_samples:onSamples,negative_on_state_samples:negative,
    min_on_state_current_a:min.toPrecision(12),
    total_diode_transitions:transitions,
    state_disagreements:e.diagnostics.stateDisagreements,
    unresolved_steps:e.diagnostics.unresolvedSteps,
  };
  console.log(fields.map(k=>row[k]).join(','));
}
