/**
 * Reproducible NODE benchmark for synthetic dense MNA-shaped resistor/voltage
 * source networks. This does NOT benchmark React, rendering, entire simulator
 * time integration, or real-world SPICE device accuracy.
 *
 * node scripts/benchmark-mna-scaling.mjs > scaling.csv
 * node scripts/benchmark-mna-scaling.mjs --sizes=32,64,128 --rhs=32
 */
import { performance } from 'node:perf_hooks';
import os from 'node:os';
import { factorizeLU, solveLU, matrixResidualInfinityNorm } from '../src/sim/linearSolve.js';
import { updateInverseForConductanceBranch } from '../src/sim/rankOneUpdate.js';

// Exact numerical algorithm of the engine's Gauss-Jordan invertMatrix.
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

const args = Object.fromEntries(process.argv.slice(2).filter(x=>x.startsWith('--'))
  .map(x=>x.slice(2).split('=')));
const sizes = (args.sizes ?? '8,16,32,64,96').split(',').map(Number);
const repetitions = Number(args.repetitions ?? 7);
const events = Number(args.events ?? 24);
const rhsCount = Number(args.rhs ?? 8);
if (!sizes.every(x=>Number.isInteger(x) && x>=4 && x<=256)) throw Error('Invalid dimensions');
if (![repetitions,events,rhsCount].every(x=>Number.isInteger(x) && x>=1 && x<=128)) throw Error('Invalid workload');
const cpu = (os.cpus()[0]?.model ?? 'unknown').replaceAll(',', ';');
const methods = ['gauss-jordan-inverse','dense-lu','inverse-rank1'];
const fields = ['mna_dimension','method','median_ms','q1_ms','q3_ms','complete_factorizations',
  'rank_one_updates','rank_one_fallbacks','linear_solutions','worst_residual_inf',
  'worst_delta_vs_full_inverse_v','events','rhs_per_event','node_version','cpu_model'];

function stamp(A,i,j,g) {
  if(i>=0) A[i][i]+=g;
  if(j>=0) A[j][j]+=g;
  if(i>=0 && j>=0){ A[i][j]-=g; A[j][i]-=g; }
}
function generateMNA(n) {
  const N=n-1,A=Array.from({length:n},()=>Array(n).fill(0));
  for(let i=0;i<N;i++) {
    stamp(A,i,-1,0.2+(i%7)/70);
    if(i>0) stamp(A,i-1,i,0.35+(i%11)/60);
    if(i>=3) stamp(A,i,i-3,0.11);
  }
  A[0][N]=1;A[N][0]=1;
  const branch=[N-2,N-1];stamp(A,branch[0],branch[1],1e-8);
  return {A,branch};
}
function rhsFor(n,k,event) {
  const rhs=Array.from({length:n},(_,i)=>0.25*Math.sin(0.011*(k+1)*(i+1)+event*0.17));
  rhs[n-1]=1.2+0.02*Math.cos(event*0.3+k);
  return rhs;
}
function multiply(A,x){return A.map(row=>row.reduce((s,v,j)=>s+v*x[j],0));}
function run(n,method) {
  const start=performance.now();
  const mna=generateMNA(n),A=mna.A,branch=mna.branch;
  let inverse=null,lu=null,full=0,rank=0,fall=0,solves=0,residual=0;
  const values=[];
  if(method==='dense-lu') {lu=factorizeLU(A);if(!lu)throw Error('Initial LU failed');}
  else {inverse=invertMatrix(A);if(!inverse)throw Error('Initial inverse failed');}
  full++;
  for(let event=0;event<events;event++) {
    const turningOff=(event%2)===1;
    const deltaG=turningOff?(1e-8-20):(20-1e-8);
    stamp(A,branch[0],branch[1],deltaG);
    if(method==='dense-lu') {lu=factorizeLU(A);if(!lu)throw Error('LU failed');full++;}
    else if(method==='gauss-jordan-inverse'){
      inverse=invertMatrix(A);if(!inverse)throw Error('Inverse failed');full++;
    }else{
      const next=updateInverseForConductanceBranch(inverse,branch[0],branch[1],deltaG);
      if(next){inverse=next;rank++;}
      else{inverse=invertMatrix(A);if(!inverse)throw Error('Fallback failed');full++;fall++;}
    }
    for(let k=0;k<rhsCount;k++){
      const b=rhsFor(n,k,event);
      const x=method==='dense-lu'?solveLU(lu,b):multiply(inverse,b);
      residual=Math.max(residual,matrixResidualInfinityNorm(A,x,b));
      solves++;values.push(x);
    }
  }
  return {elapsed:performance.now()-start,full,rank,fall,solves,residual,values};
}
function quantile(xs) {
  const x=xs.slice().sort((a,b)=>a-b);
  return [x[Math.floor((x.length-1)*.25)],x[Math.floor(x.length*.5)],x[Math.ceil((x.length-1)*.75)]];
}
console.error(JSON.stringify({node:process.version,cpu,repetitions,events,rhs:rhsCount,sizes}));
console.log(fields.join(','));
for(const n of sizes){
  for(const method of methods)run(n,method); // warmup
  const results={};
  for(let rep=0;rep<repetitions;rep++){
    const rotated=methods.slice(rep%3).concat(methods.slice(0,rep%3));
    for(const method of rotated)(results[method]??=[]).push(run(n,method));
  }
  const reference=results['gauss-jordan-inverse'][0].values;
  for(const method of methods){
    const a=results[method],referenceRun=a[0];
    let maxDelta=0;
    for(const trial of a) for(let k=0;k<reference.length;k++)
      for(let j=0;j<n;j++) maxDelta=Math.max(maxDelta,
        Math.abs(trial.values[k][j]-reference[k][j]));
    const [q1,mid,q3]=quantile(a.map(x=>x.elapsed));
    const row={
      mna_dimension:n,method,median_ms:mid.toFixed(6),q1_ms:q1.toFixed(6),q3_ms:q3.toFixed(6),
      complete_factorizations:referenceRun.full,rank_one_updates:referenceRun.rank,
      rank_one_fallbacks:referenceRun.fall,linear_solutions:referenceRun.solves,
      worst_residual_inf:Math.max(...a.map(x=>x.residual)).toExponential(6),
      worst_delta_vs_full_inverse_v:maxDelta.toExponential(6),
      events,rhs_per_event:rhsCount,node_version:process.version,cpu_model:cpu,
    };
    console.log(fields.map(k=>row[k]).join(','));
  }
}
