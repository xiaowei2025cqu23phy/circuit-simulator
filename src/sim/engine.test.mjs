// ============================================================
// 仿真内核单元测试（node --test）
// 运行: npm test   （即 node --test src/sim/）
// 验证项：解析解对照（RC / RLC / 电感稳态）、整流/钳位/尖峰/续流等
//         预置电路、波形发生器、节点合并（导线交叉/拐点）、矩阵求逆、
//         参数清洗、错误检测（缺地 / 悬空节点）
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compileCircuit, stepEngine, getSourceValue, invertMatrix,
  sanitizeElements, ptToStr,
} from './engine.js';
import { PREDEFINED_CIRCUITS } from './circuits.js';

// ---------- 工具 ----------
const vAt = (eng, x, y) => eng.currentNodes[ptToStr({ x, y })] ?? 0;
const vEl = (eng, id) => {
  const el = eng.validEls.find(e => e.id === id);
  if (!el) return NaN;
  return (el.n1 >= 0 ? vAt(eng, el.p1.x, el.p1.y) : 0) - (el.n2 >= 0 ? vAt(eng, el.p2.x, el.p2.y) : 0);
};

/**
 * 运行仿真并采样探针点电压。
 * @param warmup 跳过前 warmup 秒（初始瞬态），再开始采样
 * @param perStep 为 true 时逐步采样（捕捉单步尖峰）
 */
function runSim(els, { dt = 1e-5, steps = 1000, sampleEvery = 100, probePoint = null, warmup = 0, perStep = false } = {}) {
  const eng = compileCircuit(els, dt);
  const samples = [];
  for (let i = 0; i < steps; i++) {
    stepEngine(eng);
    const doSample = perStep ? true : (i % sampleEvery === sampleEvery - 1);
    if (probePoint && doSample && eng.t >= warmup) {
      const v = vAt(eng, probePoint.x, probePoint.y);
      assert.ok(Number.isFinite(v), `采样值应为有限数，得到 ${v}`);
      samples.push({ t: eng.t, v });
    }
  }
  return { eng, samples };
}

const stats = (samples) => {
  let min = Infinity, max = -Infinity, sum = 0;
  for (const s of samples) { if (s.v < min) min = s.v; if (s.v > max) max = s.v; sum += s.v; }
  return { min, max, mean: sum / samples.length };
};

/** 串联回路构造器：源（p1=上端为正）+ (R/L/C) 链 + 接地 */
function seriesLoop({ vValue = 5, waveType = 'DC', r = null, l = null, c = null }) {
  const els = [{ id: 'v1', type: 'voltage', name: 'V1', p1: { x: 0, y: 0 }, p2: { x: 0, y: 60 }, value: vValue, waveType }];
  const chain = [];
  if (r) chain.push(['r1', 'resistor', r]);
  if (l) chain.push(['l1', 'inductor', l]);
  if (c) chain.push(['c1', 'capacitor', c]);
  let px = 0;
  chain.forEach(([id, type, value]) => {
    const nx = px + 80;
    els.push({ id, type, name: id.toUpperCase(), p1: { x: px, y: 0 }, p2: { x: nx, y: 0 }, value });
    px = nx;
  });
  els.push({ id: 'w1', type: 'wire', p1: { x: px, y: 0 }, p2: { x: px, y: 60 } });
  els.push({ id: 'w2', type: 'wire', p1: { x: px, y: 60 }, p2: { x: 0, y: 60 } });
  els.push({ id: 'g1', type: 'ground', p1: { x: px, y: 60 } });
  return els;
}

// ---------- 波形发生器 ----------
test('getSourceValue: DC / STEP', () => {
  const dc = { waveType: 'DC', value: 5, offset: 0 };
  assert.equal(getSourceValue(dc, 0), 5);
  assert.equal(getSourceValue(dc, 123), 5);
  const step = { waveType: 'STEP', value: 10, offset: 0, stepTime: 1e-3 };
  assert.equal(getSourceValue(step, 0), 0);
  assert.equal(getSourceValue(step, 5e-4), 0);
  assert.equal(getSourceValue(step, 2e-3), 10);
});

test('getSourceValue: AC 正弦', () => {
  const ac = { waveType: 'AC', value: 10, offset: 1, freq: 50 };
  assert.ok(Math.abs(getSourceValue(ac, 0) - 1) < 1e-12, 't=0 应等于偏置');
  assert.ok(Math.abs(getSourceValue(ac, 0.005) - 11) < 1e-9, '1/4 周期应达峰值');
  assert.ok(Math.abs(getSourceValue(ac, 0.01) - 1) < 1e-9, '半周期后回到偏置');
});

test('getSourceValue: 方波 / 三角波', () => {
  const sq = { waveType: 'SQUARE', value: 5, offset: 0, freq: 100, duty: 25 };
  assert.equal(getSourceValue(sq, 0), 5, '占空比内为高');
  assert.equal(getSourceValue(sq, 0.001), 5);
  assert.equal(getSourceValue(sq, 0.0025), -5, '占空比边界后为低');
  const tr = { waveType: 'TRIANGLE', value: 5, offset: 0, freq: 100 };
  assert.equal(getSourceValue(tr, 0), 5);
  assert.ok(Math.abs(getSourceValue(tr, 0.0025)) < 1e-9, '1/4 周期过零');
  assert.equal(getSourceValue(tr, 0.005), -5);
});

test('getSourceValue: 脉冲 / 指数', () => {
  const p = { waveType: 'PULSE', v1: 0, v2: 5, td: 0, tr: 1e-6, tf: 1e-6, pw: 1e-3, per: 2e-3 };
  assert.equal(getSourceValue(p, 0), 0);
  assert.equal(getSourceValue(p, 5e-4), 5, '脉宽内为高');
  assert.equal(getSourceValue(p, 1.2e-3), 0, 'tr+pw 之后为低');
  assert.equal(getSourceValue(p, 1.5e-3), 0, '脉冲结束后回低');
  const e = { waveType: 'EXP', v1: 0, v2: 5, td1: 0, tau1: 1e-3, td2: 5e-3, tau2: 1e-3 };
  assert.equal(getSourceValue(e, 0), 0);
  assert.ok(Math.abs(getSourceValue(e, 1e-3) - 5 * (1 - Math.exp(-1))) < 1e-6);
  assert.ok(Math.abs(getSourceValue(e, 6e-3) - 5 * (Math.exp(-1) - Math.exp(-6))) < 1e-6, '双指数衰减');
});

// ---------- 矩阵求逆 ----------
test('invertMatrix: 正确性与奇异矩阵', () => {
  const inv = invertMatrix([[2, 1], [1, 3]]);
  assert.ok(Math.abs(inv[0][0] - 0.6) < 1e-12 && Math.abs(inv[0][1] + 0.2) < 1e-12);
  assert.ok(Math.abs(inv[1][0] + 0.2) < 1e-12 && Math.abs(inv[1][1] - 0.4) < 1e-12);
  assert.equal(invertMatrix([[1, 2], [2, 4]]), null, '奇异矩阵应返回 null');
});

// ---------- 参数清洗 ----------
test('sanitizeElements: 丢弃无效条目、钳制越界参数、去重 ID', () => {
  const raw = [
    null,
    { type: 'resistor', value: -5, p1: { x: 0, y: 0 }, p2: { x: 40, y: 0 } },
    { type: 'capacitor', p1: { x: 0, y: 0 } },                       // 缺 p2 → 丢弃
    { type: 'voltage', value: 'abc', waveType: 'SINE', p1: { x: 0, y: 0 }, p2: { x: 0, y: 40 } },
    { type: 'wire', id: 'w1', p1: { x: 0, y: 0 }, p2: { x: 40, y: 0 } },
    { type: 'wire', id: 'w1', p1: { x: 40, y: 0 }, p2: { x: 80, y: 0 } },
  ];
  const { elements, dropped } = sanitizeElements(raw);
  assert.equal(dropped, 2);
  assert.equal(elements.length, 4);
  assert.equal(elements[0].value, 1e-9, '负阻值应钳制到最小正值');
  assert.equal(elements[1].value, 5, '非法数值回退默认值');
  assert.equal(elements[1].waveType, 'DC', '未知波形回退 DC');
  assert.equal(elements[2].id, 'w1');
  assert.notEqual(elements[3].id, 'w1', '重复 ID 应重新生成');
  const empty = sanitizeElements('garbage');
  assert.equal(empty.elements.length, 0, '非数组输入返回空');
});

// ---------- 解析解对照 ----------
test('RC 充电曲线 vs 解析解 5(1-e^{-t/τ})', () => {
  const els = seriesLoop({ vValue: 5, r: 1000, c: 100e-6 }); // τ = 0.1s
  const { eng } = runSim(els, { dt: 2e-4, steps: 3500, sampleEvery: 500, probePoint: { x: 80, y: 0 } });
  const v = vAt(eng, 80, 0);
  const expected = 5 * (1 - Math.exp(-eng.t / 0.1));
  assert.ok(Math.abs(v - expected) < 0.02, `vC=${v} 期望≈${expected}（后向欧拉误差 <20mV）`);
});

test('RLC 欠阻尼振荡 vs 解析解（峰值 >8.5V，收敛于 5V）', () => {
  const els = seriesLoop({ vValue: 5, r: 1, l: 10e-3, c: 100e-6 });
  // ω0=1000 rad/s, ζ=0.05 → 理论峰值 5(1+e^{-ζπ/√(1-ζ²)}) ≈ 9.27V
  const { samples } = runSim(els, { dt: 1e-5, steps: 900, sampleEvery: 50, probePoint: { x: 160, y: 0 } });
  const st = stats(samples);
  assert.ok(st.max > 8.5, `峰值 ${st.max} 应接近理论值 9.27`);
  // 长时间后收敛于 5V
  const eng2 = runSim(els, { dt: 1e-5, steps: 20000, sampleEvery: 5000, probePoint: { x: 160, y: 0 } }).eng;
  const vEnd = vAt(eng2, 160, 0);
  assert.ok(Math.abs(vEnd - 5) < 0.02, `稳态 ${vEnd} 应≈5V`);
});

test('电感直流稳态电流 = V/R', () => {
  const els = seriesLoop({ vValue: 5, r: 10, l: 0.1 });
  const { eng } = runSim(els, { dt: 1e-4, steps: 2000 });
  assert.ok(Math.abs(eng.state.l1 - 0.5) < 0.005, `iL=${eng.state.l1} 应≈0.5A`);
});

// ---------- 节点合并（拓扑正确性） ----------
test('导线交叉处自动形成节点（junction）', () => {
  const els = [
    { id: 'v1', type: 'voltage', p1: { x: 0, y: 0 }, p2: { x: 0, y: 40 }, value: 5 },
    { id: 'w1', type: 'wire', p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 } },
    { id: 'w2', type: 'wire', p1: { x: 40, y: -40 }, p2: { x: 40, y: 0 } }, // 端点恰好落在干线上 → 成结
    { id: 'w3', type: 'wire', p1: { x: 60, y: -40 }, p2: { x: 60, y: 20 } }, // 跨越干线 → 交点成结
    { id: 'r1', type: 'resistor', p1: { x: 100, y: 0 }, p2: { x: 100, y: 40 }, value: 1000 },
    { id: 'w4', type: 'wire', p1: { x: 100, y: 40 }, p2: { x: 0, y: 40 } },
    { id: 'g1', type: 'ground', p1: { x: 0, y: 40 } },
  ];
  const { eng } = runSim(els, { dt: 1e-5, steps: 10 });
  assert.ok(Math.abs(vEl(eng, 'r1') - 5) < 1e-6, `负载压降 ${vEl(eng, 'r1')} 应等于源电压 5V`);
  assert.ok(Math.abs(vAt(eng, 40, -40) - 5) < 1e-6, `端点落线处应并入干线，实际 ${vAt(eng, 40, -40)}`);
  assert.ok(Math.abs(vAt(eng, 60, -40) - 5) < 1e-6, `跨越交点上方应与电源正极同电位，实际 ${vAt(eng, 60, -40)}`);
  assert.ok(Math.abs(vAt(eng, 60, 20) - 5) < 1e-6, `跨越交点下方应同电位，实际 ${vAt(eng, 60, 20)}`);
});

test('带拐点导线 (bend) 电气连通', () => {
  const els = [
    { id: 'v1', type: 'voltage', p1: { x: 0, y: 0 }, p2: { x: 0, y: 60 }, value: 5 },
    { id: 'w1', type: 'wire', p1: { x: 0, y: 0 }, bend: { x: 100, y: 0 }, p2: { x: 100, y: 60 } },
    { id: 'r1', type: 'resistor', p1: { x: 100, y: 60 }, p2: { x: 100, y: 120 }, value: 1000 },
    { id: 'w2', type: 'wire', p1: { x: 100, y: 120 }, p2: { x: 0, y: 60 } },
    { id: 'g1', type: 'ground', p1: { x: 0, y: 60 } },
  ];
  const { eng } = runSim(els, { dt: 1e-5, steps: 10 });
  assert.ok(Math.abs(vEl(eng, 'r1') - 5) < 1e-6, '拐点导线应保持电气连通');
});

// ---------- 预置电路行为 ----------
test('半波整流 + 滤波：稳态输出 8~11.5V 直流且带纹波', () => {
  const { samples } = runSim(PREDEFINED_CIRCUITS.rectifier.elements,
    { dt: 1e-5, steps: 10000, sampleEvery: 100, probePoint: { x: 320, y: 260 }, warmup: 0.025 });
  const st = stats(samples);
  assert.ok(st.mean > 8 && st.mean < 11, `均值 ${st.mean.toFixed(2)}`);
  assert.ok(st.max > 10.5 && st.max < 12.5, `峰值 ${st.max.toFixed(2)}`);
  assert.ok(st.min > 6 && st.min < 10, `谷值 ${st.min.toFixed(2)}`);
  assert.ok(st.max - st.min > 1, '应存在明显纹波');
});

test('全波整流桥 + 滤波：谷值高于半波、无负值', () => {
  const { samples } = runSim(PREDEFINED_CIRCUITS.fullwave_rect.elements,
    { dt: 1e-5, steps: 10000, sampleEvery: 100, probePoint: { x: 500, y: 180 }, warmup: 0.025 });
  const st = stats(samples);
  assert.ok(st.mean > 8.5 && st.mean < 11, `均值 ${st.mean.toFixed(2)}`);
  assert.ok(st.max > 10 && st.max < 11.5, `峰值 ${st.max.toFixed(2)}（12V 峰值 - 两个二极管压降）`);
  assert.ok(st.min > 7 && st.min < 10, `谷值 ${st.min.toFixed(2)}`);
  // 与半波对比：桥式谷值更高（纹波更小）
  const hw = runSim(PREDEFINED_CIRCUITS.rectifier.elements,
    { dt: 1e-5, steps: 10000, sampleEvery: 100, probePoint: { x: 320, y: 260 }, warmup: 0.025 });
  assert.ok(st.min > stats(hw.samples).min, '全波整流谷值应高于半波');
});

test('二极管双向限幅：输出被钳位在 ±1.5V 内且双向对称', () => {
  const { samples } = runSim(PREDEFINED_CIRCUITS.diode_clipper.elements,
    { dt: 1e-5, steps: 10000, sampleEvery: 100, probePoint: { x: 360, y: 240 }, warmup: 0.025 });
  const st = stats(samples);
  assert.ok(st.max > 0.6 && st.max < 1.5, `正向钳位 ${st.max.toFixed(3)}`);
  assert.ok(st.min > -1.5 && st.min < -0.6, `反向钳位 ${st.min.toFixed(3)}`);
  assert.ok(Math.abs(st.max + st.min) < 0.05, '正负钳位应近似对称');
});

test('电感断电高压尖峰：开关断开瞬间产生大幅正尖峰（>50V）', () => {
  const { samples } = runSim(PREDEFINED_CIRCUITS.boost_inductor.elements,
    { dt: 1e-5, steps: 2000, probePoint: { x: 360, y: 260 }, perStep: true });
  const st = stats(samples);
  assert.ok(st.max > 50, `尖峰 ${st.max.toFixed(0)}V 应远超正常电平`);
});

test('续流二极管钳位：尖峰被限制在 -2V 内', () => {
  const { eng, samples } = runSim(PREDEFINED_CIRCUITS.freewheel.elements,
    { dt: 1e-5, steps: 2000, probePoint: { x: 360, y: 260 }, perStep: true });
  const st = stats(samples);
  assert.ok(st.min > -2, `钳位电压 ${st.min.toFixed(3)}V 应≈-0.7V`);
  assert.ok(st.min < -0.4, '应确实发生钳位动作');
  const last = samples[samples.length - 1];
  assert.ok(Math.abs(last.v + 0.7) < 0.25, `断开后 ${(last.t * 1000).toFixed(1)}ms 处 V=${last.v.toFixed(3)} 应≈-0.7V`);
  assert.ok(eng.state.l1 > 0.7, `断开后电感电流 ${eng.state.l1}A 应保持（续流）`);
});

test('RC 方波充放电：电容电压在 ±5V 之间摆动（双极性源）', () => {
  const { samples } = runSim(PREDEFINED_CIRCUITS.rc_pwm.elements,
    { dt: 1e-5, steps: 5000, sampleEvery: 50, probePoint: { x: 360, y: 260 }, warmup: 0.025 });
  const st = stats(samples);
  assert.ok(st.max > 3.5 && st.max < 5.5, `峰值 ${st.max.toFixed(2)}`);
  assert.ok(st.min > -5.5 && st.min < -3.5, `谷值 ${st.min.toFixed(2)}`);
});

test('RLC 阶跃预置电路：欠阻尼振荡（负向过冲 <-15V）', () => {
  const { samples } = runSim(PREDEFINED_CIRCUITS.rlc_step.elements,
    { dt: 1e-5, steps: 5000, sampleEvery: 50, probePoint: { x: 380, y: 260 }, warmup: 0.002 });
  const st = stats(samples);
  assert.ok(st.min < -15, `过冲 ${st.min.toFixed(1)} 应超过 10V 源电压（振荡过冲）`);
  assert.ok(st.max < 0.5, `波形应在 0 与负向之间振荡（实际最大 ${st.max.toFixed(2)}）`);
});

// ---------- 错误检测 ----------
test('缺少接地端时报错', () => {
  const els = seriesLoop({ vValue: 5, r: 100 }).filter(e => e.type !== 'ground');
  assert.throws(() => compileCircuit(els), /接地/);
});

test('并联电压源（短路拓扑）时报错', () => {
  const els = [
    { id: 'v1', type: 'voltage', p1: { x: 0, y: 0 }, p2: { x: 0, y: 40 }, value: 5 },
    { id: 'v2', type: 'voltage', p1: { x: 40, y: 0 }, p2: { x: 40, y: 40 }, value: 3 },
    { id: 'w1', type: 'wire', p1: { x: 0, y: 0 }, p2: { x: 40, y: 0 } },
    { id: 'w2', type: 'wire', p1: { x: 0, y: 40 }, p2: { x: 40, y: 40 } },
    { id: 'g1', type: 'ground', p1: { x: 0, y: 40 } },
  ];
  assert.throws(() => compileCircuit(els), /非法|短路|悬空/);
});

test('悬空节点时报错（独立元件孤岛）', () => {
  const els = [
    { id: 'v1', type: 'voltage', p1: { x: 0, y: 0 }, p2: { x: 0, y: 40 }, value: 5 },
    { id: 'g1', type: 'ground', p1: { x: 0, y: 40 } },
    { id: 'r1', type: 'resistor', p1: { x: 80, y: 0 }, p2: { x: 120, y: 0 }, value: 1000 },
    { id: 'r2', type: 'resistor', p1: { x: 120, y: 0 }, p2: { x: 120, y: 40 }, value: 1000 },
    { id: 'w1', type: 'wire', p1: { x: 120, y: 40 }, p2: { x: 80, y: 40 } },
  ];
  assert.throws(() => compileCircuit(els), /悬空/);
});

test('电流源注入电阻网络的电压正确（i·R 关系）', () => {
  const els = [
    { id: 'i1', type: 'current', p1: { x: 0, y: 40 }, p2: { x: 0, y: 0 }, value: 0.1 }, // 电流从地注入节点
    { id: 'r1', type: 'resistor', p1: { x: 0, y: 0 }, p2: { x: 40, y: 0 }, value: 1000 },
    { id: 'w1', type: 'wire', p1: { x: 40, y: 0 }, p2: { x: 40, y: 40 } },
    { id: 'w2', type: 'wire', p1: { x: 40, y: 40 }, p2: { x: 0, y: 40 } },
    { id: 'g1', type: 'ground', p1: { x: 0, y: 40 } },
  ];
  const { eng } = runSim(els, { dt: 1e-5, steps: 50 });
  assert.ok(Math.abs(vAt(eng, 0, 0) - 100) < 1e-6, `0.1A×1kΩ 节点电压 ${vAt(eng, 0, 0)}V 应≈100V`);
});

// ---------- 网络标签 / 二极管阈值 / 定时开关 / 拐点交叉 ----------
test('同名端子（网络标签）跨区域电气相连', () => {
  const els = [
    { id: 'v1', type: 'voltage', p1: { x: 0, y: 0 }, p2: { x: 0, y: 40 }, value: 5 },
    { id: 'r1', type: 'resistor', p1: { x: 0, y: 0 }, p2: { x: 40, y: 0 }, value: 1000 },
    { id: 't1', type: 'terminal', name: 'VCC', p1: { x: 40, y: 0 }, p2: { x: 40, y: 0 } },
    { id: 't2', type: 'terminal', name: 'VCC', p1: { x: 80, y: 40 }, p2: { x: 80, y: 40 } },
    { id: 'r2', type: 'resistor', p1: { x: 80, y: 40 }, p2: { x: 120, y: 40 }, value: 1000 },
    { id: 'w1', type: 'wire', p1: { x: 120, y: 40 }, p2: { x: 120, y: 80 } },
    { id: 'g1', type: 'ground', p1: { x: 0, y: 40 } },
    { id: 'g2', type: 'ground', p1: { x: 120, y: 80 } },
  ];
  const { eng } = runSim(els, { dt: 1e-5, steps: 10 });
  // r1 与 r2 构成分压器：VCC = 5V × 1k/(1k+1k) = 2.5V，且两处同电位
  assert.ok(Math.abs(vAt(eng, 40, 0) - 2.5) < 1e-6, `VCC 网络应≈2.5V，实际 ${vAt(eng, 40, 0)}`);
  assert.ok(Math.abs(vAt(eng, 80, 40) - 2.5) < 1e-6, `远处同名端子应同电位，实际 ${vAt(eng, 80, 40)}`);
});

test('二极管导通阈值：0.5V 截止，1V 导通并产生压降', () => {
  const mk = (vSrc) => [
    { id: 'v1', type: 'voltage', p1: { x: 0, y: 0 }, p2: { x: 0, y: 40 }, value: vSrc },
    { id: 'r1', type: 'resistor', p1: { x: 0, y: 0 }, p2: { x: 40, y: 0 }, value: 100 },
    { id: 'd1', type: 'diode', p1: { x: 40, y: 0 }, p2: { x: 80, y: 0 } },
    { id: 'r2', type: 'resistor', p1: { x: 80, y: 0 }, p2: { x: 80, y: 40 }, value: 1000 },
    { id: 'w1', type: 'wire', p1: { x: 80, y: 40 }, p2: { x: 0, y: 40 } },
    { id: 'g1', type: 'ground', p1: { x: 0, y: 40 } },
  ];
  const off = runSim(mk(0.5), { dt: 1e-5, steps: 200 });
  assert.ok(vAt(off.eng, 80, 0) < 1e-3, `0.5V 应不足以导通二极管，实际 ${vAt(off.eng, 80, 0)}V`);
  const on = runSim(mk(1.0), { dt: 1e-5, steps: 200 });
  const vOut = vAt(on.eng, 80, 0);
  assert.ok(vOut > 0.2 && vOut < 0.35, `1V 导通后输出应≈(1-0.7)×分压 ≈0.27V，实际 ${vOut}V`);
});

test('定时开关按时序精确通断', () => {
  const els = [
    { id: 'v1', type: 'voltage', p1: { x: 0, y: 0 }, p2: { x: 0, y: 40 }, value: 5 },
    { id: 'w1', type: 'wire', p1: { x: 0, y: 0 }, p2: { x: 40, y: 0 } },
    { id: 'sw1', type: 'switch', control: 'time', timeOn: 0.01, timeOff: 0.02, state: true, p1: { x: 40, y: 0 }, p2: { x: 80, y: 0 } },
    { id: 'r1', type: 'resistor', p1: { x: 80, y: 0 }, p2: { x: 80, y: 40 }, value: 1000 },
    { id: 'w2', type: 'wire', p1: { x: 80, y: 40 }, p2: { x: 0, y: 40 } },
    { id: 'g1', type: 'ground', p1: { x: 0, y: 40 } },
  ];
  const { eng } = runSim(els, { dt: 1e-5, steps: 3000 });
  // 初始时刻 timeOn 未到 → 断开（断开时经 1e8Ω 泄漏 <50µV）；10ms 闭合；20ms 断开
  assert.ok(Math.abs(vAt(eng, 80, 0)) < 1e-3, `t=0~10ms 开关应断开，实际 ${vAt(eng, 80, 0)}V`);
  const eng2 = runSim(els, { dt: 1e-5, steps: 1500 }).eng;
  assert.ok(Math.abs(vAt(eng2, 80, 0) - 5) < 1e-3, `t=10~20ms 开关应闭合，实际 ${vAt(eng2, 80, 0)}V`);
  const eng3 = runSim(els, { dt: 1e-5, steps: 3000 }).eng;
  assert.ok(Math.abs(vAt(eng3, 80, 0)) < 1e-3, `t>20ms 开关应再次断开，实际 ${vAt(eng3, 80, 0)}V`);
});

test('拐点导线 (bend) 跨越干线自动成节点', () => {
  const els = [
    { id: 'v1', type: 'voltage', p1: { x: 0, y: 0 }, p2: { x: 0, y: 40 }, value: 5 },
    { id: 'w1', type: 'wire', p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 } },
    { id: 'w2', type: 'wire', p1: { x: 40, y: -40 }, bend: { x: 80, y: -40 }, p2: { x: 80, y: 20 } }, // 第二段在 (80,0) 跨越
    { id: 'r1', type: 'resistor', p1: { x: 100, y: 0 }, p2: { x: 100, y: 40 }, value: 1000 },
    { id: 'w3', type: 'wire', p1: { x: 100, y: 40 }, p2: { x: 0, y: 40 } },
    { id: 'g1', type: 'ground', p1: { x: 0, y: 40 } },
  ];
  const { eng } = runSim(els, { dt: 1e-5, steps: 10 });
  assert.ok(Math.abs(vEl(eng, 'r1') - 5) < 1e-6, '负载压降应等于源电压');
  assert.ok(Math.abs(vAt(eng, 40, -40) - 5) < 1e-6, `拐点导线跨越处上方应同电位，实际 ${vAt(eng, 40, -40)}`);
  assert.ok(Math.abs(vAt(eng, 80, 20) - 5) < 1e-6, `拐点导线跨越处下方应同电位，实际 ${vAt(eng, 80, 20)}`);
});

// ---------- 全预置电路数值健全性 ----------
test('所有预置电路仿真无 NaN / Infinity', () => {
  for (const [key, c] of Object.entries(PREDEFINED_CIRCUITS)) {
    const eng = compileCircuit(c.elements, 1e-5);
    for (let i = 0; i < 2000; i++) {
      stepEngine(eng);
      assert.ok(Number.isFinite(eng.t), `${key}: t 应有限`);
    }
    for (const v of Object.values(eng.currentNodes)) {
      assert.ok(Number.isFinite(v), `${key}: 节点电压应有限，得到 ${v}`);
    }
    for (const v of Object.values(eng.state)) {
      assert.ok(Number.isFinite(v), `${key}: 状态量应有限，得到 ${v}`);
    }
  }
});
