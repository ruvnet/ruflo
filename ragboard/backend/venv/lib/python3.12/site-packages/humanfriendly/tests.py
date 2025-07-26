#!/usr/bin/env python
# vim: fileencoding=utf-8 :

# Tests for the `humanfriendly' package.
#
# Author: Peter Odding <peter.odding@paylogic.eu>
# Last Change: June 11, 2021
# URL: https://humanfriendly.readthedocs.io

"""Test suite for the `humanfriendly` package."""

# Standard library modules.
import datetime
import math
import os
import random
import re
import subprocess
import sys
import time
import types
import unittest
import warnings

# Modules included in our package.
from humanfriendly import (
    InvalidDate,
    InvalidLength,
    InvalidSize,
    InvalidTimespan,
    Timer,
    coerce_boolean,
    coerce_pattern,
    format_length,
    format_number,
    format_path,
    format_size,
    format_timespan,
    parse_date,
    parse_length,
    parse_path,
    parse_size,
    parse_timespan,
    prompts,
    round_number,
)
from humanfriendly.case import CaseInsensitiveDict, CaseInsensitiveKey
from humanfriendly.cli import main
from humanfriendly.compat import StringIO
from humanfriendly.decorators import cached
from humanfriendly.deprecation import DeprecationProxy, define_aliases, deprecated_args, get_aliases
from humanfriendly.prompts import (
    TooManyInvalidReplies,
    prompt_for_confirmation,
    prompt_for_choice,
    prompt_for_input,
)
from humanfriendly.sphinx import (
    deprecation_note_callback,
    man_role,
    pypi_role,
    setup,
    special_methods_callback,
    usage_message_callback,
)
from humanfriendly.tables import (
    format_pretty_table,
    format_robust_table,
    format_rst_table,
    format_smart_table,
)
from humanfriendly.terminal import (
    ANSI_CSI,
    ANSI_ERASE_LINE,
    ANSI_HIDE_CURSOR,
    ANSI_RESET,
    ANSI_SGR,
    ANSI_SHOW_CURSOR,
    ansi_strip,
    ansi_style,
    ansi_width,
    ansi_wrap,
    clean_terminal_output,
    connected_to_terminal,
    find_terminal_size,
    get_pager_command,
    message,
    output,
    show_pager,
    terminal_supports_colors,
    warning,
)
from humanfriendly.terminal.html import html_to_ansi
from humanfriendly.terminal.spinners import AutomaticSpinner, Spinner
from humanfriendly.testing import (
    CallableTimedOut,
    CaptureOutput,
    MockedProgram,
    PatchedAttribute,
    PatchedItem,
    TemporaryDirectory,
    TestCase,
    retry,
    run_cli,
    skip_on_raise,
    touch,
)
from humanfriendly.text import (
    compact,
    compact_empty_lines,
    concatenate,
    dedent,
    generate_slug,
    pluralize,
    random_string,
    trim_empty_lines,
)
from humanfriendly.usage import (
    find_meta_variables,
    format_usage,
    parse_usage,
    render_usage,
)

# Test dependencies.
from mock import MagicMock


class HumanFriendlyTestCase(TestCase):

    """Container for the `humanfriendly` test suite."""

    def test_case_insensitive_dict(self):
        """Test the CaseInsensitiveDict class."""
        # Test support for the dict(iterable) signature.
        assert len(CaseInsensitiveDict([('key', True), ('KEY', False)])) == 1
        # Test support for the dict(iterable, **kw) signature.
        assert len(CaseInsensitiveDict([('one', True), ('ONE', False)], one=False, two=True)) == 2
        # Test support for the dict(mapping) signature.
        assert len(CaseInsensitiveDict(dict(key=True, KEY=False))) == 1
        # Test support for the dict(mapping, **kw) signature.
        assert len(CaseInsensitiveDict(dict(one=True, ONE=False), one=False, two=True)) == 2
        # Test support for the dict(**kw) signature.
        assert len(CaseInsensitiveDict(one=True, ONE=False, two=True)) == 2
        # Test support for dict.fromkeys().
        obj = CaseInsensitiveDict.fromkeys(["One", "one", "ONE", "Two", "two", "TWO"])
        assert len(obj) == 2
        # Test support for dict.get().
        obj = CaseInsensitiveDict(existing_key=42)
        assert obj.get('Existing_Key') == 42
        # Test support for dict.pop().
        obj = CaseInsensitiveDict(existing_key=42)
        assert obj.pop('Existing_Key') == 42
        assert len(obj) == 0
        # Test support for dict.setdefault().
        obj = CaseInsensitiveDict(existing_key=42)
        assert obj.setdefault('Existing_Key') == 42
        obj.setdefault('other_key', 11)
        assert obj['Other_Key'] == 11
        # Test support for dict.__contains__().
        obj = CaseInsensitiveDict(existing_key=42)
        assert 'Existing_Key' in obj
        # Test support for dict.__delitem__().
        obj = CaseInsensitiveDict(existing_key=42)
        del obj['Existing_Key']
        assert len(obj) == 0
        # Test support for dict.__getitem__().
        obj = CaseInsensitiveDict(existing_key=42)
        assert obj['Existing_Key'] == 42
        # Test support for dict.__setitem__().
        obj = CaseInsensitiveDict(existing_key=42)
        obj['Existing_Key'] = 11
        assert obj['existing_key'] == 11

    def test_case_insensitive_key(self):
        """Test the CaseInsensitiveKey class."""
        # Test the __eq__() special method.
        polite = CaseInsensitiveKey("Please don't shout")
        rude = CaseInsensitiveKey("PLEASE DON'T SHOUT")
        assert polite == rude
        # Test the __hash__() special method.
        mapping = {}
        mapping[polite] = 1
        mapping[rude] = 2
        assert len(mapping) == 1

    def test_capture_output(self):
        """Test the CaptureOutput class."""
        with CaptureOutput() as capturer:
            sys.stdout.write("Something for stdout.\n")
            sys.stderr.write("And for stderr.\n")
            assert capturer.stdout.get_lines() == ["Something for stdout."]
            assert capturer.stderr.get_lines() == ["And for stderr."]

    def test_skip_on_raise(self):
        """Test the skip_on_raise() decorator."""
        def test_fn():
            raise NotImplementedError()
        decorator_fn = skip_on_raise(NotImplementedError)
        decorated_fn = decorator_fn(test_fn)
        self.assertRaises(NotImplementedError, test_fn)
        self.assertRaises(unittest.SkipTest, decorated_fn)

    def test_retry_raise(self):
        """Test :func:`~humanfriendly.testing.retry()` based on assertion errors."""
        # Define a helper function that will raise an assertion error on the
        # first call and return a string on the second call.
        def success_helper():
            if not hasattr(success_helper, 'was_called'):
                setattr(success_helper, 'was_called', True)
                assert False
            else:
                return 'yes'
        assert retry(success_helper) == 'yes'

        # Define a helper function that always raises an assertion error.
        def failure_helper():
            assert False
        with self.assertRaises(AssertionError):
            retry(failure_helper, timeout=1)

    def test_retry_return(self):
        """Test :func:`~humanfriendly.testing.retry()` based on return values."""
        # Define a helper function that will return False on the first call and
        # return a number on the second call.
        def success_helper():
            if not hasattr(success_helper, 'was_called'):
                # On the first call we return False.
                setattr(success_helper, 'was_called', True)
                return False
            else:
                # On the second call we return a number.
                return 42
        assert retry(success_helper) == 42
        with self.assertRaises(CallableTimedOut):
            retry(lambda: False, timeout=1)

    def test_mocked_program(self):
        """Test :class:`humanfriendly.testing.MockedProgram`."""
        name = random_string()
        script = dedent('''
            # This goes to stdout.
            tr a-z A-Z
            # This goes to stderr.
            echo Fake warning >&2
        ''')
        with MockedProgram(name=name, returncode=42, script=script) as directory:
            assert os.path.isdir(directory)
            assert os.path.isfile(os.path.join(directory, name))
            program = subprocess.Popen(name, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            stdout, stderr = program.communicate(input=b'hello world\n')
            assert program.returncode == 42
            assert stdout == b'HELLO WORLD\n'
            assert stderr == b'Fake warning\n'

    def test_temporary_directory(self):
        """Test :class:`humanfriendly.testing.TemporaryDirectory`."""
        with TemporaryDirectory() as directory:
            assert os.path.isdir(directory)
            temporary_file = os.path.join(directory, 'some-file')
            with open(temporary_file, 'w') as handle:
                handle.write("Hello world!")
        assert not os.path.exists(temporary_file)
        assert not os.path.exists(directory)

    def test_touch(self):
        """Test :func:`humanfriendly.testing.touch()`."""
        with TemporaryDirectory() as directory:
            # Create a file in the temporary directory.
            filename = os.path.join(directory, random_string())
            assert not os.path.isfile(filename)
            touch(filename)
            assert os.path.isfile(filename)
            # Create a file in a subdirectory.
            filename = os.path.join(directory, random_string(), random_string())
            assert not os.path.isfile(filename)
            touch(filename)
            assert os.path.isfile(filename)

    def test_patch_attribute(self):
        """Test :class:`humanfriendly.testing.PatchedAttribute`."""
        class Subject(object):
            my_attribute = 42
        instance = Subject()
        assert instance.my_attribute == 42
        with PatchedAttribute(instance, 'my_attribute', 13) as return_value:
            assert return_value is instance
            assert instance.my_attribute == 13
        assert instance.my_attribute == 42

    def test_patch_item(self):
        """Test :class:`humanfriendly.testing.PatchedItem`."""
        instance = dict(my_item=True)
        assert instance['my_item'] is True
        with PatchedItem(instance, 'my_item', False) as return_value:
            assert return_value is instance
            assert instance['my_item'] is False
        assert instance['my_item'] is True

    def test_run_cli_intercepts_exit(self):
        """Test that run_cli() intercepts SystemExit."""
        returncode, output = run_cli(lambda: sys.exit(42))
        self.assertEqual(returncode, 42)

    def test_run_cli_intercepts_error(self):
        """Test that run_cli() intercepts exceptions."""
        returncode, output = run_cli(self.run_cli_raise_other)
        self.assertEqual(returncode, 1)

    def run_cli_raise_other(self):
        """run_cli() sample that raises an exception."""
        raise ValueError()

    def test_run_cli_intercepts_output(self):
        """Test that run_cli() intercepts output."""
        expected_output = random_string() + "\n"
        returncode, output = run_cli(lambda: sys.stdout.write(expected_output))
        self.assertEqual(returncode, 0)
        self.assertEqual(output, expected_output)

    def test_caching_decorator(self):
        """Test the caching decorator."""
        # Confirm that the caching decorator works.
        a = cached(lambda: random.random())
        b = cached(lambda: random.random())
        assert a() == a()
        assert b() == b()
        # Confirm that functions have their own cache.
        assert a() != b()

    def test_compact(self):
        """Test :func:`humanfriendly.text.compact()`."""
        assert compact(' a \n\n b ') == 'a b'
        assert compact('''
            %s template notation
        ''', 'Simple') == 'Simple template notation'
        assert compact('''
            More {type} template notation
        ''', type='readable') == 'More readable template notation'

    def test_compact_empty_lines(self):
        """Test :func:`humanfriendly.text.compact_empty_lines()`."""
        # Simple strings pass through untouched.
        assert compact_empty_lines('foo') == 'foo'
        # Horizontal whitespace remains untouched.
        assert compact_empty_lines('\tfoo') == '\tfoo'
        # Line breaks should be preserved.
        assert compact_empty_lines('foo\nbar') == 'foo\nbar'
        # Vertical whitespace should be preserved.
        assert compact_empty_lines('foo\n\nbar') == 'foo\n\nbar'
        # Vertical whitespace should be compressed.
        assert compact_empty_lines('foo\n\n\nbar') == 'foo\n\nbar'
        assert compact_empty_lines('foo\n\n\n\nbar') == 'foo\n\nbar'
        assert compact_empty_lines('foo\n\n\n\n\nbar') == 'foo\n\nbar'

    def test_dedent(self):
        """Test :func:`humanfriendly.text.dedent()`."""
        assert dedent('\n line 1\n  line 2\n\n') == 'line 1\n line 2\n'
        assert dedent('''
            Dedented, %s text
        ''', 'interpolated') == 'Dedented, interpolated text\n'
        assert dedent('''
            Dedented, {op} text
        ''', op='formatted') == 'Dedented, formatted text\n'

    def test_pluralization(self):
        """Test :func:`humanfriendly.text.pluralize()`."""
        assert pluralize(1, 'word') == '1 word'
        assert pluralize(2, 'word') == '2 words'
        assert pluralize(1, 'box', 'boxes') == '1 box'
        assert pluralize(2, 'box', 'boxes') == '2 boxes'

    def test_generate_slug(self):
        """Test :func:`humanfriendly.text.generate_slug()`."""
        # Test the basic functionality.
        self.assertEqual('some-random-text', generate_slug('Some Random Text!'))
        # Test that previous output doesn't change.
        self.assertEqual('some-random-text', generate_slug('some-random-text'))
        # Test that inputs which can't be converted to a slug raise an exception.
        with self.assertRaises(ValueError):
            generate_slug(' ')
        with self.assertRaises(ValueError):
            generate_slug('-')

    def test_boolean_coercion(self):
        """Test :func:`humanfriendly.coerce_boolean()`."""
        for value in [True, 'TRUE', 'True', 'true', 'on', 'yes', '1']:
            self.assertEqual(True, coerce_boolean(value))
        for value in [False, 'FALSE', 'False', 'false', 'off', 'no', '0']:
            self.assertEqual(False, coerce_boolean(value))
        with self.assertRaises(ValueError):
            coerce_boolean('not a boolean')

    def test_pattern_coercion(self):
        """Test :func:`humanfriendly.coerce_pattern()`."""
        empty_pattern = re.compile('')
        # Make sure strings are converted to compiled regular expressions.
        assert isinstance(coerce_pattern('foobar'), type(empty_pattern))
        # Make sure compiled regular expressions pass through untouched.
        assert empty_pattern is coerce_pattern(empty_pattern)
        # Make sure flags are respected.
        pattern = coerce_pattern('foobar', re.IGNORECASE)
        assert pattern.match('FOOBAR')
        # Make sure invalid values raise the expected exception.
        with self.assertRaises(ValueError):
            coerce_pattern([])

    def test_format_timespan(self):
        """Test :func:`humanfriendly.format_timespan()`."""
        minute = 60
        hour = minute * 60
        day = hour * 24
        week = day * 7
        year = week * 52
        assert '1 nanosecond' == format_timespan(0.000000001, detailed=True)
        assert '500 nanoseconds' == format_timespan(0.0000005, detailed=True)
        assert '1 microsecond' == format_timespan(0.000001, detailed=True)
        assert '500 microseconds' == format_timespan(0.0005, detailed=True)
        assert '1 millisecond' == format_timespan(0.001, detailed=True)
        assert '500 milliseconds' == format_timespan(0.5, detailed=True)
        assert '0.5 seconds' == format_timespan(0.5, detailed=False)
        assert '0 seconds' == format_timespan(0)
        assert '0.54 seconds' == format_timespan(0.54321)
        assert '1 second' == format_timespan(1)
        assert '3.14 seconds' == format_timespan(math.pi)
        assert '1 minute' == format_timespan(minute)
        assert '1 minute and 20 seconds' == format_timespan(80)
        assert '2 minutes' == format_timespan(minute * 2)
        assert '1 hour' == format_timespan(hour)
        assert '2 hours' == format_timespan(hour * 2)
        assert '1 day' == format_timespan(day)
        assert '2 days' == format_timespan(day * 2)
        assert '1 week' == format_timespan(week)
        assert '2 weeks' == format_timespan(week * 2)
        assert '1 year' == format_timespan(year)
        assert '2 years' == format_timespan(year * 2)
        assert '6 years, 5 weeks, 4 days, 3 hours, 2 minutes and 500 milliseconds' == \
            format_timespan(year * 6 + week * 5 + day * 4 + hour * 3 + minute * 2 + 0.5, detailed=True)
        assert '1 year, 2 weeks and 3 days' == \
            format_timespan(year + week * 2 + day * 3 + hour * 12)
        # Make sure milliseconds are never shown separately when detailed=False.
        # https://github.com/xolox/python-humanfriendly/issues/10
        assert '1 minute, 1 second and 100 milliseconds' == format_timespan(61.10, detailed=True)
        assert '1 minute and 1.1 seconds' == format_timespan(61.10, detailed=False)
        # Test for loss of precision as reported in issue 11:
        # https://github.com/xolox/python-humanfriendly/issues/11
        assert '1 minute and 0.3 seconds' == format_timespan(60.300)
        assert '5 minutes and 0.3 seconds' == format_timespan(300.300)
        assert '1 second and 15 milliseconds' == format_timespan(1.015, detailed=True)
        assert '10 seconds and 15 milliseconds' == format_timespan(10.015, detailed=True)
        assert '1 microsecond and 50 nanoseconds' == format_timespan(0.00000105, detailed=True)
        # Test the datetime.timedelta support:
        # https://github.com/xolox/python-humanfriendly/issues/27
        now = datetime.datetime.now()
        then = now - datetime.timedelta(hours=23)
        assert '23 hours' == format_timespan(now - then)

    def test_parse_timespan(self):
        """Test :func:`humanfriendly.parse_timespan()`."""
        self.assertEqual(0, parse_timespan('0'))
        self.assertEqual(0, parse_timespan('0s'))
        self.assertEqual(0.000000001, parse_timespan('1ns'))
        self.assertEqual(0.000000051, parse_timespan('51ns'))
        self.assertEqual(0.000001, parse_timespan('1us'))
        self.assertEqual(0.000052, parse_timespan('52us'))
        self.assertEqual(0.001, parse_timespan('1ms'))
        self.assertEqual(0.001, parse_timespan('1 millisecond'))
        self.assertEqual(0.5, parse_timespan('500 milliseconds'))
        self.assertEqual(0.5, parse_timespan('0.5 seconds'))
        self.assertEqual(5, parse_timespan('5s'))
        self.assertEqual(5, parse_timespan('5 seconds'))
        self.assertEqual(60 * 2, parse_timespan('2m'))
        self.assertEqual(60 * 2, parse_timespan('2 minutes'))
        self.assertEqual(60 * 3, parse_timespan('3 min'))
        self.assertEqual(60 * 3, parse_timespan('3 mins'))
        self.assertEqual(60 * 60 * 3, parse_timespan('3 h'))
        self.assertEqual(60 * 60 * 3, parse_timespan('3 hours'))
        self.assertEqual(60 * 60 * 24 * 4, parse_timespan('4d'))
        self.assertEqual(60 * 60 * 24 * 4, parse_timespan('4 days'))
        self.assertEqual(60 * 60 * 24 * 7 * 5, parse_timespan('5 w'))
        self.assertEqual(60 * 60 * 24 * 7 * 5, parse_timespan('5 weeks'))
        with self.assertRaises(InvalidTimespan):
            parse_timespan('1z')

    def test_parse_date(self):
        """Test :func:`humanfriendly.parse_date()`."""
        self.assertEqual((2013, 6, 17, 0, 0, 0), parse_date('2013-06-17'))
        self.assertEqual((2013, 6, 17, 2, 47, 42), parse_date('2013-06-17 02:47:42'))
        self.assertEqual((2016, 11, 30, 0, 47, 17), parse_date(u'2016-11-30 00:47:17'))
        with self.assertRaises(InvalidDate):
            parse_date('2013-06-XY')

    def test_format_size(self):
        """Test :func:`humanfriendly.format_size()`."""
        self.assertEqual('0 bytes', format_size(0))
        self.assertEqual('1 byte', format_size(1))
        self.assertEqual('42 bytes', format_size(42))
        self.assertEqual('1 KB', format_size(1000 ** 1))
        self.assertEqual('1 MB', format_size(1000 ** 2))
        self.assertEqual('1 GB', format_size(1000 ** 3))
        self.assertEqual('1 TB', format_size(1000 ** 4))
        self.assertEqual('1 PB', format_size(1000 ** 5))
        self.assertEqual('1 EB', format_size(1000 ** 6))
        self.assertEqual('1 ZB', format_size(1000 ** 7))
        self.assertEqual('1 YB', format_size(1000 ** 8))
        self.assertEqual('1 KiB', format_size(1024 ** 1, binary=True))
        self.assertEqual('1 MiB', format_size(1024 ** 2, binary=True))
        self.assertEqual('1 GiB', format_size(1024 ** 3, binary=True))
        self.assertEqual('1 TiB', format_size(1024 ** 4, binary=True))
        self.assertEqual('1 PiB', format_size(1024 ** 5, binary=True))
        self.assertEqual('1 EiB', format_size(1024 ** 6, binary=True))
        self.assertEqual('1 ZiB', format_size(1024 ** 7, binary=True))
        self.assertEqual('1 YiB', format_size(1024 ** 8, binary=True))
        self.assertEqual('45 KB', format_size(1000 * 45))
        self.assertEqual('2.9 TB', format_size(1000 ** 4 * 2.9))

    def test_parse_size(self):
        """Test :func:`humanfriendly.parse_size()`."""
        self.assertEqual(0, parse_size('0B'))
        self.assertEqual(42, parse_size('42'))
        self.assertEqual(42, parse_size('42B'))
        self.assertEqual(1000, parse_size('1k'))
        self.assertEqual(1024, parse_size('1k', binary=True))
        self.assertEqual(1000, parse_size('1 KB'))
        self.assertEqual(1000, parse_size('1 kilobyte'))
        self.assertEqual(1024, parse_size('1 kilobyte', binary=True))
        self.assertEqual(1000 ** 2 * 69, parse_size('69 MB'))
        self.assertEqual(1000 ** 3, parse_size('1 GB'))
        self.assertEqual(1000 ** 4, parse_size('1 TB'))
        self.assertEqual(1000 ** 5, parse_size('1 PB'))
        self.assertEqual(1000 ** 6, parse_size('1 EB'))
        self.assertEqual(1000 ** 7, parse_size('1 ZB'))
        self.assertEqual(1000 ** 8, parse_size('1 YB'))
        self.assertEqual(1000 ** 3 * 1.5, parse_size('1.5 GB'))
        self.assertEqual(1024 ** 8 * 1.5, parse_size('1.5 YiB'))
        with self.assertRaises(InvalidSize):
            parse_size('1q')
        with self.assertRaises(InvalidSize):
            parse_size('a')

    def test_format_length(self):
        """Test :func:`humanfriendly.format_length()`."""
        self.assertEqual('0 metres', format_length(0))
        self.assertEqual('1 metre', format_length(1))
        self.assertEqual('42 metres', format_length(42))
        self.assertEqual('1 km', format_length(1 * 1000))
        self.assertEqual('15.3 cm', format_length(0.153))
        self.assertEqual('1 cm', format_length(1e-02))
        self.assertEqual('1 mm', format_length(1e-03))
        self.assertEqual('1 nm', format_length(1e-09))

    def test_parse_length(self):
        """Test :func:`humanfriendly.parse_length()`."""
        self.assertEqual(0, parse_length('0m'))
        self.assertEqual(42, parse_length('42'))
        self.assertEqual(1.5, parse_length('1.5'))
        self.assertEqual(42, parse_length('42m'))
        self.assertEqual(1000, parse_length('1km'))
        self.assertEqual(0.153, parse_length('15.3 cm'))
        self.assertEqual(1e-02, parse_length('1cm'))
        self.assertEqual(1e-03, parse_length('1mm'))
        self.assertEqual(1e-09, parse_length('1nm'))
        with self.assertRaises(InvalidLength):
            parse_length('1z')
        with self.assertRaises(InvalidLength):
            parse_length('a')

    def test_format_number(self):
        """Test :func:`humanfriendly.format_number()`."""
        self.assertEqual('1', format_number(1))
        self.assertEqual('1.5', format_number(1.5))
        self.assertEqual('1.56', format_number(1.56789))
        self.assertEqual('1.567', format_number(1.56789, 3))
        self.assertEqual('1,000', format_number(1000))
        self.assertEqual('1,000', format_number(1000.12, 0))
        self.assertEqual('1,000,000', format_number(1000000))
        self.assertEqual('1,000,000.42', format_number(1000000.42))
        # Regression test for https://github.com/xolox/python-humanfriendly/issues/40.
        self.assertEqual('-285.67', format_number(-285.67))

    def test_round_number(self):
        """Test :func:`humanfriendly.round_number()`."""
        self.assertEqual('1', round_number(1))
        self.assertEqual('1', round_number(1.0))
        self.assertEqual('1.00', round_number(1, keep_width=True))
        self.assertEqual('3.14', round_number(3.141592653589793))

    def test_format_path(self):
        """Test :func:`humanfriendly.format_path()`."""
        friendly_path = os.path.join('~', '.vimrc')
        absolute_path = os.path.join(os.environ['HOME'], '.vimrc')
        self.assertEqual(friendly_path, format_path(absolute_path))

    def test_parse_path(self):
        """Test :func:`humanfriendly.parse_path()`."""
        friendly_path = os.path.join('~', '.vimrc')
        absolute_path = os.path.join(os.environ['HOME'], '.vimrc')
        self.assertEqual(absolute_path, parse_path(friendly_path))

    def test_pretty_tables(self):
        """Test :func:`humanfriendly.tables.format_pretty_table()`."""
        # The simplest case possible :-).
        data = [['Just one column']]
        assert format_pretty_table(data) == dedent("""
            -------------------
            | Just one column |
            -------------------
        """).strip()
        # A bit more complex: two rows, three columns, varying widths.
        data = [['One', 'Two', 'Three'], ['1', '2', '3']]
        assert format_pretty_table(data) == dedent("""
            ---------------------
            | One | Two | Three |
            | 1   | 2   | 3     |
            ---------------------
        """).strip()
        # A table including column names.
        column_names = ['One', 'Two', 'Three']
        data = [['1', '2', '3'], ['a', 'b', 'c']]
        assert ansi_strip(format_pretty_table(data, column_names)) == dedent("""
            ---------------------
            | One | Two | Three |
            ---------------------
            | 1   | 2   | 3     |
            | a   | b   | c     |
            ---------------------
        """).strip()
        # A table that contains a column with only numeric data (will be right aligned).
        column_names = ['Just a label', 'Important numbers']
        data = [['Row one', '15'], ['Row two', '300']]
        assert ansi_strip(format_pretty_table(data, column_names)) == dedent("""
            ------------------------------------
            | Just a label | Important numbers |
            ------------------------------------
            | Row one      |                15 |
            | Row two      |               300 |
            ------------------------------------
        """).strip()

    def test_robust_tables(self):
        """Test :func:`humanfriendly.tables.format_robust_table()`."""
        column_names = ['One', 'Two', 'Three']
        data = [['1', '2', '3'], ['a', 'b', 'c']]
        assert ansi_strip(format_robust_table(data, column_names)) == dedent("""
            --------
            One: 1
            Two: 2
            Three: 3
            --------
            One: a
            Two: b
            Three: c
            --------
        """).strip()
        column_names = ['One', 'Two', 'Three']
        data = [['1', '2', '3'], ['a', 'b', 'Here comes a\nmulti line column!']]
        assert ansi_strip(format_robust_table(data, column_names)) == dedent("""
            ------------------
            One: 1
            Two: 2
            Three: 3
            ------------------
            One: a
            Two: b
            Three:
            Here comes a
            multi line column!
            ------------------
        """).strip()

    def test_smart_tables(self):
        """Test :func:`humanfriendly.tables.format_smart_table()`."""
        column_names = ['One', 'Two', 'Three']
        data = [['1', '2', '3'], ['a', 'b', 'c']]
        assert ansi_strip(format_smart_table(data, column_names)) == dedent("""
            ---------------------
            | One | Two | Three |
            ---------------------
            | 1   | 2   | 3     |
            | a   | b   | c     |
            ---------------------
        """).strip()
        column_names = ['One', 'Two', 'Three']
        data = [['1', '2', '3'], ['a', 'b', 'Here comes a\nmulti line column!']]
        assert ansi_strip(format_smart_table(data, column_names)) == dedent("""
            ------------------
            One: 1
            Two: 2
            Three: 3
            ------------------
            One: a
            Two: b
            Three:
            Here comes a
            multi line column!
            ------------------
        """).strip()

    def test_rst_tables(self):
        """Test :func:`humanfriendly.tables.format_rst_table()`."""
        # Generate a table with column names.
        column_names = ['One', 'Two', 'Three']
        data = [['1', '2', '3'], ['a', 'b', 'c']]
        self.assertEqual(
            format_rst_table(data, column_names),
            dedent("""
                ===  ===  =====
                One  Two  Three
                ===  ===  =====
                1    2    3
                a    b    c
                ===  ===  =====
            """).rstrip(),
        )
        # Generate a table without column names.
        data = [['1', '2', '3'], ['a', 'b', 'c']]
        self.assertEqual(
            format_rst_table(data),
            dedent("""
                =  =  =
                1  2  3
                a  b  c
                =  =  =
            """).rstrip(),
        )

    def test_concatenate(self):
        """Test :func:`humanfriendly.text.concatenate()`."""
        assert concatenate([]) == ''
        assert concatenate(['one']) == 'one'
        assert concatenate(['one', 'two']) == 'one and two'
        assert concatenate(['one', 'two', 'three']) == 'one, two and three'
        # Test the 'conjunction' option.
        assert concatenate(['one', 'two', 'three'], conjunction='or') == 'one, two or three'
        # Test the 'serial_comma' option.
        assert concatenate(['one', 'two', 'three'], serial_comma=True) == 'one, two, and three'

    def test_split(self):
        """Test :func:`humanfriendly.text.split()`."""
        from humanfriendly.text import split
        self.assertEqual(split(''), [])
        self.assertEqual(split('foo'), ['foo'])
        self.assertEqual(split('foo, bar'), ['foo', 'bar'])
        self.assertEqual(split('foo, bar, baz'), ['foo', 'bar', 'baz'])
        self.assertEqual(split('foo,bar,baz'), ['foo', 'bar', 'baz'])

    def test_timer(self):
        """Test :func:`humanfriendly.Timer`."""
        for seconds, text in ((1, '1 second'),
                              (2, '2 seconds'),
                              (60, '1 minute'),
                              (60 * 2, '2 minutes'),
                              (60 * 60, '1 hour'),
                              (60 * 60 * 2, '2 hours'),
                              (60 * 60 * 24, '1 day'),
                              (60 * 60 * 24 * 2, '2 days'),
                              (60 * 60 * 24 * 7, '1 week'),
                              (60 * 60 * 24 * 7 * 2, '2 weeks')):
            t = Timer(time.time() - seconds)
            self.assertEqual(round_number(t.elapsed_time, keep_width=True), '%i.00' % seconds)
            self.assertEqual(str(t), text)
        # Test rounding to seconds.
        t = Timer(time.time() - 2.2)
        self.assertEqual(t.rounded, '2 seconds')
        # Test automatic timer.
        automatic_timer = Timer()
        time.sleep(1)
        # XXX The following normalize_timestamp(ndigits=0) calls are intended
        #     to compensate for unreliable clock sources in virtual machines
        #     like those encountered on Travis CI, see also:
        #     https://travis-ci.org/xolox/python-humanfriendly/jobs/323944263
        self.assertEqual(normalize_timestamp(automatic_timer.elapsed_time, 0), '1.00')
        # Test resumable timer.
        resumable_timer = Timer(resumable=True)
        for i in range(2):
            with resumable_timer:
                time.sleep(1)
        self.assertEqual(normalize_timestamp(resumable_timer.elapsed_time, 0), '2.00')
        # Make sure Timer.__enter__() returns the timer object.
        with Timer(resumable=True) as timer:
            assert timer is not None

    def test_spinner(self):
        """Test :func:`humanfriendly.Spinner`."""
        stream = StringIO()
        spinner = Spinner(label='test spinner', total=4, stream=stream, interactive=True)
        for progress in [1, 2, 3, 4]:
            spinner.step(progress=progress)
            time.sleep(0.2)
        spinner.clear()
        output = stream.getvalue()
        output = (output.replace(ANSI_SHOW_CURSOR, '')
                        .replace(ANSI_HIDE_CURSOR, ''))
        lines = [line for line in output.split(ANSI_ERASE_LINE) if line]
        self.assertTrue(len(lines) > 0)
        self.assertTrue(all('test spinner' in line for line in lines))
        self.assertTrue(all('%' in line for line in lines))
        self.assertEqual(sorted(set(lines)), sorted(lines))

    def test_automatic_spinner(self):
        """
        Test :func:`humanfriendly.AutomaticSpinner`.

        There's not a lot to test about the :class:`.AutomaticSpinner` class,
        but by at least running it here we are assured that the code functions
        on all supported Python versions. :class:`.AutomaticSpinner` is built
        on top of the :class:`.Spinner` class so at least we also have the
        tests for the :class:`.Spinner` class to back us up.
        """
        with AutomaticSpinner(label='test spinner'):
            time.sleep(1)

    def test_prompt_for_choice(self):
        """Test :func:`humanfriendly.prompts.prompt_for_choice()`."""
        # Choice selection without any options should raise an exception.
        with self.assertRaises(ValueError):
            prompt_for_choice([])
        # If there's only one option no prompt should be rendered so we expect
        # the following code to not raise an EOFError exception (despite
        # connecting standard input to /dev/null).
        with open(os.devnull) as handle:
            with PatchedAttribute(sys, 'stdin', handle):
                only_option = 'only one option (shortcut)'
                assert prompt_for_choice([only_option]) == only_option
        # Choice selection by full string match.
        with PatchedAttribute(prompts, 'interactive_prompt', lambda p: 'foo'):
            assert prompt_for_choice(['foo', 'bar']) == 'foo'
        # Choice selection by substring input.
        with PatchedAttribute(prompts, 'interactive_prompt', lambda p: 'f'):
            assert prompt_for_choice(['foo', 'bar']) == 'foo'
        # Choice selection by number.
        with PatchedAttribute(prompts, 'interactive_prompt', lambda p: '2'):
            assert prompt_for_choice(['foo', 'bar']) == 'bar'
        # Choice selection by going with the default.
        with PatchedAttribute(prompts, 'interactive_prompt', lambda p: ''):
            assert prompt_for_choice(['foo', 'bar'], default='bar') == 'bar'
        # Invalid substrings are refused.
        replies = ['', 'q', 'z']
        with PatchedAttribute(prompts, 'interactive_prompt', lambda p: replies.pop(0)):
            assert prompt_for_choice(['foo', 'bar', 'baz']) == 'baz'
        # Choice selection by substring input requires an unambiguous substring match.
        replies = ['a', 'q']
        with PatchedAttribute(prompts, 'interactive_prompt', lambda p: replies.pop(0)):
            assert prompt_for_choice(['foo', 'bar', 'baz', 'qux']) == 'qux'
        # Invalid numbers are refused.
        replies = ['42', '2']
        with PatchedAttribute(prompts, 'interactive_prompt', lambda p: replies.pop(0)):
            assert prompt_for_choice(['foo', 'bar', 'baz']) == 'bar'
        # Test that interactive prompts eventually give up on invalid replies.
        with PatchedAttribute(prompts, 'interactive_prompt', lambda p: ''):
            with self.assertRaises(TooManyInvalidReplies):
                prompt_for_choice(['a', 'b', 'c'])

    def test_prompt_for_confirmation(self):
        """Test :func:`humanfriendly.prompts.prompt_for_confirmation()`."""
        # Test some (more or less) reasonable replies that indicate agreement.
        for reply in 'yes', 'Yes', 'YES', 'y', 'Y':
            with PatchedAttribute(prompts, 'interactive_prompt', lambda p: reply):
                assert prompt_for_confirmation("Are you sure?") is True
        # Test some (more or less) reasonable replies that indicate disagreement.
        for reply in 'no', 'No', 'NO', 'n', 'N':
            with PatchedAttribute(prompts, 'interactive_prompt', lambda p: reply):
                assert prompt_for_confirmation("Are you sure?") is False
        # Test that empty replies select the default choice.
        for default_choice in True, False:
            with PatchedAttribute(prompts, 'interactive_prompt', lambda p: ''):
                assert prompt_for_confirmation("Are you sure?", default=default_choice) is default_choice
        # Test that a warning is shown when no input nor a default is given.
        replies = ['', 'y']
        with PatchedAttribute(prompts, 'interactive_prompt', lambda p: replies.pop(0)):
            with CaptureOutput(merged=True) as capturer:
                assert prompt_for_confirmation("Are you sure?") is True
                assert "there's no default choice" in capturer.get_text()
        # Test that the default reply is shown in uppercase.
        with PatchedAttribute(prompts, 'interactive_prompt', lambda p: 'y'):
            for default_value, expected_text in (True, 'Y/n'), (False, 'y/N'), (None, 'y/n'):
                with CaptureOutput(merged=True) as capturer:
                    assert prompt_for_confirmation("Are you sure?", default=default_value) is True
                    assert expected_text in capturer.get_text()
        # Test that interactive prompts eventually give up on invalid replies.
        with PatchedAttribute(prompts, 'interactive_prompt', lambda p: ''):
            with self.assertRaises(TooManyInvalidReplies):
                prompt_for_confirmation("Are you sure?")

    def test_prompt_for_input(self):
        """Test :func:`humanfriendly.prompts.prompt_for_input()`."""
        with open(os.devnull) as handle:
            with PatchedAttribute(sys, 'stdin', handle):
                # If standard input isn't connected to a terminal the default value should be returned.
                default_value = "To seek the holy grail!"
                assert prompt_for_input("What is your quest?", default=default_value) == default_value
                # If standard input isn't connected to a terminal and no default value
                # is given the EOFError exception should be propagated to the caller.
                with self.assertRaises(EOFError):
                    prompt_for_input("What is your favorite color?")

    def test_cli(self):
        """Test the command line interface."""
        # Test that the usage message is printed by default.
        returncode, output = run_cli(main)
        assert 'Usage:' in output
        # Test that the usage message can be requested explicitly.
        returncode, output = run_cli(main, '--help')
        assert 'Usage:' in output
        # Test handling of invalid command line options.
        returncode, output = run_cli(main, '--unsupported-option')
        assert returncode != 0
        # Test `humanfriendly --format-number'.
        returncode, output = run_cli(main, '--format-number=1234567')
        assert output.strip() == '1,234,567'
        # Test `humanfriendly --format-size'.
        random_byte_count = random.randint(1024, 1024 * 1024)
        returncode, output = run_cli(main, '--format-size=%i' % random_byte_count)
        assert output.strip() == format_size(random_byte_count)
        # Test `humanfriendly --format-size --binary'.
        random_byte_count = random.randint(1024, 1024 * 1024)
        returncode, output = run_cli(main, '--format-size=%i' % random_byte_count, '--binary')
        assert output.strip() == format_size(random_byte_count, binary=True)
        # Test `humanfriendly --format-length'.
        random_len = random.randint(1024, 1024 * 1024)
        returncode, output = run_cli(main, '--format-length=%i' % random_len)
        assert output.strip() == format_length(random_len)
        random_len = float(random_len) / 12345.6
        returncode, output = run_cli(main, '--format-length=%f' % random_len)
        assert output.strip() == format_length(random_len)
        # Test `humanfriendly --format-table'.
        returncode, output = run_cli(main, '--format-table', '--delimiter=\t', input='1\t2\t3\n4\t5\t6\n7\t8\t9')
        assert output.strip() == dedent('''
            -------------
            | 1 | 2 | 3 |
            | 4 | 5 | 6 |
            | 7 | 8 | 9 |
            -------------
        ''').strip()
        # Test `humanfriendly --format-timespan'.
        random_timespan = random.randint(5, 600)
        returncode, output = run_cli(main, '--format-timespan=%i' % random_timespan)
        assert output.strip() == format_timespan(random_timespan)
        # Test `humanfriendly --parse-size'.
        returncode, output = run_cli(main, '--parse-size=5 KB')
        assert int(output) == parse_size('5 KB')
        # Test `humanfriendly --parse-size'.
        returncode, output = run_cli(main, '--parse-size=5 YiB')
        assert int(output) == parse_size('5 YB', binary=True)
        # Test `humanfriendly --parse-length'.
        returncode, output = run_cli(main, '--parse-length=5 km')
        assert int(output) == parse_length('5 km')
        returncode, output = run_cli(main, '--parse-length=1.05 km')
        assert float(output) == parse_length('1.05 km')
        # Test `humanfriendly --run-command'.
        returncode, output = run_cli(main, '--run-command', 'bash', '-c', 'sleep 2 && exit 42')
        assert returncode == 42
        # Test `humanfriendly --demo'. The purpose of this test is
        # to ensure that the demo runs successfully on all versions
        # of Python and outputs the expected sections (recognized by
        # their headings) without triggering exceptions. This was
        # written as a regression test after issue #28 was reported:
        # https://github.com/xolox/python-humanfriendly/issues/28
        returncode, output = run_cli(main, '--demo')
        assert returncode == 0
        lines = [ansi_strip(line) for line in output.splitlines()]
        assert "Text styles:" in lines
        assert "Foreground colors:" in lines
        assert "Background colors:" in lines
        assert "256 color mode (standard colors):" in lines
        assert "256 color mode (high-intensity colors):" in lines
        assert "256 color mode (216 colors):" in lines
        assert "256 color mode (gray scale colors):" in lines

    def test_ansi_style(self):
        """Test :func:`humanfriendly.terminal.ansi_style()`."""
        assert ansi_style(bold=True) == '%s1%s' % (ANSI_CSI, ANSI_SGR)
        assert ansi_style(faint=True) == '%s2%s' % (ANSI_CSI, ANSI_SGR)
        assert ansi_style(italic=True) == '%s3%s' % (ANSI_CSI, ANSI_SGR)
        assert ansi_style(underline=True) == '%s4%s' % (ANSI_CSI, ANSI_SGR)
        assert ansi_style(inverse=True) == '%s7%s' % (ANSI_CSI, ANSI_SGR)
        assert ansi_style(strike_through=True) == '%s9%s' % (ANSI_CSI, ANSI_SGR)
        assert ansi_style(color='blue') == '%s34%s' % (ANSI_CSI, ANSI_SGR)
        assert ansi_style(background='blue') == '%s44%s' % (ANSI_CSI, ANSI_SGR)
        assert ansi_style(color='blue', bright=True) == '%s94%s' % (ANSI_CSI, ANSI_SGR)
        assert ansi_style(color=214) == '%s38;5;214%s' % (ANSI_CSI, ANSI_SGR)
        assert ansi_style(background=214) == '%s39;5;214%s' % (ANSI_CSI, ANSI_SGR)
        assert ansi_style(color=(0, 0, 0)) == '%s38;2;0;0;0%s' % (ANSI_CSI, ANSI_SGR)
        assert ansi_style(color=(255, 255, 255)) == '%s38;2;255;255;255%s' % (ANSI_CSI, ANSI_SGR)
        assert ansi_style(background=(50, 100, 150)) == '%s48;2;50;100;150%s' % (ANSI_CSI, ANSI_SGR)
        with self.assertRaises(ValueError):
            ansi_style(color='unknown')

    def test_ansi_width(self):
        """Test :func:`humanfriendly.terminal.ansi_width()`."""
        text = "Whatever"
        # Make sure ansi_width() works as expected on strings without ANSI escape sequences.
        assert len(text) == ansi_width(text)
        # Wrap a text in ANSI escape sequences and make sure ansi_width() treats it as expected.
        wrapped = ansi_wrap(text, bold=True)
        # Make sure ansi_wrap() changed the text.
        assert wrapped != text
        # Make sure ansi_wrap() added additional bytes.
        assert len(wrapped) > len(text)
        # Make sure the result of ansi_width() stays the same.
        assert len(text) == ansi_width(wrapped)

    def test_ansi_wrap(self):
        """Test :func:`humanfriendly.terminal.ansi_wrap()`."""
        text = "Whatever"
        # Make sure ansi_wrap() does nothing when no keyword arguments are given.
        assert text == ansi_wrap(text)
        # Make sure ansi_wrap() starts the text with the CSI sequence.
        assert ansi_wrap(text, bold=True).startswith(ANSI_CSI)
        # Make sure ansi_wrap() ends the text by resetting the ANSI styles.
        assert ansi_wrap(text, bold=True).endswith(ANSI_RESET)

    def test_html_to_ansi(self):
        """Test the :func:`humanfriendly.terminal.html_to_ansi()` function."""
        assert html_to_ansi("Just some plain text") == "Just some plain text"
        # Hyperlinks.
        assert html_to_ansi('<a href="https://python.org">python.org</a>') == \
            '\x1b[0m\x1b[4;94mpython.org\x1b[0m (\x1b[0m\x1b[4;94mhttps://python.org\x1b[0m)'
        # Make sure `mailto:' prefixes are stripped (they're not at all useful in a terminal).
        assert html_to_ansi('<a href="mailto:peter@peterodding.com">peter@peterodding.com</a>') == \
            '\x1b[0m\x1b[4;94mpeter@peterodding.com\x1b[0m'
        # Bold text.
        assert html_to_ansi("Let's try <b>bold</b>") == "Let's try \x1b[0m\x1b[1mbold\x1b[0m"
        assert html_to_ansi("Let's try <span style=\"font-weight: bold\">bold</span>") == \
            "Let's try \x1b[0m\x1b[1mbold\x1b[0m"
        # Italic text.
        assert html_to_ansi("Let's try <i>italic</i>") == \
            "Let's try \x1b[0m\x1b[3mitalic\x1b[0m"
        assert html_to_ansi("Let's try <span style=\"font-style: italic\">italic</span>") == \
            "Let's try \x1b[0m\x1b[3mitalic\x1b[0m"
        # Underlined text.
        assert html_to_ansi("Let's try <ins>underline</ins>") == \
            "Let's try \x1b[0m\x1b[4munderline\x1b[0m"
        assert html_to_ansi("Let's try <span style=\"text-decoration: underline\">underline</span>") == \
            "Let's try \x1b[0m\x1b[4munderline\x1b[0m"
        # Strike-through text.
        assert html_to_ansi("Let's try <s>strike-through</s>") == \
            "Let's try \x1b[0m\x1b[9mstrike-through\x1b[0m"
        assert html_to_ansi("Let's try <span style=\"text-decoration: line-through\">strike-through</span>") == \
            "Let's try \x1b[0m\x1b[9mstrike-through\x1b[0m"
        # Pre-formatted text.
        assert html_to_ansi("Let's try <code>pre-formatted</code>") == \
            "Let's try \x1b[0m\x1b[33mpre-formatted\x1b[0m"
        # Text colors (with a 6 digit hexadecimal color value).
        assert html_to_ansi("Let's try <span style=\"color: #AABBCC\">text colors</s>") == \
            "Let's try \x1b[0m\x1b[38;2;170;187;204mtext colors\x1b[0m"
        # Background colors (with an rgb(N, N, N) expression).
        assert html_to_ansi("Let's try <span style=\"background-color: rgb(50, 50, 50)\">background colors</s>") == \
            "Let's try \x1b[0m\x1b[48;2;50;50;50mbackground colors\x1b[0m"
        # Line breaks.
        assert html_to_ansi("Let's try some<br>line<br>breaks") == \
            "Let's try some\nline\nbreaks"
        # Check that decimal entities are decoded.
        assert html_to_ansi("&#38;") == "&"
        # Check that named entities are decoded.
        assert html_to_ansi("&amp;") == "&"
        assert html_to_ansi("&gt;") == ">"
        assert html_to_ansi("&lt;") == "<"
        # Check that hexadecimal entities are decoded.
        assert html_to_ansi("&#x26;") == "&"
        # Check that the text callback is actually called.

        def callback(text):
            return text.replace(':wink:', ';-)')

        assert ':wink:' not in html_to_ansi('<b>:wink:</b>', callback=callback)
        # Check that the text callback doesn't process preformatted text.
        assert ':wink:' in html_to_ansi('<code>:wink:</code>', callback=callback)
        # Try a somewhat convoluted but nevertheless real life example from my
        # personal chat archives that causes humanfriendly releases 4.15 and
        # 4.15.1 to raise an exception.
        assert html_to_ansi(u'''
            Tweakers zit er idd nog steeds:<br><br>
            peter@peter-work&gt; curl -s <a href="tweakers.net">tweakers.net</a> | grep -i hosting<br>
            &lt;a href="<a href="http://www.true.nl/webhosting/">http://www.true.nl/webhosting/</a>"
                rel="external" id="true" title="Hosting door True"&gt;&lt;/a&gt;<br>
            Hosting door &lt;a href="<a href="http://www.true.nl/vps/">http://www.true.nl/vps/</a>"
                title="VPS hosting" rel="external"&gt;True</a>
        ''')

    def test_generate_output(self):
        """Test the :func:`humanfriendly.terminal.output()` function."""
        text = "Standard output generated by output()"
        with CaptureOutput(merged=False) as capturer:
            output(text)
            self.assertEqual([text], capturer.stdout.get_lines())
            self.assertEqual([], capturer.stderr.get_lines())

    def test_generate_message(self):
        """Test the :func:`humanfriendly.terminal.message()` function."""
        text = "Standard error generated by message()"
        with CaptureOutput(merged=False) as capturer:
            message(text)
            self.assertEqual([], capturer.stdout.get_lines())
            self.assertEqual([text], capturer.stderr.get_lines())

    def test_generate_warning(self):
        """Test the :func:`humanfriendly.terminal.warning()` function."""
        from capturer import CaptureOutput
        text = "Standard error generated by warning()"
        with CaptureOutput(merged=False) as capturer:
            warning(text)
            self.assertEqual([], capturer.stdout.get_lines())
            self.assertEqual([ansi_wrap(text, color='red')], self.ignore_coverage_warning(capturer.stderr))

    def ignore_coverage_warning(self, stream):
        """
        Filter out coverage.py warning from standard error.

        This is intended to remove the following line from the lines captured
        on the standard error stream:

        Coverage.py warning: No data was collected. (no-data-collected)
        """
        return [line for line in stream.get_lines() if 'no-data-collected' not in line]

    def test_clean_output(self):
        """Test :func:`humanfriendly.terminal.clean_terminal_output()`."""
        # Simple output should pass through unharmed (single line).
        assert clean_terminal_output('foo') == ['foo']
        # Simple output should pass through unharmed (multiple lines).
        assert clean_terminal_output('foo\nbar') == ['foo', 'bar']
        # Carriage returns and preceding substrings are removed.
        assert clean_terminal_output('foo\rbar\nbaz') == ['bar', 'baz']
        # Carriage returns move the cursor to the start of the line without erasing text.
        assert clean_terminal_output('aaa\rab') == ['aba']
        # Backspace moves the cursor one position back without erasing text.
        assert clean_terminal_output('aaa\b\bb') == ['aba']
        # Trailing empty lines should be stripped.
        assert clean_terminal_output('foo\nbar\nbaz\n\n\n') == ['foo', 'bar', 'baz']

    def test_find_terminal_size(self):
        """Test :func:`humanfriendly.terminal.find_terminal_size()`."""
        lines, columns = find_terminal_size()
        # We really can't assert any minimum or maximum values here because it
        # simply doesn't make any sense; it's impossible for me to anticipate
        # on what environments this test suite will run in the future.
        assert lines > 0
        assert columns > 0
        # The find_terminal_size_using_ioctl() function is the default
        # implementation and it will likely work fine. This makes it hard to
        # test the fall back code paths though. However there's an easy way to
        # make find_terminal_size_using_ioctl() fail ...
        saved_stdin = sys.stdin
        saved_stdout = sys.stdout
        saved_stderr = sys.stderr
        try:
            # What do you mean this is brute force?! ;-)
            sys.stdin = StringIO()
            sys.stdout = StringIO()
            sys.stderr = StringIO()
            # Now find_terminal_size_using_ioctl() should fail even though
            # find_terminal_size_using_stty() might work fine.
            lines, columns = find_terminal_size()
            assert lines > 0
            assert columns > 0
            # There's also an ugly way to make `stty size' fail: The
            # subprocess.Popen class uses os.execvp() underneath, so if we
            # clear the $PATH it will break.
            saved_path = os.environ['PATH']
            try:
                os.environ['PATH'] = ''
                # Now find_terminal_size_using_stty() should fail.
                lines, columns = find_terminal_size()
                assert lines > 0
                assert columns > 0
            finally:
                os.environ['PATH'] = saved_path
        finally:
            sys.stdin = saved_stdin
            sys.stdout = saved_stdout
            sys.stderr = saved_stderr

    def test_terminal_capabilities(self):
        """Test the functions that check for terminal capabilities."""
        from capturer import CaptureOutput
        for test_stream in connected_to_terminal, terminal_supports_colors:
            # This test suite should be able to run interactively as well as
            # non-interactively, so we can't expect or demand that standard streams
            # will always be connected to a terminal. Fortunately Capturer enables
            # us to fake it :-).
            for stream in sys.stdout, sys.stderr:
                with CaptureOutput():
                    assert test_stream(stream)
            # Test something that we know can never be a terminal.
            with open(os.devnull) as handle:
                assert not test_stream(handle)
            # Verify that objects without isatty() don't raise an exception.
            assert not test_stream(object())

    def test_show_pager(self):
        """Test :func:`humanfriendly.terminal.show_pager()`."""
        original_pager = os.environ.get('PAGER', None)
        try:
            # We specifically avoid `less' because it would become awkward to
            # run the test suite in an interactive terminal :-).
            os.environ['PAGER'] = 'cat'
            # Generate a significant amount of random text spread over multiple
            # lines that we expect to be reported literally on the terminal.
            random_text = "\n".join(random_string(25) for i in range(50))
            # Run the pager command and validate the output.
            with CaptureOutput() as capturer:
                show_pager(random_text)
                assert random_text in capturer.get_text()
        finally:
            if original_pager is not None:
                # Restore the original $PAGER value.
                os.environ['PAGER'] = original_pager
            else:
                # Clear the custom $PAGER value.
                os.environ.pop('PAGER')

    def test_get_pager_command(self):
        """Test :func:`humanfriendly.terminal.get_pager_command()`."""
        # Make sure --RAW-CONTROL-CHARS isn't used when it's not needed.
        assert '--RAW-CONTROL-CHARS' not in get_pager_command("Usage message")
        # Make sure --RAW-CONTROL-CHARS is used when it's needed.
        assert '--RAW-CONTROL-CHARS' in get_pager_command(ansi_wrap("Usage message", bold=True))
        # Make sure that less-specific options are only used when valid.
        options_specific_to_less = ['--no-init', '--quit-if-one-screen']
        for pager in 'cat', 'less':
            original_pager = os.environ.get('PAGER', None)
            try:
                # Set $PAGER to `cat' or `less'.
                os.environ['PAGER'] = pager
                # Get the pager command line.
                command_line = get_pager_command()
                # Check for less-specific options.
                if pager == 'less':
                    assert all(opt in command_line for opt in options_specific_to_less)
                else:
                    assert not any(opt in command_line for opt in options_specific_to_less)
            finally:
                if original_pager is not None:
                    # Restore the original $PAGER value.
                    os.environ['PAGER'] = original_pager
                else:
                    # Clear the custom $PAGER value.
                    os.environ.pop('PAGER')

    def test_find_meta_variables(self):
        """Test :func:`humanfriendly.usage.find_meta_variables()`."""
        assert sorted(find_meta_variables("""
            Here's one example: --format-number=VALUE
            Here's another example: --format-size=BYTES
            A final example: --format-timespan=SECONDS
            This line doesn't contain a META variable.
        """)) == sorted(['VALUE', 'BYTES', 'SECONDS'])

    def test_parse_usage_simple(self):
        """Test :func:`humanfriendly.usage.parse_usage()` (a simple case)."""
        introduction, options = self.preprocess_parse_result("""
            Usage: my-fancy-app [OPTIONS]

            Boring description.

            Supported options:

              -h, --help

                Show this message and exit.
        """)
        # The following fragments are (expected to be) part of the introduction.
        assert "Usage: my-fancy-app [OPTIONS]" in introduction
        assert "Boring description." in introduction
        assert "Supported options:" in introduction
        # The following fragments are (expected to be) part of the documented options.
        assert "-h, --help" in options
        assert "Show this message and exit." in options

    def test_parse_usage_tricky(self):
        """Test :func:`humanfriendly.usage.parse_usage()` (a tricky case)."""
        introduction, options = self.preprocess_parse_result("""
            Usage: my-fancy-app [OPTIONS]

            Here's the introduction to my-fancy-app. Some of the lines in the
            introduction start with a command line option just to confuse the
            parsing algorithm :-)

            For example
            --an-awesome-option
            is still part of the introduction.

            Supported options:

              -a, --an-awesome-option

                Explanation why this is an awesome option.

              -b, --a-boring-option

                Explanation why this is a boring option.
        """)
        # The following fragments are (expected to be) part of the introduction.
        assert "Usage: my-fancy-app [OPTIONS]" in introduction
        assert any('still part of the introduction' in p for p in introduction)
        assert "Supported options:" in introduction
        # The following fragments are (expected to be) part of the documented options.
        assert "-a, --an-awesome-option" in options
        assert "Explanation why this is an awesome option." in options
        assert "-b, --a-boring-option" in options
        assert "Explanation why this is a boring option." in options

    def test_parse_usage_commas(self):
        """Test :func:`humanfriendly.usage.parse_usage()` against option labels containing commas."""
        introduction, options = self.preprocess_parse_result("""
            Usage: my-fancy-app [OPTIONS]

            Some introduction goes here.

            Supported options:

              -f, --first-option

                Explanation of first option.

              -s, --second-option=WITH,COMMA

                This should be a separate option's description.
        """)
        # The following fragments are (expected to be) part of the introduction.
        assert "Usage: my-fancy-app [OPTIONS]" in introduction
        assert "Some introduction goes here." in introduction
        assert "Supported options:" in introduction
        # The following fragments are (expected to be) part of the documented options.
        assert "-f, --first-option" in options
        assert "Explanation of first option." in options
        assert "-s, --second-option=WITH,COMMA" in options
        assert "This should be a separate option's description." in options

    def preprocess_parse_result(self, text):
        """Ignore leading/trailing whitespace in usage parsing tests."""
        return tuple([p.strip() for p in r] for r in parse_usage(dedent(text)))

    def test_format_usage(self):
        """Test :func:`humanfriendly.usage.format_usage()`."""
        # Test that options are highlighted.
        usage_text = "Just one --option"
        formatted_text = format_usage(usage_text)
        assert len(formatted_text) > len(usage_text)
        assert formatted_text.startswith("Just one ")
        # Test that the "Usage: ..." line is highlighted.
        usage_text = "Usage: humanfriendly [OPTIONS]"
        formatted_text = format_usage(usage_text)
        assert len(formatted_text) > len(usage_text)
        assert usage_text in formatted_text
        assert not formatted_text.startswith(usage_text)
        # Test that meta variables aren't erroneously highlighted.
        usage_text = (
            "--valid-option=VALID_METAVAR\n"
            "VALID_METAVAR is bogus\n"
            "INVALID_METAVAR should not be highlighted\n"
        )
        formatted_text = format_usage(usage_text)
        formatted_lines = formatted_text.splitlines()
        # Make sure the meta variable in the second line is highlighted.
        assert ANSI_CSI in formatted_lines[1]
        # Make sure the meta variable in the third line isn't highlighted.
        assert ANSI_CSI not in formatted_lines[2]

    def test_render_usage(self):
        """Test :func:`humanfriendly.usage.render_usage()`."""
        assert render_usage("Usage: some-command WITH ARGS") == "**Usage:** `some-command WITH ARGS`"
        assert render_usage("Supported options:") == "**Supported options:**"
        assert 'code-block' in render_usage(dedent("""
            Here comes a shell command:

              $ echo test
              test
        """))
        assert all(token in render_usage(dedent("""
            Supported options:

              -n, --dry-run

                Don't change anything.
        """)) for token in ('`-n`', '`--dry-run`'))

    def test_deprecated_args(self):
        """Test the deprecated_args() decorator function."""
        @deprecated_args('foo', 'bar')
        def test_function(**options):
            assert options['foo'] == 'foo'
            assert options.get('bar') in (None, 'bar')
            return 42
        fake_fn = MagicMock()
        with PatchedAttribute(warnings, 'warn', fake_fn):
            assert test_function('foo', 'bar') == 42
            with self.assertRaises(TypeError):
                test_function('foo', 'bar', 'baz')
        assert fake_fn.was_called

    def test_alias_proxy_deprecation_warning(self):
        """Test that the DeprecationProxy class emits deprecation warnings."""
        fake_fn = MagicMock()
        with PatchedAttribute(warnings, 'warn', fake_fn):
            module = sys.modules[__name__]
            aliases = dict(concatenate='humanfriendly.text.concatenate')
            proxy = DeprecationProxy(module, aliases)
            assert proxy.concatenate == concatenate
        assert fake_fn.was_called

    def test_alias_proxy_sphinx_compensation(self):
        """Test that the DeprecationProxy class emits deprecation warnings."""
        with PatchedItem(sys.modules, 'sphinx', types.ModuleType('sphinx')):
            define_aliases(__name__, concatenate='humanfriendly.text.concatenate')
            assert "concatenate" in dir(sys.modules[__name__])
            assert "concatenate" in get_aliases(__name__)

    def test_alias_proxy_sphinx_integration(self):
        """Test that aliases can be injected into generated documentation."""
        module = sys.modules[__name__]
        define_aliases(__name__, concatenate='humanfriendly.text.concatenate')
        lines = module.__doc__.splitlines()
        deprecation_note_callback(app=None, what=None, name=None, obj=module, options=None, lines=lines)
        # Check that something was injected.
        assert "\n".join(lines) != module.__doc__

    def test_sphinx_customizations(self):
        """Test the :mod:`humanfriendly.sphinx` module."""
        class FakeApp(object):

            def __init__(self):
                self.callbacks = {}
                self.roles = {}

            def __documented_special_method__(self):
                """Documented unofficial special method."""
                pass

            def __undocumented_special_method__(self):
                # Intentionally not documented :-).
                pass

            def add_role(self, name, callback):
                self.roles[name] = callback

            def connect(self, event, callback):
                self.callbacks.setdefault(event, []).append(callback)

            def bogus_usage(self):
                """Usage: This is not supposed to be reformatted!"""
                pass

        # Test event callback registration.
        fake_app = FakeApp()
        setup(fake_app)
        assert man_role == fake_app.roles['man']
        assert pypi_role == fake_app.roles['pypi']
        assert deprecation_note_callback in fake_app.callbacks['autodoc-process-docstring']
        assert special_methods_callback in fake_app.callbacks['autodoc-skip-member']
        assert usage_message_callback in fake_app.callbacks['autodoc-process-docstring']
        # Test that `special methods' which are documented aren't skipped.
        assert special_methods_callback(
            app=None, what=None, name=None,
            obj=FakeApp.__documented_special_method__,
            skip=True, options=None,
        ) is False
        # Test that `special methods' which are undocumented are skipped.
        assert special_methods_callback(
            app=None, what=None, name=None,
            obj=FakeApp.__undocumented_special_method__,
            skip=True, options=None,
        ) is True
        # Test formatting of usage messages. obj/lines
        from humanfriendly import cli, sphinx
        # We expect the docstring in the `cli' module to be reformatted
        # (because it contains a usage message in the expected format).
        assert self.docstring_is_reformatted(cli)
        # We don't expect the docstring in the `sphinx' module to be
        # reformatted (because it doesn't contain a usage message).
        assert not self.docstring_is_reformatted(sphinx)
        # We don't expect the docstring of the following *method* to be
        # reformatted because only *module* docstrings should be reformatted.
        assert not self.docstring_is_reformatted(fake_app.bogus_usage)

    def docstring_is_reformatted(self, entity):
        """Check whether :func:`.usage_message_callback()` reformats a module's docstring."""
        lines = trim_empty_lines(entity.__doc__).splitlines()
        saved_lines = list(lines)
        usage_message_callback(
            app=None, what=None, name=None,
            obj=entity, options=None, lines=lines,
        )
        return lines != saved_lines


def normalize_timestamp(value, ndigits=1):
    """
    Round timestamps to the given number of digits.

    This helps to make the test suite less sensitive to timing issues caused by
    multitasking, processor scheduling, etc.
    """
    return '%.2f' % round(float(value), ndigits=ndigits)
