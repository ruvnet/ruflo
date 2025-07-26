"""UUID utilities."""
from __future__ import annotations

from typing import Callable
from uuid import UUID, uuid4


def uuid(_uuid: Callable[[], UUID] = uuid4) -> str:
    """Generate unique id in UUID4 format.

    See Also
    --------
        For now this is provided by :func:`uuid.uuid4`.
    """
    return str(_uuid())
