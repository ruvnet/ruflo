# Human friendly input/output in Python.
#
# Author: Peter Odding <peter@peterodding.com>
# Last Change: March 1, 2020
# URL: https://humanfriendly.readthedocs.io

"""
Interaction with interactive text terminals.

The :mod:`~humanfriendly.terminal` module makes it easy to interact with
interactive text terminals and format text for rendering on such terminals. If
the terms used in the documentation of this module don't make sense to you then
please refer to the `Wikipedia article on ANSI escape sequences`_ for details
about how ANSI escape sequences work.

This module was originally developed for use on UNIX systems, but since then
Windows 10 gained native support for ANSI escape sequences and this module was
enhanced to recognize and support this. For details please refer to the
:func:`enable_ansi_support()` function.

.. _Wikipedia article on ANSI escape sequences: http://en.wikipedia.org/wiki/ANSI_escape_code#Sequence_elements
"""

# Standard library modules.
import codecs
import numbers
import os
import platform
import re
import subprocess
import sys

# The `fcntl' module is platform specific so importing it may give an error. We
# hide this implementation detail from callers by handling the import error and
# setting a flag instead.
try:
    import fcntl
    import termios
    import struct
    HAVE_IOCTL = True
except ImportError:
    HAVE_IOCTL = False

# Modules included in our package.
from humanfriendly.compat import coerce_string, is_unicode, on_windows, which
from humanfriendly.decorators import cached
from humanfriendly.deprecation import define_aliases
from humanfriendly.text import concatenate, format
from humanfriendly.usage import format_usage

# Public identifiers that require documentation.
__all__ = (
    'ANSI_COLOR_CODES',
    'ANSI_CSI',
    'ANSI_ERASE_LINE',
    'ANSI_HIDE_CURSOR',
    'ANSI_RESET',
    'ANSI_SGR',
    'ANSI_SHOW_CURSOR',
    'ANSI_TEXT_STYLES',
    'CLEAN_OUTPUT_PATTERN',
    'DEFAULT_COLUMNS',
    'DEFAULT_ENCODING',
    'DEFAULT_LINES',
    'HIGHLIGHT_COLOR',
    'ansi_strip',
    'ansi_style',
    'ansi_width',
    'ansi_wrap',
    'auto_encode',
    'clean_terminal_output',
    'connected_to_terminal',
    'enable_ansi_support',
    'find_terminal_size',
    'find_terminal_size_using_ioctl',
    'find_terminal_size_using_stty',
    'get_pager_command',
    'have_windows_native_ansi_support',
    'message',
    'output',
    'readline_strip',
    'readline_wrap',
    'show_pager',
    'terminal_supports_colors',
    'usage',
    'warning',
)

ANSI_CSI = '\x1b['
"""The ANSI "Control Sequence Introducer" (a string)."""

ANSI_SGR = 'm'
"""The ANSI "Select Graphic Rendition" sequence (a string)."""

ANSI_ERASE_LINE = '%sK' % ANSI_CSI
"""The ANSI escape sequence to erase the current line (a string)."""

ANSI_RESET = '%s0%s' % (ANSI_CSI, ANSI_SGR)
"""The ANSI escape sequence to reset styling (a string)."""

ANSI_HIDE_CURSOR = '%s?25l' % ANSI_CSI
"""The ANSI escape sequence to hide the text cursor (a string)."""

ANSI_SHOW_CURSOR = '%s?25h' % ANSI_CSI
"""The ANSI escape sequence to show the text cursor (a string)."""

ANSI_COLOR_CODES = dict(black=0, red=1, green=2, yellow=3, blue=4, magenta=5, cyan=6, white=7)
"""
A dictionary with (name, number) pairs of `portable color codes`_. Used by
:func:`ansi_style()` to generate ANSI escape sequences that change font color.

.. _portable color codes: http://en.wikipedia.org/wiki/ANSI_escape_code#Colors
"""

ANSI_TEXT_STYLES = dict(bold=1, faint=2, italic=3, underline=4, inverse=7, strike_through=9)
"""
A dictionary with (name, number) pairs of text styles (effects). Used by
:func:`ansi_style()` to generate ANSI escape sequences that change text
styles. Only widely supported text styles are included here.
"""

CLEAN_OUTPUT_PATTERN = re.compile(u'(\r|\n|\b|%s)' % re.escape(ANSI_ERASE_LINE))
"""
A compiled regular expression used to separate significant characters from other text.

This pattern is used by :func:`clean_terminal_output()` to split terminal
output into regular text versus backspace, carriage return and line feed
characters and ANSI 'erase line' escape sequences.
"""

DEFAULT_LINES = 25
"""The default number of lines in a terminal (an integer)."""

DEFAULT_COLUMNS = 80
"""The default number of columns in a terminal (an integer)."""

DEFAULT_ENCODING = 'UTF-8'
"""The output encoding for Unicode strings."""

HIGHLIGHT_COLOR = os.environ.get('HUMANFRIENDLY_HIGHLIGHT_COLOR', 'green')
"""
The color used to highlight important tokens in formatted text (e.g. the usage
message of the ``humanfriendly`` program). If the environment variable
``$HUMANFRIENDLY_HIGHLIGHT_COLOR`` is set it determines the value of
:data:`HIGHLIGHT_COLOR`.
"""


def ansi_strip(text, readline_hints=True):
    """
    Strip ANSI escape sequences from the given string.

    :param text: The text from which ANSI escape sequences should be removed (a
                 string).
    :param readline_hints: If :data:`True` then :func:`readline_strip()` is
                           used to remove `readline hints`_ from the string.
    :returns: The text without ANSI escape sequences (a string).
    """
    pattern = '%s.*?%s' % (re.escape(ANSI_CSI), re.escape(ANSI_SGR))
    text = re.sub(pattern, '', text)
    if readline_hints:
        text = readline_strip(text)
    return text


def ansi_style(**kw):
    """
    Generate ANSI escape sequences for the given color and/or style(s).

    :param color: The foreground color. Three types of values are supported:

                  - The name of a color (one of the strings 'black', 'red',
                    'green', 'yellow', 'blue', 'magenta', 'cyan' or 'white').
                  - An integer that refers to the 256 color mode palette.
                  - A tuple or list with three integers representing an RGB
                    (red, green, blue) value.

                  The value :data:`None` (the default) means no escape
                  sequence to switch color will be emitted.
    :param background: The background color (see the description
                       of the `color` argument).
    :param bright: Use high intensity colors instead of default colors
                   (a boolean, defaults to :data:`False`).
    :param readline_hints: If :data:`True` then :func:`readline_wrap()` is
                           applied to the generated ANSI escape sequences (the
                           default is :data:`False`).
    :param kw: Any additional keyword arguments are expected to match a key
               in the :data:`ANSI_TEXT_STYLES` dictionary. If the argument's
               value evaluates to :data:`True` the respective style will be
               enabled.
    :returns: The ANSI escape sequences to enable the requested text styles or
              an empty string if no styles were requested.
    :raises: :exc:`~exceptions.ValueError` when an invalid color name is given.

    Even though only eight named colors are supported, the use of `bright=True`
    and `faint=True` increases the number of available colors to around 24 (it
    may be slightly lower, for example because faint black is just black).

    **Support for 8-bit colors**

    In `release 4.7`_ support for 256 color mode was added. While this
    significantly increases the available colors it's not very human friendly
    in usage because you need to look up color codes in the `256 color mode
    palette <https://en.wikipedia.org/wiki/ANSI_escape_code#8-bit>`_.

    You can use the ``humanfriendly --demo`` command to get a demonstration of
    the available colors, see also the screen shot below. Note that the small
    font size in the screen shot was so that the demonstration of 256 color
    mode support would fit into a single screen shot without scrolling :-)
    (I wasn't feeling very creative).

      .. image:: images/ansi-demo.png

    **Support for 24-bit colors**

    In `release 4.14`_ support for 24-bit colors was added by accepting a tuple
    or list with three integers representing the RGB (red, green, blue) value
    of a color. This is not included in the demo because rendering millions of
    colors was deemed unpractical ;-).

    .. _release 4.7: http://humanfriendly.readthedocs.io/en/latest/changelog.html#release-4-7-2018-01-14
    .. _release 4.14: http://humanfriendly.readthedocs.io/en/latest/changelog.html#release-4-14-2018-07-13
    """
    # Start with sequences that change text styles.
    sequences = [ANSI_TEXT_STYLES[k] for k, v in kw.items() if k in ANSI_TEXT_STYLES and v]
    # Append the color code (if any).
    for color_type in 'color', 'background':
        color_value = kw.get(color_type)
        if isinstance(color_value, (tuple, list)):
            if len(color_value) != 3:
                msg = "Invalid color value %r! (expected tuple or list with three numbers)"
                raise ValueError(msg % color_value)
            sequences.append(48 if color_type == 'background' else 38)
            sequences.append(2)
            sequences.extend(map(int, color_value))
        elif isinstance(color_value, numbers.Number):
            # Numeric values are assumed to be 256 color codes.
            sequences.extend((
                39 if color_type == 'background' else 38,
                5, int(color_value)
            ))
        elif color_value:
            # Other values are assumed to be strings containing one of the known color names.
            if color_value not in ANSI_COLOR_CODES:
                msg = "Invalid color value %r! (expected an integer or one of the strings %s)"
                raise ValueError(msg % (color_value, concatenate(map(repr, sorted(ANSI_COLOR_CODES)))))
            # Pick the right offset for foreground versus background
            # colors and regular intensity versus bright colors.
            offset = (
                (100 if kw.get('bright') else 40)
                if color_type == 'background'
                else (90 if kw.get('bright') else 30)
            )
            # Combine the offset and color code into a single integer.
            sequences.append(offset + ANSI_COLOR_CODES[color_value])
    if sequences:
        encoded = ANSI_CSI + ';'.join(map(str, sequences)) + ANSI_SGR
        return readline_wrap(encoded) if kw.get('readline_hints') else encoded
    else:
        return ''


def ansi_width(text):
    """
    Calculate the effective width of the given text (ignoring ANSI escape sequences).

    :param text: The text whose width should be calculated (a string).
    :returns: The width of the text without ANSI escape sequences (an
              integer).

    This function uses :func:`ansi_strip()` to strip ANSI escape sequences from
    the given string and returns the length of the resulting string.
    """
    return len(ansi_strip(text))


def ansi_wrap(text, **kw):
    """
    Wrap text in ANSI escape sequences for the given color and/or style(s).

    :param text: The text to wrap (a string).
    :param kw: Any keyword arguments are passed to :func:`ansi_style()`.
    :returns: The result of this function depends on the keyword arguments:

              - If :func:`ansi_style()` generates an ANSI escape sequence based
                on the keyword arguments, the given text is prefixed with the
                generated ANSI escape sequence and suffixed with
                :data:`ANSI_RESET`.

              - If :func:`ansi_style()` returns an empty string then the text
                given by the caller is returned unchanged.
    """
    start_sequence = ansi_style(**kw)
    if start_sequence:
        end_sequence = ANSI_RESET
        if kw.get('readline_hints'):
            end_sequence = readline_wrap(end_sequence)
        return start_sequence + text + end_sequence
    else:
        return text


def auto_encode(stream, text, *args, **kw):
    """
    Reliably write Unicode strings to the terminal.

    :param stream: The file-like object to write to (a value like
                   :data:`sys.stdout` or :data:`sys.stderr`).
    :param text: The text to write to the stream (a string).
    :param args: Refer to :func:`~humanfriendly.text.format()`.
    :param kw: Refer to :func:`~humanfriendly.text.format()`.

    Renders the text using :func:`~humanfriendly.text.format()` and writes it
    to the given stream. If an :exc:`~exceptions.UnicodeEncodeError` is
    encountered in doing so, the text is encoded using :data:`DEFAULT_ENCODING`
    and the write is retried. The reasoning behind this rather blunt approach
    is that it's preferable to get output on the command line in the wrong
    encoding then to have the Python program blow up with a
    :exc:`~exceptions.UnicodeEncodeError` exception.
    """
    text = format(text, *args, **kw)
    try:
        stream.write(text)
    except UnicodeEncodeError:
        stream.write(codecs.encode(text, DEFAULT_ENCODING))


def clean_terminal_output(text):
    """
    Clean up the terminal output of a command.

    :param text: The raw text with special characters (a Unicode string).
    :returns: A list of Unicode strings (one for each line).

    This function emulates the effect of backspace (0x08), carriage return
    (0x0D) and line feed (0x0A) characters and the ANSI 'erase line' escape
    sequence on interactive terminals. It's intended to clean up command output
    that was originally meant to be rendered on an interactive terminal and
    that has been captured using e.g. the :man:`script` program [#]_ or the
    :mod:`pty` module [#]_.

    .. [#] My coloredlogs_ package supports the ``coloredlogs --to-html``
           command which uses :man:`script` to fool a subprocess into thinking
           that it's connected to an interactive terminal (in order to get it
           to emit ANSI escape sequences).

    .. [#] My capturer_ package uses the :mod:`pty` module to fool the current
           process and subprocesses into thinking they are connected to an
           interactive terminal (in order to get them to emit ANSI escape
           sequences).

    **Some caveats about the use of this function:**

    - Strictly speaking the effect of carriage returns cannot be emulated
      outside of an actual terminal due to the interaction between overlapping
      output, terminal widths and line wrapping. The goal of this function is
      to sanitize noise in terminal output while preserving useful output.
      Think of it as a useful and pragmatic but possibly lossy conversion.

    - The algorithm isn't smart enough to properly handle a pair of ANSI escape
      sequences that open before a carriage return and close after the last
      carriage return in a linefeed delimited string; the resulting string will
      contain only the closing end of the ANSI escape sequence pair. Tracking
      this kind of complexity requires a state machine and proper parsing.

    .. _capturer: https://pypi.org/project/capturer
    .. _coloredlogs: https://pypi.org/project/coloredlogs
    """
    cleaned_lines = []
    current_line = ''
    current_position = 0
    for token in CLEAN_OUTPUT_PATTERN.split(text):
        if token == '\r':
            # Seek back to the start of the current line.
            current_position = 0
        elif token == '\b':
            # Seek back one character in the current line.
            current_position = max(0, current_position - 1)
        else:
            if token == '\n':
                # Capture the current line.
                cleaned_lines.append(current_line)
            if token in ('\n', ANSI_ERASE_LINE):
                # Clear the current line.
                current_line = ''
                current_position = 0
            elif token:
                # Merge regular output into the current line.
                new_position = current_position + len(token)
                prefix = current_line[:current_position]
                suffix = current_line[new_position:]
                current_line = prefix + token + suffix
                current_position = new_position
    # Capture the last line (if any).
    cleaned_lines.append(current_line)
    # Remove any empty trailing lines.
    while cleaned_lines and not cleaned_lines[-1]:
        cleaned_lines.pop(-1)
    return cleaned_lines


def connected_to_terminal(stream=None):
    """
    Check if a stream is connected to a terminal.

    :param stream: The stream to check (a file-like object,
                   defaults to :data:`sys.stdout`).
    :returns: :data:`True` if the stream is connected to a terminal,
              :data:`False` otherwise.

    See also :func:`terminal_supports_colors()`.
    """
    stream = sys.stdout if stream is None else stream
    try:
        return stream.isatty()
    except Exception:
        return False


@cached
def enable_ansi_support():
    """
    Try to enable support for ANSI escape sequences (required on Windows).

    :returns: :data:`True` if ANSI is supported, :data:`False` otherwise.

    This functions checks for the following supported configurations, in the
    given order:

    1. On Windows, if :func:`have_windows_native_ansi_support()` confirms
       native support for ANSI escape sequences :mod:`ctypes` will be used to
       enable this support.

    2. On Windows, if the environment variable ``$ANSICON`` is set nothing is
       done because it is assumed that support for ANSI escape sequences has
       already been enabled via `ansicon <https://github.com/adoxa/ansicon>`_.

    3. On Windows, an attempt is made to import and initialize the Python
       package :pypi:`colorama` instead (of course for this to work
       :pypi:`colorama` has to be installed).

    4. On other platforms this function calls :func:`connected_to_terminal()`
       to determine whether ANSI escape sequences are supported (that is to
       say all platforms that are not Windows are assumed to support ANSI
       escape sequences natively, without weird contortions like above).

       This makes it possible to call :func:`enable_ansi_support()`
       unconditionally without checking the current platform.

    The :func:`~humanfriendly.decorators.cached` decorator is used to ensure
    that this function is only executed once, but its return value remains
    available on later calls.
    """
    if have_windows_native_ansi_support():
        import ctypes
        ctypes.windll.kernel32.SetConsoleMode(ctypes.windll.kernel32.GetStdHandle(-11), 7)
        ctypes.windll.kernel32.SetConsoleMode(ctypes.windll.kernel32.GetStdHandle(-12), 7)
        return True
    elif on_windows():
        if 'ANSICON' in os.environ:
            return True
        try:
            import colorama
            colorama.init()
            return True
        except ImportError:
            return False
    else:
        return connected_to_terminal()


def find_terminal_size():
    """
    Determine the number of lines and columns visible in the terminal.

    :returns: A tuple of two integers with the line and column count.

    The result of this function is based on the first of the following three
    methods that works:

    1. First :func:`find_terminal_size_using_ioctl()` is tried,
    2. then :func:`find_terminal_size_using_stty()` is tried,
    3. finally :data:`DEFAULT_LINES` and :data:`DEFAULT_COLUMNS` are returned.

    .. note:: The :func:`find_terminal_size()` function performs the steps
              above every time it is called, the result is not cached. This is
              because the size of a virtual terminal can change at any time and
              the result of :func:`find_terminal_size()` should be correct.

              `Pre-emptive snarky comment`_: It's possible to cache the result
              of this function and use :mod:`signal.SIGWINCH <signal>` to
              refresh the cached values!

              Response: As a library I don't consider it the role of the
              :mod:`humanfriendly.terminal` module to install a process wide
              signal handler ...

    .. _Pre-emptive snarky comment: http://blogs.msdn.com/b/oldnewthing/archive/2008/01/30/7315957.aspx
    """
    # The first method. Any of the standard streams may have been redirected
    # somewhere and there's no telling which, so we'll just try them all.
    for stream in sys.stdin, sys.stdout, sys.stderr:
        try:
            result = find_terminal_size_using_ioctl(stream)
            if min(result) >= 1:
                return result
        except Exception:
            pass
    # The second method.
    try:
        result = find_terminal_size_using_stty()
        if min(result) >= 1:
            return result
    except Exception:
        pass
    # Fall back to conservative defaults.
    return DEFAULT_LINES, DEFAULT_COLUMNS


def find_terminal_size_using_ioctl(stream):
    """
    Find the terminal size using :func:`fcntl.ioctl()`.

    :param stream: A stream connected to the terminal (a file object with a
                   ``fileno`` attribute).
    :returns: A tuple of two integers with the line and column count.
    :raises: This function can raise exceptions but I'm not going to document
             them here, you should be using :func:`find_terminal_size()`.

    Based on an `implementation found on StackOverflow <http://stackoverflow.com/a/3010495/788200>`_.
    """
    if not HAVE_IOCTL:
        raise NotImplementedError("It looks like the `fcntl' module is not available!")
    h, w, hp, wp = struct.unpack('HHHH', fcntl.ioctl(stream, termios.TIOCGWINSZ, struct.pack('HHHH', 0, 0, 0, 0)))
    return h, w


def find_terminal_size_using_stty():
    """
    Find the terminal size using the external command ``stty size``.

    :param stream: A stream connected to the terminal (a file object).
    :returns: A tuple of two integers with the line and column count.
    :raises: This function can raise exceptions but I'm not going to document
             them here, you should be using :func:`find_terminal_size()`.
    """
    stty = subprocess.Popen(['stty', 'size'],
                            stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE)
    stdout, stderr = stty.communicate()
    tokens = stdout.split()
    if len(tokens) != 2:
        raise Exception("Invalid output from `stty size'!")
    return tuple(map(int, tokens))


def get_pager_command(text=None):
    """
    Get the command to show a text on the terminal using a pager.

    :param text: The text to print to the terminal (a string).
    :returns: A list of strings with the pager command and arguments.

    The use of a pager helps to avoid the wall of text effect where the user
    has to scroll up to see where the output began (not very user friendly).

    If the given text contains ANSI escape sequences the command ``less
    --RAW-CONTROL-CHARS`` is used, otherwise the environment variable
    ``$PAGER`` is used (if ``$PAGER`` isn't set :man:`less` is used).

    When the selected pager is :man:`less`, the following options are used to
    make the experience more user friendly:

    - ``--quit-if-one-screen`` causes :man:`less` to automatically exit if the
      entire text can be displayed on the first screen. This makes the use of a
      pager transparent for smaller texts (because the operator doesn't have to
      quit the pager).

    - ``--no-init`` prevents :man:`less` from clearing the screen when it
      exits. This ensures that the operator gets a chance to review the text
      (for example a usage message) after quitting the pager, while composing
      the next command.
    """
    # Compose the pager command.
    if text and ANSI_CSI in text:
        command_line = ['less', '--RAW-CONTROL-CHARS']
    else:
        command_line = [os.environ.get('PAGER', 'less')]
    # Pass some additional options to `less' (to make it more
    # user friendly) without breaking support for other pagers.
    if os.path.basename(command_line[0]) == 'less':
        command_line.append('--no-init')
        command_line.append('--quit-if-one-screen')
    return command_line


@cached
def have_windows_native_ansi_support():
    """
    Check if we're running on a Windows 10 release with native support for ANSI escape sequences.

    :returns: :data:`True` if so, :data:`False` otherwise.

    The :func:`~humanfriendly.decorators.cached` decorator is used as a minor
    performance optimization. Semantically this should have zero impact because
    the answer doesn't change in the lifetime of a computer process.
    """
    if on_windows():
        try:
            # I can't be 100% sure this will never break and I'm not in a
            # position to test it thoroughly either, so I decided that paying
            # the price of one additional try / except statement is worth the
            # additional peace of mind :-).
            components = tuple(int(c) for c in platform.version().split('.'))
            return components >= (10, 0, 14393)
        except Exception:
            pass
    return False


def message(text, *args, **kw):
    """
    Print a formatted message to the standard error stream.

    For details about argument handling please refer to
    :func:`~humanfriendly.text.format()`.

    Renders the message using :func:`~humanfriendly.text.format()` and writes
    the resulting string (followed by a newline) to :data:`sys.stderr` using
    :func:`auto_encode()`.
    """
    auto_encode(sys.stderr, coerce_string(text) + '\n', *args, **kw)


def output(text, *args, **kw):
    """
    Print a formatted message to the standard output stream.

    For details about argument handling please refer to
    :func:`~humanfriendly.text.format()`.

    Renders the message using :func:`~humanfriendly.text.format()` and writes
    the resulting string (followed by a newline) to :data:`sys.stdout` using
    :func:`auto_encode()`.
    """
    auto_encode(sys.stdout, coerce_string(text) + '\n', *args, **kw)


def readline_strip(expr):
    """
    Remove `readline hints`_ from a string.

    :param text: The text to strip (a string).
    :returns: The stripped text.
    """
    return expr.replace('\001', '').replace('\002', '')


def readline_wrap(expr):
    """
    Wrap an ANSI escape sequence in `readline hints`_.

    :param text: The text with the escape sequence to wrap (a string).
    :returns: The wrapped text.

    .. _readline hints: http://superuser.com/a/301355
    """
    return '\001' + expr + '\002'


def show_pager(formatted_text, encoding=DEFAULT_ENCODING):
    """
    Print a large text to the terminal using a pager.

    :param formatted_text: The text to print to the terminal (a string).
    :param encoding: The name of the text encoding used to encode the formatted
                     text if the formatted text is a Unicode string (a string,
                     defaults to :data:`DEFAULT_ENCODING`).

    When :func:`connected_to_terminal()` returns :data:`True` a pager is used
    to show the text on the terminal, otherwise the text is printed directly
    without invoking a pager.

    The use of a pager helps to avoid the wall of text effect where the user
    has to scroll up to see where the output began (not very user friendly).

    Refer to :func:`get_pager_command()` for details about the command line
    that's used to invoke the pager.
    """
    if connected_to_terminal():
        # Make sure the selected pager command is available.
        command_line = get_pager_command(formatted_text)
        if which(command_line[0]):
            pager = subprocess.Popen(command_line, stdin=subprocess.PIPE)
            if is_unicode(formatted_text):
                formatted_text = formatted_text.encode(encoding)
            pager.communicate(input=formatted_text)
            return
    output(formatted_text)


def terminal_supports_colors(stream=None):
    """
    Check if a stream is connected to a terminal that supports ANSI escape sequences.

    :param stream: The stream to check (a file-like object,
                   defaults to :data:`sys.stdout`).
    :returns: :data:`True` if the terminal supports ANSI escape sequences,
              :data:`False` otherwise.

    This function was originally inspired by the implementation of
    `django.core.management.color.supports_color()
    <https://github.com/django/django/blob/master/django/core/management/color.py>`_
    but has since evolved significantly.
    """
    if on_windows():
        # On Windows support for ANSI escape sequences is not a given.
        have_ansicon = 'ANSICON' in os.environ
        have_colorama = 'colorama' in sys.modules
        have_native_support = have_windows_native_ansi_support()
        if not (have_ansicon or have_colorama or have_native_support):
            return False
    return connected_to_terminal(stream)


def usage(usage_text):
    """
    Print a human friendly usage message to the terminal.

    :param text: The usage message to print (a string).

    This function does two things:

    1. If :data:`sys.stdout` is connected to a terminal (see
       :func:`connected_to_terminal()`) then the usage message is formatted
       using :func:`.format_usage()`.
    2. The usage message is shown using a pager (see :func:`show_pager()`).
    """
    if terminal_supports_colors(sys.stdout):
        usage_text = format_usage(usage_text)
    show_pager(usage_text)


def warning(text, *args, **kw):
    """
    Show a warning message on the terminal.

    For details about argument handling please refer to
    :func:`~humanfriendly.text.format()`.

    Renders the message using :func:`~humanfriendly.text.format()` and writes
    the resulting string (followed by a newline) to :data:`sys.stderr` using
    :func:`auto_encode()`.

    If :data:`sys.stderr` is connected to a terminal that supports colors,
    :func:`ansi_wrap()` is used to color the message in a red font (to make
    the warning stand out from surrounding text).
    """
    text = coerce_string(text)
    if terminal_supports_colors(sys.stderr):
        text = ansi_wrap(text, color='red')
    auto_encode(sys.stderr, text + '\n', *args, **kw)


# Define aliases for backwards compatibility.
define_aliases(
    module_name=__name__,
    # In humanfriendly 1.31 the find_meta_variables() and format_usage()
    # functions were extracted to the new module humanfriendly.usage.
    find_meta_variables='humanfriendly.usage.find_meta_variables',
    format_usage='humanfriendly.usage.format_usage',
    # In humanfriendly 8.0 the html_to_ansi() function and HTMLConverter
    # class were extracted to the new module humanfriendly.terminal.html.
    html_to_ansi='humanfriendly.terminal.html.html_to_ansi',
    HTMLConverter='humanfriendly.terminal.html.HTMLConverter',
)
