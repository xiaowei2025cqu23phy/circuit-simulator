// ============================================================
// 纯仿真内核：改进节点分析法 (MNA) + 后向欧拉 (Backward Euler)
// 不依赖 React / DOM，可在 Node.js 中直接进行单元测试。
//
// 模型说明：
//  - 电阻:    G = 1/R
//  - 电容:    伴随模型 G = C/dt, Ieq = (C/dt)·v(t-dt)  (后向欧拉)
//  - 电感:    支路方程 V = (L/dt)·(i - i(t-dt))
//  - 二极管:  理想开关模型: 导通时 0.7V 压降 + 50mΩ 内阻, 关断 1e8Ω。
//             通断判据：vD > 0.7V 导通；模型电流反向（iD < 0）即关断阻断，
//             配合步内定点迭代（最多 12 次），避免状态迟滞与伪尖峰。
//  - 开关:    闭合 0.01Ω / 断开 1e8Ω
// ============================================================

export const GMIN = 1e-12;          // 对角最小电导 (保证矩阵非奇异)
export const DEFAULT_DT = 1e-5;     // 默认仿真步长 10µs
export const HISTORY_MAX = 250000;  // 波形历史最大点数

// ---------- 并查集：导线/标签/接地节点合并 ----------
export class DSU {
  constructor() { this.parent = {}; }
  find(i) {
    if (this.parent[i] === undefined) this.parent[i] = i;
    if (this.parent[i] === i) return i;
    return this.parent[i] = this.find(this.parent[i]);
  }
  union(i, j) {
    const rootI = this.find(i), rootJ = this.find(j);
    if (rootI !== rootJ) this.parent[rootI] = rootJ;
  }
}

export const ptToStr = (p) => `${Math.round(p.x)},${Math.round(p.y)}`;

// 点是否位于线段上（含端点），用于导线交叉处自动合并节点
export const isPointOnSegment = (p, p1, p2) => {
  if (!p || !p1 || !p2) return false;
  const cross = (p.y - p1.y) * (p2.x - p1.x) - (p.x - p1.x) * (p2.y - p1.y);
  if (Math.abs(cross) > 1e-3) return false;
  const dot = (p.x - p1.x) * (p2.x - p1.x) + (p.y - p1.y) * (p2.y - p1.y);
  if (dot < 0) return false;
  const lenSq = (p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2;
  if (dot > lenSq) return false;
  return true;
};

// ---------- 信号源波形 ----------
export const getSourceValue = (el, t) => {
  const type = el.waveType || 'DC';
  const amp = Number(el.value) || 0;
  const offset = Number(el.offset) || 0;
  const freq = Number(el.freq) || 50;
  const duty = Number(el.duty) || 50;

  if (type === 'DC') return amp + offset;
  if (type === 'STEP') return t >= (el.stepTime || 0.001) ? amp + offset : offset;

  const T = 1 / freq;
  const phase = (t % T) / T;

  if (type === 'AC') return amp * Math.sin(2 * Math.PI * phase + (Number(el.phase) || 0) * Math.PI / 180) + offset;
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
    const exp1 = (v2 - v1) * (1 - Math.exp(-(t - td1) / tau1));
    const exp2 = (t > td2) ? (v2 - v1) * (1 - Math.exp(-(t - td2) / tau2)) : 0;
    return offset + v1 + exp1 - exp2;
  }
  return 0;
};

// ---------- 矩阵求逆（部分主元 Gauss-Jordan）----------
export function invertMatrix(M) {
  const n = M.length;
  const A = M.map(row => [...row]);
  const I = Array(n).fill(0).map((_, i) => { const r = Array(n).fill(0); r[i] = 1; return r; });

  for (let i = 0; i < n; i++) {
    let maxRow = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(A[k][i]) > Math.abs(A[maxRow][i])) maxRow = k;
    if (Math.abs(A[maxRow][i]) < 1e-12) return null;

    [A[i], A[maxRow]] = [A[maxRow], A[i]];
    [I[i], I[maxRow]] = [I[maxRow], I[i]];

    const pivot = A[i][i];
    for (let j = 0; j < n; j++) { A[i][j] /= pivot; I[i][j] /= pivot; }
    for (let k = 0; k < n; k++) {
      if (k !== i) {
        const factor = A[k][i];
        for (let j = 0; j < n; j++) { A[k][j] -= factor * A[i][j]; I[k][j] -= factor * I[i][j]; }
      }
    }
  }
  return I;
}

// ---------- MNA 矩阵装配 ----------
export function buildMNA(N, M, dt, validEls, branchEls, switchStates) {
  const size = N + M;
  const A = Array(size).fill(0).map(() => Array(size).fill(0));
  for (let i = 0; i < N; i++) A[i][i] += GMIN;

  validEls.forEach(el => {
    const { n1, n2, type, value, id } = el;
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
}

// ---------- 元件参数清洗（导入 / 加载时调用）----------
const ELEMENT_TYPES = new Set(['wire', 'resistor', 'capacitor', 'inductor', 'diode', 'switch', 'voltage', 'current', 'terminal', 'ground', 'label']);
const WAVE_TYPES = new Set(['DC', 'AC', 'STEP', 'SQUARE', 'TRIANGLE', 'PULSE', 'EXP']);

let _idSeq = 0;
export function nextId() {
  _idSeq += 1;
  return `e${Date.now().toString(36)}${_idSeq.toString(36)}`;
}

const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const pt = (v) => (v && Number.isFinite(v.x) && Number.isFinite(v.y)) ? { x: Math.round(v.x), y: Math.round(v.y) } : null;

/**
 * 清洗外部电路数据（JSON 导入、localStorage 工程等）。
 * 返回 { elements, dropped }：无效条目被丢弃并计数，参数越界被钳制。
 */
export function sanitizeElements(rawEls) {
  const out = [];
  let dropped = 0;
  const seen = new Set();
  const list = Array.isArray(rawEls) ? rawEls : [];

  list.forEach(raw => {
    if (!raw || typeof raw !== 'object' || !ELEMENT_TYPES.has(raw.type)) { dropped += 1; return; }
    const p1 = pt(raw.p1);
    if (!p1) { dropped += 1; return; }
    const p2 = pt(raw.p2);
    if (['wire', 'resistor', 'capacitor', 'inductor', 'diode', 'switch', 'voltage', 'current'].includes(raw.type) && !p2) {
      dropped += 1; return;
    }

    const el = {
      id: (typeof raw.id === 'string' && raw.id) ? raw.id : nextId(),
      type: raw.type,
      name: (typeof raw.name === 'string') ? raw.name : '',
      p1,
    };
    if (p2) el.p2 = p2;
    const bend = pt(raw.bend);
    if (bend && raw.type === 'wire') el.bend = bend;

    if (el.type === 'resistor') el.value = clamp(num(raw.value, 1000), 1e-9, 1e12);
    else if (el.type === 'capacitor') el.value = clamp(num(raw.value, 1e-6), 1e-15, 1e3);
    else if (el.type === 'inductor') el.value = clamp(num(raw.value, 1e-3), 1e-12, 1e6);
    else if (el.type === 'switch') {
      el.control = raw.control === 'time' ? 'time' : 'manual';
      el.state = raw.state !== false;
      el.timeOn = num(raw.timeOn, 0.01);
      el.timeOff = num(raw.timeOff, 0.02);
    } else if (el.type === 'voltage' || el.type === 'current') {
      el.value = num(raw.value, el.type === 'voltage' ? 5 : 0.1);
      el.offset = num(raw.offset, 0);
      el.waveType = WAVE_TYPES.has(raw.waveType) ? raw.waveType : 'DC';
      el.freq = clamp(num(raw.freq, 50), 1e-3, 1e9);
      el.duty = clamp(num(raw.duty, 50), 0, 100);
      el.phase = clamp(num(raw.phase, 0), -360, 360);
      el.stepTime = Math.max(num(raw.stepTime, 0.001), 0);
      el.v1 = num(raw.v1, 0);
      el.v2 = num(raw.v2, 5);
      el.td = num(raw.td, 0);
      el.tr = Math.max(num(raw.tr, 1e-6), 1e-12);
      el.tf = Math.max(num(raw.tf, 1e-6), 1e-12);
      el.pw = Math.max(num(raw.pw, 0.001), 1e-12);
      el.per = Math.max(num(raw.per, 0.002), 1e-12);
      el.td1 = num(raw.td1, 0);
      el.td2 = num(raw.td2, 1e-3);
      el.tau1 = Math.max(num(raw.tau1, 1e-3), 1e-12);
      el.tau2 = Math.max(num(raw.tau2, 1e-3), 1e-12);
    }
    // label 的文本值
    if (el.type === 'label') el.value = String(raw.value ?? 'NET');

    if (seen.has(el.id)) el.id = nextId();
    seen.add(el.id);
    out.push(el);
  });
  return { elements: out, dropped };
}

// ---------- 电路编译（建网表 + 装配 + 求逆）----------

/** 线段求交：返回交点（含端点接触），平行/共线返回 null */
function segIntersect(a1, a2, b1, b2) {
  const d1x = a2.x - a1.x, d1y = a2.y - a1.y;
  const d2x = b2.x - b1.x, d2y = b2.y - b1.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((b1.x - a1.x) * d2y - (b1.y - a1.y) * d2x) / denom;
  const u = ((b1.x - a1.x) * d1y - (b1.y - a1.y) * d1x) / denom;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return { x: a1.x + t * d1x, y: a1.y + t * d1y };
}

export function compileCircuit(els, dt = DEFAULT_DT) {
  const dsu = new DSU();
  let hasGround = false;
  const labelsByText = {};
  const allPts = [];
  els.forEach(el => {
    if (el.p1) allPts.push(el.p1);
    if (el.p2) allPts.push(el.p2);
    if (el.bend) allPts.push(el.bend);
  });

  const wireSegs = [];
  els.forEach(el => {
    if (el.type === 'wire') {
      const segs = el.bend ? [[el.p1, el.bend], [el.bend, el.p2]] : [[el.p1, el.p2]];
      segs.forEach(([a, b]) => {
        dsu.union(ptToStr(a), ptToStr(b));
        // 端点落在线段上（含交点）→ 并入该线段节点
        allPts.forEach(pt => {
          if (isPointOnSegment(pt, a, b)) dsu.union(ptToStr(pt), ptToStr(a));
        });
        wireSegs.push([a, b]);
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

  // 任意两条线段交叉 → 交叉点并入两条线段节点（端点接触由上方扫描覆盖，此处幂等）
  for (let i = 0; i < wireSegs.length; i++) {
    for (let j = i + 1; j < wireSegs.length; j++) {
      const p = segIntersect(wireSegs[i][0], wireSegs[i][1], wireSegs[j][0], wireSegs[j][1]);
      if (p) {
        const key = ptToStr(p);
        dsu.union(key, ptToStr(wireSegs[i][0]));
        dsu.union(key, ptToStr(wireSegs[j][0]));
      }
    }
  }

  Object.values(labelsByText).forEach(pts => {
    for (let i = 1; i < pts.length; i++) dsu.union(pts[0], pts[i]);
  });
  if (!hasGround) throw new Error('电路中缺少接地端 (GND)！请放置一个"接地"元件，或将端子/标签命名为 GND。');

  const finalGroundRoot = dsu.find('GND_SUPER');
  const nodeMap = {};
  let nodeCount = 0;
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
  if (size === 0) throw new Error('没有发现有效的电路回路。请连接元件与接地端后重试。');

  // 悬空节点检测：任何未通过元件（含支路元件）连通到地的节点都无法确定电位
  {
    const adj = new Map();
    const addEdge = (a, b) => {
      if (a === b) return;
      if (!adj.has(a)) adj.set(a, new Set());
      adj.get(a).add(b);
      if (!adj.has(b)) adj.set(b, new Set());
      adj.get(b).add(a);
    };
    validEls.forEach(el => addEdge(el.n1, el.n2));
    const visited = new Set([-1]);
    const stack = [-1];
    while (stack.length) {
      const u = stack.pop();
      (adj.get(u) || []).forEach(v => { if (!visited.has(v)) { visited.add(v); stack.push(v); } });
    }
    for (let i = 0; i < N; i++) {
      if (!visited.has(i)) throw new Error('电路存在悬空节点（未连接到地的独立节点），请检查连接是否完整。');
    }
  }

  // 悬空导线孤岛检测：未连接任何元件的导线/端子组件不允许静默存在
  {
    const nodeRoots = new Set();
    validEls.forEach(el => {
      nodeRoots.add(dsu.find(ptToStr(el.p1)));
      if (el.p2) nodeRoots.add(dsu.find(ptToStr(el.p2)));
    });
    nodeRoots.delete(finalGroundRoot);
    const seen = new Set();
    let island = false;
    allPts.forEach(p => {
      const root = dsu.find(ptToStr(p));
      if (root === finalGroundRoot || seen.has(root)) return;
      seen.add(root);
      if (!nodeRoots.has(root)) island = true;
    });
    if (island) throw new Error('存在悬空导线或端子（未连接到任何元件），请检查电路连接。');
  }

  const switchStates = {};
  validEls.forEach(el => {
    if (el.type === 'diode') switchStates[el.id] = false;
    if (el.type === 'switch') switchStates[el.id] = el.state !== false;
  });

  const A = buildMNA(N, M, dt, validEls, branchEls, switchStates);
  const A_inv = invertMatrix(A);
  if (!A_inv) throw new Error('电路拓扑存在悬空节点或非法连接（无法求解），请检查电路是否完整。');

  const branchMap = {};
  branchEls.forEach((el, idx) => { branchMap[el.id] = N + idx; });
  const engineEls = els.map(e => ({ ...e }));

  return {
    dt, t: 0, size, N, M, A_inv, validEls, branchEls, branchMap, dsu, nodeMap, finalGroundRoot,
    state: {}, history: [], currentNodes: {}, allEls: engineEls, switchStates,
    needsMatrixRebuild: false, lastMeasured: null, lastUiTime: 0,
  };
}

// ---------- 单步瞬态求解 ----------
export function stepEngine(eng, probeId = null) {
  const { dt, size, validEls, branchMap, state, switchStates } = eng;

  // 1) 更新定时开关状态（与电压无关，提前生效避免一步延迟）
  validEls.forEach(el => {
    if (el.type === 'switch' && el.control === 'time') {
      const shouldBeON = (eng.t >= (el.timeOn || 0) && eng.t <= (el.timeOff || 0));
      if (switchStates[el.id] !== shouldBeON) { switchStates[el.id] = shouldBeON; eng.needsMatrixRebuild = true; }
    }
  });

  // 2) 求解 + 二极管状态定点迭代
  //    求解后检查二极管压降，若状态应改变则重建矩阵重新求解（最多 12 次），
  //    使二极管通断在本步内收敛，避免"一步延迟"造成的伪尖峰。
  const assembleAndSolve = () => {
    if (eng.needsMatrixRebuild) {
      const A_new = buildMNA(eng.N, eng.M, dt, validEls, eng.branchEls, switchStates);
      const inv = invertMatrix(A_new);
      if (inv) eng.A_inv = inv;
      eng.needsMatrixRebuild = false;
    }
    const b = Array(size).fill(0);
    validEls.forEach(el => {
      const { id, n1, n2, type, value } = el;
      if (type === 'capacitor') {
        const Ieq = ((Number(value) || 1e-6) / dt) * (state[id] || 0);
        if (n1 >= 0) b[n1] += Ieq;
        if (n2 >= 0) b[n2] -= Ieq;
      }
      else if (type === 'inductor') b[branchMap[id]] = -((Number(value) || 1e-3) / dt) * (state[id] || 0);
      else if (type === 'voltage') b[branchMap[id]] = getSourceValue(el, eng.t);
      else if (type === 'current') {
        const isrc = getSourceValue(el, eng.t);
        if (n1 >= 0) b[n1] -= isrc;
        if (n2 >= 0) b[n2] += isrc;
      }
      else if (type === 'diode' && switchStates[id]) {
        const ieq = 0.7 * (1.0 / 0.05);
        if (n1 >= 0) b[n1] += ieq;
        if (n2 >= 0) b[n2] -= ieq;
      }
    });
    // 求解 x = A_inv · b
    const x = Array(size).fill(0);
    for (let i = 0; i < size; i++) {
      let sum = 0;
      for (let j = 0; j < size; j++) sum += eng.A_inv[i][j] * b[j];
      x[i] = sum;
    }
    return x;
  };

  let x = null;
  for (let iter = 0; iter < 12; iter++) {
    x = assembleAndSolve();
    let changed = false;
    validEls.forEach(el => {
      if (el.type !== 'diode') return;
      const vD = (el.n1 >= 0 ? x[el.n1] : 0) - (el.n2 >= 0 ? x[el.n2] : 0);
      const wasON = switchStates[el.id];
      if (!wasON) {
        if (vD > 0.7) { switchStates[el.id] = true; changed = true; }
      } else {
        // 导通压降模型下 vD = 0.7 + i·Ron 恒 ≥ 0.7，
        // 故必须用电流判据释放：模型电流为负（被电路反向驱动）→ 关断阻断
        const iD = (vD - 0.7) / 0.05;
        if (iD < -1e-6) { switchStates[el.id] = false; changed = true; }
      }
    });
    if (changed) { eng.needsMatrixRebuild = true; continue; }
    break;
  }

  // 3) 测量与状态更新
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
      const g = switchStates[id] ? 1.0 / 0.05 : 1e-8;
      i_elem = v_elem * g;
      if (type === 'diode' && switchStates[id]) i_elem -= 0.7 * g;
    }

    if (id === probeId) { measuredV = v_elem; measuredI = type === 'voltage' ? -i_elem : i_elem; }
  });

  // 4) 探针：端子 / 标签 / 导线 / 接地 → 测量该点对地电压
  if (probeId) {
    const selNode = eng.allEls.find(e => e.id === probeId);
    if (selNode && ['terminal', 'label', 'wire', 'ground'].includes(selNode.type)) {
      const pt = ptToStr(selNode.p1);
      const root = eng.dsu.find(pt);
      if (root === eng.finalGroundRoot) measuredV = 0;
      else if (eng.nodeMap[root] !== undefined) measuredV = x[eng.nodeMap[root]];
      measuredI = 0;
    }
  }

  // 5) 刷新节点电压缓存（用于二极管判断与 UI 显示）
  eng.allEls.forEach(el => {
    [el.p1, el.p2, el.bend].forEach(p => {
      if (!p) return;
      const key = ptToStr(p);
      const root = eng.dsu.find(key);
      if (root === eng.finalGroundRoot) eng.currentNodes[key] = 0;
      else if (eng.nodeMap[root] !== undefined) eng.currentNodes[key] = x[eng.nodeMap[root]];
    });
  });

  // 6) 波形历史（按点数上限截断，块式清理避免频繁大数组操作）
  if (probeId) {
    eng.history.push({ t: eng.t, v: measuredV, i: measuredI });
    eng.lastMeasured = { t: eng.t, v: measuredV, i: measuredI };
    if (eng.history.length >= HISTORY_MAX + 1000) eng.history.splice(0, eng.history.length - HISTORY_MAX);
  } else if (eng.history.length) {
    eng.history = [];
    eng.lastMeasured = null;
  }
  eng.t += dt;
}
