from scipy._lib._array_api import np_compat, array_namespace

from functools import cached_property

from ._base import NestedFixedRule
from ._gauss_legendre import GaussLegendreQuadrature


class GaussKronrodQuadrature(NestedFixedRule):
    """
    Gauss-Kronrod quadrature.

    Gauss-Kronrod rules consist of two quadrature rules, one higher-order and one
    lower-order. The higher-order rule is used as the estimate of the integral and the
    difference between them is used as an estimate for the error.

    Gauss-Kronrod is a 1D rule. To use it for multidimensional integrals, it will be
    necessary to use ProductNestedFixed and multiple Gauss-Kronrod rules. See Examples.

    For n-node Gauss-Kronrod, the lower-order rule has ``n//2`` nodes, which are the
    ordinary Gauss-Legendre nodes with corresponding weights. The higher-order rule has
    ``n`` nodes, ``n//2`` of which are the same as the lower-order rule and the
    remaining nodes are the Kronrod extension of those nodes.

    Parameters
    ----------
    npoints : int
        Number of nodes for the higher-order rule.

    xp : array_namespace, optional
        The namespace for the node and weight arrays. Default is None, where NumPy is
        used.

    Attributes
    ----------
    lower : Rule
        Lower-order rule.

    References
    ----------
    .. [1] R. Piessens, E. de Doncker, Quadpack: A Subroutine Package for Automatic
        Integration, files: dqk21.f, dqk15.f (1983).

    Examples
    --------
    Evaluate a 1D integral. Note in this example that ``f`` returns an array, so the
    estimates will also be arrays, despite the fact that this is a 1D problem.

    >>> import numpy as np
    >>> from scipy.integrate import cubature
    >>> from scipy.integrate._rules import GaussKronrodQuadrature
    >>> def f(x):
    ...     return np.cos(x)
    >>> rule = GaussKronrodQuadrature(21) # Use 21-point GaussKronrod
    >>> a, b = np.array([0]), np.array([1])
    >>> rule.estimate(f, a, b) # True value sin(1), approximately 0.84147
     array([0.84147098])
    >>> rule.estimate_error(f, a, b)
     array([1.11022302e-16])

    Evaluate a 2D integral. Note that in this example ``f`` returns a float, so the
    estimates will also be floats.

    >>> import numpy as np
    >>> from scipy.integrate import cubature
    >>> from scipy.integrate._rules import (
    ...     ProductNestedFixed, GaussKronrodQuadrature
    ... )
    >>> def f(x):
    ...     # f(x) = cos(x_1) + cos(x_2)
    ...     return np.sum(np.cos(x), axis=-1)
    >>> rule = ProductNestedFixed(
    ...     [GaussKronrodQuadrature(15), GaussKronrodQuadrature(15)]
    ... ) # Use 15-point Gauss-Kronrod
    >>> a, b = np.array([0, 0]), np.array([1, 1])
    >>> rule.estimate(f, a, b) # True value 2*sin(1), approximately 1.6829
     np.float64(1.682941969615793)
    >>> rule.estimate_error(f, a, b)
     np.float64(2.220446049250313e-16)
    """

    def __init__(self, npoints, xp=None):
        # TODO: nodes and weights are currently hard-coded for values 15 and 21, but in
        # the future it would be best to compute the Kronrod extension of the lower rule
        if npoints != 15 and npoints != 21:
            raise NotImplementedError("Gauss-Kronrod quadrature is currently only"
                                      "supported for 15 or 21 nodes")

        self.npoints = npoints

        if xp is None:
            xp = np_compat

        self.xp = array_namespace(xp.empty(0))

        self.gauss = GaussLegendreQuadrature(npoints//2, xp=self.xp)

    @cached_property
    def nodes_and_weights(self):
        # These values are from QUADPACK's `dqk21.f` and `dqk15.f` (1983).
        if self.npoints == 21:
            nodes = self.xp.asarray(
                [
                    0.995657163025808080735527280689003,
                    0.973906528517171720077964012084452,
                    0.930157491355708226001207180059508,
                    0.865063366688984510732096688423493,
                    0.780817726586416897063717578345042,
                    0.679409568299024406234327365114874,
                    0.562757134668604683339000099272694,
                    0.433395394129247190799265943165784,
                    0.294392862701460198131126603103866,
                    0.148874338981631210884826001129720,
                    0,
                    -0.148874338981631210884826001129720,
                    -0.294392862701460198131126603103866,
                    -0.433395394129247190799265943165784,
                    -0.562757134668604683339000099272694,
                    -0.679409568299024406234327365114874,
                    -0.780817726586416897063717578345042,
                    -0.865063366688984510732096688423493,
                    -0.930157491355708226001207180059508,
                    -0.973906528517171720077964012084452,
                    -0.995657163025808080735527280689003,
                ],
                dtype=self.xp.float64,
            )

            weights = self.xp.asarray(
                [
                    0.011694638867371874278064396062192,
                    0.032558162307964727478818972459390,
                    0.054755896574351996031381300244580,
                    0.075039674810919952767043140916190,
                    0.093125454583697605535065465083366,
                    0.109387158802297641899210590325805,
                    0.123491976262065851077958109831074,
                    0.134709217311473325928054001771707,
                    0.142775938577060080797094273138717,
                    0.147739104901338491374841515972068,
                    0.149445554002916905664936468389821,
                    0.147739104901338491374841515972068,
                    0.142775938577060080797094273138717,
                    0.134709217311473325928054001771707,
                    0.123491976262065851077958109831074,
                    0.109387158802297641899210590325805,
                    0.093125454583697605535065465083366,
                    0.075039674810919952767043140916190,
                    0.054755896574351996031381300244580,
                    0.032558162307964727478818972459390,
                    0.011694638867371874278064396062192,
                ],
                dtype=self.xp.float64,
            )
        elif self.npoints == 15:
            nodes = self.xp.asarray(
                [
                    0.991455371120812639206854697526329,
                    0.949107912342758524526189684047851,
                    0.864864423359769072789712788640926,
                    0.741531185599394439863864773280788,
                    0.586087235467691130294144838258730,
                    0.405845151377397166906606412076961,
                    0.207784955007898467600689403773245,
                    0.000000000000000000000000000000000,
                    -0.207784955007898467600689403773245,
                    -0.405845151377397166906606412076961,
                    -0.586087235467691130294144838258730,
                    -0.741531185599394439863864773280788,
                    -0.864864423359769072789712788640926,
                    -0.949107912342758524526189684047851,
                    -0.991455371120812639206854697526329,
                ],
                dtype=self.xp.float64,
            )

            weights = self.xp.asarray(
                [
                    0.022935322010529224963732008058970,
                    0.063092092629978553290700663189204,
                    0.104790010322250183839876322541518,
                    0.140653259715525918745189590510238,
                    0.169004726639267902826583426598550,
                    0.190350578064785409913256402421014,
                    0.204432940075298892414161999234649,
                    0.209482141084727828012999174891714,
                    0.204432940075298892414161999234649,
                    0.190350578064785409913256402421014,
                    0.169004726639267902826583426598550,
                    0.140653259715525918745189590510238,
                    0.104790010322250183839876322541518,
                    0.063092092629978553290700663189204,
                    0.022935322010529224963732008058970,
                ],
                dtype=self.xp.float64,
            )

        return nodes, weights

    @property
    def lower_nodes_and_weights(self):
        return self.gauss.nodes_and_weights
