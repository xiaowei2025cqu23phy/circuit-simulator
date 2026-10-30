/**
 * Independent research diagnostic: reconstruct the accepted BE MNA system
 * from the PRE-STEP capacitor/inductor history and the solved PWL state.
 *
 * This is a linear algebra consistency check, not a local truncation-error
 * estimator, a diode physical-model check, or an accuracy guarantee.
 *
 * The MNA residual vector mixes two physical dimensions:
 *   - node rows 0..N-1      are KCL residuals, in amperes;
 *   - branch rows N..N+M-1  are KVL residuals, in volts.
 * A single infinity norm over both would compare amperes with volts, so this
 * module reports them separately as well as providing the legacy mixed value.
 *
 * Call stepEngine(e) AFTER capturing {...e.state}, then evaluate with
 * that saved state. Requires sourceSampling:'be-end' to avoid ambiguity.
 */
import { buildMNA, getSourceValue } from './engine.js';

const isFiniteNumber = value => typeof value === 'number' && Number.isFinite(value);

export function acceptedMnaResidual(eng, stateBeforeStep) {
  if (eng.sourceSampling !== 'be-end') {
    throw new Error('MNA 残量检验要求 BE 终点源采样');
  }
  if (!stateBeforeStep || typeof stateBeforeStep !== 'object' || Array.isArray(stateBeforeStep)) {
    throw new Error('残量检验需要求解前动态历史状态及已接受解');
  }
  if (!Array.isArray(eng.previousSolution) || eng.previousSolution.length !== eng.size) {
    throw new Error('残量检验需要求解前动态历史状态及已接受解');
  }
  // Every dynamic element must supply its own pre-step history. A partially
  // filled object would silently act as a zero history and produce a
  // plausible but meaningless residual, so reject it instead of guessing.
  // During the very first accepted step the initial-condition history is
  // zero by definition, so an empty object is the correct capture there.
  const dynamicIds = eng.validEls
    .filter(el => el.type === 'capacitor' || el.type === 'inductor')
    .map(el => el.id);
  const present = dynamicIds.filter(id => stateBeforeStep[id] !== undefined);
  if (present.length !== 0 && present.length !== dynamicIds.length) {
    throw new Error('残量检验动态元件历史状态不完整');
  }
  if (present.length === 0 && eng.diagnostics.steps > 1) {
    throw new Error('残量检验缺少动态元件历史状态');
  }
  for (const id of present) {
    if (!isFiniteNumber(stateBeforeStep[id])) {
      throw new Error('残量检验动态元件历史状态非有限: ' + id);
    }
  }

  const A=buildMNA(eng.N, eng.M, eng.dt, eng.validEls,
    eng.branchEls, eng.switchStates);
  const b=Array(eng.size).fill(0);
  const dt=eng.dt;
  // eng.t has already advanced to the END of the accepted BE step.
  for (const el of eng.validEls) {
    const {id,n1,n2,type,value}=el;
    if (type==='capacitor') {
      // A missing entry is only legal for the first step, where the initial
      // history is zero by definition; validation above rejects it later.
      const historyCurrent=((Number(value)||1e-6)/dt)*(stateBeforeStep[id]??0);
      if(n1>=0)b[n1]+=historyCurrent;
      if(n2>=0)b[n2]-=historyCurrent;
    }else if(type==='inductor') {
      b[eng.branchMap[id]]=-((Number(value)||1e-3)/dt)*(stateBeforeStep[id]??0);
    }else if(type==='voltage') {
      b[eng.branchMap[id]]=getSourceValue(el,eng.t);
    }else if(type==='current') {
      const source=getSourceValue(el,eng.t);
      if(n1>=0)b[n1]-=source;
      if(n2>=0)b[n2]+=source;
    }else if(type==='diode' && eng.switchStates[id]) {
      const onConductance=1.0/0.05;
      const equivalentCurrent=0.7*onConductance;
      if(n1>=0)b[n1]+=equivalentCurrent;
      if(n2>=0)b[n2]-=equivalentCurrent;
    }
  }
  const x=eng.previousSolution;
  const nodeRows=eng.N;               // KCL rows, amperes
  const branchRows=eng.size-nodeRows; // KVL rows, volts
  let kclAbsolute=0, kvlAbsolute=0;
  let kclScale=1, kvlScale=1;
  for(let i=0;i<eng.size;i++){
    const row=A[i];
    let ax=0;
    for(let j=0;j<eng.size;j++)ax+=row[j]*x[j];
    const residual=ax-b[i];
    if(i<nodeRows){
      kclAbsolute=Math.max(kclAbsolute,Math.abs(residual));
      kclScale=Math.max(kclScale,Math.abs(ax),Math.abs(b[i]));
    }else{
      kvlAbsolute=Math.max(kvlAbsolute,Math.abs(residual));
      kvlScale=Math.max(kvlScale,Math.abs(ax),Math.abs(b[i]));
    }
  }
  const absolute=Math.max(kclAbsolute,kvlAbsolute);
  const scale=Math.max(kclScale,kvlScale);
  return {
    // Legacy mixed-dimension scalars kept for existing callers and CSVs.
    absolute, relative:absolute/scale, scale,
    // Dimension-correct diagnostics: never compare these two to each other.
    kclAbsolute, kclRelative:kclAbsolute/kclScale, kclScale,
    kvlAbsolute, kvlRelative:kvlAbsolute/kvlScale, kvlScale,
    size:eng.size, equationCount:A.length,
    nodeRowCount:nodeRows, branchRowCount:branchRows,
  };
}
