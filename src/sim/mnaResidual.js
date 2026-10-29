/**
 * Independent research diagnostic: reconstruct the accepted BE MNA system
 * from the PRE-STEP capacitor/inductor history and the solved PWL state.
 *
 * This is a linear algebra consistency check, not a local truncation-error
 * estimator, diode physical-model check, or accuracy guarantee.
 *
 * Call stepEngine(e) AFTER capturing {...e.state}, then evaluate with
 * that saved state. Requires sourceSampling:'be-end' to avoid ambiguity.
 */
import { buildMNA, getSourceValue } from './engine.js';
import { matrixResidualInfinityNorm } from './linearSolve.js';

export function acceptedMnaResidual(eng, stateBeforeStep) {
  if (eng.sourceSampling !== 'be-end') {
    throw new Error('MNA 残量检验要求 BE 终点源采样');
  }
  if (!stateBeforeStep || typeof stateBeforeStep !== 'object' ||
      !Array.isArray(eng.previousSolution) ||
      eng.previousSolution.length !== eng.size) {
    throw new Error('残量检验需要求解前动态历史状态及已接受解');
  }
  const A=buildMNA(eng.N, eng.M, eng.dt, eng.validEls,
    eng.branchEls, eng.switchStates);
  const b=Array(eng.size).fill(0);
  const dt=eng.dt;
  // eng.t has already advanced to the END of the accepted BE step.
  for (const el of eng.validEls) {
    const {id,n1,n2,type,value}=el;
    if (type==='capacitor') {
      const historyCurrent=((Number(value)||1e-6)/dt)*(stateBeforeStep[id]||0);
      if(n1>=0)b[n1]+=historyCurrent;
      if(n2>=0)b[n2]-=historyCurrent;
    }else if(type==='inductor') {
      b[eng.branchMap[id]]=-((Number(value)||1e-3)/dt)*(stateBeforeStep[id]||0);
    }else if(type==='voltage') {
      b[eng.branchMap[id]]=getSourceValue(el,eng.t);
    }else if(type==='current') {
      const source=getSourceValue(el,eng.t);
      if(n1>=0)b[n1]-=source;
      if(n2>=0)b[n2]+=source;
    }else if(type==='diode' && eng.switchStates[id]) {
      const equivalentCurrent=0.7/0.05;
      if(n1>=0)b[n1]+=equivalentCurrent;
      if(n2>=0)b[n2]-=equivalentCurrent;
    }
  }
  const x=eng.previousSolution;
  const absolute=matrixResidualInfinityNorm(A,x,b);
  let scale=1;
  for(let i=0;i<eng.size;i++){
    let ax=0;
    for(let j=0;j<eng.size;j++)ax+=A[i][j]*x[j];
    scale=Math.max(scale,Math.abs(ax),Math.abs(b[i]));
  }
  return {
    absolute, relative:absolute/scale, scale,
    size:eng.size, equationCount:A.length,
  };
}
