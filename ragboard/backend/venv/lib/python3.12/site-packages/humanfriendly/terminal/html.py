# Human friendly input/output in Python.
#
# Author: Peter Odding <peter@peterodding.com>
# Last Change: February 29, 2020
# URL: https://humanfriendly.readthedocs.io

"""Convert HTML with simple text formatting to text with ANSI escape sequences."""

# Standard library modules.
import re

# Modules included in our package.
from humanfriendly.compat import HTMLParser, StringIO, name2codepoint, unichr
from humanfriendly.text import compact_empty_lines
from humanfriendly.terminal import ANSI_COLOR_CODES, ANSI_RESET, ansi_style

# Public identifiers that require documentation.
__all__ = ('HTMLConverter', 'html_to_ansi')


def html_to_ansi(data, callback=None):
    """
    Convert HTML with simple text formatting to text with ANSI escape sequences.

    :param data: The HTML to convert (a string).
    :param callback: Optional callback to pass to :class:`HTMLConverter`.
    :returns: Text with ANSI escape sequences (a string).

    Please refer to the documentation of the :class:`HTMLConverter` class for
    details about the conversion process (like which tags are supported) and an
    example with a screenshot.
    """
    converter = HTMLConverter(callback=callback)
    return converter(data)


class HTMLConverter(HTMLParser):

    """
    Convert HTML with simple text formatting to text with ANSI escape sequences.

    The following text styles are supported:

    - Bold: ``<b>``, ``<strong>`` and ``<span style="font-weight: bold;">``
    - Italic: ``<i>``, ``<em>`` and ``<span style="font-style: italic;">``
    - Strike-through: ``<del>``, ``<s>`` and ``<span style="text-decoration: line-through;">``
    - Underline: ``<ins>``, ``<u>`` and ``<span style="text-decoration: underline">``

    Colors can be specified as follows:

    - Foreground color: ``<span style="color: #RRGGBB;">``
    - Background color: ``<span style="background-color: #RRGGBB;">``

    Here's a small demonstration:

    .. code-block:: python

       from humanfriendly.text import dedent
       from humanfriendly.terminal import html_to_ansi

       print(html_to_ansi(dedent('''
         <b>Hello world!</b>
         <i>Is this thing on?</i>
         I guess I can <u>underline</u> or <s>strike-through</s> text?
         And what about <span style="color: red">color</span>?
       ''')))

       rainbow_colors = [
           '#FF0000', '#E2571E', '#FF7F00', '#FFFF00', '#00FF00',
           '#96BF33', '#0000FF', '#4B0082', '#8B00FF', '#FFFFFF',
       ]
       html_rainbow = "".join('<span style="color: %s">o</span>' % c for c in rainbow_colors)
       print(html_to_ansi("Let's try a rainbow: %s" % html_rainbow))

    Here's what the results look like:

      .. image:: images/html-to-ansi.png

    Some more details:

    - Nested tags are supported, within reasonable limits.

    - Text in ``<code>`` and ``<pre>`` tags will be highlighted in a
      different color from the main text (currently this is yellow).

    - ``<a href="URL">TEXT</a>`` is converted to the format "TEXT (URL)" where
      the uppercase symbols are highlighted in light blue with an underline.

    - ``<div>``, ``<p>`` and ``<pre>`` tags are considered block level tags
      and are wrapped in vertical whitespace to prevent their content from
      "running into" surrounding text. This may cause runs of multiple empty
      lines to be emitted. As a *workaround* the :func:`__call__()` method
      will automatically call :func:`.compact_empty_lines()` on the generated
      output before returning it to the caller. Of course this won't work
      when `output` is set to something like :data:`sys.stdout`.

    - ``<br>`` is converted to a single plain text line break.

    Implementation notes:

    - A list of dictionaries with style information is used as a stack where
      new styling can be pushed and a pop will restore the previous styling.
      When new styling is pushed, it is merged with (but overrides) the current
      styling.

    - If you're going to be converting a lot of HTML it might be useful from
      a performance standpoint to re-use an existing :class:`HTMLConverter`
      object for unrelated HTML fragments, in this case take a look at the
      :func:`__call__()` method (it makes this use case very easy).

    .. versionadded:: 4.15
       :class:`humanfriendly.terminal.HTMLConverter` was added to the
       `humanfriendly` package during the initial development of my new
       `chat-archive <https://chat-archive.readthedocs.io/>`_ project, whose
       command line interface makes for a great demonstration of the
       flexibility that this feature provides (hint: check out how the search
       keyword highlighting combines with the regular highlighting).
    """

    BLOCK_TAGS = ('div', 'p', 'pre')
    """The names of tags that are padded with vertical whitespace."""

    def __init__(self, *args, **kw):
        """
        Initialize an :class:`HTMLConverter` object.

        :param callback: Optional keyword argument to specify a function that
                         will be called to process text fragments before they
                         are emitted on the output stream. Note that link text
                         and preformatted text fragments are not processed by
                         this callback.
        :param output: Optional keyword argument to redirect the output to the
                       given file-like object. If this is not given a new
                       :class:`~python3:io.StringIO` object is created.
        """
        # Hide our optional keyword arguments from the superclass.
        self.callback = kw.pop("callback", None)
        self.output = kw.pop("output", None)
        # Initialize the superclass.
        HTMLParser.__init__(self, *args, **kw)

    def __call__(self, data):
        """
        Reset the parser, convert some HTML and get the text with ANSI escape sequences.

        :param data: The HTML to convert to text (a string).
        :returns: The converted text (only in case `output` is
                  a :class:`~python3:io.StringIO` object).
        """
        self.reset()
        self.feed(data)
        self.close()
        if isinstance(self.output, StringIO):
            return compact_empty_lines(self.output.getvalue())

    @property
    def current_style(self):
        """Get the current style from the top of the stack (a dictionary)."""
        return self.stack[-1] if self.stack else {}

    def close(self):
        """
        Close previously opened ANSI escape sequences.

        This method overrides the same method in the superclass to ensure that
        an :data:`.ANSI_RESET` code is emitted when parsing reaches the end of
        the input but a style is still active. This is intended to prevent
        malformed HTML from messing up terminal output.
        """
        if any(self.stack):
            self.output.write(ANSI_RESET)
            self.stack = []
        HTMLParser.close(self)

    def emit_style(self, style=None):
        """
        Emit an ANSI escape sequence for the given or current style to the output stream.

        :param style: A dictionary with arguments for :func:`.ansi_style()` or
                      :data:`None`, in which case the style at the top of the
                      stack is emitted.
        """
        # Clear the current text styles.
        self.output.write(ANSI_RESET)
        # Apply a new text style?
        style = self.current_style if style is None else style
        if style:
            self.output.write(ansi_style(**style))

    def handle_charref(self, value):
        """
        Process a decimal or hexadecimal numeric character reference.

        :param value: The decimal or hexadecimal value (a string).
        """
        self.output.write(unichr(int(value[1:], 16) if value.startswith('x') else int(value)))

    def handle_data(self, data):
        """
        Process textual data.

        :param data: The decoded text (a string).
        """
        if self.link_url:
            # Link text is captured literally so that we can reliably check
            # whether the text and the URL of the link are the same string.
            self.link_text = data
        elif self.callback and self.preformatted_text_level == 0:
            # Text that is not part of a link and not preformatted text is
            # passed to the user defined callback to allow for arbitrary
            # pre-processing.
            data = self.callback(data)
        # All text is emitted unmodified on the output stream.
        self.output.write(data)

    def handle_endtag(self, tag):
        """
        Process the end of an HTML tag.

        :param tag: The name of the tag (a string).
        """
        if tag in ('a', 'b', 'code', 'del', 'em', 'i', 'ins', 'pre', 's', 'strong', 'span', 'u'):
            old_style = self.current_style
            # The following conditional isn't necessary for well formed
            # HTML but prevents raising exceptions on malformed HTML.
            if self.stack:
                self.stack.pop(-1)
            new_style = self.current_style
            if tag == 'a':
                if self.urls_match(self.link_text, self.link_url):
                    # Don't render the URL when it's part of the link text.
                    self.emit_style(new_style)
                else:
                    self.emit_style(new_style)
                    self.output.write(' (')
                    self.emit_style(old_style)
                    self.output.write(self.render_url(self.link_url))
                    self.emit_style(new_style)
                    self.output.write(')')
            else:
                self.emit_style(new_style)
            if tag in ('code', 'pre'):
                self.preformatted_text_level -= 1
        if tag in self.BLOCK_TAGS:
            # Emit an empty line after block level tags.
            self.output.write('\n\n')

    def handle_entityref(self, name):
        """
        Process a named character reference.

        :param name: The name of the character reference (a string).
        """
        self.output.write(unichr(name2codepoint[name]))

    def handle_starttag(self, tag, attrs):
        """
        Process the start of an HTML tag.

        :param tag: The name of the tag (a string).
        :param attrs: A list of tuples with two strings each.
        """
        if tag in self.BLOCK_TAGS:
            # Emit an empty line before block level tags.
            self.output.write('\n\n')
        if tag == 'a':
            self.push_styles(color='blue', bright=True, underline=True)
            # Store the URL that the link points to for later use, so that we
            # can render the link text before the URL (with the reasoning that
            # this is the most intuitive way to present a link in a plain text
            # interface).
            self.link_url = next((v for n, v in attrs if n == 'href'), '')
        elif tag == 'b' or tag == 'strong':
            self.push_styles(bold=True)
        elif tag == 'br':
            self.output.write('\n')
        elif tag == 'code' or tag == 'pre':
            self.push_styles(color='yellow')
            self.preformatted_text_level += 1
        elif tag == 'del' or tag == 's':
            self.push_styles(strike_through=True)
        elif tag == 'em' or tag == 'i':
            self.push_styles(italic=True)
        elif tag == 'ins' or tag == 'u':
            self.push_styles(underline=True)
        elif tag == 'span':
            styles = {}
            css = next((v for n, v in attrs if n == 'style'), "")
            for rule in css.split(';'):
                name, _, value = rule.partition(':')
                name = name.strip()
                value = value.strip()
                if name == 'background-color':
                    styles['background'] = self.parse_color(value)
                elif name == 'color':
                    styles['color'] = self.parse_color(value)
                elif name == 'font-style' and value == 'italic':
                    styles['italic'] = True
                elif name == 'font-weight' and value == 'bold':
                    styles['bold'] = True
                elif name == 'text-decoration' and value == 'line-through':
                    styles['strike_through'] = True
                elif name == 'text-decoration' and value == 'underline':
                    styles['underline'] = True
            self.push_styles(**styles)

    def normalize_url(self, url):
        """
        Normalize a URL to enable string equality comparison.

        :param url: The URL to normalize (a string).
        :returns: The normalized URL (a string).
        """
        return re.sub('^mailto:', '', url)

    def parse_color(self, value):
        """
        Convert a CSS color to something that :func:`.ansi_style()` understands.

        :param value: A string like ``rgb(1,2,3)``, ``#AABBCC`` or ``yellow``.
        :returns: A color value supported by :func:`.ansi_style()` or :data:`None`.
        """
        # Parse an 'rgb(N,N,N)' expression.
        if value.startswith('rgb'):
            tokens = re.findall(r'\d+', value)
            if len(tokens) == 3:
                return tuple(map(int, tokens))
        # Parse an '#XXXXXX' expression.
        elif value.startswith('#'):
            value = value[1:]
            length = len(value)
            if length == 6:
                # Six hex digits (proper notation).
                return (
                    int(value[:2], 16),
                    int(value[2:4], 16),
                    int(value[4:6], 16),
                )
            elif length == 3:
                # Three hex digits (shorthand).
                return (
                    int(value[0], 16),
                    int(value[1], 16),
                    int(value[2], 16),
                )
        # Try to recognize a named color.
        value = value.lower()
        if value in ANSI_COLOR_CODES:
            return value

    def push_styles(self, **changes):
        """
        Push new style information onto the stack.

        :param changes: Any keyword arguments are passed on to :func:`.ansi_style()`.

        This method is a helper for :func:`handle_starttag()`
        that does the following:

        1. Make a copy of the current styles (from the top of the stack),
        2. Apply the given `changes` to the copy of the current styles,
        3. Add the new styles to the stack,
        4. Emit the appropriate ANSI escape sequence to the output stream.
        """
        prototype = self.current_style
        if prototype:
            new_style = dict(prototype)
            new_style.update(changes)
        else:
            new_style = changes
        self.stack.append(new_style)
        self.emit_style(new_style)

    def render_url(self, url):
        """
        Prepare a URL for rendering on the terminal.

        :param url: The URL to simplify (a string).
        :returns: The simplified URL (a string).

        This method pre-processes a URL before rendering on the terminal. The
        following modifications are made:

        - The ``mailto:`` prefix is stripped.
        - Spaces are converted to ``%20``.
        - A trailing parenthesis is converted to ``%29``.
        """
        url = re.sub('^mailto:', '', url)
        url = re.sub(' ', '%20', url)
        url = re.sub(r'\)$', '%29', url)
        return url

    def reset(self):
        """
        Reset the state of the HTML parser and ANSI converter.

        When `output` is a :class:`~python3:io.StringIO` object a new
        instance will be created (and the old one garbage collected).
        """
        # Reset the state of the superclass.
        HTMLParser.reset(self)
        # Reset our instance variables.
        self.link_text = None
        self.link_url = None
        self.preformatted_text_level = 0
        if self.output is None or isinstance(self.output, StringIO):
            # If the caller specified something like output=sys.stdout then it
            # doesn't make much sense to negate that choice here in reset().
            self.output = StringIO()
        self.stack = []

    def urls_match(self, a, b):
        """
        Compare two URLs for equality using :func:`normalize_url()`.

        :param a: A string containing a URL.
        :param b: A string containing a URL.
        :returns: :data:`True` if the URLs are the same, :data:`False` otherwise.

        This method is used by :func:`handle_endtag()` to omit the URL of a
        hyperlink (``<a href="...">``) when the link text is that same URL.
        """
        return self.normalize_url(a) == self.normalize_url(b)
