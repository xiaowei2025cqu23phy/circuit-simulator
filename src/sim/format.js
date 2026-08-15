// ============================================================
// 数值格式化：SI 词头 / 电压电流单位显示
// ============================================================

const PREFIXES = ['p', 'n', 'µ', 'm', '', 'k', 'M', 'G'];

/** 将数值格式化为 3 位有效数字 + SI 词头，如 1000 → "1k"，0.00047 → "470µ" */
export function formatValue(v) {
  if (!Number.isFinite(v)) return '—';
  const av = Math.abs(v);
  if (av === 0) return '0';
  const exp = Math.floor(Math.log10(av));
  const idx = Math.max(0, Math.min(PREFIXES.length - 1, Math.floor(exp / 3) + 4));
  const scaled = v / Math.pow(10, (idx - 4) * 3);
  const digits = Math.abs(scaled) >= 100 ? 0 : Math.abs(scaled) >= 10 ? 1 : 2;
  return `${scaled.toFixed(digits)}${PREFIXES[idx]}`;
}

/** 值 + 单位，如 formatValueWithUnit(1000, 'Ω') → "1kΩ" */
export function formatValueWithUnit(v, unit) {
  if (!Number.isFinite(v)) return '—';
  return `${formatValue(v)}${unit}`;
}

/** 电压显示：自动 V / mV / µV */
export function formatVoltage(v) {
  if (!Number.isFinite(v)) return '—';
  const av = Math.abs(v);
  if (av >= 1) return `${v.toFixed(3)} V`;
  if (av >= 1e-3) return `${(v * 1e3).toFixed(3)} mV`;
  if (av >= 1e-6) return `${(v * 1e6).toFixed(3)} µV`;
  return `${v.toExponential(2)} V`;
}

/** 电流显示：自动 A / mA / µA */
export function formatCurrent(i) {
  if (!Number.isFinite(i)) return '—';
  const av = Math.abs(i);
  if (av >= 1) return `${i.toFixed(3)} A`;
  if (av >= 1e-3) return `${(i * 1e3).toFixed(3)} mA`;
  if (av >= 1e-6) return `${(i * 1e6).toFixed(3)} µA`;
  return `${i.toExponential(2)} A`;
}

/** 时间显示：自动 s / ms / µs */
export function formatTime(t) {
  if (!Number.isFinite(t)) return '—';
  const av = Math.abs(t);
  if (av >= 1) return `${t.toFixed(3)} s`;
  if (av >= 1e-3) return `${(t * 1e3).toFixed(2)} ms`;
  return `${(t * 1e6).toFixed(1)} µs`;
}

/** 元件参数单位 */
export const UNIT_OF = {
  resistor: 'Ω',
  capacitor: 'F',
  inductor: 'H',
  voltage: 'V',
  current: 'A',
};

/** 工具提示文案：元件类型 → 说明 */
export const TOOL_HINTS = {
  select: '选择/探测：点击元件查看属性与波形；拖拽可移动；仿真中点击手动开关切换',
  move: '移动：拖拽元件整体移动；拖拽端点可重新接线',
  wire: '导线：按下拖拽绘制；正交模式下自动直角拐弯；靠近端点自动吸附',
  resistor: '电阻：按下拖拽绘制，双击或选中后在左侧面板设置阻值',
  capacitor: '电容：按下拖拽绘制，参数单位法拉 (F)',
  inductor: '电感：按下拖拽绘制，参数单位亨利 (H)',
  diode: '二极管：三角形一端为阳极 (A)，竖线一端为阴极 (K)，导通压降 0.7V',
  switch: '开关：手动开关仿真中点击切换；定时开关按设定时刻自动通断',
  voltage: '电压源：支持 DC / AC / 方波 / 三角波 / 脉冲 / 指数 / 阶跃波形',
  current: '电流源：支持与电压源相同的波形类型',
  terminal: '接线端子：命名端子可跨区域连接同名网络；命名为 GND 即接地',
  ground: '接地：电路必须包含接地端才能仿真',
  label: '网络标签：相同名称的标签电气相连，NET 为默认名',
  delete: '删除：点击元件将其移除',
};
