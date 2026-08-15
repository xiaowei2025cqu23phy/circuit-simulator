<<<<<<< HEAD
# 🔌 Circuit Simulator | 在线电路仿真器

[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](LICENSE)
[![React](https://img.shields.io/badge/React-19.2.5-61dafb?logo=react)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-8.0.9-646cff?logo=vite)](https://vitejs.dev)
![Language: JavaScript](https://img.shields.io/badge/Language-JavaScript-f7df1e?logo=javascript)

一个功能完整的**在线电路仿真器**（EDA 玩具级），采用 **React + Canvas/SVG** 构建。实现了原理图绘制、参数编辑、瞬态仿真、波形显示等核心功能，适合学习电路仿真原理和电子基础知识。

🔗 **在线演示**: [https://xiaowei2025cqu23phy.github.io/circuit-simulator/](https://xiaowei2025cqu23phy.github.io/circuit-simulator/)

---

## ✨ 核心功能

### 🎨 电路编辑
- **拖拽式元件添加** - 从工具栏快速添加电路元件
- **导线连接** - 点击元件端点轻松连接导线
- **参数编辑** - 双击元件编辑参数，实时预览
- **电路模板** - 预定义多个经典电路示例

### 🧮 仿真引擎
- **改进的节点分析法（MNA）** - 高精度电路仿真算法
- **多种源类型支持**:
  - DC 电源、AC 正弦波源
  - 方波、三角波、脉冲波、指数波
- **多种元器件**:
  - 电阻 (R)、电容 (C)、电感 (L)
  - 二极管 (D)、开关 (SW)
  - 接地和端点

### 📊 波形显示
- **实时波形绘制** - 使用 Canvas 绘制高性能波形图
- **多节点监测** - 同时观测多个节点的电压变化
- **缩放和平移** - 灵活查看波形细节
- **示波器面板** - 类似实验室示波器的专业界面

### 💾 数据管理
- **电路保存/加载** - JSON 格式导入导出
- **浏览器本地存储** - 自动保存电路设计
- **电路示例库** - 包含多个经典电路

### 📱 用户体验
- **响应式设计** - 适配桌面和平板
- **快捷操作** - 撤销/重做、快速参数调整
- **视觉反馈** - 清晰的元件连接状态显示

---

## 📚 预定义电路示例

项目内置多个经典电路示例，可直接加载学习：

| 电路名称 | 应用场景 | 学习重点 |
|---------|---------|---------|
| **半波整流与平滑滤波** | 电源电路 | 二极管整流、电容滤波 |
| **RLC 串联阻尼振荡** | 谐振电路 | 过阻尼/欠阻尼/临界阻尼 |
| **RC 充放电纹波** | 瞬态分析 | 时间常数、波形特性 |
| **二极管双向限幅钳位** | 保护电路 | 非线性元器件特性 |
| **电感断电高压尖峰** | 感性电路 | 感应电动势、瞬态过程 |

---

## 🏗️ 项目架构

```
circuit-simulator/
├── src/
│   ├── components/          # React 组件
│   │   ├── Canvas.jsx       # 电路绘图画布
│   │   ├── Toolbar.jsx      # 工具栏
│   │   ├── WavePanel.jsx    # 波形显示面板
│   │   └── PropertyPanel.jsx # 参数编辑面板
│   ├── utils/
│   │   ├── circuit.js       # 电路数据管理
│   │   ├── simulator.js     # 仿真引擎 (MNA 算法)
│   │   ├── solver.js        # 矩阵求解器
│   │   └── components.js    # 元器件定义
│   ├── styles/              # 样式文件
│   └── App.jsx              # 主应用组件
├── public/                  # 静态资源
├── index.html              # HTML 入口
├── package.json            # 依赖配置
├── vite.config.js          # Vite 配置
├── tailwind.config.js      # Tailwind CSS 配置
└── README.md               # 项目文档
```

### 核心模块说明

#### 🔧 `simulator.js` - 仿真引擎
基于改进的节点分析法（Modified Nodal Analysis, MNA）的电路仿真引擎：
- 自动构建电路方程
- 支持非线性元器件（二极管）
- 使用迭代法求解非线性方程
- 时间步进积分求解瞬态响应

#### 🧮 `solver.js` - 矩阵求解器
- 高斯消元法求解线性方程组
- LU 分解优化（可选）
- 数值稳定性处理

#### 🎨 `Canvas.jsx` - 绘图系统
- 基于 Canvas API 的高性能图形渲染
- 元件的拖拽、连接、编辑交互
- 实时视图更新

---

## 🚀 快速开始

### 前置要求

- **Node.js** 16.0 或更高版本
- **npm** 或 **yarn**
=======
# Circuit Simulator · 电路模拟器

一个基于 React 的交互式电路模拟器，支持实时瞬态仿真（改进节点分析法 MNA + 后向欧拉积分）、波形示波器、多信号源与常见元件建模。

## ✨ 功能特性

- **实时电路仿真**：MNA（改进节点分析法）+ 后向欧拉，3 档仿真精度（dt=100µs / 10µs / 1µs）与 0.1~3x 速度调节
- **元件模型**：
  - 电压源：直流 (DC) / 正弦 (AC) / 阶跃 (STEP) / 方波 (SQUARE) / 三角波 / 脉冲 (PULSE) / 指数 (EXP)
  - 电流源（波形同上）、电阻、电容、电感（均采用精确的伴随模型）
  - 二极管（0.7V 压降 + 50mΩ 内阻的理想开关模型，步内定点迭代收敛）
  - 手动/定时开关、接地、接线端子、网络标签（同名自动相连）
- **预定义教学电路（7 个）**：
  - 半波整流与平滑滤波
  - 全波整流桥与滤波
  - RLC 串联阻尼振荡
  - RC 充放电纹波（方波）
  - 二极管双向限幅钳位
  - 电感断电高压尖峰
  - 电感续流二极管钳位（与尖峰实验对照）
- **交互式编辑**：拖拽放置/移动元件、端点拖拽重新接线、正交直角布线（导线交叉自动成节点）、端点自动吸附、旋转、复制/粘贴/副本、撤销/重做（60 步）
- **示波器**：时基（0.5~200ms）与 Y 轴幅度可调，电压/电流双通道，自动量程，V/div 刻度显示，实时读数
- **仿真中实时交互**：点击手动开关通断、修改元件参数即时生效、节点电压标签实时刷新
- **工程管理**：JSON 导入/导出（带数据校验）、浏览器本地多工程保存/加载

## 🚀 安装和运行

### 前置要求

- Node.js 18 或更高（测试依赖内置 `node --test`）
- npm
>>>>>>> b30555c (feat: 全面重构电路模拟器)

### 安装和运行

<<<<<<< HEAD
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
# 代码检查和格式化
npm run lint
=======
```bash
git clone https://github.com/xiaowei2025cqu23phy/circuit-simulator.git
cd circuit-simulator
npm install
```

### 开发与构建

```bash
npm run dev      # 启动开发服务器 http://localhost:5173
npm test         # 运行仿真内核单元测试（22 项，含解析解对照）
npm run lint     # ESLint 检查
npm run build    # 生产构建
npm run preview  # 预览生产构建
```

### 部署到 GitHub Pages

```bash
npm run deploy   # 构建并推送 dist 到 gh-pages 分支
```

## 📖 使用说明

1. 从左侧工具栏选择元件，在画布上**按下并拖拽**即可放置
2. 使用「选择」或「移动」工具拖拽元件调整位置，**拖拽元件端点可重新接线**
3. 选择「导线」工具绘制连线：正交模式下自动直角拐弯，靠近端点自动吸附；导线交叉处自动形成节点
4. 点击选中元件后，在左侧面板编辑参数（电阻/电容/电感、开关控制方式、信号源波形等）
5. 放置「接地」元件（或命名端子/标签为 GND），点击「运行瞬态仿真」
6. 仿真中：点击手动开关可通断，选中任意元件或端子即可在示波器查看其电压/电流波形

### 快捷键

| 快捷键 | 功能 |
| --- | --- |
| `Ctrl+Z` / `Ctrl+Y` | 撤销 / 重做 |
| `Ctrl+C` / `Ctrl+V` | 复制 / 粘贴 |
| `Ctrl+D` | 复制副本（偏移 40px） |
| `Delete` | 删除选中元件 |
| `Esc` | 取消绘制 / 取消选择 / 关闭弹窗 |
| `Ctrl+S` | 保存到本地工程 |
| 右键拖拽 | 平移视图 |
| 滚轮 | 以光标为中心缩放 |

## 🧪 算法与测试

仿真内核为纯 JavaScript 模块（`src/sim/engine.js`），不依赖 React，可直接单元测试：

- **MNA 建模**：电阻/电容（后向欧拉伴随模型）/电感（支路电流未知量）/二极管（理想开关）/开关，电流源与电压源正确装配
- **拓扑合并**：并查集合并导线（含拐点）、同名标签、端子与接地；导线交叉点自动成节点；悬空节点/悬空导线/缺少接地均给出明确报错
- **数值求解**：部分主元 Gauss-Jordan 求逆，对角 GMIN 保证可解性
- **22 项单元测试**覆盖：RC/RLC/电感稳态的解析解对照、整流/桥式/钳位/尖峰/续流等电路行为、全部波形发生器、节点合并、矩阵求逆、参数清洗与错误检测

```bash
npm test
```

## 🗂 项目结构

```
src/
├── App.jsx              # 主界面（画布、示波器、属性面板、工程管理）
├── sim/
│   ├── engine.js        # 仿真内核（MNA + 后向欧拉，纯 JS）
│   ├── circuits.js      # 预置教学电路
│   ├── format.js        # SI 数值/电压/电流/时间格式化
│   └── engine.test.mjs  # 内核单元测试
└── main.jsx / index.css
```

## 🔒 安全说明

本项目为纯前端应用，**不包含任何 API 密钥、令牌或敏感配置**；`.gitignore` 已覆盖 `.env*`、私钥等常见敏感文件，提交前请再次确认。
>>>>>>> b30555c (feat: 全面重构电路模拟器)

# 部署到 GitHub Pages（如果配置了）
npm run deploy
```

<<<<<<< HEAD
---
=======
- **前端框架**: React 19
- **构建工具**: Vite 8
- **样式**: Tailwind CSS 3
- **图标**: Lucide React
- **代码检查**: ESLint 9
>>>>>>> b30555c (feat: 全面重构电路模拟器)

## 📖 使用指南

<<<<<<< HEAD
### 基础操作

#### 1️⃣ **添加元件**
```
1. 从左侧工具栏选择要添加的元件
2. 在画布上拖拽放置元件
3. 元件会显示其参数和两个连接端点
```

#### 2️⃣ **连接导线**
```
1. 点击第一个元件的端点
2. 拖拽到第二个元件的端点
3. 松开鼠标完成连接
```

#### 3️⃣ **编辑参数**
```
1. 双击元件打开参数编辑面板
2. 修改元件参数（如阻值、容值等）
3. 点击 "确定" 保存更改
```

#### 4️⃣ **运行仿真**
```
1. 点击顶部工具栏的 "播放" 按钮
2. 仿真开始运行（进度显示在右下角）
3. 右侧波形面板实时显示结果
```

#### 5️⃣ **查看波形**
```
1. 点击节点名称切换监测状态
2. 左侧波形面板显示已监测节点的电压曲线
3. 可缩放和平移波形以查看细节
```

### 高级操作

#### 📋 **保存/加载电路**
```javascript
// 电路会自动保存到浏览器 LocalStorage
// 也可手动导出为 JSON 文件用于分享
```

#### 🔄 **撤销/重做**
```
Ctrl+Z    撤销最后一步操作
Ctrl+Y    重做已撤销的操作
```

#### 🎯 **快速参数调整**
```
在参数面板中输入新值后，实时预览波形变化
```
=======
本项目使用了以下开源模块，除注明外均采用 MIT 许可证：

- **React / React DOM** (v19.2.5) - Copyright (c) Meta (Facebook) · MIT
- **Lucide React** (v1.8.0) - Copyright (c) Lucide Contributors · MIT
- **Vite** (v8.0.9) - Copyright (c) 2019-present, Yuxi (Evan You) and Vite contributors · MIT
- **Tailwind CSS** (v3.4.19) - Copyright (c) Tailwind Labs, Inc · MIT
- **ESLint** (v9.39.4) - Copyright (c) OpenJS Foundation and other contributors · MIT
- **Autoprefixer / PostCSS** - Copyright (c) Andrey Sitnik and other contributors · MIT
- **gh-pages** (v6.3.0) - Copyright (c) Ryan Canning · MIT

所有依赖模块的完整许可证文本可在各自仓库中查看。
>>>>>>> b30555c (feat: 全面重构电路模拟器)

---

<<<<<<< HEAD
## 🛠️ 技术栈
=======
本项目采用 GPL-3.0 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。
>>>>>>> b30555c (feat: 全面重构电路模拟器)

| 技术 | 版本 | 用途 |
|------|------|------|
| **React** | 19.2.5 | 前端框架 - UI 组件和状态管理 |
| **React DOM** | 19.2.5 | React Web 渲染 |
| **Vite** | 8.0.9 | 构建工具 - 快速开发和优化打包 |
| **Tailwind CSS** | 3.4.19 | 样式框架 - 快速 UI 开发 |
| **Lucide React** | 1.8.0 | 图标库 - UI 美化 |
| **ESLint** | 9.39.4 | 代码检查 - 代码质量 |

---

## 📚 仿真算法原理

### 改进的节点分析法 (MNA)

本项目使用改进的节点分析法进行电路仿真。基本原理：

1. **建立节点方程** - 根据基尔霍夫电流定律（KCL）
2. **构建导纳矩阵** - 基于元器件的阻抗特性
3. **求解节点电压** - 解线性/非线性方程组
4. **时间步进** - 使用欧拉法或梯形法积分

### 支持的元器件模型

- **电阻**: `V = I × R`（线性）
- **电容**: `I = C × dV/dt`（微分元素）
- **电感**: `V = L × dI/dt`（微分元素）
- **二极管**: `I = Is × (exp(V/Vt) - 1)`（非线性）
- **电源**: `V = V(t)` 或 `I = I(t)`（外部激励）

---

## 🐛 已知限制

这是一个**玩具级**仿真器，适合学习和教学。已知限制包括：

- ❌ 不支持大规模电路（>100 个元件）
- ❌ 仿真速度有限（主要受浏览器 JavaScript 引擎限制）
- ❌ 非线性元器件模型简化
- ❌ 无频率域分析（AC 小信号分析）
- ❌ 无工作点计算（需手动分析）

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
- [ ] **单元测试** - 仿真算法的自动化测试

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

## 📚 参考资源

### 电路仿真理论
- [Modified Nodal Analysis](https://en.wikipedia.org/wiki/Nodal_analysis) - 维基百科
- [SPICE 仿真器原理](http://www.seas.upenn.edu/~jan/spice.html) - 宾夕法尼亚大学

### 技术文档
- [React 官方文档](https://react.dev)
- [Vite 用户指南](https://vitejs.dev)
- [Tailwind CSS 文档](https://tailwindcss.com/docs)

### 相关项目
- [CircuitJS](https://www.falstad.com/circuit/) - 经典 Web 电路仿真器
- [SPICE](http://www.analog.com/en/tools-and-simulators/spice-models.html) - 工业级仿真工具

---

## 🌟 致谢

感谢所有为这个项目做出贡献的开源社区贡献者！

---

<div align="center">

**⭐ 如果这个项目对你有帮助，请给个 Star！⭐**

Made with ❤️ by [xiaowei2025cqu23phy](https://github.com/xiaowei2025cqu23phy)

</div>
