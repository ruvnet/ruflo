# Human friendly input/output in Python.
#
# Author: Peter Odding <peter@peterodding.com>
# Last Change: June 11, 2021
# URL: https://humanfriendly.readthedocs.io

"""
Parsing and reformatting of usage messages.

The :mod:`~humanfriendly.usage` module parses and reformats usage messages:

- The :func:`format_usage()` function takes a usage message and inserts ANSI
  escape sequences that highlight items of special significance like command
  line options, meta variables, etc. The resulting usage message is (intended
  to be) easier to read on a terminal.

- The :func:`render_usage()` function takes a usage message and rewrites it to
  reStructuredText_ suitable for inclusion in the documentation of a Python
  package. This provides a DRY solution to keeping a single authoritative
  definition of the usage message while making it easily available in
  documentation. As a cherry on the cake it's not just a pre-formatted dump of
  the usage message but a nicely formatted reStructuredText_ fragment.

- The remaining functions in this module support the two functions above.

Usage messages in general are free format of course, however the functions in
this module assume a certain structure from usage messages in order to
successfully parse and reformat them, refer to :func:`parse_usage()` for
details.

.. _DRY: https://en.wikipedia.org/wiki/Don%27t_repeat_yourself
.. _reStructuredText: https://en.wikipedia.org/wiki/ReStructuredText
"""

# Standard library modules.
import csv
import functools
import logging
import re

# Standard library module or external dependency (see setup.py).
from importlib import import_module

# Modules included in our package.
from humanfriendly.compat import StringIO
from humanfriendly.text import dedent, split_paragraphs, trim_empty_lines

# Public identifiers that require documentation.
__all__ = (
    'find_meta_variables',
    'format_usage',
    'import_module',  # previously exported (backwards compatibility)
    'inject_usage',
    'parse_usage',
    'render_usage',
    'USAGE_MARKER',
)

USAGE_MARKER = "Usage:"
"""The string that starts the first line of a usage message."""

START_OF_OPTIONS_MARKER = "Supported options:"
"""The string that marks the start of the documented command line options."""

# Compiled regular expression used to tokenize usage messages.
USAGE_PATTERN = re.compile(r'''
    # Make sure whatever we're matching isn't preceded by a non-whitespace
    # character.
    (?<!\S)
    (
        # A short command line option or a long command line option
        # (possibly including a meta variable for a value).
        (-\w|--\w+(-\w+)*(=\S+)?)
        # Or ...
        |
        # An environment variable.
        \$[A-Za-z_][A-Za-z0-9_]*
        # Or ...
        |
        # Might be a meta variable (usage() will figure it out).
        [A-Z][A-Z0-9_]+
    )
''', re.VERBOSE)

# Compiled regular expression used to recognize options.
OPTION_PATTERN = re.compile(r'^(-\w|--\w+(-\w+)*(=\S+)?)$')

# Initialize a logger for this module.
logger = logging.getLogger(__name__)


def format_usage(usage_text):
    """
    Highlight special items in a usage message.

    :param usage_text: The usage message to process (a string).
    :returns: The usage message with special items highlighted.

    This function highlights the following special items:

    - The initial line of the form "Usage: ..."
    - Short and long command line options
    - Environment variables
    - Meta variables (see :func:`find_meta_variables()`)

    All items are highlighted in the color defined by
    :data:`.HIGHLIGHT_COLOR`.
    """
    # Ugly workaround to avoid circular import errors due to interdependencies
    # between the humanfriendly.terminal and humanfriendly.usage modules.
    from humanfriendly.terminal import ansi_wrap, HIGHLIGHT_COLOR
    formatted_lines = []
    meta_variables = find_meta_variables(usage_text)
    for line in usage_text.strip().splitlines(True):
        if line.startswith(USAGE_MARKER):
            # Highlight the "Usage: ..." line in bold font and color.
            formatted_lines.append(ansi_wrap(line, color=HIGHLIGHT_COLOR))
        else:
            # Highlight options, meta variables and environment variables.
            formatted_lines.append(replace_special_tokens(
                line, meta_variables,
                lambda token: ansi_wrap(token, color=HIGHLIGHT_COLOR),
            ))
    return ''.join(formatted_lines)


def find_meta_variables(usage_text):
    """
    Find the meta variables in the given usage message.

    :param usage_text: The usage message to parse (a string).
    :returns: A list of strings with any meta variables found in the usage
              message.

    When a command line option requires an argument, the convention is to
    format such options as ``--option=ARG``. The text ``ARG`` in this example
    is the meta variable.
    """
    meta_variables = set()
    for match in USAGE_PATTERN.finditer(usage_text):
        token = match.group(0)
        if token.startswith('-'):
            option, _, value = token.partition('=')
            if value:
                meta_variables.add(value)
    return list(meta_variables)


def parse_usage(text):
    """
    Parse a usage message by inferring its structure (and making some assumptions :-).

    :param text: The usage message to parse (a string).
    :returns: A tuple of two lists:

              1. A list of strings with the paragraphs of the usage message's
                 "introduction" (the paragraphs before the documentation of the
                 supported command line options).

              2. A list of strings with pairs of command line options and their
                 descriptions: Item zero is a line listing a supported command
                 line option, item one is the description of that command line
                 option, item two is a line listing another supported command
                 line option, etc.

    Usage messages in general are free format of course, however
    :func:`parse_usage()` assume a certain structure from usage messages in
    order to successfully parse them:

    - The usage message starts with a line ``Usage: ...`` that shows a symbolic
      representation of the way the program is to be invoked.

    - After some free form text a line ``Supported options:`` (surrounded by
      empty lines) precedes the documentation of the supported command line
      options.

    - The command line options are documented as follows::

        -v, --verbose

          Make more noise.

      So all of the variants of the command line option are shown together on a
      separate line, followed by one or more paragraphs describing the option.

    - There are several other minor assumptions, but to be honest I'm not sure if
      anyone other than me is ever going to use this functionality, so for now I
      won't list every intricate detail :-).

      If you're curious anyway, refer to the usage message of the `humanfriendly`
      package (defined in the :mod:`humanfriendly.cli` module) and compare it with
      the usage message you see when you run ``humanfriendly --help`` and the
      generated usage message embedded in the readme.

      Feel free to request more detailed documentation if you're interested in
      using the :mod:`humanfriendly.usage` module outside of the little ecosystem
      of Python packages that I have been building over the past years.
    """
    introduction = []
    documented_options = []
    # Split the raw usage message into paragraphs.
    paragraphs = split_paragraphs(text)
    # Get the paragraphs that are part of the introduction.
    while paragraphs:
        # Check whether we've found the end of the introduction.
        end_of_intro = (paragraphs[0] == START_OF_OPTIONS_MARKER)
        # Append the current paragraph to the introduction.
        introduction.append(paragraphs.pop(0))
        # Stop after we've processed the complete introduction.
        if end_of_intro:
            break
    logger.debug("Parsed introduction: %s", introduction)
    # Parse the paragraphs that document command line options.
    while paragraphs:
        documented_options.append(dedent(paragraphs.pop(0)))
        description = []
        while paragraphs:
            # Check if the next paragraph starts the documentation of another
            # command line option. We split on a comma followed by a space so
            # that our parsing doesn't trip up when the label used for an
            # option's value contains commas.
            tokens = [t.strip() for t in re.split(r',\s', paragraphs[0]) if t and not t.isspace()]
            if all(OPTION_PATTERN.match(t) for t in tokens):
                break
            else:
                description.append(paragraphs.pop(0))
        # Join the description's paragraphs back together so we can remove
        # common leading indentation.
        documented_options.append(dedent('\n\n'.join(description)))
    logger.debug("Parsed options: %s", documented_options)
    return introduction, documented_options


def render_usage(text):
    """
    Reformat a command line program's usage message to reStructuredText_.

    :param text: The plain text usage message (a string).
    :returns: The usage message rendered to reStructuredText_ (a string).
    """
    meta_variables = find_meta_variables(text)
    introduction, options = parse_usage(text)
    output = [render_paragraph(p, meta_variables) for p in introduction]
    if options:
        output.append('\n'.join([
            '.. csv-table::',
            '   :header: Option, Description',
            '   :widths: 30, 70',
            '',
        ]))
        csv_buffer = StringIO()
        csv_writer = csv.writer(csv_buffer)
        while options:
            variants = options.pop(0)
            description = options.pop(0)
            csv_writer.writerow([
                render_paragraph(variants, meta_variables),
                ('\n\n'.join(render_paragraph(p, meta_variables) for p in split_paragraphs(description))).rstrip(),
            ])
        csv_lines = csv_buffer.getvalue().splitlines()
        output.append('\n'.join('   %s' % line for line in csv_lines))
    logger.debug("Rendered output: %s", output)
    return '\n\n'.join(trim_empty_lines(o) for o in output)


def inject_usage(module_name):
    """
    Use cog_ to inject a usage message into a reStructuredText_ file.

    :param module_name: The name of the module whose ``__doc__`` attribute is
                        the source of the usage message (a string).

    This simple wrapper around :func:`render_usage()` makes it very easy to
    inject a reformatted usage message into your documentation using cog_. To
    use it you add a fragment like the following to your ``*.rst`` file::

       .. [[[cog
       .. from humanfriendly.usage import inject_usage
       .. inject_usage('humanfriendly.cli')
       .. ]]]
       .. [[[end]]]

    The lines in the fragment above are single line reStructuredText_ comments
    that are not copied to the output. Their purpose is to instruct cog_ where
    to inject the reformatted usage message. Once you've added these lines to
    your ``*.rst`` file, updating the rendered usage message becomes really
    simple thanks to cog_:

    .. code-block:: sh

       $ cog.py -r README.rst

    This will inject or replace the rendered usage message in your
    ``README.rst`` file with an up to date copy.

    .. _cog: http://nedbatchelder.com/code/cog/
    """
    import cog
    usage_text = import_module(module_name).__doc__
    cog.out("\n" + render_usage(usage_text) + "\n\n")


def render_paragraph(paragraph, meta_variables):
    # Reformat the "Usage:" line to highlight "Usage:" in bold and show the
    # remainder of the line as pre-formatted text.
    if paragraph.startswith(USAGE_MARKER):
        tokens = paragraph.split()
        return "**%s** `%s`" % (tokens[0], ' '.join(tokens[1:]))
    # Reformat the "Supported options:" line to highlight it in bold.
    if paragraph == 'Supported options:':
        return "**%s**" % paragraph
    # Reformat shell transcripts into code blocks.
    if re.match(r'^\s*\$\s+\S', paragraph):
        # Split the paragraph into lines.
        lines = paragraph.splitlines()
        # Check if the paragraph is already indented.
        if not paragraph[0].isspace():
            # If the paragraph isn't already indented we'll indent it now.
            lines = ['  %s' % line for line in lines]
        lines.insert(0, '.. code-block:: sh')
        lines.insert(1, '')
        return "\n".join(lines)
    # The following reformatting applies only to paragraphs which are not
    # indented. Yes this is a hack - for now we assume that indented paragraphs
    # are code blocks, even though this assumption can be wrong.
    if not paragraph[0].isspace():
        # Change UNIX style `quoting' so it doesn't trip up DocUtils.
        paragraph = re.sub("`(.+?)'", r'"\1"', paragraph)
        # Escape asterisks.
        paragraph = paragraph.replace('*', r'\*')
        # Reformat inline tokens.
        paragraph = replace_special_tokens(
            paragraph, meta_variables,
            lambda token: '``%s``' % token,
        )
    return paragraph


def replace_special_tokens(text, meta_variables, replace_fn):
    return USAGE_PATTERN.sub(functools.partial(
        replace_tokens_callback,
        meta_variables=meta_variables,
        replace_fn=replace_fn
    ), text)


def replace_tokens_callback(match, meta_variables, replace_fn):
    token = match.group(0)
    if not (re.match('^[A-Z][A-Z0-9_]+$', token) and token not in meta_variables):
        token = replace_fn(token)
    return token
