# 第八轮：原生 Node.js 稠密 MNA 规模实验及右端复用敏感性

**2026-10-29，研究分支 research/hsp-mna-validation。**

> 本轮的真实计时来自 Node.js v22.16.0（Linux Debian 13，共享 AMD EPYC 9V74 容器，cgroup CPU 配额约四核份额），使用当前研究仓库的 linearSolve.js、rankOneUpdate.js，以及与 engine.js 对应的 Gauss–Jordan 逆矩阵算法，在合成 MNA 型线性网络上进行。**这不是 React/EDA 整体仿真、不是 SPICE 器件物理模型验证，也不是工业稀疏 MNA 性能基准。** 不能将表中计时比直接称为平台加速比。

## 实验结构与规则

矩阵维数 n=8、16、32、64、96、128，其中 n−1 个节点电压与一个理想电压源支路电流。节点与地、相邻节点、相距三节点均连接线性电导；末端两个节点之间有一条 PWL 二极管式电导（1e−8 S↔20 S）。拓扑非零元较少，**但是当前三个算法均使用稠密数组**。右端由固定三角函数公式生成，不同后端的数学输入完全一致。

主实验：24 次导纳变化，每次变化对应 8 个右端，共 192 次线性系统求解；每种方法预热后轮换执行顺序，重复运行七次。报告耗时中位数、Q1/Q3，并检查方程残差和相对 Gauss–Jordan 解的最大绝对差。此合成网络的残差均约为 1e−14，最大差小于 1.6e−14；不代表病态网络均有同等精度。

| MNA 阶数 | Gauss–Jordan(ms) | 稠密 LU(ms) | 保护秩一更新(ms) |
| ---: | ---: | ---: | ---: |
| 8 | 1.969 | **0.949** | 1.064 |
| 16 | 2.890 | **1.132** | 2.087 |
| 32 | 12.904 | **3.287** | 9.037 |
| 64 | 87.903 | **17.716** | 25.687 |
| 96 | 216.825 | 47.296 | 47.032 |
| 128 | 465.226 | 117.380 | **91.665** |

[原始计时 CSV](../research/node22_mna_scaling_results.csv)。

在本合成拓扑，Gauss–Jordan 和 LU 都需要 25 次完整分解或求逆，而秩一更新只需一次初始求逆和 24 次更新；没有触发病态回退。**减少完整求逆次数不必然等于最快**：n=32/64 时 LU 更快，n=128、R=8 时秩一更新较快。

## 右端复用量改变后端排序

固定 n=128、24 次导纳切换，改变每次切换的右端数量 R，并各自重复计时。

| 每状态 RHS 数 | GJ(ms) | LU(ms) | Rank1(ms) | 本测试较快策略 |
| ---: | ---: | ---: | ---: | :--- |
| 1 | 377.65 | 73.35 | **33.12** | Rank1 |
| 8 | 465.23 | 117.38 | **91.67** | Rank1 |
| 32 | 501.92 | **117.86** | 202.14 | LU |

[右端敏感性 CSV](../research/node22_mna_rhs_sensitivity.csv)。三种 R 来自不同测量批次；绝对耗时会随容器负载变化，不能据此固定硬件无关的交叉阈值。额外跨进程抽查中，n=128、R=1 三批次 Rank1 中位数约 35.15/35.20/37.91 ms，LU 约 76.60/74.84/78.66 ms；R=32 两个完成的批次 Rank1 约 232.46/221.57 ms，LU 约 116.71/129.60 ms；第三批未完成，不作为证据。

## 理论成本与限制

设 K 次导纳更新，每状态 R 个右端。完整求逆和 LU 重分解的典型计算量均包含 (K+1)*O(n³) 的矩阵准备和 KR*O(n²) 的右端计算。若数值条件允许稳定更新，秩一方案可变为 O(n³)+K*O(n²)+KR*O(n²)，**但**实际常数、内存访存和回退影响显著。研究代码中，LU 的回代与显式逆矩阵乘向量的实现常数不同，因而 R 高时 LU 可能胜出。

这里没有证明整个 UI/仿真器加速，也没有完成带多个真实 PWL 状态同时变化的网络、稀疏大型 MNA、内存/Garbage Collector、外部物理 SPICE 的性能及精度验证。

## 复现

新脚本：[scripts/benchmark-mna-scaling.mjs](../scripts/benchmark-mna-scaling.mjs)。只用 Node 内建 perf_hooks/os 和本仓库现有数学模块，无 React 依赖。

~~~bash
node scripts/benchmark-mna-scaling.mjs --sizes=8,16,32,64,96,128 --repetitions=7 --events=24 --rhs=8 > scaling.csv
node scripts/benchmark-mna-scaling.mjs --sizes=32,64,96,128 --repetitions=5 --events=24 --rhs=1 > rhs1.csv
node scripts/benchmark-mna-scaling.mjs --sizes=32,64,96,128 --repetitions=5 --events=24 --rhs=32 > rhs32.csv
~~~

脚本包含数值异常 fail-fast 检查：绝对解差或残差超过 1e−7 则报错。本轮原始数据采集于添加该断言之前，但所有数值均已通过更严格的 1e−14 量级检查，断言不会改变正常样本的矩阵计算路径。

## 相关工作与创新性边界

- Hager (1989), *Updating the Inverse of a Matrix*, SIAM Review 31(2):221–239, https://doi.org/10.1137/1031049 。Sherman–Morrison–Woodbury 是经典已知公式。
- Ma et al. (2026), *A Note on the Stability of the Sherman–Morrison–Woodbury Formula*, SIAM J. Matrix Anal. Appl. 47(2):702–723, https://doi.org/10.1137/25M1747087 。已有前/后向误差研究；本工程阈值不能冒称数学定理。
- *Deadline-Deterministic Sparse Matrix Updates with Versioned Factor Banks for Real-Time Distribution Network EMT Simulation*, Electronics 15(17):3934 (2026), https://www.mdpi.com/2079-9292/15/17/3934 。已有更大规模的电力 EMT 低秩补偿与稀疏因子库工作，正式投稿应详细比较。

本项目的新贡献仅限于**具体轻量级 EDA / PWL-MNA 工程中的可审计实证：真实 Node 计时、线性系统残差、低秩数值保护与右端数量敏感性**。目前仍未完成完整仓库 npm/lint/build，GitHub Actions 因用户账户账单问题不能运行；PR 保持 Draft，main 未改动。