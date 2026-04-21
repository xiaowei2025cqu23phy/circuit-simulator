# Circuit Simulator

一个基于React的交互式电路模拟器，支持实时模拟各种电子电路元件的行为。

## 功能特性

- **实时电路模拟**: 使用改进的节点分析法（MNA）进行电路仿真
- **多种电路元件**:
  - 电压源（DC、AC、方波、三角波、脉冲、指数波）
  - 电阻、电容、电感
  - 二极管、开关
  - 接地和终端节点
- **预定义电路示例**:
  - 半波整流与平滑滤波
  - RLC串联阻尼振荡
  - RC充放电纹波
  - 二极管双向限幅钳位
  - 电感断电高压尖峰
- **交互式界面**: 拖拽元件、连接导线、实时参数调整
- **波形显示**: 实时显示电路节点的电压波形
- **保存/加载电路**: 支持JSON格式的电路文件导入导出

## 安装和运行

### 前置要求

- Node.js (版本 16 或更高)
- npm 或 yarn

### 安装步骤

1. 克隆仓库：
   ```bash
   git clone https://github.com/your-username/circuit-simulator.git
   cd circuit-simulator
   ```

2. 安装依赖：
   ```bash
   npm install
   ```

3. 启动开发服务器：
   ```bash
   npm run dev
   ```

4. 在浏览器中打开 `http://localhost:5173`

### 构建生产版本

```bash
npm run build
npm run preview
```

## 使用说明

1. 从工具栏选择元件并拖拽到画布上
2. 点击元件端点连接导线
3. 双击元件编辑参数
4. 点击播放按钮开始模拟
5. 使用波形面板查看节点电压

## 技术栈

- **前端框架**: React 19
- **构建工具**: Vite
- **样式**: Tailwind CSS
- **图标**: Lucide React
- **代码检查**: ESLint

## 依赖模块及版权声明

本项目使用了以下开源模块，所有模块均采用MIT许可证：

- **React** (v19.2.5) - Copyright (c) Meta (Facebook)
  - 许可证: MIT
  - 仓库: https://github.com/facebook/react

- **React DOM** (v19.2.5) - Copyright (c) Meta (Facebook)
  - 许可证: MIT
  - 仓库: https://github.com/facebook/react

- **Lucide React** (v1.8.0) - Copyright (c) Lucide Contributors
  - 许可证: MIT
  - 仓库: https://github.com/lucide-icons/lucide

- **Vite** (v8.0.9) - Copyright (c) 2019-present, Yuxi (Evan) You and Vite contributors
  - 许可证: MIT
  - 仓库: https://github.com/vitejs/vite

- **Tailwind CSS** (v3.4.19) - Copyright (c) Tailwind Labs, Inc
  - 许可证: MIT
  - 仓库: https://github.com/tailwindlabs/tailwindcss

- **ESLint** (v9.39.4) - Copyright (c) OpenJS Foundation and other contributors
  - 许可证: MIT
  - 仓库: https://github.com/eslint/eslint

- **Autoprefixer** (v10.5.0) - Copyright (c) Andrey Sitnik and other contributors
  - 许可证: MIT
  - 仓库: https://github.com/postcss/autoprefixer

- **PostCSS** (v8.5.10) - Copyright (c) Andrey Sitnik and other contributors
  - 许可证: MIT
  - 仓库: https://github.com/postcss/postcss

所有依赖模块的完整许可证文本可在各自的仓库中查看。

## 许可证

本项目采用GPL-3.0许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

## 贡献

欢迎提交问题和拉取请求！

## 致谢

感谢所有开源贡献者使这个项目成为可能。
