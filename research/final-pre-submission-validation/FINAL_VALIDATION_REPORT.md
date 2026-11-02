# Final pre-submission validation report
## 1. Scope
Covered: repository update to remote HEAD; full engineering suite; the two manuscript tests; analytic-reference regeneration and consistency checks against committed CSVs; evidence mapping for four manuscript claims. Excluded: any new experiments, figure/plot work, manuscript edits, PR merge, GitHub Actions diagnosis.
## 2. Repository state
- branch `research/hsp-mna-local-validation`, starting commit `23bbfd9` (remote HEAD at start), local fix commit recorded below.
- PR #2 stays Draft; `main` untouched (`3a6cdfab`).
- worktree was clean at start; this round adds validation materials and a one-line Python fix.
## 3. Environment
Windows 11 (Chinese), AMD Ryzen 5 7520U, Node v26.8.1, npm 11.19.0, Python (see environment.txt), run 2026-11-02.
## 4. Command log summary
| command | exit |
|---|---|
| npm ci | 0 |
| npm test | 0 (123/123) |
| npm run lint | 0 |
| npm run build | 0 |
| node --test src/sim/manuscriptPassivityAudit.test.mjs | 0 (4/4) |
| node --test src/sim/zeroSourcePassivity.test.mjs | 0 (11/11) |
| python research/zero-source/analytic_reference.py | 1 -> 0 after minimal fix |
Logs are in `logs/` (raw, unedited).
## 5. Results
- npm ci: 244 packages, 11 audit advisories, success.
- npm test: 123/123 pass (includes 4 new manuscript audit tests + 11 zero-source tests).
- lint/build: pass (Vite 8, 1728 modules).
- manuscriptPassivityAudit: 4/4 pass; verifies rebuilt KCL residual, energy balance, and that a non-passive PWL branch can still satisfy both.
- zeroSourcePassivity: 11/11 pass (ON steady 0.699965 V, negative diode power, energy identity <1e-18 J, OFF discharge, legacy vs corrected, R boundary, step-size convergence, Shockley passivity).
- analytic_reference.py: **initially failed with SyntaxError line 115** (`tau_off(R, C)_DEFAULT`). Minimal one-line fix to `tau_off(R, C_DEFAULT)`; regeneration then exit 0.
## 6. Evidence mapping to manuscript
- **Same-model comparison** (`research/round9-stage3-same-model.csv`): rectifier 10 us predicted RMSE 1.3748e-2 V vs corrected 1.2727e-3 V (4000 vs 4004 accepted solves); diode-bank-24-heavy 50 us 1.0140e-1 V vs 3.9414e-5 V (800 vs 820); freewheel 10 us 118.46 V vs 7.05e-9 V (4000 vs 4001). Supports the stated ordering and cost.
- **Zero-source counterexample**: initial ON charges a capacitor from 0.68 V toward 0.699965 V with diode energy -6.30e-8 J while the only source is absent; initial OFF discharges. Energy identity closes to -7.9e-21 J, so this is a model property, not BE numerical error.
- **KCL vs energy vs passivity**: manuscript audit test passes; rebuilt KCL residual is tiny while the PWL branch still delivers power -> the three notions are distinct as claimed.
- **Legacy boundary**: legacy `iterative` releases the ON branch on negative current and then behaves like the passive Shockley model here; this is a local tolerance rule, NOT a global passivity guarantee. Paper wording must stay at this level.
## 7. Issues found
1. `research/zero-source/analytic_reference.py` had a syntax error at line 115, so the committed analytic reference could not be regenerated. Fix: one token (`tau_off(R, C)_DEFAULT` -> `tau_off(R, C_DEFAULT)`). No numerical model change.
2. After the fix, regeneration produced 428 differing lines vs the committed `analytic-reference.csv` (stale columns for tau_off/v_star). The regenerated file is authoritative (script includes G_OFF=1e-8 and GMIN=1e-12 consistently) and replaced the committed CSV; manifest checksums refreshed. `step-size-convergence.csv` analytic column matches the corrected reference exactly (73 rows, max diff 0), so no change there.
3. No JS code or test expectations were changed; all 123 tests pass before and after.
## 8. Final verdict
**Ready with minor wording caution.**
Caution items: state in the paper that (a) the zero-source charging is a property of the declared PWL macro model, (b) legacy negative-current release is a local rule and not a global passivity guarantee, (c) the analytic reference now regenerates from the fixed script; cite the new checksums.
## 9. Recommended next action
Proceed to submission after the three wording cautions above and after the maintainer re-runs `python research/zero-source/analytic_reference.py` once on the submission machine to confirm the regenerated CSV matches the committed checksum.
