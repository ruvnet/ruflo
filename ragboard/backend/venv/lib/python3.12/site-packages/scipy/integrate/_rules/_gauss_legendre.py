from scipy._lib._array_api import array_namespace, np_compat

from functools import cached_property

from scipy.special import roots_legendre

from ._base import FixedRule


class GaussLegendreQuadrature(FixedRule):
    """
    Gauss-Legendre quadrature.

    Parameters
    ----------
    npoints : int
        Number of nodes for the higher-order rule.

    xp : array_namespace, optional
        The namespace for the node and weight arrays. Default is None, where NumPy is
        used.

    Examples
    --------
    Evaluate a 1D integral. Note in this example that ``f`` returns an array, so the
    estimates will also be arrays.

    >>> import numpy as np
    >>> from scipy.integrate import cubature
    >>> from scipy.integrate._rules import GaussLegendreQuadrature
    >>> def f(x):
    ...     return np.cos(x)
    >>> rule = GaussLegendreQuadrature(21) # Use 21-point GaussLegendre
    >>> a, b = np.array([0]), np.array([1])
    >>> rule.estimate(f, a, b) # True value sin(1), approximately 0.84147
     array([0.84147098])
    >>> rule.estimate_error(f, a, b)
     array([1.11022302e-16])
    """

    def __init__(self, npoints, xp=None):
        if npoints < 2:
            raise ValueError(
                "At least 2 nodes required for Gauss-Legendre cubature"
            )

        self.npoints = npoints

        if xp is None:
            xp = np_compat

        self.xp = array_namespace(xp.empty(0))

    @cached_property
    def nodes_and_weights(self):
        # TODO: current converting to/from numpy
        nodes, weights = roots_legendre(self.npoints)

        return (
            self.xp.asarray(nodes, dtype=self.xp.float64),
            self.xp.asarray(weights, dtype=self.xp.float64)
        )
