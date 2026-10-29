
> **2026-10-29 第六轮勘误：**本文件下文涉及的旧定量比较采用源信号在区间起点采样（`legacy-start`）；后向欧拉受迫更新应取 `t_{n+1}`。最新统一采样方法及结果见 [第六轮报告](sixth-round-events-time-discretization.md) 和 [BE-end 研究表](../research/four_mode_be_end_v8_results.csv)。过去的误差值保留为历史记录，不应被视为最新准确性结论。

# HSP-MNA experimental solver mode

The existing default diode solver remains the baseline: `compileCircuit(elements, dt)`.
The optional predictor is selected by `compileCircuit(elements, dt, { diodeSolver: 'predicted' })`. Same-model alternatives: `diodeSolver: 'guarded'` (set `correctionGuard: 0.015` in volts) and `diodeSolver: 'hysteretic-corrected'`. Both share the exact 0.70/0.65 V hysteresis law with the predictor, unlike the legacy default's reverse-current release rule.

Both solvers use the same two-state PWL diode equivalent circuit. The predicted mode uses the **previous accepted** node solution with hysteresis thresholds 0.70 V (turn-on) and 0.65 V (turn-off), and performs one linear solve per time step. It does not enforce a current-step diode complementarity condition. Therefore it is an **approximate experimental method**, not a drop-in precision replacement.

### Diagnostics

`engine.diagnostics` holds cumulative counters:

| Counter | Meaning |
| --- | --- |
| `steps` | Completed time steps |
| `linearSolves` | Number of matrix-vector solves |
| `matrixRebuilds` | Matrix inversions after a state change |
| `stateDisagreements` | Current-step states inconsistent with the hysteresis thresholds (predicted mode) |
| `unresolvedSteps` | Iterative steps failing to settle within 12 iterations; keep the final solved matrix/state pair and record a warning counter |

### Reproduction

Run `npm test`. The new `src/sim/research.test.mjs` is independent of UI code.
For a proper method comparison, use matching circuits, time grids, parameter sets and PWL models. Compare against high-resolution event-localized reference solutions before making claims about speed or precision. These counters are **not measured wall-clock speedups**.

Limitations: The predictor can lag threshold crossings by a time step and its hysteretic state machine changes the model near boundaries. The existing iteration cap can fail: the engine now records the event, retains the last state used to form the solved system, and leaves the physical state-consistency error unresolved. The counter is necessary to identify these failures. GMIN is not a general guarantee of MNA nonsingularity.


### Independent numerical experiment (not a JavaScript engine benchmark)

The companion Python one-node RC–diode study uses `R=1 kΩ`, `C=1 μF`, `g_on=5 mS`, `g_off=10⁻⁸ S`, `V_F=0.70 V`, hysteresis `0.72/0.68 V`, and `V_s=1+sin(2π·200t)` over 40 ms. These parameters intentionally differ from the JavaScript engine defaults (particularly `g_on` and thresholds) and must not be described as measured results from this repository.

The independent script compares historical prediction and endpoint state correction against the same PWL event-localized reference. At 10 μs it reports RMSE 1.20659/1.15229 mV (prediction/correction), with 1.000/1.004 linear solves per time step; at 200 μs it reports 30.13172/21.51731 mV and 1.000/1.080 solves per step. These are illustrative numerical results, not evidence of browser speedup. The scripts and raw CSV belong in the manuscript reproducibility bundle.

### Known limitations and follow-up

- The default solver uses a 0.7 V turn-on threshold and a negative-conduction-current release test, while the experimental predictor uses a 0.70/0.65 V hysteretic voltage state machine. Therefore their differences reflect **both** state-selection policies and threshold policy; a strict apples-to-apples study should first standardize the switching law and handle the non-convergence near threshold.
- The DEFAULT engine still uses a Gauss–Jordan inverse; the research branch now additionally implements opt-in partial-pivot **dense LU** with factorization reuse via `{linearSolver:'lu'}`. Sparse LU remains unimplemented.
- The repository presently implements no BJT or NMOS device models. Planned device stamps in the paper must not be described as tested features.

### Three-mode engine comparison

See [`three-mode-benchmark.md`](three-mode-benchmark.md) for 4 predefined circuits × 3 step sizes × 3 strategies, reference conditions, CSV provenance, and the freewheel counterexample (single-step predicted -7.5 kV node excursion). All engine results were evaluated in an isolated V8 JavaScript environment; npm/CI, Node timing and external SPICE validation are pending. The `guarded` solver is not universally better than either extreme. Do not assert general speed superiority on the basis of linear-solve counts alone.
