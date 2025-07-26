from __future__ import annotations

from typing import Union, Sequence, Literal

import torch
import torch.fft
from torch.fft import * # noqa: F403

from ._typing import Array

# Several torch fft functions do not map axes to dim

def fftn(
    x: Array,
    /,
    *,
    s: Sequence[int] = None,
    axes: Sequence[int] = None,
    norm: Literal["backward", "ortho", "forward"] = "backward",
    **kwargs,
) -> Array:
    return torch.fft.fftn(x, s=s, dim=axes, norm=norm, **kwargs)

def ifftn(
    x: Array,
    /,
    *,
    s: Sequence[int] = None,
    axes: Sequence[int] = None,
    norm: Literal["backward", "ortho", "forward"] = "backward",
    **kwargs,
) -> Array:
    return torch.fft.ifftn(x, s=s, dim=axes, norm=norm, **kwargs)

def rfftn(
    x: Array,
    /,
    *,
    s: Sequence[int] = None,
    axes: Sequence[int] = None,
    norm: Literal["backward", "ortho", "forward"] = "backward",
    **kwargs,
) -> Array:
    return torch.fft.rfftn(x, s=s, dim=axes, norm=norm, **kwargs)

def irfftn(
    x: Array,
    /,
    *,
    s: Sequence[int] = None,
    axes: Sequence[int] = None,
    norm: Literal["backward", "ortho", "forward"] = "backward",
    **kwargs,
) -> Array:
    return torch.fft.irfftn(x, s=s, dim=axes, norm=norm, **kwargs)

def fftshift(
    x: Array,
    /,
    *,
    axes: Union[int, Sequence[int]] = None,
    **kwargs,
) -> Array:
    return torch.fft.fftshift(x, dim=axes, **kwargs)

def ifftshift(
    x: Array,
    /,
    *,
    axes: Union[int, Sequence[int]] = None,
    **kwargs,
) -> Array:
    return torch.fft.ifftshift(x, dim=axes, **kwargs)


__all__ = torch.fft.__all__ + [
    "fftn",
    "ifftn",
    "rfftn",
    "irfftn",
    "fftshift",
    "ifftshift",
]

_all_ignore = ['torch']
