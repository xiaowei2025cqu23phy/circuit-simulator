# HSP-MNA 第九轮第三阶段：独立复核整改报告

日期：2026-11-01。分支 `research/hsp-mna-local-validation`，Draft PR #2（保持 Draft，未合并）。
复核基准：`de671af6beaf960321c2b42dfb84892bd90d24a0`。
本轮不增加功能、不扩大规模，只修复独立复核确认的缺陷、重跑被污染的数据、撤回错误结论。

**总状态：八项问题全部处理完毕。其中 7 项由代码修复 + 新增回归测试 + 重跑数据闭环；P0-3 中复核所述的"86 A 不一致"具体网表无法在本机复现（扫描 0 例），因此改为"按构造保证一致 + 强制触发失败路径测试"，并如实记录该局限。**

---

## 1. 八项问题状态表

| 编号 | 问题 | 状态 | 证据 |
|---|---|---|---|
| P0-1 | PWL 标定公式错误（参考点电流为 0） | **已修复并重跑** | `research/round9-stage3-calibration-check.csv`；`research/round9-stage3-diode-*.csv`（新版） |
| P0-2 | 事件细分成本漏计回滚试算；子步残量用错 dt/历史 | **已修复并重跑** | `research/round9-stage3-same-model.csv`；`src/sim/eventAccounting.test.mjs` |
| P0-3 | 状态迭代失败时解与器件状态可能不一致 | **已修复 + 契约化；原 86 A 网表未能复现** | `src/sim/stateFailure.test.mjs` |
| P0-4 | 性能脚本追加写、覆盖清单、可产生 NaN | **已修复** | `src/sim/perfStats.test.mjs`；`research/perf-runs/<runId>/metadata.json` |
| P1-1 | bootstrap 把进程内重复当独立样本 | **已修复并重算** | `research/round9-stage3-performance-corrected.csv` |
| P1-2 | ngspice 温度不一致导致错误归因 | **已修复并重跑** | DC 最大差 4.77e−7 A → 3.29e−10 A |
| P1-3 | 性能机制报告含未经证实的 GC 归因等 | **已修订** | 本文 §8；主报告勘误段 |
| P2 | manifest/日志/原始数据不可复现 | **已补齐并归档** | `research/round9-stage3-manifest-corrected.json`、`research/round9-stage3-erratum/` |

---

## 2. P0-1：PWL 标定公式

### 2.1 问题复现与根因

旧实现取 `V0 = V_ref`（参考电压本身），而线性支路 `i = g(v − V0)` 要经过 `(V_ref, I_ref)` 必须取

```
g_ref = di/dv|ref = (I_S + I_ref)/(n·V_T)
V0    = V_ref − I_ref/g_ref
```

旧式在参考点给出 `i(V_ref) = g_ref·(V_ref − V_ref) = 0`，即参考电流完全丢失（截距偏低约 `n·V_T ≈ 46.6 mV`）。因此旧报告中"按 1 mA 正确标定反而使模型变差（RMSE 0.349 V）"的结论建立在错误公式上，**撤回**。

### 2.2 修复与验证

`researchDiodeModels.pwlCalibrationAt(iRef)` 现返回 `{vf, gOn, vOn, vOff, vRef, gRef}`，并带自检量 `checkCurrentAtVRef`、`checkSlope`。单元测试 `researchDiodeModels.test.mjs` 断言：

- `gOn·(vRef − vf) = iRef`（相对误差 ≤1e−12；实测 1e−16 量级）；
- `gOn = (I_S+I_ref)/(nV_T)`（逐位相等）；
- 切线在凸曲线两侧均位于曲线下方且截距恒等式成立；
- 旧公式在同一参考点给出精确 0 A（作为勘误证据保留）。

`scripts/verify-pwl-calibration.mjs` 对 `iRef = 1e−7 … 1e−1 A` 输出对照表（`research/round9-stage3-calibration-check.csv`）：修正后参考点相对误差 ≤ 2.2e−15，旧公式全为 0。

### 2.3 重跑后的模型对照（10 µs，单节点 RC–二极管）

| 模型 | 峰值 | vs Shockley RMSE | vs Shockley 最大误差 |
|---|---:|---:|---:|
| A 研究迟滞 PWL（V_F=0.70, 20 S） | 0.700 V | 0.2523 V | 0.4171 V |
| A′ 1 mA 相切标定（V0=0.9183 V, 46.5 Ω） | 0.9663 V | 0.3174 V | 0.6062 V |
| A″ 100 µA 相切标定（V0=0.7039 V, 465 Ω） | 1.1605 V | **0.0912 V** | 0.1975 V |
| A‴ 1 mA 支路 + 固定 0.70/0.65 V 阈值 | 0.9663 V | 0.3174 V | 0.6062 V |
| B 单向 PWL（0.70 V, 20 S） | 0.700 V | 0.1650 V | 0.2662 V |
| C Shockley（Newton） | 0.9663 V | 0（基准） | 0 |

**更正后的科学结论：**

1. 标定公式已修正，参考点电流与斜率均满足。
2. 单斜率 PWL 的瞬态精度**强烈依赖参考电流**：1 mA 相切在低电流段过 stiff（RMSE 0.317 V），100 µA 相切明显更好（0.091 V）；"支路参数标定"与"阈值位置"分离实验（A‴ 与 A′ 数值几乎相同）表明本电路中阈值不是主导因素，**斜率与指数曲线形状不匹配**才是。
3. 无论取哪个参考电流，单斜率 PWL 与 Shockley 的模型差 ≥0.09 V，仍比数值离散误差（1.1 mV）大近两个数量级。**PWL 只能作为教学级宏模型，不能作为物理二极管精度主张。**
4. 旧版"标定更差 0.349 V"具体数值与因果表述作废；新版 A′ 0.317 V 是修正公式后的结果，两者不可混用。

---

## 3. P0-2：事件细分的成本统计与子步残量

### 3.1 问题与根因

1. 旧报告只统计 `diagnostics.linearSolves`（接受路径），未计入 `eventRejectedSolves`（回滚试算），因此把 24 支重负载网络 50 µs 的细分成本写成 940 次（+17.5%）。实际为 **940 接受 + 240 回滚 = 1180 次，相对预测 800 次增加 47.5%**，与独立复核一致。
2. 子步残量：一次细化后的名义步由多个子步组成，提交的是最后一个子步；旧脚本却用整步起始历史与恢复后的名义 `dt` 计算残量，量纲与矩阵都不对应。

### 3.2 修复

- 引擎新增**永不回滚**的工作计数器 `eng.work.{solveCalls,factorizationCalls,rankOneUpdateCalls,rankOneFallbackCalls}`；`stepEngineWithDiodeRefinement` 在接受每个子步时记录 `eng.lastAcceptedSegment = {dt, tStart, tEnd, historyBefore}`。
- `acceptedMnaResidual(eng, history, {dt})` 支持真实子步步长；脚本对细化步改用 `lastAcceptedSegment`。
- 同模型实验 CSV 现同时输出 `accepted_linear_solves`、`rejected_trial_solves`、`total_linear_solves`、`work_solve_calls`、`accounting_consistent`，并在计数不一致时直接抛错。

### 3.3 重跑后的成本（同器件模型，24 支重负载网络）

| 模式 | dt | 接受求解 | 回滚试算 | 总工作 | 相对预测 |
|---|---:|---:|---:|---:|---:|
| predicted | 10 µs | 4000 | 0 | 4000 | — |
| corrected | 10 µs | 4020 | 0 | 4020 | +0.5% |
| corrected+细分 | 10 µs | 4140 | 240 | **4380** | **+9.5%** |
| predicted | 50 µs | 800 | 0 | 800 | — |
| corrected | 50 µs | 820 | 0 | 820 | +2.5% |
| corrected+细分 | 50 µs | 940 | 240 | **1180** | **+47.5%** |

其他电路：rectifier 10 µs 细分 4076 次总工作（预测 4000，+1.9%）；freewheel 10 µs 细分 4019 次（+0.5%）。新增 5 项测试覆盖强制回滚、多层细分、子步残量、名义 dt 误用可检出、会计恒等式。

---

## 4. P0-3：状态迭代失败路径的一致性

### 4.1 复核结论与本机复现尝试

复核报告指出：迭代触顶时返回的电压解属于旧矩阵、器件状态属于新矩阵，按最终状态重建方程 KCL 误差可达约 86 A。

本机在 `de671af` 上对 {4 个预置电路 + 2 个重负载二极管网络} × 5 种状态模式 × 7 个步长（含事件细分）扫描 300 步，**未出现任何 `unresolvedSteps > 0` 的步**，因此无法用现有预置网络复现该具体数值。复核方使用的网表未随报告提供，本轮无法逐位对齐。

### 4.2 修复：显式失败契约（按构造保证一致）

新增研究选项 `maxStateIterations`（默认 12，允许 1–64，非法值报错），使失败路径可被强制触发与测试。触顶时执行：

1. 器件状态回滚到**最后一次真正求解过的状态**；
2. 丢弃可能属于更新后状态的矩阵缓存（`needsMatrixRebuild = true`）；
3. 对回滚后的状态**重新求解一次**，保证 `A(states)·x = b(history)` 精确成立；
4. 明确标记 `lastStepConverged = false`，并累加 `diagnostics.stateIterationFailures` 与 `unresolvedSteps`——失败步不会被报告为收敛步。

### 4.3 回归测试（`src/sim/stateFailure.test.mjs`，6 项）

- 强制 `maxStateIterations = 1` 时，rectifier / freewheel / diode_clipper 的每个失败步按最终状态独立重建方程的 KCL、KVL 残量均 < 1e−8（实测 ~1e−14 量级）；
- 失败计数器与 `lastStepConverged` 标记逐步一致；
- 失败后继续仿真 200 步，残量仍 < 1e−8（无陈旧矩阵缓存）；
- 预测模式单次求解、不会触顶；
- legacy `iterative` 失败路径同样自洽；
- 事件细分 + 强制失败时，会计恒等式 `work.solveCalls = accepted + rejected` 成立，每个接受子步残量 < 1e−8；
- 非法 `maxStateIterations`（0、−1、1.5、65）报错，默认仍为 12。

---

## 5. P0-4：可安全重复运行的性能实验流程

### 5.1 旧流程缺陷

- 探针向固定 CSV 追加写入：重跑产生重复表头；
- 运行清单被同名文件覆盖；
- 聚合端把非结果 CSV（清单）当数据解析，出现 2 个样本聚合为 3 条记录/2 组并产生 NaN。

### 5.2 新流程

- `run-stage3-perf.ps1` 每次生成唯一 `runId`（时间戳 + 随机后缀），建立 `research/perf-runs/<runId>/`，写入 `metadata.json`（runId、git SHA、工作区是否脏、Node/npm、CPU/OS、参数、随机种子、命令）；
- 每个 (case, solver, batch) 进程写**一个全新 CSV**，以 `wx` 模式打开，已存在即失败；**任何情况下不追加、不覆盖**；
- 每行携带 `run_id / process_id / sample_id / seed`；
- 聚合端 `perf-aggregate.mjs` 强制校验：必需列、列数、重复表头、重复记录键、跨文件重复、非有限数、非正时间；任一不满足即抛错退出，绝不产生 NaN；
- 顺序由 `seed + batch×1000 + caseIndex` 确定性洗牌，并写入 `order-manifest.csv`，可追溯。

### 5.3 验证

- 连续两次小规模运行：生成两个不同目录（各 3 个文件，哈希不同），互不污染；
- 用已存在的输出路径调用探针：退出码 1（拒绝覆盖）；
- 在证据文件末尾追加重复表头：聚合退出码 1（`重复表头`）；
- 追加重复数据行：聚合退出码 1（`重复记录键`）；
- 单元测试 `perfStats.test.mjs` 6 项覆盖上述解析/清洗规则与聚类统计。

---

## 6. P1-1：按独立进程重新处理性能显著性

### 6.1 方法

以**独立进程**为统计单位（每配置 3 个进程 × 3 次重复 = 9 样本），对进程做有放回重采样（2000 轮，固定种子），进程内重复整体保留（聚类 bootstrap）。预设证据门槛：**95% 聚类区间完全位于 1 的一侧**才可宣称方向；否则记为不确定。

运行：`run-20261101-204551-4c74d5`（3 进程 × 3 重复，297 样本，33 组）。

### 6.2 结果

| 场景 | 类别 | rank1/LU | 95% 聚类区间 | 判定 |
|---|---|---:|---|---|
| heavy-12 | D（更新+重建） | 1.357 | [1.080, 1.629] | LU 更快（本机） |
| heavy-24 | D | 1.367 | [1.278, 1.714] | LU 更快 |
| heavy-64 | D | 1.391 | [1.227, 1.879] | LU 更快 |
| heavy-128 | D | 1.796 | [1.311, 1.986] | LU 更快 |
| heavy-256 | D | 1.965 | [1.739, 2.214] | LU 更快 |
| light-96 | B（0 次更新） | 1.159 | [0.958, 1.193] | 不确定 |
| light-128 | B（0 次更新） | 0.930 | [0.748, 1.470] | 不确定 |
| light-256 | B（0 次更新） | 1.238 | [1.146, 1.426] | LU 更快 |
| rc-64 | A（无状态变化） | 1.232 | [1.127, 1.280] | LU 更快 |
| rc-256 | A | 0.982 | [0.978, 1.310] | 不确定 |
| timed-switch-24 | F | 1.815 | [1.567, 1.933] | LU 更快 |

**结论修订：**

- **撤回**"LU 在 10/11 场景显著更快"的表述；
- 修正为：本机 3 进程协议下，**7/11 场景 LU 显著更快、4/11 不确定、rank-one 从未显著更快**；
- heavy-12 在本机区间不含 1，但**独立复核的进程级区间 [0.981, 1.239] 含 1**，说明该小差异跨运行不稳定，因此**不作为论文级加速结论**，仅记为趋势；
- 可保留的有限结论：**当前未观察到 rank-one 在完整瞬态中的稳定加速**；在重负载多二极管场景中 LU 表现出方向一致的更短耗时，但具体幅度依赖机器与运行批次；
- 轻载 96/128/256 的成功秩一更新次数为 **0**（单步切换数 47/63/127 超过 `maxRankOneUpdates=32`），因此这些场景对"秩一加速"没有证据力，只能说明秩一后端退化为逆矩阵后端。

---

## 7. P1-2：ngspice 温度与归因修正

### 7.1 问题

自写 Shockley 使用 `V_T = 25.852 mV`（对应 300.0 K），ngspice 默认 `27 °C = 300.15 K`（`V_T = 25.864925786… mV`）。旧报告把 DC 4.77e−7 A 的差主要归因于收敛容差，不充分。

### 7.2 修复与重跑

- `researchDiodeModels` 现在由温度计算热电压（`kT/q`，默认 300.15 K），参数可显式覆盖；
- ngspice 网表显式写入 `.options temp=27`，与解析模型一致；
- 重跑 DC 扫描（501 点，0–2.5 V）：**最大电流差 3.287e−10 A**（旧值 4.77e−7 A）；
- 瞬态对照（自写 Shockley vs ngspice，BE，1 µs 参考网格）：10 µs RMSE **1.135e−3 V**（最大 2.532e−3 V）；50 µs 6.10e−3 V；100 µs 1.214e−2 V，呈一阶收敛。

**归因修正：** 旧 DC 差异主要来自温度/热电压参数不一致，而不是收敛容差。统一参数后，剩余差异属于 ngspice 自身容差与实现差异。

---

## 8. P1-3：性能机制表述修订

原文把"减少分解但仍更慢"部分归因于 GC。现在严格分层：

**代码分析可直接支持的事实**

- `inverse`/`inverse-rank1` 的回退分解是 Gauss–Jordan 完整求逆（构造并消去 `n×n` 单位阵，约 `2n³` 运算），`lu` 是部分主元 LU（约 `n³/3`）；二者不是同一种"分解"。
- 秩一更新每次分配并写满一个 `n×n` 矩阵（`updateInverseForConductanceBranch` 内的 `map`），属 O(n²) 但有整块分配。
- 逆矩阵右端求解是逐行点积（`A_inv[i][j]*b[j]`），LU 是前代/回代连续访问。

**计时数据支持的观察**

- heavy-256：`inverse` 21 次分解 3013 ms（≈143 ms/次），`lu` 21 次 492 ms（≈23.4 ms/次），单次比值≈6.1×；`inverse-rank1` 9 次 1154 ms（≈128 ms/次），秩一更新 136 次共 352 ms；
- 中位堆占用：`inverse` 10.5 MB、`lu` 16.3 MB、`inverse-rank1` 29.3 MB（不同运行间波动，非因果证明）。

**仍属推测、未经独立验证**

- 堆占用升高与 GC 停顿对墙钟时间的贡献比例（本轮未采集独立 GC/profiler 数据）；
- 缓存/内存带宽对逆矩阵 matvec 常数的具体影响。

**交叉条件公式修正：** 秩一方案优于 LU 的近似条件应为
`N_factor·(t_inv − t_lu) < N_update·t_update + N_step·(t_matvec − t_trisolve)`，
其中 `t_inv ≈ 5.5–6× t_lu`（256 阶实测），`N_factor` 为回退求逆次数。原文把"减少分解次数"直接当作收益，忽略了单位代价差。

---

## 9. P2：可复现性与归档

- `research/perf-runs/run-20261101-204551-4c74d5/`：`metadata.json`（git SHA、脏工作区标记、Node/npm、CPU/OS、参数、种子、命令）、`order-manifest.csv`、`raw/`（99 个进程文件）、`summary.csv`、`summary.json`、`source-hashes.json`（13 个源文件 SHA-256）。
- `research/round9-stage3-manifest-corrected.json`：汇总全部产物哈希、版本、参数与退出码。
- 被取代的实验全部移入 `research/round9-stage3-erratum/`，文件名带 `_SUPERSEDED`，包括旧的性能原始数据、同模型表、二极管表、反电流表与旧版报告。
- 缺失日志：`research/round9-stage3-diode-models.log` 与 `same-model.log` 原为控制台输出未落盘，本轮已重新生成 `research/round9-stage3-same-model-corrected.log` 与 `research/round9-stage3-diode-models-corrected.log`；`research/perf-run.log` 对应旧流程，已被 `research/stage3-perf-corrected-run.log` 取代，旧日志保留在勘误目录。

---

## 10. 论文结论：撤回 / 修改 / 保留

### 必须撤回

1. "按 1 mA 正确标定反而使模型变差（0.349 V）"——建立在错误标定公式上。
2. "LU 在 10/11 场景显著更快"——旧统计把进程内重复当作独立样本。
3. "ngspice DC 差异主要来自收敛容差"——主因是温度/热电压不一致。
4. "事件细分相对预测增加 17.5% 求解"——应为 47.5%（24 支/50 µs）。
5. "减少完整求逆 21→9 次是性能收益"——单位分解代价不同（5.5–6×），实测更慢。

### 必须修改

1. PWL 标定：明确 `V0 = V_ref − I_ref/g_ref`，并报告参考点验证与参考电流敏感性（1 mA vs 100 µA）。
2. 状态迭代失败：必须声明"失败步回滚到最后求解状态并重解，标记为未收敛，不得当作收敛步"。
3. 性能显著性：以独立进程为单位给出区间，小差异跨运行不稳定时不得宣称胜负。
4. 事件细分成本：同时报告接受、回滚与总工作。
5. 机制分析：区分代码事实、计时观察与未验证推测（尤其 GC）。

### 可以保留

1. 无动态元件残量诊断修复及其回归测试（86/86 原生通过）。
2. 迟滞 PWL 在迟滞带内允许反向 ON 电流的结论（与标定无关，模型定义事实）。
3. 秩一更新在桥式整流需要安全回退的结论。
4. 同模型下端点校正显著优于单步预测（rectifier 10 µs：1.27 mV vs 13.75 mV）。
5. "当前未观察到 rank-one 在完整瞬态中的稳定加速"这一有限、可复现的实验结论。

---

## 11. 复现命令

```bash
npm ci && npm test && npm run lint && npm run build

# 标定审计
node scripts/verify-pwl-calibration.mjs

# 器件模型对照（自动查找便携 ngspice）
node scripts/compare-diode-models.mjs

# 同模型算法比较（含总成本与子步残量）
node scripts/compare-hsp-same-model.mjs

# 性能协议：每次生成唯一运行目录，拒绝覆盖
pwsh -File scripts/run-stage3-perf.ps1 -Batches 3 -Reps 3 -Warmup 1 -Seed 20261031
node scripts/perf-aggregate.mjs --run=research/perf-runs/<runId>
```

---

## 12. 局限与未完成

1. 复核所述 86 A 具体网表未提供，本机扫描未复现；修复按"构造保证 + 强制路径测试"完成，但未与该具体案例逐位比对。
2. 性能结论仍是单机、单 Node 版本、3 个独立进程；heavy-12 的方向在不同运行间不稳定，已降级为趋势。
3. ngspice 仅验证 Shockley 链路，未验证 PWL 模型、温度扫描、串联电阻、结电容与反向恢复。
4. 主文缺失的 Python 单节点复现材料仍未提供，本轮未改动论文原稿。
5. GC/profiler 数据未采集，相关归因已明确标注为推测。

---

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
