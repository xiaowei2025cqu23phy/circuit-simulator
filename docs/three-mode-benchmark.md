# 三种非线性器件状态求解策略的受控对照实验

> 研究记录（2026-10-29）。本实验使用**实际仓库中的 JavaScript MNA/PWL 内核**，但通过隔离的 V8 执行环境运行；不包含浏览器渲染、Node.js npm 构建或真实设备 FPS 测试。GitHub Actions 因账户账单限制未能正常验证，独立 V8 测试通过 33/33 条测试逻辑。论文可引用数据，但不得称为 SPICE 精度验证。

## 1. 被比较的三个策略

三个研究模式调用相同的器件矩阵印记、相同的双阈值迟滞状态机：OFF→ON 当 `v_D > 0.70 V`，ON→OFF 当 `v_D < 0.65 V`。

| 模式 | 本步状态更新方式 | 可能的额外线性求解 |
| --- | --- | --- |
| `predicted` | 先使用上一步解预测器件状态，然后求解一次 | 无 |
| `guarded` | 同样预测，再检查当前步解；当状态违反阈值超过 `correctionGuard = 0.015 V` 时校正 | 有 |
| `hysteretic-corrected` | 同样预测，再尝试直到当前步状态一致（最多 12 次求解） | 有 |

`iterative` 是原项目已有的工程基线，其**关断使用负二极管电流**判据，与三研究模式使用的 0.65 V 截止阈值不同，因此**不能**作为同一模型下算法精度优劣的直接证据。

三种模式都可能遇到状态互相切换、无一致离散解的电路；达到 12 次上限时保留最后一次实际求解的器件状态，并记录 `unresolvedSteps`。未发生此类事件才可使用端点校正参考解作比较。

## 2. 模型、测试设置与来源

- 电路：仓库原有 `rectifier`（半波整流）、`fullwave_rect`（桥式整流）、`diode_clipper`（双向限幅）、`freewheel`（电感续流）。
- 完全相同的预置电路、PWL 参数与时间步进规则；每组计算 40 ms；时间步长 10、50、100 μs。
- 参照波形：同一求解器、相同的 PWL 状态机，`hysteretic-corrected` 模式以 1 μs 步长计算。**这只是内部细网格参考解，并非精确物理解、SPICE 或器件实验数据。**
- 指标：节点电压 RMSE、最大绝对误差、总线性求解次数、状态不一致计数、矩阵重建次数、未收敛次数。
- 实验代码：`scripts/compare-hsp-mna.mjs`。保存数据：`research/engine_three_mode_v8_results.csv`。
- 由于对数值引擎进行了源代码层面的 V8 复现，CSV 不包含该隔离环境内粗计时器的耗时数值；需在一致的本地 Node.js / 浏览器平台另做耗时基准。

## 3. 结果摘录：10 μs

| 电路 | 方法 | RMSE(V) | 线性求解次数 / 4000 步 | 状态不一致 |
| --- | --- | ---: | ---: | ---: |
| 半波整流 | 预测 | 0.016313 | 4000 | 4 |
| 半波整流 | 容差校正 | 0.016309 | 4001 | 3 |
| 半波整流 | 端点校正 | 0.010142 | 4004 | 0 |
| 桥式整流 | 预测 | 0.019524 | 4000 | 16 |
| 桥式整流 | 容差校正 | 0.019524 | 4000 | 16 |
| 桥式整流 | 端点校正 | 0.011408 | 4008 | 0 |
| 双向限幅 | 预测 | 0.002129 | 4000 | 1 |
| 双向限幅 | 容差校正 | 0.002101 | 4001 | 0 |
| 双向限幅 | 端点校正 | 0.002101 | 4001 | 0 |
| 电感续流 | 预测 | 118.54006 | 4000 | 1 |
| 电感续流 | 容差校正 | 0.090599 | 4001 | 0 |
| 电感续流 | 端点校正 | 0.090599 | 4001 | 0 |

这说明 **“只做一次线性求解”并不等于全局数值稳定或物理精度足够**。续流电路中一帧的延迟可导致极端电压误差；引入关键事件的状态校正在上述例子中仅多进行一次线性求解，就将 RMSE 从约 118.54 V 降到 0.091 V。

反例也很重要：在 10 μs 桥式整流算例中，15 mV 的容差判据没有触发校正，因此没有改善预测误差。混合策略的保护效果与阈值、时间步长及具体电路有关。

## 4. 论文可支持与不能支持的结论

**可支持**：同一模型的求解次数、内部细网格波形偏差，以及状态一致性指标；说明固定单次求解具有可预测的“线性求解次数”，但在剧烈切换时可能出现大误差；适当校正可以显著降低某些失效案例的误差。

**尚不能支持**：比 ngspice 的物理精度更好、普遍加速、支持工业规模电路、绝对稳定性、或 BJT/MOSFET 模型已完成与验证。需要本地 npm 测试、不同硬件的可信耗时、模型对照、参数敏感性与多元器件实验。

## 5. 复现指令

```bash
npm ci
npm test
node scripts/compare-hsp-mna.mjs > three_mode_engine_benchmark.csv
```

由于 benchmark 中耗时取三个重复的中位数，实际计时结果会随运行平台变化。若要比较速度应至少执行多轮独立试验、记录 CPU/Node 版本与测试条件，不宜将单次数字用于论文“加速比”结论。

## 6. 投稿前必须比较的先行方法

以下都是已有的公开研究，不能将“PWL、状态机或避免 Newton 迭代”单独视为无先例的发明：

1. C. Visweswariah and R. A. Rohrer, “Piecewise Approximate Circuit Simulation,” *IEEE Transactions on Computer-Aided Design of Integrated Circuits and Systems*, 1991. [IBM 研究资料](https://research.ibm.com/publications/piecewise-approximate-circuit-simulation)。采用 PWL 器件模型和事件驱动仿真。
2. M. K. Camlibel, W. P. M. H. Heemels, and J. M. Schumacher, “Consistency of a Time-Stepping Method for a Class of Piecewise-Linear Networks,” *IEEE Transactions on Circuits and Systems I*, vol. 49, no. 3, pp. 349–357, 2002, DOI: [10.1109/81.989170](https://doi.org/10.1109/81.989170)。已有对含理想二极管 PL 网络的时间步进一致性证明（在其给定条件下）。
3. C. Reiman and E. Rosenbaum, “Numerical Methods for Event-Detection State Vector Simulation of Switched-Mode Power Supplies,” *IEEE Journal of Emerging and Selected Topics in Power Electronics*, vol. 8, pp. 2285–2292, 2020, DOI: [10.1109/JESTPE.2019.2946281](https://doi.org/10.1109/JESTPE.2019.2946281)。利用状态空间分解矩阵与切换时刻更新。

论文目前的可辩护研究问题是：在**具体轻量级 MNA-PWL 实现中**，同一离散切换模型下，历史状态预测、容差触发端点校正与完全端点一致性校正之间存在哪些误差/计算次数权衡，如何识别并处理续流事件中的危险的一步滞后？本实验尚不构成相对于上述方法的理论首创证明。
