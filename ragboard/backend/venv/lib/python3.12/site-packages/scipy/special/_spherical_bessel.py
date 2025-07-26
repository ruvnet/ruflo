from functools import wraps
import scipy._lib.array_api_extra as xpx
import numpy as np
from ._ufuncs import (_spherical_jn, _spherical_yn, _spherical_in,
                      _spherical_kn, _spherical_jn_d, _spherical_yn_d,
                      _spherical_in_d, _spherical_kn_d)


def use_reflection(sign_n_even=None, reflection_fun=None):
    # - If reflection_fun is not specified, reflects negative `z` and multiplies
    #   output by appropriate sign (indicated by `sign_n_even`).
    # - If reflection_fun is specified, calls `reflection_fun` instead of `fun`.
    # See DLMF 10.47(v) https://dlmf.nist.gov/10.47
    def decorator(fun):
        def standard_reflection(n, z, derivative):
            # sign_n_even indicates the sign when the order `n` is even
            sign = np.where(n % 2 == 0, sign_n_even, -sign_n_even)
            # By the chain rule, differentiation at `-z` adds a minus sign
            sign = -sign if derivative else sign
            # Evaluate at positive z (minus negative z) and adjust the sign
            return fun(n, -z, derivative) * sign

        @wraps(fun)
        def wrapper(n, z, derivative=False):
            z = np.asarray(z)

            if np.issubdtype(z.dtype, np.complexfloating):
                return fun(n, z, derivative)  # complex dtype just works

            f2 = standard_reflection if reflection_fun is None else reflection_fun
            return xpx.apply_where(z.real >= 0, (n, z),
                                   lambda n, z: fun(n, z, derivative),
                                   lambda n, z: f2(n, z, derivative))[()]
        return wrapper
    return decorator


@use_reflection(+1)  # See DLMF 10.47(v) https://dlmf.nist.gov/10.47
def spherical_jn(n, z, derivative=False):
    r"""Spherical Bessel function of the first kind or its derivative.

    Defined as [1]_,

    .. math:: j_n(z) = \sqrt{\frac{\pi}{2z}} J_{n + 1/2}(z),

    where :math:`J_n` is the Bessel function of the first kind.

    Parameters
    ----------
    n : int, array_like
        Order of the Bessel function (n >= 0).
    z : complex or float, array_like
        Argument of the Bessel function.
    derivative : bool, optional
        If True, the value of the derivative (rather than the function
        itself) is returned.

    Returns
    -------
    jn : ndarray

    Notes
    -----
    For real arguments greater than the order, the function is computed
    using the ascending recurrence [2]_. For small real or complex
    arguments, the definitional relation to the cylindrical Bessel function
    of the first kind is used.

    The derivative is computed using the relations [3]_,

    .. math::
        j_n'(z) = j_{n-1}(z) - \frac{n + 1}{z} j_n(z).

        j_0'(z) = -j_1(z)


    .. versionadded:: 0.18.0

    References
    ----------
    .. [1] https://dlmf.nist.gov/10.47.E3
    .. [2] https://dlmf.nist.gov/10.51.E1
    .. [3] https://dlmf.nist.gov/10.51.E2
    .. [AS] Milton Abramowitz and Irene A. Stegun, eds.
        Handbook of Mathematical Functions with Formulas,
        Graphs, and Mathematical Tables. New York: Dover, 1972.

    Examples
    --------
    The spherical Bessel functions of the first kind :math:`j_n` accept
    both real and complex second argument. They can return a complex type:

    >>> from scipy.special import spherical_jn
    >>> spherical_jn(0, 3+5j)
    (-9.878987731663194-8.021894345786002j)
    >>> type(spherical_jn(0, 3+5j))
    <class 'numpy.complex128'>

    We can verify the relation for the derivative from the Notes
    for :math:`n=3` in the interval :math:`[1, 2]`:

    >>> import numpy as np
    >>> x = np.arange(1.0, 2.0, 0.01)
    >>> np.allclose(spherical_jn(3, x, True),
    ...             spherical_jn(2, x) - 4/x * spherical_jn(3, x))
    True

    The first few :math:`j_n` with real argument:

    >>> import matplotlib.pyplot as plt
    >>> x = np.arange(0.0, 10.0, 0.01)
    >>> fig, ax = plt.subplots()
    >>> ax.set_ylim(-0.5, 1.5)
    >>> ax.set_title(r'Spherical Bessel functions $j_n$')
    >>> for n in np.arange(0, 4):
    ...     ax.plot(x, spherical_jn(n, x), label=rf'$j_{n}$')
    >>> plt.legend(loc='best')
    >>> plt.show()

    """
    n = np.asarray(n, dtype=np.dtype("long"))
    if derivative:
        return _spherical_jn_d(n, z)
    else:
        return _spherical_jn(n, z)


@use_reflection(-1)  # See DLMF 10.47(v) https://dlmf.nist.gov/10.47
def spherical_yn(n, z, derivative=False):
    r"""Spherical Bessel function of the second kind or its derivative.

    Defined as [1]_,

    .. math:: y_n(z) = \sqrt{\frac{\pi}{2z}} Y_{n + 1/2}(z),

    where :math:`Y_n` is the Bessel function of the second kind.

    Parameters
    ----------
    n : int, array_like
        Order of the Bessel function (n >= 0).
    z : complex or float, array_like
        Argument of the Bessel function.
    derivative : bool, optional
        If True, the value of the derivative (rather than the function
        itself) is returned.

    Returns
    -------
    yn : ndarray

    Notes
    -----
    For real arguments, the function is computed using the ascending
    recurrence [2]_.  For complex arguments, the definitional relation to
    the cylindrical Bessel function of the second kind is used.

    The derivative is computed using the relations [3]_,

    .. math::
        y_n' = y_{n-1} - \frac{n + 1}{z} y_n.

        y_0' = -y_1


    .. versionadded:: 0.18.0

    References
    ----------
    .. [1] https://dlmf.nist.gov/10.47.E4
    .. [2] https://dlmf.nist.gov/10.51.E1
    .. [3] https://dlmf.nist.gov/10.51.E2
    .. [AS] Milton Abramowitz and Irene A. Stegun, eds.
        Handbook of Mathematical Functions with Formulas,
        Graphs, and Mathematical Tables. New York: Dover, 1972.

    Examples
    --------
    The spherical Bessel functions of the second kind :math:`y_n` accept
    both real and complex second argument. They can return a complex type:

    >>> from scipy.special import spherical_yn
    >>> spherical_yn(0, 3+5j)
    (8.022343088587197-9.880052589376795j)
    >>> type(spherical_yn(0, 3+5j))
    <class 'numpy.complex128'>

    We can verify the relation for the derivative from the Notes
    for :math:`n=3` in the interval :math:`[1, 2]`:

    >>> import numpy as np
    >>> x = np.arange(1.0, 2.0, 0.01)
    >>> np.allclose(spherical_yn(3, x, True),
    ...             spherical_yn(2, x) - 4/x * spherical_yn(3, x))
    True

    The first few :math:`y_n` with real argument:

    >>> import matplotlib.pyplot as plt
    >>> x = np.arange(0.0, 10.0, 0.01)
    >>> fig, ax = plt.subplots()
    >>> ax.set_ylim(-2.0, 1.0)
    >>> ax.set_title(r'Spherical Bessel functions $y_n$')
    >>> for n in np.arange(0, 4):
    ...     ax.plot(x, spherical_yn(n, x), label=rf'$y_{n}$')
    >>> plt.legend(loc='best')
    >>> plt.show()

    """
    n = np.asarray(n, dtype=np.dtype("long"))
    if derivative:
        return _spherical_yn_d(n, z)
    else:
        return _spherical_yn(n, z)


@use_reflection(+1)  # See DLMF 10.47(v) https://dlmf.nist.gov/10.47
def spherical_in(n, z, derivative=False):
    r"""Modified spherical Bessel function of the first kind or its derivative.

    Defined as [1]_,

    .. math:: i_n(z) = \sqrt{\frac{\pi}{2z}} I_{n + 1/2}(z),

    where :math:`I_n` is the modified Bessel function of the first kind.

    Parameters
    ----------
    n : int, array_like
        Order of the Bessel function (n >= 0).
    z : complex or float, array_like
        Argument of the Bessel function.
    derivative : bool, optional
        If True, the value of the derivative (rather than the function
        itself) is returned.

    Returns
    -------
    in : ndarray

    Notes
    -----
    The function is computed using its definitional relation to the
    modified cylindrical Bessel function of the first kind.

    The derivative is computed using the relations [2]_,

    .. math::
        i_n' = i_{n-1} - \frac{n + 1}{z} i_n.

        i_1' = i_0


    .. versionadded:: 0.18.0

    References
    ----------
    .. [1] https://dlmf.nist.gov/10.47.E7
    .. [2] https://dlmf.nist.gov/10.51.E5
    .. [AS] Milton Abramowitz and Irene A. Stegun, eds.
        Handbook of Mathematical Functions with Formulas,
        Graphs, and Mathematical Tables. New York: Dover, 1972.

    Examples
    --------
    The modified spherical Bessel functions of the first kind :math:`i_n`
    accept both real and complex second argument.
    They can return a complex type:

    >>> from scipy.special import spherical_in
    >>> spherical_in(0, 3+5j)
    (-1.1689867793369182-1.2697305267234222j)
    >>> type(spherical_in(0, 3+5j))
    <class 'numpy.complex128'>

    We can verify the relation for the derivative from the Notes
    for :math:`n=3` in the interval :math:`[1, 2]`:

    >>> import numpy as np
    >>> x = np.arange(1.0, 2.0, 0.01)
    >>> np.allclose(spherical_in(3, x, True),
    ...             spherical_in(2, x) - 4/x * spherical_in(3, x))
    True

    The first few :math:`i_n` with real argument:

    >>> import matplotlib.pyplot as plt
    >>> x = np.arange(0.0, 6.0, 0.01)
    >>> fig, ax = plt.subplots()
    >>> ax.set_ylim(-0.5, 5.0)
    >>> ax.set_title(r'Modified spherical Bessel functions $i_n$')
    >>> for n in np.arange(0, 4):
    ...     ax.plot(x, spherical_in(n, x), label=rf'$i_{n}$')
    >>> plt.legend(loc='best')
    >>> plt.show()

    """
    n = np.asarray(n, dtype=np.dtype("long"))
    if derivative:
        return _spherical_in_d(n, z)
    else:
        return _spherical_in(n, z)


def spherical_kn_reflection(n, z, derivative=False):
    # More complex than the other cases, and this will likely be re-implemented
    # in C++ anyway. Would require multiple function evaluations. Probably about
    # as fast to just resort to complex math, and much simpler.
    return spherical_kn(n, z + 0j, derivative=derivative).real


@use_reflection(reflection_fun=spherical_kn_reflection)
def spherical_kn(n, z, derivative=False):
    r"""Modified spherical Bessel function of the second kind or its derivative.

    Defined as [1]_,

    .. math:: k_n(z) = \sqrt{\frac{\pi}{2z}} K_{n + 1/2}(z),

    where :math:`K_n` is the modified Bessel function of the second kind.

    Parameters
    ----------
    n : int, array_like
        Order of the Bessel function (n >= 0).
    z : complex or float, array_like
        Argument of the Bessel function.
    derivative : bool, optional
        If True, the value of the derivative (rather than the function
        itself) is returned.

    Returns
    -------
    kn : ndarray

    Notes
    -----
    The function is computed using its definitional relation to the
    modified cylindrical Bessel function of the second kind.

    The derivative is computed using the relations [2]_,

    .. math::
        k_n' = -k_{n-1} - \frac{n + 1}{z} k_n.

        k_0' = -k_1


    .. versionadded:: 0.18.0

    References
    ----------
    .. [1] https://dlmf.nist.gov/10.47.E9
    .. [2] https://dlmf.nist.gov/10.51.E5
    .. [AS] Milton Abramowitz and Irene A. Stegun, eds.
        Handbook of Mathematical Functions with Formulas,
        Graphs, and Mathematical Tables. New York: Dover, 1972.

    Examples
    --------
    The modified spherical Bessel functions of the second kind :math:`k_n`
    accept both real and complex second argument.
    They can return a complex type:

    >>> from scipy.special import spherical_kn
    >>> spherical_kn(0, 3+5j)
    (0.012985785614001561+0.003354691603137546j)
    >>> type(spherical_kn(0, 3+5j))
    <class 'numpy.complex128'>

    We can verify the relation for the derivative from the Notes
    for :math:`n=3` in the interval :math:`[1, 2]`:

    >>> import numpy as np
    >>> x = np.arange(1.0, 2.0, 0.01)
    >>> np.allclose(spherical_kn(3, x, True),
    ...             - 4/x * spherical_kn(3, x) - spherical_kn(2, x))
    True

    The first few :math:`k_n` with real argument:

    >>> import matplotlib.pyplot as plt
    >>> x = np.arange(0.0, 4.0, 0.01)
    >>> fig, ax = plt.subplots()
    >>> ax.set_ylim(0.0, 5.0)
    >>> ax.set_title(r'Modified spherical Bessel functions $k_n$')
    >>> for n in np.arange(0, 4):
    ...     ax.plot(x, spherical_kn(n, x), label=rf'$k_{n}$')
    >>> plt.legend(loc='best')
    >>> plt.show()

    """
    n = np.asarray(n, dtype=np.dtype("long"))
    if derivative:
        return _spherical_kn_d(n, z)
    else:
        return _spherical_kn(n, z)
