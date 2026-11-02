/**
 * Zero-source RC–PWL passivity experiment (native engine, research only).
 *
 * Circuit (no independent source): one node with R to ground, C to ground and a
 * two-state PWL diode to ground. Initial capacitor voltage is prescribed.
 *
 * Outputs (research/zero-source/):
 *   transient-cases.csv          per-step voltages/currents/energy for cases A–E
 *   step-size-convergence.csv    engine vs independent Python analytic solution
 *   resistance-scan.csv          R = 0.5 / 0.65 / 1 / 1k boundary scan
 *   model-comparison.csv         hysteretic PWL vs negative-current-release PWL vs Shockley
 *
 * node scripts/zero-source-passivity.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { compileCircuit, stepEngine, GMIN, ptToStr } from '../src/sim/engine.js';
import { runShockleyModel } from '../src/sim/researchDiodeModels.js';

const DIR = 'research/zero-source';
const C = 1e-6;
const G_ON = 20;
const V_F = 0.7;
const I_EQ = G_ON * V_F;
const G_OFF = 1e-8;
const V_ON = 0.7;
const V_OFF = 0.65;
const NODE = { x: 40, y: 0 };
const GND = { x: 0, y: 0 };

function elementsFor(R) {
  return [
    { id: 'r', type: 'resistor', p1: NODE, p2: GND, value: R },
    { id: 'c', type: 'capacitor', p1: NODE, p2: GND, value: C },
    { id: 'd', type: 'diode', p1: NODE, p2: GND },
    { id: 'g', type: 'ground', p1: GND },
  ];
}

/** Compile and apply the prescribed initial state without corrupting caches. */
function makeEngine({ R, dt, diodeSolver, v0, on }) {
  const engine = compileCircuit(elementsFor(R), dt, {
    diodeSolver, sourceSampling: 'be-end', linearSolver: 'lu',
  });
  if (engine.size !== 1) throw new Error('expected a one-node MNA system');
  engine.state.c = v0;
  engine.switchStates.d = on;
  engine.previousSolution = [v0];
  // The compiled factorization belongs to the default OFF state; force a
  // rebuild so the first step uses a cache that matches the prescribed state.
  engine.needsMatrixRebuild = true;
  return engine;
}

const diodeCurrent = (v, on) => (on ? G_ON * (v - V_F) : G_OFF * v);

function energyRow(prevV, engine, h) {
  const v = engine.previousSolution[0];
  const on = Boolean(engine.switchStates.d);
  const iD = diodeCurrent(v, on);
  const pD = v * iD;
  const dEC = 0.5 * C * (v * v - prevV * prevV);
  const eNum = 0.5 * C * (v - prevV) ** 2;
  const eR = h * v * v / engineR(engine);
  const eG = h * GMIN * v * v;
  const eD = h * v * iD;
  return {
    v, on, iD, pD, dEC, eNum, eR, eG, eD,
    balance: dEC + eNum + eR + eG + eD,
  };
}
function engineR(engine) {
  const resistor = engine.validEls.find(el => el.type === 'resistor');
  return Number(resistor.value);
}

function runCase({ R = 1000, dt = 1e-4, duration = 1e-4, diodeSolver = 'hysteretic-corrected',
  v0 = 0.68, on = true, caseName = '', maxSteps = Infinity }) {
  const engine = makeEngine({ R, dt, diodeSolver, v0, on });
  const steps = Math.min(maxSteps, Math.max(1, Math.round(duration / dt)));
  const rows = [];
  let prevV = v0;
  let prevOn = on;
  for (let k = 0; k < steps; k++) {
    stepEngine(engine);
    const row = energyRow(prevV, engine, dt);
    rows.push({
      case: caseName, diode_solver: diodeSolver, R_ohm: R, C_f: C, h_s: dt,
      step: k, t_s: (k + 1) * dt, v_prev_v: prevV, ...row,
      state_changed: row.on !== prevOn ? 1 : 0,
      state_disagreements: engine.diagnostics.stateDisagreements,
      unresolved_steps: engine.diagnostics.unresolvedSteps,
      linear_solves: engine.diagnostics.linearSolves,
      work_solve_calls: engine.work.solveCalls,
      factorizations: engine.diagnostics.factorizations,
    });
    prevV = row.v;
    prevOn = row.on;
  }
  const sum = key => rows.reduce((acc, r) => acc + r[key], 0);
  const minOf = key => rows.reduce((acc, r) => Math.min(acc, r[key]), Infinity);
  const maxAbsOf = key => rows.reduce((acc, r) => Math.max(acc, Math.abs(r[key])), 0);
  return {
    rows,
    summary: {
      case: caseName, diode_solver: diodeSolver, R_ohm: R, h_s: dt,
      steps: rows.length,
      final_t_s: rows.length ? rows[rows.length - 1].t_s : 0,
      v_final_v: rows.length ? rows[rows.length - 1].v : v0,
      final_on: rows.length ? Number(rows[rows.length - 1].on) : Number(on),
      v_star_v: I_EQ / (G_ON + 1 / R),
      on_steady_state_exists: I_EQ / (G_ON + 1 / R) >= V_OFF ? 1 : 0,
      min_diode_power_w: minOf('pD'),
      negative_power_steps: rows.filter(r => r.pD < 0).length,
      total_cap_energy_change_j: sum('dEC'),
      total_resistor_energy_j: sum('eR'),
      total_gmin_energy_j: sum('eG'),
      total_be_dissipation_j: sum('eNum'),
      total_diode_energy_j: sum('eD'),
      energy_balance_residual_j: sum('balance'),
      max_abs_step_balance_j: maxAbsOf('balance'),
      unresolved_steps: rows.length ? rows[rows.length - 1].unresolved_steps : 0,
      linear_solves: rows.length ? rows[rows.length - 1].linear_solves : 0,
      work_solve_calls: rows.length ? rows[rows.length - 1].work_solve_calls : 0,
    },
  };
}

const csv = (items, fields) => fields.join(',') + '\n' +
  items.map(row => fields.map(k => row[k] ?? '').join(',')).join('\n') + '\n';

// ---------------------------------------------------------------- cases A–E --
const caseRuns = [];
caseRuns.push(runCase({ caseName: 'A_on_100us', v0: 0.68, on: true, dt: 1e-4, duration: 1e-4 }));
caseRuns.push(runCase({ caseName: 'B_off_100us', v0: 0.68, on: false, dt: 1e-4, duration: 1e-4 }));
caseRuns.push(runCase({ caseName: 'C_off_zero_100us', v0: 0, on: false, dt: 1e-4, duration: 1e-4 }));
caseRuns.push(runCase({ caseName: 'D_legacy_iterative_100us', v0: 0.68, on: true,
  diodeSolver: 'iterative', dt: 1e-4, duration: 1e-3 }));
for (const mode of ['predicted', 'guarded', 'adaptive', 'hysteretic-corrected']) {
  caseRuns.push(runCase({ caseName: 'E_' + mode + '_100us', v0: 0.68, on: true,
    diodeSolver: mode, dt: 1e-4, duration: 1e-4 }));
}
const stepRows = caseRuns.flatMap(run => run.rows);
const stepFields = Object.keys(stepRows[0]);
writeFileSync(`${DIR}/transient-cases.csv`, csv(stepRows, stepFields));
const caseSummaries = caseRuns.map(run => run.summary);
writeFileSync(`${DIR}/case-summary.csv`,
  csv(caseSummaries, Object.keys(caseSummaries[0])));

// ------------------------------------------------- step-size vs analytic -----
const analytic = readFileSync(`${DIR}/analytic-reference.csv`, 'utf8')
  .trim().split(/\r?\n/).slice(1)
  .map(line => {
    const cells = line.split(',');
    return {
      kind: cells[0], case: cells[1], R: Number(cells[2]), t: Number(cells[4]),
      v: Number(cells[5]), on: Number(cells[6]),
    };
  })
  .filter(row => row.kind === 'transient' && row.case === 'A_on' && row.R === 1000);
const analyticRows = analytic.slice().sort((a, b) => a.t - b.t);
function analyticAt(t) {
  // nearest analytic sample within a tight relative tolerance
  let lo = 0, hi = analyticRows.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (analyticRows[mid].t <= t) lo = mid; else hi = mid;
  }
  for (const idx of [lo, hi]) {
    const row = analyticRows[idx];
    if (row && Math.abs(row.t - t) <= Math.max(1e-20, 1e-12 * Math.abs(t))) return row;
  }
  return null;
}

const convergenceRows = [];
for (const h of [1e-9, 1e-8, 5e-8, 1e-7, 1e-4]) {
  const maxSteps = Math.min(20000, Math.max(1, Math.round(1e-4 / h)));
  const run = runCase({ caseName: 'A_on', v0: 0.68, on: true, dt: h,
    duration: h * maxSteps, maxSteps });
  for (const row of run.rows) {
    const ref = analyticAt(row.t_s);
    if (!ref) continue;
    convergenceRows.push({
      h_s: h, t_s: row.t_s, v_engine_v: row.v, v_analytic_v: ref.v,
      abs_error_v: Math.abs(row.v - ref.v), state_engine: Number(row.on),
      state_analytic: ref.on, i_diode_a: row.iD, p_diode_w: row.pD,
    });
  }
  run.summary.dt_s = h;
}
writeFileSync(`${DIR}/step-size-convergence.csv`,
  csv(convergenceRows, Object.keys(convergenceRows[0])));

// ------------------------------------------------------ resistance scan -----
const scanRows = [];
for (const R of [0.5, 0.65, 1, 1000]) {
  const run = runCase({ caseName: 'A_on_R' + R, R, v0: 0.68, on: true,
    dt: 1e-6, duration: 1e-2, maxSteps: 10000 });
  scanRows.push(run.summary);
}
writeFileSync(`${DIR}/resistance-scan.csv`, csv(scanRows, Object.keys(scanRows[0])));

// ------------------------------------------------------ model comparison ----
const modelRows = [];
for (const h of [1e-7, 1e-4]) {
  const corrected = runCase({ caseName: 'model_A_hysteretic_pwl', v0: 0.68, on: true,
    diodeSolver: 'hysteretic-corrected', dt: h, duration: h >= 1e-4 ? 1e-4 : 2e-3,
    maxSteps: h >= 1e-4 ? 1 : 20000 });
  const legacy = runCase({ caseName: 'model_B_negative_current_release', v0: 0.68, on: true,
    diodeSolver: 'iterative', dt: h, duration: h >= 1e-4 ? 1e-4 : 2e-3,
    maxSteps: h >= 1e-4 ? 1 : 20000 });
  const shockley = runShockleyModel(elementsFor(1000), {
    dt: h, duration: h >= 1e-4 ? 1e-4 : 2e-3, probe: NODE, initialState: { c: 0.68 },
  });
  const shockV = shockley.v[shockley.v.length - 1];
  const shockStart = 0.68;
  modelRows.push({
    h_s: h, model: corrected.summary.case, v_final_v: corrected.summary.v_final_v,
    final_on: corrected.summary.final_on,
    total_diode_energy_j: corrected.summary.total_diode_energy_j,
    min_diode_power_w: corrected.summary.min_diode_power_w,
    cap_energy_change_j: corrected.summary.total_cap_energy_change_j,
    charged_from_zero_source: corrected.summary.total_cap_energy_change_j > 0 ? 1 : 0,
  });
  modelRows.push({
    h_s: h, model: legacy.summary.case, v_final_v: legacy.summary.v_final_v,
    final_on: legacy.summary.final_on,
    total_diode_energy_j: legacy.summary.total_diode_energy_j,
    min_diode_power_w: legacy.summary.min_diode_power_w,
    cap_energy_change_j: legacy.summary.total_cap_energy_change_j,
    charged_from_zero_source: legacy.summary.total_cap_energy_change_j > 0 ? 1 : 0,
  });
  modelRows.push({
    h_s: h, model: 'C_shockley', v_final_v: shockV,
    final_on: 1,
    total_diode_energy_j: 'n/a', min_diode_power_w: shockley.minDiodeCurrent * shockV,
    cap_energy_change_j: (0.5 * C * (shockV * shockV - shockStart * shockStart)).toExponential(9),
    charged_from_zero_source: shockV > shockStart ? 1 : 0,
  });
}
writeFileSync(`${DIR}/model-comparison.csv`, csv(modelRows, Object.keys(modelRows[0])));

console.log(JSON.stringify({
  cases: caseSummaries.length, transient_rows: stepRows.length,
  convergence_rows: convergenceRows.length,
  resistance_rows: scanRows.length, model_rows: modelRows.length,
}));
console.log('A_on steady:', JSON.stringify(caseSummaries[0]));
console.log('D legacy:', JSON.stringify(caseSummaries[3]));
