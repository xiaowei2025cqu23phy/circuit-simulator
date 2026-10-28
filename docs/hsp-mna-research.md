# HSP-MNA experimental solver mode

The existing default diode solver remains the baseline: `compileCircuit(elements, dt)`.
The optional predictor is selected by `compileCircuit(elements, dt, { diodeSolver: 'predicted' })`.

Both solvers use the same two-state PWL diode equivalent circuit. The predicted mode uses the **previous accepted** node solution with hysteresis thresholds 0.70 V (turn-on) and 0.65 V (turn-off), and performs one linear solve per time step. It does not enforce a current-step diode complementarity condition. Therefore it is an **approximate experimental method**, not a drop-in precision replacement.

### Diagnostics

`engine.diagnostics` holds cumulative counters:

| Counter | Meaning |
| --- | --- |
| `steps` | Completed time steps |
| `linearSolves` | Number of matrix-vector solves |
| `matrixRebuilds` | Matrix inversions after a state change |
| `stateDisagreements` | Current-step states inconsistent with the hysteresis thresholds (predicted mode) |
| `unresolvedSteps` | Iterative steps failing to settle within 12 iterations; the engine throws |

### Reproduction

Run `npm test`. The new `src/sim/research.test.mjs` is independent of UI code.
For a proper method comparison, use matching circuits, time grids, parameter sets and PWL models. Compare against high-resolution event-localized reference solutions before making claims about speed or precision. These counters are **not measured wall-clock speedups**.

Limitations: The predictor can lag threshold crossings by a time step and its hysteretic state machine changes the model near boundaries. The existing iteration cap can fail; failure is now explicit rather than silently accepting an inconsistent matrix solution. GMIN is not a general guarantee of MNA nonsingularity.
