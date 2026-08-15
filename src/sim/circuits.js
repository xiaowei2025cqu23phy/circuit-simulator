// ============================================================
// 预置教学电路（坐标均为 20px 网格对齐）
// ============================================================

export const PREDEFINED_CIRCUITS = {
  rectifier: {
    name: "半波整流与平滑滤波",
    description: "50Hz 交流经二极管半波整流后由 470µF 电容滤波，输出约 11V 直流",
    elements: [
      { "id": "v1", "name": "AC_IN", "type": "voltage", "p1": { "x": 140, "y": 360 }, "p2": { "x": 140, "y": 260 }, "value": 12, "offset": 0, "waveType": "AC", "freq": 50, "duty": 50 },
      { "id": "w1", "type": "wire", "name": "", "p1": { "x": 140, "y": 260 }, "p2": { "x": 220, "y": 260 }, "value": 0 },
      { "id": "d1", "name": "D1", "type": "diode", "p1": { "x": 220, "y": 260 }, "p2": { "x": 320, "y": 260 } },
      { "id": "w2", "type": "wire", "name": "", "p1": { "x": 320, "y": 260 }, "p2": { "x": 400, "y": 260 }, "value": 0 },
      { "id": "t1", "type": "terminal", "name": "VOUT", "p1": { "x": 320, "y": 260 }, "p2": { "x": 320, "y": 260 }, "value": null },
      { "id": "c1", "name": "C1", "type": "capacitor", "p1": { "x": 320, "y": 260 }, "p2": { "x": 320, "y": 360 }, "value": 0.00047 },
      { "id": "r1", "name": "LOAD", "type": "resistor", "p1": { "x": 400, "y": 260 }, "p2": { "x": 400, "y": 360 }, "value": 100 },
      { "id": "w3", "type": "wire", "name": "", "p1": { "x": 400, "y": 360 }, "p2": { "x": 140, "y": 360 }, "value": 0 },
      { "id": "w4", "type": "wire", "name": "", "p1": { "x": 320, "y": 360 }, "p2": { "x": 400, "y": 360 }, "value": 0 },
      { "id": "g1", "type": "ground", "name": "", "p1": { "x": 260, "y": 360 }, "p2": { "x": 260, "y": 360 }, "value": null }
    ]
  },
  fullwave_rect: {
    name: "全波整流桥与滤波",
    description: "四个二极管构成全波整流桥，纹波频率为 100Hz，输出约 14V 直流",
    elements: [
      { "id": "v1", "name": "AC_IN", "type": "voltage", "p1": { "x": 140, "y": 420 }, "p2": { "x": 140, "y": 260 }, "value": 12, "offset": 0, "waveType": "AC", "freq": 50, "duty": 50 },
      { "id": "w1", "type": "wire", "name": "", "p1": { "x": 140, "y": 260 }, "p2": { "x": 260, "y": 260 }, "value": 0 },
      { "id": "w2", "type": "wire", "name": "", "p1": { "x": 140, "y": 420 }, "p2": { "x": 260, "y": 420 }, "value": 0 },
      { "id": "d1", "name": "D1", "type": "diode", "p1": { "x": 260, "y": 260 }, "p2": { "x": 340, "y": 180 } },
      { "id": "d2", "name": "D2", "type": "diode", "p1": { "x": 260, "y": 420 }, "p2": { "x": 340, "y": 180 } },
      { "id": "d3", "name": "D3", "type": "diode", "p1": { "x": 340, "y": 500 }, "p2": { "x": 260, "y": 260 } },
      { "id": "d4", "name": "D4", "type": "diode", "p1": { "x": 340, "y": 500 }, "p2": { "x": 260, "y": 420 } },
      { "id": "w3", "type": "wire", "name": "", "p1": { "x": 340, "y": 180 }, "p2": { "x": 380, "y": 180 }, "value": 0 },
      { "id": "w4", "type": "wire", "name": "", "p1": { "x": 340, "y": 500 }, "p2": { "x": 380, "y": 500 }, "value": 0 },
      { "id": "c1", "name": "C1", "type": "capacitor", "p1": { "x": 380, "y": 180 }, "p2": { "x": 380, "y": 500 }, "value": 0.00047 },
      { "id": "w5", "type": "wire", "name": "", "p1": { "x": 380, "y": 180 }, "p2": { "x": 500, "y": 180 }, "value": 0 },
      { "id": "w6", "type": "wire", "name": "", "p1": { "x": 380, "y": 500 }, "p2": { "x": 500, "y": 500 }, "value": 0 },
      { "id": "r1", "name": "LOAD", "type": "resistor", "p1": { "x": 500, "y": 180 }, "p2": { "x": 500, "y": 500 }, "value": 100 },
      { "id": "t1", "type": "terminal", "name": "VOUT", "p1": { "x": 500, "y": 180 }, "p2": { "x": 500, "y": 180 }, "value": null },
      { "id": "g1", "type": "ground", "name": "", "p1": { "x": 380, "y": 500 }, "p2": { "x": 380, "y": 500 }, "value": null }
    ]
  },
  rlc_step: {
    name: "RLC 串联阻尼振荡",
    description: "10V 阶跃激励 RLC 串联回路，欠阻尼振荡后收敛于 10V",
    elements: [
      { "id": "v1", "name": "STEP", "type": "voltage", "p1": { "x": 140, "y": 360 }, "p2": { "x": 140, "y": 260 }, "value": 10, "waveType": "STEP", "stepTime": 0.002 },
      { "id": "w1", "type": "wire", "p1": { "x": 140, "y": 260 }, "p2": { "x": 220, "y": 260 } },
      { "id": "r1", "name": "R1", "type": "resistor", "p1": { "x": 220, "y": 260 }, "p2": { "x": 300, "y": 260 }, "value": 10 },
      { "id": "l1", "name": "L1", "type": "inductor", "p1": { "x": 300, "y": 260 }, "p2": { "x": 380, "y": 260 }, "value": 0.05 },
      { "id": "t1", "name": "VC", "type": "terminal", "p1": { "x": 380, "y": 260 }, "p2": { "x": 380, "y": 260 } },
      { "id": "c1", "name": "C1", "type": "capacitor", "p1": { "x": 380, "y": 260 }, "p2": { "x": 380, "y": 360 }, "value": 1e-5 },
      { "id": "w2", "type": "wire", "p1": { "x": 380, "y": 360 }, "p2": { "x": 140, "y": 360 } },
      { "id": "g1", "type": "ground", "p1": { "x": 260, "y": 360 }, "p2": { "x": 260, "y": 360 } }
    ]
  },
  rc_pwm: {
    name: "RC 充放电纹波 (方波)",
    description: "100Hz 5V 方波经 1kΩ 对 2.2µF 充放电，观察电容端电压纹波",
    elements: [
      { "id": "v1", "name": "PWM", "type": "voltage", "p1": { "x": 160, "y": 360 }, "p2": { "x": 160, "y": 260 }, "value": 5, "waveType": "SQUARE", "freq": 100, "duty": 50 },
      { "id": "w1", "type": "wire", "p1": { "x": 160, "y": 260 }, "p2": { "x": 260, "y": 260 } },
      { "id": "r1", "name": "R1", "type": "resistor", "p1": { "x": 260, "y": 260 }, "p2": { "x": 360, "y": 260 }, "value": 1000 },
      { "id": "t1", "name": "VC", "type": "terminal", "p1": { "x": 360, "y": 260 }, "p2": { "x": 360, "y": 260 } },
      { "id": "c1", "name": "C1", "type": "capacitor", "p1": { "x": 360, "y": 260 }, "p2": { "x": 360, "y": 360 }, "value": 2.2e-6 },
      { "id": "w2", "type": "wire", "p1": { "x": 360, "y": 360 }, "p2": { "x": 160, "y": 360 } },
      { "id": "g1", "type": "ground", "p1": { "x": 260, "y": 360 }, "p2": { "x": 260, "y": 360 } }
    ]
  },
  diode_clipper: {
    name: "二极管双向限幅钳位",
    description: "±10V 正弦经两只反向并联二极管双向限幅至约 ±0.7V",
    elements: [
      { "id": "v1", "name": "AC_IN", "type": "voltage", "p1": { "x": 120, "y": 340 }, "p2": { "x": 120, "y": 240 }, "value": 10, "waveType": "AC", "freq": 50 },
      { "id": "w1", "type": "wire", "p1": { "x": 120, "y": 240 }, "p2": { "x": 200, "y": 240 } },
      { "id": "r1", "name": "R_LIM", "type": "resistor", "p1": { "x": 200, "y": 240 }, "p2": { "x": 280, "y": 240 }, "value": 100 },
      { "id": "w2", "type": "wire", "p1": { "x": 280, "y": 240 }, "p2": { "x": 360, "y": 240 } },
      { "id": "d1", "name": "D1", "type": "diode", "p1": { "x": 280, "y": 240 }, "p2": { "x": 280, "y": 340 } },
      { "id": "d2", "name": "D2", "type": "diode", "p1": { "x": 360, "y": 340 }, "p2": { "x": 360, "y": 240 } },
      { "id": "t1", "name": "V_CLIP", "type": "terminal", "p1": { "x": 360, "y": 240 }, "p2": { "x": 360, "y": 240 } },
      { "id": "w3", "type": "wire", "p1": { "x": 360, "y": 340 }, "p2": { "x": 120, "y": 340 } },
      { "id": "g1", "type": "ground", "p1": { "x": 240, "y": 340 }, "p2": { "x": 240, "y": 340 } }
    ]
  },
  boost_inductor: {
    name: "电感断电高压尖峰",
    description: "开关断开瞬间电感电流被强迫流过 1e8Ω 开路电阻，产生高压尖峰（危险！续流二极管可消除）",
    elements: [
      { "id": "v1", "name": "DC_IN", "type": "voltage", "p1": { "x": 140, "y": 360 }, "p2": { "x": 140, "y": 260 }, "value": 5, "waveType": "DC" },
      { "id": "w1", "type": "wire", "p1": { "x": 140, "y": 260 }, "p2": { "x": 200, "y": 260 } },
      { "id": "sw1", "name": "SW1", "type": "switch", "p1": { "x": 200, "y": 260 }, "p2": { "x": 280, "y": 260 }, "control": "time", "timeOn": 0, "timeOff": 0.015, "state": true },
      { "id": "w2", "type": "wire", "p1": { "x": 280, "y": 260 }, "p2": { "x": 360, "y": 260 } },
      { "id": "l1", "name": "L_LOAD", "type": "inductor", "p1": { "x": 360, "y": 260 }, "p2": { "x": 360, "y": 360 }, "value": 0.1 },
      { "id": "t1", "name": "V_KICK", "type": "terminal", "p1": { "x": 360, "y": 260 }, "p2": { "x": 360, "y": 260 } },
      { "id": "w3", "type": "wire", "p1": { "x": 360, "y": 360 }, "p2": { "x": 140, "y": 360 } },
      { "id": "g1", "type": "ground", "p1": { "x": 250, "y": 360 }, "p2": { "x": 250, "y": 360 } }
    ]
  },
  freewheel: {
    name: "电感续流二极管钳位",
    description: "与上一例相同拓扑，但电感两端并联续流二极管，断电尖峰被钳位在约 0.7V",
    elements: [
      { "id": "v1", "name": "DC_IN", "type": "voltage", "p1": { "x": 140, "y": 260 }, "p2": { "x": 140, "y": 360 }, "value": 5, "waveType": "DC" },
      { "id": "w1", "type": "wire", "p1": { "x": 140, "y": 260 }, "p2": { "x": 200, "y": 260 } },
      { "id": "sw1", "name": "SW1", "type": "switch", "p1": { "x": 200, "y": 260 }, "p2": { "x": 280, "y": 260 }, "control": "time", "timeOn": 0, "timeOff": 0.015, "state": true },
      { "id": "w2", "type": "wire", "p1": { "x": 280, "y": 260 }, "p2": { "x": 360, "y": 260 } },
      { "id": "l1", "name": "L_LOAD", "type": "inductor", "p1": { "x": 360, "y": 260 }, "p2": { "x": 360, "y": 360 }, "value": 0.1 },
      { "id": "w3", "type": "wire", "p1": { "x": 360, "y": 260 }, "p2": { "x": 380, "y": 260 } },
      { "id": "w4", "type": "wire", "p1": { "x": 360, "y": 360 }, "p2": { "x": 380, "y": 360 } },
      { "id": "d1", "name": "D_FW", "type": "diode", "p1": { "x": 380, "y": 360 }, "p2": { "x": 380, "y": 260 } },
      { "id": "t1", "name": "V_SW", "type": "terminal", "p1": { "x": 360, "y": 260 }, "p2": { "x": 360, "y": 260 } },
      { "id": "w5", "type": "wire", "p1": { "x": 360, "y": 360 }, "p2": { "x": 140, "y": 360 } },
      { "id": "g1", "type": "ground", "p1": { "x": 260, "y": 360 }, "p2": { "x": 260, "y": 360 } }
    ]
  }
};
