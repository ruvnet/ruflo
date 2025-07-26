import pytest
import numpy as np
from scipy.optimize import minimize, NonlinearConstraint, rosen, rosen_der


# Ignore this warning about inefficient use of Hessians
# The bug only shows up with the default HUS
@pytest.mark.filterwarnings(
    "ignore:delta_grad == 0.0. Check if the approximated function is linear."
)
def test_gh21193():
    # Test that nested minimization does not share Hessian objects
    def identity(x):
        return x[0]
    def identity_jac(x):
        a = np.zeros(len(x))
        a[0] = 1
        return a
    constraint1 = NonlinearConstraint(identity, 0, 0, identity_jac)
    constraint2 = NonlinearConstraint(identity, 0, 0, identity_jac)

    # The default HUS for each should be distinct
    assert constraint1.hess is not constraint2.hess

    _ = minimize(
        lambda x: minimize(
            rosen,
            x[1:],
            jac=rosen_der,
            constraints=constraint1,
            method="trust-constr",
            options={'maxiter': 2},
        ).fun,
        [1, 0, 0],
        constraints=constraint2,
        method="trust-constr",
        options={'maxiter': 2},
    )
    # This test doesn't check that the output is correct, just that it doesn't crash
