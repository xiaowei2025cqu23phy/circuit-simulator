/**
 * Controlled time-discretization/event-refinement experiment.
 *
 * All comparisons are to ONE fine-grid (dt=1us) PWL reference using
 * backward-Euler endpoint evaluation of sources + timed switches.
 * The DC/PWL circuit model and diode-state law are identical.
 *
 * Commands:
 *   node scripts/compare-event-refinement.mjs > event_refinement.csv
 *
 * The results are about METHOD DISCRETIZATION, not Shockley/SPICE physics.
 * Rejected trial linear solves count as real work. This script does not
 * measure wall-time performance.
 */
import { compileCircuit, stepEngine, ptToStr } from '../src/sim/engine.js';
import { stepEngineWithDiodeRefinement } from '../src/sim/eventRefinement.js';
import { PREDEFINED_CIRCUITS } from '../src/sim/circuits.js';

const circuits = [
  ['rectifier', { x:320,y:260 }],
  ['fullwave_rect', { x:500,y:180 }],
  ['diode_clipper', { x:360,y:240 }],
  ['freewheel', { x:360,y:260 }],
];
const duration = 0.04;
const referenceDt = 1e-6;
const testDts = [1e-5, 5e-5, 1e-4];
const strategies = [
  { sourceSampling:'legacy-start', refine:false },
  { sourceSampling:'be-end', refine:false },
  { sourceSampling:'be-end', refine:true },
];
const keys = [
  'circuit','dt_us','source_sampling','event_refinement','rmse_v','max_abs_error_v',
  'nominal_steps','accepted_steps','accepted_linear_solves','rejected_trial_solves',
  'accepted_factorizations','rejected_trial_factorizations','detected_transitions',
  'depth_limit_hits','state_disagreements','unresolved_steps',
];

function simulate(elements, p, dt, sampling, refine = false) {
  const eng = compileCircuit(elements, dt, {
    diodeSolver:'hysteretic-corrected',
    linearSolver:'lu',
    sourceSampling:sampling,
  });
  const trace=[];
  for (let k=0; k<Math.round(duration/dt); k++) {
    if (refine) stepEngineWithDiodeRefinement(eng, null, {maxHalvings:6});
    else stepEngine(eng);
    trace.push(eng.currentNodes[ptToStr(p)] ?? 0);
  }
  if (eng.diagnostics.unresolvedSteps) throw new Error('Unresolved state step');
  return { trace, diagnostics:eng.diagnostics };
}

console.log(keys.join(','));
for (const [name, probe] of circuits) {
  const elements=PREDEFINED_CIRCUITS[name].elements;
  const reference=simulate(elements,probe,referenceDt,'be-end');
  for(const dt of testDts) {
    const ratio=Math.round(dt/referenceDt);
    for(const strategy of strategies) {
      const result=simulate(elements,probe,dt,strategy.sourceSampling,strategy.refine);
      let sum=0, max=0;
      for(let i=0;i<result.trace.length;i++){
        const dv=result.trace[i]-reference.trace[(i+1)*ratio-1];
        sum+=dv*dv;max=Math.max(max,Math.abs(dv));
      }
      const d=result.diagnostics;
      const row={
        circuit:name,dt_us:Math.round(dt*1e6),source_sampling:strategy.sourceSampling,
        event_refinement:strategy.refine?'on':'off',
        rmse_v:Math.sqrt(sum/result.trace.length).toPrecision(12),
        max_abs_error_v:max.toPrecision(12),
        nominal_steps:result.trace.length,
        accepted_steps:d.steps,accepted_linear_solves:d.linearSolves,
        rejected_trial_solves:d.eventRejectedSolves??0,
        accepted_factorizations:d.factorizations,
        rejected_trial_factorizations:d.eventRejectedFactorizations??0,
        detected_transitions:d.eventTransitionCount??0,
        depth_limit_hits:d.eventDepthLimitHits??0,
        state_disagreements:d.stateDisagreements,
        unresolved_steps:d.unresolvedSteps,
      };
      console.log(keys.map(key=>row[key]).join(','));
    }
  }
}
