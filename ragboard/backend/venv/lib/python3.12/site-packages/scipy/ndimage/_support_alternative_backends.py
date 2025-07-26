import functools
from scipy._lib._array_api import (
    is_cupy, is_jax, scipy_namespace_for, SCIPY_ARRAY_API
)

import numpy as np
from ._ndimage_api import *   # noqa: F403
from . import _ndimage_api
from . import _delegators
__all__ = _ndimage_api.__all__


MODULE_NAME = 'ndimage'


def _maybe_convert_arg(arg, xp):
    """Convert arrays/scalars hiding in the sequence `arg`."""
    if isinstance(arg, np.ndarray | np.generic):
        return xp.asarray(arg)
    elif isinstance(arg, list | tuple):
        return type(arg)(_maybe_convert_arg(x, xp) for x in arg)
    else:
        return arg


# Some cupyx.scipy.ndimage functions don't exist or are incompatible with
# their SciPy counterparts
CUPY_BLOCKLIST = ['vectorized_filter']


def delegate_xp(delegator, module_name):
    def inner(func):
        @functools.wraps(func)
        def wrapper(*args, **kwds):
            xp = delegator(*args, **kwds)

            # try delegating to a cupyx/jax namesake
            if is_cupy(xp) and func.__name__ not in CUPY_BLOCKLIST:
                # https://github.com/cupy/cupy/issues/8336
                import importlib
                cupyx_module = importlib.import_module(f"cupyx.scipy.{module_name}")
                cupyx_func = getattr(cupyx_module, func.__name__)
                return cupyx_func(*args, **kwds)
            elif is_jax(xp) and func.__name__ == "map_coordinates":
                spx = scipy_namespace_for(xp)
                jax_module = getattr(spx, module_name)
                jax_func = getattr(jax_module, func.__name__)
                return jax_func(*args, **kwds)
            else:
                # the original function (does all np.asarray internally)
                # XXX: output arrays
                result = func(*args, **kwds)

                if isinstance(result, np.ndarray | np.generic):
                    # XXX: np.int32->np.array_0D
                    return xp.asarray(result)
                elif isinstance(result, int):
                    return result
                elif isinstance(result, dict):
                    # value_indices: result is {np.int64(1): (array(0), array(1))} etc
                    return {
                        k.item(): tuple(xp.asarray(vv) for vv in v)
                        for k,v in result.items()
                    }
                elif result is None:
                    # inplace operations
                    return result
                else:
                    # lists/tuples
                    return _maybe_convert_arg(result, xp)
        return wrapper
    return inner

# ### decorate ###
for func_name in _ndimage_api.__all__:
    bare_func = getattr(_ndimage_api, func_name)
    delegator = getattr(_delegators, func_name + "_signature")

    f = (delegate_xp(delegator, MODULE_NAME)(bare_func)
         if SCIPY_ARRAY_API
         else bare_func)

    # add the decorated function to the namespace, to be imported in __init__.py
    vars()[func_name] = f
