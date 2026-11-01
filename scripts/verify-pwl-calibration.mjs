/**
 * Calibration audit for the single-slope PWL branch.
 *
 * Correct tangent conditions for i(v)=g*(v-V0) through (V_ref, I_ref):
 *   g = (I_S + I_ref)/(n*V_T),  V0 = V_ref - I_ref/g
 *
 * The superseded implementation used V0 = V_ref, which delivers i(V_ref)=0.
 * This script prints both so the erratum is reproducible and auditable.
 *
 * Output: research/round9-stage3-calibration-check.csv
 */
import { writeFileSync } from 'node:fs';
import {
  resolveShockley, pwlCalibrationAt, thermalVoltage,
  NGSPICE_DEFAULT_TEMPERATURE_K,
} from '../src/sim/researchDiodeModels.js';

const out = process.argv.find(x => x.startsWith('--out='))?.slice(6)
  ?? 'research/round9-stage3-calibration-check.csv';
const shockley = resolveShockley();
const nVt = shockley.n * shockley.vt;

const rows = [];
for (const iRef of [1e-7, 1e-6, 1e-5, 1e-4, 1e-3, 1e-2, 1e-1]) {
  const corrected = pwlCalibrationAt(iRef, shockley);
  const vRef = corrected.vRef;
  // Superseded formula: V0 = V_ref (zero current at the reference point).
  const supersededVf = vRef;
  const supersededCurrent = corrected.gRef * (vRef - supersededVf);
  const correctedCurrent = corrected.gOn * (vRef - corrected.vf);
  // Shockley reference values at the tangency point.
  const shockleyCurrent = shockley.is * (Math.exp(vRef / nVt) - 1);
  const shockleySlope = (shockley.is / nVt) * Math.exp(vRef / nVt);
  rows.push({
    i_ref_a: iRef.toExponential(6),
    v_ref_v: vRef.toFixed(12),
    shockley_current_at_v_ref_a: shockleyCurrent.toExponential(9),
    shockley_slope_at_v_ref_s: shockleySlope.toExponential(9),
    corrected_vf_v: corrected.vf.toFixed(12),
    corrected_g_on_s: corrected.gOn.toExponential(9),
    corrected_current_at_v_ref_a: correctedCurrent.toExponential(9),
    corrected_current_relative_error: (Math.abs(correctedCurrent - iRef) / iRef).toExponential(3),
    corrected_slope_relative_error: (Math.abs(corrected.gOn - shockleySlope) / shockleySlope).toExponential(3),
    superseded_vf_v: supersededVf.toFixed(12),
    superseded_current_at_v_ref_a: supersededCurrent.toExponential(9),
    superseded_vf_offset_from_correct_v: (supersededVf - corrected.vf).toExponential(9),
  });
}

const fields = Object.keys(rows[0]);
writeFileSync(out, [
  `# thermal voltage kT/q at ${NGSPICE_DEFAULT_TEMPERATURE_K} K = ${thermalVoltage(NGSPICE_DEFAULT_TEMPERATURE_K)} V`,
  `# Shockley parameters: IS=${shockley.is} A, N=${shockley.n}, T=${shockley.temperatureK} K`,
  fields.join(','),
  ...rows.map(r => fields.map(k => r[k]).join(',')),
].join('\n') + '\n');

console.log(`calibration audit -> ${out}`);
console.log(`V_T(${NGSPICE_DEFAULT_TEMPERATURE_K} K) = ${thermalVoltage(NGSPICE_DEFAULT_TEMPERATURE_K)} V`);
for (const row of rows) {
  console.log(`${row.i_ref_a} A: corrected i(Vref)=${row.corrected_current_at_v_ref_a} A ` +
    `(rel err ${row.corrected_current_relative_error}), superseded=${row.superseded_current_at_v_ref_a} A`);
}
