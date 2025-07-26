from scipy._lib._array_api import array_namespace, xp_size

from functools import cached_property


class Rule:
    """
    Base class for numerical integration algorithms (cubatures).

    Finds an estimate for the integral of ``f`` over the region described by two arrays
    ``a`` and ``b`` via `estimate`, and find an estimate for the error of this
    approximation via `estimate_error`.

    If a subclass does not implement its own `estimate_error`, then it will use a
    default error estimate based on the difference between the estimate over the whole
    region and the sum of estimates over that region divided into ``2^ndim`` subregions.

    See Also
    --------
    FixedRule

    Examples
    --------
    In the following, a custom rule is created which uses 3D Genz-Malik cubature for
    the estimate of the integral, and the difference between this estimate and a less
    accurate estimate using 5-node Gauss-Legendre quadrature as an estimate for the
    error.

    >>> import numpy as np
    >>> from scipy.integrate import cubature
    >>> from scipy.integrate._rules import (
    ...     Rule, ProductNestedFixed, GenzMalikCubature, GaussLegendreQuadrature
    ... )
    >>> def f(x, r, alphas):
    ...     # f(x) = cos(2*pi*r + alpha @ x)
    ...     # Need to allow r and alphas to be arbitrary shape
    ...     npoints, ndim = x.shape[0], x.shape[-1]
    ...     alphas_reshaped = alphas[np.newaxis, :]
    ...     x_reshaped = x.reshape(npoints, *([1]*(len(alphas.shape) - 1)), ndim)
    ...     return np.cos(2*np.pi*r + np.sum(alphas_reshaped * x_reshaped, axis=-1))
    >>> genz = GenzMalikCubature(ndim=3)
    >>> gauss = GaussKronrodQuadrature(npoints=21)
    >>> # Gauss-Kronrod is 1D, so we find the 3D product rule:
    >>> gauss_3d = ProductNestedFixed([gauss, gauss, gauss])
    >>> class CustomRule(Rule):
    ...     def estimate(self, f, a, b, args=()):
    ...         return genz.estimate(f, a, b, args)
    ...     def estimate_error(self, f, a, b, args=()):
    ...         return np.abs(
    ...             genz.estimate(f, a, b, args)
    ...             - gauss_3d.estimate(f, a, b, args)
    ...         )
    >>> rng = np.random.default_rng()
    >>> res = cubature(
    ...     f=f,
    ...     a=np.array([0, 0, 0]),
    ...     b=np.array([1, 1, 1]),
    ...     rule=CustomRule(),
    ...     args=(rng.random((2,)), rng.random((3, 2, 3)))
    ... )
    >>> res.estimate
     array([[-0.95179502,  0.12444608],
            [-0.96247411,  0.60866385],
            [-0.97360014,  0.25515587]])
    """

    def estimate(self, f, a, b, args=()):
        r"""
        Calculate estimate of integral of `f` in rectangular region described by
        corners `a` and ``b``.

        Parameters
        ----------
        f : callable
            Function to integrate. `f` must have the signature::
                f(x : ndarray, \*args) -> ndarray

            `f` should accept arrays ``x`` of shape::
                (npoints, ndim)

            and output arrays of shape::
                (npoints, output_dim_1, ..., output_dim_n)

            In this case, `estimate` will return arrays of shape::
                (output_dim_1, ..., output_dim_n)
        a, b : ndarray
            Lower and upper limits of integration as rank-1 arrays specifying the left
            and right endpoints of the intervals being integrated over. Infinite limits
            are currently not supported.
        args : tuple, optional
            Additional positional args passed to ``f``, if any.

        Returns
        -------
        est : ndarray
            Result of estimation. If `f` returns arrays of shape ``(npoints,
            output_dim_1, ..., output_dim_n)``, then `est` will be of shape
            ``(output_dim_1, ..., output_dim_n)``.
        """
        raise NotImplementedError

    def estimate_error(self, f, a, b, args=()):
        r"""
        Estimate the error of the approximation for the integral of `f` in rectangular
        region described by corners `a` and `b`.

        If a subclass does not override this method, then a default error estimator is
        used. This estimates the error as ``|est - refined_est|`` where ``est`` is
        ``estimate(f, a, b)`` and ``refined_est`` is the sum of
        ``estimate(f, a_k, b_k)`` where ``a_k, b_k`` are the coordinates of each
        subregion of the region described by ``a`` and ``b``. In the 1D case, this
        is equivalent to comparing the integral over an entire interval ``[a, b]`` to
        the sum of the integrals over the left and right subintervals, ``[a, (a+b)/2]``
        and ``[(a+b)/2, b]``.

        Parameters
        ----------
        f : callable
            Function to estimate error for. `f` must have the signature::
                f(x : ndarray, \*args) -> ndarray

            `f` should accept arrays `x` of shape::
                (npoints, ndim)

            and output arrays of shape::
                (npoints, output_dim_1, ..., output_dim_n)

            In this case, `estimate` will return arrays of shape::
                (output_dim_1, ..., output_dim_n)
        a, b : ndarray
            Lower and upper limits of integration as rank-1 arrays specifying the left
            and right endpoints of the intervals being integrated over. Infinite limits
            are currently not supported.
        args : tuple, optional
            Additional positional args passed to `f`, if any.

        Returns
        -------
        err_est : ndarray
            Result of error estimation. If `f` returns arrays of shape
            ``(npoints, output_dim_1, ..., output_dim_n)``, then `est` will be
            of shape ``(output_dim_1, ..., output_dim_n)``.
        """

        est = self.estimate(f, a, b, args)
        refined_est = 0

        for a_k, b_k in _split_subregion(a, b):
            refined_est += self.estimate(f, a_k, b_k, args)

        return self.xp.abs(est - refined_est)


class FixedRule(Rule):
    """
    A rule implemented as the weighted sum of function evaluations at fixed nodes.

    Attributes
    ----------
    nodes_and_weights : (ndarray, ndarray)
        A tuple ``(nodes, weights)`` of nodes at which to evaluate ``f`` and the
        corresponding weights. ``nodes`` should be of shape ``(num_nodes,)`` for 1D
        cubature rules (quadratures) and more generally for N-D cubature rules, it
        should be of shape ``(num_nodes, ndim)``. ``weights`` should be of shape
        ``(num_nodes,)``. The nodes and weights should be for integrals over
        :math:`[-1, 1]^n`.

    See Also
    --------
    GaussLegendreQuadrature, GaussKronrodQuadrature, GenzMalikCubature

    Examples
    --------

    Implementing Simpson's 1/3 rule:

    >>> import numpy as np
    >>> from scipy.integrate._rules import FixedRule
    >>> class SimpsonsQuad(FixedRule):
    ...     @property
    ...     def nodes_and_weights(self):
    ...         nodes = np.array([-1, 0, 1])
    ...         weights = np.array([1/3, 4/3, 1/3])
    ...         return (nodes, weights)
    >>> rule = SimpsonsQuad()
    >>> rule.estimate(
    ...     f=lambda x: x**2,
    ...     a=np.array([0]),
    ...     b=np.array([1]),
    ... )
     [0.3333333]
    """

    def __init__(self):
        self.xp = None

    @property
    def nodes_and_weights(self):
        raise NotImplementedError

    def estimate(self, f, a, b, args=()):
        r"""
        Calculate estimate of integral of `f` in rectangular region described by
        corners `a` and `b` as ``sum(weights * f(nodes))``.

        Nodes and weights will automatically be adjusted from calculating integrals over
        :math:`[-1, 1]^n` to :math:`[a, b]^n`.

        Parameters
        ----------
        f : callable
            Function to integrate. `f` must have the signature::
                f(x : ndarray, \*args) -> ndarray

            `f` should accept arrays `x` of shape::
                (npoints, ndim)

            and output arrays of shape::
                (npoints, output_dim_1, ..., output_dim_n)

            In this case, `estimate` will return arrays of shape::
                (output_dim_1, ..., output_dim_n)
        a, b : ndarray
            Lower and upper limits of integration as rank-1 arrays specifying the left
            and right endpoints of the intervals being integrated over. Infinite limits
            are currently not supported.
        args : tuple, optional
            Additional positional args passed to `f`, if any.

        Returns
        -------
        est : ndarray
            Result of estimation. If `f` returns arrays of shape ``(npoints,
            output_dim_1, ..., output_dim_n)``, then `est` will be of shape
            ``(output_dim_1, ..., output_dim_n)``.
        """
        nodes, weights = self.nodes_and_weights

        if self.xp is None:
            self.xp = array_namespace(nodes)

        return _apply_fixed_rule(f, a, b, nodes, weights, args, self.xp)


class NestedFixedRule(FixedRule):
    r"""
    A cubature rule with error estimate given by the difference between two underlying
    fixed rules.

    If constructed as ``NestedFixedRule(higher, lower)``, this will use::

        estimate(f, a, b) := higher.estimate(f, a, b)
        estimate_error(f, a, b) := \|higher.estimate(f, a, b) - lower.estimate(f, a, b)|

    (where the absolute value is taken elementwise).

    Attributes
    ----------
    higher : Rule
        Higher accuracy rule.

    lower : Rule
        Lower accuracy rule.

    See Also
    --------
    GaussKronrodQuadrature

    Examples
    --------

    >>> from scipy.integrate import cubature
    >>> from scipy.integrate._rules import (
    ...     GaussLegendreQuadrature, NestedFixedRule, ProductNestedFixed
    ... )
    >>> higher = GaussLegendreQuadrature(10)
    >>> lower = GaussLegendreQuadrature(5)
    >>> rule = NestedFixedRule(
    ...     higher,
    ...     lower
    ... )
    >>> rule_2d = ProductNestedFixed([rule, rule])
    """

    def __init__(self, higher, lower):
        self.higher = higher
        self.lower = lower
        self.xp = None

    @property
    def nodes_and_weights(self):
        if self.higher is not None:
            return self.higher.nodes_and_weights
        else:
            raise NotImplementedError

    @property
    def lower_nodes_and_weights(self):
        if self.lower is not None:
            return self.lower.nodes_and_weights
        else:
            raise NotImplementedError

    def estimate_error(self, f, a, b, args=()):
        r"""
        Estimate the error of the approximation for the integral of `f` in rectangular
        region described by corners `a` and `b`.

        Parameters
        ----------
        f : callable
            Function to estimate error for. `f` must have the signature::
                f(x : ndarray, \*args) -> ndarray

            `f` should accept arrays `x` of shape::
                (npoints, ndim)

            and output arrays of shape::
                (npoints, output_dim_1, ..., output_dim_n)

            In this case, `estimate` will return arrays of shape::
                (output_dim_1, ..., output_dim_n)
        a, b : ndarray
            Lower and upper limits of integration as rank-1 arrays specifying the left
            and right endpoints of the intervals being integrated over. Infinite limits
            are currently not supported.
        args : tuple, optional
            Additional positional args passed to `f`, if any.

        Returns
        -------
        err_est : ndarray
            Result of error estimation. If `f` returns arrays of shape
            ``(npoints, output_dim_1, ..., output_dim_n)``, then `est` will be
            of shape ``(output_dim_1, ..., output_dim_n)``.
        """

        nodes, weights = self.nodes_and_weights
        lower_nodes, lower_weights = self.lower_nodes_and_weights

        if self.xp is None:
            self.xp = array_namespace(nodes)

        error_nodes = self.xp.concat([nodes, lower_nodes], axis=0)
        error_weights = self.xp.concat([weights, -lower_weights], axis=0)

        return self.xp.abs(
            _apply_fixed_rule(f, a, b, error_nodes, error_weights, args, self.xp)
        )


class ProductNestedFixed(NestedFixedRule):
    """
    Find the n-dimensional cubature rule constructed from the Cartesian product of 1-D
    `NestedFixedRule` quadrature rules.

    Given a list of N 1-dimensional quadrature rules which support error estimation
    using NestedFixedRule, this will find the N-dimensional cubature rule obtained by
    taking the Cartesian product of their nodes, and estimating the error by taking the
    difference with a lower-accuracy N-dimensional cubature rule obtained using the
    ``.lower_nodes_and_weights`` rule in each of the base 1-dimensional rules.

    Parameters
    ----------
    base_rules : list of NestedFixedRule
        List of base 1-dimensional `NestedFixedRule` quadrature rules.

    Attributes
    ----------
    base_rules : list of NestedFixedRule
        List of base 1-dimensional `NestedFixedRule` qudarature rules.

    Examples
    --------

    Evaluate a 2D integral by taking the product of two 1D rules:

    >>> import numpy as np
    >>> from scipy.integrate import cubature
    >>> from scipy.integrate._rules import (
    ...  ProductNestedFixed, GaussKronrodQuadrature
    ... )
    >>> def f(x):
    ...     # f(x) = cos(x_1) + cos(x_2)
    ...     return np.sum(np.cos(x), axis=-1)
    >>> rule = ProductNestedFixed(
    ...     [GaussKronrodQuadrature(15), GaussKronrodQuadrature(15)]
    ... ) # Use 15-point Gauss-Kronrod, which implements NestedFixedRule
    >>> a, b = np.array([0, 0]), np.array([1, 1])
    >>> rule.estimate(f, a, b) # True value 2*sin(1), approximately 1.6829
     np.float64(1.682941969615793)
    >>> rule.estimate_error(f, a, b)
     np.float64(2.220446049250313e-16)
    """

    def __init__(self, base_rules):
        for rule in base_rules:
            if not isinstance(rule, NestedFixedRule):
                raise ValueError("base rules for product need to be instance of"
                                 "NestedFixedRule")

        self.base_rules = base_rules
        self.xp = None

    @cached_property
    def nodes_and_weights(self):
        nodes = _cartesian_product(
            [rule.nodes_and_weights[0] for rule in self.base_rules]
        )

        if self.xp is None:
            self.xp = array_namespace(nodes)

        weights = self.xp.prod(
            _cartesian_product(
                [rule.nodes_and_weights[1] for rule in self.base_rules]
            ),
            axis=-1,
        )

        return nodes, weights

    @cached_property
    def lower_nodes_and_weights(self):
        nodes = _cartesian_product(
            [cubature.lower_nodes_and_weights[0] for cubature in self.base_rules]
        )

        if self.xp is None:
            self.xp = array_namespace(nodes)

        weights = self.xp.prod(
            _cartesian_product(
                [cubature.lower_nodes_and_weights[1] for cubature in self.base_rules]
            ),
            axis=-1,
        )

        return nodes, weights


def _cartesian_product(arrays):
    xp = array_namespace(*arrays)

    arrays_ix = xp.meshgrid(*arrays, indexing='ij')
    result = xp.reshape(xp.stack(arrays_ix, axis=-1), (-1, len(arrays)))

    return result


def _split_subregion(a, b, xp, split_at=None):
    """
    Given the coordinates of a region like a=[0, 0] and b=[1, 1], yield the coordinates
    of all subregions, which in this case would be::

        ([0, 0], [1/2, 1/2]),
        ([0, 1/2], [1/2, 1]),
        ([1/2, 0], [1, 1/2]),
        ([1/2, 1/2], [1, 1])
    """
    xp = array_namespace(a, b)

    if split_at is None:
        split_at = (a + b) / 2

    left = [xp.stack((a[i], split_at[i])) for i in range(a.shape[0])]
    right = [xp.stack((split_at[i], b[i])) for i in range(b.shape[0])]

    a_sub = _cartesian_product(left)
    b_sub = _cartesian_product(right)

    for i in range(a_sub.shape[0]):
        yield a_sub[i, ...], b_sub[i, ...]


def _apply_fixed_rule(f, a, b, orig_nodes, orig_weights, args, xp):
    # Downcast nodes and weights to common dtype of a and b
    result_dtype = a.dtype
    orig_nodes = xp.astype(orig_nodes, result_dtype)
    orig_weights = xp.astype(orig_weights, result_dtype)

    # Ensure orig_nodes are at least 2D, since 1D cubature methods can return arrays of
    # shape (npoints,) rather than (npoints, 1)
    if orig_nodes.ndim == 1:
        orig_nodes = orig_nodes[:, None]

    rule_ndim = orig_nodes.shape[-1]

    a_ndim = xp_size(a)
    b_ndim = xp_size(b)

    if rule_ndim != a_ndim or rule_ndim != b_ndim:
        raise ValueError(f"rule and function are of incompatible dimension, nodes have"
                         f"ndim {rule_ndim}, while limit of integration has ndim"
                         f"a_ndim={a_ndim}, b_ndim={b_ndim}")

    lengths = b - a

    # The underlying rule is for the hypercube [-1, 1]^n.
    #
    # To handle arbitrary regions of integration, it's necessary to apply a linear
    # change of coordinates to map each interval [a[i], b[i]] to [-1, 1].
    nodes = (orig_nodes + 1) * (lengths * 0.5) + a

    # Also need to multiply the weights by a scale factor equal to the determinant
    # of the Jacobian for this coordinate change.
    weight_scale_factor = xp.prod(lengths, dtype=result_dtype) / 2**rule_ndim
    weights = orig_weights * weight_scale_factor

    f_nodes = f(nodes, *args)
    weights_reshaped = xp.reshape(weights, (-1, *([1] * (f_nodes.ndim - 1))))

    # f(nodes) will have shape (num_nodes, output_dim_1, ..., output_dim_n)
    # Summing along the first axis means estimate will shape (output_dim_1, ...,
    # output_dim_n)
    est = xp.sum(weights_reshaped * f_nodes, axis=0, dtype=result_dtype)

    return est
