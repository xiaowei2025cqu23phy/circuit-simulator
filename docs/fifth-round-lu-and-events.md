> **更新（2026-10-29）：**本轮早期 LU 与逆矩阵数值一致性检验采用原始 `legacy-start` 激励采样；其后研究引入可选 `be-end`，旧数值一致性实验仍可证明相同激励下的代数后端一致，但不应作为端点采样物理精度数据。见 [第六轮时间离散核查](sixth-round-events-time-discretization.md)。

# Fifth research round: dense LU, scheduled switch boundaries, and device-model error

Date: 2026-10-29. This is a working research record, not a peer-reviewed validation or production release.

## 1. Direct engineering implementations

**Optionally reusable dense LU:** `compileCircuit(elements, dt, { linearSolver: 'lu' })`. The default remains `'inverse'`. `src/sim/linearSolve.js` uses partial row pivoting, `PA=LU`, forward and backward substitution. Both methods rebuild whenever the MNA coefficient matrix changes (PWL state, timer switch state, timestep, element conductance or topology). The implementation is **dense**, not sparse; no claimed speedup.

**Timed-switch boundary alignment:** `stepEngineAtScheduledEvents(engine, probeId)` checks the known `timeOn/timeOff` breakpoints inside the next nominal time interval, shortens that BE step if necessary, then lets the subsequent step begin at the boundary with ON interval `[timeOn,timeOff)`. When `dt` changes, it rebuilds the companion matrix. This does **not** solve for unknown voltage-triggered diode events, nor does it change ordinary `stepEngine` behavior.

The event-aware boundary flag is restored after the opt-in wrapper to avoid affecting later ordinary API calls.

## 2. Test and numerical evidence

45/45 actual JavaScript test functions executed and passed in a sandboxed V8 runner with Node assert/test shims. Normal `npm test`, `npm run lint`, and `npm run build` remain **not independently completed** because the repository cannot be cloned in the current execution environment and Actions is unavailable due to account billing.

In **20 matched paired experiments** from the actual JavaScript engine, 4 circuits × 5 state policies, 4,000 timesteps each at 10 µs, LU and direct Gauss-Jordan inverse reuse give the same number of linear solves and factorization/re-inversion events. Maximum node-voltage absolute differences across the five state policies per circuit:

| Circuit | Max | units |
| --- | ---: | --- |
| half-wave rectifier | 7.8426e-13 | V |
| bridge rectifier | 2.4869e-13 | V |
| double-sided clipper | 1.1102e-16 | V |
| inductor freewheel | 1.9645e-10 | V |

No state-iteration cap failures occurred in these paired runs. The full raw data are in `research/lu_inverse_parity_v8.csv`; reproducible wall-time benchmark is `scripts/compare-linear-solvers.mjs` (`npm run benchmark:hsp:lu > results.csv`). These data verify *equivalence on selected circuits*, not CPU acceleration.

## 3. Independent device-equation reference is NOT ngspice

For the forward-biased DC loop `Vs -> R=1 kΩ -> diode -> ground`, compare:
```text
Shockley+series Rs: Vs = I*(R+Rs) + n*VT*ln(1+I/Is), I >= 0
Is = 1e-12 A; n = 1.8; VT = 0.025852 V; Rs = 0.05 ohm
PWL off: I = Vs/(R+1e8 ohm), Vs <= 0.7 V
PWL on: I = (Vs-0.7 V)/(R+0.05 ohm), Vs > 0.7 V
```
Independent 501-point DC sweep at 0 to 2.5 V: RMS current difference approximately 0.19613 mA; maximum absolute difference approximately 0.28368 mA. At Vs = 1.0 V, Shockley predicts ≈0.13045 mA and PWL ≈0.29999 mA. Reference computation was made with a scalar bracketed solver (also reproducible in the standard-library script `research/physical_diode_dc.py`). The mismatch reflects **device-model choice**, not the linear algebra backend or diode switching delay.

No ngspice transient physical reference has been run, no laboratory data were collected, and no BJT/MOSFET models were implemented in the JS engine.

## 4. How to reproduce

```sh
npm ci
npm test
npm run lint
npm run build
npm run benchmark:hsp:lu > lu_comparison.csv
python3 research/physical_diode_dc.py > dc_reference.csv
```

Future work: dependable hardware timing, genuine external SPICE physical-model comparisons, unknown diode threshold event root finding, and parameter sensitivity on difficult switching circuits. Do not claim sparse LU, industrial-scale computational complexity, universal stability, or full device-physics accuracy.

Related published context: M. K. Camlibel, W. P. M. H. Heemels and J. M. Schumacher, “Consistency of a time-stepping method for a class of piecewise-linear networks,” *IEEE TCAS I* 49(3), 349–357 (2002), DOI: 10.1109/81.989170. Existing PWL network time-stepping work means novelty cannot rest on PWL or state-based non-Newton switching alone.
