# Human friendly input/output in Python.
#
# Author: Peter Odding <peter@peterodding.com>
# Last Change: March 6, 2020
# URL: https://humanfriendly.readthedocs.io

"""
Utility classes and functions that make it easy to write :mod:`unittest` compatible test suites.

Over the years I've developed the habit of writing test suites for Python
projects using the :mod:`unittest` module. During those years I've come to know
:pypi:`pytest` and in fact I use :pypi:`pytest` to run my test suites (due to
its much better error reporting) but I've yet to publish a test suite that
*requires* :pypi:`pytest`. I have several reasons for doing so:

- It's nice to keep my test suites as simple and accessible as possible and
  not requiring a specific test runner is part of that attitude.

- Whereas :mod:`unittest` is quite explicit, :pypi:`pytest` contains a lot of
  magic, which kind of contradicts the Python mantra "explicit is better than
  implicit" (IMHO).
"""

# Standard library module
import functools
import logging
import os
import pipes
import shutil
import sys
import tempfile
import time
import unittest

# Modules included in our package.
from humanfriendly.compat import StringIO
from humanfriendly.text import random_string

# Initialize a logger for this module.
logger = logging.getLogger(__name__)

# A unique object reference used to detect missing attributes.
NOTHING = object()

# Public identifiers that require documentation.
__all__ = (
    'CallableTimedOut',
    'CaptureBuffer',
    'CaptureOutput',
    'ContextManager',
    'CustomSearchPath',
    'MockedProgram',
    'PatchedAttribute',
    'PatchedItem',
    'TemporaryDirectory',
    'TestCase',
    'configure_logging',
    'make_dirs',
    'retry',
    'run_cli',
    'skip_on_raise',
    'touch',
)


def configure_logging(log_level=logging.DEBUG):
    """configure_logging(log_level=logging.DEBUG)
    Automatically configure logging to the terminal.

    :param log_level: The log verbosity (a number, defaults
                      to :mod:`logging.DEBUG <logging>`).

    When :mod:`coloredlogs` is installed :func:`coloredlogs.install()` will be
    used to configure logging to the terminal. When this fails with an
    :exc:`~exceptions.ImportError` then :func:`logging.basicConfig()` is used
    as a fall back.
    """
    try:
        import coloredlogs
        coloredlogs.install(level=log_level)
    except ImportError:
        logging.basicConfig(
            level=log_level,
            format='%(asctime)s %(name)s[%(process)d] %(levelname)s %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S')


def make_dirs(pathname):
    """
    Create missing directories.

    :param pathname: The pathname of a directory (a string).
    """
    if not os.path.isdir(pathname):
        os.makedirs(pathname)


def retry(func, timeout=60, exc_type=AssertionError):
    """retry(func, timeout=60, exc_type=AssertionError)
    Retry a function until assertions no longer fail.

    :param func: A callable. When the callable returns
                 :data:`False` it will also be retried.
    :param timeout: The number of seconds after which to abort (a number,
                    defaults to 60).
    :param exc_type: The type of exceptions to retry (defaults
                     to :exc:`~exceptions.AssertionError`).
    :returns: The value returned by `func`.
    :raises: Once the timeout has expired :func:`retry()` will raise the
             previously retried assertion error. When `func` keeps returning
             :data:`False` until `timeout` expires :exc:`CallableTimedOut`
             will be raised.

    This function sleeps between retries to avoid claiming CPU cycles we don't
    need. It starts by sleeping for 0.1 second but adjusts this to one second
    as the number of retries grows.
    """
    pause = 0.1
    timeout += time.time()
    while True:
        try:
            result = func()
            if result is not False:
                return result
        except exc_type:
            if time.time() > timeout:
                raise
        else:
            if time.time() > timeout:
                raise CallableTimedOut()
        time.sleep(pause)
        if pause < 1:
            pause *= 2


def run_cli(entry_point, *arguments, **options):
    """
    Test a command line entry point.

    :param entry_point: The function that implements the command line interface
                        (a callable).
    :param arguments: Any positional arguments (strings) become the command
                      line arguments (:data:`sys.argv` items 1-N).
    :param options: The following keyword arguments are supported:

                    **capture**
                     Whether to use :class:`CaptureOutput`. Defaults
                     to :data:`True` but can be disabled by passing
                     :data:`False` instead.
                    **input**
                     Refer to :class:`CaptureOutput`.
                    **merged**
                     Refer to :class:`CaptureOutput`.
                    **program_name**
                     Used to set :data:`sys.argv` item 0.
    :returns: A tuple with two values:

              1. The return code (an integer).
              2. The captured output (a string).
    """
    # Add the `program_name' option to the arguments.
    arguments = list(arguments)
    arguments.insert(0, options.pop('program_name', sys.executable))
    # Log the command line arguments (and the fact that we're about to call the
    # command line entry point function).
    logger.debug("Calling command line entry point with arguments: %s", arguments)
    # Prepare to capture the return code and output even if the command line
    # interface raises an exception (whether the exception type is SystemExit
    # or something else).
    returncode = 0
    stdout = None
    stderr = None
    try:
        # Temporarily override sys.argv.
        with PatchedAttribute(sys, 'argv', arguments):
            # Manipulate the standard input/output/error streams?
            options['enabled'] = options.pop('capture', True)
            with CaptureOutput(**options) as capturer:
                try:
                    # Call the command line interface.
                    entry_point()
                finally:
                    # Get the output even if an exception is raised.
                    stdout = capturer.stdout.getvalue()
                    stderr = capturer.stderr.getvalue()
                    # Reconfigure logging to the terminal because it is very
                    # likely that the entry point function has changed the
                    # configured log level.
                    configure_logging()
    except BaseException as e:
        if isinstance(e, SystemExit):
            logger.debug("Intercepting return code %s from SystemExit exception.", e.code)
            returncode = e.code
        else:
            logger.warning("Defaulting return code to 1 due to raised exception.", exc_info=True)
            returncode = 1
    else:
        logger.debug("Command line entry point returned successfully!")
    # Always log the output captured on stdout/stderr, to make it easier to
    # diagnose test failures (but avoid duplicate logging when merged=True).
    is_merged = options.get('merged', False)
    merged_streams = [('merged streams', stdout)]
    separate_streams = [('stdout', stdout), ('stderr', stderr)]
    streams = merged_streams if is_merged else separate_streams
    for name, value in streams:
        if value:
            logger.debug("Output on %s:\n%s", name, value)
        else:
            logger.debug("No output on %s.", name)
    return returncode, stdout


def skip_on_raise(*exc_types):
    """
    Decorate a test function to translation specific exception types to :exc:`unittest.SkipTest`.

    :param exc_types: One or more positional arguments give the exception
                      types to be translated to :exc:`unittest.SkipTest`.
    :returns: A decorator function specialized to `exc_types`.
    """
    def decorator(function):
        @functools.wraps(function)
        def wrapper(*args, **kw):
            try:
                return function(*args, **kw)
            except exc_types as e:
                logger.debug("Translating exception to unittest.SkipTest ..", exc_info=True)
                raise unittest.SkipTest("skipping test because %s was raised" % type(e))
        return wrapper
    return decorator


def touch(filename):
    """
    The equivalent of the UNIX :man:`touch` program in Python.

    :param filename: The pathname of the file to touch (a string).

    Note that missing directories are automatically created using
    :func:`make_dirs()`.
    """
    make_dirs(os.path.dirname(filename))
    with open(filename, 'a'):
        os.utime(filename, None)


class CallableTimedOut(Exception):

    """Raised by :func:`retry()` when the timeout expires."""


class ContextManager(object):

    """Base class to enable composition of context managers."""

    def __enter__(self):
        """Enable use as context managers."""
        return self

    def __exit__(self, exc_type=None, exc_value=None, traceback=None):
        """Enable use as context managers."""


class PatchedAttribute(ContextManager):

    """Context manager that temporary replaces an object attribute using :func:`setattr()`."""

    def __init__(self, obj, name, value):
        """
        Initialize a :class:`PatchedAttribute` object.

        :param obj: The object to patch.
        :param name: An attribute name.
        :param value: The value to set.
        """
        self.object_to_patch = obj
        self.attribute_to_patch = name
        self.patched_value = value
        self.original_value = NOTHING

    def __enter__(self):
        """
        Replace (patch) the attribute.

        :returns: The object whose attribute was patched.
        """
        # Enable composition of context managers.
        super(PatchedAttribute, self).__enter__()
        # Patch the object's attribute.
        self.original_value = getattr(self.object_to_patch, self.attribute_to_patch, NOTHING)
        setattr(self.object_to_patch, self.attribute_to_patch, self.patched_value)
        return self.object_to_patch

    def __exit__(self, exc_type=None, exc_value=None, traceback=None):
        """Restore the attribute to its original value."""
        # Enable composition of context managers.
        super(PatchedAttribute, self).__exit__(exc_type, exc_value, traceback)
        # Restore the object's attribute.
        if self.original_value is NOTHING:
            delattr(self.object_to_patch, self.attribute_to_patch)
        else:
            setattr(self.object_to_patch, self.attribute_to_patch, self.original_value)


class PatchedItem(ContextManager):

    """Context manager that temporary replaces an object item using :meth:`~object.__setitem__()`."""

    def __init__(self, obj, item, value):
        """
        Initialize a :class:`PatchedItem` object.

        :param obj: The object to patch.
        :param item: The item to patch.
        :param value: The value to set.
        """
        self.object_to_patch = obj
        self.item_to_patch = item
        self.patched_value = value
        self.original_value = NOTHING

    def __enter__(self):
        """
        Replace (patch) the item.

        :returns: The object whose item was patched.
        """
        # Enable composition of context managers.
        super(PatchedItem, self).__enter__()
        # Patch the object's item.
        try:
            self.original_value = self.object_to_patch[self.item_to_patch]
        except KeyError:
            self.original_value = NOTHING
        self.object_to_patch[self.item_to_patch] = self.patched_value
        return self.object_to_patch

    def __exit__(self, exc_type=None, exc_value=None, traceback=None):
        """Restore the item to its original value."""
        # Enable composition of context managers.
        super(PatchedItem, self).__exit__(exc_type, exc_value, traceback)
        # Restore the object's item.
        if self.original_value is NOTHING:
            del self.object_to_patch[self.item_to_patch]
        else:
            self.object_to_patch[self.item_to_patch] = self.original_value


class TemporaryDirectory(ContextManager):

    """
    Easy temporary directory creation & cleanup using the :keyword:`with` statement.

    Here's an example of how to use this:

    .. code-block:: python

       with TemporaryDirectory() as directory:
           # Do something useful here.
           assert os.path.isdir(directory)
    """

    def __init__(self, **options):
        """
        Initialize a :class:`TemporaryDirectory` object.

        :param options: Any keyword arguments are passed on to
                        :func:`tempfile.mkdtemp()`.
        """
        self.mkdtemp_options = options
        self.temporary_directory = None

    def __enter__(self):
        """
        Create the temporary directory using :func:`tempfile.mkdtemp()`.

        :returns: The pathname of the directory (a string).
        """
        # Enable composition of context managers.
        super(TemporaryDirectory, self).__enter__()
        # Create the temporary directory.
        self.temporary_directory = tempfile.mkdtemp(**self.mkdtemp_options)
        return self.temporary_directory

    def __exit__(self, exc_type=None, exc_value=None, traceback=None):
        """Cleanup the temporary directory using :func:`shutil.rmtree()`."""
        # Enable composition of context managers.
        super(TemporaryDirectory, self).__exit__(exc_type, exc_value, traceback)
        # Cleanup the temporary directory.
        if self.temporary_directory is not None:
            shutil.rmtree(self.temporary_directory)
            self.temporary_directory = None


class MockedHomeDirectory(PatchedItem, TemporaryDirectory):

    """
    Context manager to temporarily change ``$HOME`` (the current user's profile directory).

    This class is a composition of the :class:`PatchedItem` and
    :class:`TemporaryDirectory` context managers.
    """

    def __init__(self):
        """Initialize a :class:`MockedHomeDirectory` object."""
        PatchedItem.__init__(self, os.environ, 'HOME', os.environ.get('HOME'))
        TemporaryDirectory.__init__(self)

    def __enter__(self):
        """
        Activate the custom ``$PATH``.

        :returns: The pathname of the directory that has
                  been added to ``$PATH`` (a string).
        """
        # Get the temporary directory.
        directory = TemporaryDirectory.__enter__(self)
        # Override the value to patch now that we have
        # the pathname of the temporary directory.
        self.patched_value = directory
        # Temporary patch $HOME.
        PatchedItem.__enter__(self)
        # Pass the pathname of the temporary directory to the caller.
        return directory

    def __exit__(self, exc_type=None, exc_value=None, traceback=None):
        """Deactivate the custom ``$HOME``."""
        super(MockedHomeDirectory, self).__exit__(exc_type, exc_value, traceback)


class CustomSearchPath(PatchedItem, TemporaryDirectory):

    """
    Context manager to temporarily customize ``$PATH`` (the executable search path).

    This class is a composition of the :class:`PatchedItem` and
    :class:`TemporaryDirectory` context managers.
    """

    def __init__(self, isolated=False):
        """
        Initialize a :class:`CustomSearchPath` object.

        :param isolated: :data:`True` to clear the original search path,
                         :data:`False` to add the temporary directory to the
                         start of the search path.
        """
        # Initialize our own instance variables.
        self.isolated_search_path = isolated
        # Selectively initialize our superclasses.
        PatchedItem.__init__(self, os.environ, 'PATH', self.current_search_path)
        TemporaryDirectory.__init__(self)

    def __enter__(self):
        """
        Activate the custom ``$PATH``.

        :returns: The pathname of the directory that has
                  been added to ``$PATH`` (a string).
        """
        # Get the temporary directory.
        directory = TemporaryDirectory.__enter__(self)
        # Override the value to patch now that we have
        # the pathname of the temporary directory.
        self.patched_value = (
            directory if self.isolated_search_path
            else os.pathsep.join([directory] + self.current_search_path.split(os.pathsep))
        )
        # Temporary patch the $PATH.
        PatchedItem.__enter__(self)
        # Pass the pathname of the temporary directory to the caller
        # because they may want to `install' custom executables.
        return directory

    def __exit__(self, exc_type=None, exc_value=None, traceback=None):
        """Deactivate the custom ``$PATH``."""
        super(CustomSearchPath, self).__exit__(exc_type, exc_value, traceback)

    @property
    def current_search_path(self):
        """The value of ``$PATH`` or :data:`os.defpath` (a string)."""
        return os.environ.get('PATH', os.defpath)


class MockedProgram(CustomSearchPath):

    """
    Context manager to mock the existence of a program (executable).

    This class extends the functionality of :class:`CustomSearchPath`.
    """

    def __init__(self, name, returncode=0, script=None):
        """
        Initialize a :class:`MockedProgram` object.

        :param name: The name of the program (a string).
        :param returncode: The return code that the program should emit (a
                           number, defaults to zero).
        :param script: Shell script code to include in the mocked program (a
                       string or :data:`None`). This can be used to mock a
                       program that is expected to generate specific output.
        """
        # Initialize our own instance variables.
        self.program_name = name
        self.program_returncode = returncode
        self.program_script = script
        self.program_signal_file = None
        # Initialize our superclasses.
        super(MockedProgram, self).__init__()

    def __enter__(self):
        """
        Create the mock program.

        :returns: The pathname of the directory that has
                  been added to ``$PATH`` (a string).
        """
        directory = super(MockedProgram, self).__enter__()
        self.program_signal_file = os.path.join(directory, 'program-was-run-%s' % random_string(10))
        pathname = os.path.join(directory, self.program_name)
        with open(pathname, 'w') as handle:
            handle.write('#!/bin/sh\n')
            handle.write('echo > %s\n' % pipes.quote(self.program_signal_file))
            if self.program_script:
                handle.write('%s\n' % self.program_script.strip())
            handle.write('exit %i\n' % self.program_returncode)
        os.chmod(pathname, 0o755)
        return directory

    def __exit__(self, *args, **kw):
        """
        Ensure that the mock program was run.

        :raises: :exc:`~exceptions.AssertionError` when
                 the mock program hasn't been run.
        """
        try:
            assert self.program_signal_file and os.path.isfile(self.program_signal_file), \
                ("It looks like %r was never run!" % self.program_name)
        finally:
            return super(MockedProgram, self).__exit__(*args, **kw)


class CaptureOutput(ContextManager):

    """
    Context manager that captures what's written to :data:`sys.stdout` and :data:`sys.stderr`.

    .. attribute:: stdin

       The :class:`~humanfriendly.compat.StringIO` object used to feed the standard input stream.

    .. attribute:: stdout

       The :class:`CaptureBuffer` object used to capture the standard output stream.

    .. attribute:: stderr

       The :class:`CaptureBuffer` object used to capture the standard error stream.
    """

    def __init__(self, merged=False, input='', enabled=True):
        """
        Initialize a :class:`CaptureOutput` object.

        :param merged: :data:`True` to merge the streams,
                       :data:`False` to capture them separately.
        :param input: The data that reads from :data:`sys.stdin`
                      should return (a string).
        :param enabled: :data:`True` to enable capturing (the default),
                        :data:`False` otherwise. This makes it easy to
                        unconditionally use :class:`CaptureOutput` in
                        a :keyword:`with` block while preserving the
                        choice to opt out of capturing output.
        """
        self.stdin = StringIO(input)
        self.stdout = CaptureBuffer()
        self.stderr = self.stdout if merged else CaptureBuffer()
        self.patched_attributes = []
        if enabled:
            self.patched_attributes.extend(
                PatchedAttribute(sys, name, getattr(self, name))
                for name in ('stdin', 'stdout', 'stderr')
            )

    def __enter__(self):
        """Start capturing what's written to :data:`sys.stdout` and :data:`sys.stderr`."""
        super(CaptureOutput, self).__enter__()
        for context in self.patched_attributes:
            context.__enter__()
        return self

    def __exit__(self, exc_type=None, exc_value=None, traceback=None):
        """Stop capturing what's written to :data:`sys.stdout` and :data:`sys.stderr`."""
        super(CaptureOutput, self).__exit__(exc_type, exc_value, traceback)
        for context in self.patched_attributes:
            context.__exit__(exc_type, exc_value, traceback)

    def get_lines(self):
        """Get the contents of :attr:`stdout` split into separate lines."""
        return self.get_text().splitlines()

    def get_text(self):
        """Get the contents of :attr:`stdout` as a Unicode string."""
        return self.stdout.get_text()

    def getvalue(self):
        """Get the text written to :data:`sys.stdout`."""
        return self.stdout.getvalue()


class CaptureBuffer(StringIO):

    """
    Helper for :class:`CaptureOutput` to provide an easy to use API.

    The two methods defined by this subclass were specifically chosen to match
    the names of the methods provided by my :pypi:`capturer` package which
    serves a similar role as :class:`CaptureOutput` but knows how to simulate
    an interactive terminal (tty).
    """

    def get_lines(self):
        """Get the contents of the buffer split into separate lines."""
        return self.get_text().splitlines()

    def get_text(self):
        """Get the contents of the buffer as a Unicode string."""
        return self.getvalue()


class TestCase(unittest.TestCase):

    """Subclass of :class:`unittest.TestCase` with automatic logging and other miscellaneous features."""

    def __init__(self, *args, **kw):
        """
        Initialize a :class:`TestCase` object.

        Any positional and/or keyword arguments are passed on to the
        initializer of the superclass.
        """
        super(TestCase, self).__init__(*args, **kw)

    def setUp(self, log_level=logging.DEBUG):
        """setUp(log_level=logging.DEBUG)
        Automatically configure logging to the terminal.

        :param log_level: Refer to :func:`configure_logging()`.

        The :func:`setUp()` method is automatically called by
        :class:`unittest.TestCase` before each test method starts.
        It does two things:

        - Logging to the terminal is configured using
          :func:`configure_logging()`.

        - Before the test method starts a newline is emitted, to separate the
          name of the test method (which will be printed to the terminal by
          :mod:`unittest` or :pypi:`pytest`) from the first line of logging
          output that the test method is likely going to generate.
        """
        # Configure logging to the terminal.
        configure_logging(log_level)
        # Separate the name of the test method (printed by the superclass
        # and/or py.test without a newline at the end) from the first line of
        # logging output that the test method is likely going to generate.
        sys.stderr.write("\n")
