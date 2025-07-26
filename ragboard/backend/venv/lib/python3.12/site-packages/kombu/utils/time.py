"""Time Utilities."""
from __future__ import annotations

__all__ = ('maybe_s_to_ms',)


def maybe_s_to_ms(v: int | float | None) -> int | None:
    """Convert seconds to milliseconds, but return None for None."""
    return int(float(v) * 1000.0) if v is not None else v
