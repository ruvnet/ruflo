# Colored terminal output for Python's logging module.
#
# Author: Peter Odding <peter@peterodding.com>
# Last Change: June 11, 2021
# URL: https://coloredlogs.readthedocs.io

"""
Colored terminal output for Python's :mod:`logging` module.

.. contents::
   :local:

Getting started
===============

The easiest way to get started is by importing :mod:`coloredlogs` and calling
:mod:`coloredlogs.install()` (similar to :func:`logging.basicConfig()`):

 >>> import coloredlogs, logging
 >>> coloredlogs.install(level='DEBUG')
 >>> logger = logging.getLogger('some.module.name')
 >>> logger.info("this is an informational message")
 2015-10-22 19:13:52 peter-macbook some.module.name[28036] INFO this is an informational message

The :mod:`~coloredlogs.install()` function creates a :class:`ColoredFormatter`
that injects `ANSI escape sequences`_ into the log output.

.. _ANSI escape sequences: https://en.wikipedia.org/wiki/ANSI_escape_code#Colors

Environment variables
=====================

The following environment variables can be used to configure the
:mod:`coloredlogs` module without writing any code:

=============================  ============================  ==================================
Environment variable           Default value                 Type of value
=============================  ============================  ==================================
``$COLOREDLOGS_AUTO_INSTALL``  'false'                       a boolean that controls whether
                                                             :func:`auto_install()` is called
``$COLOREDLOGS_LOG_LEVEL``     'INFO'                        a log level name
``$COLOREDLOGS_LOG_FORMAT``    :data:`DEFAULT_LOG_FORMAT`    a log format string
``$COLOREDLOGS_DATE_FORMAT``   :data:`DEFAULT_DATE_FORMAT`   a date/time format string
``$COLOREDLOGS_LEVEL_STYLES``  :data:`DEFAULT_LEVEL_STYLES`  see :func:`parse_encoded_styles()`
``$COLOREDLOGS_FIELD_STYLES``  :data:`DEFAULT_FIELD_STYLES`  see :func:`parse_encoded_styles()`
=============================  ============================  ==================================

If the environment variable `$NO_COLOR`_ is set (the value doesn't matter, even
an empty string will do) then :func:`coloredlogs.install()` will take this as a
hint that colors should not be used (unless the ``isatty=True`` override was
passed by the caller).

.. _$NO_COLOR: https://no-color.org/

Examples of customization
=========================

Here we'll take a look at some examples of how you can customize
:mod:`coloredlogs` using environment variables.

.. contents::
   :local:

About the defaults
------------------

Here's a screen shot of the default configuration for easy comparison with the
screen shots of the following customizations (this is the same screen shot that
is shown in the introduction):

.. image:: images/defaults.png
   :alt: Screen shot of colored logging with defaults.

The screen shot above was taken from ``urxvt`` which doesn't support faint text
colors, otherwise the color of green used for `debug` messages would have
differed slightly from the color of green used for `spam` messages.

Apart from the `faint` style of the `spam` level, the default configuration of
`coloredlogs` sticks to the eight color palette defined by the original ANSI
standard, in order to provide a somewhat consistent experience across terminals
and terminal emulators.

Available text styles and colors
--------------------------------

Of course you are free to customize the default configuration, in this case you
can use any text style or color that you know is supported by your terminal.
You can use the ``humanfriendly --demo`` command to try out the supported text
styles and colors:

.. image:: http://humanfriendly.readthedocs.io/en/latest/_images/ansi-demo.png
   :alt: Screen shot of the 'humanfriendly --demo' command.

Changing the log format
-----------------------

The simplest customization is to change the log format, for example:

.. literalinclude:: examples/custom-log-format.txt
   :language: console

Here's what that looks like in a terminal (I always work in terminals with a
black background and white text):

.. image:: images/custom-log-format.png
   :alt: Screen shot of colored logging with custom log format.

Changing the date/time format
-----------------------------

You can also change the date/time format, for example you can remove the date
part and leave only the time:

.. literalinclude:: examples/custom-datetime-format.txt
   :language: console

Here's what it looks like in a terminal:

.. image:: images/custom-datetime-format.png
   :alt: Screen shot of colored logging with custom date/time format.

Changing the colors/styles
--------------------------

Finally you can customize the colors and text styles that are used:

.. literalinclude:: examples/custom-colors.txt
   :language: console

Here's an explanation of the features used here:

- The numbers used in ``$COLOREDLOGS_LEVEL_STYLES`` demonstrate the use of 256
  color mode (the numbers refer to the 256 color mode palette which is fixed).

- The `success` level demonstrates the use of a text style (bold).

- The `critical` level demonstrates the use of a background color (red).

Of course none of this can be seen in the shell transcript quoted above, but
take a look at the following screen shot:

.. image:: images/custom-colors.png
   :alt: Screen shot of colored logging with custom colors.

.. _notes about log levels:

Some notes about log levels
===========================

With regards to the handling of log levels, the :mod:`coloredlogs` package
differs from Python's :mod:`logging` module in two aspects:

1. While the :mod:`logging` module uses the default logging level
   :data:`logging.WARNING`, the :mod:`coloredlogs` package has always used
   :data:`logging.INFO` as its default log level.

2. When logging to the terminal or system log is initialized by
   :func:`install()` or :func:`.enable_system_logging()` the effective
   level [#]_ of the selected logger [#]_ is compared against the requested
   level [#]_ and if the effective level is more restrictive than the requested
   level, the logger's level will be set to the requested level (this happens
   in :func:`adjust_level()`). The reason for this is to work around a
   combination of design choices in Python's :mod:`logging` module that can
   easily confuse people who aren't already intimately familiar with it:

   - All loggers are initialized with the level :data:`logging.NOTSET`.

   - When a logger's level is set to :data:`logging.NOTSET` the
     :func:`~logging.Logger.getEffectiveLevel()` method will
     fall back to the level of the parent logger.

   - The parent of all loggers is the root logger and the root logger has its
     level set to :data:`logging.WARNING` by default (after importing the
     :mod:`logging` module).

   Effectively all user defined loggers inherit the default log level
   :data:`logging.WARNING` from the root logger, which isn't very intuitive for
   those who aren't already familiar with the hierarchical nature of the
   :mod:`logging` module.

   By avoiding this potentially confusing behavior (see `#14`_, `#18`_, `#21`_,
   `#23`_ and `#24`_), while at the same time allowing the caller to specify a
   logger object, my goal and hope is to provide sane defaults that can easily
   be changed when the need arises.

   .. [#] Refer to :func:`logging.Logger.getEffectiveLevel()` for details.
   .. [#] The logger that is passed as an argument by the caller or the root
          logger which is selected as a default when no logger is provided.
   .. [#] The log level that is passed as an argument by the caller or the
          default log level :data:`logging.INFO` when no level is provided.

   .. _#14: https://github.com/xolox/python-coloredlogs/issues/14
   .. _#18: https://github.com/xolox/python-coloredlogs/issues/18
   .. _#21: https://github.com/xolox/python-coloredlogs/pull/21
   .. _#23: https://github.com/xolox/python-coloredlogs/pull/23
   .. _#24: https://github.com/xolox/python-coloredlogs/issues/24

Classes and functions
=====================
"""

# Standard library modules.
import collections
import logging
import os
import re
import socket
import sys

# External dependencies.
from humanfriendly import coerce_boolean
from humanfriendly.compat import coerce_string, is_string, on_windows
from humanfriendly.terminal import ANSI_COLOR_CODES, ansi_wrap, enable_ansi_support, terminal_supports_colors
from humanfriendly.text import format, split

# Semi-standard module versioning.
__version__ = '15.0.1'

DEFAULT_LOG_LEVEL = logging.INFO
"""The default log level for :mod:`coloredlogs` (:data:`logging.INFO`)."""

DEFAULT_LOG_FORMAT = '%(asctime)s %(hostname)s %(name)s[%(process)d] %(levelname)s %(message)s'
"""The default log format for :class:`ColoredFormatter` objects (a string)."""

DEFAULT_DATE_FORMAT = '%Y-%m-%d %H:%M:%S'
"""The default date/time format for :class:`ColoredFormatter` objects (a string)."""

CHROOT_FILES = ['/etc/debian_chroot']
"""A list of filenames that indicate a chroot and contain the name of the chroot."""

DEFAULT_FIELD_STYLES = dict(
    asctime=dict(color='green'),
    hostname=dict(color='magenta'),
    levelname=dict(color='black', bold=True),
    name=dict(color='blue'),
    programname=dict(color='cyan'),
    username=dict(color='yellow'),
)
"""Mapping of log format names to default font styles."""

DEFAULT_LEVEL_STYLES = dict(
    spam=dict(color='green', faint=True),
    debug=dict(color='green'),
    verbose=dict(color='blue'),
    info=dict(),
    notice=dict(color='magenta'),
    warning=dict(color='yellow'),
    success=dict(color='green', bold=True),
    error=dict(color='red'),
    critical=dict(color='red', bold=True),
)
"""Mapping of log level names to default font styles."""

DEFAULT_FORMAT_STYLE = '%'
"""The default logging format style (a single character)."""

FORMAT_STYLE_PATTERNS = {
    '%': r'%\((\w+)\)[#0 +-]*\d*(?:\.\d+)?[hlL]?[diouxXeEfFgGcrs%]',
    '{': r'{(\w+)[^}]*}',
    '$': r'\$(\w+)|\${(\w+)}',
}
"""
A dictionary that maps the `style` characters ``%``, ``{`` and ``$`` (see the
documentation of the :class:`python3:logging.Formatter` class in Python 3.2+)
to strings containing regular expression patterns that can be used to parse
format strings in the corresponding style:

``%``
 A string containing a regular expression that matches a "percent conversion
 specifier" as defined in the `String Formatting Operations`_ section of the
 Python documentation. Here's an example of a logging format string in this
 format: ``%(levelname)s:%(name)s:%(message)s``.

``{``
 A string containing a regular expression that matches a "replacement field" as
 defined in the `Format String Syntax`_ section of the Python documentation.
 Here's an example of a logging format string in this format:
 ``{levelname}:{name}:{message}``.

``$``
 A string containing a regular expression that matches a "substitution
 placeholder" as defined in the `Template Strings`_ section of the Python
 documentation. Here's an example of a logging format string in this format:
 ``$levelname:$name:$message``.

These regular expressions are used by :class:`FormatStringParser` to introspect
and manipulate logging format strings.

.. _String Formatting Operations: https://docs.python.org/2/library/stdtypes.html#string-formatting
.. _Format String Syntax: https://docs.python.org/2/library/string.html#formatstrings
.. _Template Strings: https://docs.python.org/3/library/string.html#template-strings
"""


def auto_install():
    """
    Automatically call :func:`install()` when ``$COLOREDLOGS_AUTO_INSTALL`` is set.

    The `coloredlogs` package includes a `path configuration file`_ that
    automatically imports the :mod:`coloredlogs` module and calls
    :func:`auto_install()` when the environment variable
    ``$COLOREDLOGS_AUTO_INSTALL`` is set.

    This function uses :func:`~humanfriendly.coerce_boolean()` to check whether
    the value of ``$COLOREDLOGS_AUTO_INSTALL`` should be considered :data:`True`.

    .. _path configuration file: https://docs.python.org/2/library/site.html#module-site
    """
    if coerce_boolean(os.environ.get('COLOREDLOGS_AUTO_INSTALL', 'false')):
        install()


def install(level=None, **kw):
    """
    Enable colored terminal output for Python's :mod:`logging` module.

    :param level: The default logging level (an integer or a string with a
                  level name, defaults to :data:`DEFAULT_LOG_LEVEL`).
    :param logger: The logger to which the stream handler should be attached (a
                   :class:`~logging.Logger` object, defaults to the root logger).
    :param fmt: Set the logging format (a string like those accepted by
                :class:`~logging.Formatter`, defaults to
                :data:`DEFAULT_LOG_FORMAT`).
    :param datefmt: Set the date/time format (a string, defaults to
                    :data:`DEFAULT_DATE_FORMAT`).
    :param style: One of the characters ``%``, ``{`` or ``$`` (defaults to
                  :data:`DEFAULT_FORMAT_STYLE`). See the documentation of the
                  :class:`python3:logging.Formatter` class in Python 3.2+. On
                  older Python versions only ``%`` is supported.
    :param milliseconds: :data:`True` to show milliseconds like :mod:`logging`
                         does by default, :data:`False` to hide milliseconds
                         (the default is :data:`False`, see `#16`_).
    :param level_styles: A dictionary with custom level styles (defaults to
                         :data:`DEFAULT_LEVEL_STYLES`).
    :param field_styles: A dictionary with custom field styles (defaults to
                         :data:`DEFAULT_FIELD_STYLES`).
    :param stream: The stream where log messages should be written to (a
                   file-like object). This defaults to :data:`None` which
                   means :class:`StandardErrorHandler` is used.
    :param isatty: :data:`True` to use a :class:`ColoredFormatter`,
                   :data:`False` to use a normal :class:`~logging.Formatter`
                   (defaults to auto-detection using
                   :func:`~humanfriendly.terminal.terminal_supports_colors()`).
    :param reconfigure: If :data:`True` (the default) multiple calls to
                        :func:`coloredlogs.install()` will each override
                        the previous configuration.
    :param use_chroot: Refer to :class:`HostNameFilter`.
    :param programname: Refer to :class:`ProgramNameFilter`.
    :param username: Refer to :class:`UserNameFilter`.
    :param syslog: If :data:`True` then :func:`.enable_system_logging()` will
                   be called without arguments (defaults to :data:`False`). The
                   `syslog` argument may also be a number or string, in this
                   case it is assumed to be a logging level which is passed on
                   to :func:`.enable_system_logging()`.

    The :func:`coloredlogs.install()` function is similar to
    :func:`logging.basicConfig()`, both functions take a lot of optional
    keyword arguments but try to do the right thing by default:

    1. If `reconfigure` is :data:`True` (it is by default) and an existing
       :class:`~logging.StreamHandler` is found that is connected to either
       :data:`~sys.stdout` or :data:`~sys.stderr` the handler will be removed.
       This means that first calling :func:`logging.basicConfig()` and then
       calling :func:`coloredlogs.install()` will replace the stream handler
       instead of adding a duplicate stream handler. If `reconfigure` is
       :data:`False` and an existing handler is found no further steps are
       taken (to avoid installing a duplicate stream handler).

    2. A :class:`~logging.StreamHandler` is created and connected to the stream
       given by the `stream` keyword argument (:data:`sys.stderr` by
       default). The stream handler's level is set to the value of the `level`
       keyword argument.

    3. A :class:`ColoredFormatter` is created if the `isatty` keyword argument
       allows it (or auto-detection allows it), otherwise a normal
       :class:`~logging.Formatter` is created. The formatter is initialized
       with the `fmt` and `datefmt` keyword arguments (or their computed
       defaults).

       The environment variable ``$NO_COLOR`` is taken as a hint by
       auto-detection that colors should not be used.

    4. :func:`HostNameFilter.install()`, :func:`ProgramNameFilter.install()`
       and :func:`UserNameFilter.install()` are called to enable the use of
       additional fields in the log format.

    5. If the logger's level is too restrictive it is relaxed (refer to `notes
       about log levels`_ for details).

    6. The formatter is added to the handler and the handler is added to the
       logger.

    .. _#16: https://github.com/xolox/python-coloredlogs/issues/16
    """
    logger = kw.get('logger') or logging.getLogger()
    reconfigure = kw.get('reconfigure', True)
    stream = kw.get('stream') or sys.stderr
    style = check_style(kw.get('style') or DEFAULT_FORMAT_STYLE)
    # Get the log level from an argument, environment variable or default and
    # convert the names of log levels to numbers to enable numeric comparison.
    if level is None:
        level = os.environ.get('COLOREDLOGS_LOG_LEVEL', DEFAULT_LOG_LEVEL)
    level = level_to_number(level)
    # Remove any existing stream handler that writes to stdout or stderr, even
    # if the stream handler wasn't created by coloredlogs because multiple
    # stream handlers (in the same hierarchy) writing to stdout or stderr would
    # create duplicate output.  `None' is a synonym for the possibly dynamic
    # value of the stderr attribute of the sys module.
    match_streams = ([sys.stdout, sys.stderr]
                     if stream in [sys.stdout, sys.stderr, None]
                     else [stream])
    match_handler = lambda handler: match_stream_handler(handler, match_streams)
    handler, logger = replace_handler(logger, match_handler, reconfigure)
    # Make sure reconfiguration is allowed or not relevant.
    if not (handler and not reconfigure):
        # Make it easy to enable system logging.
        syslog_enabled = kw.get('syslog')
        # We ignore the value `None' because it means the caller didn't opt in
        # to system logging and `False' because it means the caller explicitly
        # opted out of system logging.
        if syslog_enabled not in (None, False):
            from coloredlogs.syslog import enable_system_logging
            if syslog_enabled is True:
                # If the caller passed syslog=True then we leave the choice of
                # default log level up to the coloredlogs.syslog module.
                enable_system_logging()
            else:
                # Values other than (None, True, False) are assumed to
                # represent a logging level for system logging.
                enable_system_logging(level=syslog_enabled)
        # Figure out whether we can use ANSI escape sequences.
        use_colors = kw.get('isatty', None)
        # In the following indented block the expression (use_colors is None)
        # can be read as "auto detect is enabled and no reason has yet been
        # found to automatically disable color support".
        if use_colors or (use_colors is None):
            # Respect the user's choice not to have colors.
            if use_colors is None and 'NO_COLOR' in os.environ:
                # For details on this see https://no-color.org/.
                use_colors = False
            # Try to enable Windows native ANSI support or Colorama?
            if (use_colors or use_colors is None) and on_windows():
                # This can fail, in which case ANSI escape sequences would end
                # up being printed to the terminal in raw form. This is very
                # user hostile, so to avoid this happening we disable color
                # support on failure.
                use_colors = enable_ansi_support()
            # When auto detection is enabled, and so far we encountered no
            # reason to disable color support, then we will enable color
            # support if 'stream' is connected to a terminal.
            if use_colors is None:
                use_colors = terminal_supports_colors(stream)
        # Create a stream handler and make sure to preserve any filters
        # the current handler may have (if an existing handler is found).
        filters = handler.filters if handler else None
        if stream is sys.stderr:
            handler = StandardErrorHandler()
        else:
            handler = logging.StreamHandler(stream)
        handler.setLevel(level)
        if filters:
            handler.filters = filters
        # Prepare the arguments to the formatter, allowing the caller to
        # customize the values of `fmt', `datefmt' and `style' as desired.
        formatter_options = dict(fmt=kw.get('fmt'), datefmt=kw.get('datefmt'))
        # Only pass the `style' argument to the formatter when the caller
        # provided an alternative logging format style. This prevents
        # TypeError exceptions on Python versions before 3.2.
        if style != DEFAULT_FORMAT_STYLE:
            formatter_options['style'] = style
        # Come up with a default log format?
        if not formatter_options['fmt']:
            # Use the log format defined by the environment variable
            # $COLOREDLOGS_LOG_FORMAT or fall back to the default.
            formatter_options['fmt'] = os.environ.get('COLOREDLOGS_LOG_FORMAT') or DEFAULT_LOG_FORMAT
        # If the caller didn't specify a date/time format we'll use the format
        # defined by the environment variable $COLOREDLOGS_DATE_FORMAT (or fall
        # back to the default).
        if not formatter_options['datefmt']:
            formatter_options['datefmt'] = os.environ.get('COLOREDLOGS_DATE_FORMAT') or DEFAULT_DATE_FORMAT
        # Python's logging module shows milliseconds by default through special
        # handling in the logging.Formatter.formatTime() method [1]. Because
        # coloredlogs always defines a `datefmt' it bypasses this special
        # handling, which is fine because ever since publishing coloredlogs
        # I've never needed millisecond precision ;-). However there are users
        # of coloredlogs that do want milliseconds to be shown [2] so we
        # provide a shortcut to make it easy.
        #
        # [1] https://stackoverflow.com/questions/6290739/python-logging-use-milliseconds-in-time-format
        # [2] https://github.com/xolox/python-coloredlogs/issues/16
        if kw.get('milliseconds'):
            parser = FormatStringParser(style=style)
            if not (parser.contains_field(formatter_options['fmt'], 'msecs')
                    or '%f' in formatter_options['datefmt']):
                pattern = parser.get_pattern('asctime')
                replacements = {'%': '%(msecs)03d', '{': '{msecs:03}', '$': '${msecs}'}
                formatter_options['fmt'] = pattern.sub(
                    r'\g<0>,' + replacements[style],
                    formatter_options['fmt'],
                )
        # Do we need to make %(hostname) available to the formatter?
        HostNameFilter.install(
            fmt=formatter_options['fmt'],
            handler=handler,
            style=style,
            use_chroot=kw.get('use_chroot', True),
        )
        # Do we need to make %(programname) available to the formatter?
        ProgramNameFilter.install(
            fmt=formatter_options['fmt'],
            handler=handler,
            programname=kw.get('programname'),
            style=style,
        )
        # Do we need to make %(username) available to the formatter?
        UserNameFilter.install(
            fmt=formatter_options['fmt'],
            handler=handler,
            username=kw.get('username'),
            style=style,
        )
        # Inject additional formatter arguments specific to ColoredFormatter?
        if use_colors:
            for name, environment_name in (('field_styles', 'COLOREDLOGS_FIELD_STYLES'),
                                           ('level_styles', 'COLOREDLOGS_LEVEL_STYLES')):
                value = kw.get(name)
                if value is None:
                    # If no styles have been specified we'll fall back
                    # to the styles defined by the environment variable.
                    environment_value = os.environ.get(environment_name)
                    if environment_value is not None:
                        value = parse_encoded_styles(environment_value)
                if value is not None:
                    formatter_options[name] = value
        # Create a (possibly colored) formatter.
        formatter_type = ColoredFormatter if use_colors else BasicFormatter
        handler.setFormatter(formatter_type(**formatter_options))
        # Adjust the level of the selected logger.
        adjust_level(logger, level)
        # Install the stream handler.
        logger.addHandler(handler)


def check_style(value):
    """
    Validate a logging format style.

    :param value: The logging format style to validate (any value).
    :returns: The logging format character (a string of one character).
    :raises: :exc:`~exceptions.ValueError` when the given style isn't supported.

    On Python 3.2+ this function accepts the logging format styles ``%``, ``{``
    and ``$`` while on older versions only ``%`` is accepted (because older
    Python versions don't support alternative logging format styles).
    """
    if sys.version_info[:2] >= (3, 2):
        if value not in FORMAT_STYLE_PATTERNS:
            msg = "Unsupported logging format style! (%r)"
            raise ValueError(format(msg, value))
    elif value != DEFAULT_FORMAT_STYLE:
        msg = "Format string styles other than %r require Python 3.2+!"
        raise ValueError(msg, DEFAULT_FORMAT_STYLE)
    return value


def increase_verbosity():
    """
    Increase the verbosity of the root handler by one defined level.

    Understands custom logging levels like defined by my ``verboselogs``
    module.
    """
    defined_levels = sorted(set(find_defined_levels().values()))
    current_index = defined_levels.index(get_level())
    selected_index = max(0, current_index - 1)
    set_level(defined_levels[selected_index])


def decrease_verbosity():
    """
    Decrease the verbosity of the root handler by one defined level.

    Understands custom logging levels like defined by my ``verboselogs``
    module.
    """
    defined_levels = sorted(set(find_defined_levels().values()))
    current_index = defined_levels.index(get_level())
    selected_index = min(current_index + 1, len(defined_levels) - 1)
    set_level(defined_levels[selected_index])


def is_verbose():
    """
    Check whether the log level of the root handler is set to a verbose level.

    :returns: ``True`` if the root handler is verbose, ``False`` if not.
    """
    return get_level() < DEFAULT_LOG_LEVEL


def get_level():
    """
    Get the logging level of the root handler.

    :returns: The logging level of the root handler (an integer) or
              :data:`DEFAULT_LOG_LEVEL` (if no root handler exists).
    """
    handler, logger = find_handler(logging.getLogger(), match_stream_handler)
    return handler.level if handler else DEFAULT_LOG_LEVEL


def set_level(level):
    """
    Set the logging level of the root handler.

    :param level: The logging level to filter on (an integer or string).

    If no root handler exists yet this automatically calls :func:`install()`.
    """
    handler, logger = find_handler(logging.getLogger(), match_stream_handler)
    if handler and logger:
        # Change the level of the existing handler.
        handler.setLevel(level_to_number(level))
        # Adjust the level of the selected logger.
        adjust_level(logger, level)
    else:
        # Create a new handler with the given level.
        install(level=level)


def adjust_level(logger, level):
    """
    Increase a logger's verbosity up to the requested level.

    :param logger: The logger to change (a :class:`~logging.Logger` object).
    :param level: The log level to enable (a string or number).

    This function is used by functions like :func:`install()`,
    :func:`increase_verbosity()` and :func:`.enable_system_logging()` to adjust
    a logger's level so that log messages up to the requested log level are
    propagated to the configured output handler(s).

    It uses :func:`logging.Logger.getEffectiveLevel()` to check whether
    `logger` propagates or swallows log messages of the requested `level` and
    sets the logger's level to the requested level if it would otherwise
    swallow log messages.

    Effectively this function will "widen the scope of logging" when asked to
    do so but it will never "narrow the scope of logging". This is because I am
    convinced that filtering of log messages should (primarily) be decided by
    handlers.
    """
    level = level_to_number(level)
    if logger.getEffectiveLevel() > level:
        logger.setLevel(level)


def find_defined_levels():
    """
    Find the defined logging levels.

    :returns: A dictionary with level names as keys and integers as values.

    Here's what the result looks like by default (when
    no custom levels or level names have been defined):

    >>> find_defined_levels()
    {'NOTSET': 0,
     'DEBUG': 10,
     'INFO': 20,
     'WARN': 30,
     'WARNING': 30,
     'ERROR': 40,
     'FATAL': 50,
     'CRITICAL': 50}
    """
    defined_levels = {}
    for name in dir(logging):
        if name.isupper():
            value = getattr(logging, name)
            if isinstance(value, int):
                defined_levels[name] = value
    return defined_levels


def level_to_number(value):
    """
    Coerce a logging level name to a number.

    :param value: A logging level (integer or string).
    :returns: The number of the log level (an integer).

    This function translates log level names into their numeric values..
    """
    if is_string(value):
        try:
            defined_levels = find_defined_levels()
            value = defined_levels[value.upper()]
        except KeyError:
            # Don't fail on unsupported log levels.
            value = DEFAULT_LOG_LEVEL
    return value


def find_level_aliases():
    """
    Find log level names which are aliases of each other.

    :returns: A dictionary that maps aliases to their canonical name.

    .. note:: Canonical names are chosen to be the alias with the longest
              string length so that e.g. ``WARN`` is an alias for ``WARNING``
              instead of the other way around.

    Here's what the result looks like by default (when
    no custom levels or level names have been defined):

    >>> from coloredlogs import find_level_aliases
    >>> find_level_aliases()
    {'WARN': 'WARNING', 'FATAL': 'CRITICAL'}
    """
    mapping = collections.defaultdict(list)
    for name, value in find_defined_levels().items():
        mapping[value].append(name)
    aliases = {}
    for value, names in mapping.items():
        if len(names) > 1:
            names = sorted(names, key=lambda n: len(n))
            canonical_name = names.pop()
            for alias in names:
                aliases[alias] = canonical_name
    return aliases


def parse_encoded_styles(text, normalize_key=None):
    """
    Parse text styles encoded in a string into a nested data structure.

    :param text: The encoded styles (a string).
    :returns: A dictionary in the structure of the :data:`DEFAULT_FIELD_STYLES`
              and :data:`DEFAULT_LEVEL_STYLES` dictionaries.

    Here's an example of how this function works:

    >>> from coloredlogs import parse_encoded_styles
    >>> from pprint import pprint
    >>> encoded_styles = 'debug=green;warning=yellow;error=red;critical=red,bold'
    >>> pprint(parse_encoded_styles(encoded_styles))
    {'debug': {'color': 'green'},
     'warning': {'color': 'yellow'},
     'error': {'color': 'red'},
     'critical': {'bold': True, 'color': 'red'}}
    """
    parsed_styles = {}
    for assignment in split(text, ';'):
        name, _, styles = assignment.partition('=')
        target = parsed_styles.setdefault(name, {})
        for token in split(styles, ','):
            # When this code was originally written, setting background colors
            # wasn't supported yet, so there was no need to disambiguate
            # between the text color and background color. This explains why
            # a color name or number implies setting the text color (for
            # backwards compatibility).
            if token.isdigit():
                target['color'] = int(token)
            elif token in ANSI_COLOR_CODES:
                target['color'] = token
            elif '=' in token:
                name, _, value = token.partition('=')
                if name in ('color', 'background'):
                    if value.isdigit():
                        target[name] = int(value)
                    elif value in ANSI_COLOR_CODES:
                        target[name] = value
            else:
                target[token] = True
    return parsed_styles


def find_hostname(use_chroot=True):
    """
    Find the host name to include in log messages.

    :param use_chroot: Use the name of the chroot when inside a chroot?
                       (boolean, defaults to :data:`True`)
    :returns: A suitable host name (a string).

    Looks for :data:`CHROOT_FILES` that have a nonempty first line (taken to be
    the chroot name). If none are found then :func:`socket.gethostname()` is
    used as a fall back.
    """
    for chroot_file in CHROOT_FILES:
        try:
            with open(chroot_file) as handle:
                first_line = next(handle)
                name = first_line.strip()
                if name:
                    return name
        except Exception:
            pass
    return socket.gethostname()


def find_program_name():
    """
    Select a suitable program name to embed in log messages.

    :returns: One of the following strings (in decreasing order of preference):

              1. The base name of the currently running Python program or
                 script (based on the value at index zero of :data:`sys.argv`).
              2. The base name of the Python executable (based on
                 :data:`sys.executable`).
              3. The string 'python'.
    """
    # Gotcha: sys.argv[0] is '-c' if Python is started with the -c option.
    return ((os.path.basename(sys.argv[0]) if sys.argv and sys.argv[0] != '-c' else '')
            or (os.path.basename(sys.executable) if sys.executable else '')
            or 'python')


def find_username():
    """
    Find the username to include in log messages.

    :returns: A suitable username (a string).

    On UNIX systems this uses the :mod:`pwd` module which means ``root`` will
    be reported when :man:`sudo` is used (as it should). If this fails (for
    example on Windows) then :func:`getpass.getuser()` is used as a fall back.
    """
    try:
        import pwd
        uid = os.getuid()
        entry = pwd.getpwuid(uid)
        return entry.pw_name
    except Exception:
        import getpass
        return getpass.getuser()


def replace_handler(logger, match_handler, reconfigure):
    """
    Prepare to replace a handler.

    :param logger: Refer to :func:`find_handler()`.
    :param match_handler: Refer to :func:`find_handler()`.
    :param reconfigure: :data:`True` if an existing handler should be replaced,
                        :data:`False` otherwise.
    :returns: A tuple of two values:

              1. The matched :class:`~logging.Handler` object or :data:`None`
                 if no handler was matched.
              2. The :class:`~logging.Logger` to which the matched handler was
                 attached or the logger given to :func:`replace_handler()`.
    """
    handler, other_logger = find_handler(logger, match_handler)
    if handler and other_logger and reconfigure:
        # Remove the existing handler from the logger that its attached to
        # so that we can install a new handler that behaves differently.
        other_logger.removeHandler(handler)
        # Switch to the logger that the existing handler was attached to so
        # that reconfiguration doesn't narrow the scope of logging.
        logger = other_logger
    return handler, logger


def find_handler(logger, match_handler):
    """
    Find a (specific type of) handler in the propagation tree of a logger.

    :param logger: The logger to check (a :class:`~logging.Logger` object).
    :param match_handler: A callable that receives a :class:`~logging.Handler`
                          object and returns :data:`True` to match a handler or
                          :data:`False` to skip that handler and continue
                          searching for a match.
    :returns: A tuple of two values:

              1. The matched :class:`~logging.Handler` object or :data:`None`
                 if no handler was matched.
              2. The :class:`~logging.Logger` object to which the handler is
                 attached or :data:`None` if no handler was matched.

    This function finds a logging handler (of the given type) attached to a
    logger or one of its parents (see :func:`walk_propagation_tree()`). It uses
    the undocumented :class:`~logging.Logger.handlers` attribute to find
    handlers attached to a logger, however it won't raise an exception if the
    attribute isn't available. The advantages of this approach are:

    - This works regardless of whether :mod:`coloredlogs` attached the handler
      or other Python code attached the handler.

    - This will correctly recognize the situation where the given logger has no
      handlers but :attr:`~logging.Logger.propagate` is enabled and the logger
      has a parent logger that does have a handler attached.
    """
    for logger in walk_propagation_tree(logger):
        for handler in getattr(logger, 'handlers', []):
            if match_handler(handler):
                return handler, logger
    return None, None


def match_stream_handler(handler, streams=[]):
    """
    Identify stream handlers writing to the given streams(s).

    :param handler: The :class:`~logging.Handler` class to check.
    :param streams: A sequence of streams to match (defaults to matching
                    :data:`~sys.stdout` and :data:`~sys.stderr`).
    :returns: :data:`True` if the handler is a :class:`~logging.StreamHandler`
              logging to the given stream(s), :data:`False` otherwise.

    This function can be used as a callback for :func:`find_handler()`.
    """
    return (isinstance(handler, logging.StreamHandler)
            and getattr(handler, 'stream') in (streams or (sys.stdout, sys.stderr)))


def walk_propagation_tree(logger):
    """
    Walk through the propagation hierarchy of the given logger.

    :param logger: The logger whose hierarchy to walk (a
                   :class:`~logging.Logger` object).
    :returns: A generator of :class:`~logging.Logger` objects.

    .. note:: This uses the undocumented :class:`logging.Logger.parent`
              attribute to find higher level loggers, however it won't
              raise an exception if the attribute isn't available.
    """
    while isinstance(logger, logging.Logger):
        # Yield the logger to our caller.
        yield logger
        # Check if the logger has propagation enabled.
        if logger.propagate:
            # Continue with the parent logger. We use getattr() because the
            # `parent' attribute isn't documented so properly speaking we
            # shouldn't break if it's not available.
            logger = getattr(logger, 'parent', None)
        else:
            # The propagation chain stops here.
            logger = None


class BasicFormatter(logging.Formatter):

    """
    Log :class:`~logging.Formatter` that supports ``%f`` for millisecond formatting.

    This class extends :class:`~logging.Formatter` to enable the use of ``%f``
    for millisecond formatting in date/time strings, to allow for the type of
    flexibility requested in issue `#45`_.

    .. _#45: https://github.com/xolox/python-coloredlogs/issues/45
    """

    def formatTime(self, record, datefmt=None):
        """
        Format the date/time of a log record.

        :param record: A :class:`~logging.LogRecord` object.
        :param datefmt: A date/time format string (defaults to :data:`DEFAULT_DATE_FORMAT`).
        :returns: The formatted date/time (a string).

        This method overrides :func:`~logging.Formatter.formatTime()` to set
        `datefmt` to :data:`DEFAULT_DATE_FORMAT` when the caller hasn't
        specified a date format.

        When `datefmt` contains the token ``%f`` it will be replaced by the
        value of ``%(msecs)03d`` (refer to issue `#45`_ for use cases).
        """
        # The default value of the following argument is defined here so
        # that Sphinx doesn't embed the default value in the generated
        # documentation (because the result is awkward to read).
        datefmt = datefmt or DEFAULT_DATE_FORMAT
        # Replace %f with the value of %(msecs)03d.
        if '%f' in datefmt:
            datefmt = datefmt.replace('%f', '%03d' % record.msecs)
        # Delegate the actual date/time formatting to the base formatter.
        return logging.Formatter.formatTime(self, record, datefmt)


class ColoredFormatter(BasicFormatter):

    """
    Log :class:`~logging.Formatter` that uses `ANSI escape sequences`_ to create colored logs.

    :class:`ColoredFormatter` inherits from :class:`BasicFormatter` to enable
    the use of ``%f`` for millisecond formatting in date/time strings.

    .. note:: If you want to use :class:`ColoredFormatter` on Windows then you
              need to call :func:`~humanfriendly.terminal.enable_ansi_support()`.
              This is done for you when you call :func:`coloredlogs.install()`.
    """

    def __init__(self, fmt=None, datefmt=None, style=DEFAULT_FORMAT_STYLE, level_styles=None, field_styles=None):
        """
        Initialize a :class:`ColoredFormatter` object.

        :param fmt: A log format string (defaults to :data:`DEFAULT_LOG_FORMAT`).
        :param datefmt: A date/time format string (defaults to :data:`None`,
                        but see the documentation of
                        :func:`BasicFormatter.formatTime()`).
        :param style: One of the characters ``%``, ``{`` or ``$`` (defaults to
                      :data:`DEFAULT_FORMAT_STYLE`)
        :param level_styles: A dictionary with custom level styles
                             (defaults to :data:`DEFAULT_LEVEL_STYLES`).
        :param field_styles: A dictionary with custom field styles
                             (defaults to :data:`DEFAULT_FIELD_STYLES`).
        :raises: Refer to :func:`check_style()`.

        This initializer uses :func:`colorize_format()` to inject ANSI escape
        sequences in the log format string before it is passed to the
        initializer of the base class.
        """
        self.nn = NameNormalizer()
        # The default values of the following arguments are defined here so
        # that Sphinx doesn't embed the default values in the generated
        # documentation (because the result is awkward to read).
        fmt = fmt or DEFAULT_LOG_FORMAT
        self.level_styles = self.nn.normalize_keys(DEFAULT_LEVEL_STYLES if level_styles is None else level_styles)
        self.field_styles = self.nn.normalize_keys(DEFAULT_FIELD_STYLES if field_styles is None else field_styles)
        # Rewrite the format string to inject ANSI escape sequences.
        kw = dict(fmt=self.colorize_format(fmt, style), datefmt=datefmt)
        # If we were given a non-default logging format style we pass it on
        # to our superclass. At this point check_style() will have already
        # complained that the use of alternative logging format styles
        # requires Python 3.2 or newer.
        if style != DEFAULT_FORMAT_STYLE:
            kw['style'] = style
        # Initialize the superclass with the rewritten format string.
        logging.Formatter.__init__(self, **kw)

    def colorize_format(self, fmt, style=DEFAULT_FORMAT_STYLE):
        """
        Rewrite a logging format string to inject ANSI escape sequences.

        :param fmt: The log format string.
        :param style: One of the characters ``%``, ``{`` or ``$`` (defaults to
                      :data:`DEFAULT_FORMAT_STYLE`).
        :returns: The logging format string with ANSI escape sequences.

        This method takes a logging format string like the ones you give to
        :class:`logging.Formatter` and processes it as follows:

        1. First the logging format string is separated into formatting
           directives versus surrounding text (according to the given `style`).

        2. Then formatting directives and surrounding text are grouped
           based on whitespace delimiters (in the surrounding text).

        3. For each group styling is selected as follows:

           1. If the group contains a single formatting directive that has
              a style defined then the whole group is styled accordingly.

           2. If the group contains multiple formatting directives that
              have styles defined then each formatting directive is styled
              individually and surrounding text isn't styled.

        As an example consider the default log format (:data:`DEFAULT_LOG_FORMAT`)::

         %(asctime)s %(hostname)s %(name)s[%(process)d] %(levelname)s %(message)s

        The default field styles (:data:`DEFAULT_FIELD_STYLES`) define a style for the
        `name` field but not for the `process` field, however because both fields
        are part of the same whitespace delimited token they'll be highlighted
        together in the style defined for the `name` field.
        """
        result = []
        parser = FormatStringParser(style=style)
        for group in parser.get_grouped_pairs(fmt):
            applicable_styles = [self.nn.get(self.field_styles, token.name) for token in group if token.name]
            if sum(map(bool, applicable_styles)) == 1:
                # If exactly one (1) field style is available for the group of
                # tokens then all of the tokens will be styled the same way.
                # This provides a limited form of backwards compatibility with
                # the (intended) behavior of coloredlogs before the release of
                # version 10.
                result.append(ansi_wrap(
                    ''.join(token.text for token in group),
                    **next(s for s in applicable_styles if s)
                ))
            else:
                for token in group:
                    text = token.text
                    if token.name:
                        field_styles = self.nn.get(self.field_styles, token.name)
                        if field_styles:
                            text = ansi_wrap(text, **field_styles)
                    result.append(text)
        return ''.join(result)

    def format(self, record):
        """
        Apply level-specific styling to log records.

        :param record: A :class:`~logging.LogRecord` object.
        :returns: The result of :func:`logging.Formatter.format()`.

        This method injects ANSI escape sequences that are specific to the
        level of each log record (because such logic cannot be expressed in the
        syntax of a log format string). It works by making a copy of the log
        record, changing the `msg` field inside the copy and passing the copy
        into the :func:`~logging.Formatter.format()` method of the base
        class.
        """
        style = self.nn.get(self.level_styles, record.levelname)
        # After the introduction of the `Empty' class it was reported in issue
        # 33 that format() can be called when `Empty' has already been garbage
        # collected. This explains the (otherwise rather out of place) `Empty
        # is not None' check in the following `if' statement. The reasoning
        # here is that it's much better to log a message without formatting
        # then to raise an exception ;-).
        #
        # For more details refer to issue 33 on GitHub:
        # https://github.com/xolox/python-coloredlogs/issues/33
        if style and Empty is not None:
            # Due to the way that Python's logging module is structured and
            # documented the only (IMHO) clean way to customize its behavior is
            # to change incoming LogRecord objects before they get to the base
            # formatter. However we don't want to break other formatters and
            # handlers, so we copy the log record.
            #
            # In the past this used copy.copy() but as reported in issue 29
            # (which is reproducible) this can cause deadlocks. The following
            # Python voodoo is intended to accomplish the same thing as
            # copy.copy() without all of the generalization and overhead that
            # we don't need for our -very limited- use case.
            #
            # For more details refer to issue 29 on GitHub:
            # https://github.com/xolox/python-coloredlogs/issues/29
            copy = Empty()
            copy.__class__ = record.__class__
            copy.__dict__.update(record.__dict__)
            copy.msg = ansi_wrap(coerce_string(record.msg), **style)
            record = copy
        # Delegate the remaining formatting to the base formatter.
        return logging.Formatter.format(self, record)


class Empty(object):
    """An empty class used to copy :class:`~logging.LogRecord` objects without reinitializing them."""


class HostNameFilter(logging.Filter):

    """
    Log filter to enable the ``%(hostname)s`` format.

    Python's :mod:`logging` module doesn't expose the system's host name while
    I consider this to be a valuable addition. Fortunately it's very easy to
    expose additional fields in format strings: :func:`filter()` simply sets
    the ``hostname`` attribute of each :class:`~logging.LogRecord` object it
    receives and this is enough to enable the use of the ``%(hostname)s``
    expression in format strings.

    You can install this log filter as follows::

     >>> import coloredlogs, logging
     >>> handler = logging.StreamHandler()
     >>> handler.addFilter(coloredlogs.HostNameFilter())
     >>> handler.setFormatter(logging.Formatter('[%(hostname)s] %(message)s'))
     >>> logger = logging.getLogger()
     >>> logger.addHandler(handler)
     >>> logger.setLevel(logging.INFO)
     >>> logger.info("Does it work?")
     [peter-macbook] Does it work?

    Of course :func:`coloredlogs.install()` does all of this for you :-).
    """

    @classmethod
    def install(cls, handler, fmt=None, use_chroot=True, style=DEFAULT_FORMAT_STYLE):
        """
        Install the :class:`HostNameFilter` on a log handler (only if needed).

        :param fmt: The log format string to check for ``%(hostname)``.
        :param style: One of the characters ``%``, ``{`` or ``$`` (defaults to
                      :data:`DEFAULT_FORMAT_STYLE`).
        :param handler: The logging handler on which to install the filter.
        :param use_chroot: Refer to :func:`find_hostname()`.

        If `fmt` is given the filter will only be installed if `fmt` uses the
        ``hostname`` field. If `fmt` is not given the filter is installed
        unconditionally.
        """
        if fmt:
            parser = FormatStringParser(style=style)
            if not parser.contains_field(fmt, 'hostname'):
                return
        handler.addFilter(cls(use_chroot))

    def __init__(self, use_chroot=True):
        """
        Initialize a :class:`HostNameFilter` object.

        :param use_chroot: Refer to :func:`find_hostname()`.
        """
        self.hostname = find_hostname(use_chroot)

    def filter(self, record):
        """Set each :class:`~logging.LogRecord`'s `hostname` field."""
        # Modify the record.
        record.hostname = self.hostname
        # Don't filter the record.
        return 1


class ProgramNameFilter(logging.Filter):

    """
    Log filter to enable the ``%(programname)s`` format.

    Python's :mod:`logging` module doesn't expose the name of the currently
    running program while I consider this to be a useful addition. Fortunately
    it's very easy to expose additional fields in format strings:
    :func:`filter()` simply sets the ``programname`` attribute of each
    :class:`~logging.LogRecord` object it receives and this is enough to enable
    the use of the ``%(programname)s`` expression in format strings.

    Refer to :class:`HostNameFilter` for an example of how to manually install
    these log filters.
    """

    @classmethod
    def install(cls, handler, fmt, programname=None, style=DEFAULT_FORMAT_STYLE):
        """
        Install the :class:`ProgramNameFilter` (only if needed).

        :param fmt: The log format string to check for ``%(programname)``.
        :param style: One of the characters ``%``, ``{`` or ``$`` (defaults to
                      :data:`DEFAULT_FORMAT_STYLE`).
        :param handler: The logging handler on which to install the filter.
        :param programname: Refer to :func:`__init__()`.

        If `fmt` is given the filter will only be installed if `fmt` uses the
        ``programname`` field. If `fmt` is not given the filter is installed
        unconditionally.
        """
        if fmt:
            parser = FormatStringParser(style=style)
            if not parser.contains_field(fmt, 'programname'):
                return
        handler.addFilter(cls(programname))

    def __init__(self, programname=None):
        """
        Initialize a :class:`ProgramNameFilter` object.

        :param programname: The program name to use (defaults to the result of
                            :func:`find_program_name()`).
        """
        self.programname = programname or find_program_name()

    def filter(self, record):
        """Set each :class:`~logging.LogRecord`'s `programname` field."""
        # Modify the record.
        record.programname = self.programname
        # Don't filter the record.
        return 1


class UserNameFilter(logging.Filter):

    """
    Log filter to enable the ``%(username)s`` format.

    Python's :mod:`logging` module doesn't expose the username of the currently
    logged in user as requested in `#76`_. Given that :class:`HostNameFilter`
    and :class:`ProgramNameFilter` are already provided by `coloredlogs` it
    made sense to provide :class:`UserNameFilter` as well.

    Refer to :class:`HostNameFilter` for an example of how to manually install
    these log filters.

    .. _#76: https://github.com/xolox/python-coloredlogs/issues/76
    """

    @classmethod
    def install(cls, handler, fmt, username=None, style=DEFAULT_FORMAT_STYLE):
        """
        Install the :class:`UserNameFilter` (only if needed).

        :param fmt: The log format string to check for ``%(username)``.
        :param style: One of the characters ``%``, ``{`` or ``$`` (defaults to
                      :data:`DEFAULT_FORMAT_STYLE`).
        :param handler: The logging handler on which to install the filter.
        :param username: Refer to :func:`__init__()`.

        If `fmt` is given the filter will only be installed if `fmt` uses the
        ``username`` field. If `fmt` is not given the filter is installed
        unconditionally.
        """
        if fmt:
            parser = FormatStringParser(style=style)
            if not parser.contains_field(fmt, 'username'):
                return
        handler.addFilter(cls(username))

    def __init__(self, username=None):
        """
        Initialize a :class:`UserNameFilter` object.

        :param username: The username to use (defaults to the
                         result of :func:`find_username()`).
        """
        self.username = username or find_username()

    def filter(self, record):
        """Set each :class:`~logging.LogRecord`'s `username` field."""
        # Modify the record.
        record.username = self.username
        # Don't filter the record.
        return 1


class StandardErrorHandler(logging.StreamHandler):

    """
    A :class:`~logging.StreamHandler` that gets the value of :data:`sys.stderr` for each log message.

    The :class:`StandardErrorHandler` class enables `monkey patching of
    sys.stderr <https://github.com/xolox/python-coloredlogs/pull/31>`_. It's
    basically the same as the ``logging._StderrHandler`` class present in
    Python 3 but it will be available regardless of Python version. This
    handler is used by :func:`coloredlogs.install()` to improve compatibility
    with the Python standard library.
    """

    def __init__(self, level=logging.NOTSET):
        """Initialize a :class:`StandardErrorHandler` object."""
        logging.Handler.__init__(self, level)

    @property
    def stream(self):
        """Get the value of :data:`sys.stderr` (a file-like object)."""
        return sys.stderr


class FormatStringParser(object):

    """
    Shallow logging format string parser.

    This class enables introspection and manipulation of logging format strings
    in the three styles supported by the :mod:`logging` module starting from
    Python 3.2 (``%``, ``{`` and ``$``).
    """

    def __init__(self, style=DEFAULT_FORMAT_STYLE):
        """
        Initialize a :class:`FormatStringParser` object.

        :param style: One of the characters ``%``, ``{`` or ``$`` (defaults to
                      :data:`DEFAULT_FORMAT_STYLE`).
        :raises: Refer to :func:`check_style()`.
        """
        self.style = check_style(style)
        self.capturing_pattern = FORMAT_STYLE_PATTERNS[style]
        # Remove the capture group around the mapping key / field name.
        self.raw_pattern = self.capturing_pattern.replace(r'(\w+)', r'\w+')
        # After removing the inner capture group we add an outer capture group
        # to make the pattern suitable for simple tokenization using re.split().
        self.tokenize_pattern = re.compile('(%s)' % self.raw_pattern, re.VERBOSE)
        # Compile a regular expression for finding field names.
        self.name_pattern = re.compile(self.capturing_pattern, re.VERBOSE)

    def contains_field(self, format_string, field_name):
        """
        Get the field names referenced by a format string.

        :param format_string: The logging format string.
        :returns: A list of strings with field names.
        """
        return field_name in self.get_field_names(format_string)

    def get_field_names(self, format_string):
        """
        Get the field names referenced by a format string.

        :param format_string: The logging format string.
        :returns: A list of strings with field names.
        """
        return self.name_pattern.findall(format_string)

    def get_grouped_pairs(self, format_string):
        """
        Group the results of :func:`get_pairs()` separated by whitespace.

        :param format_string: The logging format string.
        :returns: A list of lists of :class:`FormatStringToken` objects.
        """
        # Step 1: Split simple tokens (without a name) into
        # their whitespace parts and non-whitespace parts.
        separated = []
        pattern = re.compile(r'(\s+)')
        for token in self.get_pairs(format_string):
            if token.name:
                separated.append(token)
            else:
                separated.extend(
                    FormatStringToken(name=None, text=text)
                    for text in pattern.split(token.text) if text
                )
        # Step 2: Group tokens together based on whitespace.
        current_group = []
        grouped_pairs = []
        for token in separated:
            if token.text.isspace():
                if current_group:
                    grouped_pairs.append(current_group)
                grouped_pairs.append([token])
                current_group = []
            else:
                current_group.append(token)
        if current_group:
            grouped_pairs.append(current_group)
        return grouped_pairs

    def get_pairs(self, format_string):
        """
        Tokenize a logging format string and extract field names from tokens.

        :param format_string: The logging format string.
        :returns: A generator of :class:`FormatStringToken` objects.
        """
        for token in self.get_tokens(format_string):
            match = self.name_pattern.search(token)
            name = match.group(1) if match else None
            yield FormatStringToken(name=name, text=token)

    def get_pattern(self, field_name):
        """
        Get a regular expression to match a formatting directive that references the given field name.

        :param field_name: The name of the field to match (a string).
        :returns: A compiled regular expression object.
        """
        return re.compile(self.raw_pattern.replace(r'\w+', field_name), re.VERBOSE)

    def get_tokens(self, format_string):
        """
        Tokenize a logging format string.

        :param format_string: The logging format string.
        :returns: A list of strings with formatting directives separated from surrounding text.
        """
        return [t for t in self.tokenize_pattern.split(format_string) if t]


class FormatStringToken(collections.namedtuple('FormatStringToken', 'text, name')):

    """
    A named tuple for the results of :func:`FormatStringParser.get_pairs()`.

    .. attribute:: name

       The field name referenced in `text` (a string). If `text` doesn't
       contain a formatting directive this will be :data:`None`.

    .. attribute:: text

       The text extracted from the logging format string (a string).
    """


class NameNormalizer(object):

    """Responsible for normalizing field and level names."""

    def __init__(self):
        """Initialize a :class:`NameNormalizer` object."""
        self.aliases = {k.lower(): v.lower() for k, v in find_level_aliases().items()}

    def normalize_name(self, name):
        """
        Normalize a field or level name.

        :param name: The field or level name (a string).
        :returns: The normalized name (a string).

        Transforms all strings to lowercase and resolves level name aliases
        (refer to :func:`find_level_aliases()`) to their canonical name:

        >>> from coloredlogs import NameNormalizer
        >>> from humanfriendly import format_table
        >>> nn = NameNormalizer()
        >>> sample_names = ['DEBUG', 'INFO', 'WARN', 'WARNING', 'ERROR', 'FATAL', 'CRITICAL']
        >>> print(format_table([(n, nn.normalize_name(n)) for n in sample_names]))
        -----------------------
        | DEBUG    | debug    |
        | INFO     | info     |
        | WARN     | warning  |
        | WARNING  | warning  |
        | ERROR    | error    |
        | FATAL    | critical |
        | CRITICAL | critical |
        -----------------------
        """
        name = name.lower()
        if name in self.aliases:
            name = self.aliases[name]
        return name

    def normalize_keys(self, value):
        """
        Normalize the keys of a dictionary using :func:`normalize_name()`.

        :param value: The dictionary to normalize.
        :returns: A dictionary with normalized keys.
        """
        return {self.normalize_name(k): v for k, v in value.items()}

    def get(self, normalized_dict, name):
        """
        Get a value from a dictionary after normalizing the key.

        :param normalized_dict: A dictionary produced by :func:`normalize_keys()`.
        :param name: A key to normalize and get from the dictionary.
        :returns: The value of the normalized key (if any).
        """
        return normalized_dict.get(self.normalize_name(name))
