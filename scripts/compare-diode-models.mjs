/**
 * Stage-3 diode MODEL-DIFFERENCE study (research only).
 *
 * Compares, on the same circuit / time grid / backward-Euler discretization:
 *   A  two-state hysteretic PWL (shipped research law, allows negative ON current)
 *   B  two-state PWL with unilateral-current release (i_D >= 0 by construction)
 *   C  continuous Shockley diode solved by damped Newton-Raphson
 * and, when available, an external ngspice reference for the Shockley device.
 *
 * Outputs
 *   research/round9-stage3-diode-transient.csv
 *   research/round9-stage3-diode-dc.csv
 *   research/ngspice-stage3/*.cir, *.txt
 *
 * IMPORTANT: differences between A/B/C are DEVICE-MODEL differences. They are
 * not discretization-error estimates and not claims about physical hardware.
 * Shockley itself has a reverse saturation current -I_S, so it is not a
 * unilateral device either.
 *
 * Run: node scripts/compare-diode-models.mjs [--dt=1e-5,5e-5]
 * Optional: set NGSPICE_BIN to a ngspice console executable.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { compileCircuit, stepEngine, ptToStr } from '../src/sim/engine.js';
import {
  runStateModel, runShockleyModel,
  pwlDcCurrent, shockleyDcCurrent, PWL_DEFAULTS, SHOCKLEY_DEFAULTS,
} from '../src/sim/researchDiodeModels.js';
import { makeParallelDiodeBank } from '../src/sim/researchCircuits.js';

const args = Object.fromEntries(process.argv.slice(2)
  .filter(x => x.startsWith('--')).map(x => x.slice(2).split('=')));
const dts = String(args.dt ?? '1e-5,5e-5,1e-4').split(',').map(Number);
const duration = Number(args.duration ?? 0.04);
const outTransient = args.out ?? 'research/round9-stage3-diode-transient.csv';
const outDc = args.dc ?? 'research/round9-stage3-diode-dc.csv';
const ngspiceDir = 'research/ngspice-stage3';
mkdirSync(ngspiceDir, { recursive: true });

const NODE = { x: 40, y: 0 };
const GROUND = { x: 40, y: 40 };

function canonicalCircuit() {
  return [
    { id: 'v', type: 'voltage', p1: { x: 0, y: 0 }, p2: { x: 0, y: 40 },
      value: 1, offset: 1, waveType: 'AC', freq: 200 },
    { id: 'r', type: 'resistor', p1: { x: 0, y: 0 }, p2: NODE, value: 1000 },
    { id: 'c', type: 'capacitor', p1: NODE, p2: GROUND, value: 1e-6 },
    { id: 'd', type: 'diode', p1: NODE, p2: GROUND },
    { id: 'wg', type: 'wire', p1: GROUND, p2: { x: 0, y: 40 } },
    { id: 'g', type: 'ground', p1: { x: 0, y: 40 } },
  ];
}

/** Run the shipped engine under the same hysteretic PWL law (Model A reference). */
function runEngineModel(dt) {
  const elements = canonicalCircuit();
  const engine = compileCircuit(elements, dt, {
    diodeSolver: 'hysteretic-corrected', sourceSampling: 'be-end', linearSolver: 'lu',
  });
  const steps = Math.round(duration / dt);
  const v = new Float64Array(steps);
  const iD = new Float64Array(steps);
  const key = ptToStr(NODE);
  let negativeOn = 0, minOn = Infinity, onSamples = 0;
  for (let k = 0; k < steps; k++) {
    stepEngine(engine);
    const vD = engine.currentNodes[key] ?? 0;
    v[k] = vD;
    if (engine.switchStates.d) {
      const current = 20 * (vD - PWL_DEFAULTS.vf);
      iD[k] = current;
      onSamples += 1;
      if (current < 0) negativeOn += 1;
      minOn = Math.min(minOn, current);
    } else {
      iD[k] = 1e-8 * vD;
    }
  }
  return {
    model: 'A_engine_hysteretic', t: Float64Array.from({ length: steps }, (_, k) => (k + 1) * dt),
    v, iD, negativeOnSamples: negativeOn, onSamples,
    minOnCurrent: Number.isFinite(minOn) ? minOn : 0,
    solves: engine.diagnostics.linearSolves,
    unresolvedSteps: engine.diagnostics.unresolvedSteps,
    size: engine.size,
  };
}

function rmse(a, b) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { const d = a[i] - b[i]; s += d * d; }
  return Math.sqrt(s / n);
}
function maxAbs(a, b) {
  let m = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}
function peak(arr) {
  let p = -Infinity;
  for (const value of arr) p = Math.max(p, value);
  return p;
}
function trough(arr) {
  let p = Infinity;
  for (const value of arr) p = Math.min(p, value);
  return p;
}

// ---------------------------------------------------------------- ngspice ---
function findNgspice() {
  const candidates = [
    process.env.NGSPICE_BIN,
    join(os.tmpdir(), 'ngspice-portable', 'ngspice-47', 'Spice64', 'bin', 'ngspice_con.exe'),
    'ngspice',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (candidate.includes('\\') || candidate.includes('/')) {
        if (!existsSync(candidate)) continue;
      }
      execFileSync(candidate, ['-v'], { encoding: 'utf8', timeout: 20000 });
      return candidate;
    } catch {
      // try next candidate
    }
  }
  return null;
}
const ngspiceBin = findNgspice();

function runNgspice(name, netlist) {
  const dir = join(process.cwd(), ngspiceDir);
  const cir = join(dir, name + '.cir');
  writeFileSync(cir, netlist);
  try {
    execFileSync(ngspiceBin, ['-b', name + '.cir'], {
      cwd: dir, encoding: 'utf8', timeout: 300000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) };
  }
  return { ok: true, file: join(dir, name + '.txt') };
}

function parseWrdata(path) {
  const lines = readFileSync(path, 'utf8').trim().split(/\r?\n/).filter(Boolean);
  const scale = [], values = [];
  for (const line of lines) {
    const cells = line.trim().split(/\s+/).map(Number);
    if (cells.length >= 2) { scale.push(cells[0]); values.push(cells[1]); }
  }
  return { scale, values };
}

/**
 * Linear interpolation on the ACTUAL ngspice time vector. ngspice emits a
 * non-uniform grid (tiny startup steps, then the maximum step), so assuming a
 * uniform step would silently shift the comparison by a whole sample.
 */
function interpolateAt(scale, values, target) {
  if (target <= scale[0]) return values[0];
  if (target >= scale[scale.length - 1]) return values[values.length - 1];
  let lo = 0, hi = scale.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (scale[mid] <= target) lo = mid; else hi = mid;
  }
  const span = scale[hi] - scale[lo];
  if (span <= 0) return values[lo];
  const w = (target - scale[lo]) / span;
  return values[lo] * (1 - w) + values[hi] * w;
}

const shockleyParams = { ...SHOCKLEY_DEFAULTS };
// A PWL variant whose ON branch is calibrated to the Shockley diode at 1 mA:
//   V_F = n*V_T*ln(I_ref/I_S + 1), R_on = n*V_T/I_ref, thresholds shifted by 50 mV.
// This separates "wrong PWL parameters" from "PWL model form can never follow an
// exponential". Both are reported; neither is presented as physical truth.
const I_REF = 1e-3;
const nVt = shockleyParams.n * shockleyParams.vt;
/** Single-slope PWL fitted to the Shockley diode at a chosen reference current. */
function calibratedPwlAt(iRef) {
  const vf = nVt * Math.log(iRef / shockleyParams.is + 1);
  return {
    vf,
    gOn: 1 / (nVt / (iRef + shockleyParams.is)),
    vOn: vf,
    vOff: vf - 0.05,
  };
}
const calibratedPwl = calibratedPwlAt(I_REF);
const calibratedPwlLow = calibratedPwlAt(1e-4);
const ngspiceCheck = ngspiceBin
  ? runNgspice('shockley_tran', `
* canonical one-node RC-diode, Shockley device, backward Euler (gear order 1)
V1 s 0 SIN(1 1 200)
R1 s n 1k
C1 n 0 1u ic=0
D1 n 0 DSHOCK
.model DSHOCK D(IS=1e-12 N=1.8 RS=0)
.options method=gear maxord=1 reltol=1e-8 abstol=1e-14 vntol=1e-10 trtol=1e7
.tran 1u 40m 0 1u uic
.control
run
set wr_singlescale
wrdata shockley_tran.txt v(n)
.endc
.end
`)
  : { ok: false, error: 'ngspice not found' };
let ngspiceTran = null;
if (ngspiceCheck.ok) {
  try {
    const parsed = parseWrdata(ngspiceCheck.file);
    ngspiceTran = parsed;
  } catch (error) {
    ngspiceTran = null;
    console.error('ngspice parse failed: ' + error);
  }
}

// DC sweep model comparison (analytic + ngspice).
const vsPoints = [];
for (let i = 0; i <= 500; i++) vsPoints.push(2.5 * i / 500);
const iShockley = shockleyDcCurrent(vsPoints, { rSeries: 1000 });
const iPwlA = pwlDcCurrent(vsPoints, { rSeries: 1000 });
const iPwlCal = pwlDcCurrent(vsPoints, { rSeries: 1000, params: calibratedPwl });
let iNgspiceDc = null;
if (ngspiceBin) {
  const result = runNgspice('shockley_dc', `
* DC sweep for the Shockley reference
V1 s 0 0
R1 s n 1k
D1 n 0 DSHOCK
.model DSHOCK D(IS=1e-12 N=1.8 RS=0)
.options reltol=1e-9 abstol=1e-16 vntol=1e-12
.dc V1 0 2.5 0.005
.control
run
set wr_singlescale
wrdata shockley_dc.txt i(V1)
.endc
.end
`);
  if (result.ok) {
    try {
      const parsed = parseWrdata(result.file);
      // i(V1) is the negative of the current delivered to the resistor branch.
      iNgspiceDc = parsed.values.map(x => -x);
    } catch { iNgspiceDc = null; }
  }
}

// ------------------------------------------------------------ transient -----
const rows = [];
for (const dt of dts) {
  const steps = Math.round(duration / dt);
  const engineRun = runEngineModel(dt);
  const modelA = runStateModel(canonicalCircuit(), { dt, duration, rule: 'hysteretic', probe: NODE });
  const modelAcal = runStateModel(canonicalCircuit(), {
    dt, duration, rule: 'hysteretic', probe: NODE, params: calibratedPwl,
  });
  const modelAcalLow = runStateModel(canonicalCircuit(), {
    dt, duration, rule: 'hysteretic', probe: NODE, params: calibratedPwlLow,
  });
  const modelB = runStateModel(canonicalCircuit(), { dt, duration, rule: 'unidirectional', probe: NODE });
  const modelC = runShockleyModel(canonicalCircuit(), { dt, duration, probe: NODE, params: shockleyParams });
  // Compare A/B/C on the common end-of-step grid (all use (k+1)*dt).
  const ref = modelC.v;
  let ngspiceInterp = null;
  if (ngspiceTran && ngspiceTran.scale.length > 1) {
    const scale = ngspiceTran.scale, values = ngspiceTran.values;
    ngspiceInterp = new Float64Array(steps);
    for (let k = 0; k < steps; k++) {
      ngspiceInterp[k] = interpolateAt(scale, values, (k + 1) * dt);
    }
  }
  const add = (model, run, extra = {}) => {
    rows.push({
      model,
      dt_us: (dt * 1e6).toFixed(3),
      steps,
      size: run.size,
      peak_v: peak(run.v).toFixed(9),
      trough_v: trough(run.v).toFixed(9),
      rmse_vs_shockley_v: model === 'C_shockley' ? '0' : rmse(run.v, ref).toExponential(6),
      max_abs_vs_shockley_v: model === 'C_shockley' ? '0' : maxAbs(run.v, ref).toExponential(6),
      rmse_vs_ngspice_v: ngspiceInterp ? rmse(run.v, ngspiceInterp).toExponential(6) : '',
      max_abs_vs_ngspice_v: ngspiceInterp ? maxAbs(run.v, ngspiceInterp).toExponential(6) : '',
      negative_on_samples: run.negativeOnSamples ?? run.negativeDiodeSamples ?? '',
      diode_samples: run.onSamples ?? run.diodeSamples ?? '',
      min_on_current_a: (run.minOnCurrent ?? run.minDiodeCurrent ?? 0).toExponential(6),
      solves: run.solves,
      state_iterations: run.stateIterations ?? '',
      state_changes: run.stateChanges ?? '',
      newton_iterations: run.newtonIterations ?? '',
      max_newton_per_step: run.maxNewtonPerStep ?? '',
      nonconverged_steps: (run.unresolvedSteps ?? 0) + (run.newtonFailures ?? 0),
      max_kcl_residual: (run.maxKcl ?? 0).toExponential(6),
      max_kvl_residual: (run.maxKvl ?? 0).toExponential(6),
      ...extra,
    });
  };
  add('A_engine_hysteretic', engineRun);
  add('A_independent_hysteretic', modelA);
  add('A_calibrated_pwl', modelAcal);
  add('A_calibrated_pwl_low_current', modelAcalLow);
  add('B_unidirectional_pwl', modelB);
  add('C_shockley', modelC);
  // Cross-check: engine vs independent Model A must agree to solver accuracy.
  const engineVsIndependent = maxAbs(engineRun.v, modelA.v);
  console.error(JSON.stringify({ dt, engineVsIndependent,
    ngspice: Boolean(ngspiceInterp), steps }));
}

const fields = Object.keys(rows[0]);
writeFileSync(outTransient, fields.join(',') + '\n' +
  rows.map(r => fields.map(k => r[k]).join(',')).join('\n') + '\n');

// DC table
const dcRows = vsPoints.map((source, i) => ({
  vs_v: source.toFixed(6),
  i_shockley_analytic_a: iShockley[i].toExponential(9),
  i_pwl_a: iPwlA[i].toExponential(9),
  i_pwl_calibrated_a: iPwlCal[i].toExponential(9),
  i_ngspice_a: iNgspiceDc ? iNgspiceDc[i]?.toExponential(9) ?? '' : '',
  difference_pwl_minus_shockley_a: (iPwlA[i] - iShockley[i]).toExponential(9),
  difference_pwl_calibrated_minus_shockley_a: (iPwlCal[i] - iShockley[i]).toExponential(9),
  difference_ngspice_minus_analytic_a: iNgspiceDc ? (iNgspiceDc[i] - iShockley[i]).toExponential(9) : '',
}));
const dcFields = Object.keys(dcRows[0]);
writeFileSync(outDc, dcFields.join(',') + '\n' +
  dcRows.map(r => dcFields.map(k => r[k]).join(',')).join('\n') + '\n');

// ------------------------------------------------- reverse current in bank ---
const bankRows = [];
for (const loadProfile of ['light', 'heavy']) {
  const elements = makeParallelDiodeBank(4, { loadProfile });
  const a = runStateModel(elements, { dt: 5e-5, duration, rule: 'hysteretic', probe: { x: 160, y: 80 } });
  const b = runStateModel(elements, { dt: 5e-5, duration, rule: 'unidirectional', probe: { x: 160, y: 80 } });
  bankRows.push({
    load_profile: loadProfile, diodes: 4,
    model: a.model, negative_on_samples: a.negativeOnSamples, on_samples: a.onSamples,
    min_on_current_a: a.minOnCurrent.toExponential(6),
    state_changes: a.stateChanges, nonconverged_steps: a.unresolvedSteps,
    solves: a.solves,
  });
  bankRows.push({
    load_profile: loadProfile, diodes: 4,
    model: b.model, negative_on_samples: b.negativeOnSamples, on_samples: b.onSamples,
    min_on_current_a: b.minOnCurrent.toExponential(6),
    state_changes: b.stateChanges, nonconverged_steps: b.unresolvedSteps,
    solves: b.solves,
  });
}
const bankFields = Object.keys(bankRows[0]);
writeFileSync('research/round9-stage3-diode-reverse-current.csv',
  bankFields.join(',') + '\n' + bankRows.map(r => bankFields.map(k => r[k]).join(',')).join('\n') + '\n');

console.log('transient rows: ' + rows.length + ' -> ' + outTransient);
console.log('dc rows: ' + dcRows.length + ' -> ' + outDc);
console.log('reverse-current rows: ' + bankRows.length);
console.log('ngspice: ' + (ngspiceBin ? (ngspiceTran ? 'transient+dc parsed' : 'found but parse failed') : 'NOT AVAILABLE'));
