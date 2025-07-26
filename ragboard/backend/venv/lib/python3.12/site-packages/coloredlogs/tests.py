# Automated tests for the `coloredlogs' package.
#
# Author: Peter Odding <peter@peterodding.com>
# Last Change: June 11, 2021
# URL: https://coloredlogs.readthedocs.io

"""Automated tests for the `coloredlogs` package."""

# Standard library modules.
import contextlib
import logging
import logging.handlers
import os
import re
import subprocess
import sys
import tempfile

# External dependencies.
from humanfriendly.compat import StringIO
from humanfriendly.terminal import ANSI_COLOR_CODES, ANSI_CSI, ansi_style, ansi_wrap
from humanfriendly.testing import PatchedAttribute, PatchedItem, TestCase, retry
from humanfriendly.text import format, random_string

# The module we're testing.
import coloredlogs
import coloredlogs.cli
from coloredlogs import (
    CHROOT_FILES,
    ColoredFormatter,
    NameNormalizer,
    decrease_verbosity,
    find_defined_levels,
    find_handler,
    find_hostname,
    find_program_name,
    find_username,
    get_level,
    increase_verbosity,
    install,
    is_verbose,
    level_to_number,
    match_stream_handler,
    parse_encoded_styles,
    set_level,
    walk_propagation_tree,
)
from coloredlogs.demo import demonstrate_colored_logging
from coloredlogs.syslog import SystemLogging, is_syslog_supported, match_syslog_handler
from coloredlogs.converter import (
    ColoredCronMailer,
    EIGHT_COLOR_PALETTE,
    capture,
    convert,
)

# External test dependencies.
from capturer import CaptureOutput
from verboselogs import VerboseLogger

# Compiled regular expression that matches a single line of output produced by
# the default log format (does not include matching of ANSI escape sequences).
PLAIN_TEXT_PATTERN = re.compile(r'''
    (?P<date> \d{4}-\d{2}-\d{2} )
    \s (?P<time> \d{2}:\d{2}:\d{2} )
    \s (?P<hostname> \S+ )
    \s (?P<logger_name> \w+ )
    \[ (?P<process_id> \d+ ) \]
    \s (?P<severity> [A-Z]+ )
    \s (?P<message> .* )
''', re.VERBOSE)

# Compiled regular expression that matches a single line of output produced by
# the default log format with milliseconds=True.
PATTERN_INCLUDING_MILLISECONDS = re.compile(r'''
    (?P<date> \d{4}-\d{2}-\d{2} )
    \s (?P<time> \d{2}:\d{2}:\d{2},\d{3} )
    \s (?P<hostname> \S+ )
    \s (?P<logger_name> \w+ )
    \[ (?P<process_id> \d+ ) \]
    \s (?P<severity> [A-Z]+ )
    \s (?P<message> .* )
''', re.VERBOSE)


def setUpModule():
    """Speed up the tests by disabling the demo's artificial delay."""
    os.environ['COLOREDLOGS_DEMO_DELAY'] = '0'
    coloredlogs.demo.DEMO_DELAY = 0


class ColoredLogsTestCase(TestCase):

    """Container for the `coloredlogs` tests."""

    def find_system_log(self):
        """Find the system log file or skip the current test."""
        filename = ('/var/log/system.log' if sys.platform == 'darwin' else (
            '/var/log/syslog' if 'linux' in sys.platform else None
        ))
        if not filename:
            self.skipTest("Location of system log file unknown!")
        elif not os.path.isfile(filename):
            self.skipTest("System log file not found! (%s)" % filename)
        elif not os.access(filename, os.R_OK):
            self.skipTest("Insufficient permissions to read system log file! (%s)" % filename)
        else:
            return filename

    def test_level_to_number(self):
        """Make sure :func:`level_to_number()` works as intended."""
        # Make sure the default levels are translated as expected.
        assert level_to_number('debug') == logging.DEBUG
        assert level_to_number('info') == logging.INFO
        assert level_to_number('warning') == logging.WARNING
        assert level_to_number('error') == logging.ERROR
        assert level_to_number('fatal') == logging.FATAL
        # Make sure bogus level names don't blow up.
        assert level_to_number('bogus-level') == logging.INFO

    def test_find_hostname(self):
        """Make sure :func:`~find_hostname()` works correctly."""
        assert find_hostname()
        # Create a temporary file as a placeholder for e.g. /etc/debian_chroot.
        fd, temporary_file = tempfile.mkstemp()
        try:
            with open(temporary_file, 'w') as handle:
                handle.write('first line\n')
                handle.write('second line\n')
            CHROOT_FILES.insert(0, temporary_file)
            # Make sure the chroot file is being read.
            assert find_hostname() == 'first line'
        finally:
            # Clean up.
            CHROOT_FILES.pop(0)
            os.unlink(temporary_file)
        # Test that unreadable chroot files don't break coloredlogs.
        try:
            CHROOT_FILES.insert(0, temporary_file)
            # Make sure that a usable value is still produced.
            assert find_hostname()
        finally:
            # Clean up.
            CHROOT_FILES.pop(0)

    def test_host_name_filter(self):
        """Make sure :func:`install()` integrates with :class:`~coloredlogs.HostNameFilter()`."""
        install(fmt='%(hostname)s')
        with CaptureOutput() as capturer:
            logging.info("A truly insignificant message ..")
            output = capturer.get_text()
            assert find_hostname() in output

    def test_program_name_filter(self):
        """Make sure :func:`install()` integrates with :class:`~coloredlogs.ProgramNameFilter()`."""
        install(fmt='%(programname)s')
        with CaptureOutput() as capturer:
            logging.info("A truly insignificant message ..")
            output = capturer.get_text()
            assert find_program_name() in output

    def test_username_filter(self):
        """Make sure :func:`install()` integrates with :class:`~coloredlogs.UserNameFilter()`."""
        install(fmt='%(username)s')
        with CaptureOutput() as capturer:
            logging.info("A truly insignificant message ..")
            output = capturer.get_text()
            assert find_username() in output

    def test_system_logging(self):
        """Make sure the :class:`coloredlogs.syslog.SystemLogging` context manager works."""
        system_log_file = self.find_system_log()
        expected_message = random_string(50)
        with SystemLogging(programname='coloredlogs-test-suite') as syslog:
            if not syslog:
                return self.skipTest("couldn't connect to syslog daemon")
            # When I tried out the system logging support on macOS 10.13.1 on
            # 2018-01-05 I found that while WARNING and ERROR messages show up
            # in the system log DEBUG and INFO messages don't. This explains
            # the importance of the level of the log message below.
            logging.error("%s", expected_message)
        # Retry the following assertion (for up to 60 seconds) to give the
        # logging daemon time to write our log message to disk. This
        # appears to be needed on MacOS workers on Travis CI, see:
        # https://travis-ci.org/xolox/python-coloredlogs/jobs/325245853
        retry(lambda: check_contents(system_log_file, expected_message, True))

    def test_system_logging_override(self):
        """Make sure the :class:`coloredlogs.syslog.is_syslog_supported` respects the override."""
        with PatchedItem(os.environ, 'COLOREDLOGS_SYSLOG', 'true'):
            assert is_syslog_supported() is True
        with PatchedItem(os.environ, 'COLOREDLOGS_SYSLOG', 'false'):
            assert is_syslog_supported() is False

    def test_syslog_shortcut_simple(self):
        """Make sure that ``coloredlogs.install(syslog=True)`` works."""
        system_log_file = self.find_system_log()
        expected_message = random_string(50)
        with cleanup_handlers():
            # See test_system_logging() for the importance of this log level.
            coloredlogs.install(syslog=True)
            logging.error("%s", expected_message)
        # See the comments in test_system_logging() on why this is retried.
        retry(lambda: check_contents(system_log_file, expected_message, True))

    def test_syslog_shortcut_enhanced(self):
        """Make sure that ``coloredlogs.install(syslog='warning')`` works."""
        system_log_file = self.find_system_log()
        the_expected_message = random_string(50)
        not_an_expected_message = random_string(50)
        with cleanup_handlers():
            # See test_system_logging() for the importance of these log levels.
            coloredlogs.install(syslog='error')
            logging.warning("%s", not_an_expected_message)
            logging.error("%s", the_expected_message)
        # See the comments in test_system_logging() on why this is retried.
        retry(lambda: check_contents(system_log_file, the_expected_message, True))
        retry(lambda: check_contents(system_log_file, not_an_expected_message, False))

    def test_name_normalization(self):
        """Make sure :class:`~coloredlogs.NameNormalizer` works as intended."""
        nn = NameNormalizer()
        for canonical_name in ['debug', 'info', 'warning', 'error', 'critical']:
            assert nn.normalize_name(canonical_name) == canonical_name
            assert nn.normalize_name(canonical_name.upper()) == canonical_name
        assert nn.normalize_name('warn') == 'warning'
        assert nn.normalize_name('fatal') == 'critical'

    def test_style_parsing(self):
        """Make sure :func:`~coloredlogs.parse_encoded_styles()` works as intended."""
        encoded_styles = 'debug=green;warning=yellow;error=red;critical=red,bold'
        decoded_styles = parse_encoded_styles(encoded_styles, normalize_key=lambda k: k.upper())
        assert sorted(decoded_styles.keys()) == sorted(['debug', 'warning', 'error', 'critical'])
        assert decoded_styles['debug']['color'] == 'green'
        assert decoded_styles['warning']['color'] == 'yellow'
        assert decoded_styles['error']['color'] == 'red'
        assert decoded_styles['critical']['color'] == 'red'
        assert decoded_styles['critical']['bold'] is True

    def test_is_verbose(self):
        """Make sure is_verbose() does what it should :-)."""
        set_level(logging.INFO)
        assert not is_verbose()
        set_level(logging.DEBUG)
        assert is_verbose()
        set_level(logging.VERBOSE)
        assert is_verbose()

    def test_increase_verbosity(self):
        """Make sure increase_verbosity() respects default and custom levels."""
        # Start from a known state.
        set_level(logging.INFO)
        assert get_level() == logging.INFO
        # INFO -> VERBOSE.
        increase_verbosity()
        assert get_level() == logging.VERBOSE
        # VERBOSE -> DEBUG.
        increase_verbosity()
        assert get_level() == logging.DEBUG
        # DEBUG -> SPAM.
        increase_verbosity()
        assert get_level() == logging.SPAM
        # SPAM -> NOTSET.
        increase_verbosity()
        assert get_level() == logging.NOTSET
        # NOTSET -> NOTSET.
        increase_verbosity()
        assert get_level() == logging.NOTSET

    def test_decrease_verbosity(self):
        """Make sure decrease_verbosity() respects default and custom levels."""
        # Start from a known state.
        set_level(logging.INFO)
        assert get_level() == logging.INFO
        # INFO -> NOTICE.
        decrease_verbosity()
        assert get_level() == logging.NOTICE
        # NOTICE -> WARNING.
        decrease_verbosity()
        assert get_level() == logging.WARNING
        # WARNING -> SUCCESS.
        decrease_verbosity()
        assert get_level() == logging.SUCCESS
        # SUCCESS -> ERROR.
        decrease_verbosity()
        assert get_level() == logging.ERROR
        # ERROR -> CRITICAL.
        decrease_verbosity()
        assert get_level() == logging.CRITICAL
        # CRITICAL -> CRITICAL.
        decrease_verbosity()
        assert get_level() == logging.CRITICAL

    def test_level_discovery(self):
        """Make sure find_defined_levels() always reports the levels defined in Python's standard library."""
        defined_levels = find_defined_levels()
        level_values = defined_levels.values()
        for number in (0, 10, 20, 30, 40, 50):
            assert number in level_values

    def test_walk_propagation_tree(self):
        """Make sure walk_propagation_tree() properly walks the tree of loggers."""
        root, parent, child, grand_child = self.get_logger_tree()
        # Check the default mode of operation.
        loggers = list(walk_propagation_tree(grand_child))
        assert loggers == [grand_child, child, parent, root]
        # Now change the propagation (non-default mode of operation).
        child.propagate = False
        loggers = list(walk_propagation_tree(grand_child))
        assert loggers == [grand_child, child]

    def test_find_handler(self):
        """Make sure find_handler() works as intended."""
        root, parent, child, grand_child = self.get_logger_tree()
        # Add some handlers to the tree.
        stream_handler = logging.StreamHandler()
        syslog_handler = logging.handlers.SysLogHandler()
        child.addHandler(stream_handler)
        parent.addHandler(syslog_handler)
        # Make sure the first matching handler is returned.
        matched_handler, matched_logger = find_handler(grand_child, lambda h: isinstance(h, logging.Handler))
        assert matched_handler is stream_handler
        # Make sure the first matching handler of the given type is returned.
        matched_handler, matched_logger = find_handler(child, lambda h: isinstance(h, logging.handlers.SysLogHandler))
        assert matched_handler is syslog_handler

    def get_logger_tree(self):
        """Create and return a tree of loggers."""
        # Get the root logger.
        root = logging.getLogger()
        # Create a top level logger for ourselves.
        parent_name = random_string()
        parent = logging.getLogger(parent_name)
        # Create a child logger.
        child_name = '%s.%s' % (parent_name, random_string())
        child = logging.getLogger(child_name)
        # Create a grand child logger.
        grand_child_name = '%s.%s' % (child_name, random_string())
        grand_child = logging.getLogger(grand_child_name)
        return root, parent, child, grand_child

    def test_support_for_milliseconds(self):
        """Make sure milliseconds are hidden by default but can be easily enabled."""
        # Check that the default log format doesn't include milliseconds.
        stream = StringIO()
        install(reconfigure=True, stream=stream)
        logging.info("This should not include milliseconds.")
        assert all(map(PLAIN_TEXT_PATTERN.match, stream.getvalue().splitlines()))
        # Check that milliseconds can be enabled via a shortcut.
        stream = StringIO()
        install(milliseconds=True, reconfigure=True, stream=stream)
        logging.info("This should include milliseconds.")
        assert all(map(PATTERN_INCLUDING_MILLISECONDS.match, stream.getvalue().splitlines()))

    def test_support_for_milliseconds_directive(self):
        """Make sure milliseconds using the ``%f`` directive are supported."""
        stream = StringIO()
        install(reconfigure=True, stream=stream, datefmt='%Y-%m-%dT%H:%M:%S.%f%z')
        logging.info("This should be timestamped according to #45.")
        assert re.match(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{4}\s', stream.getvalue())

    def test_plain_text_output_format(self):
        """Inspect the plain text output of coloredlogs."""
        logger = VerboseLogger(random_string(25))
        stream = StringIO()
        install(level=logging.NOTSET, logger=logger, stream=stream)
        # Test that filtering on severity works.
        logger.setLevel(logging.INFO)
        logger.debug("No one should see this message.")
        assert len(stream.getvalue().strip()) == 0
        # Test that the default output format looks okay in plain text.
        logger.setLevel(logging.NOTSET)
        for method, severity in ((logger.debug, 'DEBUG'),
                                 (logger.info, 'INFO'),
                                 (logger.verbose, 'VERBOSE'),
                                 (logger.warning, 'WARNING'),
                                 (logger.error, 'ERROR'),
                                 (logger.critical, 'CRITICAL')):
            # XXX Workaround for a regression in Python 3.7 caused by the
            # Logger.isEnabledFor() method using stale cache entries. If we
            # don't clear the cache then logger.isEnabledFor(logging.DEBUG)
            # returns False and no DEBUG message is emitted.
            try:
                logger._cache.clear()
            except AttributeError:
                pass
            # Prepare the text.
            text = "This is a message with severity %r." % severity.lower()
            # Log the message with the given severity.
            method(text)
            # Get the line of output generated by the handler.
            output = stream.getvalue()
            lines = output.splitlines()
            last_line = lines[-1]
            assert text in last_line
            assert severity in last_line
            assert PLAIN_TEXT_PATTERN.match(last_line)

    def test_dynamic_stderr_lookup(self):
        """Make sure coloredlogs.install() uses StandardErrorHandler when possible."""
        coloredlogs.install()
        # Redirect sys.stderr to a temporary buffer.
        initial_stream = StringIO()
        initial_text = "Which stream will receive this text?"
        with PatchedAttribute(sys, 'stderr', initial_stream):
            logging.info(initial_text)
        assert initial_text in initial_stream.getvalue()
        # Redirect sys.stderr again, to a different destination.
        subsequent_stream = StringIO()
        subsequent_text = "And which stream will receive this other text?"
        with PatchedAttribute(sys, 'stderr', subsequent_stream):
            logging.info(subsequent_text)
        assert subsequent_text in subsequent_stream.getvalue()

    def test_force_enable(self):
        """Make sure ANSI escape sequences can be forced (bypassing auto-detection)."""
        interpreter = subprocess.Popen([
            sys.executable, "-c", ";".join([
                "import coloredlogs, logging",
                "coloredlogs.install(isatty=True)",
                "logging.info('Hello world')",
            ]),
        ], stderr=subprocess.PIPE)
        stdout, stderr = interpreter.communicate()
        assert ANSI_CSI in stderr.decode('UTF-8')

    def test_auto_disable(self):
        """
        Make sure ANSI escape sequences are not emitted when logging output is being redirected.

        This is a regression test for https://github.com/xolox/python-coloredlogs/issues/100.

        It works as follows:

        1. We mock an interactive terminal using 'capturer' to ensure that this
           test works inside test drivers that capture output (like pytest).

        2. We launch a subprocess (to ensure a clean process state) where
           stderr is captured but stdout is not, emulating issue #100.

        3. The output captured on stderr contained ANSI escape sequences after
           this test was written and before the issue was fixed, so now this
           serves as a regression test for issue #100.
        """
        with CaptureOutput():
            interpreter = subprocess.Popen([
                sys.executable, "-c", ";".join([
                    "import coloredlogs, logging",
                    "coloredlogs.install()",
                    "logging.info('Hello world')",
                ]),
            ], stderr=subprocess.PIPE)
            stdout, stderr = interpreter.communicate()
            assert ANSI_CSI not in stderr.decode('UTF-8')

    def test_env_disable(self):
        """Make sure ANSI escape sequences can be disabled using ``$NO_COLOR``."""
        with PatchedItem(os.environ, 'NO_COLOR', 'I like monochrome'):
            with CaptureOutput() as capturer:
                subprocess.check_call([
                    sys.executable, "-c", ";".join([
                        "import coloredlogs, logging",
                        "coloredlogs.install()",
                        "logging.info('Hello world')",
                    ]),
                ])
                output = capturer.get_text()
                assert ANSI_CSI not in output

    def test_html_conversion(self):
        """Check the conversion from ANSI escape sequences to HTML."""
        # Check conversion of colored text.
        for color_name, ansi_code in ANSI_COLOR_CODES.items():
            ansi_encoded_text = 'plain text followed by %s text' % ansi_wrap(color_name, color=color_name)
            expected_html = format(
                '<code>plain text followed by <span style="color:{css}">{name}</span> text</code>',
                css=EIGHT_COLOR_PALETTE[ansi_code], name=color_name,
            )
            self.assertEqual(expected_html, convert(ansi_encoded_text))
        # Check conversion of bright colored text.
        expected_html = '<code><span style="color:#FF0">bright yellow</span></code>'
        self.assertEqual(expected_html, convert(ansi_wrap('bright yellow', color='yellow', bright=True)))
        # Check conversion of text with a background color.
        expected_html = '<code><span style="background-color:#DE382B">red background</span></code>'
        self.assertEqual(expected_html, convert(ansi_wrap('red background', background='red')))
        # Check conversion of text with a bright background color.
        expected_html = '<code><span style="background-color:#F00">bright red background</span></code>'
        self.assertEqual(expected_html, convert(ansi_wrap('bright red background', background='red', bright=True)))
        # Check conversion of text that uses the 256 color mode palette as a foreground color.
        expected_html = '<code><span style="color:#FFAF00">256 color mode foreground</span></code>'
        self.assertEqual(expected_html, convert(ansi_wrap('256 color mode foreground', color=214)))
        # Check conversion of text that uses the 256 color mode palette as a background color.
        expected_html = '<code><span style="background-color:#AF0000">256 color mode background</span></code>'
        self.assertEqual(expected_html, convert(ansi_wrap('256 color mode background', background=124)))
        # Check that invalid 256 color mode indexes don't raise exceptions.
        expected_html = '<code>plain text expected</code>'
        self.assertEqual(expected_html, convert('\x1b[38;5;256mplain text expected\x1b[0m'))
        # Check conversion of bold text.
        expected_html = '<code><span style="font-weight:bold">bold text</span></code>'
        self.assertEqual(expected_html, convert(ansi_wrap('bold text', bold=True)))
        # Check conversion of underlined text.
        expected_html = '<code><span style="text-decoration:underline">underlined text</span></code>'
        self.assertEqual(expected_html, convert(ansi_wrap('underlined text', underline=True)))
        # Check conversion of strike-through text.
        expected_html = '<code><span style="text-decoration:line-through">strike-through text</span></code>'
        self.assertEqual(expected_html, convert(ansi_wrap('strike-through text', strike_through=True)))
        # Check conversion of inverse text.
        expected_html = '<code><span style="background-color:#FFC706;color:#000">inverse</span></code>'
        self.assertEqual(expected_html, convert(ansi_wrap('inverse', color='yellow', inverse=True)))
        # Check conversion of URLs.
        for sample_text in 'www.python.org', 'http://coloredlogs.rtfd.org', 'https://coloredlogs.rtfd.org':
            sample_url = sample_text if '://' in sample_text else ('http://' + sample_text)
            expected_html = '<code><a href="%s" style="color:inherit">%s</a></code>' % (sample_url, sample_text)
            self.assertEqual(expected_html, convert(sample_text))
        # Check that the capture pattern for URLs doesn't match ANSI escape
        # sequences and also check that the short hand for the 0 reset code is
        # supported. These are tests for regressions of bugs found in
        # coloredlogs <= 8.0.
        reset_short_hand = '\x1b[0m'
        blue_underlined = ansi_style(color='blue', underline=True)
        ansi_encoded_text = '<%shttps://coloredlogs.readthedocs.io%s>' % (blue_underlined, reset_short_hand)
        expected_html = (
            '<code>&lt;<span style="color:#006FB8;text-decoration:underline">'
            '<a href="https://coloredlogs.readthedocs.io" style="color:inherit">'
            'https://coloredlogs.readthedocs.io'
            '</a></span>&gt;</code>'
        )
        self.assertEqual(expected_html, convert(ansi_encoded_text))

    def test_output_interception(self):
        """Test capturing of output from external commands."""
        expected_output = 'testing, 1, 2, 3 ..'
        actual_output = capture(['echo', expected_output])
        assert actual_output.strip() == expected_output.strip()

    def test_enable_colored_cron_mailer(self):
        """Test that automatic ANSI to HTML conversion when running under ``cron`` can be enabled."""
        with PatchedItem(os.environ, 'CONTENT_TYPE', 'text/html'):
            with ColoredCronMailer() as mailer:
                assert mailer.is_enabled

    def test_disable_colored_cron_mailer(self):
        """Test that automatic ANSI to HTML conversion when running under ``cron`` can be disabled."""
        with PatchedItem(os.environ, 'CONTENT_TYPE', 'text/plain'):
            with ColoredCronMailer() as mailer:
                assert not mailer.is_enabled

    def test_auto_install(self):
        """Test :func:`coloredlogs.auto_install()`."""
        needle = random_string()
        command_line = [sys.executable, '-c', 'import logging; logging.info(%r)' % needle]
        # Sanity check that log messages aren't enabled by default.
        with CaptureOutput() as capturer:
            os.environ['COLOREDLOGS_AUTO_INSTALL'] = 'false'
            subprocess.check_call(command_line)
            output = capturer.get_text()
        assert needle not in output
        # Test that the $COLOREDLOGS_AUTO_INSTALL environment variable can be
        # used to automatically call coloredlogs.install() during initialization.
        with CaptureOutput() as capturer:
            os.environ['COLOREDLOGS_AUTO_INSTALL'] = 'true'
            subprocess.check_call(command_line)
            output = capturer.get_text()
        assert needle in output

    def test_cli_demo(self):
        """Test the command line colored logging demonstration."""
        with CaptureOutput() as capturer:
            main('coloredlogs', '--demo')
            output = capturer.get_text()
        # Make sure the output contains all of the expected logging level names.
        for name in 'debug', 'info', 'warning', 'error', 'critical':
            assert name.upper() in output

    def test_cli_conversion(self):
        """Test the command line HTML conversion."""
        output = main('coloredlogs', '--convert', 'coloredlogs', '--demo', capture=True)
        # Make sure the output is encoded as HTML.
        assert '<span' in output

    def test_empty_conversion(self):
        """
        Test that conversion of empty output produces no HTML.

        This test was added because I found that ``coloredlogs --convert`` when
        used in a cron job could cause cron to send out what appeared to be
        empty emails. On more careful inspection the body of those emails was
        ``<code></code>``. By not emitting the wrapper element when no other
        HTML is generated, cron will not send out an email.
        """
        output = main('coloredlogs', '--convert', 'true', capture=True)
        assert not output.strip()

    def test_implicit_usage_message(self):
        """Test that the usage message is shown when no actions are given."""
        assert 'Usage:' in main('coloredlogs', capture=True)

    def test_explicit_usage_message(self):
        """Test that the usage message is shown when ``--help`` is given."""
        assert 'Usage:' in main('coloredlogs', '--help', capture=True)

    def test_custom_record_factory(self):
        """
        Test that custom LogRecord factories are supported.

        This test is a bit convoluted because the logging module suppresses
        exceptions. We monkey patch the method suspected of encountering
        exceptions so that we can tell after it was called whether any
        exceptions occurred (despite the exceptions not propagating).
        """
        if not hasattr(logging, 'getLogRecordFactory'):
            return self.skipTest("this test requires Python >= 3.2")

        exceptions = []
        original_method = ColoredFormatter.format
        original_factory = logging.getLogRecordFactory()

        def custom_factory(*args, **kwargs):
            record = original_factory(*args, **kwargs)
            record.custom_attribute = 0xdecafbad
            return record

        def custom_method(*args, **kw):
            try:
                return original_method(*args, **kw)
            except Exception as e:
                exceptions.append(e)
                raise

        with PatchedAttribute(ColoredFormatter, 'format', custom_method):
            logging.setLogRecordFactory(custom_factory)
            try:
                demonstrate_colored_logging()
            finally:
                logging.setLogRecordFactory(original_factory)

        # Ensure that no exceptions were triggered.
        assert not exceptions


def check_contents(filename, contents, match):
    """Check if a line in a file contains an expected string."""
    with open(filename) as handle:
        assert any(contents in line for line in handle) == match


def main(*arguments, **options):
    """Wrap the command line interface to make it easier to test."""
    capture = options.get('capture', False)
    saved_argv = sys.argv
    saved_stdout = sys.stdout
    try:
        sys.argv = arguments
        if capture:
            sys.stdout = StringIO()
        coloredlogs.cli.main()
        if capture:
            return sys.stdout.getvalue()
    finally:
        sys.argv = saved_argv
        sys.stdout = saved_stdout


@contextlib.contextmanager
def cleanup_handlers():
    """Context manager to cleanup output handlers."""
    # There's nothing to set up so we immediately yield control.
    yield
    # After the with block ends we cleanup any output handlers.
    for match_func in match_stream_handler, match_syslog_handler:
        handler, logger = find_handler(logging.getLogger(), match_func)
        if handler and logger:
            logger.removeHandler(handler)
