# 第九轮后续复核：多拓扑 MNA、独立方程残量与二极管模型边界

日期：2026-10-30。研究分支 research/hsp-mna-local-validation；Draft PR #2。本文是新研究补充，既不是 main 发布说明，也不是 ngspice 或物理器件验证。

## 1. 新增哪些工作

上一个第九轮验证的实际 Windows/Node v26 日志支持旧 67/67 测试通过。本轮额外在研究分支完成：

1. 原 src/sim/research.test.mjs 中重复定义的 ptToStr 改为直接从 engine.js 导入，避免将来和生产节点取整语义漂移。
2. 校正 docs/hsp-mna-round9-validation.md：桥式整流是 8 次成功秩一更新、4 次安全回退，不是 8 次回退；旧 Node 测试日志总耗时 6476.89 ms（约 6.48 秒），而非约 4.9 秒。
3. 新增 src/sim/researchCircuits.js，生成基于元件的 4/12/24 二极管并联支路，以及 4/8/16 级 RC、RL、RLC 网络。轻负载与重负载二极管网络分别用于首次共同切换和连续重复切换。
4. 新增 src/sim/mnaResidual.js：保存求解前的电容电压、电感电流，在求解后重新组装当步接受 MNA 系统的 RHS 和矩阵，检验线性残量。无历史的错误 RHS 在测试中触发残量明显增大（正确残量约 7e-18、错误历史残量约 0.0329）。
5. 新增 src/sim/multiTopology.test.mjs 共 7 项测试、scripts/benchmark-multi-topology.mjs 实际 transient engine 计时脚本及 npm 命令 benchmark:hsp:topologies。
6. 新增 scripts/inspect-pwl-current-direction.mjs，定量揭示模型可能允许 ON 二极管反向电流。

**证据状态：** 原有 67 项与新增 7 项合计 74/74，在隔离 V8 执行真实 GitHub JavaScript 测试逻辑通过；但这些新增提交之后还没有用户本机最新的原生 Node npm test、lint、build 日志。旧 PR 内的 67/67 原生 Node 日志只适用于当时旧 commit，不能自动证明最新 74 项的原生 npm 测试已通过。

## 2. 真正的 MNA 拓扑与统一配置

| 拓扑配置 | 分支/级数 | MNA 阶数 | 器件测试重点 |
|---|---|---|---|
| 轻负载 R-D-(R‖C) 并联 | 4 / 12 / 24 | 10 / 26 / 50 | 同一步首次多个二极管导通 |
| 重负载 R-D-(R‖C) 并联 | 4 / 12 / 24 | 10 / 26 / 50 | 重复 ON/OFF，累积秩一更新及定期回退 |
| 多级 RC | 4 / 8 / 16 | 6 / 10 / 18 | BE 电容伴随与历史电压 |
| 多级 RL | 4 / 8 / 16 | 10 / 18 / 34 | 电感支路附加未知量及历史电流 |
| 多级 RLC | 4 / 8 / 16 | 14 / 26 / 50 | R、L、C 耦合，KCL 和 KVL |

每个电路经真实 compileCircuit/stepEngine 而非随机矩阵建模。统一使用 diodeSolver=hysteretic-corrected、sourceSampling=be-end、时间步 50 µs、仿真总长 40 ms（800 步），分别比较 inverse、lu、inverse-rank1 的全部 MNA 解向量和输出端口电压。在若干时间步及所有二极管状态改变步重新构建已接受方程，计算原始矩阵残量。

**本轮结果支持同一迟滞 PWL 方程的数值计算一致性，不支持真实肖特基/硅二极管物理精度。**

## 3. 15 拓扑 × 三后端的数值结果

45 组 V8 数值执行结果归档于 research/round9-multitopology-v8-parity.csv；所有计时字段均已**从该表中删去**，不得冒充本地 Node 原生性能。

- 所有 MNA 电压与电流未知量混合向量的最大绝对差约 1.47e−11，**不能因为包含支路电流而整体称为 V**。
- 终端电压的跨后端最大差约 8.06e−13 V。
- 检查过的 accepted MNA 各行最大原始残量约 2.28e−11，**此值混合 KCL 和 KVL 量纲**，不能整体称为安培或伏特。
- 在上述明确列出的算例与参数下没有 unresolved steps，也没有端点迟滞状态不一致。

| 重点网络 | 阶数 | 同一步最大切换数 | 原完整求逆次数 | 秩一方案完整求逆 | 成功秩一更新 | 分母病态回退 |
|---|---:|---:|---:|---:|---:|---:|
| 24 支轻负载并联二极管 | 50 | 24 | 2 | 1 | 24 | 0 |
| 24 支重负载并联二极管 | 50 | 24 | 21 | 3 | 68 | 0 |

轻负载网络会长期保持导通，只能验证首次联合事件；重负载网络能在两个 AC 周期内反复 ON/OFF，完整求逆次数增加 2 次主要来自 maxRankOneUpdates 安全上限，而不是病态分母触发。**以上矩阵操作计数不是耗时加速数据。**

## 4. 重要模型限制：迟滞状态一致不意味着单向电流一致

现有 ON 支路采用 i_D=g_on(v_D−0.70)，其中 g_on=1/0.05=20 S。当前研究迟滞状态机仅在 ON 态 v_D 小于 0.65 V 时切换至 OFF。因此，在 0.65≤v_D<0.70 V 的区间，二极管虽然被标记为 ON，公式仍允许从约 −1 A 到 0 A 的电流。

这一点是既有 PWL 宏模型的数学事实，不是求解器精度或物理反向恢复实验结果。

隔离 V8 对四支并联二极管、800 步的测量：

| 配置 | ON 态样本 | 其中 i_D<−10 µA 样本 | 最小 ON 电流 | 状态变化次数 | 状态不一致 |
|---|---:|---:|---:|---:|---:|
| 轻负载 | 3180 | 1670 | −8.271 mA | 4 | 0 |
| 重负载 | 1832 | 320 | −0.994 A | 16 | 0 |

原始结果在 research/round9-pwl-reverse-current-v8.csv。**stateDisagreements=0 只能说明人为规定的两阈值状态机自洽，不能证明物理二极管非负电流约束。**

如果日后将 ON 支路非负电流互补性、OFF 阈值等条件加入，必须将其当作一个新的研究器件模型，重新生成之前所有 PWL 误差数据；不能在不重跑实验的情况下静默替换并保留旧结论。

## 5. 复现和本机执行门槛

新的 Node benchmark 直接计时 compileCircuit 和 stepEngine，包含真正的 RC/RL/RLC 伴随量、状态切换、矩阵缓存与回退。它在独立的非计时验证阶段核对全部代数未知量、探针电压、PWL 状态和重建的 MNA 方程残量；在计时阶段预热、旋转策略执行顺序，多次重复并输出中位数和四分位数。不对浏览器/UI 性能或外部 SPICE 做任何声称。

在用户本机或 Codex 的独立 worktree 上执行：

    git fetch origin
    git switch research/hsp-mna-local-validation
    git pull --ff-only
    npm ci
    npm test
    npm run lint
    npm run build
    npm run benchmark:hsp:topologies > research/round9-multitopology-node.csv
    node scripts/inspect-pwl-current-direction.mjs > research/round9-pwl-reverse-current-node.csv

须保存新的完整 stdout、stderr、退出码、Node、npm、CPU、OS 信息。没有最新原生 Node 日志时，不能把 74/74 隔离 V8 结果写成 74/74 原生 Node 测试通过。

## 6. 仍有待完成的投稿任务

- 本次最大的真实元件拓扑是 50 阶 MNA；尚没有 128 阶以上带实际非线性状态的电路瞬态。
- 未运行 ngspice / Shockley 模型对照，单边电流物理一致性问题尚未解决。
- 第八轮整合稿部分早期 Python 单节点实验缺少可直接复跑的脚本、依赖锁文件和完整原始数据；本轮没有擅自修改论文主稿。
- 尚未完成内存/GC、工业稀疏 MNA、全面病态网格、浏览器端到端性能及教学学习效果验证。

**建议：** PR #2 保持 Draft，main 不变。本文件是新增研究附录，不应直接写成已经具备物理验证与完整工程数据的投稿终稿。

---

# 7. 原生 Node 复核（2026-10-30，接手最新提交后）

本节由接手者在本机原生 Node 环境执行，把上文"尚未运行"的项目补齐；上文 V8 数据保持原样，两者分列，不互相替代。

**环境：** Windows 11 家庭版、AMD Ryzen 5 7520U、Node v26.8.1、npm 11.19.0；起点 commit `06025ac302efb510db09ac089f3cea9019e5dfde`（`git merge --ff-only` 快进，工作区此前干净）。

**工程命令实测：** `npm ci`（244 packages，11 项依赖审计告警）、`npm test` **76/76 通过**、`npm run lint` 通过、`npm run build` 通过（1728 modules，gzip 87.39 kB）。测试数由 74 增至 76，因为本轮新增两项加固测试（见 7.1），不是放宽旧断言。

## 7.1 残量诊断的两处实现缺陷（已修复）

审查 `src/sim/mnaResidual.js` 时发现并修复两个问题，均有回归测试：

1. **KCL/KVL 量纲未分离。** 原实现只返回一个把节点行（安培）与支路行（伏特）混合的标量。现在分别返回 `kclAbsolute/kclRelative` 与 `kvlAbsolute/kvlRelative`，并保留 `absolute/relative` 兼容旧 CSV；benchmark 新增 `max_kcl_residual_a`、`max_kvl_residual_v` 两列。
2. **空历史对象被静默当作零历史。** 传入 `{}` 时原实现把缺失的历史当 0 计算，返回看似合理但无意义的残量。现在要求：动态元件历史要么完整（全部有限值），要么（仅第一步）为空；部分缺失直接报错。回归测试用"完整但清零"的历史验证灵敏度，并断言 `{}` 必须抛错。

修复过程中还暴露一个真实缺陷：把历史访问改为严格取值后，第一步（历史为空）产生 `NaN` 残量。该问题已定位并以 `(stateBeforeStep[id] ?? 0)` 修复，测试覆盖首步与后续步两种情形。

## 7.2 原生多拓扑计时（45 行，5 次重复）

`npm run benchmark:hsp:topologies` → `research/round9-multitopology-node.csv`。数值列与 V8 parity 表逐位一致（同一算法），计时为本机新增。中位数（ms，800 步、dt=50 µs）：

| 电路（MNA 阶数） | inverse | LU | inverse-rank1 | 全分解数 inv/LU/rank1 |
|---|---:|---:|---:|---|
| diode-bank-24 light（50） | 119.78 | **100.20** | 114.67 | 2 / 2 / 1（+24 更新） |
| diode-bank-heavy-24（50） | 126.63 | **108.31** | 125.95 | 21 / 21 / 3（+68 更新） |
| rc-ladder-16（18） | 57.37 | 58.66 | **50.66** | 1 / 1 / 1 |
| rlc-ladder-16（50） | 67.77 | **64.70** | 65.06 | 1 / 1 / 1 |

**负结果（必须保留）：** 减少完整求逆次数并不等于更快。24 支重负载网络中 rank-one 把完整求逆从 21 次降到 3 次，但实际时间反而比 LU 慢；32 个电路中只有 3 个 rank-one 快于 LU，27 个以 LU 最快。原因可直接读代码：rank-one 每次更新仍是 O(n²) 的整块逆矩阵写入，而逆矩阵后端每步还要 O(n²) 矩阵乘向量。

## 7.3 更大规模真实器件网络（64/96/128/256 阶）

新增 `scripts/benchmark-large-mna.mjs`（`npm run benchmark:hsp:large`）→ `research/round9-large-mna-node.csv`（51 行，3 次重复）。所有规模均由真实电阻/电容/电感/二极管/独立源经 `compileCircuit` 组装，阶数由元件数与电压源支路电流决定：

- 64 阶：RC 62 级、RL 31 级；二极管 31 支（128 元件 / 127 元件）。
- 96 阶：RC 94 级、RL 47 级；二极管 47 支。
- 128 阶：RC 126 级、RL 63 级、RLC 42 级；二极管 63 支（255 元件）。
- 256 阶：RC 254 级、RL 127 级；二极管 127 支（511 元件）。

中位数（ms）：

| 电路 | inverse | LU | inverse-rank1 | 全分解（rank1） |
|---|---:|---:|---:|---:|
| heavy bank 64 | 436.82 | **328.94** | 644.42 | 3（inverse 21） |
| heavy bank 128 | 1532.62 | **895.00** | 1063.58 | 5（inverse 21） |
| heavy bank 256 | 5409.19 | **2002.47** | 3766.43 | 9（inverse 21） |
| rc ladder 256 | 1215.25 | **1107.39** | 1270.03 | 1 |
| rl ladder 256 | 726.68 | **526.43** | 759.95 | 1 |

- 128 阶时 63 支二极管可在同一步全部切换；256 阶时 127 支可同步切换（`max_joint_diode_transitions`）。
- 所有大电路 `unresolved_steps = 0`；最大 KCL 残量 2.27e−11 A、最大 KVL 残量 3.34e−13 V、三后端 MNA 未知量最大差 6.53e−11（电压与支路电流混合单位）。
- 本机为共享笔记本、3 次重复、Q1–Q3 明显展宽；绝对毫秒数不可跨机比较，只用于方向性判断。256 阶 full factorization 的计数较少（2–21 次）来自 maxRankOneUpdates 上限与非同步切换，不是病态回退。

## 7.4 反向 ON 电流的独立复核

1. `node scripts/inspect-pwl-current-direction.mjs` → `research/round9-pwl-reverse-current-node.csv`，原生 Node 精确复现 V8 数值（−8.27120888477 mA / −0.994242826234 A，`stateDisagreements=0`）。
2. 新增 `scripts/verify-pwl-reverse-current.mjs`（`npm run verify:pwl-current`）→ `research/round9-pwl-reverse-current-independent.csv`：不调用任何引擎线性求解代码，独立重写 MNA 装配与带部分主元的高斯消元，在最负样本步重新求解。结果：与引擎解最大差 **5.55e−17**（轻载）/ **1.69e−14**（重载），独立残差 1.42e−14 / 5.33e−15。→ **负电流是模型定义的必然结果，不是符号或求解器错误。**
3. 更关键的新证据：把 legacy `iterative` 基线一起测（它有 i_D < −1 µA 释放规则）：

| 状态算法 | 负载 | ON 样本 | 负电流样本 | 最小 ON 电流 |
|---|---|---:|---:|---:|
| iterative | light | 1250 | 0 | +3.59e−6 A |
| iterative | heavy | 1512 | 0 | +9.52e−3 A |
| hysteretic-corrected | light | 3180 | 1670 | −8.27e−3 A |
| hysteretic-corrected | heavy | 1832 | 320 | −0.994 A |

**这意味着四/五种研究状态模式与 legacy 基线不只是"状态时序不同"，而是"ON 支路是否允许反向导通"这一器件行为不同。** 任何研究模式与 iterative 的波形/误差对照都同时改变了时序与电流容许性，论文必须显式声明；只有研究模式之间才共享同一迟滞 law。

最负样本的支路电压：轻载 0.69959 V（贴近 0.70 V），重载 0.65029 V（几乎贴住 0.65 V 关断阈值）。也就是说，重载情形下模型允许 ON 支路一直反向导通到迟滞下边界才关断。

## 7.5 本轮仍未解决

- 物理二极管精度：未运行 ngspice/Shockley 瞬态；反向电流说明当前 ON 支路不具备单向导电性，不能作为物理二极管模型。若引入互补性/连续 PWL 模型，前八轮全部 PWL 误差数据需重跑。
- 大电路仅覆盖梯形与并联二极管两类拓扑；没有随机稀疏网表、没有内存/GC 统计、没有浏览器端到端计时。
- 反向电流对整流类波形的定量影响尚未量化（需要新增"单向电流"参考模型对照实验）。
- 第八轮整合稿缺少的 Python 单节点复现材料依然缺失，本轮未改动论文原稿。
