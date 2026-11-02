# HSP–MNA 理论研究笔记：状态预测误差、数学可解释性与投稿定位

> **2026-11-02；研究/设计文件，非已实现新算法或投稿终稿。** 已审阅的工程基线是 d14f828e47122f4d8ff9e7b7311d2e75963a68ca（Draft PR #2）。本笔记和独立 Python 演示不修改原有求解器，也不代替原论文中缺失的 Python/SciPy 复现材料。

## 一、核心问题与新颖性边界

建议将本研究问题精确定义为：**在统一离散器件模型、相同 BE 时间层、相同动态历史和一致的线性求解后端下，历史状态预测能在多大计算成本下逼近端点状态一致的数值解？何时会发生严重误判？**

MNA、后向欧拉、分段线性电路、事件定位、Sherman–Morrison–Woodbury、LU 和基于历史状态的猜测均有广泛先例。**公式本身不是 HSP 的数学首创**。论文可能具有的价值，是有限状态预测、端点一致性诊断、失败路径、计算成本和教学解释之间的**可审计实证关系**。将该价值升级为新的自动校正算法，还需新增真实对照，不得预先宣称。

当前代码研究状态法则（详见 src/sim/statePrediction.js）：OFF→ON 在端点二极管电压超过 0.70 V；ON→OFF 在低于 0.65 V；ON 支路电流为 20(v−0.7) A，OFF 为 1e−8 v A。因此滞回区内允许 **ON 状态的负电流（理论可接近 −1 A）**。它只是教学级 PWL 宏模型；不同器件模型（例如 legacy iterative、Shockley）不可混入“同模型算法优劣”比较。

## 二、固定历史 BE–MNA 的状态误差恒等式

设时间步长为 h，进入本步的 C 电压/L 电流历史为 z_n，外源统一采样在 t_(n+1)。对每一离散开关状态 s，求解：

\[
A_s(h)x_s=b_s(z_n,t_{n+1};h).
\tag{1}
\]

对于状态预测 p 和端点校正 c，固定动态历史，得到严格恒等式：

\[
A_c(x_c-x_p)=(b_c-b_p)-(A_c-A_p)x_p.
\tag{2}
\]

它是**两个不同状态下代数解的精确位移公式**，不是一般 DAE 的时间误差界，也不证明状态唯一、器件物理准确、迟滞状态全局收敛。MNA 解向量混合节点电压（V）和某些支路电流（A）；绝对范数须分别报告。

### 只改变一条支路

设支路关联向量 a=e_u−e_v，接地端对应项省略。对于电流模型 i_D=g v_D−I0，从预测状态切换到候选状态时定义 Δg=g_c−g_p、ΔI=I0,c−I0,p，则

\[
A_c=A_p+\Delta g\,aa^{\mathsf T},\quad b_c=b_p+\Delta I\,a.
\]

定义 u=A_p^(-1)a，α=aᵀu，δ=1+Δg α，η=ΔI−Δg aᵀx_p。若 A_p 与 A_c 非奇异：

\[
\boxed{x_c-x_p=\frac{\eta}{\delta}u.}
\tag{3}
\]

推导：式 (2) 的右端恰为 aη；Sherman–Morrison 给出 A_c^(-1)a=u/δ，故有上式。**不可遗漏 ΔI**，否则二极管 ON 支路的 0.7×20=14 A 仿射 RHS 无法正确反映。

令 P_V 选择节点电压分量，则对于**这一指定状态切换**，由预测解到切换后解的电压位移为

\[
E_V=\|P_V u\,\eta/\delta\|_\infty\quad [\mathrm V].
\tag{4}
\]

它只比较两套离散代数方程，并非对未知物理真实值的无条件误差上界。对于支路电流须另用安培为单位报告。若 δ 接近零必须回退稳健分解，不能把该关系当作稳定性保证。

### 多支路同步改变

取 B=[a1,...,ak]、D=diag(Δg1,...,Δgk)、j=(ΔI1,...,ΔIk)ᵀ，有

\[
A_c=A_p+BDB^{\mathsf T},\quad b_c=b_p+Bj.
\]

令 U=A_p^(-1)B、K=I+D BᵀU，A_p 和 K 非奇异时：

\[
\boxed{x_c-x_p=U K^{-1}(j-D B^{\mathsf T}x_p).}
\tag{5}
\]

此处使用经典 Woodbury 型公式；其价值是解释**相同数量的状态错误可能导致完全不同的电压响应**。未明确最终开关状态前，式 (3) 或 (5) 不能替代状态法则的端点一致性检查。

### 已完成的独立数值演示

可在标准库 Python 3 环境运行：

    python3 research/theory/hsp_switch_identity_demo.py

演示程序不调用研究仓库的 JS 解器，以小型带部分主元的高斯消元独立构造并求解固定 MNA 系统：

- 一节点 R–C–PWL 算例：R=1 kΩ，C=1 µF，h=100 µs，Vs=10 V，历史电压 0 V，g_off=1e−8 S，g_on=20 S，V_F=0.7 V。
- OFF 预测电压 **0.909090082645 V**，ON 校正电压 **0.700114936785 V**。
- 式 (3) 给出的改变量 **−0.208975145861 V**，与直接重求解一致；OFF 违反开阈值，而 ON 终点满足留在导通态的条件。
- 两支路同步翻转且包含理想电压源约束的**非正定 MNA**：式 (5) 的位移与重建重求解最大差约 **2.44×10^-15**，最终方程最大残量约 **1.78×10^-15**。
- 此处仅是数学等价数值演示；**没有运行仓库全套 Node/NGSPICE，也没有复现旧论文的 SciPy 数据**。

## 三、三种必须隔离的误差

1. **状态决策误差**：同一器件法则、同一 h、同一历史，预测状态解与端点一致状态解之差。其一个可计算量是式 (3)/(5) 的位移；只有目标状态已确定才是精确差。
2. **时间离散误差**：固定状态算法及器件法则，h 与更细 h_ref 下同一采样时间的数值解之差。这是细网格参考下的实测差，非自动严格误差界。
3. **器件模型差异**：PWL/迟滞与 Shockley/ngspice 的差异。Shockley 本身也有非零逆向饱和电流，不能简单等同“完全单向”。物理验证仅覆盖所采用的元件参数、温度和工作范围。

论文不应将小的 KCL/KVL 线性残量误判为开关状态正确；也不应将同模型的电压 RMSE 宣称为真实二极管的物理精度。

## 四、现有数据支持的命题

来源：research/round9-stage3-same-model.csv。各模式固定两态迟滞 PWL、BE-end、相同初始条件及 1 µs 同模型细网格参考：

| 场景 | 单次预测 RMSE (V) | 端点校正 RMSE (V) | 预测线性求解数 | 端点校正求解数 |
|---|---:|---:|---:|---:|
| rectifier, 10 µs | 0.01374834 | 0.00127271 | 4000 | 4004 |
| diode-bank-24-heavy, 50 µs | 0.10139633 | 0.000039414 | 800 | 820 |
| freewheel, 10 µs | 118.46110 | ~7.05×10^-9 | 4000 | 4001 |

这些结果表明：有些场景少量端点校正即可显著降低**相对同模型参考**的波形误差；预测模式在续流电路中可发生非常严重的状态误判（最大误差约 7492 V，仅是仿真错误，不是物理测量）。

同表：diode-bank-24-heavy, 50 µs 的细分模式，**940 次已接受 + 240 次回滚试算=1180 次总线性工作**，比预测模式 800 次多 **47.5%**；该模式的同模型 RMSE 约 4.87×10^-8 V。不能只计算已接受试算，更不能普遍声称细分一定比纯端点校正精确：rectifier 10 µs 的细分 RMSE **4.755 mV**，比未细分端点校正的 **1.273 mV** 更大。

## 五、可检验的后续研究假说（尚未编码）

**待验证假说 H1：** 对候选不一致支路，利用固定步的端点状态检查与式 (3)/(5) 的响应信息，或能设计具有更清楚成本—误差边界的选择性校正/排序策略。

必须注意一项不利因素：使用 LU 时，评估一个候选支路的 u=A_p^(-1)a 通常需要一次额外三角求解；若要检查多个支路，额外 RHS 成本可能抵消任何收益，尤其在现有电路每 800 步只需要少量端点校正时。这一方法**现在只是值得证伪的假说**，不是新性能优势。

建议执行的研究协议：
- 固定 LU 后端先比较算法（将 inverse、rank-one 的求解器成本单列），禁止以不同后端混淆预测算法优势。
- 按电路、h、过阈值程度、切换数、矩阵维数分别检查：预测、guarded、adaptive、无 guard 定点端点校正、校正+细分及任何新规则。
- 对指定状态翻转用式 (3)/(5) 对比重新组装后的直接线性求解。发生病态或不收敛必须记录并回退，严禁丢弃。
- 完整计数：接受线性求解、回滚求解、因子重建、候选额外求解、小系统运算、墙钟时间、失败步。统计以独立进程为样本单位并增加进程数；当前 3 簇的 bootstrap 仅属探索性。
- 同时给出节点电压、理想源/电感电流的分单位残量，端点状态一致性，和与细网格参考的误差；不将它们合并为一个“总精度”。
- 预先约定成功阈值与失败边界。若候选方法成本超过直接端点校正，应报告负结果而非选择性展示。

## 六、稿件定位与直接相关先行文献

**EJP（首选方向）**：更有说服力的切入点是高等物理教育中的“为什么满足 MNA 线性方程的波形仍可能错误”，用单节点解析示例与续流失败案例说明状态、时间离散及元件模型的不同层次。EJP 官方要求明确高等教育意义与受众，Paper 通常不超过 4000 字：https://publishingsupport.iopscience.iop.org/journals/european-journal-of-physics/about-european-journal-physics/

**Physics Education（替代方向）**：面向 11 岁至大学初级，Paper 通常不超过 3000 字；需要大幅简化矩阵推导、设计可直接使用的课堂活动，而非将工程稿简单缩短：https://publishingsupport.iopscience.iop.org/journals/physics-education/about-physics-education/

近邻研究必须正面引用，而不是声称首次提出相似技术：
- Camlibel, Heemels, Schumacher (2002), *Consistency of a time-stepping method for a class of piecewise-linear networks*, IEEE TCAS-I, 49, 349–357. https://doi.org/10.1109/81.989170
- Heemels, Camlibel, Schumacher (2002), *On the dynamic analysis of piecewise-linear networks*, IEEE TCAS-I, 49, 315–327. https://research.rug.nl/en/publications/on-the-dynamic-analysis-of-piecewise-linear-networks/
- Galetzka, Loukrezis, De Gersem (2024), *Data-driven model-free modified nodal analysis circuit solver*. https://doi.org/10.1002/jnm.3205
- Ma, Boutsikas, Ghadiri, Drineas (2026), *A Note on the Stability of the Sherman–Morrison–Woodbury Formula*. https://doi.org/10.1137/25M1747087
- Crivellari et al. (2026-10-30), *State-Space Generation via Modified MNA for Numerical Integration Applications*. https://doi.org/10.1007/s00034-026-03845-3
- Akyüz et al. (2026), *Interactive Visualization of Diode Physics: Bridging the Fidelity–Accessibility Gap in Web-Based Engineering Education*. https://doi.org/10.1002/cae.70200

这几项分别覆盖开关网络时间步一致性、MNA 非线性数值研究、SMW 稳定性、MNA 状态空间变换，以及交互二极管教学；本项目必须把自身局限在它们**尚未覆盖、且我们确实验证的教学分析/算法成本问题**之内。

## 七、下一步验收边界

1. 工程：修正文档里 100 µA PWL 标定截距的抄录错误；修正成本公式和 buildMNA 与分解计时重叠；澄清本次 run 8/11、跨 run 保守 7/11 的不同统计口径；严格验证所有性能 CSV 列。
2. 数值：逐个接受子步检查相应真实 dt 与前历史，不能以最后一个接受子步的检查代表所有子步；补独立固定状态的直接重解对照。
3. 研究：审查 H1 的额外成本是否真的低于无 guard 端点校正；若无收益，以负结果和可解释失败为结论。
4. 发表：历史论文所述单节点 Python/SciPy 脚本仍缺失；本新演示仅检查线性代数式 (3)/(5)，**不是对旧 Python 实验的补交**。PR #2 仍应 Draft，不将本研究笔记当作最终科研验收。
