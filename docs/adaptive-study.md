# 第四轮：基于二极管端电压跃变的自适应状态校正

更新时间：2026-10-29。本文档记录*研究分支真实 JavaScript 核心*的数值实验，而非网页 FPS、工业 SPICE 验证或硬件波形测量。

## 1. 方法定义

研究代码中四种模式共用：二极管 ON 电阻 0.05 Ω、OFF 电阻 10^8 Ω、正向导通固定压降 0.70 V、OFF→ON 判据 `vD > 0.70 V`、ON→OFF 判据 `vD < 0.65 V`。这些阈值属于离散状态机，不是 Shockley 理想半导体方程。

新增 `diodeSolver: 'adaptive'`。步骤：上一步接受的节点解预测状态 → 求解当前时间步 → 测量最大二极管电压跃变：

```text
DeltaV = max_j abs(vD_j(current-solved) - vD_j(previous-accepted))
guard = maxGuard / (1 + DeltaV / adaptiveScale)
```

默认 `maxGuard=0.015 V`、`adaptiveScale=0.2 V`。只有当当前步状态违反 ON/OFF 阈值的程度超过 `guard`，才切换宏模型并额外求解。无历史解的第一步 `guard=0`，作为安全初始化。最多允许原有的 12 次端点检查及求解，未能稳定时保留最后求解的状态和电压并增加 `unresolvedSteps`。

**重要：上式是启发式状态冲突筛选器，不是严格的局部截断误差估计、数值稳定性定理或物理事件检测保证。**

## 2. 四种模式的公平对照

`predicted`：只预测，固定一次线性求解；`guarded`：固定 15 mV 容差；`adaptive`：动态收紧容差；`hysteretic-corrected`：零容差端点一致性校正。原工程 `iterative` 模式的反向电流关断规则不同，仅作为工程兼容性基线，不参与同一模型的精度比较。

实验：半波整流、桥式整流、双向限幅和电感续流 4 电路，10/50/100 μs 步长，40 ms，参考采用相同宏模型+端点校正的 1 μs 细网格解，合计 48 组结果。文件 `research/engine_four_mode_v8_results.csv`。回归测试 37 项在隔离 V8 中全部执行通过；未完成正式 `npm test`/lint/build 验证。

| 电路（10 μs） | 模式 | 节点电压 RMSE / V | 总线性求解次数 | 状态不一致 |
| --- | --- | ---: | ---: | ---: |
| 半波整流 | 历史预测 | 0.016313 | 4000 | 4 |
| | 固定容差 | 0.016309 | 4001 | 3 |
| | 自适应容差 | 0.016304 | 4002 | 2 |
| | 端点校正 | 0.010142 | 4004 | 0 |
| 桥式整流 | 历史预测 | 0.019524 | 4000 | 16 |
| | 固定容差 | 0.019524 | 4000 | 16 |
| | 自适应容差 | 0.019518 | 4001 | 14 |
| | 端点校正 | 0.011408 | 4008 | 0 |
| 双向限幅 | 历史预测 | 0.002129 | 4000 | 1 |
| | 固定容差 | 0.002101 | 4001 | 0 |
| | 自适应容差 | 0.002101 | 4001 | 0 |
| | 端点校正 | 0.002101 | 4001 | 0 |
| 电感续流 | 历史预测 | 118.54 | 4000 | 1 |
| | 固定容差 | 0.090599 | 4001 | 0 |
| | 自适应容差 | 0.090599 | 4001 | 0 |
| | 端点校正 | 0.090599 | 4001 | 0 |

在 15.01 ms 开关时刻，预测解节点电压约 −7497.87 V；自适应（或固定 15 mV）校正计算结果约 −0.73749 V，触发校正仅 1 次额外线性求解。此例对自适应机制**没有**相对固定容差的独特优势；只能说明关键事件应被及时校正。

## 3. 参数敏感性

使用 `adaptiveScale={0.02, 0.1, 0.2, 1, 10} V` 对同一 10 μs 网格进行扫描，共 20 组记录：`research/adaptive_scale_v8_results.csv`。桥式整流的自适应 RMSE 分别约为 0.019496、0.019496、0.019518、0.019524、0.019524 V，线性求解次数分别为 4004、4004、4001、4000、4000。尺度越小一般意味着越积极的校正，但本样本不支持“自适应参数普遍最优”的结论。其他 3 电路对这组尺度变化基本不敏感。

## 4. 与物理 SPICE 的差异

`research/spice/rectifier_shockley_reference.cir` 和 `research/spice/freewheel_shockley_reference.cir` 是为**未来运行 ngspice**准备的物理 Shockley 二极管参考网表。它们和研究引擎的两状态迟滞 PWL 二极管不是同一器件方程。若以后得到物理 SPICE 数据，必须区分：模型形式误差、步长误差、状态求解误差和数值求解开销。本轮运行环境**未安装 ngspice，也未执行这两个网表**。

## 5. 复现

```bash
npm ci
npm test
npm run lint
npm run build
npm run benchmark:hsp > four_modes.csv
node scripts/adaptive-sensitivity.mjs > adaptive_scale.csv

# 安装 ngspice 后（尚未执行）
ngspice -b research/spice/rectifier_shockley_reference.cir
ngspice -b research/spice/freewheel_shockley_reference.cir
```

以上实验不是复杂度或速度的广泛性能验证，不能凭线性求解次数直接宣称实际墙钟耗时加速。状态不一致计数采用离散阈值定义，不等同于精确事件时间误差。后续需要更多电路、参数、节点电压与电流外部验证以及不同平台稳定计时。

## 6. 相关工作注意

Camlibel, Heemels, Schumacher (2002), *Consistency of a time-stepping method for a class of piecewise-linear networks*, IEEE Trans. Circuits Syst. I 49(3):349–357, DOI: [10.1109/81.989170](https://doi.org/10.1109/81.989170)。已有关于 PWL 网络/理想二极管后向欧拉时间步进一致性的条件性研究。研究稿不能未经对比便主张“首次采用 PWL/离散状态/非迭代”。
