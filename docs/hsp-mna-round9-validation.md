# HSP-MNA 第九轮工程验证与性能研究报告

验证日期：2026-10-30（Etc/GMT-8）

## 摘要

本轮在独立 Git worktree `../circuit-simulator-hsp-validation`、分支 `research/hsp-mna-local-validation` 上对研究分支 `07a54b1` 执行真实 Node.js 验证。`npm ci` 成功；初次 `npm test` 暴露已有测试的 `ptToStr` 未定义错误（67 项中 65 通过、2 失败）。在研究测试文件中补充与引擎一致的坐标键转换函数后，67 项全部通过，`npm run lint` 与 `npm run build` 均通过。六项现有 HSP 基准命令均以退出码 0 运行。

**边界：**本轮完成的是既有研究功能的工程测试和已存在基准的运行，并非用户列出的所有新增电路/规模全面验证。本报告不会把已定义测试以外的案例视为完成。当前基准规模为 8、16、32、64、96 阶；128 阶只存在此前其他运行环境的历史 CSV，当前 Windows 本轮未跑到 128 阶。未增加新器件电路网表，也没有独立 SPICE 物理模型验证。ngspice 不在 PATH。相关研究结论只适用于相同 PWL 器件模型与指定离散化设置。

## 1. 环境与版本

- OS：Windows 11 家庭版（中文）；CPU：AMD Ryzen 5 7520U with Radeon Graphics。
- Node.js：v26.8.1；npm：11.19.0；Git：本地工作树。
- 系统可见内存约 15.98 GiB；检查时可用约 1.42 GiB（动态值）。
- 分支起始 commit：`07a54b1`，工作区起始干净；远程 `origin/research/hsp-mna-validation` fetch 到该分支最新提交。
- `package.json` 声明使用 Node 测试运行器 `node --test src/sim/*.test.mjs`，Vite 8 构建。
- `npm ci` 安装 244 个包；npm 报告 11 项审计告警（1 low、2 moderate、8 high）。本轮未运行自动依赖升级，以免无范围评估地改变依赖。
- ngspice：未安装/未找到。外部 SPICE 未验证。

## 2. 工程测试

| 命令 | 实际结果 |
|---|---|
| `npm ci` | 通过；244 packages；11 audit advisories |
| 初次 `npm test` | 65/67；2 项 `ReferenceError: ptToStr is not defined` |
| 修复后 `npm test` | 67/67 通过，Node 原生测试运行器，约 4.9 秒 |
| `npm run lint` | 通过 |
| `npm run build` | 通过；Vite 8.0.9，1728 modules，JS gzip 87.39 kB |
| `npm run benchmark:hsp` | 通过 |
| `npm run benchmark:hsp:lu` | 通过 |
| `npm run benchmark:hsp:rank1` | 通过 |
| `npm run benchmark:hsp:scale` | 通过 |
| `npm run benchmark:hsp:event` | 通过 |
| `npm run benchmark:hsp:secant` | 通过 |

构建另有过时 caniuse-lite 提示和插件计时提示；不是构建失败。默认线性求解器仍是 `inverse`，默认二极管 solver 仍保留原行为，研究模式通过选项显式启用。

## 3. 修复与回归

`src/sim/research.test.mjs` 的两个续流事件断言引用 `ptToStr`，但该测试文件没有导入或定义该标识符；两个测试因此在仿真循环开始前直接报错。按测试文件已有的 `point` 表示和 `engine.js` 坐标映射格式补充本地坐标键转换函数。两个测试随后均通过，验证预测模式状态差异、guard/adaptive 校正、续流负尖峰约束及 unresolved 计数。生产仿真代码及默认算法未修改。

修复前 2 个测试失败；修复后 67/67 通过。新增测试数为 0（修复既有测试辅助函数缺失），恢复有效测试 2 项。

## 4. 数值正确性审查

### 4.1 现有单元/集成证据

现有测试覆盖 LU 部分主元行交换、奇异矩阵识别、格式校验、多 RHS 分解复用；逆矩阵/ LU 在四个预置电路、五种二极管模式下比较；Sherman–Morrison 支路更新涵盖普通支路、接地端、近奇异分母回退、桥式整流回退与事件试算回溯缓存一致性。线性代数单元案例残差阈值为 `1e-12`。本轮 `benchmark:hsp:scale` 在 8–96 阶合成矩阵上报告最坏绝对残差约 `3.55e-15` 至 `1.37e-14`；LU 与全逆参考最大解差约 `4.44e-16` 至 `1.05e-14`。这是合成矩阵代数实验，不等于对任意真实电路的误差上界。

### 4.2 本轮实际电路比较

`benchmark:hsp:lu` 和 `benchmark:hsp:rank1` 均对半波整流、全波桥、二极管限幅、续流四个预置电路运行 4000 步、40 ms、dt=10 µs，并覆盖迭代、预测、固定 guard、自适应、端点迟滞校正。BE 终点源采样用于研究比较。

- LU 对完整逆的节点电压差：各电路/模式通常为 1e-13 V 量级；续流历史预测模式最大约 1.97e-10 V。所有记录的 unresolved steps 为 0。
- 秩一逆与完整逆大多在约 1e-11 V 内；桥式整流观测到约 2.84e-8 V 最大电压差，同时出现 8 次安全回退（相对 9 次全逆分解为 5 次完整分解、8 次秩一更新、4 次回退）。这证实回退路径对该案例有实际作用；不能据此声称无条件精确等价。
- `benchmark:hsp` 同模型细网格参考是 hysteretic-corrected PWL、dt=1 µs、BE 终点源采样，并非物理真值。预测模式的误差在续流案例严重：dt=10 µs RMSE 118.46 V、最大误差 7492.14 V；端点校正对应 RMSE 7.05e-9 V、最大误差 1.68e-8 V。freewheel 预置电路测试同样专门暴露预测模式尖峰，不能把一步预测当作可靠精度解。
- 同 PWL law 的端点校正对本实验参考解表现最佳，但 1 µs 参考仍是数值参考，并非 Shockley/SPICE 或实物基准。

### 4.3 伴随、源采样、事件

已有测试明确核对 BE 新时间层源采样的一步 RC 伴随方程、源采样模式校验、定时开关对齐、事件拒绝试算不污染提交历史、启动状态处理及 secant safeguards。事件基准中 BE-end 与 legacy-start 误差差异显著，例如 freewheel dt=10 µs legacy-start RMSE 0.0906 V、最大误差 5.73 V；BE-end RMSE 7.05e-9 V、最大误差 1.68e-8 V（对同一细网格 PWL 参考）。因此时间采样相位不可与状态预测误差混在一起解释。

事件细分和割线脚本运行通过且 unresolved steps 为 0；细分产生额外拒绝试算，例如桥式整流 dt=10 µs 有 99 次 rejected trial solves。割线计数报告估计事件和求解工作量，但这些 CSV 不提供统一的独立多轮 wall-time 汇总，不能当作性能胜负结论。

### 4.4 矩阵盖章审查范围

现有引擎/测试中电阻与二极管导纳 stamp、独立源和电流源、BE 电容/电感、开关电阻支路、矩阵重建和状态变更已有功能及回归覆盖。LU 和 rank-one 更新源码中支路差分使用 `a=e_i-e_j`，地端通过省略参考节点分量处理；切换 `deltaG` 有符号地作用于同一支路 stamp；分母按绝对/相对阈值检查并触发完整重建/求逆。当前审查不等于对每一种 MNA 拓扑组合或支路电流测量作完备证明。独立电压源附加支路、变步长全器件网格、更多近奇异拓扑仍需要系统化网表测试。

## 5. 性能研究

### 5.1 合成稠密 MNA 核心

本轮 Node v26.8.1、Ryzen 5 7520U、7 次重复、轮换方法次序、预热；24 个开关事件、每个状态 8 个 RHS、共 192 次线性求解。当前实测中位数（ms）：

| 阶数 | Gauss–Jordan 逆 | 稠密 LU | Rank-1 逆更新 |
|---:|---:|---:|---:|
| 8 | 1.647 | 1.071 | 1.895 |
| 16 | 3.695 | 1.613 | 4.029 |
| 32 | 14.255 | 5.312 | 10.381 |
| 64 | 86.523 | 22.666 | 38.383 |
| 96 | 244.447 | 65.046 | 76.992 |

在该合成负载中 LU 从小维度起总体领先；Rank-1 需要更高维度才接近 LU，但 96 阶仅略慢/相近且 IQR 较宽。Rank-1 对每个事件都更新（24 次）、不发生安全回退；而此内核把逆矩阵与每个 RHS 相乘，LU 则分解一次后回代，因此对 RHS 数量和实现细节敏感。已有历史 Node 22 RHS 灵敏度 CSV 显示单 RHS 与 32 RHS 下交叉关系不同；这是不同机器/Node 的历史证据，不与本轮数据合并平均。

完整电路 rank-one 对整流器和续流的耗时有时较快、有时较慢；桥式整流有安全回退与误差到 1e-8 量级；LU 与逆的完整电路运行耗时也受 Node 调度、GC、矩阵规模和状态模式影响。不能把核心算法时间宣称为整个仿真器加速比。

### 5.2 完整电路研究基准

`benchmark:hsp` 的计时为实际 JavaScript 电路步进，3 次重复中位数用于本机粗观察。归档 CSV 中，10 µs、4000 步：整流器预测/端点校正为 48.21/40.94 ms；全波桥为 58.34/67.59 ms；限幅为 37.05/42.04 ms；续流为 61.83/52.22 ms。各电路下不同策略表现并不恒定，且该脚本重复数较少。`benchmark:hsp:lu` 与 `rank1` 有 5 次重复的中位时间，但没有专门 warmup 阶段和 Q1/Q3 展示；对时延差异不作强因果结论。

未测量独立进程峰值内存；基准内存占用数据缺失。全电路覆盖仅四个既有案例；多级 RC/RL、多个 RLC 组合以及 128 阶/更大实际 MNA 规模还需补充。

## 6. 可复现性与数据

六个 npm benchmark 命令已在本轮 Node/Windows 上执行，命令、重复数和方法在 `scripts/` 中。核心规模脚本输出环境、计时分位数、因子分解/更新/回退次数、解数、残差和解差。完整电路脚本注明参考模型和源采样。报告中没有把历史文件中的 Node 22/Linux/EPYC 数据冒充为本机数据。

原始输出 CSV 与错误流记录：`research/round9-*.csv`、`research/round9-*.stderr.txt`（其中规模数据使用本次原生 Node 输出）。复现命令：

```powershell
npm ci
npm test
npm run lint
npm run build
npm run benchmark:hsp
npm run benchmark:hsp:lu
npm run benchmark:hsp:rank1
npm run benchmark:hsp:scale
npm run benchmark:hsp:event
npm run benchmark:hsp:secant
```

规模自定义复现示例：`node scripts/benchmark-mna-scaling.mjs --sizes=16,32,64,96 --rhs=8 --events=24 --repetitions=7`。

## 7. 论文修订建议

**可报告为独立复核的内容：** Node 原生全量测试、LU 部分主元与重复 RHS、当前合成矩阵残差、四个现有电路的 LU/逆对照、桥式 rank-one 安全回退实际触发、BE-end 与 PWL 细网格参考的误差差异。

**应收紧的结论：** 预测算法在开关/续流关键瞬态可严重失准；性能取决于维度、RHS 复用数、矩阵状态变化及回退率，不能笼统宣称 rank-one 或 LU 一定更快。历史 `legacy-start` 与当前 BE-end 数据是不同时间约定，论文需分开说明。迭代器与预测/校正器器件状态判据不同，除非同一迟滞 law，否则不应将差异只归因于算法。

**正文候选：** 相同 PWL law 下 BE-end、统一 dt、明确细网格参考的状态误差；桥式整流分母近奇异案例及安全回退；给出 N/RHS/切换数条件的 LU vs inverse vs rank-one benchmark。

**补充材料候选：** 全部原始 CSV、四个预置电路的网格敏感性、事件拒绝工作量/割线估计、运行环境与 Node 版本、历史 Node 22 与本轮 Windows 的平台分层结果、所有失败和极端瞬态样例。

## 8. 未解决事项及优先级

1. 建立具备参数/网表/探针明细的多拓扑固定测试集，补齐多级 RC/RL/RLC、多个同时切换二极管、独立源/电感支路以及 128 阶及以上真实 MNA 系统。
2. 扩展引擎诊断，提供统一的每步 MNA `||Ax-b||∞`、支路电流与非收敛/极端值记录，并系统测试变步长、事件回滚与缓存一致性。
3. 增加多轮、预热、分位数/离散度、内存采样的完整电路基准，按 RHS 数量和安全回退率界定 LU/Rank-1 适用边界。

外部 SPICE：本机未找到 ngspice，因此本轮只验证同模型离散化/算法一致性，物理器件准确性仍待外部独立验证。

---

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
