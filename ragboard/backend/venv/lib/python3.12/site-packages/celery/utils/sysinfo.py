"""System information utilities."""
import os
from math import ceil

from kombu.utils.objects import cached_property

__all__ = ('load_average', 'df')


if hasattr(os, 'getloadavg'):

    def _load_average():
        return tuple(ceil(l * 1e2) / 1e2 for l in os.getloadavg())

else:  # pragma: no cover
    # Windows doesn't have getloadavg
    def _load_average():
        return (0.0, 0.0, 0.0)


def load_average():
    """Return system load average as a triple."""
    return _load_average()


class df:
    """Disk information."""

    def __init__(self, path):
        self.path = path

    @property
    def total_blocks(self):
        return self.stat.f_blocks * self.stat.f_frsize / 1024

    @property
    def available(self):
        return self.stat.f_bavail * self.stat.f_frsize / 1024

    @property
    def capacity(self):
        avail = self.stat.f_bavail
        used = self.stat.f_blocks - self.stat.f_bfree
        return int(ceil(used * 100.0 / (used + avail) + 0.5))

    @cached_property
    def stat(self):
        return os.statvfs(os.path.abspath(self.path))
