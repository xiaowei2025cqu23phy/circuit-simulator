/**
 * Isolated dense algebra benchmark on synthetic MNA-like resistor / voltage-source networks.
 * It imports the research branch's exact LU and Sherman-Morrison implementations.
 * The Gauss-Jordan inversion below is the current engine.js `invertMatrix` algorithm.
 * Results do NOT demonstrate whole-circuit simulator speedup or SPICE accuracy.
 *
 * Usage: node scripts/benchmark-mna-scaling.mjs > mna_scaling.csv
 *        node scripts/benchmark-mna-scaling.mjs --repetitions=7 --events=24 --rhs=8
 */
import { performance } from 'node:perf_hooks';
import os from 'node:os';
import { factorizeLU, solveLU, matrixResidualInfinityNorm } from '../src/sim/linearSolve.js';
import { updateInverseForConductanceBranch } from '../src/sim/rankOneUpdate.js';

// Identical to current engine.js Gauss-Jordan inverse; standalone to isolate algebra.
function invertMatrix(M) {
  const n = M.length;
  const A = M.map(row => [...row]);
  const I = Array(n).fill(0).map((_, i) => { const r = Array(n).fill(0); r[i] = 1; return r; });
  for (let i = 0; i < n; i++) {
    let maxRow = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(A[k][i]) > Math.abs(A[maxRow][i])) maxRow = k;
    if (Math.abs(A[maxRow][i]) < 1e-12) return null;
    [A[i], A[maxRow]] = [A[maxRow], A[i]];
    [I[i], I[maxRow]] = [I[maxRow], I[i]];
    const pivot = A[i][i];
    for (let j = 0; j < n; j++) { A[i][j] /= pivot; I[i][j] /= pivot; }
    for (let k = 0; k < n; k++) {
      if (k !== i) {
        const factor = A[k][i];
        for (let j = 0; j < n; j++) { A[k][j] -= factor * A[i][j]; I[k][j] -= factor * I[i][j]; }
      }
    }
  }
  return I;
}

const flags=Object.fromEntries(process.argv.slice(2).filter(s=>s.startsWith('--')).map(s=>{
  const [key,value]=s.slice(2).split('=');return [key,value];
}));
const sizes=(flags.sizes??'8,16,32,64,96').split(',').map(Number);
const repetitions=Number(flags.repetitions??5);
const events=Number(flags.events??12);
const rightHandSides=Number(flags.rhs??5);
if (!sizes.every(s=>Number.isInteger(s) && s>=4 && s<=256)) throw Error('invalid sizes');
if (![repetitions,events,rightHandSides].every(s=>Number.isInteger(s) && s>=1 && s<=128)) throw Error('invalid repetitions/events/rhs');
const cpus=os.cpus();
const cpuName=cpus[0]?.model?.replaceAll(',', ';')??'unknown';
const methods=['gauss-jordan-inverse','dense-lu','inverse-rank1'];
const fields=['mna_dimension','method','median_ms','q1_ms','q3_ms','complete_factorizations',
  'rank_one_updates','rank_one_fallbacks','linear_solutions','worst_residual_inf',
  'worst_delta_vs_full_inverse_v','events','rhs_per_event','node_version','cpu_model'];

function stamp(A,i,j,g){
  if (i>=0) A[i][i]+=g;
  if (j>=0) A[j][j]+=g;
  if (i>=0 && j>=0){A[i][j]-=g;A[j][i]-=g;}
}
function generateMNA(n){
  // n-1 node voltages + one ideal voltage-source branch current, indefinite MNA.
  const N=n-1,A=Array.from({length:n},()=>Array(n).fill(0));
  for(let i=0;i<N;i++){
    stamp(A,i,-1,0.2 + (i%7)/70);
    if (i>0) stamp(A,i-1,i,0.35 + (i%11)/60);
    if(i>=3)stamp(A,i,i-3,0.11);
  }
  A[0][N]=1;A[N][0]=1; // one voltage source branch
  const branch=[N-2,N-1];
  stamp(A,branch[0],branch[1],1e-8); // OFF-state diode conductance
  return {A,branch};
}
function clone(A){return A.map(row=>row.slice());}
function mv(A,v){return A.map(row=>row.reduce((acc,x,j)=>acc+x*v[j],0));}
function rhsFor(n,k,event){
  const rhs=Array.from({length:n},(_,i)=>0.25*Math.sin(0.011*(k+1)*(i+1)+(event*0.17)));
  rhs[n-1]=1.2 + 0.02*Math.cos(event*0.3+k); // ideal source voltage
  return rhs;
}
function solveViaInverse(inv,rhs){return mv(inv,rhs);}
function run(n,method){
  const {A:initial,branch}=generateMNA(n);
  let A=clone(initial),inv=null,lu=null;
  let full=0,rank=0,fallbacks=0,linear=0,worstResidual=0;
  const solutions=[];
  const start=performance.now();
  if(method==='dense-lu'){lu=factorizeLU(A);if(!lu)throw Error('initial LU failed');}
  else {inv=invertMatrix(A);if(!inv)throw Error('initial GJ failed');}
  full++;
  for(let event=0;event<events;event++){
    const wasOn=(event%2)===1;
    const newG=wasOn?1e-8:20;
    const oldG=wasOn?20:1e-8;
    const dg=newG-oldG;
    stamp(A,branch[0],branch[1],dg);
    if(method==='dense-lu'){
      lu=factorizeLU(A);if(!lu)throw Error('LU failed');full++;
    }else if(method==='gauss-jordan-inverse'){
      inv=invertMatrix(A);if(!inv)throw Error('inverse failed');full++;
    }else{
      const next=updateInverseForConductanceBranch(inv,branch[0],branch[1],dg);
      if(next) {inv=next;rank++;}
      else {inv=invertMatrix(A);if(!inv)throw Error('rank-one fallback invert failed');full++;fallbacks++;}
    }
    for(let k=0;k<rightHandSides;k++){
      const b=rhsFor(n,k,event);
      const x=method==='dense-lu'?solveLU(lu,b):solveViaInverse(inv,b);
      worstResidual=Math.max(worstResidual,matrixResidualInfinityNorm(A,x,b));
      linear++;
      solutions.push(x);
    }
  }
  return {elapsed:performance.now()-start,full,rank,fallbacks,linear,worstResidual,solutions};
}
function quantiles(values){const x=values.slice().sort((a,b)=>a-b);
  return [x[Math.floor((x.length-1)*.25)],x[Math.floor(x.length*.5)],x[Math.ceil((x.length-1)*.75)]];}
console.error(JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,
  cpu:cpuName,cpuCount:cpus.length,sizes,repetitions,events,rhs:rightHandSides}));
console.log(fields.join(','));
for(const n of sizes){
  // Warm-up: each variant sees the same topology and sequence of currents.
  for(const method of methods)run(n,method);
  const results={};
  for(let rep=0;rep<repetitions;rep++){
    // Rotate ordering to reduce warm-JIT/cross-method ordering bias.
    const shifted=methods.slice(rep%methods.length).concat(methods.slice(0,rep%methods.length));
    for(const method of shifted){
      const result=run(n,method);
      (results[method]??=[]).push(result);
    }
  }
  const reference=results['gauss-jordan-inverse'][0].solutions;
  for(const method of methods){
    const all=results[method];
    let maxDelta=0;
    for(const trial of all){
      for(let k=0;k<reference.length;k++){
        for(let i=0;i<reference[k].length;i++){
          maxDelta=Math.max(maxDelta,Math.abs(trial.solutions[k][i]-reference[k][i]));
        }
      }
    }
    if (!Number.isFinite(maxDelta) || maxDelta > 1e-7) throw new Error(`Solver mismatch at N=${n}, method=${method}: ${maxDelta}`);
    if (all.some(x => !Number.isFinite(x.worstResidual) || x.worstResidual > 1e-7)) throw new Error(`Bad residual at N=${n}, method=${method}`);
    const [q1,median,q3]=quantiles(all.map(x=>x.elapsed));
    const row={
      mna_dimension:n,method,
      median_ms:median.toFixed(6),q1_ms:q1.toFixed(6),q3_ms:q3.toFixed(6),
      complete_factorizations:all[0].full,rank_one_updates:all[0].rank,
      rank_one_fallbacks:all[0].fallbacks,linear_solutions:all[0].linear,
      worst_residual_inf:Math.max(...all.map(x=>x.worstResidual)).toExponential(6),
      worst_delta_vs_full_inverse_v:maxDelta.toExponential(6),
      events,rhs_per_event:rightHandSides,node_version:process.version,cpu_model:cpuName,
    };
    console.log(fields.map(key=>row[key]).join(','));
  }
}
