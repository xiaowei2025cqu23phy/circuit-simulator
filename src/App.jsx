import React, { useState, useRef, useEffect, useCallback, memo } from 'react';
import { 
  MousePointer2, Minus, Zap, Activity, Trash2, Play, AlertCircle, 
  RotateCw, Tag, GitCommit, CheckSquare, LineChart, StopCircle, ArrowRight,
  TriangleRight, ToggleLeft, Download, Upload, ZoomIn, ZoomOut, Move, Trash, CircleDot, Pause, Save, FolderOpen
} from 'lucide-react';

// ==========================================
// 1. 数学工具、模型与预置电路
// ==========================================

const GMIN = 1e-12; 

class DSU {
  constructor() { this.parent = {}; }
  find(i) {
    if (this.parent[i] === undefined) this.parent[i] = i;
    if (this.parent[i] === i) return i;
    return this.parent[i] = this.find(this.parent[i]);
  }
  union(i, j) {
    let rootI = this.find(i), rootJ = this.find(j);
    if (rootI !== rootJ) this.parent[rootI] = rootJ;
  }
}

function invertMatrix(M) {
  let n = M.length;
  let A = M.map(row => [...row]);
  let I = Array(n).fill(0).map((_, i) => { let r = Array(n).fill(0); r[i] = 1; return r; });
  
  for(let i=0; i<n; i++) {
    let maxRow = i;
    for(let k=i+1; k<n; k++) if(Math.abs(A[k][i]) > Math.abs(A[maxRow][i])) maxRow = k;
    if(Math.abs(A[maxRow][i]) < 1e-12) return null; 
    
    [A[i], A[maxRow]] = [A[maxRow], A[i]];
    [I[i], I[maxRow]] = [I[maxRow], I[i]];
    
    let pivot = A[i][i];
    for(let j=0; j<n; j++) { A[i][j] /= pivot; I[i][j] /= pivot; }
    for(let k=0; k<n; k++) {
      if(k !== i) {
        let factor = A[k][i];
        for(let j=0; j<n; j++) { A[k][j] -= factor*A[i][j]; I[k][j] -= factor*I[i][j]; }
      }
    }
  }
  return I;
}

const ptToStr = (p) => `${Math.round(p.x)},${Math.round(p.y)}`;

const isPointOnSegment = (p, p1, p2) => {
  if (!p || !p1 || !p2) return false;
  const cross = (p.y - p1.y) * (p2.x - p1.x) - (p.x - p1.x) * (p2.y - p1.y);
  if (Math.abs(cross) > 1e-3) return false;
  const dot = (p.x - p1.x) * (p2.x - p1.x) + (p.y - p1.y) * (p2.y - p1.y);
  if (dot < 0) return false;
  const lenSq = (p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2;
  if (dot > lenSq) return false;
  return true;
};

const getSourceValue = (el, t) => {
  const type = el.waveType || 'DC';
  const amp = Number(el.value) || 0;
  const offset = Number(el.offset) || 0;
  const freq = Number(el.freq) || 50;
  const duty = Number(el.duty) || 50;
  
  if (type === 'DC') return amp + offset;
  if (type === 'STEP') return t >= (el.stepTime || 0.001) ? amp + offset : offset;
  
  const T = 1 / freq;
  const phase = (t % T) / T;
  
  if (type === 'AC') return amp * Math.sin(2 * Math.PI * phase) + offset;
  if (type === 'SQUARE') return (phase < (duty / 100)) ? (amp + offset) : (-amp + offset);
  if (type === 'TRIANGLE') return (Math.abs(phase - 0.5) * 4 - 1) * amp + offset;
  
  if (type === 'PULSE') {
    const v1 = el.v1 || 0, v2 = el.v2 || 5;
    const td = el.td || 0, tr = el.tr || 1e-6, tf = el.tf || 1e-6;   
    const pw = el.pw || 0.001, per = el.per || 0.002; 
    const tt = t - td;
    if (tt < 0) return offset + v1;
    const mod = tt % per;
    if (mod < tr) return offset + v1 + (v2 - v1) * (mod / tr);
    if (mod < tr + pw) return offset + v2;
    if (mod < tr + pw + tf) return offset + v2 - (v2 - v1) * ((mod - tr - pw) / tf);
    return offset + v1;
  }
  
  if (type === 'EXP') {
    const v1 = el.v1 || 0, v2 = el.v2 || 5;
    const td1 = el.td1 || 0, tau1 = el.tau1 || 1e-3;
    const td2 = el.td2 || 1e-3, tau2 = el.tau2 || 1e-3;
    if (t < td1) return offset + v1;
    let exp1 = (v2 - v1) * (1 - Math.exp(-(t - td1)/tau1));
    let exp2 = (t > td2) ? (v2 - v1) * (1 - Math.exp(-(t - td2)/tau2)) : 0;
    return offset + v1 + exp1 - exp2;
  }
  return 0;
};

const buildMNA = (N, M, dt, validEls, branchEls, switchStates) => {
  const size = N + M;
  const A = Array(size).fill(0).map(() => Array(size).fill(0));
  for(let i=0; i<N; i++) A[i][i] += GMIN;

  validEls.forEach(el => {
    const { id, n1, n2, type, value } = el;
    let g = 0;
    if (type === 'resistor') g = 1.0 / (Number(value) || 1e-3);
    else if (type === 'capacitor') g = (Number(value) || 1e-6) / dt;
    else if (type === 'diode') g = switchStates[id] ? 1.0 / 0.05 : 1e-8;
    else if (type === 'switch') g = switchStates[id] ? 1.0 / 0.01 : 1e-8;

    if (g > 0) {
      if (n1 >= 0) A[n1][n1] += g;
      if (n2 >= 0) A[n2][n2] += g;
      if (n1 >= 0 && n2 >= 0) { A[n1][n2] -= g; A[n2][n1] -= g; }
    }
  });

  branchEls.forEach((el, index) => {
    const { n1, n2, type, value } = el;
    const bIdx = N + index;
    if (n1 >= 0) { A[n1][bIdx] += 1; A[bIdx][n1] += 1; }
    if (n2 >= 0) { A[n2][bIdx] -= 1; A[bIdx][n2] -= 1; }
    if (type === 'inductor') A[bIdx][bIdx] = -(Number(value) || 1e-3) / dt;
  });
  return A;
};

const PREDEFINED_CIRCUITS = {
  rectifier: {
    name: "半波整流与平滑滤波",
    elements: [
      {"id":"v1","name":"AC_IN","type":"voltage","p1":{"x":140,"y":360},"p2":{"x":140,"y":260},"value":12,"offset":0,"waveType":"AC","freq":50,"duty":50},
      {"id":"w1","type":"wire","name":"","p1":{"x":140,"y":260},"p2":{"x":220,"y":260},"value":0},
      {"id":"d1","name":"D1","type":"diode","p1":{"x":220,"y":260},"p2":{"x":320,"y":260}},
      {"id":"w2","type":"wire","name":"","p1":{"x":320,"y":260},"p2":{"x":400,"y":260},"value":0},
      {"id":"t1","type":"terminal","name":"VOUT","p1":{"x":320,"y":260},"p2":{"x":320,"y":260},"value":null},
      {"id":"c1","name":"C1","type":"capacitor","p1":{"x":320,"y":260},"p2":{"x":320,"y":360},"value":0.00047},
      {"id":"r1","name":"LOAD","type":"resistor","p1":{"x":400,"y":260},"p2":{"x":400,"y":360},"value":100},
      {"id":"w3","type":"wire","name":"","p1":{"x":400,"y":360},"p2":{"x":140,"y":360},"value":0},
      {"id":"w4","type":"wire","name":"","p1":{"x":320,"y":360},"p2":{"x":400,"y":360},"value":0},
      {"id":"g1","type":"ground","name":"","p1":{"x":260,"y":360},"p2":{"x":260,"y":360},"value":null}
    ]
  },
  rlc_step: {
    name: "RLC 串联阻尼振荡",
    elements: [
      {"id":"v1","name":"STEP","type":"voltage","p1":{"x":140,"y":360},"p2":{"x":140,"y":260},"value":10,"waveType":"STEP","stepTime":0.002},
      {"id":"w1","type":"wire","p1":{"x":140,"y":260},"p2":{"x":220,"y":260}},
      {"id":"r1","name":"R1","type":"resistor","p1":{"x":220,"y":260},"p2":{"x":300,"y":260},"value":10},
      {"id":"l1","name":"L1","type":"inductor","p1":{"x":300,"y":260},"p2":{"x":380,"y":260},"value":0.05},
      {"id":"t1","name":"VC","type":"terminal","p1":{"x":380,"y":260},"p2":{"x":380,"y":260}},
      {"id":"c1","name":"C1","type":"capacitor","p1":{"x":380,"y":260},"p2":{"x":380,"y":360},"value":1e-5},
      {"id":"w2","type":"wire","p1":{"x":380,"y":360},"p2":{"x":140,"y":360}},
      {"id":"g1","type":"ground","p1":{"x":260,"y":360},"p2":{"x":260,"y":360}}
    ]
  },
  rc_pwm: {
    name: "RC 充放电纹波 (方波)",
    elements: [
      {"id":"v1","name":"PWM","type":"voltage","p1":{"x":160,"y":360},"p2":{"x":160,"y":260},"value":5,"waveType":"SQUARE","freq":100,"duty":50},
      {"id":"w1","type":"wire","p1":{"x":160,"y":260},"p2":{"x":260,"y":260}},
      {"id":"r1","name":"R1","type":"resistor","p1":{"x":260,"y":260},"p2":{"x":360,"y":260},"value":1000},
      {"id":"t1","name":"VC","type":"terminal","p1":{"x":360,"y":260},"p2":{"x":360,"y":260}},
      {"id":"c1","name":"C1","type":"capacitor","p1":{"x":360,"y":260},"p2":{"x":360,"y":360},"value":2.2e-6},
      {"id":"w2","type":"wire","p1":{"x":360,"y":360},"p2":{"x":160,"y":360}},
      {"id":"g1","type":"ground","p1":{"x":260,"y":360},"p2":{"x":260,"y":360}}
    ]
  },
  diode_clipper: {
    name: "二极管双向限幅钳位",
    elements: [
      {"id":"v1","name":"AC_IN","type":"voltage","p1":{"x":120,"y":340},"p2":{"x":120,"y":240},"value":10,"waveType":"AC","freq":50},
      {"id":"w1","type":"wire","p1":{"x":120,"y":240},"p2":{"x":200,"y":240}},
      {"id":"r1","name":"R_LIM","type":"resistor","p1":{"x":200,"y":240},"p2":{"x":280,"y":240},"value":100},
      {"id":"w2","type":"wire","p1":{"x":280,"y":240},"p2":{"x":360,"y":240}},
      {"id":"d1","name":"D1","type":"diode","p1":{"x":280,"y":240},"p2":{"x":280,"y":340}},
      {"id":"d2","name":"D2","type":"diode","p1":{"x":360,"y":340},"p2":{"x":360,"y":240}},
      {"id":"t1","name":"V_CLIP","type":"terminal","p1":{"x":360,"y":240},"p2":{"x":360,"y":240}},
      {"id":"w3","type":"wire","p1":{"x":360,"y":340},"p2":{"x":120,"y":340}},
      {"id":"g1","type":"ground","p1":{"x":240,"y":340},"p2":{"x":240,"y":340}}
    ]
  },
  boost_inductor: {
    name: "电感断电高压尖峰",
    elements: [
      {"id":"v1","name":"DC_IN","type":"voltage","p1":{"x":140,"y":360},"p2":{"x":140,"y":260},"value":5,"waveType":"DC"},
      {"id":"w1","type":"wire","p1":{"x":140,"y":260},"p2":{"x":200,"y":260}},
      {"id":"sw1","name":"SW1","type":"switch","p1":{"x":200,"y":260},"p2":{"x":280,"y":260},"control":"time","timeOn":0,"timeOff":0.015,"state":true},
      {"id":"w2","type":"wire","p1":{"x":280,"y":260},"p2":{"x":360,"y":260}},
      {"id":"l1","name":"L_LOAD","type":"inductor","p1":{"x":360,"y":260},"p2":{"x":360,"y":360},"value":0.1},
      {"id":"t1","name":"V_KICK","type":"terminal","p1":{"x":360,"y":260},"p2":{"x":360,"y":260}},
      {"id":"w3","type":"wire","p1":{"x":360,"y":360},"p2":{"x":140,"y":360}},
      {"id":"g1","type":"ground","p1":{"x":250,"y":360},"p2":{"x":250,"y":360}}
    ]
  }
};

// ==========================================
// 2. 静态 SVG 元件渲染 (memo)
// ==========================================
const StaticElement = memo(({ el, isSelected, isSimulating, switchStates }) => {
  const color = isSelected ? (isSimulating ? '#f59e0b' : '#3b82f6') : '#1f2937';
  const strokeW = isSelected ? 3 : 2;

  if (el.type === 'wire') return <line x1={el.p1.x} y1={el.p1.y} x2={el.p2.x} y2={el.p2.y} stroke={color} strokeWidth={strokeW} />;
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
  const len = Math.sqrt(dx*dx + dy*dy); const angle = Math.atan2(dy, dx) * 180 / Math.PI;
  const mid = len/2;
  
  const renderLabels = (valLabel) => (
    <g transform={`rotate(${-angle}, ${mid}, -10)`}>
       {el.name && <text x={mid} y={-24} textAnchor="middle" fill="#6b7280" fontSize="11" fontWeight="bold">{el.name}</text>}
       <text x={mid} y={-10} textAnchor="middle" fill={color} fontSize="12">{valLabel}</text>
    </g>
  );

  if (el.type === 'resistor') {
    let path = `M 0 0 L ${mid-10} 0 `;
    for(let i=0; i<6; i++) path += `L ${mid-10 + (i+0.5)*(20/6)} ${i%2===0 ? -6 : 6} `;
    path += `L ${mid+10} 0 L ${len} 0`;
    return (
      <g transform={`translate(${el.p1.x}, ${el.p1.y}) rotate(${angle})`}>
        <path d={path} fill="none" stroke={color} strokeWidth={strokeW} strokeLinejoin="bevel" />
        {renderLabels(`${el.value}Ω`)}
      </g>
    );
  }
  if (el.type === 'capacitor') return (
    <g transform={`translate(${el.p1.x}, ${el.p1.y}) rotate(${angle})`}>
      <line x1={0} y1={0} x2={mid-3} y2={0} stroke={color} strokeWidth={strokeW} />
      <line x1={mid-3} y1={-10} x2={mid-3} y2={10} stroke={color} strokeWidth={strokeW} />
      <line x1={mid+3} y1={-10} x2={mid+3} y2={10} stroke={color} strokeWidth={strokeW} />
      <line x1={mid+3} y1={0} x2={len} y2={0} stroke={color} strokeWidth={strokeW} />
      {renderLabels(`${el.value}F`)}
    </g>
  );
  if (el.type === 'inductor') {
    let path = `M 0 0 L ${mid-10} 0 `;
    for(let i=0; i<4; i++) path += `a 2.5 6 0 1 1 5 0 `;
    path += `L ${mid+10} 0 L ${len} 0`;
    return (
      <g transform={`translate(${el.p1.x}, ${el.p1.y}) rotate(${angle})`}>
        <path d={path} fill="none" stroke={color} strokeWidth={strokeW} strokeLinejoin="round" />
        {renderLabels(`${el.value}H`)}
      </g>
    );
  }
  if (el.type === 'diode') {
     const isON = isSimulating && switchStates[el.id];
     const dColor = isON ? '#ef4444' : color; 
     return (
      <g transform={`translate(${el.p1.x}, ${el.p1.y}) rotate(${angle})`}>
        <line x1={0} y1={0} x2={mid-6} y2={0} stroke={color} strokeWidth={strokeW} />
        <polygon points={`${mid-6},-8 ${mid-6},8 ${mid+6},0`} fill="white" stroke={dColor} strokeWidth={strokeW} />
        <line x1={mid+6} y1={-8} x2={mid+6} y2={8} stroke={dColor} strokeWidth={strokeW} />
        <line x1={mid+6} y1={0} x2={len} y2={0} stroke={color} strokeWidth={strokeW} />
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
        <line x1={0} y1={0} x2={mid-8} y2={0} stroke={color} strokeWidth={strokeW} />
        <circle cx={mid-8} cy={0} r={2} fill={color} />
        <circle cx={mid+8} cy={0} r={2} fill={color} />
        <line x1={mid-8} y1={0} x2={mid+6} y2={isON ? 0 : -10} stroke={color} strokeWidth={strokeW} />
        <line x1={mid+8} y1={0} x2={len} y2={0} stroke={color} strokeWidth={strokeW} />
        {renderLabels(el.control === 'manual' ? '(点击)' : `定时`)}
      </g>
     );
  }
  if (['voltage', 'current'].includes(el.type)) {
    let waveSymbol = null;
    if (el.waveType === 'AC') waveSymbol = <path d={`M ${mid-7} 0 Q ${mid-3.5} -6 ${mid} 0 T ${mid+7} 0`} fill="none" stroke={color} strokeWidth={1.5} />;
    else if (el.waveType === 'STEP') waveSymbol = <path d={`M ${mid-6} 4 L ${mid-2} 4 L ${mid-2} -4 L ${mid+6} -4`} fill="none" stroke={color} strokeWidth={1.5} />;
    else if (['SQUARE', 'PULSE'].includes(el.waveType)) waveSymbol = <path d={`M ${mid-6} 4 L ${mid-6} -4 L ${mid} -4 L ${mid} 4 L ${mid+6} 4`} fill="none" stroke={color} strokeWidth={1.5} />;
    else waveSymbol = <circle cx={mid} cy={0} r="12" fill="white" stroke={color} strokeWidth={strokeW} />;
    
    return (
      <g transform={`translate(${el.p1.x}, ${el.p1.y}) rotate(${angle})`}>
        <circle cx={mid} cy={0} r="12" fill="white" stroke={color} strokeWidth={strokeW} />
        {waveSymbol}
        {el.type === 'voltage' && <text x={mid-16} y={-14} fill={color} fontSize="14" fontWeight="bold">+</text>}
        {el.type === 'current' && <polygon points={`${mid+18},0 ${mid+12},-4 ${mid+12},4`} fill={color} />}
        <line x1={0} y1={0} x2={mid-12} y2={0} stroke={color} strokeWidth={strokeW} />
        <line x1={mid+12} y1={0} x2={len} y2={0} stroke={color} strokeWidth={strokeW} />
        {renderLabels(`${el.waveType === 'DC' ? '' : el.waveType} ${el.value}${el.type === 'voltage' ? 'V' : 'A'}`)}
      </g>
    );
  }
  return null;
});

// ==========================================
// 3. 主程序
// ==========================================
export default function CircuitSimulator() {
  const [elements, setElements] = useState(PREDEFINED_CIRCUITS.rectifier.elements);
  
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
  
  const [isSimulating, setIsSimulating] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);
  useEffect(() => { isPausedRef.current = isPaused; }, [isPaused]);

  const [errorMsg, setErrorMsg] = useState('');
  const [simSpeed, setSimSpeed] = useState(1);
  const [ioModal, setIoModal] = useState(false);
  const [ioData, setIoData] = useState('');
  const [modalConfig, setModalConfig] = useState(null);
  const promptInputRef = useRef('');
  
  const [scopeConfig, setScopeConfig] = useState({ timebase: 500, yZoom: 1 });
  const scopeConfigRef = useRef(scopeConfig);
  const updateScope = (updates) => {
    const newConf = { ...scopeConfig, ...updates };
    setScopeConfig(newConf);
    scopeConfigRef.current = newConf;
  };

  const svgRef = useRef(null);
  const scopeCanvasRef = useRef(null);
  const engineRef = useRef(null);
  const reqAnimRef = useRef(null);
  const simSpeedRef = useRef(1);
  const voltageLabelRefs = useRef({}); 

  useEffect(() => { simSpeedRef.current = simSpeed; }, [simSpeed]);
  const [uiSimData, setUiSimData] = useState({ time: 0, nodes: {}, switches: {} });
  const GRID_SIZE = 20;

  const tools = [
    { id: 'select', name: '选择/探头', icon: <MousePointer2 size={16} /> },
    { id: 'wire', name: '导线', icon: <Minus size={16} /> },
    { id: 'resistor', name: '电阻 (R)', icon: <Activity size={16} /> },
    { id: 'capacitor', name: '电容 (C)', icon: <Minus size={16} strokeDasharray="2 4" /> },
    { id: 'inductor', name: '电感 (L)', icon: <GitCommit size={16} /> },
    { id: 'diode', name: '二极管 (D)', icon: <TriangleRight size={16} /> },
    { id: 'switch', name: '开关 (SW)', icon: <ToggleLeft size={16} /> },
    { id: 'voltage', name: '电压源 (V)', icon: <Zap size={16} /> },
    { id: 'current', name: '电流源 (I)', icon: <ArrowRight size={16} /> },
    { id: 'terminal', name: '接线端子', icon: <CircleDot size={16} /> },
    { id: 'ground', name: '接地 (GND)', icon: <Minus size={16} style={{transform: 'rotate(90deg)'}} /> },
    { id: 'label', name: '网络标签', icon: <Tag size={16} /> },
    { id: 'delete', name: '删除', icon: <Trash2 size={16} /> },
  ];

  // 核心：强制且干净的引擎销毁
  const destroyEngine = () => {
    setIsSimulating(false);
    setIsPaused(false);
    if (reqAnimRef.current) {
      cancelAnimationFrame(reqAnimRef.current);
      reqAnimRef.current = null;
    }
    engineRef.current = null; 
    setUiSimData({ time: 0, nodes: {}, switches: {} });
    const canvas = scopeCanvasRef.current;
    if(canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    Object.values(voltageLabelRefs.current).forEach(ref => {
      if(ref && ref.parentNode) ref.parentNode.removeChild(ref);
    });
    voltageLabelRefs.current = {};
    setErrorMsg('');
  };

  const handleClearCanvas = () => {
    setModalConfig({
      type: 'confirm', title: '清空画布', message: '⚠️ 确定要清空画板上的所有元件吗？此操作不可撤销。',
      onConfirm: () => { destroyEngine(); setElements([]); setSelectedElementId(null); setModalConfig(null); }
    });
  };

  const handleLoadPredefined = (e) => {
    const key = e.target.value;
    if (!key) return;
    setModalConfig({
      type: 'confirm', title: '加载经典电路', message: `即将加载经典电路【${PREDEFINED_CIRCUITS[key].name}】。\n当前画布将被覆盖，是否继续？`,
      onConfirm: () => {
        destroyEngine();
        setElements(JSON.parse(JSON.stringify(PREDEFINED_CIRCUITS[key].elements)));
        setSelectedElementId(null);
        setModalConfig(null);
      },
      onCancel: () => setModalConfig(null)
    });
    e.target.value = ""; 
  };

  const handleLoadWorkspace = (e) => {
    const id = e.target.value;
    if (!id) return;
    setModalConfig({
      type: 'confirm', title: '加载本地工程', message: `即将加载您的工程【${workspace[id].name}】。\n当前画布将被覆盖，是否继续？`,
      onConfirm: () => {
        destroyEngine();
        setElements(JSON.parse(JSON.stringify(workspace[id].elements)));
        setSelectedElementId(null);
        setModalConfig(null);
      },
      onCancel: () => setModalConfig(null)
    });
    e.target.value = ""; 
  };

  const handleSaveToWorkspace = () => {
    promptInputRef.current = '未命名电路';
    setModalConfig({
      type: 'prompt', title: '保存工程', message: '请输入要保存的工程名称：',
      onConfirm: () => {
        const name = promptInputRef.current;
        if (name && name.trim()) {
           const newWs = { ...workspace, [Date.now()]: { name: name.trim(), elements: JSON.parse(JSON.stringify(elements)) } };
           setWorkspace(newWs);
           localStorage.setItem('circuits_workspace', JSON.stringify(newWs));
           setModalConfig({ type: 'alert', title: '成功', message: '🎉 工程保存成功！', onConfirm: () => setModalConfig(null) });
        } else {
           setModalConfig(null);
        }
      }
    });
  };

  const handleDeleteWorkspace = (id, name) => {
    setModalConfig({
      type: 'confirm', title: '删除工程', message: `确定要永久删除工程【${name}】吗？`,
      onConfirm: () => {
         const newWs = { ...workspace };
         delete newWs[id];
         setWorkspace(newWs);
         localStorage.setItem('circuits_workspace', JSON.stringify(newWs));
         setModalConfig(null);
      }
    });
  };

  const getMouseCoords = (e) => {
    const rect = svgRef.current.getBoundingClientRect();
    const rawX = (e.clientX - rect.left - transform.x) / transform.scale;
    const rawY = (e.clientY - rect.top - transform.y) / transform.scale;
    return { x: Math.round(rawX / GRID_SIZE) * GRID_SIZE, y: Math.round(rawY / GRID_SIZE) * GRID_SIZE };
  };

  const handlePointerDown = (e) => {
    if (e.button === 2) { setIsPanning(true); return; } 
    if (isSimulating && selectedTool !== 'select') return; 
    
    const pt = getMouseCoords(e);
    if (['ground', 'label', 'terminal'].includes(selectedTool)) {
      const typeStr = selectedTool.substring(0, 3).toUpperCase();
      const newEl = { 
        id: Date.now().toString(), type: selectedTool, 
        name: selectedTool === 'ground' ? '' : `${typeStr}_${Math.floor(Math.random()*100)}`,
        p1: pt, p2: pt, value: selectedTool==='label'?'NET':null 
      };
      setElements([...elements, newEl]);
    } else if (['wire', 'resistor', 'voltage', 'current', 'capacitor', 'inductor', 'diode', 'switch'].includes(selectedTool)) {
      setDrawingState({ startPt: pt, currentPt: pt });
    }
  };

  const handlePointerMove = (e) => {
    if (isPanning) { setTransform(t => ({ ...t, x: t.x + e.movementX, y: t.y + e.movementY })); return; }
    if (drawingState) {
      let currentPt = getMouseCoords(e);
      if (isOrthogonal && drawingState.startPt) {
        const dx = currentPt.x - drawingState.startPt.x; const dy = currentPt.y - drawingState.startPt.y;
        if (Math.abs(dx) > Math.abs(dy)) currentPt.y = drawingState.startPt.y; else currentPt.x = drawingState.startPt.x;
      }
      setDrawingState({ ...drawingState, currentPt });
    }
  };

  const handlePointerUp = (e) => {
    if (e.button === 2) { setIsPanning(false); return; }
    if (drawingState) {
      const { startPt, currentPt } = drawingState;
      if (startPt.x !== currentPt.x || startPt.y !== currentPt.y) {
        const typeStr = selectedTool.substring(0, 1).toUpperCase();
        let newEl = { 
          id: Date.now().toString(), type: selectedTool, 
          name: selectedTool === 'wire' ? '' : `${typeStr}${Math.floor(Math.random()*100)}`,
          p1: startPt, p2: currentPt, value: 0 
        };
        
        if (selectedTool === 'resistor') newEl.value = 1000;
        if (selectedTool === 'capacitor') newEl.value = 1e-6;
        if (selectedTool === 'inductor') newEl.value = 1e-3;
        if (selectedTool === 'switch') { newEl.control = 'manual'; newEl.state = true; newEl.timeOn = 0.01; newEl.timeOff = 0.02; }
        if (selectedTool === 'voltage' || selectedTool === 'current') {
           newEl.value = selectedTool === 'voltage' ? 5 : 0.1; newEl.offset = 0; newEl.waveType = 'DC'; newEl.freq = 50; newEl.duty = 50;
           newEl.v1 = 0; newEl.v2 = 5; newEl.td = 0; newEl.tr = 1e-6; newEl.tf = 1e-6; newEl.pw = 0.001; newEl.per = 0.002;
           newEl.tau1 = 1e-3; newEl.tau2 = 1e-3; newEl.td1 = 0; newEl.td2 = 1e-3;
        }
        setElements([...elements, newEl]);
      }
      setDrawingState(null);
    }
  };

  const handleWheel = (e) => {
    e.preventDefault();
    const scaleAdjust = e.deltaY > 0 ? 0.9 : 1.1;
    setTransform(t => ({ ...t, scale: Math.max(0.2, Math.min(3, t.scale * scaleAdjust)) }));
  };

  const handleElementClick = (e, id) => {
    e.stopPropagation();
    if (selectedTool === 'delete') {
      if (isSimulating) destroyEngine();
      setElements(elements.filter(el => el.id !== id));
      setSelectedElementId(null);
    } else if (selectedTool === 'select') {
      setSelectedElementId(id);
      if (isSimulating && engineRef.current) {
         const el = engineRef.current.allEls.find(e => e.id === id);
         if (el && el.type === 'switch' && el.control === 'manual') {
            const newState = !engineRef.current.switchStates[id];
            engineRef.current.switchStates[id] = newState;
            engineRef.current.needsMatrixRebuild = true;
            setElements(prev => prev.map(e => e.id === id ? { ...e, state: newState } : e));
         }
      }
    }
  };

  const updateSelectedProps = (updates) => {
    const requiresRestart = updates.type || updates.control !== undefined; 
    if (isSimulating && engineRef.current) {
       if (requiresRestart) destroyEngine();
       else {
          engineRef.current.allEls.forEach(e => { if(e.id === selectedElementId) Object.assign(e, updates); });
          engineRef.current.validEls.forEach(e => { if(e.id === selectedElementId) Object.assign(e, updates); });
          engineRef.current.needsMatrixRebuild = true;
       }
    }
    setElements(elements.map(el => el.id === selectedElementId ? { ...el, ...updates } : el));
  };

  const compileCircuit = (els) => {
    const dt = 1e-5; 
    const dsu = new DSU();
    let hasGround = false;
    const labelsByText = {};
    const allPts = [];
    els.forEach(el => { if (el.p1) allPts.push(el.p1); if (el.p2) allPts.push(el.p2); });

    els.forEach(el => {
      if (el.type === 'wire') {
        dsu.union(ptToStr(el.p1), ptToStr(el.p2));
        allPts.forEach(pt => {
           if (isPointOnSegment(pt, el.p1, el.p2)) dsu.union(ptToStr(pt), ptToStr(el.p1));
        });
      }
      if (el.type === 'ground') { hasGround = true; dsu.union(ptToStr(el.p1), 'GND_SUPER'); }
      if (el.type === 'label' || el.type === 'terminal') {
        const val = String(el.type === 'terminal' ? el.name : el.value).trim().toUpperCase();
        if (val === 'GND' || val === '0V') { hasGround = true; dsu.union(ptToStr(el.p1), 'GND_SUPER'); }
        else if (val) {
          if (!labelsByText[val]) labelsByText[val] = [];
          labelsByText[val].push(ptToStr(el.p1));
        }
      }
    });

    Object.values(labelsByText).forEach(pts => { for (let i = 1; i < pts.length; i++) dsu.union(pts[0], pts[i]); });
    if (!hasGround) throw new Error('电路中缺少接地端 (GND)！');

    const finalGroundRoot = dsu.find('GND_SUPER');
    const nodeMap = {}; let nodeCount = 0;
    const getIdx = (p) => {
      const root = dsu.find(ptToStr(p));
      if (root === finalGroundRoot) return -1;
      if (nodeMap[root] === undefined) nodeMap[root] = nodeCount++;
      return nodeMap[root];
    };

    const validEls = [];
    els.forEach(el => {
      if (['wire', 'ground', 'label', 'terminal'].includes(el.type)) return;
      const n1 = getIdx(el.p1), n2 = getIdx(el.p2);
      if (n1 !== n2) validEls.push({ ...el, n1, n2 });
    });

    const N = nodeCount;
    const branchEls = validEls.filter(e => e.type === 'voltage' || e.type === 'inductor');
    const M = branchEls.length;
    const size = N + M;
    if (size === 0) throw new Error('没有发现有效的电路回路。');

    const switchStates = {};
    validEls.forEach(el => {
      if (el.type === 'diode') switchStates[el.id] = false; 
      if (el.type === 'switch') switchStates[el.id] = el.state !== false; 
    });

    const A = buildMNA(N, M, dt, validEls, branchEls, switchStates);
    const A_inv = invertMatrix(A);
    if (!A_inv) throw new Error('电路拓扑存在短路环路或非法连接。');

    const branchMap = {};
    branchEls.forEach((el, idx) => branchMap[el.id] = N + idx);
    const engineEls = els.map(e => ({...e}));

    return {
      dt, t: 0, size, N, M, A_inv, validEls, branchEls, branchMap, dsu, nodeMap, finalGroundRoot,
      state: {}, history: [], currentNodes: {}, allEls: engineEls, switchStates, needsMatrixRebuild: false
    };
  };

  const stepEngine = (eng) => {
    const { dt, size, validEls, branchMap, state, switchStates } = eng;
    
    validEls.forEach(el => {
      if (el.type === 'diode') {
        const v1 = el.n1 >= 0 ? (eng.currentNodes[ptToStr(el.p1)] || 0) : 0;
        const v2 = el.n2 >= 0 ? (eng.currentNodes[ptToStr(el.p2)] || 0) : 0;
        const vD = v1 - v2;
        const wasON = switchStates[el.id];
        if (!wasON && vD > 0.7) { switchStates[el.id] = true; eng.needsMatrixRebuild = true; }
        else if (wasON && vD < 0.65) { switchStates[el.id] = false; eng.needsMatrixRebuild = true; }
      }
      else if (el.type === 'switch' && el.control === 'time') {
        const shouldBeON = (eng.t >= (el.timeOn||0) && eng.t <= (el.timeOff||0));
        if (switchStates[el.id] !== shouldBeON) { switchStates[el.id] = shouldBeON; eng.needsMatrixRebuild = true; }
      }
    });

    if (eng.needsMatrixRebuild) {
       const A_new = buildMNA(eng.N, eng.M, dt, validEls, eng.branchEls, switchStates);
       const inv = invertMatrix(A_new);
       if(inv) eng.A_inv = inv; 
       eng.needsMatrixRebuild = false;
    }

    const b = Array(size).fill(0);
    validEls.forEach(el => {
      const { id, n1, n2, type, value } = el;
      if (type === 'capacitor') {
        const Ieq = ((Number(value) || 1e-6) / dt) * (state[id] || 0);
        if (n1 >= 0) b[n1] += Ieq; if (n2 >= 0) b[n2] -= Ieq;
      }
      else if (type === 'inductor') b[branchMap[id]] = -((Number(value) || 1e-3) / dt) * (state[id] || 0);
      else if (type === 'voltage') b[branchMap[id]] = getSourceValue(el, eng.t);
      else if (type === 'current') {
        const isrc = getSourceValue(el, eng.t);
        if (n1 >= 0) b[n1] -= isrc; if (n2 >= 0) b[n2] += isrc;
      }
      else if (type === 'diode' && switchStates[id]) {
        const ieq = 0.7 * (1.0 / 0.05);
        if (n1 >= 0) b[n1] += ieq; if (n2 >= 0) b[n2] -= ieq;
      }
    });

    const x = Array(size).fill(0);
    for(let i=0; i<size; i++) {
      let sum = 0;
      for(let j=0; j<size; j++) sum += eng.A_inv[i][j] * b[j];
      x[i] = sum;
    }

    let measuredV = 0, measuredI = 0;
    validEls.forEach(el => {
      const { id, n1, n2, type, value } = el;
      const v_elem = (n1 >= 0 ? x[n1] : 0) - (n2 >= 0 ? x[n2] : 0);
      let i_elem = 0;

      if (type === 'capacitor') { i_elem = (v_elem - (state[id] || 0)) * (Number(value) || 1e-6) / dt; state[id] = v_elem; }
      else if (type === 'inductor') { i_elem = x[branchMap[id]]; state[id] = i_elem; }
      else if (type === 'voltage') i_elem = x[branchMap[id]]; 
      else if (type === 'resistor') i_elem = v_elem / (Number(value) || 1e-3);
      else if (type === 'current') i_elem = getSourceValue(el, eng.t);
      else if (type === 'diode' || type === 'switch') {
        const g = switchStates[id] ? 1.0/0.05 : 1e-8;
        i_elem = v_elem * g;
        if (type === 'diode' && switchStates[id]) i_elem -= 0.7 * g; 
      }

      if (id === selectedElementId) { measuredV = v_elem; measuredI = type === 'voltage' ? -i_elem : i_elem; }
    });

    if (selectedElementId) {
       const selNode = eng.allEls.find(e => e.id === selectedElementId);
       if (selNode && ['terminal', 'label'].includes(selNode.type)) {
          const pt = ptToStr(selNode.p1); const root = eng.dsu.find(pt);
          if (root === eng.finalGroundRoot) measuredV = 0; else if (eng.nodeMap[root] !== undefined) measuredV = x[eng.nodeMap[root]];
          measuredI = 0; 
       }
    }

    eng.allEls.forEach(el => {
      [el.p1, el.p2].forEach(p => {
        if(!p) return;
        const key = ptToStr(p); const root = eng.dsu.find(key);
        if (root === eng.finalGroundRoot) eng.currentNodes[key] = 0;
        else if (eng.nodeMap[root] !== undefined) eng.currentNodes[key] = x[eng.nodeMap[root]];
      });
    });

    if (selectedElementId) {
      eng.history.push({ t: eng.t, v: measuredV, i: measuredI });
      if (eng.history.length > 2500) eng.history.shift(); 
    } else eng.history = []; 
    eng.t += dt;
  };

  const startSimulation = () => {
    destroyEngine(); // 确保安全启动
    try {
      engineRef.current = compileCircuit(elements);
      setIsSimulating(true); setIsPaused(false);
      engineRef.current.history = []; engineRef.current.lastUiTime = performance.now();
      loop();
    } catch (err) { setErrorMsg(err.message); setIsSimulating(false); }
  };

  const loop = useCallback(() => {
    if (!engineRef.current) return;
    const stepsPerFrame = Math.max(1, Math.round(50 * simSpeedRef.current)); 
    if (!isPausedRef.current) { for(let i=0; i<stepsPerFrame; i++) stepEngine(engineRef.current); }

    const now = performance.now();
    if (now - engineRef.current.lastUiTime > 30) {
       setUiSimData({ time: engineRef.current.t, nodes: { ...engineRef.current.currentNodes }, switches: { ...engineRef.current.switchStates } });
       engineRef.current.lastUiTime = now;
       drawOscilloscope();
       updateVoltageLabels();
    }
    reqAnimRef.current = requestAnimationFrame(loop);
  }, [selectedElementId]);

  useEffect(() => { if (isSimulating) reqAnimRef.current = requestAnimationFrame(loop); return () => { if(reqAnimRef.current) cancelAnimationFrame(reqAnimRef.current); } }, [isSimulating, loop]);

  const updateVoltageLabels = () => {
    if (!engineRef.current) return;
    const nodes = engineRef.current.currentNodes;
    for (const [ptStr, v] of Object.entries(nodes)) {
      let div = voltageLabelRefs.current[ptStr];
      if (!div) {
        div = document.createElement('div');
        div.className = 'absolute text-[10px] font-mono bg-emerald-600 text-white px-1 rounded shadow pointer-events-none z-10';
        div.style.transform = 'translate(-50%, -100%)';
        document.querySelector('.circuit-canvas-layer')?.appendChild(div);
        voltageLabelRefs.current[ptStr] = div;
      }
      const [x, y] = ptStr.split(',').map(Number);
      const scaledX = x * transform.scale + transform.x; const scaledY = y * transform.scale + transform.y;
      div.style.left = `${scaledX}px`; div.style.top = `${scaledY}px`;
      div.textContent = `${Math.abs(v) < 1e-4 ? '0' : v.toFixed(2)}V`;
    }
  };

  const drawOscilloscope = () => {
    const canvas = scopeCanvasRef.current;
    if (!canvas || !engineRef.current) return;
    const ctx = canvas.getContext('2d'); const { width, height } = canvas; const config = scopeConfigRef.current;
    ctx.clearRect(0, 0, width, height);

    ctx.strokeStyle = '#374151'; ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
    for (let i = 1; i < 10; i++) {
       const y = (height / 10) * i; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
       const x = (width / 10) * i; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
    }
    ctx.setLineDash([]);

    const fullHistory = engineRef.current.history;
    if (fullHistory.length < 2) {
      ctx.fillStyle = '#9ca3af'; ctx.font = '14px sans-serif';
      ctx.fillText(selectedElementId ? '数据收集中...' : '选择任意元件或端子以查看波形', width/2 - 120, height/2);
      return;
    }

    const history = fullHistory.slice(-config.timebase);
    let minV = history[0].v, maxV = minV, minI = history[0].i, maxI = minI;
    for(let h of history) {
      if(h.v < minV) minV = h.v; if(h.v > maxV) maxV = h.v;
      if(h.i < minI) minI = h.i; if(h.i > maxI) maxI = h.i;
    }
    
    let vCenter = (maxV + minV) / 2, vRange = (maxV - minV) || 1; vRange = vRange / config.yZoom;   
    minV = vCenter - vRange / 2; maxV = vCenter + vRange / 2;
    let iCenter = (maxI + minI) / 2, iRange = (maxI - minI) || 0.001; iRange = iRange / config.yZoom;
    minI = iCenter - iRange / 2; maxI = iCenter + iRange / 2;

    const mapX = (idx) => width - ((history.length - 1 - idx) / Math.max(1, config.timebase - 1)) * width;
    const mapYV = (v) => height - ((v - minV) / (maxV - minV)) * height;
    const mapYI = (iVal) => height - ((iVal - minI) / (maxI - minI)) * height;

    if (0 >= minV && 0 <= maxV) { ctx.strokeStyle = '#4b5563'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, mapYV(0)); ctx.lineTo(width, mapYV(0)); ctx.stroke(); }
    ctx.beginPath(); ctx.strokeStyle = '#60a5fa'; ctx.lineWidth = 2; ctx.moveTo(mapX(0), mapYV(history[0].v));
    for(let k=1; k<history.length; k++) ctx.lineTo(mapX(k), mapYV(history[k].v)); ctx.stroke();
    ctx.beginPath(); ctx.strokeStyle = '#f87171'; ctx.lineWidth = 2; ctx.moveTo(mapX(0), mapYI(history[0].i));
    for(let k=1; k<history.length; k++) ctx.lineTo(mapX(k), mapYI(history[k].i)); ctx.stroke();

    const currentH = history[history.length - 1];
    ctx.fillStyle = '#60a5fa'; ctx.fillText(`V: ${currentH.v.toFixed(3)} V`, 10, 20);
    ctx.fillStyle = '#f87171'; ctx.fillText(`I: ${(currentH.i*1000).toFixed(3)} mA`, 10, 40);
    ctx.fillStyle = '#9ca3af'; ctx.fillText(`t: ${(currentH.t*1000).toFixed(1)} ms`, width - 80, 20);
  };

  const handleExport = () => { setIoData(JSON.stringify(elements, null, 2)); setIoModal('export'); };
  const handleImport = () => {
    try {
      const parsed = JSON.parse(ioData);
      if(Array.isArray(parsed)) { destroyEngine(); setElements(parsed); setIoModal(false); }
      else throw new Error('Invalid format');
    } catch(e) { 
      setModalConfig({ type: 'alert', title: '导入失败', message: 'JSON 格式错误！', onConfirm: () => setModalConfig(null) });
    }
  };

  const WaveformParams = ({ el, updateProps }) => {
    const waveType = el.waveType || 'DC';
    return (
      <div className="space-y-2">
        <select value={waveType} onChange={e => updateProps({ waveType: e.target.value })} className="w-full px-2 py-1 border rounded text-sm">
          <option value="DC">直流 (DC)</option><option value="AC">正弦 (AC)</option>
          <option value="SQUARE">方波 (SQUARE)</option><option value="TRIANGLE">三角波 (TRIANGLE)</option>
          <option value="PULSE">脉冲 (PULSE)</option><option value="EXP">指数 (EXP)</option>
        </select>
        {waveType !== 'DC' && waveType !== 'STEP' && (
          <div className="flex gap-2">
            <div className="flex-1"><label className="block text-xs text-gray-500">幅值</label><input type="number" value={el.value} onChange={e => updateProps({ value: parseFloat(e.target.value) })} className="w-full px-2 py-1 border rounded text-sm" /></div>
            <div className="flex-1"><label className="block text-xs text-gray-500">频率(Hz)</label><input type="number" value={el.freq || 50} onChange={e => updateProps({ freq: parseFloat(e.target.value) })} className="w-full px-2 py-1 border rounded text-sm" /></div>
          </div>
        )}
        {waveType === 'PULSE' && (
          <div className="grid grid-cols-2 gap-1 text-xs mt-2 text-gray-600">
            <label className="flex items-center justify-between">V1: <input type="number" value={el.v1 || 0} onChange={e=>updateProps({v1: parseFloat(e.target.value)})} className="w-16 border rounded px-1"/></label>
            <label className="flex items-center justify-between">V2: <input type="number" value={el.v2 || 5} onChange={e=>updateProps({v2: parseFloat(e.target.value)})} className="w-16 border rounded px-1"/></label>
            <label className="flex items-center justify-between">Td(s): <input type="number" step="1e-6" value={el.td || 0} onChange={e=>updateProps({td: parseFloat(e.target.value)})} className="w-16 border rounded px-1"/></label>
            <label className="flex items-center justify-between">Tr(s): <input type="number" step="1e-6" value={el.tr || 1e-6} onChange={e=>updateProps({tr: parseFloat(e.target.value)})} className="w-16 border rounded px-1"/></label>
            <label className="flex items-center justify-between">Tf(s): <input type="number" step="1e-6" value={el.tf || 1e-6} onChange={e=>updateProps({tf: parseFloat(e.target.value)})} className="w-16 border rounded px-1"/></label>
            <label className="flex items-center justify-between">Pw(s): <input type="number" step="1e-6" value={el.pw || 0.001} onChange={e=>updateProps({pw: parseFloat(e.target.value)})} className="w-16 border rounded px-1"/></label>
            <label className="col-span-2 flex items-center justify-between">周期(s): <input type="number" step="1e-6" value={el.per || 0.002} onChange={e=>updateProps({per: parseFloat(e.target.value)})} className="w-24 border rounded px-1"/></label>
          </div>
        )}
        {waveType === 'EXP' && (
          <div className="grid grid-cols-2 gap-1 text-xs mt-2 text-gray-600">
            <label className="flex items-center justify-between">V1: <input type="number" value={el.v1 || 0} onChange={e=>updateProps({v1: parseFloat(e.target.value)})} className="w-16 border rounded px-1"/></label>
            <label className="flex items-center justify-between">V2: <input type="number" value={el.v2 || 5} onChange={e=>updateProps({v2: parseFloat(e.target.value)})} className="w-16 border rounded px-1"/></label>
            <label className="flex items-center justify-between">Td1(s): <input type="number" step="1e-6" value={el.td1 || 0} onChange={e=>updateProps({td1: parseFloat(e.target.value)})} className="w-16 border rounded px-1"/></label>
            <label className="flex items-center justify-between">Tau1(s): <input type="number" step="1e-6" value={el.tau1 || 1e-3} onChange={e=>updateProps({tau1: parseFloat(e.target.value)})} className="w-16 border rounded px-1"/></label>
            <label className="flex items-center justify-between">Td2(s): <input type="number" step="1e-6" value={el.td2 || 1e-3} onChange={e=>updateProps({td2: parseFloat(e.target.value)})} className="w-16 border rounded px-1"/></label>
            <label className="flex items-center justify-between">Tau2(s): <input type="number" step="1e-6" value={el.tau2 || 1e-3} onChange={e=>updateProps({tau2: parseFloat(e.target.value)})} className="w-16 border rounded px-1"/></label>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-screen w-full bg-gray-100 text-gray-800 font-sans overflow-hidden">
      {/* 侧边栏 */}
      <div className="w-72 bg-white border-r border-gray-200 flex flex-col shadow-sm z-20 shrink-0">
        <div className="p-4 border-b border-gray-100 bg-indigo-600 text-white flex justify-between items-center">
          <div><h1 className="text-lg font-bold flex items-center gap-2"><Activity size={20} /> 专业 EDA 平台</h1><p className="text-xs text-indigo-200 mt-0.5">Workspace & DSO Scope</p></div>
        </div>
        
        {/* -- 本地项目管理器 -- */}
        <div className="p-3 border-b border-indigo-100 bg-indigo-50/50 flex flex-col gap-2">
           <div className="flex items-center justify-between text-indigo-800 font-bold text-xs mb-1">
              <span className="flex items-center gap-1"><FolderOpen size={14}/> 💾 我的工程管理器</span>
              <button onClick={handleSaveToWorkspace} className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-700 text-white px-2 py-1 rounded shadow-sm"><Save size={12}/> 保存当前</button>
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
             <button onClick={handleClearCanvas} className="flex-1 flex justify-center items-center gap-1 text-xs py-1 bg-red-50 text-red-600 border border-red-200 rounded hover:bg-red-100 font-medium"><Trash size={12}/> 清空</button>
             <button onClick={handleExport} className="flex-1 flex justify-center items-center gap-1 text-xs py-1 bg-white border border-gray-300 rounded hover:bg-gray-100"><Download size={12}/> 导出</button>
             <button onClick={() => {setIoModal('import'); setIoData('');}} className="flex-1 flex justify-center items-center gap-1 text-xs py-1 bg-white border border-gray-300 rounded hover:bg-gray-100"><Upload size={12}/> 导入</button>
           </div>
        </div>

        <div className="p-3 flex-1 overflow-y-auto">
          <div className={`space-y-1 mb-6 ${isSimulating ? 'opacity-50 pointer-events-none' : ''}`}>
            {tools.map(tool => (
              <button key={tool.id} onClick={() => { setSelectedTool(tool.id); setSelectedElementId(null); }}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${selectedTool === tool.id ? 'bg-indigo-100 text-indigo-800 font-medium' : 'hover:bg-gray-100 text-gray-600'}`}>
                {tool.icon} {tool.name}
              </button>
            ))}
          </div>

          {selectedElementId && (() => {
            const el = elements.find(e => e.id === selectedElementId);
            if (!el) return null;
            return (
              <div className={`bg-blue-50 p-4 rounded-lg border ${isSimulating ? 'border-amber-400 bg-amber-50 shadow-inner' : 'border-blue-100'}`}>
                <h2 className={`text-sm font-semibold mb-3 flex justify-between items-center ${isSimulating ? 'text-amber-800' : 'text-blue-800'}`}>
                  元件属性
                  {!isSimulating && ['resistor', 'capacitor', 'inductor', 'voltage', 'current', 'diode', 'switch'].includes(el.type) && (
                    <button onClick={() => {
                        setElements(elements.map(e => {
                          if (e.id === selectedElementId && e.p2) {
                            const cx = (e.p1.x + e.p2.x) / 2; const cy = (e.p1.y + e.p2.y) / 2;
                            const dx = e.p1.x - cx; const dy = e.p1.y - cy;
                            return { ...e, p1: { x: cx - dy, y: cy + dx }, p2: { x: cx + dy, y: cy - dx } };
                          }
                          return e;
                        }));
                      }} className="flex gap-1 text-xs bg-white border border-blue-200 px-2 py-1 rounded hover:bg-blue-100 text-blue-700">
                      <RotateCw size={12} /> 旋转
                    </button>
                  )}
                </h2>
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <div className="flex-1"><label className="block text-xs mb-1 text-gray-500">类型</label><div className="text-sm font-medium uppercase text-gray-700">{el.type}</div></div>
                    <div className="flex-1"><label className="block text-xs mb-1 text-gray-500">标识名称</label><input type="text" value={el.name || ''} onChange={(e) => updateSelectedProps({ name: e.target.value })} className="w-full px-2 py-1 border rounded text-sm focus:ring-1 focus:ring-indigo-400 outline-none" /></div>
                  </div>
                  {['resistor', 'capacitor', 'inductor'].includes(el.type) && (
                    <div><label className="block text-xs mb-1 text-gray-500">参数值 ({el.type==='resistor'?'Ω':el.type==='capacitor'?'F':'H'})</label><input type="number" value={el.value} onChange={(e) => updateSelectedProps({ value: parseFloat(e.target.value) || 0 })} className="w-full px-2 py-1.5 border rounded text-sm" /></div>
                  )}
                  {el.type === 'switch' && (
                    <>
                      <select value={el.control} onChange={(e) => updateSelectedProps({ control: e.target.value })} className="w-full px-2 py-1 border rounded text-sm"><option value="manual">手动 (点击切换)</option><option value="time">定时自动</option></select>
                      {el.control === 'manual' && <select value={el.state ? "on" : "off"} onChange={(e) => updateSelectedProps({ state: e.target.value === "on" })} className="w-full px-2 py-1 border rounded text-sm mt-2"><option value="on">初始闭合</option><option value="off">初始断开</option></select>}
                      {el.control === 'time' && <div className="flex gap-2 mt-2"><div className="flex-1"><label className="block text-xs text-gray-500">闭合时刻(s)</label><input type="number" value={el.timeOn} onChange={e=>updateSelectedProps({timeOn: parseFloat(e.target.value)})} className="w-full px-2 py-1 border rounded text-sm" /></div><div className="flex-1"><label className="block text-xs text-gray-500">断开时刻(s)</label><input type="number" value={el.timeOff} onChange={e=>updateSelectedProps({timeOff: parseFloat(e.target.value)})} className="w-full px-2 py-1 border rounded text-sm" /></div></div>}
                    </>
                  )}
                  {['voltage', 'current'].includes(el.type) && <WaveformParams el={el} updateProps={updateSelectedProps} />}
                </div>
              </div>
            );
          })()}
        </div>

        <div className="p-4 border-t border-gray-200 bg-gray-50 flex flex-col gap-3">
          <div className="flex flex-col gap-1 mt-1 mb-2">
            <div className="flex justify-between text-xs text-gray-600"><span>仿真速度</span><span className="font-mono">{simSpeed.toFixed(1)}x</span></div>
            <input type="range" min="0.1" max="3" step="0.1" value={simSpeed} onChange={(e) => setSimSpeed(parseFloat(e.target.value))} className="w-full h-1.5 bg-gray-300 rounded-lg appearance-none cursor-pointer accent-indigo-600" />
          </div>
          {isSimulating ? (
            <div className="flex gap-2">
              <button onClick={() => setIsPaused(!isPaused)} className={`flex-1 flex items-center justify-center gap-1 ${isPaused ? 'bg-amber-500 hover:bg-amber-600' : 'bg-blue-500 hover:bg-blue-600'} text-white py-2 rounded-lg shadow text-sm font-medium transition-colors`}>{isPaused ? <Play size={16} /> : <Pause size={16} />} {isPaused ? '继续' : '冻结'}</button>
              <button onClick={destroyEngine} className="flex-1 flex items-center justify-center gap-1 bg-red-500 hover:bg-red-600 text-white py-2 rounded-lg shadow text-sm font-medium transition-colors"><StopCircle size={16} /> 停止</button>
            </div>
          ) : (
            <button onClick={startSimulation} className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white py-2.5 rounded-lg shadow font-medium transition-colors"><Play size={18} /> 运行瞬态仿真</button>
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col relative overflow-hidden bg-[length:20px_20px]" style={{ backgroundImage: 'radial-gradient(#d1d5db 1px, transparent 1px)' }}>
        <div className="absolute top-4 left-4 z-20 flex gap-2 bg-white/90 p-1.5 rounded-lg shadow-sm border border-gray-200 backdrop-blur">
           <button onClick={()=>setTransform({x:0,y:0,scale:1})} title="复位视角" className="p-1.5 hover:bg-gray-100 rounded text-gray-600"><Move size={16}/></button>
           <button onClick={()=>setTransform(t=>({...t, scale: t.scale*1.2}))} title="放大" className="p-1.5 hover:bg-gray-100 rounded text-gray-600"><ZoomIn size={16}/></button>
           <button onClick={()=>setTransform(t=>({...t, scale: t.scale*0.8}))} title="缩小" className="p-1.5 hover:bg-gray-100 rounded text-gray-600"><ZoomOut size={16}/></button>
        </div>
        {errorMsg && <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 bg-red-100 text-red-700 px-4 py-2 rounded-md shadow border border-red-200 text-sm"><AlertCircle size={16} className="inline mr-1" /> {errorMsg}</div>}

        <div className="relative flex-1 circuit-canvas-layer">
          <svg ref={svgRef} className={`w-full h-full ${isPanning ? 'cursor-grabbing' : (isSimulating ? 'cursor-crosshair' : 'cursor-default')}`} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onWheel={handleWheel} onContextMenu={(e)=>e.preventDefault()}>
            <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.scale})`}>
              {elements.map(el => (
                <g key={el.id} className="cursor-pointer" onClick={(e) => handleElementClick(e, el.id)}>
                  {['wire', 'resistor', 'voltage', 'current', 'capacitor', 'inductor', 'diode', 'switch'].includes(el.type) && <line x1={el.p1.x} y1={el.p1.y} x2={el.p2.x} y2={el.p2.y} stroke="transparent" strokeWidth={15} />}
                  <StaticElement el={el} isSelected={el.id === selectedElementId} isSimulating={isSimulating} switchStates={uiSimData.switches} />
                </g>
              ))}
              {drawingState && <line x1={drawingState.startPt.x} y1={drawingState.startPt.y} x2={drawingState.currentPt.x} y2={drawingState.currentPt.y} stroke="#9ca3af" strokeWidth="2" strokeDasharray="4" />}
              {elements.map((el, i) => <React.Fragment key={`nodes-${i}`}><circle cx={el.p1.x} cy={el.p1.y} r={3} fill="#4b5563" />{el.p2 && <circle cx={el.p2.x} cy={el.p2.y} r={3} fill="#4b5563" />}</React.Fragment>)}
            </g>
          </svg>
        </div>

        <div className={`h-64 bg-gray-900 border-t-4 ${isSimulating ? (isPaused ? 'border-amber-500' : 'border-indigo-500') : 'border-gray-700'} flex flex-col shrink-0 transition-colors z-20`}>
           <div className="flex justify-between items-center px-4 py-2 bg-gray-800 text-gray-300 text-xs">
              <div className="flex items-center">
                 <span className="font-semibold uppercase flex items-center gap-2 text-white"><LineChart size={14}/> {selectedElementId ? `探测: [${elements.find(e=>e.id===selectedElementId)?.name || '未命名'}]` : '示波器'}</span>
                 {selectedElementId && (
                    <div className="flex gap-5 ml-4 border-l border-gray-600 pl-4">
                      <label className="flex items-center gap-2 cursor-pointer"><span className="text-[10px] text-gray-400">X轴(时间):</span><input type="range" min="50" max="2500" step="50" value={scopeConfig.timebase} onChange={e => updateScope({timebase: Number(e.target.value)})} className="w-24 h-1 bg-gray-600 rounded appearance-none cursor-pointer accent-indigo-400" /></label>
                      <label className="flex items-center gap-2 cursor-pointer"><span className="text-[10px] text-gray-400">Y轴(幅度):</span><input type="range" min="0.2" max="5" step="0.2" value={scopeConfig.yZoom} onChange={e => updateScope({yZoom: Number(e.target.value)})} className="w-24 h-1 bg-gray-600 rounded appearance-none cursor-pointer accent-indigo-400" /><span className="text-[9px] text-gray-500 w-4 text-right">{scopeConfig.yZoom.toFixed(1)}x</span></label>
                    </div>
                 )}
              </div>
              <div className="flex items-center gap-4">
                 {isPaused && <span className="bg-amber-500 text-white px-2 py-0.5 rounded text-[10px] font-bold tracking-wider animate-pulse">PAUSED</span>}
                 <span className="flex items-center gap-1 text-[10px]"><span className="w-2 h-2 rounded-full bg-blue-400 inline-block"></span> 电压 V</span>
                 <span className="flex items-center gap-1 text-[10px]"><span className="w-2 h-2 rounded-full bg-red-400 inline-block"></span> 电流 A</span>
                 <span className="text-gray-400 font-mono w-20 text-right text-[10px]">t: {(uiSimData.time * 1000).toFixed(1)}ms</span>
              </div>
           </div>
           <div className="flex-1 relative p-2 pt-0 pb-3">
              <canvas ref={scopeCanvasRef} width={1200} height={200} className="w-full h-full block bg-black rounded shadow-inner border border-gray-700" />
           </div>
        </div>

        {ioModal && (
          <div className="absolute inset-0 bg-black/50 z-50 flex items-center justify-center backdrop-blur-sm">
             <div className="bg-white p-5 rounded-xl shadow-2xl w-[500px] flex flex-col gap-3">
                <h3 className="font-bold text-lg">{ioModal === 'export' ? '导出电路 JSON' : '粘贴 JSON 代码导入'}</h3>
                <textarea className="w-full h-64 border rounded p-2 text-xs font-mono bg-gray-50 focus:ring-2 outline-none" value={ioData} onChange={e=>setIoData(e.target.value)} readOnly={ioModal==='export'} placeholder="[{ ... }]" />
                <div className="flex justify-end gap-2 mt-2">
                   <button onClick={()=>setIoModal(false)} className="px-4 py-2 text-sm bg-gray-200 rounded hover:bg-gray-300">关闭</button>
                   {ioModal === 'import' && <button onClick={handleImport} className="px-4 py-2 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700">确认导入</button>}
                </div>
             </div>
          </div>
        )}

        {/* Custom UI Modal */}
        {modalConfig && (
          <div className="absolute inset-0 bg-black/50 z-50 flex items-center justify-center backdrop-blur-sm">
            <div className="bg-white p-5 rounded-xl shadow-2xl w-[400px] flex flex-col gap-4">
              <h3 className="font-bold text-lg text-gray-800">{modalConfig.title}</h3>
              <p className="text-sm text-gray-600 whitespace-pre-line">{modalConfig.message}</p>
              
              {modalConfig.type === 'prompt' && (
                <input 
                  type="text" 
                  autoFocus
                  defaultValue={promptInputRef.current}
                  className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-indigo-400 outline-none text-sm"
                  onChange={(e) => promptInputRef.current = e.target.value}
                />
              )}

              <div className="flex justify-end gap-2 mt-2">
                {modalConfig.type !== 'alert' && (
                  <button 
                    onClick={() => { if(modalConfig.onCancel) modalConfig.onCancel(); setModalConfig(null); }} 
                    className="px-4 py-2 text-sm bg-gray-200 rounded hover:bg-gray-300"
                  >
                    取消
                  </button>
                )}
                <button 
                  onClick={() => modalConfig.onConfirm()} 
                  className="px-4 py-2 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700"
                >
                  确定
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}