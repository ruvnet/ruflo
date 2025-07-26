import functools
from scipy._lib._array_api import (
    is_cupy, is_jax, scipy_namespace_for, SCIPY_ARRAY_API
)

from ._signal_api import *   # noqa: F403
from . import _signal_api
from . import _delegators
__all__ = _signal_api.__all__


MODULE_NAME = 'signal'

# jax.scipy.signal has only partial coverage of scipy.signal, so we keep the list
# of functions we can delegate to JAX
# https://jax.readthedocs.io/en/latest/jax.scipy.html
JAX_SIGNAL_FUNCS = [
    'fftconvolve', 'convolve', 'convolve2d', 'correlate', 'correlate2d',
    'csd', 'detrend', 'istft', 'welch'
]

# some cupyx.scipy.signal functions are incompatible with their scipy counterparts
CUPY_BLACKLIST = ['lfilter_zi', 'sosfilt_zi', 'get_window', 'envelope', 'remez']

# freqz_sos is a sosfreqz rename, and cupy does not have the new name yet (in v13.x)
CUPY_RENAMES = {'freqz_sos': 'sosfreqz'}


def delegate_xp(delegator, module_name):
    def inner(func):
        @functools.wraps(func)
        def wrapper(*args, **kwds):
            try:
                xp = delegator(*args, **kwds)
            except TypeError:
                # object arrays
                import numpy as np
                xp = np

            # try delegating to a cupyx/jax namesake
            if is_cupy(xp) and func.__name__ not in CUPY_BLACKLIST:
                func_name = CUPY_RENAMES.get(func.__name__, func.__name__)

                # https://github.com/cupy/cupy/issues/8336
                import importlib
                cupyx_module = importlib.import_module(f"cupyx.scipy.{module_name}")
                cupyx_func = getattr(cupyx_module, func_name)
                return cupyx_func(*args, **kwds)
            elif is_jax(xp) and func.__name__ in JAX_SIGNAL_FUNCS:
                spx = scipy_namespace_for(xp)
                jax_module = getattr(spx, module_name)
                jax_func = getattr(jax_module, func.__name__)
                return jax_func(*args, **kwds)
            else:
                # the original function
                return func(*args, **kwds)
        return wrapper
    return inner



# ### decorate ###
for obj_name in _signal_api.__all__:
    bare_obj = getattr(_signal_api, obj_name)
    delegator = getattr(_delegators, obj_name + "_signature", None)

    if SCIPY_ARRAY_API and delegator is not None:
        f = delegate_xp(delegator, MODULE_NAME)(bare_obj)
    else:
        f = bare_obj

    # add the decorated function to the namespace, to be imported in __init__.py
    vars()[obj_name] = f
