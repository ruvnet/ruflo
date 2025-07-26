import numpy as np
import pytest
import threading
from numpy.testing import assert_allclose, assert_equal

from scipy.optimize import (
    Bounds,
    LinearConstraint,
    NonlinearConstraint,
    OptimizeResult,
    minimize,
)


class TestCOBYQA:

    def setup_method(self):
        self.x0 = [4.95, 0.66]
        self.options = {'maxfev': 100}

    @staticmethod
    def fun(x, c=1.0):
        return x[0]**2 + c * abs(x[1])**3

    @staticmethod
    def con(x):
        return x[0]**2 + x[1]**2 - 25.0

    def test_minimize_simple(self):
        class Callback:
            def __init__(self):
                self.lock = threading.Lock()
                self.n_calls = 0

            def __call__(self, x):
                assert isinstance(x, np.ndarray)
                with self.lock:
                    self.n_calls += 1

        class CallbackNewSyntax:
            def __init__(self):
                self.lock = threading.Lock()
                self.n_calls = 0

            def __call__(self, intermediate_result):
                assert isinstance(intermediate_result, OptimizeResult)
                with self.lock:
                    self.n_calls += 1

        x0 = [4.95, 0.66]
        callback = Callback()
        callback_new_syntax = CallbackNewSyntax()

        # Minimize with method='cobyqa'.
        constraints = NonlinearConstraint(self.con, 0.0, 0.0)
        sol = minimize(
            self.fun,
            x0,
            method='cobyqa',
            constraints=constraints,
            callback=callback,
            options=self.options,
        )
        sol_new = minimize(
            self.fun,
            x0,
            method='cobyqa',
            constraints=constraints,
            callback=callback_new_syntax,
            options=self.options,
        )
        solution = [np.sqrt(25.0 - 4.0 / 9.0), 2.0 / 3.0]
        assert_allclose(sol.x, solution, atol=1e-4)
        assert sol.success, sol.message
        assert sol.maxcv < 1e-8, sol
        assert sol.nfev <= 100, sol
        assert sol.fun < self.fun(solution) + 1e-3, sol
        assert sol.nfev == callback.n_calls, \
            "Callback is not called exactly once for every function eval."
        assert_equal(sol.x, sol_new.x)
        assert sol_new.success, sol_new.message
        assert sol.fun == sol_new.fun
        assert sol.maxcv == sol_new.maxcv
        assert sol.nfev == sol_new.nfev
        assert sol.nit == sol_new.nit
        assert sol_new.nfev == callback_new_syntax.n_calls, \
            "Callback is not called exactly once for every function eval."

    def test_minimize_bounds(self):
        def fun_check_bounds(x):
            assert np.all(bounds.lb <= x) and np.all(x <= bounds.ub)
            return self.fun(x)

        # Case where the bounds are not active at the solution.
        bounds = Bounds([4.5, 0.6], [5.0, 0.7])
        constraints = NonlinearConstraint(self.con, 0.0, 0.0)
        sol = minimize(
            fun_check_bounds,
            self.x0,
            method='cobyqa',
            bounds=bounds,
            constraints=constraints,
            options=self.options,
        )
        solution = [np.sqrt(25.0 - 4.0 / 9.0), 2.0 / 3.0]
        assert_allclose(sol.x, solution, atol=1e-4)
        assert sol.success, sol.message
        assert sol.maxcv < 1e-8, sol
        assert np.all(bounds.lb <= sol.x) and np.all(sol.x <= bounds.ub), sol
        assert sol.nfev <= 100, sol
        assert sol.fun < self.fun(solution) + 1e-3, sol

        # Case where the bounds are active at the solution.
        bounds = Bounds([5.0, 0.6], [5.5, 0.65])
        sol = minimize(
            fun_check_bounds,
            self.x0,
            method='cobyqa',
            bounds=bounds,
            constraints=constraints,
            options=self.options,
        )
        assert not sol.success, sol.message
        assert sol.maxcv > 0.35, sol
        assert np.all(bounds.lb <= sol.x) and np.all(sol.x <= bounds.ub), sol
        assert sol.nfev <= 100, sol

    def test_minimize_linear_constraints(self):
        constraints = LinearConstraint([1.0, 1.0], 1.0, 1.0)
        sol = minimize(
            self.fun,
            self.x0,
            method='cobyqa',
            constraints=constraints,
            options=self.options,
        )
        solution = [(4 - np.sqrt(7)) / 3, (np.sqrt(7) - 1) / 3]
        assert_allclose(sol.x, solution, atol=1e-4)
        assert sol.success, sol.message
        assert sol.maxcv < 1e-8, sol
        assert sol.nfev <= 100, sol
        assert sol.fun < self.fun(solution) + 1e-3, sol

    def test_minimize_args(self):
        constraints = NonlinearConstraint(self.con, 0.0, 0.0)
        sol = minimize(
            self.fun,
            self.x0,
            args=(2.0,),
            method='cobyqa',
            constraints=constraints,
            options=self.options,
        )
        solution = [np.sqrt(25.0 - 4.0 / 36.0), 2.0 / 6.0]
        assert_allclose(sol.x, solution, atol=1e-4)
        assert sol.success, sol.message
        assert sol.maxcv < 1e-8, sol
        assert sol.nfev <= 100, sol
        assert sol.fun < self.fun(solution, 2.0) + 1e-3, sol

    def test_minimize_array(self):
        def fun_array(x, dim):
            f = np.array(self.fun(x))
            return np.reshape(f, (1,) * dim)

        # The argument fun can return an array with a single element.
        bounds = Bounds([4.5, 0.6], [5.0, 0.7])
        constraints = NonlinearConstraint(self.con, 0.0, 0.0)
        sol = minimize(
            self.fun,
            self.x0,
            method='cobyqa',
            bounds=bounds,
            constraints=constraints,
            options=self.options,
        )
        for dim in [0, 1, 2]:
            sol_array = minimize(
                fun_array,
                self.x0,
                args=(dim,),
                method='cobyqa',
                bounds=bounds,
                constraints=constraints,
                options=self.options,
            )
            assert_equal(sol.x, sol_array.x)
            assert sol_array.success, sol_array.message
            assert sol.fun == sol_array.fun
            assert sol.maxcv == sol_array.maxcv
            assert sol.nfev == sol_array.nfev
            assert sol.nit == sol_array.nit

        # The argument fun cannot return an array with more than one element.
        with pytest.raises(TypeError):
            minimize(
                lambda x: np.array([self.fun(x), self.fun(x)]),
                self.x0,
                method='cobyqa',
                bounds=bounds,
                constraints=constraints,
                options=self.options,
            )

    def test_minimize_maxfev(self):
        constraints = NonlinearConstraint(self.con, 0.0, 0.0)
        options = {'maxfev': 2}
        sol = minimize(
            self.fun,
            self.x0,
            method='cobyqa',
            constraints=constraints,
            options=options,
        )
        assert not sol.success, sol.message
        assert sol.nfev <= 2, sol

    def test_minimize_maxiter(self):
        constraints = NonlinearConstraint(self.con, 0.0, 0.0)
        options = {'maxiter': 2}
        sol = minimize(
            self.fun,
            self.x0,
            method='cobyqa',
            constraints=constraints,
            options=options,
        )
        assert not sol.success, sol.message
        assert sol.nit <= 2, sol

    def test_minimize_f_target(self):
        constraints = NonlinearConstraint(self.con, 0.0, 0.0)
        sol_ref = minimize(
            self.fun,
            self.x0,
            method='cobyqa',
            constraints=constraints,
            options=self.options,
        )
        options = dict(self.options)
        options['f_target'] = sol_ref.fun
        sol = minimize(
            self.fun,
            self.x0,
            method='cobyqa',
            constraints=constraints,
            options=options,
        )
        assert sol.success, sol.message
        assert sol.maxcv < 1e-8, sol
        assert sol.nfev <= sol_ref.nfev, sol
        assert sol.fun <= sol_ref.fun, sol
