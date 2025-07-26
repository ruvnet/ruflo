import math

import numpy as np
from numpy.testing import assert_allclose, assert_array_almost_equal

from scipy.optimize import (
    fmin_cobyla, minimize, Bounds, NonlinearConstraint, LinearConstraint,
    OptimizeResult
)


class TestCobyla:
    def setup_method(self):
        # The algorithm is very fragile on 32 bit, so unfortunately we need to start
        # very near the solution in order for the test to pass.
        self.x0 = [np.sqrt(25 - (2.0/3)**2), 2.0/3 + 1e-4]
        self.solution = [math.sqrt(25 - (2.0/3)**2), 2.0/3]
        self.opts = {'disp': 0, 'rhobeg': 1, 'tol': 1e-6,
                     'maxiter': 100}

    def fun(self, x):
        return x[0]**2 + abs(x[1])**3

    def con1(self, x):
        return x[0]**2 + x[1]**2 - 25

    def con2(self, x):
        return -self.con1(x)

    def test_simple(self):
        # use disp=True as smoke test for gh-8118
        x = fmin_cobyla(self.fun, self.x0, [self.con1, self.con2], rhobeg=1,
                        rhoend=1e-5, maxfun=100, disp=1)
        assert_allclose(x, self.solution, atol=1e-4)

    def test_minimize_simple(self):
        class Callback:
            def __init__(self):
                self.n_calls = 0
                self.last_x = None

            def __call__(self, x):
                self.n_calls += 1
                self.last_x = x

        class CallbackNewSyntax:
            def __init__(self):
                self.n_calls = 0

            def __call__(self, intermediate_result):
                assert isinstance(intermediate_result, OptimizeResult)
                self.n_calls += 1

        callback = Callback()
        callback_new_syntax = CallbackNewSyntax()

        # Minimize with method='COBYLA'
        cons = (NonlinearConstraint(self.con1, 0, np.inf),
                {'type': 'ineq', 'fun': self.con2})
        sol = minimize(self.fun, self.x0, method='cobyla', constraints=cons,
                       callback=callback, options=self.opts)
        sol_new = minimize(self.fun, self.x0, method='cobyla', constraints=cons,
                       callback=callback_new_syntax, options=self.opts)
        assert_allclose(sol.x, self.solution, atol=1e-4)
        assert sol.success, sol.message
        assert sol.maxcv < 1e-5, sol
        assert sol.nfev < 70, sol
        assert sol.fun < self.fun(self.solution) + 1e-3, sol
        assert_array_almost_equal(
            sol.x,
            callback.last_x,
            decimal=5,
            err_msg="Last design vector sent to the callback is not equal to"
                 " returned value.",
        )
        assert sol_new.success, sol_new.message
        assert sol.fun == sol_new.fun
        assert sol.maxcv == sol_new.maxcv
        assert sol.nfev == sol_new.nfev
        assert callback.n_calls == callback_new_syntax.n_calls, \
            "Callback is not called the same amount of times for old and new syntax."

    def test_minimize_constraint_violation(self):
        # We set up conflicting constraints so that the algorithm will be
        # guaranteed to end up with maxcv > 0.
        cons = ({'type': 'ineq', 'fun': lambda x: 4 - x},
                {'type': 'ineq', 'fun': lambda x: x - 5})
        sol = minimize(lambda x: x, [0], method='cobyla', constraints=cons,
                       options={'catol': 0.6})
        assert sol.maxcv > 0.1
        assert sol.success
        sol = minimize(lambda x: x, [0], method='cobyla', constraints=cons,
                       options={'catol': 0.4})
        assert sol.maxcv > 0.1
        assert not sol.success

    def test_f_target(self):
        f_target = 250
        sol = minimize(lambda x: x**2, [500], method='cobyla',
                       options={'f_target': f_target})
        assert sol.status == 1
        assert sol.success
        assert sol.fun <= f_target

    def test_minimize_linear_constraints(self):
        constraints = LinearConstraint([1.0, 1.0], 1.0, 1.0)
        sol = minimize(
            self.fun,
            self.x0,
            method='cobyla',
            constraints=constraints,
            options=self.opts,
        )
        solution = [(4 - np.sqrt(7)) / 3, (np.sqrt(7) - 1) / 3]
        assert_allclose(sol.x, solution, atol=1e-4)
        assert sol.success, sol.message
        assert sol.maxcv < 1e-8, sol
        assert sol.nfev <= 100, sol
        assert sol.fun < self.fun(solution) + 1e-3, sol


def test_vector_constraints():
    # test that fmin_cobyla and minimize can take a combination
    # of constraints, some returning a number and others an array
    def fun(x):
        return (x[0] - 1)**2 + (x[1] - 2.5)**2

    def fmin(x):
        return fun(x) - 1

    def cons1(x):
        a = np.array([[1, -2, 2], [-1, -2, 6], [-1, 2, 2]])
        return np.array([a[i, 0] * x[0] + a[i, 1] * x[1] +
                         a[i, 2] for i in range(len(a))])

    def cons2(x):
        return x     # identity, acts as bounds x > 0

    x0 = np.array([2, 0])
    cons_list = [fun, cons1, cons2]

    xsol = [1.4, 1.7]
    fsol = 0.8

    # testing fmin_cobyla
    sol = fmin_cobyla(fun, x0, cons_list, rhoend=1e-5)
    assert_allclose(sol, xsol, atol=1e-4)

    sol = fmin_cobyla(fun, x0, fmin, rhoend=1e-5)
    assert_allclose(fun(sol), 1, atol=1e-4)

    # testing minimize
    constraints = [{'type': 'ineq', 'fun': cons} for cons in cons_list]
    sol = minimize(fun, x0, constraints=constraints, tol=1e-5)
    assert_allclose(sol.x, xsol, atol=1e-4)
    assert sol.success, sol.message
    assert_allclose(sol.fun, fsol, atol=1e-4)

    constraints = {'type': 'ineq', 'fun': fmin}
    sol = minimize(fun, x0, constraints=constraints, tol=1e-5)
    assert_allclose(sol.fun, 1, atol=1e-4)


class TestBounds:
    # Test cobyla support for bounds (only when used via `minimize`)
    # Invalid bounds is tested in
    # test_optimize.TestOptimizeSimple.test_minimize_invalid_bounds

    def test_basic(self):
        def f(x):
            return np.sum(x**2)

        lb = [-1, None, 1, None, -0.5]
        ub = [-0.5, -0.5, None, None, -0.5]
        bounds = [(a, b) for a, b in zip(lb, ub)]
        # these are converted to Bounds internally

        res = minimize(f, x0=[1, 2, 3, 4, 5], method='cobyla', bounds=bounds)
        ref = [-0.5, -0.5, 1, 0, -0.5]
        assert res.success
        assert_allclose(res.x, ref, atol=1e-3)

    def test_unbounded(self):
        def f(x):
            return np.sum(x**2)

        bounds = Bounds([-np.inf, -np.inf], [np.inf, np.inf])
        res = minimize(f, x0=[1, 2], method='cobyla', bounds=bounds)
        assert res.success
        assert_allclose(res.x, 0, atol=1e-3)

        bounds = Bounds([1, -np.inf], [np.inf, np.inf])
        res = minimize(f, x0=[1, 2], method='cobyla', bounds=bounds)
        assert res.success
        assert_allclose(res.x, [1, 0], atol=1e-3)
