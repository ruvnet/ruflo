from scipy._lib._array_api import array_namespace
import numpy as np
from . import _pocketfft

__all__ = ['dct', 'idct', 'dst', 'idst', 'dctn', 'idctn', 'dstn', 'idstn']


def _execute(pocketfft_func, x, type, s, axes, norm, 
             overwrite_x, workers, orthogonalize):
    xp = array_namespace(x)
    x = np.asarray(x)
    y = pocketfft_func(x, type, s, axes, norm,
                       overwrite_x=overwrite_x, workers=workers,
                       orthogonalize=orthogonalize)
    return xp.asarray(y)


def dctn(x, type=2, s=None, axes=None, norm=None,
         overwrite_x=False, workers=None, *, orthogonalize=None):
    return _execute(_pocketfft.dctn, x, type, s, axes, norm, 
                    overwrite_x, workers, orthogonalize)


def idctn(x, type=2, s=None, axes=None, norm=None,
          overwrite_x=False, workers=None, *, orthogonalize=None):
    return _execute(_pocketfft.idctn, x, type, s, axes, norm, 
                    overwrite_x, workers, orthogonalize)


def dstn(x, type=2, s=None, axes=None, norm=None,
         overwrite_x=False, workers=None, orthogonalize=None):
    return _execute(_pocketfft.dstn, x, type, s, axes, norm, 
                    overwrite_x, workers, orthogonalize)


def idstn(x, type=2, s=None, axes=None, norm=None,
          overwrite_x=False, workers=None, *, orthogonalize=None):
    return _execute(_pocketfft.idstn, x, type, s, axes, norm, 
                    overwrite_x, workers, orthogonalize)


def dct(x, type=2, n=None, axis=-1, norm=None,
        overwrite_x=False, workers=None, orthogonalize=None):
    return _execute(_pocketfft.dct, x, type, n, axis, norm, 
                    overwrite_x, workers, orthogonalize)


def idct(x, type=2, n=None, axis=-1, norm=None,
         overwrite_x=False, workers=None, orthogonalize=None):
    return _execute(_pocketfft.idct, x, type, n, axis, norm, 
                    overwrite_x, workers, orthogonalize)


def dst(x, type=2, n=None, axis=-1, norm=None,
        overwrite_x=False, workers=None, orthogonalize=None):
    return _execute(_pocketfft.dst, x, type, n, axis, norm, 
                    overwrite_x, workers, orthogonalize)


def idst(x, type=2, n=None, axis=-1, norm=None,
         overwrite_x=False, workers=None, orthogonalize=None):
    return _execute(_pocketfft.idst, x, type, n, axis, norm, 
                    overwrite_x, workers, orthogonalize)
