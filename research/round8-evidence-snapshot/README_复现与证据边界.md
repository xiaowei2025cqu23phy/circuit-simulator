# HSP-MNA 第八轮：Native Node.js MNA 基准与第八轮论文

**最新研究稿**：上级目录 `HSP-MNA_第八轮整合研究稿.pdf`（50 页：前七轮 42 页 + 第八轮 8 页）。

## 本包包含

- `第八轮技术附录.pdf` / `.md`：第八轮研究正文，包含实验条件、理论式、最新文献对照和限制。
- `figures/`：5 幅原创实验图的 PNG 和 SVG 版本。
- `bench_workspace/scripts/benchmark-mna-scaling.mjs`：**本轮实际执行的 Node.js 基准**，已经在 Debian 13 / Node 22.16.0 中运行。
- `bench_workspace/src/sim/{linearSolve,rankOneUpdate}.js`：从研究分支对应模块的算法拷贝；不构成完整仓库。
- `mna_scaling_node22_raw.csv`：六个矩阵规模、七次重复计时结果，含中位数、四分位和残差。
- `mna_sensitivity_rhs1.csv` / `mna_sensitivity_rhs32.csv`：每状态右端向量数量敏感性。
- `replica_rhs*_batch*.csv`：外部独立进程的检查；注意 RHS=32 第三批在运行环境中断，**没有完整的 128 阶数据**，不得纳入统计。
- `environment*.json`：Node 版本、CPU 名称、测试维数和重复次数。
- `create_figures.py`：将原始 CSV 绘制成 PNG/SVG 的代码。

## 运行

```bash
cd bench_workspace
node scripts/benchmark-mna-scaling.mjs --sizes=8,16,32,64,96,128 --repetitions=7 --events=24 --rhs=8 > ../rerun.csv
```

不需要下载 npm 依赖。其他批次将 `--rhs=1`、`--rhs=32` 修改即可。

## GitHub

- 研究分支： https://github.com/xiaowei2025cqu23phy/circuit-simulator/tree/research/hsp-mna-validation
- Draft PR #1： https://github.com/xiaowei2025cqu23phy/circuit-simulator/pull/1
- 仓库复现脚本： `scripts/benchmark-mna-scaling.mjs`
- 原始 Node 摘要： `research/node22_mna_scaling_results.csv`
- GitHub 研究说明： `docs/eighth-round-node-benchmark.md`

## 不得外推的结论

1. 这是真实 Node 计时，但仅针对**稠密线性代数内核 + 合成 MNA 型矩阵**。没有测试用户网页的帧率、交互延迟或整体瞬态积分。
2. 合成网络在受测参数下未触发秩一病态回退，不能据此否定第七轮桥式整流中的失败案例。
3. 没有运行 ngspice 或真实器件物理实验，因此不能声称算法达到 SPICE 级物理精度。
4. 尚未在完整 GitHub 工作区执行 npm test/lint/build。GitHub Actions 受到用户账户账单问题限制，不追查。
5. “Sherman–Morrison 更新”是经典已知算法，相关文献中已有稳定性分析与稀疏 EMT 结构补偿，不能称为原创公式。

生成时间：2026-10-29。所有中位数和四分位均为容器共享 CPU 上的一次受控采样；跨设备需重复测试。
