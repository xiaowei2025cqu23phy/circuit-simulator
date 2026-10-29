# 🔌 Circuit Simulator | 在线电路仿真器

[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](LICENSE)
[![React](https://img.shields.io/badge/React-19.2.5-61dafb?logo=react)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-8.0.9-646cff?logo=vite)](https://vitejs.dev)
![Language: JavaScript](https://img.shields.io/badge/Language-JavaScript-f7df1e?logo=javascript)
[![Tests](https://img.shields.io/badge/Tests-27%20passed-22c55e)](src/sim/engine.test.mjs)

一个基于 React 的**交互式在线电路模拟器**，实现了原理图绘制、元件参数编辑、瞬态仿真（改进节点分析法 MNA + 后向欧拉）与实时示波器，适合学习电路仿真原理和电子基础知识。

🔗 **在线演示**: [https://xiaowei2025cqu23phy.github.io/circuit-simulator/](https://xiaowei2025cqu23phy.github.io/circuit-simulator/)

---

## ✨ 核心功能

### 🎨 电路编辑
- **拖拽式元件添加** - 从工具栏选择元件后在画布上按下拖拽即可放置
- **移动/重连** - 「选择」或「移动」工具拖拽元件整体移动；拖拽元件端点可重新接线
- **正交布线** - 导线自动直角拐弯，靠近端点自动吸附，交叉处自动形成节点
- **撤销/重做** - 60 步历史，快捷键 Ctrl+Z / Ctrl+Y
- **复制/粘贴** - Ctrl+C / Ctrl+V / Ctrl+D 快速复制副本
- **键盘快捷键** - Q/M/W/R/C/L/D/S/V/I/G/T/N/X 一键切换工具

### 🧮 仿真引擎
- **修正节点分析法（MNA）** - 当前采用带部分主元的 Gauss–Jordan 逆矩阵与矩阵向量乘法；GMIN 仅缓解部分病态情形，并不保证任意拓扑可逆
- **后向欧拉积分** - 电容/电感采用一阶伴随模型；该积分法对适用的线性测试问题具有 A 稳定性，但不保证整个开关电路总是稳定
- **多种源类型支持**:
  - DC 电源、AC 正弦波源（可设初相位）、阶跃 (STEP)
  - 方波（可设占空比）、三角波、脉冲波、指数波
  - 参数面板内置**实时波形预览**：调整参数即见波形形状（峰峰值/窗口标注）
- **多种元器件**:
  - 电阻 (R)、电容 (C)、电感 (L)
  - 二极管 (D)（0.7V 压降 + 50mΩ 内阻，步内定点迭代收敛）
  - 手动/定时开关 (SW)、接地、接线端子、网络标签（同名自动相连）
- **三档精度** - dt=100µs / 10µs / 1µs，仿真中可随时切换
- **拓扑校验** - 缺少接地、悬空节点、悬空导线、短路环路均给出明确报错

### 📊 波形显示
- **示波器面板** - 时基（0.5~200ms）与 Y 轴幅度可调，电压/电流双通道
- **自动量程** - V/div、I/div 刻度实时显示，HiDPI 高分屏适配
- **响应式工作区** - PC 端常驻侧栏与完整示波器；移动端顶部栏、抽屉式工具面板与可折叠示波器，适配刘海安全区和触控输入
- **实时读数** - 选中元件后显示实时电压/电流（自动 V/mV/µV、A/mA/µA）
- **节点电压标签** - 仿真中实时显示各节点对地电压（可开关）
- **仿真中实时交互** - 点击手动开关通断、修改元件参数即时生效

### 💾 数据管理
- **JSON 导入/导出** - 带数据校验，无效条目自动过滤并提示
- **浏览器本地存储** - 多工程保存/加载（工程管理器）
- **电路示例库** - 内置 7 个经典教学电路

---

## 📚 预定义电路示例

项目内置多个经典电路示例，可直接加载学习：

| 电路名称 | 应用场景 | 学习重点 |
|---------|---------|---------|
| **半波整流与平滑滤波** | 电源电路 | 二极管整流、电容滤波 |
| **全波整流桥与滤波** | 电源电路 | 整流桥、纹波频率加倍 |
| **RLC 串联阻尼振荡** | 谐振电路 | 欠阻尼振荡、过冲与收敛 |
| **RC 充放电纹波** | 瞬态分析 | 时间常数、波形特性 |
| **二极管双向限幅钳位** | 保护电路 | 非线性元器件特性 |
| **电感断电高压尖峰** | 感性电路 | 感应电动势、瞬态过程 |
| **电感续流二极管钳位** | 开关电源 | 续流原理、尖峰抑制 |

---

## 🏗️ 项目架构

```
circuit-simulator/
├── src/
│   ├── App.jsx              # 主应用（画布、示波器、属性面板、工程管理）
│   ├── main.jsx             # 入口
│   ├── index.css            # 全局样式（Tailwind）
│   └── sim/                 # 仿真内核（纯 JS，不依赖 React，可单元测试）
│       ├── engine.js        # MNA 建网表、后向欧拉求解、二极管/开关模型
│       ├── circuits.js      # 预置教学电路
│       ├── format.js        # SI 数值/电压/电流/时间格式化
│       └── engine.test.mjs  # 内核单元测试（node --test）
├── public/                  # 静态资源（favicon）
├── index.html              # HTML 入口
├── package.json            # 依赖配置
├── vite.config.js          # Vite 配置
└── README.md               # 项目文档
```

### 核心模块说明

#### 🔧 `sim/engine.js` - 仿真引擎
基于改进的节点分析法（Modified Nodal Analysis, MNA）的电路仿真引擎：
- 并查集自动合并导线（含拐点）、同名标签/端子与接地节点，导线交叉自动成节点
- 电容/电感采用后向欧拉伴随模型（G=C/dt，支路方程 V=(L/dt)·Δi）
- 二极管采用理想开关模型，步内定点迭代（≤12 次）消除状态迟滞与伪尖峰
- 悬空节点 / 悬空导线 / 缺少接地 / 短路拓扑的自动检测与报错

#### 🧮 求解器
- 部分主元 Gauss-Jordan 求逆（编译时一次求逆，逐时间步 O(n²) 矩阵乘）
- 节点 GMIN（1e-12 S）提供弱对地连接，但不保证所有 MNA 系统可逆；奇异矩阵需要单独检测

#### 🎨 绘图系统
- SVG 元件渲染（memo 优化）+ Canvas 示波器（HiDPI、抽稀采样）

---

## 🚀 快速开始

### 前置要求

- **Node.js** 18 或更高版本（测试依赖内置 `node --test`）
- **npm**

### 安装和运行

```bash
# 1. 克隆仓库
git clone https://github.com/xiaowei2025cqu23phy/circuit-simulator.git
cd circuit-simulator

# 2. 安装依赖
npm install

# 3. 启动开发服务器
npm run dev

# 4. 在浏览器打开
# 访问 http://localhost:5173
```

### 构建生产版本

```bash
# 构建生产文件（输出到 dist 目录）
npm run build

# 本地预览生产版本
npm run preview
```

### 其他命令

```bash
# 运行仿真内核单元测试（27 项）
npm test

# 代码检查
npm run lint

# 部署到 GitHub Pages
npm run deploy
```

---

## 📖 使用指南

### 基础操作

#### 1️⃣ **添加元件**
```
1. 从左侧工具栏选择要添加的元件（或按快捷键 W/R/C/L/D/S/V/I/G/T/N）
2. 在画布上按下并拖拽放置元件
3. 元件会显示其参数和两个连接端点
```

#### 2️⃣ **连接导线**
```
1. 选择「导线」工具（W）
2. 从第一个元件的端点按下拖拽到第二个元件的端点
3. 正交模式下自动直角拐弯，靠近端点自动吸附，松开完成连接
4. 导线交叉处自动形成节点（junction）
```

#### 3️⃣ **移动与重连**
```
1. 使用「选择」(Q) 或「移动」(M) 工具拖拽元件整体移动
2. 拖拽元件的端点可单独移动该端点（重新接线）
```

#### 4️⃣ **编辑参数**
```
1. 点击元件选中，左侧属性面板显示其参数
2. 修改参数（如阻值、容值、波形类型等）
3. 仿真运行中修改参数即时生效
```

#### 5️⃣ **运行仿真**
```
1. 放置「接地」元件（G）——电路必须接地才能仿真
2. 点击左下角「运行瞬态仿真」按钮
3. 仿真中：点击手动开关可通断，节点电压标签实时刷新
```

#### 6️⃣ **查看波形**
```
1. 选中任意元件或端子，示波器显示其电压（蓝）与电流（红）波形
2. 调整 X 轴时基（0.5~200ms）与 Y 轴幅度查看细节
3. 点击「冻结」暂停仿真观察波形，「继续」恢复
```

### 快捷键

| 快捷键 | 功能 |
| --- | --- |
| `Q` `M` `W` `R` `C` `L` `D` `S` `V` `I` `T` `G` `N` `X` | 切换元件工具（选择/移动/导线/电阻/电容/电感/二极管/开关/电压源/电流源/端子/接地/标签/删除） |
| `Ctrl+Z` / `Ctrl+Y` | 撤销 / 重做 |
| `Ctrl+C` / `Ctrl+V` | 复制 / 粘贴（偏移 40px） |
| `Ctrl+D` | 快速复制副本 |
| `Delete` | 删除选中元件 |
| `Esc` | 取消绘制 / 取消选择 / 关闭弹窗 |
| `Ctrl+S` | 保存到本地工程 |
| 右键拖拽 | 平移视图 |
| 滚轮 | 以光标为中心缩放 |

---

## 🧪 测试

仿真内核为纯 JavaScript 模块，不依赖 React，可直接单元测试（27 项，全部通过）：

- **解析解对照**：RC 充电曲线 vs 5(1-e^{-t/τ})、RLC 欠阻尼振荡峰值、电感直流稳态 i=V/R
- **电路行为**：半波/全波整流（稳态均值/峰值/纹波）、双向限幅钳位、断电尖峰与续流钳位对照、RC 方波充放电
- **拓扑正确性**：导线交叉成节点、拐点导线跨越、同名端子网络、端点落线合并
- **数值健壮性**：波形发生器全类型、矩阵求逆与奇异检测、参数清洗、缺地/悬空/短路报错、无 NaN/Infinity

```bash
npm test
```

---

## 📚 仿真算法原理

### 改进的节点分析法 (MNA)

本项目使用改进的节点分析法进行电路仿真。基本原理：

1. **建立节点方程** - 根据基尔霍夫电流定律（KCL）建立导纳矩阵
2. **支路电流未知量** - 电压源与电感以支路电流作为额外未知量
3. **求解节点电压** - 部分主元高斯消元求解线性方程组
4. **时间步进** - 后向欧拉（Backward Euler）无条件稳定积分

### 元器件模型

- **电阻**: `G = 1/R`（线性）
- **电容**: `I = C·dV/dt`，后向欧拉伴随模型 `G = C/dt, Ieq = (C/dt)·V(t-dt)`
- **电感**: `V = L·dI/dt`，支路方程 `V = (L/dt)·(I - I(t-dt))`
- **二极管**: 理想开关模型（导通 0.7V + 50mΩ / 关断 1e8Ω），步内定点迭代收敛
- **电源**: `V = V(t)` 或 `I = I(t)`（外部激励，支持 7 种波形）

---

## 🐛 已知限制

这是一个**教学级**仿真器，适合学习和验证原理。已知限制包括：

- ❌ 不支持大规模电路（>100 个元件）
- ❌ 二极管采用理想开关模型（非指数物理模型）
- ❌ 无频率域分析（AC 小信号分析、Bode 图）
- ❌ 无工作点计算（直流扫描）
- ❌ 无 BJT / FET / 运算放大器模型

---

## 📈 改进方向

未来可以考虑的功能增强：

- [ ] **性能优化** - 使用 WebWorker 后台计算
- [ ] **更多元件** - BJT、FET、运算放大器等
- [ ] **频率分析** - AC 频率响应、Bode 图
- [ ] **参数扫描** - 元件参数扫描分析
- [ ] **导出功能** - 导出仿真数据为 CSV/图片
- [ ] **云端同步** - 云存储电路设计
- [ ] **实时协作** - 多用户编辑支持
- [ ] **移动应用** - React Native 移动版本
- [ ] **TypeScript 迁移** - 提高代码质量
- [x] **单元测试** - 仿真算法的自动化测试（已完成 ✅）

---

## 📝 示例使用场景

### 🎓 教学演示
```
教师可用本工具在课堂上实时演示电路行为，
让学生更直观地理解电路原理。
```

### 🔬 学生实验
```
学生可通过本工具预设计电路，验证理论计算，
快速迭代实验方案。
```

### 💡 工程师快速验证
```
工程师可快速验证简单电路的工作原理，
无需等待硬件制作和测试。
```

---

## 📄 许可证

本项目采用 **GPL-3.0 许可证** - 查看 [LICENSE](LICENSE) 文件了解详情。

### 开源依赖

本项目感谢以下开源项目：

- **React & React DOM** (MIT) - 由 Meta 维护
- **Vite** (MIT) - 由 Evan You 维护
- **Tailwind CSS** (MIT) - 由 Tailwind Labs 维护
- **Lucide React** (MIT) - 由 Lucide 社区维护
- **ESLint** (MIT) - 由 OpenJS Foundation 维护

所有依赖均为 MIT 许可，与本项目 GPL-3.0 许可证兼容。

---

## 🤝 贡献指南

欢迎贡献代码、报告问题或提出改进建议！

### 如何贡献？

1. **Fork 本仓库**
2. **创建特性分支** (`git checkout -b feature/AmazingFeature`)
3. **提交更改** (`git commit -m 'Add some AmazingFeature'`)
4. **推送到分支** (`git push origin feature/AmazingFeature`)
5. **开启 Pull Request**

### 贡献类型

- 🐛 **Bug 修复** - 发现和修复 bug
- ✨ **新功能** - 添加新的仿真功能
- 📖 **文档改进** - 完善 README、注释等
- 🎨 **UI 改进** - 优化用户界面
- 🚀 **性能优化** - 提升仿真速度

---

## 💬 获取帮助

遇到问题？有建议？

- 📧 **Email**: [cqu.phy.23xiaowei@qq.com](mailto:cqu.phy.23xiaowei@qq.com)
- 🐛 **提交 Issue**: [GitHub Issues](https://github.com/xiaowei2025cqu23phy/circuit-simulator/issues)
- 💡 **讨论**: [GitHub Discussions](https://github.com/xiaowei2025cqu23phy/circuit-simulator/discussions)


---

## 🔬 HSP-MNA 研究模式（独立分支）

研究分支 `research/hsp-mna-validation` 增加了**可选**的三种基于相同双阈值状态机的实验模式；默认仍是现有的二极管步内校正迭代器。

```js
const baseline = compileCircuit(elements, dt); // 默认：步内二极管状态校正
const predicted = compileCircuit(elements, dt, { diodeSolver: 'predicted' });
const guarded = compileCircuit(elements, dt, { diodeSolver: 'guarded', correctionGuard: 0.015 });
const corrected = compileCircuit(elements, dt, { diodeSolver: 'hysteretic-corrected' });
stepEngine(guarded);
console.log(guarded.diagnostics);
```

- 双阈值预测为 0.70 V（由 OFF 转 ON）与 0.65 V（由 ON 转 OFF），使用上一时间步**已接受的节点解**决定本步离散状态；这与真实二极管物理模型不等价。
- `engine.diagnostics` 记录求解次数、矩阵重构次数、端点状态校正次数、未解决的状态迭代次数及状态不一致计数。
- **公平的三模式研究比较**：`npm run benchmark:hsp > comparison.csv`，采用相同双阈值状态机和 1 μs 同模型细步长参考波形。
- **研究结果与失效例**：[三模式对照及续流失效分析](docs/three-mode-benchmark.md)；[实验 CSV](research/engine_three_mode_v8_results.csv)。原始工程基线的反向电流关断策略不同，不参与同模型精度优劣结论。
- 电路仍只有二极管和手动/定时开关；论文中 BJT/MOSFET 的表达目前属于**模型设计与理论推导**，不是当前 JavaScript 引擎中已实现的器件。
- 研究模式的误差与计算收益必须用同一器件模型及时间网格进行对照验证；不应从单次求解特性直接宣称实际速度提升。由于 GitHub Actions 账户配额限制，CI 运行状态并不代表代码测试结果，请本地执行 `npm test`、`npm run lint`、`npm run build`。

详见 [HSP-MNA 研究方法说明](docs/hsp-mna-research.md)。


### 第四轮：自适应状态校正（研究模式，不改默认引擎）

新增 `compileCircuit(elements, dt, { diodeSolver: 'adaptive', correctionGuard: 0.015, adaptiveScale: 0.2 })`。使用与其他三个研究模式相同的 0.70/0.65 V 迟滞 PWL 模型，自适应校正容差为 `gamma=gammaMax/(1+max|deltaVD|/adaptiveScale)`。这是启发式触发条件，**不是严格误差上界，也不保证无条件稳定**。

研究工具：

```bash
npm test
npm run benchmark:hsp > four_modes.csv
npm run benchmark:hsp:adaptive > adaptive_sensitivity.csv
```

运行限制：本轮读取仓库实际 JavaScript 源码，在隔离 V8 中执行测试逻辑，**37/37 通过**；但受本地仓库不可克隆及 Actions 账单因素影响，尚未完整执行 Node npm、lint 或构建。并未运行 ngspice。详见 [第四轮报告](docs/adaptive-study.md) 和 [四模式结果 CSV](research/engine_four_mode_v8_results.csv)。实验性分支未经合并，勿称为稳定发行版。


### 第五轮：稠密 LU 复用与定时事件对齐（非默认实验接口）

`compileCircuit(elements, dt, { linearSolver: 'lu' })` 可选用部分主元稠密 LU 分解取代显式逆矩阵。系数矩阵不变时重用分解；二极管 PWL 状态、定时开关状态或动态元件步长改变时重新分解。默认仍为 `linearSolver: 'inverse'`，不会影响既有 UI。

`stepEngineAtScheduledEvents(engine, probeId)` 可选用已知定时开关的 `timeOn/timeOff` 边界截断当前后向欧拉时间步。**它不执行未知二极管状态事件的精确零点定位**，也未修复全局时间采样约定。

```bash
npm test
npm run benchmark:hsp:lu > lu_benchmark.csv
python3 research/physical_diode_dc.py > physical_diode_dc.csv
```

实际 JavaScript 源码在隔离 V8 中通过 **45/45** 项测试。4 类电路 × 5 种状态策略共 20 组、每组 4,000 步，LU 与逆矩阵的最大节点电压差约 `1.96e-10 V`，未实测真实机器加速比。直流 Shockley 方程参照与 PWL 模型差异属于**模型近似误差**，不是两种线性后端的数值差异。

参见 [第五轮研究记录](docs/fifth-round-lu-and-events.md)、[完整配对 CSV](research/lu_inverse_parity_v8.csv)。GitHub Actions 受账单限制，尚未完成正常 npm/lint/build 全流程验证；本研究 PR 保持 Draft。


## 第六轮重要勘误与最新研究结果（2026-10-29）

此前源码将 AC/DC/PULSE 激励取样于时间步起点 `t_n`，但采用后向欧拉储能元件伴随方程。为了符合标准受迫 BE 离散，本研究新增可选 `sourceSampling:'be-end'`，在 `t_{n+1}` 取样独立源、定时开关并修正探针时间戳。**默认 UI 仍为 `legacy-start`；不要混用旧实验误差与新 BE-end 结果。**

新增研究性事件回溯：`src/sim/eventRefinement.js` 提供 `stepEngineWithDiodeRefinement(engine, probeId, {maxHalvings:6})`，可撤销并细分存在二极管状态变化的试算步。它**不是精确二极管根定位**，也没有保证全局误差下降。拒绝试算也计入总线性求解成本。测试逻辑 **53/53** 在隔离 V8 中通过（**不等于** npm/lint/build 完成）。

新的权威实验：
- [实验与方法学更正报告](docs/sixth-round-events-time-discretization.md)
- [48 组统一 BE-end 状态策略数据](research/four_mode_be_end_v8_results.csv)
- [36 组 BE 时刻与事件细分对照](research/event_refinement_v8_results.csv)
- [20 组 BE-end 自适应尺度](research/adaptive_scale_be_end_v8_results.csv)
- 复现：`npm run benchmark:hsp:event > events.csv`、`npm run benchmark:hsp > modes.csv`。

这轮直接发现：10 μs 下，半波整流经过事件二分后 RMSE 从 **1.273 mV 增至 4.755 mV**，桥式整流从 **2.926 mV 增至 6.610 mV**，说明朴素二分的代价和误差可能双输；不应作为默认算法。ngspice 尚未运行，物理正确性仍待验证。


## 第七轮（研究分支）：割线事件候选与低秩导纳更新

研究接口（不会改变 `main` 或默认 UI）：

```js
const eng = compileCircuit(elements, 1e-5, {
  diodeSolver:'hysteretic-corrected',
  linearSolver:'inverse-rank1', // 可选，原默认依然是 inverse
  sourceSampling:'be-end',      // 可选，原默认依然是 legacy-start
});

// 另一种实验：启用二极管割线事件试算（仅 hysteretic-corrected）
const trial = compileCircuit(elements, 1e-5, {
  diodeSolver:'hysteretic-corrected', linearSolver:'lu', sourceSampling:'be-end',
});
stepEngineWithEstimatedDiodeEvent(trial);
```

`stepEngineWithEstimatedDiodeEvent` 从 `src/sim/eventEstimate.js` 单独导入；估计来自冻结旧 PWL 状态下的电压端点插值，**不是精确事件根定位**。实验发现割线分步在若干算例中的 RMSE 不如直接端点校正，不能视为已证实的创新优势。

`inverse-rank1` 使用已知的 Sherman-Morrison 公式为单个二极管导纳变化重用已有逆矩阵，并在病态分母、其他器件矩阵变化或最多 32 次累计更新后回退完整求逆。四个示例中的成功更新使完整求逆次数减少，但还**未**完成真实 Node.js 环境下的耗时加速测试。此策略仍是稠密逆矩阵方法，不是稀疏 LU。

```bash
npm test
npm run benchmark:hsp:secant > secant.csv
npm run benchmark:hsp:rank1 > rank_one.csv
node scripts/rank-one-guard-ablation.mjs > guard_ablation.csv
```

最新实验和可核查限制见 [第七轮研究报告](docs/seventh-round-secants-rankone.md)、[48 组事件候选数据](research/event_secant_be_end_v8_results.csv) 与 [40 组低秩对照数据](research/rank_one_inverse_v8_results.csv)。隔离 V8 执行实际 JS 测试逻辑 **67/67 项通过**；但完整 npm/lint/build、设备计时与外部 ngspice 仍待验证。实验性改动保留在 Draft PR，不自动合并。


## 第八轮：真实 Node.js 的 MNA 型稠密矩阵基准（实验性）

在 Node.js v22.16.0 + 共享 AMD EPYC 9V74 CPU 容器中，采用仓库的 LU、带保护的 Sherman–Morrison 秩一更新和原有 Gauss–Jordan 逆矩阵算法，对合成电阻/理想电压源 MNA 型矩阵进行受控计时。该实验不是完整 React/EDA 引擎端到端性能测试；也不是物理器件 SPICE 精度结果。

- 维数：8、16、32、64、96、128；24 次导纳切换；每状态 8 个右端（192 次线性求解）；七次重复计时。
- 128 阶计时中位数：完整求逆 465.23 ms、稠密 LU 117.38 ms、秩一更新 91.67 ms。在 64 阶时 LU 更快；并不能声称秩一更新普遍优越。
- 128 阶/每状态仅 1 RHS：LU 73.35 ms，秩一 33.12 ms；每状态 32 RHS：LU 117.86 ms，秩一 202.14 ms。最优后端与**右端复用量**相关。
- 同一合成网络中三法残差最大约 1e−14；真正病态的桥式整流例应沿用第七轮的数值分母保护回退。

复现脚本：**scripts/benchmark-mna-scaling.mjs**，命令 **npm run benchmark:hsp:scale**。详见 [第八轮方法与限制](docs/eighth-round-node-benchmark.md)、[原生 Node 数据](research/node22_mna_scaling_results.csv)、[右端数量敏感性表](research/node22_mna_rhs_sensitivity.csv)。真实系统全量 npm/test/lint/build 与 ngspice 物理对照仍待完成；本研究 PR 为 Draft，不合并 main。


## 第九轮后续：多拓扑 MNA 与物理模型边界（验证分支）

本节仅属于 research/hsp-mna-local-validation 验证分支及 Draft PR #2，不会更改 main 默认行为。新增的研究电路构造、线性残量检查及 benchmark 直接使用 compileCircuit / stepEngine：

- src/sim/researchCircuits.js：轻/重负载并联 4/12/24 二极管网络，以及 4/8/16 级 RC/RL/RLC 网络。
- src/sim/mnaResidual.js：根据**求解前**电容电压与电感电流重建已接受 BE MNA 方程，检查真实全系统残量，而不只是对照两个求解器的终端波形。
- src/sim/multiTopology.test.mjs：新增七项多二极管/电容/电感/定时开关缓存与回归测试。
- scripts/benchmark-multi-topology.mjs：真正的 Node.js 全瞬态内核计时，可运行 npm run benchmark:hsp:topologies。
- scripts/inspect-pwl-current-direction.mjs：审查迟滞 PWL 宏模型中 ON 支路反向电流，避免用状态一致性误称物理二极管精度。

**初步执行证据：** 74/74 项测试逻辑通过隔离 V8 执行，新增 15 拓扑×3 后端共 45 行数值对照。在这些有限算例中，全 MNA 代数未知量最大差约 1.47e−11（电压和支路电流混合单位），最大原始逐行 MNA 残量约 2.28e−11（KCL/KVL 混合量纲），24 个二极管可同一步切换。重负载版本会在 40 ms 内反复 ON/OFF。

**关键负结果：** 当前人为设定的 0.70/0.65 V 迟滞区，在 ON 状态允许最多约 −1 A 的反向电流：stateDisagreements=0 并不代表物理二极管单向导通条件成立。该数值宏模型需要独立的物理精度研究，不得视为真实 SPICE 二极管。

原始数值数据：research/round9-multitopology-v8-parity.csv、research/round9-pwl-reverse-current-v8.csv；版本证明：research/round9-multitopology-manifest.json；详细报告：docs/hsp-mna-round9-multitopology-followup.md。

**重要：** 新增改动还没有新的原生 Windows/Node npm test/lint/build 日志及 benchmark wall-clock 测量；之前的 67/67 原生 Node 通过日志只对应旧 commit。需要让本机验证者重跑，不得将 74/74 V8 写成 74/74 原生 npm 已通过。
