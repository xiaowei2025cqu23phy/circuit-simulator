/**
 * Numerically guarded Sherman-Morrison update for an MNA incidence branch.
 *
 * Anew = Aold + deltaG * a*a^T, a=e_node1-e_node2
 *
 * Inverse update:
 * Anew^-1 = Aold^-1 - deltaG/(1+deltaG*a^T*Aold^-1*a)
 *                                * (Aold^-1*a)*(a^T*Aold^-1)
 *
 * No physical-diode modeling claim.  This is a dense O(n^2) update.
 * A tiny denominator risks catastrophic cancellation: return null and
 * request a full matrix inverse instead of using a dubious update.
 */
export function updateInverseForConductanceBranch(inverse, n1, n2, deltaG, {
  relativeDenominatorFloor = 1e-8,
} = {}) {
  const n=inverse.length;
  if (!Number.isFinite(deltaG)) throw new Error('导纳改变量必须有限');
  if (deltaG === 0) return inverse.map(r=>r.slice());
  if (!Number.isFinite(relativeDenominatorFloor) || relativeDenominatorFloor <= 0) {
    throw new Error('秩一更新相对分母阈值无效');
  }
  if (!(Number.isInteger(n1) && Number.isInteger(n2) &&
    n1>=-1 && n2>=-1 && n1<n && n2<n && n1!==n2)) {
    throw new Error('秩一更新支路端点无效');
  }
  if (!inverse.every(r=>Array.isArray(r)&&r.length===n&&r.every(Number.isFinite))) {
    throw new Error('秩一更新需要有限方阵逆');
  }
  const aa = n1 >= 0 ? n1 : null;
  const bb = n2 >= 0 ? n2 : null;
  const y=new Array(n), z=new Array(n);
  for(let i=0;i<n;i++){
    y[i] = (aa===null?0:inverse[i][aa]) - (bb===null?0:inverse[i][bb]);
    z[i] = (aa===null?0:inverse[aa][i]) - (bb===null?0:inverse[bb][i]);
  }
  const w = (aa===null?0:y[aa])-(bb===null?0:y[bb]);
  const dw=deltaG*w;
  const denom=1+dw;
  // Guard against an almost singular changed matrix; mixed absolute/relative
  // criterion covers cancellation when deltaG*w ≈ -1.
  if (!Number.isFinite(denom) || Math.abs(denom) <= relativeDenominatorFloor*Math.max(1,Math.abs(dw))) {
    return null;
  }
  const multiplier=deltaG/denom;
  const updated=inverse.map((row,i)=>row.map((aij,j)=>aij-multiplier*y[i]*z[j]));
  if(updated.some(row=>row.some(v=>!Number.isFinite(v)))) return null;
  return updated;
}
