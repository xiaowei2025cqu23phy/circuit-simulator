#!/usr/bin/env python3
"""Independent positive-bias DC resistor/diode model-form comparison.

Circuit: positive Vs -> R=1000 ohm -> diode -> ground.
Shockley + Rs: Vs = I*(R+Rs) + n*VT*ln(1+I/Is).
This is an independent scalar equation reference, NOT ngspice output,
not an empirical measurement, and not a transient HSP-MNA accuracy test.

Run: python3 research/physical_diode_dc.py > dc_reference.csv
No external Python packages are required.
"""
import csv
import math
import sys

R = 1000.0
RS = 0.05
IS = 1e-12
N = 1.8
VT = 0.025852
VF = 0.70
ROFF = 1e8


def shockley_current(vs):
    if vs <= 0:
        return 0.0
    lo, hi = 0.0, vs / R
    for _ in range(90):
        mid = (lo + hi) / 2
        voltage = mid * (R + RS) + N * VT * math.log1p(mid / IS)
        if voltage > vs:
            hi = mid
        else:
            lo = mid
    return (lo + hi) / 2


def pwl_current(vs):
    return vs / (R + ROFF) if vs <= VF else (vs - VF) / (R + RS)


writer = csv.writer(sys.stdout)
writer.writerow(['Vs_V', 'I_Shockley_A', 'I_PWL_A', 'PWL_minus_Shockley_A'])
sum_sq, max_abs = 0.0, 0.0
for k in range(501):
    vs = 2.5 * k / 500
    i_phys = shockley_current(vs)
    i_pwl = pwl_current(vs)
    error = i_pwl - i_phys
    sum_sq += error * error
    max_abs = max(max_abs, abs(error))
    writer.writerow([vs, i_phys, i_pwl, error])
print('DC model RMSE(A):', math.sqrt(sum_sq / 501), file=sys.stderr)
print('DC model max abs difference(A):', max_abs, file=sys.stderr)
