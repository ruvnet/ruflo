# vim: fileencoding=utf-8

# Human friendly input/output in Python.
#
# Author: Peter Odding <peter@peterodding.com>
# Last Change: February 9, 2020
# URL: https://humanfriendly.readthedocs.io

"""
Interactive terminal prompts.

The :mod:`~humanfriendly.prompts` module enables interaction with the user
(operator) by asking for confirmation (:func:`prompt_for_confirmation()`) and
asking to choose from a list of options (:func:`prompt_for_choice()`). It works
by rendering interactive prompts on the terminal.
"""

# Standard library modules.
import logging
import sys

# Modules included in our package.
from humanfriendly.compat import interactive_prompt
from humanfriendly.terminal import (
    HIGHLIGHT_COLOR,
    ansi_strip,
    ansi_wrap,
    connected_to_terminal,
    terminal_supports_colors,
    warning,
)
from humanfriendly.text import format, concatenate

# Public identifiers that require documentation.
__all__ = (
    'MAX_ATTEMPTS',
    'TooManyInvalidReplies',
    'logger',
    'prepare_friendly_prompts',
    'prepare_prompt_text',
    'prompt_for_choice',
    'prompt_for_confirmation',
    'prompt_for_input',
    'retry_limit',
)

MAX_ATTEMPTS = 10
"""The number of times an interactive prompt is shown on invalid input (an integer)."""

# Initialize a logger for this module.
logger = logging.getLogger(__name__)


def prompt_for_confirmation(question, default=None, padding=True):
    """
    Prompt the user for confirmation.

    :param question: The text that explains what the user is confirming (a string).
    :param default: The default value (a boolean) or :data:`None`.
    :param padding: Refer to the documentation of :func:`prompt_for_input()`.
    :returns: - If the user enters 'yes' or 'y' then :data:`True` is returned.
              - If the user enters 'no' or 'n' then :data:`False`  is returned.
              - If the user doesn't enter any text or standard input is not
                connected to a terminal (which makes it impossible to prompt
                the user) the value of the keyword argument ``default`` is
                returned (if that value is not :data:`None`).
    :raises: - Any exceptions raised by :func:`retry_limit()`.
             - Any exceptions raised by :func:`prompt_for_input()`.

    When `default` is :data:`False` and the user doesn't enter any text an
    error message is printed and the prompt is repeated:

    >>> prompt_for_confirmation("Are you sure?")
     <BLANKLINE>
     Are you sure? [y/n]
     <BLANKLINE>
     Error: Please enter 'yes' or 'no' (there's no default choice).
     <BLANKLINE>
     Are you sure? [y/n]

    The same thing happens when the user enters text that isn't recognized:

    >>> prompt_for_confirmation("Are you sure?")
     <BLANKLINE>
     Are you sure? [y/n] about what?
     <BLANKLINE>
     Error: Please enter 'yes' or 'no' (the text 'about what?' is not recognized).
     <BLANKLINE>
     Are you sure? [y/n]
    """
    # Generate the text for the prompt.
    prompt_text = prepare_prompt_text(question, bold=True)
    # Append the valid replies (and default reply) to the prompt text.
    hint = "[Y/n]" if default else "[y/N]" if default is not None else "[y/n]"
    prompt_text += " %s " % prepare_prompt_text(hint, color=HIGHLIGHT_COLOR)
    # Loop until a valid response is given.
    logger.debug("Requesting interactive confirmation from terminal: %r", ansi_strip(prompt_text).rstrip())
    for attempt in retry_limit():
        reply = prompt_for_input(prompt_text, '', padding=padding, strip=True)
        if reply.lower() in ('y', 'yes'):
            logger.debug("Confirmation granted by reply (%r).", reply)
            return True
        elif reply.lower() in ('n', 'no'):
            logger.debug("Confirmation denied by reply (%r).", reply)
            return False
        elif (not reply) and default is not None:
            logger.debug("Default choice selected by empty reply (%r).",
                         "granted" if default else "denied")
            return default
        else:
            details = ("the text '%s' is not recognized" % reply
                       if reply else "there's no default choice")
            logger.debug("Got %s reply (%s), retrying (%i/%i) ..",
                         "invalid" if reply else "empty", details,
                         attempt, MAX_ATTEMPTS)
            warning("{indent}Error: Please enter 'yes' or 'no' ({details}).",
                    indent=' ' if padding else '', details=details)


def prompt_for_choice(choices, default=None, padding=True):
    """
    Prompt the user to select a choice from a group of options.

    :param choices: A sequence of strings with available options.
    :param default: The default choice if the user simply presses Enter
                    (expected to be a string, defaults to :data:`None`).
    :param padding: Refer to the documentation of
                    :func:`~humanfriendly.prompts.prompt_for_input()`.
    :returns: The string corresponding to the user's choice.
    :raises: - :exc:`~exceptions.ValueError` if `choices` is an empty sequence.
             - Any exceptions raised by
               :func:`~humanfriendly.prompts.retry_limit()`.
             - Any exceptions raised by
               :func:`~humanfriendly.prompts.prompt_for_input()`.

    When no options are given an exception is raised:

    >>> prompt_for_choice([])
    Traceback (most recent call last):
      File "humanfriendly/prompts.py", line 148, in prompt_for_choice
        raise ValueError("Can't prompt for choice without any options!")
    ValueError: Can't prompt for choice without any options!

    If a single option is given the user isn't prompted:

    >>> prompt_for_choice(['only one choice'])
    'only one choice'

    Here's what the actual prompt looks like by default:

    >>> prompt_for_choice(['first option', 'second option'])
    <BLANKLINE>
      1. first option
      2. second option
    <BLANKLINE>
     Enter your choice as a number or unique substring (Control-C aborts): second
    <BLANKLINE>
    'second option'

    If you don't like the whitespace (empty lines and indentation):

    >>> prompt_for_choice(['first option', 'second option'], padding=False)
     1. first option
     2. second option
    Enter your choice as a number or unique substring (Control-C aborts): first
    'first option'
    """
    indent = ' ' if padding else ''
    # Make sure we can use 'choices' more than once (i.e. not a generator).
    choices = list(choices)
    if len(choices) == 1:
        # If there's only one option there's no point in prompting the user.
        logger.debug("Skipping interactive prompt because there's only option (%r).", choices[0])
        return choices[0]
    elif not choices:
        # We can't render a choice prompt without any options.
        raise ValueError("Can't prompt for choice without any options!")
    # Generate the prompt text.
    prompt_text = ('\n\n' if padding else '\n').join([
        # Present the available choices in a user friendly way.
        "\n".join([
            (u" %i. %s" % (i, choice)) + (" (default choice)" if choice == default else "")
            for i, choice in enumerate(choices, start=1)
        ]),
        # Instructions for the user.
        "Enter your choice as a number or unique substring (Control-C aborts): ",
    ])
    prompt_text = prepare_prompt_text(prompt_text, bold=True)
    # Loop until a valid choice is made.
    logger.debug("Requesting interactive choice on terminal (options are %s) ..",
                 concatenate(map(repr, choices)))
    for attempt in retry_limit():
        reply = prompt_for_input(prompt_text, '', padding=padding, strip=True)
        if not reply and default is not None:
            logger.debug("Default choice selected by empty reply (%r).", default)
            return default
        elif reply.isdigit():
            index = int(reply) - 1
            if 0 <= index < len(choices):
                logger.debug("Option (%r) selected by numeric reply (%s).", choices[index], reply)
                return choices[index]
        # Check for substring matches.
        matches = []
        for choice in choices:
            lower_reply = reply.lower()
            lower_choice = choice.lower()
            if lower_reply == lower_choice:
                # If we have an 'exact' match we return it immediately.
                logger.debug("Option (%r) selected by reply (exact match).", choice)
                return choice
            elif lower_reply in lower_choice and len(lower_reply) > 0:
                # Otherwise we gather substring matches.
                matches.append(choice)
        if len(matches) == 1:
            # If a single choice was matched we return it.
            logger.debug("Option (%r) selected by reply (substring match on %r).", matches[0], reply)
            return matches[0]
        else:
            # Give the user a hint about what went wrong.
            if matches:
                details = format("text '%s' matches more than one choice: %s", reply, concatenate(matches))
            elif reply.isdigit():
                details = format("number %i is not a valid choice", int(reply))
            elif reply and not reply.isspace():
                details = format("text '%s' doesn't match any choices", reply)
            else:
                details = "there's no default choice"
            logger.debug("Got %s reply (%s), retrying (%i/%i) ..",
                         "invalid" if reply else "empty", details,
                         attempt, MAX_ATTEMPTS)
            warning("%sError: Invalid input (%s).", indent, details)


def prompt_for_input(question, default=None, padding=True, strip=True):
    """
    Prompt the user for input (free form text).

    :param question: An explanation of what is expected from the user (a string).
    :param default: The return value if the user doesn't enter any text or
                    standard input is not connected to a terminal (which
                    makes it impossible to prompt the user).
    :param padding: Render empty lines before and after the prompt to make it
                    stand out from the surrounding text? (a boolean, defaults
                    to :data:`True`)
    :param strip: Strip leading/trailing whitespace from the user's reply?
    :returns: The text entered by the user (a string) or the value of the
              `default` argument.
    :raises: - :exc:`~exceptions.KeyboardInterrupt` when the program is
               interrupted_ while the prompt is active, for example
               because the user presses Control-C_.
             - :exc:`~exceptions.EOFError` when reading from `standard input`_
               fails, for example because the user presses Control-D_ or
               because the standard input stream is redirected (only if
               `default` is :data:`None`).

    .. _Control-C: https://en.wikipedia.org/wiki/Control-C#In_command-line_environments
    .. _Control-D: https://en.wikipedia.org/wiki/End-of-transmission_character#Meaning_in_Unix
    .. _interrupted: https://en.wikipedia.org/wiki/Unix_signal#SIGINT
    .. _standard input: https://en.wikipedia.org/wiki/Standard_streams#Standard_input_.28stdin.29
    """
    prepare_friendly_prompts()
    reply = None
    try:
        # Prefix an empty line to the text and indent by one space?
        if padding:
            question = '\n' + question
            question = question.replace('\n', '\n ')
        # Render the prompt and wait for the user's reply.
        try:
            reply = interactive_prompt(question)
        finally:
            if reply is None:
                # If the user terminated the prompt using Control-C or
                # Control-D instead of pressing Enter no newline will be
                # rendered after the prompt's text. The result looks kind of
                # weird:
                #
                #   $ python -c 'print(raw_input("Are you sure? "))'
                #   Are you sure? ^CTraceback (most recent call last):
                #     File "<string>", line 1, in <module>
                #   KeyboardInterrupt
                #
                # We can avoid this by emitting a newline ourselves if an
                # exception was raised (signaled by `reply' being None).
                sys.stderr.write('\n')
            if padding:
                # If the caller requested (didn't opt out of) `padding' then we'll
                # emit a newline regardless of whether an exception is being
                # handled. This helps to make interactive prompts `stand out' from
                # a surrounding `wall of text' on the terminal.
                sys.stderr.write('\n')
    except BaseException as e:
        if isinstance(e, EOFError) and default is not None:
            # If standard input isn't connected to an interactive terminal
            # but the caller provided a default we'll return that.
            logger.debug("Got EOF from terminal, returning default value (%r) ..", default)
            return default
        else:
            # Otherwise we log that the prompt was interrupted but propagate
            # the exception to the caller.
            logger.warning("Interactive prompt was interrupted by exception!", exc_info=True)
            raise
    if default is not None and not reply:
        # If the reply is empty and `default' is None we don't want to return
        # None because it's nicer for callers to be able to assume that the
        # return value is always a string.
        return default
    else:
        return reply.strip()


def prepare_prompt_text(prompt_text, **options):
    """
    Wrap a text to be rendered as an interactive prompt in ANSI escape sequences.

    :param prompt_text: The text to render on the prompt (a string).
    :param options: Any keyword arguments are passed on to :func:`.ansi_wrap()`.
    :returns: The resulting prompt text (a string).

    ANSI escape sequences are only used when the standard output stream is
    connected to a terminal. When the standard input stream is connected to a
    terminal any escape sequences are wrapped in "readline hints".
    """
    return (ansi_wrap(prompt_text, readline_hints=connected_to_terminal(sys.stdin), **options)
            if terminal_supports_colors(sys.stdout)
            else prompt_text)


def prepare_friendly_prompts():
    u"""
    Make interactive prompts more user friendly.

    The prompts presented by :func:`python2:raw_input()` (in Python 2) and
    :func:`python3:input()` (in Python 3) are not very user friendly by
    default, for example the cursor keys (:kbd:`←`, :kbd:`↑`, :kbd:`→` and
    :kbd:`↓`) and the :kbd:`Home` and :kbd:`End` keys enter characters instead
    of performing the action you would expect them to. By simply importing the
    :mod:`readline` module these prompts become much friendlier (as mentioned
    in the Python standard library documentation).

    This function is called by the other functions in this module to enable
    user friendly prompts.
    """
    try:
        import readline  # NOQA
    except ImportError:
        # might not be available on Windows if pyreadline isn't installed
        pass


def retry_limit(limit=MAX_ATTEMPTS):
    """
    Allow the user to provide valid input up to `limit` times.

    :param limit: The maximum number of attempts (a number,
                  defaults to :data:`MAX_ATTEMPTS`).
    :returns: A generator of numbers starting from one.
    :raises: :exc:`TooManyInvalidReplies` when an interactive prompt
             receives repeated invalid input (:data:`MAX_ATTEMPTS`).

    This function returns a generator for interactive prompts that want to
    repeat on invalid input without getting stuck in infinite loops.
    """
    for i in range(limit):
        yield i + 1
    msg = "Received too many invalid replies on interactive prompt, giving up! (tried %i times)"
    formatted_msg = msg % limit
    # Make sure the event is logged.
    logger.warning(formatted_msg)
    # Force the caller to decide what to do now.
    raise TooManyInvalidReplies(formatted_msg)


class TooManyInvalidReplies(Exception):

    """Raised by interactive prompts when they've received too many invalid inputs."""
