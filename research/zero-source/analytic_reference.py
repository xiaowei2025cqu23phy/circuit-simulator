#!/usr/bin/env python3
"""Independent analytic reference for the zero-source RC-PWL circuit.

Circuit: one node with R to ground, C to ground, and a two-state PWL diode to
ground. No independent source.

    C dv/dt = -(1/R + GMIN)*v - i_D(v),

Continuous-time hybrid solution (piecewise exponential, exact):

    ON : v(t) = v* + (v0 - v*) * exp(-t/tau_on),  v* = 14/(20 + 1/R + GMIN),
         tau_on = C/(20 + 1/R + GMIN)
    OFF: v(t) = v0 * exp(-t/tau_off),  tau_off = C/(1/R + 1e-8 + GMIN)

State law: ON while v >= 0.65 V, OFF while v <= 0.70 V (50 mV hysteresis).

This script uses only the Python standard library and does NOT call the
JavaScript engine or any SPICE solver. It is an independent reference, not a
substitute for physical device validation.

Usage:
    python research/zero-source/analytic_reference.py
    python research/zero-source/analytic_reference.py --out=<csv>
"""
import argparse
import csv
import math

R_DEFAULT = 1000.0
C_DEFAULT = 1e-6
G_ON = 20.0
V_F = 0.7
I_EQ = G_ON * V_F          # 14 A
G_OFF = 1e-8
GMIN = 1e-12
V_ON = 0.70
V_OFF = 0.65


def steady_on(R):
    return I_EQ / (G_ON + 1.0 / R + GMIN)


def tau_on(R, C):
    return C / (G_ON + 1.0 / R + GMIN)


def tau_off(R, C):
    return C / (1.0 / R + G_OFF + GMIN)


def analytic(case, R, C, t):
    """Return (v, state_on, v_star, crossing_time)."""
    v_star = steady_on(R)
    if case == "C_off_zero":
        return 0.0, False, v_star, None
    if case == "B_off":
        # Initial OFF at 0.68 V: include diode leakage and numerical ground conductance.
        v0 = 0.68
        return v0 * math.exp(-t / tau_off(R, C)), False, v_star, None
    if case != "A_on":
        raise ValueError("unknown case: " + case)
    v0 = 0.68
    t_on = tau_on(R, C)
    if v_star >= V_OFF:
        # the ON branch has an admissible fixed point at/above the OFF threshold
        v = v_star + (v0 - v_star) * math.exp(-t / t_on)
        return v, True, v_star, None
    # v* is below the OFF threshold: v decreases and crosses 0.65 at t_cross
    if abs(v0 - V_OFF) < 1e-15:
        return v0 * math.exp(-t / tau_off(R, C)), False, v_star, 0.0
    t_cross = t_on * math.log((v0 - v_star) / (V_OFF - v_star))
    if t < t_cross:
        v = v_star + (v0 - v_star) * math.exp(-t / t_on)
        return v, True, v_star, t_cross
    # after the crossing: OFF decay from 0.65 V
    v = V_OFF * math.exp(-(t - t_cross) / tau_off(R, C))
    return v, False, v_star, t_cross


def diode_current(v, state_on):
    return G_ON * (v - V_F) if state_on else G_OFF * v


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="research/zero-source/analytic-reference.csv")
    args = parser.parse_args()

    # Comparison times used by the JS engine: multiples of h plus common instants.
    step_sizes = [1e-9, 1e-8, 5e-8, 1e-7, 1e-4]
    comparison_times = [0.0, 1e-9, 1e-8, 2.5e-8, 5e-8, 7.5e-8, 1e-7, 2e-7,
                        5e-7, 1e-6, 1e-5, 1e-4]
    for h in step_sizes:
        for k in range(1, 8):
            t = k * h
            if t <= 1e-4 + 1e-18:
                comparison_times.append(t)
    comparison_times = sorted(set(round(t, 18) for t in comparison_times))

    rows = []
    # Cases A/B/C at R = 1 kOhm, and the resistance boundary scan for case A.
    for case in ["A_on", "B_off", "C_off_zero"]:
        rows.extend(build_rows(case, R_DEFAULT, C_DEFAULT, comparison_times))
    for R in [0.5, 0.65, 1.0, 1000.0]:
        rows.extend(build_rows("A_on", R, C_DEFAULT, comparison_times))
    # Steady-state table (independent of the time grid).
    for R in [0.5, 0.65, 1.0, 1000.0]:
        v_star = steady_on(R)
        rows.append({
            "kind": "steady_state", "case": "A_on", "R_ohm": R, "C_f": C_DEFAULT,
            "t_s": "", "v_analytic_v": v_star, "state_on": int(v_star >= V_OFF),
            "i_diode_a": diode_current(v_star, True), "p_diode_w": v_star * diode_current(v_star, True),
            "v_star_v": v_star, "tau_on_s": tau_on(R, C_DEFAULT),
            "tau_off_s": tau_off(R, C)_DEFAULT,
            "on_steady_state_exists": int(v_star >= V_OFF),
        })

    fields = ["kind", "case", "R_ohm", "C_f", "t_s", "v_analytic_v", "state_on",
              "i_diode_a", "p_diode_w", "v_star_v", "tau_on_s", "tau_off_s",
              "on_steady_state_exists"]
    with open(args.out, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)
    print(f"wrote {len(rows)} analytic rows -> {args.out}")
    for R in [0.5, 0.65, 1.0, 1000.0]:
        v_star = steady_on(R)
        print(f"R={R:>7} ohm: v*={v_star:.15f} V  ON steady state exists={v_star >= V_OFF}")


def build_rows(case, R, C, times):
    out = []
    for t in times:
        v, state_on, v_star, t_cross = analytic(case, R, C, t)
        i_d = diode_current(v, state_on)
        out.append({
            "kind": "transient", "case": case, "R_ohm": R, "C_f": C,
            "t_s": t, "v_analytic_v": v, "state_on": int(state_on),
            "i_diode_a": i_d, "p_diode_w": v * i_d,
            "v_star_v": v_star, "tau_on_s": tau_on(R, C), "tau_off_s": R * C,
            "on_steady_state_exists": int(v_star >= V_OFF),
        })
    return out


if __name__ == "__main__":
    main()
