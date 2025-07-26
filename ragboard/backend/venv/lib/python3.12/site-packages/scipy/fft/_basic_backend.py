from scipy._lib._array_api import (
    array_namespace, is_numpy, xp_unsupported_param_msg, is_complex, xp_float_to_complex
)
from . import _pocketfft
import numpy as np


def _validate_fft_args(workers, plan, norm):
    if workers is not None:
        raise ValueError(xp_unsupported_param_msg("workers"))
    if plan is not None:
        raise ValueError(xp_unsupported_param_msg("plan"))
    if norm is None:
        norm = 'backward'
    return norm


# these functions expect complex input in the fft standard extension
complex_funcs = {'fft', 'ifft', 'fftn', 'ifftn', 'hfft', 'irfft', 'irfftn'}

# pocketfft is used whenever SCIPY_ARRAY_API is not set,
# or x is a NumPy array or array-like.
# When SCIPY_ARRAY_API is set, we try to use xp.fft for CuPy arrays,
# PyTorch arrays and other array API standard supporting objects.
# If xp.fft does not exist, we attempt to convert to np and back to use pocketfft.

def _execute_1D(func_str, pocketfft_func, x, n, axis, norm, overwrite_x, workers, plan):
    xp = array_namespace(x)

    if is_numpy(xp):
        x = np.asarray(x)
        return pocketfft_func(x, n=n, axis=axis, norm=norm,
                              overwrite_x=overwrite_x, workers=workers, plan=plan)

    norm = _validate_fft_args(workers, plan, norm)
    if hasattr(xp, 'fft'):
        xp_func = getattr(xp.fft, func_str)
        if func_str in complex_funcs:
            try:
                res = xp_func(x, n=n, axis=axis, norm=norm)
            except: # backends may require complex input  # noqa: E722
                x = xp_float_to_complex(x, xp)
                res = xp_func(x, n=n, axis=axis, norm=norm)
            return res
        return xp_func(x, n=n, axis=axis, norm=norm)

    x = np.asarray(x)
    y = pocketfft_func(x, n=n, axis=axis, norm=norm)
    return xp.asarray(y)


def _execute_nD(func_str, pocketfft_func, x, s, axes, norm, overwrite_x, workers, plan):
    xp = array_namespace(x)
    
    if is_numpy(xp):
        x = np.asarray(x)
        return pocketfft_func(x, s=s, axes=axes, norm=norm,
                              overwrite_x=overwrite_x, workers=workers, plan=plan)

    norm = _validate_fft_args(workers, plan, norm)
    if hasattr(xp, 'fft'):
        xp_func = getattr(xp.fft, func_str)
        if func_str in complex_funcs:
            try:
                res = xp_func(x, s=s, axes=axes, norm=norm)
            except: # backends may require complex input  # noqa: E722
                x = xp_float_to_complex(x, xp)
                res = xp_func(x, s=s, axes=axes, norm=norm)
            return res
        return xp_func(x, s=s, axes=axes, norm=norm)

    x = np.asarray(x)
    y = pocketfft_func(x, s=s, axes=axes, norm=norm)
    return xp.asarray(y)


def fft(x, n=None, axis=-1, norm=None,
        overwrite_x=False, workers=None, *, plan=None):
    return _execute_1D('fft', _pocketfft.fft, x, n=n, axis=axis, norm=norm,
                       overwrite_x=overwrite_x, workers=workers, plan=plan)


def ifft(x, n=None, axis=-1, norm=None, overwrite_x=False, workers=None, *,
         plan=None):
    return _execute_1D('ifft', _pocketfft.ifft, x, n=n, axis=axis, norm=norm,
                       overwrite_x=overwrite_x, workers=workers, plan=plan)


def rfft(x, n=None, axis=-1, norm=None,
         overwrite_x=False, workers=None, *, plan=None):
    return _execute_1D('rfft', _pocketfft.rfft, x, n=n, axis=axis, norm=norm,
                       overwrite_x=overwrite_x, workers=workers, plan=plan)


def irfft(x, n=None, axis=-1, norm=None,
          overwrite_x=False, workers=None, *, plan=None):
    return _execute_1D('irfft', _pocketfft.irfft, x, n=n, axis=axis, norm=norm,
                       overwrite_x=overwrite_x, workers=workers, plan=plan)


def hfft(x, n=None, axis=-1, norm=None,
         overwrite_x=False, workers=None, *, plan=None):
    return _execute_1D('hfft', _pocketfft.hfft, x, n=n, axis=axis, norm=norm,
                       overwrite_x=overwrite_x, workers=workers, plan=plan)


def ihfft(x, n=None, axis=-1, norm=None,
          overwrite_x=False, workers=None, *, plan=None):
    return _execute_1D('ihfft', _pocketfft.ihfft, x, n=n, axis=axis, norm=norm,
                       overwrite_x=overwrite_x, workers=workers, plan=plan)


def fftn(x, s=None, axes=None, norm=None,
         overwrite_x=False, workers=None, *, plan=None):
    return _execute_nD('fftn', _pocketfft.fftn, x, s=s, axes=axes, norm=norm,
                       overwrite_x=overwrite_x, workers=workers, plan=plan)



def ifftn(x, s=None, axes=None, norm=None,
          overwrite_x=False, workers=None, *, plan=None):
    return _execute_nD('ifftn', _pocketfft.ifftn, x, s=s, axes=axes, norm=norm,
                       overwrite_x=overwrite_x, workers=workers, plan=plan)


def fft2(x, s=None, axes=(-2, -1), norm=None,
         overwrite_x=False, workers=None, *, plan=None):
    return fftn(x, s, axes, norm, overwrite_x, workers, plan=plan)


def ifft2(x, s=None, axes=(-2, -1), norm=None,
          overwrite_x=False, workers=None, *, plan=None):
    return ifftn(x, s, axes, norm, overwrite_x, workers, plan=plan)


def rfftn(x, s=None, axes=None, norm=None,
          overwrite_x=False, workers=None, *, plan=None):
    return _execute_nD('rfftn', _pocketfft.rfftn, x, s=s, axes=axes, norm=norm,
                       overwrite_x=overwrite_x, workers=workers, plan=plan)


def rfft2(x, s=None, axes=(-2, -1), norm=None,
         overwrite_x=False, workers=None, *, plan=None):
    return rfftn(x, s, axes, norm, overwrite_x, workers, plan=plan)


def irfftn(x, s=None, axes=None, norm=None,
           overwrite_x=False, workers=None, *, plan=None):
    return _execute_nD('irfftn', _pocketfft.irfftn, x, s=s, axes=axes, norm=norm,
                       overwrite_x=overwrite_x, workers=workers, plan=plan)


def irfft2(x, s=None, axes=(-2, -1), norm=None,
           overwrite_x=False, workers=None, *, plan=None):
    return irfftn(x, s, axes, norm, overwrite_x, workers, plan=plan)


def _swap_direction(norm):
    if norm in (None, 'backward'):
        norm = 'forward'
    elif norm == 'forward':
        norm = 'backward'
    elif norm != 'ortho':
        raise ValueError(f'Invalid norm value {norm}; should be "backward", '
                         '"ortho", or "forward".')
    return norm


def hfftn(x, s=None, axes=None, norm=None,
          overwrite_x=False, workers=None, *, plan=None):
    xp = array_namespace(x)
    if is_numpy(xp):
        x = np.asarray(x)
        return _pocketfft.hfftn(x, s, axes, norm, overwrite_x, workers, plan=plan)
    if is_complex(x, xp):
        x = xp.conj(x)
    return irfftn(x, s, axes, _swap_direction(norm),
                  overwrite_x, workers, plan=plan)


def hfft2(x, s=None, axes=(-2, -1), norm=None,
          overwrite_x=False, workers=None, *, plan=None):
    return hfftn(x, s, axes, norm, overwrite_x, workers, plan=plan)


def ihfftn(x, s=None, axes=None, norm=None,
           overwrite_x=False, workers=None, *, plan=None):
    xp = array_namespace(x)
    if is_numpy(xp):
        x = np.asarray(x)
        return _pocketfft.ihfftn(x, s, axes, norm, overwrite_x, workers, plan=plan)
    return xp.conj(rfftn(x, s, axes, _swap_direction(norm),
                         overwrite_x, workers, plan=plan))

def ihfft2(x, s=None, axes=(-2, -1), norm=None,
           overwrite_x=False, workers=None, *, plan=None):
    return ihfftn(x, s, axes, norm, overwrite_x, workers, plan=plan)
