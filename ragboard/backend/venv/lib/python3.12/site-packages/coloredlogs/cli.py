# Command line interface for the coloredlogs package.
#
# Author: Peter Odding <peter@peterodding.com>
# Last Change: December 15, 2017
# URL: https://coloredlogs.readthedocs.io

"""
Usage: coloredlogs [OPTIONS] [ARGS]

The coloredlogs program provides a simple command line interface for the Python
package by the same name.

Supported options:

  -c, --convert, --to-html

    Capture the output of an external command (given by the positional
    arguments) and convert ANSI escape sequences in the output to HTML.

    If the `coloredlogs' program is attached to an interactive terminal it will
    write the generated HTML to a temporary file and open that file in a web
    browser, otherwise the generated HTML will be written to standard output.

    This requires the `script' program to fake the external command into
    thinking that it's attached to an interactive terminal (in order to enable
    output of ANSI escape sequences).

    If the command didn't produce any output then no HTML will be produced on
    standard output, this is to avoid empty emails from cron jobs.

  -d, --demo

    Perform a simple demonstration of the coloredlogs package to show the
    colored logging on an interactive terminal.

  -h, --help

    Show this message and exit.
"""

# Standard library modules.
import functools
import getopt
import logging
import sys
import tempfile
import webbrowser

# External dependencies.
from humanfriendly.terminal import connected_to_terminal, output, usage, warning

# Modules included in our package.
from coloredlogs.converter import capture, convert
from coloredlogs.demo import demonstrate_colored_logging

# Initialize a logger for this module.
logger = logging.getLogger(__name__)


def main():
    """Command line interface for the ``coloredlogs`` program."""
    actions = []
    try:
        # Parse the command line arguments.
        options, arguments = getopt.getopt(sys.argv[1:], 'cdh', [
            'convert', 'to-html', 'demo', 'help',
        ])
        # Map command line options to actions.
        for option, value in options:
            if option in ('-c', '--convert', '--to-html'):
                actions.append(functools.partial(convert_command_output, *arguments))
                arguments = []
            elif option in ('-d', '--demo'):
                actions.append(demonstrate_colored_logging)
            elif option in ('-h', '--help'):
                usage(__doc__)
                return
            else:
                assert False, "Programming error: Unhandled option!"
        if not actions:
            usage(__doc__)
            return
    except Exception as e:
        warning("Error: %s", e)
        sys.exit(1)
    for function in actions:
        function()


def convert_command_output(*command):
    """
    Command line interface for ``coloredlogs --to-html``.

    Takes a command (and its arguments) and runs the program under ``script``
    (emulating an interactive terminal), intercepts the output of the command
    and converts ANSI escape sequences in the output to HTML.
    """
    captured_output = capture(command)
    converted_output = convert(captured_output)
    if connected_to_terminal():
        fd, temporary_file = tempfile.mkstemp(suffix='.html')
        with open(temporary_file, 'w') as handle:
            handle.write(converted_output)
        webbrowser.open(temporary_file)
    elif captured_output and not captured_output.isspace():
        output(converted_output)
