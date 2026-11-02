#!/usr/bin/env python3
"""Independent check of fixed-history HSP state-switch identities.

NOT a physical-diode validation, convergence theorem, or a reproduction
of the earlier manuscript's missing SciPy single-node experiment.
Standard-library Python 3 only.
"""
from math import isfinite


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def solve(matrix, rhs):
    """Small partial-pivot Gaussian elimination; not a production solver."""
    n = len(rhs)
    a = [list(row) + [rhs[i]] for i, row in enumerate(matrix)]
    for k in range(n):
        r = max(range(k, n), key=lambda i: abs(a[i][k]))
        if abs(a[r][k]) < 1e-13:
            raise ArithmeticError("singular example matrix")
        a[k], a[r] = a[r], a[k]
        for i in range(k + 1, n):
            ratio = a[i][k] / a[k][k]
            for j in range(k, n + 1):
                a[i][j] -= ratio * a[k][j]
    x = [0.0] * n
    for i in range(n - 1, -1, -1):
        x[i] = (a[i][n] - sum(a[i][j] * x[j] for j in range(i + 1, n))) / a[i][i]
    assert all(isfinite(v) for v in x)
    return x


def matvec(a, x):
    return [dot(row, x) for row in a]


def maxabs(x):
    return max(map(abs, x), default=0.0)


def add_branch(a, branch, dg):
    return [[a[i][j] + dg * branch[i] * branch[j]
             for j in range(len(a))] for i in range(len(a))]


def one_diode_example():
    # Single node: source--R--node, C and diode from node to GND.
    # BE capacitor stamp contributes C/h. The state is initially OFF.
    r, c, h, vs, vprev = 1000., 1e-6, 1e-4, 10., 0.
    goff, gon, vf = 1e-8, 20., 0.7
    a0 = 1/r + c/h + goff
    b0 = vs/r + (c/h)*vprev
    dg, di = gon - goff, gon * vf
    x_off = b0 / a0
    x_on = (b0 + di) / (a0 + dg)
    u = 1.0 / a0
    denominator = 1 + dg * u
    corrected_displacement = u * (di - dg * x_off) / denominator
    assert abs((x_on - x_off) - corrected_displacement) < 1e-13
    assert x_off > 0.7 and x_on >= 0.65
    return x_off, x_on, corrected_displacement


def coupled_mna_example():
    # Three nodal rows (A) and one ideal voltage-source branch row (V).
    # A is symmetric indefinite; the identity is not restricted to SPD.
    g = [[.3, -.1, 0.], [-.1, .5, -.2], [0., -.2, .6]]
    a0 = [g[i] + [[1., -1., 0.][i]] for i in range(3)]
    a0.append([1., -1., 0., 0.])
    a1, a2 = [1., 0., -1., 0.], [0., 1., -1., 0.]
    goff, gon = 1e-8, 20.
    a0 = add_branch(add_branch(a0, a2, gon), a1, goff)
    b0 = [v + 14 * w for v, w in zip([.5, -.2, 0., 1.], a2)]
    x0 = solve(a0, b0)

    # Flip diode 1 OFF->ON and diode 2 ON->OFF.
    cols = [a1, a2]
    dg = [gon - goff, goff - gon]
    di = [14., -14.]
    a_next, b_next = a0, b0[:]
    for col, gdelta, idelta in zip(cols, dg, di):
        a_next = add_branch(a_next, col, gdelta)
        b_next = [v + idelta * w for v, w in zip(b_next, col)]
    x_next = solve(a_next, b_next)

    # U=A0^-1 B, K=I+D B^T U, delta=U K^-1(di-D B^T x0).
    u = [solve(a0, col) for col in cols]
    small = [[(1. if i == j else 0.) + dg[i] * dot(cols[i], u[j])
              for j in range(2)] for i in range(2)]
    z = [di[i] - dg[i] * dot(cols[i], x0) for i in range(2)]
    weights = solve(small, z)
    delta = [sum(u[j][i] * weights[j] for j in range(2)) for i in range(4)]
    error = maxabs([x_next[i] - x0[i] - delta[i] for i in range(4)])
    residual = maxabs([v - b for v, b in zip(matvec(a_next, x_next), b_next)])
    assert error < 1e-12 and residual < 1e-12
    assert dot(a1, x_next) >= .65 and dot(a2, x_next) <= .7
    return x0, x_next, error, residual


if __name__ == '__main__':
    off, on, delta = one_diode_example()
    old, new, err, resid = coupled_mna_example()
    print(f"one-diode BE: OFF={off:.12f} V, ON={on:.12f} V, displacement={delta:.12f} V")
    print("two-diode indefinite MNA: old=", [round(v, 12) for v in old])
    print("two-diode indefinite MNA: new=", [round(v, 12) for v in new])
    print(f"multi-flip identity maximum error={err:.3e}; MNA residual={resid:.3e}")
    print("PASS: formulas match direct re-solves in these example systems")
