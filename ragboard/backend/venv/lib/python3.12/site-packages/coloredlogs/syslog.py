# Easy to use system logging for Python's logging module.
#
# Author: Peter Odding <peter@peterodding.com>
# Last Change: December 10, 2020
# URL: https://coloredlogs.readthedocs.io

"""
Easy to use UNIX system logging for Python's :mod:`logging` module.

Admittedly system logging has little to do with colored terminal output, however:

- The `coloredlogs` package is my attempt to do Python logging right and system
  logging is an important part of that equation.

- I've seen a surprising number of quirks and mistakes in system logging done
  in Python, for example including ``%(asctime)s`` in a format string (the
  system logging daemon is responsible for adding timestamps and thus you end
  up with duplicate timestamps that make the logs awful to read :-).

- The ``%(programname)s`` filter originated in my system logging code and I
  wanted it in `coloredlogs` so the step to include this module wasn't that big.

- As a bonus this Python module now has a test suite and proper documentation.

So there :-P. Go take a look at :func:`enable_system_logging()`.
"""

# Standard library modules.
import logging
import logging.handlers
import os
import socket
import sys

# External dependencies.
from humanfriendly import coerce_boolean
from humanfriendly.compat import on_macos, on_windows

# Modules included in our package.
from coloredlogs import (
    DEFAULT_LOG_LEVEL,
    ProgramNameFilter,
    adjust_level,
    find_program_name,
    level_to_number,
    replace_handler,
)

LOG_DEVICE_MACOSX = '/var/run/syslog'
"""The pathname of the log device on Mac OS X (a string)."""

LOG_DEVICE_UNIX = '/dev/log'
"""The pathname of the log device on Linux and most other UNIX systems (a string)."""

DEFAULT_LOG_FORMAT = '%(programname)s[%(process)d]: %(levelname)s %(message)s'
"""
The default format for log messages sent to the system log (a string).

The ``%(programname)s`` format requires :class:`~coloredlogs.ProgramNameFilter`
but :func:`enable_system_logging()` takes care of this for you.

The ``name[pid]:`` construct (specifically the colon) in the format allows
rsyslogd_ to extract the ``$programname`` from each log message, which in turn
allows configuration files in ``/etc/rsyslog.d/*.conf`` to filter these log
messages to a separate log file (if the need arises).

.. _rsyslogd: https://en.wikipedia.org/wiki/Rsyslog
"""

# Initialize a logger for this module.
logger = logging.getLogger(__name__)


class SystemLogging(object):

    """Context manager to enable system logging."""

    def __init__(self, *args, **kw):
        """
        Initialize a :class:`SystemLogging` object.

        :param args: Positional arguments to :func:`enable_system_logging()`.
        :param kw: Keyword arguments to :func:`enable_system_logging()`.
        """
        self.args = args
        self.kw = kw
        self.handler = None

    def __enter__(self):
        """Enable system logging when entering the context."""
        if self.handler is None:
            self.handler = enable_system_logging(*self.args, **self.kw)
        return self.handler

    def __exit__(self, exc_type=None, exc_value=None, traceback=None):
        """
        Disable system logging when leaving the context.

        .. note:: If an exception is being handled when we leave the context a
                  warning message including traceback is logged *before* system
                  logging is disabled.
        """
        if self.handler is not None:
            if exc_type is not None:
                logger.warning("Disabling system logging due to unhandled exception!", exc_info=True)
            (self.kw.get('logger') or logging.getLogger()).removeHandler(self.handler)
            self.handler = None


def enable_system_logging(programname=None, fmt=None, logger=None, reconfigure=True, **kw):
    """
    Redirect :mod:`logging` messages to the system log (e.g. ``/var/log/syslog``).

    :param programname: The program name to embed in log messages (a string, defaults
                         to the result of :func:`~coloredlogs.find_program_name()`).
    :param fmt: The log format for system log messages (a string, defaults to
                :data:`DEFAULT_LOG_FORMAT`).
    :param logger: The logger to which the :class:`~logging.handlers.SysLogHandler`
                   should be connected (defaults to the root logger).
    :param level: The logging level for the :class:`~logging.handlers.SysLogHandler`
                  (defaults to :data:`.DEFAULT_LOG_LEVEL`). This value is coerced
                  using :func:`~coloredlogs.level_to_number()`.
    :param reconfigure: If :data:`True` (the default) multiple calls to
                        :func:`enable_system_logging()` will each override
                        the previous configuration.
    :param kw: Refer to :func:`connect_to_syslog()`.
    :returns: A :class:`~logging.handlers.SysLogHandler` object or
              :data:`None`. If an existing handler is found and `reconfigure`
              is :data:`False` the existing handler object is returned. If the
              connection to the system logging daemon fails :data:`None` is
              returned.

    As of release 15.0 this function uses :func:`is_syslog_supported()` to
    check whether system logging is supported and appropriate before it's
    enabled.

    .. note:: When the logger's effective level is too restrictive it is
              relaxed (refer to `notes about log levels`_ for details).
    """
    # Check whether system logging is supported / appropriate.
    if not is_syslog_supported():
        return None
    # Provide defaults for omitted arguments.
    programname = programname or find_program_name()
    logger = logger or logging.getLogger()
    fmt = fmt or DEFAULT_LOG_FORMAT
    level = level_to_number(kw.get('level', DEFAULT_LOG_LEVEL))
    # Check whether system logging is already enabled.
    handler, logger = replace_handler(logger, match_syslog_handler, reconfigure)
    # Make sure reconfiguration is allowed or not relevant.
    if not (handler and not reconfigure):
        # Create a system logging handler.
        handler = connect_to_syslog(**kw)
        # Make sure the handler was successfully created.
        if handler:
            # Enable the use of %(programname)s.
            ProgramNameFilter.install(handler=handler, fmt=fmt, programname=programname)
            # Connect the formatter, handler and logger.
            handler.setFormatter(logging.Formatter(fmt))
            logger.addHandler(handler)
            # Adjust the level of the selected logger.
            adjust_level(logger, level)
    return handler


def connect_to_syslog(address=None, facility=None, level=None):
    """
    Create a :class:`~logging.handlers.SysLogHandler`.

    :param address: The device file or network address of the system logging
                    daemon (a string or tuple, defaults to the result of
                    :func:`find_syslog_address()`).
    :param facility: Refer to :class:`~logging.handlers.SysLogHandler`.
                     Defaults to ``LOG_USER``.
    :param level: The logging level for the :class:`~logging.handlers.SysLogHandler`
                  (defaults to :data:`.DEFAULT_LOG_LEVEL`). This value is coerced
                  using :func:`~coloredlogs.level_to_number()`.
    :returns: A :class:`~logging.handlers.SysLogHandler` object or :data:`None` (if the
              system logging daemon is unavailable).

    The process of connecting to the system logging daemon goes as follows:

    - The following two socket types are tried (in decreasing preference):

       1. :data:`~socket.SOCK_RAW` avoids truncation of log messages but may
          not be supported.
       2. :data:`~socket.SOCK_STREAM` (TCP) supports longer messages than the
          default (which is UDP).
    """
    if not address:
        address = find_syslog_address()
    if facility is None:
        facility = logging.handlers.SysLogHandler.LOG_USER
    if level is None:
        level = DEFAULT_LOG_LEVEL
    for socktype in socket.SOCK_RAW, socket.SOCK_STREAM, None:
        kw = dict(facility=facility, address=address)
        if socktype is not None:
            kw['socktype'] = socktype
        try:
            handler = logging.handlers.SysLogHandler(**kw)
        except IOError:
            # IOError is a superclass of socket.error which can be raised if the system
            # logging daemon is unavailable.
            pass
        else:
            handler.setLevel(level_to_number(level))
            return handler


def find_syslog_address():
    """
    Find the most suitable destination for system log messages.

    :returns: The pathname of a log device (a string) or an address/port tuple as
              supported by :class:`~logging.handlers.SysLogHandler`.

    On Mac OS X this prefers :data:`LOG_DEVICE_MACOSX`, after that :data:`LOG_DEVICE_UNIX`
    is checked for existence. If both of these device files don't exist the default used
    by :class:`~logging.handlers.SysLogHandler` is returned.
    """
    if sys.platform == 'darwin' and os.path.exists(LOG_DEVICE_MACOSX):
        return LOG_DEVICE_MACOSX
    elif os.path.exists(LOG_DEVICE_UNIX):
        return LOG_DEVICE_UNIX
    else:
        return 'localhost', logging.handlers.SYSLOG_UDP_PORT


def is_syslog_supported():
    """
    Determine whether system logging is supported.

    :returns:

        :data:`True` if system logging is supported and can be enabled,
        :data:`False` if system logging is not supported or there are good
        reasons for not enabling it.

    The decision making process here is as follows:

    Override
     If the environment variable ``$COLOREDLOGS_SYSLOG`` is set it is evaluated
     using :func:`~humanfriendly.coerce_boolean()` and the resulting value
     overrides the platform detection discussed below, this allows users to
     override the decision making process if they disagree / know better.

    Linux / UNIX
     On systems that are not Windows or MacOS (see below) we assume UNIX which
     means either syslog is available or sending a bunch of UDP packets to
     nowhere won't hurt anyone...

    Microsoft Windows
     Over the years I've had multiple reports of :pypi:`coloredlogs` spewing
     extremely verbose errno 10057 warning messages to the console (once for
     each log message I suppose) so I now assume it a default that
     "syslog-style system logging" is not generally available on Windows.

    Apple MacOS
     There's cPython issue `#38780`_ which seems to result in a fatal exception
     when the Python interpreter shuts down. This is (way) worse than not
     having system logging enabled. The error message mentioned in `#38780`_
     has actually been following me around for years now, see for example:

     - https://github.com/xolox/python-rotate-backups/issues/9 mentions Docker
       images implying Linux, so not strictly the same as `#38780`_.

     - https://github.com/xolox/python-npm-accel/issues/4 is definitely related
       to `#38780`_ and is what eventually prompted me to add the
       :func:`is_syslog_supported()` logic.

    .. _#38780: https://bugs.python.org/issue38780
    """
    override = os.environ.get("COLOREDLOGS_SYSLOG")
    if override is not None:
        return coerce_boolean(override)
    else:
        return not (on_windows() or on_macos())


def match_syslog_handler(handler):
    """
    Identify system logging handlers.

    :param handler: The :class:`~logging.Handler` class to check.
    :returns: :data:`True` if the handler is a
              :class:`~logging.handlers.SysLogHandler`,
              :data:`False` otherwise.

    This function can be used as a callback for :func:`.find_handler()`.
    """
    return isinstance(handler, logging.handlers.SysLogHandler)
