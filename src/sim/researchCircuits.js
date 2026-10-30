/**
 * Research-only, deterministic electrical topologies for MNA verification.
 *
 * Returns genuine element definitions that go through compileCircuit,
 * including coordinate-based connectivity, a grounded voltage source,
 * diode PWL stamps, and BE capacitor/inductor companions.
 *
 * NO React/UI state or random inputs. These are electrical fixtures,
 * not benchmark timing results or external SPICE reference netlists.
 */
const fixturePoint = (x, y) => ({ x, y });
const SOURCE_POS = fixturePoint(0, 40);
const GROUND = fixturePoint(0, 0);
const validCount = (n, max = 64) =>
  Number.isInteger(n) && n >= 2 && n <= max;

/**
 * Independent R-diode-(C || R) branches driven by the same AC source.
 * Exactly one diode in each branch; multiple transitions may occur
 * during the same nominal BE step. Matrix dimension is 2*count + 2.
 * The opt-in heavy-load profile produces repeated ON/OFF transitions
 * under a shared AC drive, whereas light-load branches may stay ON.
 * These are numerical PWL stress fixtures, NOT physical diode claims.
 */
export function makeParallelDiodeBank(count, options = {}) {
  return buildDiodeBank(count, 64, options);
}

/**
 * Same topology with a raised fixture limit so the dense MNA system can reach
 * 64 (31 diodes), 96 (47), 128 (63) and 256 (127) unknowns.
 * This is still a numerical PWL stress fixture, not a physical bank.
 */
export function makeLargeDiodeBank(count, options = {}) {
  return buildDiodeBank(count, 128, options);
}

function buildDiodeBank(count, maxCount, {
  frequency = 50,
  peakVoltage = 8,
  loadProfile = 'light',
} = {}) {
  if (!validCount(count, maxCount) || !Number.isFinite(frequency) || frequency <= 0 ||
      !Number.isFinite(peakVoltage) || peakVoltage <= 0 ||
      !['light','heavy'].includes(loadProfile)) {
    throw new Error('无效的多二极管研究电路参数');
  }
  const elements = [
    { id: 'source', type: 'voltage', p1: SOURCE_POS, p2: GROUND,
      value: peakVoltage, offset: 0, waveType: 'AC', freq: frequency },
    { id: 'gnd', type: 'ground', p1: GROUND },
  ];
  for (let i = 0; i < count; i++) {
    const a = fixturePoint(80, 80 + 40 * i);
    const b = fixturePoint(160, 80 + 40 * i);
    elements.push({ id: 'feed'+i, type: 'resistor', p1: SOURCE_POS, p2: a,
      value: loadProfile === 'heavy' ? 2 + 0.5*(i % 3) : 100 + (i % 3) * 80 });
    elements.push({ id: 'diode'+i, type: 'diode', p1: a, p2: b });
    elements.push({ id: 'load'+i, type: 'resistor', p1: b, p2: GROUND,
      value: loadProfile === 'heavy' ? 2 + 0.25*(i % 5) : 1000 + (i % 5) * 200 });
    elements.push({ id: 'cap'+i, type: 'capacitor', p1: b, p2: GROUND,
      value: loadProfile === 'heavy' ? 1e-8 : 1e-6 + (i % 4) * 0.5e-6 });
  }
  elements.push({ id: 'probe', type: 'terminal', name: 'VOUT', p1: fixturePoint(160, 80) });
  return elements;
}

/**
 * Small multi-stage reactive networks, using actual MNA branch equations.
 * RC: series resistors and shunt C/R.
 * RL: series inductors and shunt R.
 * RLC: series resistor + inductor, shunt capacitor + resistor.
 *
 * A single terminal at the last stage is the reproducible voltage probe.
 */
export function makeReactiveLadder(stages, options = {}) {
  if (!validCount(stages)) throw new Error('无效的多级反应网络参数');
  return makeReactiveLadderScaled(stages, options);
}

/**
 * Ladder fixture sized from a target MNA dimension instead of a stage count.
 *
 * Dense MNA dimensions (one ideal voltage-source branch current is added):
 *   rc  : size = stages + 2       -> stages = size - 2
 *   rl  : size = 2*stages + 2     -> stages = (size - 2) / 2
 *   rlc : size = 3*stages + 2     -> stages = (size - 2) / 3
 *
 * Only exact integer stage counts are accepted, so the caller can request
 * 64/96/128/256 and verify the resulting dimension from the compiled engine.
 */
export function makeLargeLadder(targetSize, {
  kind = 'rc', frequency = 25, peakVoltage = 5,
} = {}) {
  const divisors = { rc: 1, rl: 2, rlc: 3 };
  const divisor = divisors[kind];
  if (!Number.isInteger(targetSize) || targetSize < 4 || targetSize > 512 || !divisor) {
    throw new Error('无效的目标 MNA 阶数');
  }
  if ((targetSize - 2) % divisor !== 0) {
    throw new Error('目标 MNA 阶数与网络类型不匹配: ' + kind + '/' + targetSize);
  }
  const stages = (targetSize - 2) / divisor;
  if (!Number.isInteger(stages) || stages < 2 || stages > 512) {
    throw new Error('无效的目标 MNA 阶数');
  }
  return makeReactiveLadderScaled(stages, { kind, frequency, peakVoltage });
}

function makeReactiveLadderScaled(stages, {
  kind = 'rlc', frequency = 25, peakVoltage = 5,
} = {}) {
  if (!validCount(stages, 512) || !['rc', 'rl', 'rlc'].includes(kind) ||
      !Number.isFinite(frequency) || frequency <= 0 ||
      !Number.isFinite(peakVoltage) || peakVoltage <= 0) {
    throw new Error('无效的多级反应网络参数');
  }
  const elements = [
    { id: 'source', type: 'voltage', p1: SOURCE_POS, p2: GROUND,
      waveType: 'AC', value: peakVoltage, freq: frequency },
    { id: 'gnd', type: 'ground', p1: GROUND },
  ];
  let previous = SOURCE_POS;
  for (let i = 0; i < stages; i++) {
    const next = fixturePoint(80 + 80 * i, 40);
    if (kind === 'rc') {
      elements.push({ id:'series-r'+i, type:'resistor',
        p1:previous, p2:next, value:150 + 25*(i%4) });
    } else if (kind === 'rl') {
      elements.push({ id:'series-l'+i, type:'inductor',
        p1:previous, p2:next, value:0.010+0.002*(i%4) });
    } else {
      const intermediate = fixturePoint(40 + 80 * i, 40);
      elements.push({ id:'series-r'+i, type:'resistor',
        p1:previous, p2:intermediate, value:100+20*(i%4) });
      elements.push({ id:'series-l'+i, type:'inductor',
        p1:intermediate, p2:next, value:0.010+0.002*(i%4) });
    }
    elements.push({ id:'shunt-r'+i, type:'resistor',
      p1:next, p2:GROUND, value:1500+100*(i%5) });
    if (kind !== 'rl') {
      elements.push({ id:'shunt-c'+i, type:'capacitor',
        p1:next, p2:GROUND, value:1e-6+0.2e-6*(i%4) });
    }
    previous=next;
  }
  elements.push({ id:'probe', type:'terminal', name:'VOUT', p1:previous });
  return elements;
}
