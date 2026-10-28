// Experimental finite-state PWL diode predictor.
// The predicted state for step n+1 uses the accepted voltages from step n.
// It is NOT a converged solution of the current-step complementarity problem.
export const DIODE_ON_VOLTAGE = 0.7;
export const DIODE_OFF_VOLTAGE = 0.65;

export function predictDiodeStates(validEls, switchStates, previousSolution, {
  turnOn = DIODE_ON_VOLTAGE,
  turnOff = DIODE_OFF_VOLTAGE,
} = {}) {
  if (!previousSolution) return 0;
  if (!(turnOff < turnOn)) throw new Error('二极管迟滞阈值必须满足 turnOff < turnOn');
  let changed = 0;
  for (const el of validEls) {
    if (el.type !== 'diode') continue;
    const vD = (el.n1 >= 0 ? previousSolution[el.n1] : 0)
      - (el.n2 >= 0 ? previousSolution[el.n2] : 0);
    const wasOn = Boolean(switchStates[el.id]);
    const nextOn = wasOn ? vD >= turnOff : vD > turnOn;
    if (nextOn !== wasOn) {
      switchStates[el.id] = nextOn;
      changed += 1;
    }
  }
  return changed;
}

export function countDiodeStateDisagreements(validEls, switchStates, solution, {
  turnOn = DIODE_ON_VOLTAGE,
  turnOff = DIODE_OFF_VOLTAGE,
} = {}) {
  let count = 0;
  for (const el of validEls) {
    if (el.type !== 'diode') continue;
    const vD = (el.n1 >= 0 ? solution[el.n1] : 0)
      - (el.n2 >= 0 ? solution[el.n2] : 0);
    const on = Boolean(switchStates[el.id]);
    if ((!on && vD > turnOn) || (on && vD < turnOff)) count += 1;
  }
  return count;
}
