# 第六轮研究：未知二极管状态切换的试算回溯、时间步二分与后向欧拉时间约定

日期：2026-10-29。本文是研究分支实验记录；所有数值来自真实 JavaScript 核心在隔离 V8 环境的执行，**不是 ngspice、现场实验或已同行评审的方法定理**。

## 研究动机：先消除时间采样误差，再讨论状态预测误差

旧引擎的电容/电感伴随模型采用后向欧拉，但独立电源和定时开关按 `t_n`（时间步起点）取值，波形结果却代表一次 `[t_n,t_{n+1}]` 时间步的解。这会引入外加激励的时间相位偏差。对于电路

```text
  C * (v[n+1] - v[n]) / h + (v[n+1]-Vs(t[n+1]))/R = 0
```

标准后向欧拉在新时刻求值，解为

```text
  v[n+1] = (C/h*v[n] + Vs(t[n+1])/R) / (C/h + 1/R).
```

研究分支增加了显式选项：
```js
compileCircuit(elements, dt, { sourceSampling: 'be-end' });
```
对独立源及定时开关采用 **本步终点** `t_n+h` 采样，并且探针的历史时间戳也随之校正。默认 **`legacy-start` 不变**，避免改变现有 UI 和教学电路表现。不能将以前 `legacy-start` 下的波形误差误解释为全部来自迟滞状态预测。

## 回溯试算与二分细化算法

新增 `src/sim/eventRefinement.js`：
```js
stepEngineWithDiodeRefinement(engine, probeId, { maxHalvings: 6 });
```
适用于 `guarded`、`adaptive`、`hysteretic-corrected` 模式，不支持 `predicted` 免校正模式。算法：

1. 保存本步接受的 `state`（电容/电感历史）、`switchStates`、`previousSolution`、时间、求解矩阵、探针历史及诊断计数。
2. 在给定时间段上试算一个后向欧拉步。
3. 如果前后**二极管离散状态发生变化**，且尚未达到最大递归深度，撤销该试算步并以两个半步重新计算。首步初始状态确立不当成区间内部事件。
4. 在深度极限接受转换段，记录其时间区间；最终保证所有被接受子步覆盖原标称时间步。
5. 分别记录被接受的 `linearSolves / factorizations` 与被撤销试算的 `eventRejectedSolves / eventRejectedFactorizations`。**计算代价必须同时包含两者。**

若 `h` 为标称步长、深度 `k`，事件所属的最后区间宽度最多 `h/2^k`。这只是 **数值状态变化所在的细分时间段**，不证明里面存在精确 Shockley 或真实器件的切换根，更不是跨任意时间步的误差上界。

## 统一参考实验（所有变体共同使用一个参考）

4 种仓库原有电路：`rectifier`、`fullwave_rect`、`diode_clipper`、`freewheel`。模型相同：两状态 PWL，0.70/0.65 V 迟滞，`hysteretic-corrected` 状态检查，稠密 LU。模拟 40 ms，`h = 10,50,100` μs，对照共 **36** 组。

参考：**同一 PWL+端点校正+BE-end 外加激励**的 1 μs 细网格波形。三种对照：
- `legacy-start`：原起点采样，无事件二分；
- `be-end`：终点采样，无事件二分；
- `be-end + refined`：终点采样+6 层回溯二分。

所有变体均与**同一个 BE-end 细网格参照**比较，不能把每个策略换成各自不同的参考。

| 电路（100 μs） | legacy-start RMSE | be-end RMSE | be-end + 二分 RMSE |
| --- | ---: | ---: | ---: |
| 半波整流 | 121.27 mV | 36.01 mV | 31.98 mV |
| 桥式整流 | 138.14 mV | 51.80 mV | 39.40 mV |
| 双向限幅 | 22.49 mV | ~浮点舍入误差 | ~浮点舍入误差 |
| 电感续流 | 286.49 mV | 7.74×10⁻⁸ V | 7.77×10⁻⁸ V |

**反例：**在 10 μs 的同一细网格参照下，半波整流 `be-end` 基线 RMSE 为 **1.273 mV**，二分后反而增加到 **4.755 mV**；桥式整流基线 **2.926 mV**，二分后 **6.610 mV**。它说明采用后向欧拉并且已做端点一致性校正的 PWL 电路，**简单的时间步二分不能保证降低全局误差**，甚至可能因重新分配不连续事件步而增大采样端点偏差。

**计算代价：**半波整流 100 μs，BE-end 基线线性求解 404 次；二分法接受解 428 次，另丢弃试算 48 次，实际 476 次；相对基线额外约 17.8%。桥式整流 100 μs，408 次基线，二分后接受 456 次、丢弃 96 次，共 552 次（额外约 35.3%）。矩阵分解也有类似开销。不能仅用“接受子步”的求解次数夸大效率。

所有 36 组数据见 `research/event_refinement_v8_results.csv`，重跑指令：
```sh
npm run benchmark:hsp:event > event_refinement.csv
```

## 统一 BE-end 的状态策略实验

此前 `research/engine_four_mode_v8_results.csv` 基于 `legacy-start`。为避免时间采样误差混入预测/校正算法比较，本轮重新计算 **48** 组、统一 `sourceSampling:'be-end'`，并归档于 `research/four_mode_be_end_v8_results.csv`。

例如 10 μs：半波整流预测/零容差端点校正 RMSE 约 **13.75/1.27 mV**，桥式整流约 **16.90/2.93 mV**。续流纯历史预测仍可能出现严重不合理的切换瞬态（对应 RMSE 118.46 V），而端点校正正常。**这再次支持当前器件模型中需检测当前步状态一致性，但不能证明该策略优于已有 SPICE 方法。**

参数敏感性 `research/adaptive_scale_be_end_v8_results.csv` 使用同样 BE-end 约定，20 组。

## 校验边界与研究新颖性

- 实际研究分支 JavaScript 源码在隔离 V8 中执行 **53/53 测试函数通过**。这不等同于完整的 `npm test`、`npm run lint`、`npm run build`；GitHub Actions 受账户账单限制。
- `ngspice` 当前执行环境不可用，准备好的物理二极管网表尚未运行。**细网格 BE-end PWL 结果不是“物理精确解”**。
- `stepEngineWithDiodeRefinement` 是有明确代价的**方法学对照原型**，不建议默认打开。没有严格根求解、局部截断误差证明、完整参数覆盖或通用速度优势。
- 原 `main` 未修改；`iterative` 与 `linearSolver:'inverse'` 仍然默认。研究特性仅存在 Draft PR。
- 已有 PWL、事件检测、SPICE breakpoint/time-stepping 方法丰富，不应把局部步长细分或状态回溯当作首次发明。相关基础阅读：电路后向欧拉瞬态解析 https://www.ecircuitcenter.com/SpiceTopics/Transient%20Analysis/Transient%20Analysis.htm ，经典 SPICE 瞬态与 breakpoint 讨论 https://cas.ee.ic.ac.uk/people/nachiket/publications/phd-thesis_2010.pdf 。

## 推荐后续方向

1. 先在本地真实 Node 环境完成项目测试、lint、build 及真实墙钟计时。
2. 对定时开关和二极管自身未知切换分别研究 **事件根估计与密集输出**，避免目前二分方法的重复线性求解。
3. 在适当的状态稳定/无歧义条件下，研究真正的残量型事件时间误差估计，并明确与现有 PWL 混合系统数值分析的区别。
4. 完成外部 SPICE 物理二极管参数标定与实验波形对比，以分离器件近似误差。
