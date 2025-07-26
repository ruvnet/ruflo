import math
import itertools

from functools import cached_property

from scipy._lib._array_api import array_namespace, np_compat

from scipy.integrate._rules import NestedFixedRule


class GenzMalikCubature(NestedFixedRule):
    """
    Genz-Malik cubature.

    Genz-Malik is only defined for integrals of dimension >= 2.

    Parameters
    ----------
    ndim : int
        The spatial dimension of the integrand.

    xp : array_namespace, optional
        The namespace for the node and weight arrays. Default is None, where NumPy is
        used.

    Attributes
    ----------
    higher : Cubature
        Higher-order rule.

    lower : Cubature
        Lower-order rule.

    References
    ----------
    .. [1] A.C. Genz, A.A. Malik, Remarks on algorithm 006: An adaptive algorithm for
        numerical integration over an N-dimensional rectangular region, Journal of
        Computational and Applied Mathematics, Volume 6, Issue 4, 1980, Pages 295-302,
        ISSN 0377-0427, https://doi.org/10.1016/0771-050X(80)90039-X.

    Examples
    --------
    Evaluate a 3D integral:

    >>> import numpy as np
    >>> from scipy.integrate import cubature
    >>> from scipy.integrate._rules import GenzMalikCubature
    >>> def f(x):
    ...     # f(x) = cos(x_1) + cos(x_2) + cos(x_3)
    ...     return np.sum(np.cos(x), axis=-1)
    >>> rule = GenzMalikCubature(3) # Use 3D Genz-Malik
    >>> a, b = np.array([0, 0, 0]), np.array([1, 1, 1])
    >>> rule.estimate(f, a, b) # True value 3*sin(1), approximately 2.5244
     np.float64(2.5244129547230862)
    >>> rule.estimate_error(f, a, b)
     np.float64(1.378269656626685e-06)
    """

    def __init__(self, ndim, degree=7, lower_degree=5, xp=None):
        if ndim < 2:
            raise ValueError("Genz-Malik cubature is only defined for ndim >= 2")

        if degree != 7 or lower_degree != 5:
            raise NotImplementedError("Genz-Malik cubature is currently only supported"
                                      "for degree=7, lower_degree=5")

        self.ndim = ndim
        self.degree = degree
        self.lower_degree = lower_degree

        if xp is None:
            xp = np_compat

        self.xp = array_namespace(xp.empty(0))

    @cached_property
    def nodes_and_weights(self):
        # TODO: Currently only support for degree 7 Genz-Malik cubature, should aim to
        # support arbitrary degree
        l_2 = math.sqrt(9/70)
        l_3 = math.sqrt(9/10)
        l_4 = math.sqrt(9/10)
        l_5 = math.sqrt(9/19)

        its = itertools.chain(
            [(0,) * self.ndim],
            _distinct_permutations((l_2,) + (0,) * (self.ndim - 1)),
            _distinct_permutations((-l_2,) + (0,) * (self.ndim - 1)),
            _distinct_permutations((l_3,) + (0,) * (self.ndim - 1)),
            _distinct_permutations((-l_3,) + (0,) * (self.ndim - 1)),
            _distinct_permutations((l_4, l_4) + (0,) * (self.ndim - 2)),
            _distinct_permutations((l_4, -l_4) + (0,) * (self.ndim - 2)),
            _distinct_permutations((-l_4, -l_4) + (0,) * (self.ndim - 2)),
            itertools.product((l_5, -l_5), repeat=self.ndim),
        )

        nodes_size = 1 + (2 * (self.ndim + 1) * self.ndim) + 2**self.ndim

        nodes = self.xp.asarray(
            list(zip(*its)),
            dtype=self.xp.float64,
        )

        nodes = self.xp.reshape(nodes, (self.ndim, nodes_size))

        # It's convenient to generate the nodes as a sequence of evaluation points
        # as an array of shape (npoints, ndim), but nodes needs to have shape
        # (ndim, npoints)
        nodes = nodes.T

        w_1 = (
            (2**self.ndim) * (12824 - 9120*self.ndim + (400 * self.ndim**2)) / 19683
        )
        w_2 = (2**self.ndim) * 980/6561
        w_3 = (2**self.ndim) * (1820 - 400 * self.ndim) / 19683
        w_4 = (2**self.ndim) * (200 / 19683)
        w_5 = 6859 / 19683

        weights = self.xp.concat([
            self.xp.asarray([w_1] * 1, dtype=self.xp.float64),
            self.xp.asarray([w_2] * (2 * self.ndim), dtype=self.xp.float64),
            self.xp.asarray([w_3] * (2 * self.ndim), dtype=self.xp.float64),
            self.xp.asarray(
                [w_4] * (2 * (self.ndim - 1) * self.ndim),
                dtype=self.xp.float64,
            ),
            self.xp.asarray([w_5] * (2**self.ndim), dtype=self.xp.float64),
        ])

        return nodes, weights

    @cached_property
    def lower_nodes_and_weights(self):
        # TODO: Currently only support for the degree 5 lower rule, in the future it
        # would be worth supporting arbitrary degree

        # Nodes are almost the same as the full rule, but there are no nodes
        # corresponding to l_5.
        l_2 = math.sqrt(9/70)
        l_3 = math.sqrt(9/10)
        l_4 = math.sqrt(9/10)

        its = itertools.chain(
            [(0,) * self.ndim],
            _distinct_permutations((l_2,) + (0,) * (self.ndim - 1)),
            _distinct_permutations((-l_2,) + (0,) * (self.ndim - 1)),
            _distinct_permutations((l_3,) + (0,) * (self.ndim - 1)),
            _distinct_permutations((-l_3,) + (0,) * (self.ndim - 1)),
            _distinct_permutations((l_4, l_4) + (0,) * (self.ndim - 2)),
            _distinct_permutations((l_4, -l_4) + (0,) * (self.ndim - 2)),
            _distinct_permutations((-l_4, -l_4) + (0,) * (self.ndim - 2)),
        )

        nodes_size = 1 + (2 * (self.ndim + 1) * self.ndim)

        nodes = self.xp.asarray(list(zip(*its)), dtype=self.xp.float64)
        nodes = self.xp.reshape(nodes, (self.ndim, nodes_size))
        nodes = nodes.T

        # Weights are different from those in the full rule.
        w_1 = (2**self.ndim) * (729 - 950*self.ndim + 50*self.ndim**2) / 729
        w_2 = (2**self.ndim) * (245 / 486)
        w_3 = (2**self.ndim) * (265 - 100*self.ndim) / 1458
        w_4 = (2**self.ndim) * (25 / 729)

        weights = self.xp.concat([
            self.xp.asarray([w_1] * 1, dtype=self.xp.float64),
            self.xp.asarray([w_2] * (2 * self.ndim), dtype=self.xp.float64),
            self.xp.asarray([w_3] * (2 * self.ndim), dtype=self.xp.float64),
            self.xp.asarray(
                [w_4] * (2 * (self.ndim - 1) * self.ndim),
                dtype=self.xp.float64,
            ),
        ])

        return nodes, weights


def _distinct_permutations(iterable):
    """
    Find the number of distinct permutations of elements of `iterable`.
    """

    # Algorithm: https://w.wiki/Qai

    items = sorted(iterable)
    size = len(items)

    while True:
        # Yield the permutation we have
        yield tuple(items)

        # Find the largest index i such that A[i] < A[i + 1]
        for i in range(size - 2, -1, -1):
            if items[i] < items[i + 1]:
                break

        #  If no such index exists, this permutation is the last one
        else:
            return

        # Find the largest index j greater than j such that A[i] < A[j]
        for j in range(size - 1, i, -1):
            if items[i] < items[j]:
                break

        # Swap the value of A[i] with that of A[j], then reverse the
        # sequence from A[i + 1] to form the new permutation
        items[i], items[j] = items[j], items[i]
        items[i+1:] = items[:i-size:-1]  # A[i + 1:][::-1]
