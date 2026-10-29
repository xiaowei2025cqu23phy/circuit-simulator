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
