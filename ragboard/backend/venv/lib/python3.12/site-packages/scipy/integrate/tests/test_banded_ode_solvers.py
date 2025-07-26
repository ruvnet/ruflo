import itertools
import pytest
import numpy as np
from numpy.testing import assert_allclose
from scipy.integrate import ode


def _band_count(a):
    """Returns ml and mu, the lower and upper band sizes of a."""
    nrows, ncols = a.shape
    ml = 0
    for k in range(-nrows+1, 0):
        if np.diag(a, k).any():
            ml = -k
            break
    mu = 0
    for k in range(nrows-1, 0, -1):
        if np.diag(a, k).any():
            mu = k
            break
    return ml, mu


def _linear_func(t, y, a):
    """Linear system dy/dt = a * y"""
    return a.dot(y)


def _linear_jac(t, y, a):
    """Jacobian of a * y is a."""
    return a


def _linear_banded_jac(t, y, a):
    """Banded Jacobian."""
    ml, mu = _band_count(a)
    bjac = [np.r_[[0] * k, np.diag(a, k)] for k in range(mu, 0, -1)]
    bjac.append(np.diag(a))
    for k in range(-1, -ml-1, -1):
        bjac.append(np.r_[np.diag(a, k), [0] * (-k)])
    return bjac


def _solve_linear_sys(a, y0, tend=1, dt=0.1,
                      solver=None, method='bdf', use_jac=True,
                      with_jacobian=False, banded=False):
    """Use scipy.integrate.ode to solve a linear system of ODEs.

    a : square ndarray
        Matrix of the linear system to be solved.
    y0 : ndarray
        Initial condition
    tend : float
        Stop time.
    dt : float
        Step size of the output.
    solver : str
        If not None, this must be "vode", "lsoda" or "zvode".
    method : str
        Either "bdf" or "adams".
    use_jac : bool
        Determines if the jacobian function is passed to ode().
    with_jacobian : bool
        Passed to ode.set_integrator().
    banded : bool
        Determines whether a banded or full jacobian is used.
        If `banded` is True, `lband` and `uband` are determined by the
        values in `a`.
    """
    if banded:
        lband, uband = _band_count(a)
    else:
        lband = None
        uband = None

    if use_jac:
        if banded:
            r = ode(_linear_func, _linear_banded_jac)
        else:
            r = ode(_linear_func, _linear_jac)
    else:
        r = ode(_linear_func)

    if solver is None:
        if np.iscomplexobj(a):
            solver = "zvode"
        else:
            solver = "vode"

    r.set_integrator(solver,
                     with_jacobian=with_jacobian,
                     method=method,
                     lband=lband, uband=uband,
                     rtol=1e-9, atol=1e-10,
                     )
    t0 = 0
    r.set_initial_value(y0, t0)
    r.set_f_params(a)
    r.set_jac_params(a)

    t = [t0]
    y = [y0]
    while r.successful() and r.t < tend:
        r.integrate(r.t + dt)
        t.append(r.t)
        y.append(r.y)

    t = np.array(t)
    y = np.array(y)
    return t, y


def _analytical_solution(a, y0, t):
    """
    Analytical solution to the linear differential equations dy/dt = a*y.

    The solution is only valid if `a` is diagonalizable.

    Returns a 2-D array with shape (len(t), len(y0)).
    """
    lam, v = np.linalg.eig(a)
    c = np.linalg.solve(v, y0)
    e = c * np.exp(lam * t.reshape(-1, 1))
    sol = e.dot(v.T)
    return sol


@pytest.mark.thread_unsafe
def test_banded_ode_solvers():
    # Test the "lsoda", "vode" and "zvode" solvers of the `ode` class
    # with a system that has a banded Jacobian matrix.

    # This test does not test the Jacobian evaluation (banded or not)
    # of "lsoda" due to the nonstiff nature of the equations.

    t_exact = np.linspace(0, 1.0, 5)

    # --- Real arrays for testing the "lsoda" and "vode" solvers ---

    # lband = 2, uband = 1:
    a_real = np.array([[-0.6, 0.1, 0.0, 0.0, 0.0],
                       [0.2, -0.5, 0.9, 0.0, 0.0],
                       [0.1, 0.1, -0.4, 0.1, 0.0],
                       [0.0, 0.3, -0.1, -0.9, -0.3],
                       [0.0, 0.0, 0.1, 0.1, -0.7]])

    # lband = 0, uband = 1:
    a_real_upper = np.triu(a_real)

    # lband = 2, uband = 0:
    a_real_lower = np.tril(a_real)

    # lband = 0, uband = 0:
    a_real_diag = np.triu(a_real_lower)

    real_matrices = [a_real, a_real_upper, a_real_lower, a_real_diag]
    real_solutions = []

    for a in real_matrices:
        y0 = np.arange(1, a.shape[0] + 1)
        y_exact = _analytical_solution(a, y0, t_exact)
        real_solutions.append((y0, t_exact, y_exact))

    def check_real(idx, solver, meth, use_jac, with_jac, banded):
        a = real_matrices[idx]
        y0, t_exact, y_exact = real_solutions[idx]
        t, y = _solve_linear_sys(a, y0,
                                 tend=t_exact[-1],
                                 dt=t_exact[1] - t_exact[0],
                                 solver=solver,
                                 method=meth,
                                 use_jac=use_jac,
                                 with_jacobian=with_jac,
                                 banded=banded)
        assert_allclose(t, t_exact)
        assert_allclose(y, y_exact)

    for idx in range(len(real_matrices)):
        p = [['vode', 'lsoda'],  # solver
             ['bdf', 'adams'],   # method
             [False, True],      # use_jac
             [False, True],      # with_jacobian
             [False, True]]      # banded
        for solver, meth, use_jac, with_jac, banded in itertools.product(*p):
            check_real(idx, solver, meth, use_jac, with_jac, banded)

    # --- Complex arrays for testing the "zvode" solver ---

    # complex, lband = 2, uband = 1:
    a_complex = a_real - 0.5j * a_real

    # complex, lband = 0, uband = 0:
    a_complex_diag = np.diag(np.diag(a_complex))

    complex_matrices = [a_complex, a_complex_diag]
    complex_solutions = []

    for a in complex_matrices:
        y0 = np.arange(1, a.shape[0] + 1) + 1j
        y_exact = _analytical_solution(a, y0, t_exact)
        complex_solutions.append((y0, t_exact, y_exact))

    def check_complex(idx, solver, meth, use_jac, with_jac, banded):
        a = complex_matrices[idx]
        y0, t_exact, y_exact = complex_solutions[idx]
        t, y = _solve_linear_sys(a, y0,
                                 tend=t_exact[-1],
                                 dt=t_exact[1] - t_exact[0],
                                 solver=solver,
                                 method=meth,
                                 use_jac=use_jac,
                                 with_jacobian=with_jac,
                                 banded=banded)
        assert_allclose(t, t_exact)
        assert_allclose(y, y_exact)

    for idx in range(len(complex_matrices)):
        p = [['bdf', 'adams'],   # method
             [False, True],      # use_jac
             [False, True],      # with_jacobian
             [False, True]]      # banded
        for meth, use_jac, with_jac, banded in itertools.product(*p):
            check_complex(idx, "zvode", meth, use_jac, with_jac, banded)

# lsoda requires a stiffer problem to switch to stiff solver
# Use the Robertson equation with surrounding trivial equations to make banded

def stiff_f(t, y):
    return np.array([
        y[0],
        -0.04 * y[1] + 1e4 * y[2] * y[3],
        0.04 * y[1] - 1e4 * y[2] * y[3] - 3e7 * y[2]**2,
        3e7 * y[2]**2,
        y[4]
    ])

def stiff_jac(t, y):
    return np.array([
        [1,     0,                            0,         0, 0],
        [0, -0.04,                     1e4*y[3],  1e4*y[2], 0],
        [0,  0.04, -1e4 * y[3] - 3e7 * 2 * y[2], -1e4*y[2], 0],
        [0,     0,                   3e7*2*y[2],         0, 0],
        [0,     0,                            0,         0, 1]
    ])

def banded_stiff_jac(t, y):
    return np.array([
        [0,     0,                    0,  1e4*y[2], 0],
        [0,     0,             1e4*y[3], -1e4*y[2], 0],
        [1, -0.04, -1e4*y[3]-3e7*2*y[2],         0, 1],
        [0,  0.04,           3e7*2*y[2],         0, 0]
    ])

@pytest.mark.thread_unsafe
def test_banded_lsoda():
    # expected solution is given by problem with full jacobian
    tfull, yfull = _solve_robertson_lsoda(use_jac=True, banded=False)

    for use_jac in [True, False]:
        t, y = _solve_robertson_lsoda(use_jac, True)
        assert_allclose(t, tfull)
        assert_allclose(y, yfull)

def _solve_robertson_lsoda(use_jac, banded):

    if use_jac:
        if banded:
            jac = banded_stiff_jac
        else:
            jac = stiff_jac
    else:
        jac = None

    if banded:
        lband = 1
        uband = 2
    else:
        lband = None
        uband = None

    r = ode(stiff_f, jac)
    r.set_integrator('lsoda',
                     lband=lband, uband=uband,
                     rtol=1e-9, atol=1e-10,
                     )
    t0 = 0
    dt = 1
    tend = 10
    y0 = np.array([1.0, 1.0, 0.0, 0.0, 1.0])
    r.set_initial_value(y0, t0)

    t = [t0]
    y = [y0]
    while r.successful() and r.t < tend:
        r.integrate(r.t + dt)
        t.append(r.t)
        y.append(r.y)

    # Ensure that the Jacobian was evaluated
    # iwork[12] has the number of Jacobian evaluations.
    assert r._integrator.iwork[12] > 0

    t = np.array(t)
    y = np.array(y)
    return t, y
