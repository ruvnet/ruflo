# Human friendly input/output in Python.
#
# Author: Peter Odding <peter@peterodding.com>
# Last Change: March 1, 2020
# URL: https://humanfriendly.readthedocs.io

"""
Support for spinners that represent progress on interactive terminals.

The :class:`Spinner` class shows a "spinner" on the terminal to let the user
know that something is happening during long running operations that would
otherwise be silent (leaving the user to wonder what they're waiting for).
Below are some visual examples that should illustrate the point.

**Simple spinners:**

 Here's a screen capture that shows the simplest form of spinner:

  .. image:: images/spinner-basic.gif
     :alt: Animated screen capture of a simple spinner.

 The following code was used to create the spinner above:

 .. code-block:: python

    import itertools
    import time
    from humanfriendly import Spinner

    with Spinner(label="Downloading") as spinner:
        for i in itertools.count():
            # Do something useful here.
            time.sleep(0.1)
            # Advance the spinner.
            spinner.step()

**Spinners that show elapsed time:**

 Here's a spinner that shows the elapsed time since it started:

  .. image:: images/spinner-with-timer.gif
     :alt: Animated screen capture of a spinner showing elapsed time.

 The following code was used to create the spinner above:

 .. code-block:: python

    import itertools
    import time
    from humanfriendly import Spinner, Timer

    with Spinner(label="Downloading", timer=Timer()) as spinner:
        for i in itertools.count():
            # Do something useful here.
            time.sleep(0.1)
            # Advance the spinner.
            spinner.step()

**Spinners that show progress:**

 Here's a spinner that shows a progress percentage:

  .. image:: images/spinner-with-progress.gif
     :alt: Animated screen capture of spinner showing progress.

 The following code was used to create the spinner above:

 .. code-block:: python

    import itertools
    import random
    import time
    from humanfriendly import Spinner, Timer

    with Spinner(label="Downloading", total=100) as spinner:
        progress = 0
        while progress < 100:
            # Do something useful here.
            time.sleep(0.1)
            # Advance the spinner.
            spinner.step(progress)
            # Determine the new progress value.
            progress += random.random() * 5

If you want to provide user feedback during a long running operation but it's
not practical to periodically call the :func:`~Spinner.step()` method consider
using :class:`AutomaticSpinner` instead.

As you may already have noticed in the examples above, :class:`Spinner` objects
can be used as context managers to automatically call :func:`Spinner.clear()`
when the spinner ends.
"""

# Standard library modules.
import multiprocessing
import sys
import time

# Modules included in our package.
from humanfriendly import Timer
from humanfriendly.deprecation import deprecated_args
from humanfriendly.terminal import ANSI_ERASE_LINE

# Public identifiers that require documentation.
__all__ = ("AutomaticSpinner", "GLYPHS", "MINIMUM_INTERVAL", "Spinner")

GLYPHS = ["-", "\\", "|", "/"]
"""A list of strings with characters that together form a crude animation :-)."""

MINIMUM_INTERVAL = 0.2
"""Spinners are redrawn with a frequency no higher than this number (a floating point number of seconds)."""


class Spinner(object):

    """Show a spinner on the terminal as a simple means of feedback to the user."""

    @deprecated_args('label', 'total', 'stream', 'interactive', 'timer')
    def __init__(self, **options):
        """
        Initialize a :class:`Spinner` object.

        :param label:

          The label for the spinner (a string or :data:`None`, defaults to
          :data:`None`).

        :param total:

          The expected number of steps (an integer or :data:`None`). If this is
          provided the spinner will show a progress percentage.

        :param stream:

          The output stream to show the spinner on (a file-like object,
          defaults to :data:`sys.stderr`).

        :param interactive:

          :data:`True` to enable rendering of the spinner, :data:`False` to
          disable (defaults to the result of ``stream.isatty()``).

        :param timer:

          A :class:`.Timer` object (optional). If this is given the spinner
          will show the elapsed time according to the timer.

        :param interval:

          The spinner will be updated at most once every this many seconds
          (a floating point number, defaults to :data:`MINIMUM_INTERVAL`).

        :param glyphs:

          A list of strings with single characters that are drawn in the same
          place in succession to implement a simple animated effect (defaults
          to :data:`GLYPHS`).
        """
        # Store initializer arguments.
        self.interactive = options.get('interactive')
        self.interval = options.get('interval', MINIMUM_INTERVAL)
        self.label = options.get('label')
        self.states = options.get('glyphs', GLYPHS)
        self.stream = options.get('stream', sys.stderr)
        self.timer = options.get('timer')
        self.total = options.get('total')
        # Define instance variables.
        self.counter = 0
        self.last_update = 0
        # Try to automatically discover whether the stream is connected to
        # a terminal, but don't fail if no isatty() method is available.
        if self.interactive is None:
            try:
                self.interactive = self.stream.isatty()
            except Exception:
                self.interactive = False

    def step(self, progress=0, label=None):
        """
        Advance the spinner by one step and redraw it.

        :param progress: The number of the current step, relative to the total
                         given to the :class:`Spinner` constructor (an integer,
                         optional). If not provided the spinner will not show
                         progress.
        :param label: The label to use while redrawing (a string, optional). If
                      not provided the label given to the :class:`Spinner`
                      constructor is used instead.

        This method advances the spinner by one step without starting a new
        line, causing an animated effect which is very simple but much nicer
        than waiting for a prompt which is completely silent for a long time.

        .. note:: This method uses time based rate limiting to avoid redrawing
                  the spinner too frequently. If you know you're dealing with
                  code that will call :func:`step()` at a high frequency,
                  consider using :func:`sleep()` to avoid creating the
                  equivalent of a busy loop that's rate limiting the spinner
                  99% of the time.
        """
        if self.interactive:
            time_now = time.time()
            if time_now - self.last_update >= self.interval:
                self.last_update = time_now
                state = self.states[self.counter % len(self.states)]
                label = label or self.label
                if not label:
                    raise Exception("No label set for spinner!")
                elif self.total and progress:
                    label = "%s: %.2f%%" % (label, progress / (self.total / 100.0))
                elif self.timer and self.timer.elapsed_time > 2:
                    label = "%s (%s)" % (label, self.timer.rounded)
                self.stream.write("%s %s %s ..\r" % (ANSI_ERASE_LINE, state, label))
                self.counter += 1

    def sleep(self):
        """
        Sleep for a short period before redrawing the spinner.

        This method is useful when you know you're dealing with code that will
        call :func:`step()` at a high frequency. It will sleep for the interval
        with which the spinner is redrawn (less than a second). This avoids
        creating the equivalent of a busy loop that's rate limiting the
        spinner 99% of the time.

        This method doesn't redraw the spinner, you still have to call
        :func:`step()` in order to do that.
        """
        time.sleep(MINIMUM_INTERVAL)

    def clear(self):
        """
        Clear the spinner.

        The next line which is shown on the standard output or error stream
        after calling this method will overwrite the line that used to show the
        spinner.
        """
        if self.interactive:
            self.stream.write(ANSI_ERASE_LINE)

    def __enter__(self):
        """
        Enable the use of spinners as context managers.

        :returns: The :class:`Spinner` object.
        """
        return self

    def __exit__(self, exc_type=None, exc_value=None, traceback=None):
        """Clear the spinner when leaving the context."""
        self.clear()


class AutomaticSpinner(object):

    """
    Show a spinner on the terminal that automatically starts animating.

    This class shows a spinner on the terminal (just like :class:`Spinner`
    does) that automatically starts animating. This class should be used as a
    context manager using the :keyword:`with` statement. The animation
    continues for as long as the context is active.

    :class:`AutomaticSpinner` provides an alternative to :class:`Spinner`
    for situations where it is not practical for the caller to periodically
    call :func:`~Spinner.step()` to advance the animation, e.g. because
    you're performing a blocking call and don't fancy implementing threading or
    subprocess handling just to provide some user feedback.

    This works using the :mod:`multiprocessing` module by spawning a
    subprocess to render the spinner while the main process is busy doing
    something more useful. By using the :keyword:`with` statement you're
    guaranteed that the subprocess is properly terminated at the appropriate
    time.
    """

    def __init__(self, label, show_time=True):
        """
        Initialize an automatic spinner.

        :param label: The label for the spinner (a string).
        :param show_time: If this is :data:`True` (the default) then the spinner
                          shows elapsed time.
        """
        self.label = label
        self.show_time = show_time
        self.shutdown_event = multiprocessing.Event()
        self.subprocess = multiprocessing.Process(target=self._target)

    def __enter__(self):
        """Enable the use of automatic spinners as context managers."""
        self.subprocess.start()

    def __exit__(self, exc_type=None, exc_value=None, traceback=None):
        """Enable the use of automatic spinners as context managers."""
        self.shutdown_event.set()
        self.subprocess.join()

    def _target(self):
        try:
            timer = Timer() if self.show_time else None
            with Spinner(label=self.label, timer=timer) as spinner:
                while not self.shutdown_event.is_set():
                    spinner.step()
                    spinner.sleep()
        except KeyboardInterrupt:
            # Swallow Control-C signals without producing a nasty traceback that
            # won't make any sense to the average user.
            pass
