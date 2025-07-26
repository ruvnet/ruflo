"""Platform compatibility."""

import platform
import re
import sys
# Jython does not have this attribute
import typing

try:
    from socket import SOL_TCP
except ImportError:  # pragma: no cover
    from socket import IPPROTO_TCP as SOL_TCP  # noqa


RE_NUM = re.compile(r'(\d+).+')


def _linux_version_to_tuple(s: str) -> typing.Tuple[int, int, int]:
    return tuple(map(_versionatom, s.split('.')[:3]))


def _versionatom(s: str) -> int:
    if s.isdigit():
        return int(s)
    match = RE_NUM.match(s)
    return int(match.groups()[0]) if match else 0


# available socket options for TCP level
KNOWN_TCP_OPTS = {
    'TCP_CORK', 'TCP_DEFER_ACCEPT', 'TCP_KEEPCNT',
    'TCP_KEEPIDLE', 'TCP_KEEPINTVL', 'TCP_LINGER2',
    'TCP_MAXSEG', 'TCP_NODELAY', 'TCP_QUICKACK',
    'TCP_SYNCNT', 'TCP_USER_TIMEOUT', 'TCP_WINDOW_CLAMP',
}

LINUX_VERSION = None
if sys.platform.startswith('linux'):
    LINUX_VERSION = _linux_version_to_tuple(platform.release())
    if LINUX_VERSION < (2, 6, 37):
        KNOWN_TCP_OPTS.remove('TCP_USER_TIMEOUT')

    # Windows Subsystem for Linux is an edge-case: the Python socket library
    # returns most TCP_* enums, but they aren't actually supported
    if platform.release().endswith("Microsoft"):
        KNOWN_TCP_OPTS = {'TCP_NODELAY', 'TCP_KEEPIDLE', 'TCP_KEEPINTVL',
                          'TCP_KEEPCNT'}

elif sys.platform.startswith('darwin'):
    KNOWN_TCP_OPTS.remove('TCP_USER_TIMEOUT')

elif 'bsd' in sys.platform:
    KNOWN_TCP_OPTS.remove('TCP_USER_TIMEOUT')

# According to MSDN Windows platforms support getsockopt(TCP_MAXSSEG) but not
# setsockopt(TCP_MAXSEG) on IPPROTO_TCP sockets.
elif sys.platform.startswith('win'):
    KNOWN_TCP_OPTS = {'TCP_NODELAY'}

elif sys.platform.startswith('cygwin'):
    KNOWN_TCP_OPTS = {'TCP_NODELAY'}

    # illumos does not allow to set the TCP_MAXSEG socket option,
    # even if the Oracle documentation says otherwise.
    # TCP_USER_TIMEOUT does not exist on Solaris 11.4
elif sys.platform.startswith('sunos'):
    KNOWN_TCP_OPTS.remove('TCP_MAXSEG')
    KNOWN_TCP_OPTS.remove('TCP_USER_TIMEOUT')

# aix does not allow to set the TCP_MAXSEG
# or the TCP_USER_TIMEOUT socket options.
elif sys.platform.startswith('aix'):
    KNOWN_TCP_OPTS.remove('TCP_MAXSEG')
    KNOWN_TCP_OPTS.remove('TCP_USER_TIMEOUT')
__all__ = (
    'LINUX_VERSION',
    'SOL_TCP',
    'KNOWN_TCP_OPTS',
)
