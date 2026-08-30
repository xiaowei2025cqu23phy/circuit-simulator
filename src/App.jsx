import React, { useState, useRef, useEffect, useCallback, memo, useMemo } from 'react';
import {
  MousePointer2, Minus, Zap, Activity, Trash2, Play, AlertCircle,
  RotateCw, Tag, GitCommit, LineChart, StopCircle, ArrowRight,
  TriangleRight, ToggleLeft, Download, Upload, ZoomIn, ZoomOut, Move, Trash,
  CircleDot, Pause, Save, FolderOpen, Undo2, Redo2, HelpCircle, Route, Home, Copy, Plus, X, Menu
} from 'lucide-react';
import { compileCircuit, stepEngine, sanitizeElements, nextId, getSourceValue } from './sim/engine.js';
import { PREDEFINED_CIRCUITS } from './sim/circuits.js';
import { formatValue, formatVoltage, formatCurrent, formatTime, UNIT_OF, TOOL_HINTS } from './sim/format.js';

// ==========================================
// 通用几何工具
// ==========================================
const GRID = 20;

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const distToSeg = (p, a, b) => {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return dist(p, a);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
};

/** 命中检测：返回最上层被点中的元件 { index, el } */
const getElementAt = (pt, els) => {
  for (let i = els.length - 1; i >= 0; i--) {
    const el = els[i];
    if (!el || !el.p1) continue;
    if (el.type === 'wire') {
      const segs = el.bend ? [[el.p1, el.bend], [el.bend, el.p2]] : [[el.p1, el.p2]];
      const d = Math.min(...segs.map(([a, b]) => distToSeg(pt, a, b)));
      if (d <= 8) return { index: i, el };
    } else if (['ground', 'label', 'terminal'].includes(el.type)) {
      if (dist(pt, el.p1) <= 12) return { index: i, el };
    } else if (el.p2) {
      if (distToSeg(pt, el.p1, el.p2) <= 8) return { index: i, el };
    }
  }
  return null;
};

// ==========================================
// 静态 SVG 元件渲染 (memo)
// ==========================================
const StaticElement = memo(({ el, isSelected, isSimulating, switchStates }) => {
  const color = isSelected ? (isSimulating ? '#f59e0b' : '#3b82f6') : '#1f2937';
  const strokeW = isSelected ? 3 : 2;

  if (el.type === 'wire') {
    const pts = el.bend ? `${el.p1.x},${el.p1.y} ${el.bend.x},${el.bend.y} ${el.p2.x},${el.p2.y}` : null;
    return pts
      ? <polyline points={pts} fill="none" stroke={color} strokeWidth={strokeW} strokeLinejoin="round" />
      : <line x1={el.p1.x} y1={el.p1.y} x2={el.p2.x} y2={el.p2.y} stroke={color} strokeWidth={strokeW} />;
  }
  if (el.type === 'ground') return (
    <g transform={`translate(${el.p1.x}, ${el.p1.y})`}>
      <line x1={0} y1={0} x2={0} y2={10} stroke={color} strokeWidth={strokeW} />
      <line x1={-10} y1={10} x2={10} y2={10} stroke={color} strokeWidth={strokeW} />
      <line x1={-6} y1={15} x2={6} y2={15} stroke={color} strokeWidth={strokeW} />
    </g>
  );
  if (el.type === 'label') return (
    <g transform={`translate(${el.p1.x}, ${el.p1.y})`}>
      <circle cx="0" cy="0" r="4" fill={color} />
      <line x1="0" y1="0" x2="12" y2="-12" stroke={color} strokeWidth="1.5" />
      <text x="14" y="-14" fill={color} fontSize="12" fontWeight="bold">{el.value}</text>
    </g>
  );
  if (el.type === 'terminal') return (
    <g transform={`translate(${el.p1.x}, ${el.p1.y})`}>
      <circle cx="0" cy="0" r="5" fill="white" stroke={color} strokeWidth={strokeW} />
      <circle cx="0" cy="0" r="2" fill={color} />
      {el.name && <text x="8" y="-8" fill={color} fontSize="12" fontWeight="bold">{el.name}</text>}
    </g>
  );

  const dx = el.p2.x - el.p1.x; const dy = el.p2.y - el.p1.y;
  const len = Math.sqrt(dx * dx + dy * dy); const angle = Math.atan2(dy, dx) * 180 / Math.PI;
  const mid = len / 2;

  const renderLabels = (valLabel) => (
    <g transform={`rotate(${-angle}, ${mid}, -10)`}>
      {el.name && <text x={mid} y={-24} textAnchor="middle" fill="#6b7280" fontSize="11" fontWeight="bold">{el.name}</text>}
      <text x={mid} y={-10} textAnchor="middle" fill={color} fontSize="12">{valLabel}</text>
    </g>
  );

  if (el.type === 'resistor') {
    let path = `M 0 0 L ${mid - 10} 0 `;
    for (let i = 0; i < 6; i++) path += `L ${mid - 10 + (i + 0.5) * (20 / 6)} ${i % 2 === 0 ? -6 : 6} `;
    path += `L ${mid + 10} 0 L ${len} 0`;
    return (
      <g transform={`translate(${el.p1.x}, ${el.p1.y}) rotate(${angle})`}>
        <path d={path} fill="none" stroke={color} strokeWidth={strokeW} strokeLinejoin="bevel" />
        {renderLabels(`${formatValue(el.value)}Ω`)}
      </g>
    );
  }
  if (el.type === 'capacitor') return (
    <g transform={`translate(${el.p1.x}, ${el.p1.y}) rotate(${angle})`}>
      <line x1={0} y1={0} x2={mid - 3} y2={0} stroke={color} strokeWidth={strokeW} />
      <line x1={mid - 3} y1={-10} x2={mid - 3} y2={10} stroke={color} strokeWidth={strokeW} />
      <line x1={mid + 3} y1={-10} x2={mid + 3} y2={10} stroke={color} strokeWidth={strokeW} />
      <line x1={mid + 3} y1={0} x2={len} y2={0} stroke={color} strokeWidth={strokeW} />
      {renderLabels(`${formatValue(el.value)}F`)}
    </g>
  );
  if (el.type === 'inductor') {
    let path = `M 0 0 L ${mid - 10} 0 `;
    for (let i = 0; i < 4; i++) path += `a 2.5 6 0 1 1 5 0 `;
    path += `L ${mid + 10} 0 L ${len} 0`;
    return (
      <g transform={`translate(${el.p1.x}, ${el.p1.y}) rotate(${angle})`}>
        <path d={path} fill="none" stroke={color} strokeWidth={strokeW} strokeLinejoin="round" />
        {renderLabels(`${formatValue(el.value)}H`)}
      </g>
    );
  }
  if (el.type === 'diode') {
    const isON = isSimulating && switchStates[el.id];
    const dColor = isON ? '#ef4444' : color;
    return (
      <g transform={`translate(${el.p1.x}, ${el.p1.y}) rotate(${angle})`}>
        <line x1={0} y1={0} x2={mid - 6} y2={0} stroke={color} strokeWidth={strokeW} />
        <polygon points={`${mid - 6},-8 ${mid - 6},8 ${mid + 6},0`} fill="white" stroke={dColor} strokeWidth={strokeW} />
        <line x1={mid + 6} y1={-8} x2={mid + 6} y2={8} stroke={dColor} strokeWidth={strokeW} />
        <line x1={mid + 6} y1={0} x2={len} y2={0} stroke={color} strokeWidth={strokeW} />
        <g transform={`rotate(${-angle}, ${mid}, -16)`}>
          {el.name && <text x={mid} y={-24} textAnchor="middle" fill="#6b7280" fontSize="11" fontWeight="bold">{el.name}</text>}
          {isON && <text x={mid} y={-12} textAnchor="middle" fill="#ef4444" fontSize="10">ON</text>}
        </g>
      </g>
    );
  }
  if (el.type === 'switch') {
    const isON = isSimulating ? switchStates[el.id] : el.state;
    return (
      <g transform={`translate(${el.p1.x}, ${el.p1.y}) rotate(${angle})`}>
        <line x1={0} y1={0} x2={mid - 8} y2={0} stroke={color} strokeWidth={strokeW} />
        <circle cx={mid - 8} cy={0} r={2} fill={color} />
        <circle cx={mid + 8} cy={0} r={2} fill={color} />
        <line x1={mid - 8} y1={0} x2={mid + 6} y2={isON ? 0 : -10} stroke={color} strokeWidth={strokeW} />
        <line x1={mid + 8} y1={0} x2={len} y2={0} stroke={color} strokeWidth={strokeW} />
        {renderLabels(el.control === 'manual' ? '(点击)' : `定时 ${el.timeOn}s~${el.timeOff}s`)}
      </g>
    );
  }
  if (['voltage', 'current'].includes(el.type)) {
    let waveSymbol = null;
    if (el.waveType === 'AC') waveSymbol = <path d={`M ${mid - 7} 0 Q ${mid - 3.5} -6 ${mid} 0 T ${mid + 7} 0`} fill="none" stroke={color} strokeWidth={1.5} />;
    else if (el.waveType === 'STEP') waveSymbol = <path d={`M ${mid - 6} 4 L ${mid - 2} 4 L ${mid - 2} -4 L ${mid + 6} -4`} fill="none" stroke={color} strokeWidth={1.5} />;
    else if (['SQUARE', 'PULSE'].includes(el.waveType)) waveSymbol = <path d={`M ${mid - 6} 4 L ${mid - 6} -4 L ${mid} -4 L ${mid} 4 L ${mid + 6} 4`} fill="none" stroke={color} strokeWidth={1.5} />;
    else waveSymbol = <circle cx={mid} cy={0} r="12" fill="white" stroke={color} strokeWidth={strokeW} />;

    return (
      <g transform={`translate(${el.p1.x}, ${el.p1.y}) rotate(${angle})`}>
        <circle cx={mid} cy={0} r="12" fill="white" stroke={color} strokeWidth={strokeW} />
        {waveSymbol}
        {el.type === 'voltage' && <text x={mid - 16} y={-14} fill={color} fontSize="14" fontWeight="bold">+</text>}
        {el.type === 'current' && <polygon points={`${mid + 18},0 ${mid + 12},-4 ${mid + 12},4`} fill={color} />}
        <line x1={0} y1={0} x2={mid - 12} y2={0} stroke={color} strokeWidth={strokeW} />
        <line x1={mid + 12} y1={0} x2={len} y2={0} stroke={color} strokeWidth={strokeW} />
        {renderLabels(`${el.waveType === 'DC' ? '' : el.waveType + ' '}${formatValue(el.value)}${el.type === 'voltage' ? 'V' : 'A'}`)}
      </g>
    );
  }
  return null;
});

// ==========================================
// 信号源波形参数面板（可视化选择 + 实时预览）
// ==========================================
export { WaveformParams, WavePreview }; // 供测试/复用
const WAVE_OPTIONS = [
  { id: 'DC', name: '直流' },
  { id: 'AC', name: '正弦' },
  { id: 'STEP', name: '阶跃' },
  { id: 'SQUARE', name: '方波' },
  { id: 'TRIANGLE', name: '三角' },
  { id: 'PULSE', name: '脉冲' },
  { id: 'EXP', name: '指数' },
];

/** 波形小图标 */
const WaveIcon = ({ type }) => {
  const s = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (type) {
    case 'DC': return <svg viewBox="0 0 24 12" className="w-6 h-3"><line x1="1" y1="6" x2="23" y2="6" {...s} /></svg>;
    case 'AC': return <svg viewBox="0 0 24 12" className="w-6 h-3"><path d="M1 6 Q 3.5 0 6 6 T 11 6 T 16 6 T 21 6" {...s} /></svg>;
    case 'STEP': return <svg viewBox="0 0 24 12" className="w-6 h-3"><path d="M1 3 H7 V9 H23" {...s} /></svg>;
    case 'SQUARE': return <svg viewBox="0 0 24 12" className="w-6 h-3"><path d="M1 3 H6 V9 H12 V3 H18 V9 H23" {...s} /></svg>;
    case 'TRIANGLE': return <svg viewBox="0 0 24 12" className="w-6 h-3"><path d="M1 9 H6 V3 H12 V9 H18 V3 H23" {...s} /></svg>;
    case 'PULSE': return <svg viewBox="0 0 24 12" className="w-6 h-3"><path d="M1 3 H5 V3 H6.5 V9 H11 V9 H12.5 V3 H23" {...s} /></svg>;
    case 'EXP': return <svg viewBox="0 0 24 12" className="w-6 h-3"><path d="M1 3 H3 Q 12 3 23 9" {...s} /></svg>;
    default: return null;
  }
};

/** 波形实时预览：按当前参数采样并绘制窗口波形，参数变化即时重绘 */
const WavePreview = memo(({ el }) => {
  const data = useMemo(() => {
    const type = el.waveType || 'DC';
    const N = 260;
    let win = 2e-3;
    if (type === 'STEP') win = Math.max((Number(el.stepTime) || 0.001) * 2.2, 1e-4);
    else if (type !== 'DC') {
      const per = type === 'PULSE' ? (Number(el.per) || 2e-3) : 1 / (Number(el.freq) || 50);
      win = Math.max(per * 2, 2e-4);
      if (type === 'EXP') {
        win = Math.max(win, (Number(el.td2) || 1e-3) + 6 * Math.max(Number(el.tau2) || 1e-3, 1e-9));
      }
    }
    let warn = null;
    if (type === 'PULSE') {
      const seg = (Number(el.tr) || 1e-6) + (Number(el.pw) || 1e-3) + (Number(el.tf) || 1e-6);
      if (seg >= (Number(el.per) || 2e-3)) warn = '⚠️ 上升+脉宽+下降 ≥ 周期，脉冲将变形';
    }
    let mm = -Infinity, mn = Infinity;
    const pts = [];
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * win;
      const v = getSourceValue(el, t);
      if (v > mm) mm = v;
      if (v < mn) mn = v;
      pts.push([t, v]);
    }
    mm = Math.max(mm, 0); mn = Math.min(mn, 0);
    let vMax = mm, vMin = mn;
    if (vMax === vMin) { vMax += 1; vMin -= 1; }
    const pad = (vMax - vMin) * 0.08;
    vMax += pad; vMin -= pad;
    const W = 200, H = 54;
    const x0 = 2, x1 = W - 2, y0 = 4, y1 = H - 4;
    const mapY = (v) => y1 - ((v - vMin) / (vMax - vMin)) * (y1 - y0);
    let d = '';
    pts.forEach(([t, v], i) => {
      const x = x0 + (t / win) * (x1 - x0);
      d += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${mapY(v).toFixed(2)}`;
    });
    const zeroY = (0 >= vMin && 0 <= vMax) ? mapY(0) : null;
    return { d, zeroY, vpp: mm - mn, win, warn };
  }, [el]);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-1.5">
      <svg viewBox="0 0 200 54" className="w-full h-12 block" preserveAspectRatio="none">
        {data.zeroY !== null && <line x1="0" y1={data.zeroY} x2="200" y2={data.zeroY} stroke="#cbd5e1" strokeWidth="1" strokeDasharray="3 3" />}
        <path d={data.d} fill="none" stroke="#4f46e5" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <div className="flex justify-between text-[10px] text-gray-500 font-mono mt-0.5 px-0.5">
        <span>峰峰值 {formatVoltage(data.vpp)}</span>
        <span>窗口 {formatTime(data.win)}</span>
      </div>
      {data.warn && <div className="text-[10px] text-red-500 mt-0.5">{data.warn}</div>}
    </div>
  );
});

const WaveformParams = ({ el, updateProps }) => {
  const waveType = el.waveType || 'DC';
  const unit = el.type === 'voltage' ? 'V' : 'A';

  const field = (label, key, def, opts = {}) => (
    <div className="flex-1">
      <label className="block text-xs mb-1 text-gray-500">{label}</label>
      <input
        type="number"
        step={opts.step}
        value={el[key] ?? def}
        onChange={(e) => {
          let v = parseFloat(e.target.value);
          if (!Number.isFinite(v)) v = def;
          if (opts.clamp) v = opts.clamp(v);
          updateProps({ [key]: v });
        }}
        className="w-full px-2 py-1 border rounded text-sm"
      />
    </div>
  );
  const grid = (items) => (
    <div className="grid grid-cols-2 gap-2">
      {items.map((it, i) => <React.Fragment key={i}>{it}</React.Fragment>)}
    </div>
  );
  const maxFreq = (v) => Math.max(v, 1e-3);
  const min0 = (v) => Math.max(v, 0);
  const minTiny = (v) => Math.max(v, 1e-12);
  const duty01 = (v) => Math.min(100, Math.max(0, v));

  return (
    <div className="space-y-2">
      {/* 波形类型可视化选择 */}
      <div>
        <label className="block text-xs mb-1 text-gray-500">激励波形类型</label>
        <div className="grid grid-cols-4 gap-1">
          {WAVE_OPTIONS.map(w => (
            <button key={w.id} type="button" title={`${w.name} ${w.id}`}
              onClick={() => updateProps({ waveType: w.id })}
              className={`flex flex-col items-center gap-0.5 py-1.5 rounded-md border text-[10px] transition-colors ${waveType === w.id ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm' : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300 hover:text-indigo-700'}`}>
              <WaveIcon type={w.id} />
              {w.name}
            </button>
          ))}
        </div>
      </div>

      {/* 实时波形预览 */}
      <WavePreview el={el} />

      {/* 通用参数 */}
      <div className="flex gap-2">
        {field(waveType === 'DC' ? `数值 (${unit})` : `幅值 (${unit})`, 'value', waveType === 'DC' ? 0 : 5)}
        {waveType !== 'DC' && waveType !== 'STEP' && field(`偏置 (${unit})`, 'offset', 0)}
      </div>

      {waveType === 'AC' && grid([
        field('频率 (Hz)', 'freq', 50, { clamp: maxFreq }),
        field('初相位 (°)', 'phase', 0, { clamp: (v) => Math.min(360, Math.max(-360, v)) }),
      ])}
      {waveType === 'SQUARE' && grid([
        field('频率 (Hz)', 'freq', 50, { clamp: maxFreq }),
        field('占空比 (%)', 'duty', 50, { clamp: duty01 }),
      ])}
      {waveType === 'TRIANGLE' && field('频率 (Hz)', 'freq', 50, { clamp: maxFreq })}
      {waveType === 'STEP' && grid([
        field('阶跃时刻 (s)', 'stepTime', 0.001, { clamp: min0, step: '1e-4' }),
        field(`初始偏置 (${unit})`, 'offset', 0),
      ])}
      {waveType === 'PULSE' && grid([
        field(`低电平 V1 (${unit})`, 'v1', 0),
        field(`高电平 V2 (${unit})`, 'v2', 5),
        field('延迟 Td (s)', 'td', 0, { step: '1e-6' }),
        field('上升 Tr (s)', 'tr', 1e-6, { clamp: minTiny, step: '1e-6' }),
        field('下降 Tf (s)', 'tf', 1e-6, { clamp: minTiny, step: '1e-6' }),
        field('脉宽 Pw (s)', 'pw', 1e-3, { clamp: minTiny, step: '1e-6' }),
        field('周期 Per (s)', 'per', 2e-3, { clamp: minTiny, step: '1e-6' }),
      ])}
      {waveType === 'EXP' && grid([
        field(`起始 V1 (${unit})`, 'v1', 0),
        field(`终值 V2 (${unit})`, 'v2', 5),
        field('延迟 Td1 (s)', 'td1', 0, { step: '1e-6' }),
        field('时间常数 τ1 (s)', 'tau1', 1e-3, { clamp: minTiny, step: '1e-6' }),
        field('延迟 Td2 (s)', 'td2', 1e-3, { step: '1e-6' }),
        field('时间常数 τ2 (s)', 'tau2', 1e-3, { clamp: minTiny, step: '1e-6' }),
      ])}
    </div>
  );
};

// ==========================================
// 帮助面板内容
// ==========================================
const HELP_SECTIONS = [
  {
    title: '🖱️ 基本操作',
    lines: [
      '选择元件工具后，在画布上按下并拖拽即可放置',
      '「选择」：点击选中；拖拽移动元件；拖拽元件端点可重新接线',
      '「移动」：拖拽整体移动；靠近端点拖拽可单独移动该端点',
      '「导线」：正交模式下自动直角拐弯，靠近端点自动吸附；导线交叉处自动形成节点',
      '旋转：选中元件后，在左侧属性面板点击「旋转」',
      '删除：使用「删除」工具点击元件，或选中后按 Delete 键',
    ],
  },
  {
    title: '⌨️ 快捷键',
    lines: [
      '元件工具：Q 选择 · M 移动 · W 导线 · R 电阻 · C 电容 · L 电感 · D 二极管 · S 开关 · V 电压源 · I 电流源 · T 端子 · G 接地 · N 标签 · X 删除',
      'Ctrl+Z / Ctrl+Y — 撤销 / 重做',
      'Ctrl+C / Ctrl+V — 复制 / 粘贴（粘贴位置偏移 40px）',
      'Ctrl+D — 快速复制副本',
      'Delete — 删除选中元件',
      'Esc — 取消绘制 / 取消选择 / 关闭弹窗',
      'Ctrl+S — 保存到本地工程',
      '右键拖拽 — 平移视图 · 滚轮 — 以光标为中心缩放',
    ],
  },
  {
    title: '⚡ 仿真要点',
    lines: [
      '电路必须包含接地端（GND）才能仿真',
      '仿真运行中：点击手动开关可实时通断；修改元件参数实时生效',
      '选中任意元件或端子，示波器将显示其电压 / 电流波形',
      '「精度」越高结果越精确，但仿真速度越慢；「速度」滑块控制步进速率',
      '示波器支持 X 轴时基（0.5~200ms）与 Y 轴幅度缩放',
    ],
  },
  {
    title: '🔧 元件说明',
    lines: [
      '二极管：三角形一端为阳极 (A)，竖线一端为阴极 (K)，导通压降约 0.7V',
      '端子 / 标签：相同名称的端子或标签电气相连；命名为 GND 即接地',
      '电压源波形：直流 / 正弦 / 阶跃 / 方波 / 三角波 / 脉冲 / 指数，参数面板内置实时波形预览与初相位设置',
      '电路数据（JSON）可导出 / 导入，也可保存到浏览器本地工程管理器',
    ],
  },
];

// ==========================================
// 主程序
// ==========================================
export default function CircuitSimulator() {
  const [elements, setElements] = useState(() => JSON.parse(JSON.stringify(PREDEFINED_CIRCUITS.rectifier.elements)));

  // -- 本地工作区状态管理 --
  const [workspace, setWorkspace] = useState(() => {
    try { return JSON.parse(localStorage.getItem('circuits_workspace')) || {}; }
    catch { return {}; }
  });

  const [selectedTool, setSelectedTool] = useState('select');
  const [selectedElementId, setSelectedElementId] = useState(null);
  const [drawingState, setDrawingState] = useState(null);
  const [isOrthogonal, setIsOrthogonal] = useState(true);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isScopeOpen, setIsScopeOpen] = useState(false);

  const [isSimulating, setIsSimulating] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [simSpeed, setSimSpeed] = useState(1);
  const [simDt, setSimDt] = useState(1e-5);
  const [simInfo, setSimInfo] = useState(null);
  const [ioModal, setIoModal] = useState(null);
  const [ioData, setIoData] = useState('');
  const [modalConfig, setModalConfig] = useState(null);
  const [promptValue, setPromptValue] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const [showVoltageLabels, setShowVoltageLabels] = useState(true);
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const [toast, setToast] = useState(null);
  const [scopeConfig, setScopeConfig] = useState({ timebaseMs: 20, yZoom: 1 });
  const [uiSimData, setUiSimData] = useState({ time: 0, nodes: {}, switches: {}, last: null });

  const svgRef = useRef(null);
  const scopeCanvasRef = useRef(null);
  const engineRef = useRef(null);
  const reqAnimRef = useRef(null);
  const simSpeedRef = useRef(1);
  const isPausedRef = useRef(false);
  const transformRef = useRef(transform);
  const scopeConfigRef = useRef(scopeConfig);
  const showVoltageLabelsRef = useRef(true);
  const voltageLabelRefs = useRef({});
  const dragRef = useRef(null);
  const clipboardRef = useRef(null);
  const promptValueRef = useRef('');
  const toastTimerRef = useRef(null);

  useEffect(() => { isPausedRef.current = isPaused; }, [isPaused]);
  useEffect(() => { simSpeedRef.current = simSpeed; }, [simSpeed]);
  useEffect(() => { transformRef.current = transform; }, [transform]);
  useEffect(() => { scopeConfigRef.current = scopeConfig; }, [scopeConfig]);

  const showToast = (msg) => {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 1600);
  };

  const pushUndo = () => {
    const snap = JSON.stringify(elements);
    setUndoStack(prev => (prev[prev.length - 1] === snap ? prev : [...prev, snap].slice(-60)));
    setRedoStack([]);
  };

  const undo = () => {
    if (!undoStack.length) return;
    if (isSimulating) destroyEngine();
    const prev = undoStack[undoStack.length - 1];
    setUndoStack(undoStack.slice(0, -1));
    setRedoStack(prev => [...prev, JSON.stringify(elements)]);
    setElements(JSON.parse(prev));
    setSelectedElementId(null);
    setErrorMsg('');
  };

  const redo = () => {
    if (!redoStack.length) return;
    if (isSimulating) destroyEngine();
    const next = redoStack[redoStack.length - 1];
    setRedoStack(redoStack.slice(0, -1));
    setUndoStack(prev => [...prev, JSON.stringify(elements)]);
    setElements(JSON.parse(next));
    setSelectedElementId(null);
    setErrorMsg('');
  };

  const removeVoltageLabels = useCallback(() => {
    Object.values(voltageLabelRefs.current).forEach(ref => {
      if (ref && ref.parentNode) ref.parentNode.removeChild(ref);
    });
    voltageLabelRefs.current = {};
  }, []);

  useEffect(() => { showVoltageLabelsRef.current = showVoltageLabels; if (!showVoltageLabels) removeVoltageLabels(); }, [showVoltageLabels, removeVoltageLabels]);

  // 核心：强制且干净的引擎销毁
  const destroyEngine = useCallback(() => {
    setIsSimulating(false);
    setIsPaused(false);
    if (reqAnimRef.current) {
      cancelAnimationFrame(reqAnimRef.current);
      reqAnimRef.current = null;
    }
    engineRef.current = null;
    setUiSimData({ time: 0, nodes: {}, switches: {}, last: null });
    const canvas = scopeCanvasRef.current;
    if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    removeVoltageLabels();
    setSimInfo(null);
    setErrorMsg('');
  }, [removeVoltageLabels]);

  useEffect(() => () => { if (reqAnimRef.current) cancelAnimationFrame(reqAnimRef.current); }, []);

  // ---------- 画布交互 ----------
  const getMouseCoords = (e) => {
    const rect = svgRef.current.getBoundingClientRect();
    const rawX = (e.clientX - rect.left - transform.x) / transform.scale;
    const rawY = (e.clientY - rect.top - transform.y) / transform.scale;
    return { x: Math.round(rawX / GRID) * GRID, y: Math.round(rawY / GRID) * GRID };
  };

  /** 导线绘制时吸附到最近的元件端点 */
  const snapToEndpoint = (pt) => {
    let best = null, bestD = 14;
    elements.forEach(el => {
      [el.p1, el.p2].forEach(p => {
        if (!p) return;
        const d = Math.hypot(p.x - pt.x, p.y - pt.y);
        if (d < bestD) { bestD = d; best = { x: p.x, y: p.y }; }
      });
    });
    return best || pt;
  };

  const beginDrag = (hit, pt) => {
    const el = elements[hit.index];
    let mode = 'move', endpoint = null;
    if (el.p2 && !['ground', 'label', 'terminal'].includes(el.type)) {
      if (dist(pt, el.p1) <= 12) { mode = 'endpoint'; endpoint = 'p1'; }
      else if (dist(pt, el.p2) <= 12) { mode = 'endpoint'; endpoint = 'p2'; }
    }
    dragRef.current = {
      index: hit.index, mode, endpoint,
      offset: { x: pt.x - el.p1.x, y: pt.y - el.p1.y },
      undo: JSON.stringify(elements), moved: false, captured: false,
    };
    setSelectedElementId(el.id);
  };

  const handlePointerDown = (e) => {
    if (e.button === 2 || e.button === 1) { setIsPanning(true); return; }
    if (e.button !== 0) return;
    if (isSimulating) return; // 仿真中禁止编辑（点击切换开关由 onClick 处理）

    const pt = getMouseCoords(e);
    if (selectedTool === 'select' || selectedTool === 'move') {
      const hit = getElementAt(pt, elements);
      if (hit) { beginDrag(hit, pt); return; }
      if (selectedTool === 'select') setSelectedElementId(null);
      return;
    }
    if (['ground', 'label', 'terminal'].includes(selectedTool)) {
      const typeStr = selectedTool.substring(0, 3).toUpperCase();
      const newEl = {
        id: nextId(), type: selectedTool,
        name: selectedTool === 'ground' ? '' : `${typeStr}_${Math.floor(Math.random() * 100)}`,
        p1: pt, p2: pt, value: selectedTool === 'label' ? 'NET' : null,
      };
      pushUndo();
      setElements([...elements, newEl]);
      setSelectedElementId(newEl.id);
      return;
    }
    if (['wire', 'resistor', 'voltage', 'current', 'capacitor', 'inductor', 'diode', 'switch'].includes(selectedTool)) {
      setDrawingState({ startPt: pt, currentPt: pt });
      try { svgRef.current?.setPointerCapture(e.pointerId); } catch { /* 忽略 */ }
    }
  };

  const handlePointerMove = (e) => {
    if (isPanning) { setTransform(t => ({ ...t, x: t.x + e.movementX, y: t.y + e.movementY })); return; }

    const drag = dragRef.current;
    if (drag) {
      const pt = getMouseCoords(e);
      setElements(prev => {
        const el = prev[drag.index];
        if (!el) return prev;
        let next = el, changed = false;
        if (drag.mode === 'move') {
          const np = { x: Math.round((pt.x - drag.offset.x) / GRID) * GRID, y: Math.round((pt.y - drag.offset.y) / GRID) * GRID };
          const dx = np.x - el.p1.x, dy = np.y - el.p1.y;
          if (dx || dy) {
            next = {
              ...el,
              p1: { x: el.p1.x + dx, y: el.p1.y + dy },
              p2: el.p2 ? { x: el.p2.x + dx, y: el.p2.y + dy } : null,
              bend: el.bend ? { x: el.bend.x + dx, y: el.bend.y + dy } : null,
            };
            changed = true;
          }
        } else if (el[drag.endpoint]) {
          const np = { x: Math.round(pt.x / GRID) * GRID, y: Math.round(pt.y / GRID) * GRID };
          if (np.x !== el[drag.endpoint].x || np.y !== el[drag.endpoint].y) {
            next = { ...el, [drag.endpoint]: np };
            changed = true;
          }
        }
        if (changed) {
          drag.moved = true;
          if (!drag.captured) {
            drag.captured = true;
            try { svgRef.current?.setPointerCapture(e.pointerId); } catch { /* 忽略 */ }
          }
          return [...prev.slice(0, drag.index), next, ...prev.slice(drag.index + 1)];
        }
        return prev;
      });
      return;
    }

    if (drawingState) {
      let currentPt = getMouseCoords(e);
      if (isOrthogonal && drawingState.startPt) {
        const dx = currentPt.x - drawingState.startPt.x, dy = currentPt.y - drawingState.startPt.y;
        if (Math.abs(dx) > Math.abs(dy)) currentPt.y = drawingState.startPt.y;
        else currentPt.x = drawingState.startPt.x;
      }
      if (selectedTool === 'wire') currentPt = snapToEndpoint(currentPt);
      setDrawingState({ ...drawingState, currentPt });
    }
  };

  const handlePointerUp = (e) => {
    if (e.button === 2 || e.button === 1) { setIsPanning(false); return; }

    const drag = dragRef.current;
    if (drag) {
      if (drag.moved) {
        setUndoStack(prev => [...prev, drag.undo].slice(-60));
        setRedoStack([]);
      }
      dragRef.current = null;
      return;
    }

    if (drawingState) {
      const { startPt, currentPt } = drawingState;
      if (startPt.x !== currentPt.x || startPt.y !== currentPt.y) {
        const typeStr = selectedTool.substring(0, 1).toUpperCase();
        const newEl = {
          id: nextId(), type: selectedTool,
          name: selectedTool === 'wire' ? '' : `${typeStr}${Math.floor(Math.random() * 100)}`,
          p1: startPt, p2: currentPt, value: 0,
        };
        if (selectedTool === 'wire' && isOrthogonal && startPt.x !== currentPt.x && startPt.y !== currentPt.y) {
          newEl.bend = { x: currentPt.x, y: startPt.y };
        }
        if (selectedTool === 'resistor') newEl.value = 1000;
        if (selectedTool === 'capacitor') newEl.value = 1e-6;
        if (selectedTool === 'inductor') newEl.value = 1e-3;
        if (selectedTool === 'switch') { newEl.control = 'manual'; newEl.state = true; newEl.timeOn = 0.01; newEl.timeOff = 0.02; }
        if (selectedTool === 'voltage' || selectedTool === 'current') {
          newEl.value = selectedTool === 'voltage' ? 5 : 0.1;
          newEl.offset = 0; newEl.waveType = 'DC'; newEl.freq = 50; newEl.duty = 50; newEl.phase = 0;
          newEl.v1 = 0; newEl.v2 = 5; newEl.td = 0; newEl.tr = 1e-6; newEl.tf = 1e-6;
          newEl.pw = 0.001; newEl.per = 0.002; newEl.tau1 = 1e-3; newEl.tau2 = 1e-3; newEl.td1 = 0; newEl.td2 = 1e-3;
        }
        pushUndo();
        setElements([...elements, newEl]);
        setSelectedElementId(newEl.id);
      }
      setDrawingState(null);
    }
  };

  const handleWheel = (e) => {
    e.preventDefault();
    const rect = svgRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    setTransform(t => {
      const scale = Math.max(0.2, Math.min(3, t.scale * (e.deltaY > 0 ? 0.9 : 1.1)));
      const wx = (mx - t.x) / t.scale, wy = (my - t.y) / t.scale;
      return { scale, x: mx - wx * scale, y: my - wy * scale };
    });
  };

  const handleElementClick = (e, id) => {
    e.stopPropagation();
    if (selectedTool === 'delete') {
      if (isSimulating) destroyEngine();
      pushUndo();
      setElements(elements.filter(el => el.id !== id));
      setSelectedElementId(null);
      return;
    }
    if (selectedTool === 'select' || selectedTool === 'move') {
      setSelectedElementId(id);
      if (isSimulating && engineRef.current) {
        const el = engineRef.current.allEls.find(x => x.id === id);
        if (el && el.type === 'switch' && el.control === 'manual') {
          const newState = !engineRef.current.switchStates[id];
          engineRef.current.switchStates[id] = newState;
          engineRef.current.needsMatrixRebuild = true;
          setElements(prev => prev.map(x => x.id === id ? { ...x, state: newState } : x));
        }
      }
    }
  };

  // ---------- 元件属性 ----------
  const updateSelectedProps = (updates) => {
    const el = elements.find(e => e.id === selectedElementId);
    if (!el) return;
    let next = { ...updates };
    if (['resistor', 'capacitor', 'inductor'].includes(el.type) && 'value' in next) {
      const v = Number(next.value);
      next.value = Number.isFinite(v) ? Math.max(v, 1e-12) : el.value;
    }
    const requiresRestart = next.type !== undefined || next.control !== undefined ||
      (['terminal', 'label', 'ground'].includes(el.type) && ('name' in next || 'value' in next));
    const wasSimulating = isSimulating;
    if (wasSimulating && engineRef.current) {
      if (requiresRestart) {
        destroyEngine();
      } else {
        engineRef.current.allEls.forEach(e => { if (e.id === selectedElementId) Object.assign(e, next); });
        engineRef.current.validEls.forEach(e => { if (e.id === selectedElementId) Object.assign(e, next); });
        if (el.type === 'switch' && 'state' in next) engineRef.current.switchStates[selectedElementId] = !!next.state;
        engineRef.current.needsMatrixRebuild = true;
      }
    }
    setElements(elements.map(e => e.id === selectedElementId ? { ...e, ...next } : e));
    if (wasSimulating && requiresRestart) {
      // 用更新后的元件表重新编译并继续仿真
      const newEls = elements.map(e => e.id === selectedElementId ? { ...e, ...next } : e);
      startSimulation(undefined, newEls);
    }
  };

  const rotateSelected = () => {
    const el = elements.find(e => e.id === selectedElementId);
    if (!el || !el.p2) return;
    if (isSimulating) destroyEngine();
    pushUndo();
    setElements(elements.map(e => {
      if (e.id !== selectedElementId || !e.p2) return e;
      const cx = (e.p1.x + e.p2.x) / 2, cy = (e.p1.y + e.p2.y) / 2;
      const dx = e.p1.x - cx, dy = e.p1.y - cy;
      return { ...e, p1: { x: Math.round(cx - dy), y: Math.round(cy + dx) }, p2: { x: Math.round(cx + dy), y: Math.round(cy - dx) } };
    }));
  };

  const deleteSelected = () => {
    if (!selectedElementId) return;
    if (isSimulating) destroyEngine();
    pushUndo();
    setElements(elements.filter(el => el.id !== selectedElementId));
    setSelectedElementId(null);
    showToast('已删除元件');
  };

  const copySelected = () => {
    const el = elements.find(e => e.id === selectedElementId);
    if (!el) { showToast('请先选中一个元件'); return; }
    clipboardRef.current = JSON.stringify([el]);
    showToast(`已复制 ${el.name || el.type}`);
  };

  const pasteClipboard = () => {
    let items = null;
    try { items = clipboardRef.current ? JSON.parse(clipboardRef.current) : null; } catch { items = null; }
    if (!Array.isArray(items) || !items.length) { showToast('剪贴板为空，请先复制元件'); return; }
    if (isSimulating) destroyEngine();
    const pasted = items.map(it => ({
      ...it, id: nextId(),
      p1: { ...it.p1, x: it.p1.x + 40, y: it.p1.y + 40 },
      p2: it.p2 ? { ...it.p2, x: it.p2.x + 40, y: it.p2.y + 40 } : null,
      bend: it.bend ? { ...it.bend, x: it.bend.x + 40, y: it.bend.y + 40 } : null,
    }));
    pushUndo();
    setElements([...elements, ...pasted]);
    setSelectedElementId(pasted[0].id);
    showToast(`已粘贴 ${pasted.length} 个元件`);
  };

  const duplicateSelected = () => {
    if (!selectedElementId) return;
    if (isSimulating) destroyEngine();
    const el = elements.find(e => e.id === selectedElementId);
    if (!el) return;
    const copy = {
      ...el, id: nextId(),
      p1: { ...el.p1, x: el.p1.x + 40, y: el.p1.y + 40 },
      p2: el.p2 ? { ...el.p2, x: el.p2.x + 40, y: el.p2.y + 40 } : null,
      bend: el.bend ? { ...el.bend, x: el.bend.x + 40, y: el.bend.y + 40 } : null,
    };
    pushUndo();
    setElements([...elements, copy]);
    setSelectedElementId(copy.id);
    showToast('已创建副本');
  };

  // ---------- 工程管理 ----------
  const handleClearCanvas = () => {
    setModalConfig({
      type: 'confirm', title: '清空画布', message: '⚠️ 确定要清空画板上的所有元件吗？此操作不可撤销。',
      onConfirm: () => { destroyEngine(); pushUndo(); setElements([]); setSelectedElementId(null); setModalConfig(null); },
    });
  };

  const handleLoadPredefined = (e) => {
    const key = e.target.value;
    if (!key || !PREDEFINED_CIRCUITS[key]) return;
    setModalConfig({
      type: 'confirm', title: '加载经典电路',
      message: `即将加载经典电路【${PREDEFINED_CIRCUITS[key].name}】。\n当前画布将被覆盖，是否继续？`,
      onConfirm: () => {
        destroyEngine();
        pushUndo();
        setElements(JSON.parse(JSON.stringify(PREDEFINED_CIRCUITS[key].elements)));
        setSelectedElementId(null);
        setModalConfig(null);
      },
      onCancel: () => setModalConfig(null),
    });
    e.target.value = "";
  };

  const handleLoadWorkspace = (e) => {
    const id = e.target.value;
    if (!id) return;
    const ws = workspace[id];
    if (!ws || !Array.isArray(ws.elements)) {
      setModalConfig({ type: 'alert', title: '加载失败', message: '该工程数据已损坏，无法加载。', onConfirm: () => setModalConfig(null) });
      e.target.value = "";
      return;
    }
    setModalConfig({
      type: 'confirm', title: '加载本地工程',
      message: `即将加载您的工程【${ws.name}】。\n当前画布将被覆盖，是否继续？`,
      onConfirm: () => {
        destroyEngine();
        pushUndo();
        setElements(JSON.parse(JSON.stringify(ws.elements)));
        setSelectedElementId(null);
        setModalConfig(null);
      },
      onCancel: () => setModalConfig(null),
    });
    e.target.value = "";
  };

  const handleSaveToWorkspace = () => {
    setPromptValue('未命名电路');
    promptValueRef.current = '未命名电路';
    setModalConfig({
      type: 'prompt', title: '保存工程', message: '请输入要保存的工程名称：',
      onConfirm: () => {
        const name = promptValueRef.current.trim();
        if (!name) { setModalConfig(null); return; }
        const newWs = { ...workspace, [Date.now()]: { name, elements: JSON.parse(JSON.stringify(elements)) } };
        setWorkspace(newWs);
        try { localStorage.setItem('circuits_workspace', JSON.stringify(newWs)); }
        catch { setModalConfig({ type: 'alert', title: '保存失败', message: '浏览器本地存储空间不足，无法保存。', onConfirm: () => setModalConfig(null) }); return; }
        setModalConfig(null);
        showToast(`工程「${name}」已保存`);
      },
    });
  };

  const handleDeleteWorkspace = (id, name) => {
    setModalConfig({
      type: 'confirm', title: '删除工程', message: `确定要永久删除工程【${name}】吗？`,
      onConfirm: () => {
        const newWs = { ...workspace };
        delete newWs[id];
        setWorkspace(newWs);
        try { localStorage.setItem('circuits_workspace', JSON.stringify(newWs)); } catch { /* 忽略 */ }
        setModalConfig(null);
        showToast('工程已删除');
      },
    });
  };

  // ---------- 导入导出 ----------
  const handleExport = () => { setIoData(JSON.stringify(elements, null, 2)); setIoModal('export'); };

  const handleImport = () => {
    try {
      const parsed = JSON.parse(ioData);
      if (!Array.isArray(parsed)) throw new Error('不是数组格式');
      const { elements: clean, dropped } = sanitizeElements(parsed);
      if (!clean.length) throw new Error('没有有效的元件数据');
      if (isSimulating) destroyEngine();
      pushUndo();
      setElements(clean);
      setIoModal(null);
      showToast(dropped ? `导入成功（已忽略 ${dropped} 个无效条目）` : '导入成功');
    } catch (err) {
      setModalConfig({ type: 'alert', title: '导入失败', message: `JSON 数据无效：${err.message}`, onConfirm: () => setModalConfig(null) });
    }
  };

  // ---------- 仿真 ----------
  const startSimulation = (dtOverride, elsOverride) => {
    destroyEngine();
    try {
      const src = elsOverride || elements;
      const { elements: clean } = sanitizeElements(src);
      if (!clean.length) throw new Error('画布为空，请先放置元件。');
      const dt = dtOverride || simDt;
      const eng = compileCircuit(clean, dt);
      engineRef.current = eng;
      setIsSimulating(true);
      setIsPaused(false);
      setSimInfo({ dt, N: eng.N, M: eng.M });
      // 动画循环由 useEffect([isSimulating, loop]) 统一调度；
      // eng.lastUiTime 已在编译时初始化为 0，首帧即刷新 UI
    } catch (err) {
      setErrorMsg(err.message);
      setIsSimulating(false);
    }
  };

  const changeDt = (v) => {
    const dt = Number(v);
    setSimDt(dt);
    if (isSimulating) startSimulation(dt);
  };

  const updateScope = (updates) => {
    const newConf = { ...scopeConfig, ...updates };
    setScopeConfig(newConf);
    scopeConfigRef.current = newConf;
  };

  // ---------- 示波器画布 HiDPI 适配 ----------
  const fitScopeCanvas = useCallback(() => {
    const canvas = scopeCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(320, Math.round(rect.width * dpr));
    const h = Math.max(120, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }, []);

  useEffect(() => {
    fitScopeCanvas();
    const ro = new ResizeObserver(fitScopeCanvas);
    if (scopeCanvasRef.current) ro.observe(scopeCanvasRef.current);
    window.addEventListener('resize', fitScopeCanvas);
    return () => { ro.disconnect(); window.removeEventListener('resize', fitScopeCanvas); };
  }, [fitScopeCanvas]);

  // ---------- 示波器绘制（时基按时间窗口）----------
  const drawOscilloscope = useCallback(() => {
    const canvas = scopeCanvasRef.current;
    const eng = engineRef.current;
    if (!canvas || !eng) return;
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    const cfg = scopeConfigRef.current;
    ctx.clearRect(0, 0, width, height);

    // 网格 10×10
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    for (let i = 1; i < 10; i++) {
      ctx.beginPath(); ctx.moveTo(0, (height / 10) * i); ctx.lineTo(width, (height / 10) * i); ctx.stroke();
      ctx.beginPath(); ctx.moveTo((width / 10) * i, 0); ctx.lineTo((width / 10) * i, height); ctx.stroke();
    }
    // 中线（触发参考）
    ctx.strokeStyle = '#334155';
    ctx.beginPath(); ctx.moveTo(width / 2, 0); ctx.lineTo(width / 2, height); ctx.stroke();

    const hist = eng.history;
    const emptyText = selectedElementId ? '数据采集中…' : '选中一个元件或端子开始查看波形';
    if (hist.length < 2) {
      ctx.fillStyle = '#64748b';
      ctx.font = '12px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(emptyText, width / 2, height / 2 - 4);
      return;
    }

    const span = cfg.timebaseMs / 1000;
    const tNow = hist[hist.length - 1].t;
    const tStart = tNow - span;
    let startIdx = 0;
    while (startIdx < hist.length - 2 && hist[startIdx + 1].t < tStart) startIdx++;
    const endIdx = hist.length;
    const winLen = endIdx - startIdx;
    if (winLen < 2) {
      ctx.fillStyle = '#64748b';
      ctx.font = '12px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(emptyText, width / 2, height / 2 - 4);
      return;
    }

    // 直接索引采样（最多 4000 点），避免复制大窗口
    let minV = Infinity, maxV = -Infinity, minI = Infinity, maxI = -Infinity;
    const stride = Math.max(1, Math.ceil(winLen / 4000));
    const idxs = [];
    for (let i = startIdx; i < endIdx; i += stride) idxs.push(i);
    if (idxs[idxs.length - 1] !== endIdx - 1) idxs.push(endIdx - 1);
    for (const i of idxs) {
      const p = hist[i];
      if (p.v < minV) minV = p.v;
      if (p.v > maxV) maxV = p.v;
      if (p.i < minI) minI = p.i;
      if (p.i > maxI) maxI = p.i;
    }

    let vCenter = (maxV + minV) / 2, vRange = (maxV - minV) || 1e-6;
    vRange /= cfg.yZoom;
    minV = vCenter - vRange / 2; maxV = vCenter + vRange / 2;
    let iCenter = (maxI + minI) / 2, iRange = (maxI - minI) || 1e-6;
    iRange /= cfg.yZoom;
    minI = iCenter - iRange / 2; maxI = iCenter + iRange / 2;

    const mapX = (t) => ((t - tStart) / span) * width;
    const mapYV = (v) => height - ((v - minV) / (maxV - minV)) * height;
    const mapYI = (v) => height - ((v - minI) / (maxI - minI)) * height;

    // 零线
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = '#475569';
    if (0 >= minV && 0 <= maxV) { ctx.beginPath(); ctx.moveTo(0, mapYV(0)); ctx.lineTo(width, mapYV(0)); ctx.stroke(); }
    if (0 >= minI && 0 <= maxI) { ctx.beginPath(); ctx.moveTo(0, mapYI(0)); ctx.lineTo(width, mapYI(0)); ctx.stroke(); }
    ctx.setLineDash([]);

    // 电压轨迹
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    idxs.forEach((i, n) => {
      const p = hist[i];
      const x = mapX(p.t), y = mapYV(p.v);
      if (n === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // 电流轨迹
    ctx.strokeStyle = '#f87171';
    ctx.beginPath();
    idxs.forEach((i, n) => {
      const p = hist[i];
      const x = mapX(p.t), y = mapYI(p.i);
      if (n === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // 末端光点
    const lastP = hist[endIdx - 1];
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath(); ctx.arc(mapX(lastP.t), mapYV(lastP.v), 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f87171';
    ctx.beginPath(); ctx.arc(mapX(lastP.t), mapYI(lastP.i), 3, 0, Math.PI * 2); ctx.fill();

    // 读数
    ctx.font = '11px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#38bdf8';
    ctx.fillText(`V ${formatVoltage(lastP.v)}`, 8, 16);
    ctx.fillStyle = '#f87171';
    ctx.fillText(`I ${formatCurrent(lastP.i)}`, 8, 30);
    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'right';
    ctx.fillText(`V/div ${formatVoltage(vRange / 10)}`, width - 8, 16);
    ctx.fillText(`I/div ${formatCurrent(iRange / 10)}`, width - 8, 30);
    ctx.fillStyle = '#94a3b8';
    ctx.textAlign = 'center';
    ctx.fillText(`t = ${formatTime(lastP.t)}`, width / 2, height - 8);
  }, [selectedElementId]);

  const updateVoltageLabels = useCallback(() => {
    if (!showVoltageLabelsRef.current) return;
    const eng = engineRef.current;
    if (!eng) return;
    const nodes = eng.currentNodes;
    const t = transformRef.current;
    for (const [ptStr, v] of Object.entries(nodes)) {
      let div = voltageLabelRefs.current[ptStr];
      if (!div) {
        div = document.createElement('div');
        div.className = 'absolute text-[10px] font-mono bg-emerald-600 text-white px-1 rounded shadow pointer-events-none z-10 whitespace-nowrap';
        div.style.transform = 'translate(-50%, -130%)';
        document.querySelector('.circuit-canvas-layer')?.appendChild(div);
        voltageLabelRefs.current[ptStr] = div;
      }
      const [x, y] = ptStr.split(',').map(Number);
      div.style.left = `${x * t.scale + t.x}px`;
      div.style.top = `${y * t.scale + t.y}px`;
      div.textContent = formatVoltage(v);
    }
  }, []);

  const loop = useCallback(function loopFn() {
    const eng = engineRef.current;
    if (!eng) return;
    const stepsPerFrame = Math.max(1, Math.round(50 * simSpeedRef.current));
    if (!isPausedRef.current) {
      for (let i = 0; i < stepsPerFrame; i++) stepEngine(eng, selectedElementId);
    }
    const now = performance.now();
    if (now - eng.lastUiTime > 30) {
      eng.lastUiTime = now;
      setUiSimData({ time: eng.t, nodes: { ...eng.currentNodes }, switches: { ...eng.switchStates }, last: eng.lastMeasured });
      drawOscilloscope();
      updateVoltageLabels();
    }
    reqAnimRef.current = requestAnimationFrame(loopFn);
  }, [selectedElementId, drawOscilloscope, updateVoltageLabels]);

  useEffect(() => {
    if (isSimulating) reqAnimRef.current = requestAnimationFrame(loop);
    return () => {
      if (reqAnimRef.current) cancelAnimationFrame(reqAnimRef.current);
      reqAnimRef.current = null;
    };
  }, [isSimulating, loop]);

  // ---------- 键盘快捷键 ----------
  const TOOL_KEYS = {
    q: 'select', m: 'move', w: 'wire', r: 'resistor', c: 'capacitor',
    l: 'inductor', d: 'diode', s: 'switch', v: 'voltage', i: 'current',
    t: 'terminal', g: 'ground', n: 'label', x: 'delete',
  };
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && k === 'y') { e.preventDefault(); redo(); return; }
      if (mod && k === 'c') { e.preventDefault(); copySelected(); return; }
      if (mod && k === 'v') { e.preventDefault(); pasteClipboard(); return; }
      if (mod && k === 'd') { e.preventDefault(); duplicateSelected(); return; }
      if (mod && k === 's') { e.preventDefault(); handleSaveToWorkspace(); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); return; }
      if (e.key === 'Escape') {
        setDrawingState(null);
        dragRef.current = null;
        setIoModal(null);
        setShowHelp(false);
        setSelectedElementId(null);
        return;
      }
      if (!mod && TOOL_KEYS[k]) {
        setSelectedTool(TOOL_KEYS[k]);
        setDrawingState(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---------- 工具栏 ----------
  const tools = [
    { id: 'select', name: '选择/探测 (Q)', icon: <MousePointer2 size={16} /> },
    { id: 'move', name: '移动 (M)', icon: <Move size={16} /> },
    { id: 'wire', name: '导线 (W)', icon: <Minus size={16} /> },
    { id: 'resistor', name: '电阻 (R)', icon: <Activity size={16} /> },
    { id: 'capacitor', name: '电容 (C)', icon: <Minus size={16} strokeDasharray="2 4" /> },
    { id: 'inductor', name: '电感 (L)', icon: <GitCommit size={16} /> },
    { id: 'diode', name: '二极管 (D)', icon: <TriangleRight size={16} /> },
    { id: 'switch', name: '开关 (S)', icon: <ToggleLeft size={16} /> },
    { id: 'voltage', name: '电压源 (V)', icon: <Zap size={16} /> },
    { id: 'current', name: '电流源 (I)', icon: <ArrowRight size={16} /> },
    { id: 'terminal', name: '接线端子 (T)', icon: <CircleDot size={16} /> },
    { id: 'ground', name: '接地 (G)', icon: <Minus size={16} style={{ transform: 'rotate(90deg)' }} /> },
    { id: 'label', name: '网络标签 (N)', icon: <Tag size={16} /> },
    { id: 'delete', name: '删除 (X)', icon: <Trash2 size={16} /> },
  ];

  const selectedEl = elements.find(e => e.id === selectedElementId) || null;

  return (
    <div className="relative flex h-[100dvh] min-h-0 w-full overflow-hidden bg-gray-100 text-gray-800 font-sans">
      {/* 移动端侧栏遮罩 */}
      {isMobileSidebarOpen && <button aria-label="关闭工具面板" onClick={() => setIsMobileSidebarOpen(false)} className="fixed inset-0 z-30 bg-slate-950/35 md:hidden" />}

      {/* ======== 侧边栏：PC 常驻，移动端抽屉 ======== */}
      <div className={`mobile-sidebar fixed inset-y-0 left-0 z-40 flex w-[min(88vw,22rem)] max-w-full flex-col bg-white shadow-2xl transition-transform duration-200 md:relative md:z-20 md:w-72 md:translate-x-0 md:shrink-0 md:border-r md:border-gray-200 ${isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-4 border-b border-gray-100 bg-gradient-to-r from-indigo-600 to-indigo-500 text-white flex justify-between items-center">
          <div>
            <h1 className="text-lg font-bold flex items-center gap-2"><Activity size={20} /> 电路仿真 · EDA 工作台</h1>
            <p className="text-xs text-indigo-200 mt-0.5">MNA 瞬态分析 · Workspace & DSO Scope</p>
          </div>
          <button onClick={() => setIsMobileSidebarOpen(false)} aria-label="关闭工具面板" className="rounded p-2 text-indigo-100 hover:bg-indigo-500 md:hidden"><X size={18} /></button>
        </div>

        {/* 本地项目管理器 */}
        <div className="p-3 border-b border-indigo-100 bg-indigo-50/50 flex flex-col gap-2">
          <div className="flex items-center justify-between text-indigo-800 font-bold text-xs mb-1">
            <span className="flex items-center gap-1"><FolderOpen size={14} /> 💾 我的工程管理器</span>
            <button onClick={handleSaveToWorkspace} title="保存当前画布 (Ctrl+S)" className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-700 text-white px-2 py-1 rounded shadow-sm">
              <Save size={12} /> 保存当前
            </button>
          </div>
          {Object.keys(workspace).length > 0 ? (
            <select onChange={handleLoadWorkspace} className="w-full text-xs py-1.5 px-2 border border-indigo-200 rounded bg-white text-indigo-900 outline-none cursor-pointer">
              <option value="">打开已保存的工程...</option>
              {Object.entries(workspace).map(([id, ws]) => (
                <option key={id} value={id}>📄 {ws.name} ({new Date(Number(id)).toLocaleDateString()})</option>
              ))}
            </select>
          ) : (
            <div className="text-xs text-gray-400 text-center py-1">暂无保存的工程</div>
          )}
          {Object.keys(workspace).length > 0 && (
            <div className="text-[10px] text-gray-500 text-right">
              管理：
              {Object.entries(workspace).map(([id, ws]) => (
                <span key={id} onClick={() => handleDeleteWorkspace(id, ws.name)} className="cursor-pointer text-red-500 hover:underline ml-2" title="删除">删除 "{ws.name}"</span>
              ))}
            </div>
          )}
        </div>

        {/* 预置与导入导出 */}
        <div className="p-3 border-b border-gray-100 flex flex-col gap-2 bg-gray-50">
          <select onChange={handleLoadPredefined} className="w-full text-xs py-1.5 px-2 border border-gray-300 rounded bg-white text-gray-700 outline-none cursor-pointer">
            <option value="">📂 加载经典教学电路...</option>
            {Object.entries(PREDEFINED_CIRCUITS).map(([k, v]) => <option key={k} value={k}>• {v.name}</option>)}
          </select>
          <div className="flex gap-2 justify-center">
            <button onClick={handleClearCanvas} className="flex-1 flex justify-center items-center gap-1 text-xs py-1 bg-red-50 text-red-600 border border-red-200 rounded hover:bg-red-100 font-medium"><Trash size={12} /> 清空</button>
            <button onClick={handleExport} className="flex-1 flex justify-center items-center gap-1 text-xs py-1 bg-white border border-gray-300 rounded hover:bg-gray-100"><Download size={12} /> 导出</button>
            <button onClick={() => { setIoModal('import'); setIoData(''); }} className="flex-1 flex justify-center items-center gap-1 text-xs py-1 bg-white border border-gray-300 rounded hover:bg-gray-100"><Upload size={12} /> 导入</button>
          </div>
        </div>

        <div className="p-3 flex-1 overflow-y-auto">
          {/* 元件工具 */}
          <div className={`space-y-1 mb-5 ${isSimulating ? 'opacity-50 pointer-events-none' : ''}`}>
            {tools.map(tool => (
              <button key={tool.id} title={TOOL_HINTS[tool.id]}
                onClick={() => { setSelectedTool(tool.id); setSelectedElementId(null); setDrawingState(null); setIsMobileSidebarOpen(false); }}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${selectedTool === tool.id ? 'bg-indigo-100 text-indigo-800 font-medium shadow-inner' : 'hover:bg-gray-100 text-gray-600'}`}>
                {tool.icon} {tool.name}
              </button>
            ))}
          </div>

          {/* 元件属性面板 */}
          {selectedEl && (
            <div className={`p-4 rounded-lg border ${isSimulating ? 'border-amber-400 bg-amber-50 shadow-inner' : 'border-blue-100 bg-blue-50'}`}>
              <h2 className={`text-sm font-semibold mb-3 flex justify-between items-center ${isSimulating ? 'text-amber-800' : 'text-blue-800'}`}>
                元件属性
                {!isSimulating && ['resistor', 'capacitor', 'inductor', 'voltage', 'current', 'diode', 'switch'].includes(selectedEl.type) && selectedEl.p2 && (
                  <button onClick={rotateSelected} title="绕中心旋转 90°" className="flex gap-1 text-xs bg-white border border-blue-200 px-2 py-1 rounded hover:bg-blue-100 text-blue-700">
                    <RotateCw size={12} /> 旋转
                  </button>
                )}
              </h2>
              <div className="space-y-3">
                <div className="flex gap-2">
                  <div className="flex-1"><label className="block text-xs mb-1 text-gray-500">类型</label><div className="text-sm font-medium uppercase text-gray-700">{selectedEl.type}</div></div>
                  <div className="flex-1">
                    <label className="block text-xs mb-1 text-gray-500">标识名称</label>
                    <input type="text" value={selectedEl.name || ''} onChange={(e) => updateSelectedProps({ name: e.target.value })} className="w-full px-2 py-1 border rounded text-sm focus:ring-1 focus:ring-indigo-400 outline-none" />
                  </div>
                </div>
                {['resistor', 'capacitor', 'inductor'].includes(selectedEl.type) && (
                  <div>
                    <label className="block text-xs mb-1 text-gray-500">参数值 ({UNIT_OF[selectedEl.type]})</label>
                    <input type="number" value={selectedEl.value} onChange={(e) => updateSelectedProps({ value: parseFloat(e.target.value) || 0 })} className="w-full px-2 py-1.5 border rounded text-sm" />
                    <div className="text-[10px] text-gray-400 mt-0.5">当前: {formatValue(selectedEl.value)}{UNIT_OF[selectedEl.type]} · 负值/非法输入将自动钳制</div>
                  </div>
                )}
                {selectedEl.type === 'switch' && (
                  <>
                    <div>
                      <label className="block text-xs mb-1 text-gray-500">控制方式</label>
                      <select value={selectedEl.control} onChange={(e) => updateSelectedProps({ control: e.target.value })} className="w-full px-2 py-1 border rounded text-sm">
                        <option value="manual">手动 (点击切换)</option>
                        <option value="time">定时自动</option>
                      </select>
                    </div>
                    {selectedEl.control === 'manual' && (
                      <div>
                        <label className="block text-xs mb-1 text-gray-500">初始状态</label>
                        <select value={selectedEl.state ? "on" : "off"} onChange={(e) => updateSelectedProps({ state: e.target.value === "on" })} className="w-full px-2 py-1 border rounded text-sm">
                          <option value="on">初始闭合</option>
                          <option value="off">初始断开</option>
                        </select>
                      </div>
                    )}
                    {selectedEl.control === 'time' && (
                      <div className="flex gap-2">
                        <div className="flex-1"><label className="block text-xs text-gray-500">闭合时刻 (s)</label><input type="number" value={selectedEl.timeOn} onChange={e => updateSelectedProps({ timeOn: parseFloat(e.target.value) })} className="w-full px-2 py-1 border rounded text-sm" /></div>
                        <div className="flex-1"><label className="block text-xs text-gray-500">断开时刻 (s)</label><input type="number" value={selectedEl.timeOff} onChange={e => updateSelectedProps({ timeOff: parseFloat(e.target.value) })} className="w-full px-2 py-1 border rounded text-sm" /></div>
                      </div>
                    )}
                  </>
                )}
                {['voltage', 'current'].includes(selectedEl.type) && <WaveformParams el={selectedEl} updateProps={updateSelectedProps} />}

                {/* 仿真中实时读数 */}
                {isSimulating && uiSimData.last && (
                  <div className="p-2 bg-gray-900 rounded text-[11px] font-mono text-emerald-400 space-y-0.5">
                    <div className="text-gray-500 text-[10px]">实时测量 (t={formatTime(uiSimData.last.t)})</div>
                    <div>电压 V = {formatVoltage(uiSimData.last.v)}</div>
                    <div>电流 I = {formatCurrent(uiSimData.last.i)}</div>
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  <button onClick={copySelected} title="复制 (Ctrl+C)" className="flex-1 flex justify-center items-center gap-1 text-xs py-1.5 bg-white border border-gray-300 rounded hover:bg-gray-100"><Copy size={12} /> 复制</button>
                  <button onClick={duplicateSelected} title="复制副本 (Ctrl+D)" className="flex-1 flex justify-center items-center gap-1 text-xs py-1.5 bg-white border border-gray-300 rounded hover:bg-gray-100"><Plus size={12} /> 副本</button>
                  <button onClick={deleteSelected} title="删除 (Delete)" className="flex-1 flex justify-center items-center gap-1 text-xs py-1.5 bg-red-50 border border-red-200 text-red-600 rounded hover:bg-red-100"><Trash2 size={12} /> 删除</button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 仿真控制 */}
        <div className="p-4 border-t border-gray-200 bg-gray-50 flex flex-col gap-3">
          <div className="flex gap-3">
            <div className="flex-1 flex flex-col gap-1">
              <div className="flex justify-between text-xs text-gray-600"><span>仿真速度</span><span className="font-mono">{simSpeed.toFixed(1)}x</span></div>
              <input type="range" min="0.1" max="3" step="0.1" value={simSpeed} onChange={(e) => setSimSpeed(parseFloat(e.target.value))} className="w-full h-1.5 bg-gray-300 rounded-lg appearance-none cursor-pointer accent-indigo-600" />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-xs text-gray-600"><span>仿真精度 (步长 dt)</span><span className="font-mono">{simInfo ? formatTime(simInfo.dt) : formatTime(simDt)}</span></div>
            <select value={simDt} onChange={(e) => changeDt(e.target.value)} className="w-full text-xs py-1.5 px-2 border border-gray-300 rounded bg-white text-gray-700 outline-none cursor-pointer">
              <option value={1e-4}>快速 (dt=100µs) — 适用于高频/长时间仿真</option>
              <option value={1e-5}>标准 (dt=10µs) — 推荐</option>
              <option value={1e-6}>高精度 (dt=1µs) — 更准确，速度较慢</option>
            </select>
          </div>
          {isSimulating ? (
            <div className="flex gap-2">
              <button onClick={() => setIsPaused(!isPaused)} className={`flex-1 flex items-center justify-center gap-1 ${isPaused ? 'bg-amber-500 hover:bg-amber-600' : 'bg-blue-500 hover:bg-blue-600'} text-white py-2 rounded-lg shadow text-sm font-medium transition-colors`}>
                {isPaused ? <Play size={16} /> : <Pause size={16} />} {isPaused ? '继续' : '冻结'}
              </button>
              <button onClick={destroyEngine} className="flex-1 flex items-center justify-center gap-1 bg-red-500 hover:bg-red-600 text-white py-2 rounded-lg shadow text-sm font-medium transition-colors"><StopCircle size={16} /> 停止</button>
            </div>
          ) : (
            <button onClick={() => startSimulation()} className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white py-2.5 rounded-lg shadow font-medium transition-colors">
              <Play size={18} /> 运行瞬态仿真
            </button>
          )}
        </div>
      </div>

      {/* ======== 画布区 ======== */}
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-[length:20px_20px] select-none" style={{ backgroundImage: 'radial-gradient(#d1d5db 1px, transparent 1px)' }}>
        {/* 移动端顶部操作栏 */}
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-gray-200 bg-white/95 px-3 shadow-sm backdrop-blur md:hidden">
          <button onClick={() => setIsMobileSidebarOpen(true)} aria-label="打开工具面板" className="rounded-lg p-2 text-gray-700 hover:bg-gray-100"><Menu size={20} /></button>
          <div className="min-w-0 text-center">
            <div className="truncate text-sm font-bold text-gray-800">电路仿真工作台</div>
            <div className="text-[10px] text-gray-500">{selectedEl ? `探测 ${selectedEl.name || selectedEl.type}` : '选择元件开始编辑'}</div>
          </div>
          <button onClick={() => setShowHelp(true)} aria-label="打开帮助" className="rounded-lg p-2 text-gray-700 hover:bg-gray-100"><HelpCircle size={19} /></button>
        </div>

        {/* 画布工具栏 */}
        <div className="absolute left-2 right-2 top-[4.5rem] z-20 flex flex-col gap-2 md:left-4 md:right-auto md:top-4">
          <div className="canvas-toolbar flex max-w-full gap-1 overflow-x-auto rounded-lg border border-gray-200 bg-white/90 p-1.5 shadow-sm backdrop-blur">
            <button onClick={undo} disabled={!undoStack.length} title="撤销 (Ctrl+Z)" className="p-1.5 hover:bg-gray-100 rounded text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed"><Undo2 size={16} /></button>
            <button onClick={redo} disabled={!redoStack.length} title="重做 (Ctrl+Y)" className="p-1.5 hover:bg-gray-100 rounded text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed"><Redo2 size={16} /></button>
            <span className="w-px bg-gray-200 mx-1" />
            <button onClick={() => setTransform({ x: 0, y: 0, scale: 1 })} title="复位视图" className="p-1.5 hover:bg-gray-100 rounded text-gray-600"><Home size={16} /></button>
            <button onClick={() => setTransform(t => ({ ...t, scale: Math.min(3, t.scale * 1.2) }))} title="放大" className="p-1.5 hover:bg-gray-100 rounded text-gray-600"><ZoomIn size={16} /></button>
            <button onClick={() => setTransform(t => ({ ...t, scale: Math.max(0.2, t.scale * 0.8) }))} title="缩小" className="p-1.5 hover:bg-gray-100 rounded text-gray-600"><ZoomOut size={16} /></button>
            <span className="w-px bg-gray-200 mx-1" />
            <button onClick={() => setIsOrthogonal(o => !o)} title="正交布线（导线自动直角拐弯）" className={`p-1.5 rounded ${isOrthogonal ? 'bg-indigo-100 text-indigo-700' : 'hover:bg-gray-100 text-gray-600'}`}><Route size={16} /></button>
            <button onClick={() => setShowVoltageLabels(v => !v)} title="显示/隐藏节点电压标签" className={`p-1.5 rounded ${showVoltageLabels ? 'bg-indigo-100 text-indigo-700' : 'hover:bg-gray-100 text-gray-600'}`}><Tag size={16} /></button>
            <button onClick={() => setShowHelp(true)} title="帮助" className="p-1.5 hover:bg-gray-100 rounded text-gray-600"><HelpCircle size={16} /></button>
          </div>
          {isOrthogonal && <div className="text-[10px] text-gray-500 bg-white/80 rounded px-2 py-0.5 backdrop-blur w-fit">正交布线: 开</div>}
        </div>

        {/* 错误提示 */}
        {errorMsg && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 bg-red-100 text-red-700 px-4 py-2 rounded-md shadow border border-red-200 text-sm flex items-center gap-2">
            <AlertCircle size={16} className="inline shrink-0" /> {errorMsg}
            <button onClick={() => setErrorMsg('')} className="text-red-400 hover:text-red-700"><X size={14} /></button>
          </div>
        )}

        {/* 空画布提示 */}
        {elements.length === 0 && !isSimulating && (
          <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
            <div className="bg-white/90 backdrop-blur rounded-xl shadow-lg border border-gray-200 px-8 py-6 text-center">
              <p className="text-3xl mb-2">🔌</p>
              <p className="font-semibold text-gray-700">画布为空</p>
              <p className="text-sm text-gray-500 mt-1">从左侧工具栏选择元件，在画布上按下拖拽绘制<br />别忘了放置一个「接地」元件才能运行仿真</p>
            </div>
          </div>
        )}

        {/* 画布 SVG */}
        <div className="relative min-h-0 flex-1 circuit-canvas-layer">
          <svg ref={svgRef}
            className={`w-full h-full touch-none ${isPanning ? 'cursor-grabbing' : isSimulating ? 'cursor-crosshair' : selectedTool === 'move' ? 'cursor-move' : 'cursor-default'}`}
            onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp}
            onWheel={handleWheel} onContextMenu={(e) => e.preventDefault()}>
            <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.scale})`}>
              {elements.map(el => (
                <g key={el.id} className="cursor-pointer" onClick={(e) => handleElementClick(e, el.id)}>
                  <title>{el.name ? `${el.name} (${el.type})` : el.type}</title>
                  {['wire', 'resistor', 'voltage', 'current', 'capacitor', 'inductor', 'diode', 'switch'].includes(el.type) && (
                    el.type === 'wire' && el.bend
                      ? <polyline points={`${el.p1.x},${el.p1.y} ${el.bend.x},${el.bend.y} ${el.p2.x},${el.p2.y}`} fill="none" stroke="transparent" strokeWidth={15} />
                      : <line x1={el.p1.x} y1={el.p1.y} x2={el.p2.x} y2={el.p2.y} stroke="transparent" strokeWidth={15} />
                  )}
                  <StaticElement el={el} isSelected={el.id === selectedElementId} isSimulating={isSimulating} switchStates={uiSimData.switches} />
                </g>
              ))}
              {drawingState && (() => {
                const { startPt, currentPt } = drawingState;
                const bend = isOrthogonal && startPt.x !== currentPt.x && startPt.y !== currentPt.y ? { x: currentPt.x, y: startPt.y } : null;
                return bend
                  ? <polyline points={`${startPt.x},${startPt.y} ${bend.x},${bend.y} ${currentPt.x},${currentPt.y}`} fill="none" stroke="#9ca3af" strokeWidth={2} strokeDasharray="4 4" />
                  : <line x1={startPt.x} y1={startPt.y} x2={currentPt.x} y2={currentPt.y} stroke="#9ca3af" strokeWidth={2} strokeDasharray="4 4" />;
              })()}
              {elements.map((el, i) => (
                <React.Fragment key={`nodes-${el.id}-${i}`}>
                  <circle cx={el.p1.x} cy={el.p1.y} r={3} fill="#4b5563" />
                  {el.p2 && <circle cx={el.p2.x} cy={el.p2.y} r={3} fill="#4b5563" />}
                  {el.bend && <circle cx={el.bend.x} cy={el.bend.y} r={2} fill="#9ca3af" />}
                </React.Fragment>
              ))}
            </g>
          </svg>
          {/* 移动端常用工具快捷栏 */}
          {!isSimulating && (
            <div className="absolute bottom-2 left-2 right-2 z-20 flex items-center justify-between gap-1 overflow-x-auto rounded-xl border border-gray-200 bg-white/95 p-1.5 shadow-lg backdrop-blur md:hidden">
              {tools.filter(tool => ['select', 'move', 'wire', 'resistor', 'voltage', 'ground'].includes(tool.id)).map(tool => (
                <button key={`mobile-${tool.id}`} onClick={() => { setSelectedTool(tool.id); setSelectedElementId(null); setDrawingState(null); }} aria-label={tool.name}
                  className={`flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-2 text-[10px] ${selectedTool === tool.id ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
                  {tool.icon}<span>{tool.name.split(' ')[0]}</span>
                </button>
              ))}
              <button onClick={() => setIsMobileSidebarOpen(true)} aria-label="打开全部工具" className="flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-2 text-[10px] text-gray-600 hover:bg-gray-100"><Menu size={16} /><span>全部</span></button>
            </div>
          )}
        </div>

        {/* ======== 示波器 ======== */}
        <div className={`${isScopeOpen ? 'h-64' : 'h-11'} md:h-64 overflow-hidden bg-gray-900 border-t-4 ${isSimulating ? (isPaused ? 'border-amber-500' : 'border-indigo-500') : 'border-gray-700'} flex shrink-0 flex-col transition-[height] duration-200 z-20`}>
          <div className="flex min-h-10 flex-wrap items-center justify-between gap-2 bg-gray-800 px-3 py-2 text-xs text-gray-300 md:px-4">
            <div className="flex min-w-0 items-center">
              <button onClick={() => setIsScopeOpen(v => !v)} aria-label={isScopeOpen ? '折叠示波器' : '展开示波器'} className="mr-2 rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-white md:hidden">{isScopeOpen ? <Minus size={15} /> : <Plus size={15} />}</button>
              <span className="font-semibold uppercase flex items-center gap-2 text-white"><LineChart size={14} /> {selectedEl ? `探测: [${selectedEl.name || '未命名'}]` : '示波器'}</span>
              {selectedEl && (
                <div className={`${isScopeOpen ? 'flex' : 'hidden'} gap-5 ml-4 border-l border-gray-600 pl-4 md:flex`}>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <span className="text-[10px] text-gray-400">X轴 时基:</span>
                    <input type="range" min="1" max="200" step="1" value={scopeConfig.timebaseMs} onChange={e => updateScope({ timebaseMs: Number(e.target.value) })} className="w-24 h-1 bg-gray-600 rounded appearance-none cursor-pointer accent-indigo-400" />
                    <span className="text-[9px] text-gray-500 w-9 text-right">{scopeConfig.timebaseMs}ms</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <span className="text-[10px] text-gray-400">Y轴 幅度:</span>
                    <input type="range" min="0.2" max="5" step="0.2" value={scopeConfig.yZoom} onChange={e => updateScope({ yZoom: Number(e.target.value) })} className="w-24 h-1 bg-gray-600 rounded appearance-none cursor-pointer accent-indigo-400" />
                    <span className="text-[9px] text-gray-500 w-4 text-right">{scopeConfig.yZoom.toFixed(1)}x</span>
                  </label>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 md:gap-4">
              {isPaused && <span className="bg-amber-500 text-white px-2 py-0.5 rounded text-[10px] font-bold tracking-wider animate-pulse">PAUSED</span>}
              {simInfo && <span className="hidden text-[10px] text-gray-400 font-mono sm:inline">dt={formatTime(simInfo.dt)} · 节点 {simInfo.N} · 支路 {simInfo.M}</span>}
              <span className="hidden items-center gap-1 text-[10px] sm:flex"><span className="w-2 h-2 rounded-full bg-sky-400 inline-block"></span> 电压 V</span>
              <span className="hidden items-center gap-1 text-[10px] sm:flex"><span className="w-2 h-2 rounded-full bg-red-400 inline-block"></span> 电流 A</span>
              <span className="text-gray-400 font-mono w-20 text-right text-[10px]">t: {(uiSimData.time * 1000).toFixed(1)}ms</span>
            </div>
          </div>
          <div className="flex-1 relative p-2 pt-1 pb-3">
            <canvas ref={scopeCanvasRef} width={1200} height={200} className="w-full h-full block bg-black rounded shadow-inner border border-gray-700" />
          </div>
        </div>

        {/* 导入/导出弹窗 */}
        {ioModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
            <div className="w-[min(500px,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl bg-white p-5 shadow-2xl flex flex-col gap-3">
              <h3 className="font-bold text-lg">{ioModal === 'export' ? '导出电路 JSON' : '粘贴 JSON 代码导入'}</h3>
              <textarea className="w-full h-64 border rounded p-2 text-xs font-mono bg-gray-50 focus:ring-2 outline-none" value={ioData} onChange={e => setIoData(e.target.value)} readOnly={ioModal === 'export'} placeholder='[{"id":"r1","type":"resistor",...}]' />
              <div className="flex justify-end gap-2 mt-2">
                <button onClick={() => setIoModal(false)} className="px-4 py-2 text-sm bg-gray-200 rounded hover:bg-gray-300">关闭</button>
                {ioModal === 'import' && <button onClick={handleImport} className="px-4 py-2 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700">确认导入</button>}
              </div>
            </div>
          </div>
        )}

        {/* 通用确认/提示弹窗 */}
        {modalConfig && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
            <div className="w-[min(400px,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl bg-white p-5 shadow-2xl flex flex-col gap-4">
              <h3 className="font-bold text-lg text-gray-800">{modalConfig.title}</h3>
              <p className="text-sm text-gray-600 whitespace-pre-line">{modalConfig.message}</p>
              {modalConfig.type === 'prompt' && (
                <input
                  type="text"
                  autoFocus
                  value={promptValue}
                  onChange={(e) => { setPromptValue(e.target.value); promptValueRef.current = e.target.value; }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); modalConfig.onConfirm(); } }}
                  className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-indigo-400 outline-none text-sm"
                />
              )}
              <div className="flex justify-end gap-2 mt-2">
                {modalConfig.type !== 'alert' && (
                  <button onClick={() => { if (modalConfig.onCancel) modalConfig.onCancel(); setModalConfig(null); }} className="px-4 py-2 text-sm bg-gray-200 rounded hover:bg-gray-300">取消</button>
                )}
                <button onClick={() => modalConfig.onConfirm()} className="px-4 py-2 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700">确定</button>
              </div>
            </div>
          </div>
        )}

        {/* 帮助弹窗 */}
        {showHelp && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
            <div className="w-[min(560px,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl bg-white p-6 shadow-2xl flex flex-col gap-4">
              <div className="flex justify-between items-center">
                <h3 className="font-bold text-lg text-gray-800">📖 使用帮助</h3>
                <button onClick={() => setShowHelp(false)} className="p-1 hover:bg-gray-100 rounded text-gray-500"><X size={18} /></button>
              </div>
              {HELP_SECTIONS.map(section => (
                <div key={section.title}>
                  <h4 className="font-semibold text-sm text-indigo-700 mb-1.5">{section.title}</h4>
                  <ul className="space-y-1 text-xs text-gray-600 leading-relaxed">
                    {section.lines.map((line, i) => <li key={i}>• {line}</li>)}
                  </ul>
                </div>
              ))}
              <div className="text-[10px] text-gray-400 border-t pt-3">仿真内核：改进节点分析法 (MNA) + 后向欧拉积分 · 二极管理想开关模型 (0.7V / 50mΩ)</div>
            </div>
          </div>
        )}

        {/* 轻提示 */}
        {toast && (
          <div className="absolute bottom-72 left-1/2 -translate-x-1/2 z-50 bg-gray-800/95 text-white text-xs px-4 py-2 rounded-full shadow-lg whitespace-nowrap">
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}
