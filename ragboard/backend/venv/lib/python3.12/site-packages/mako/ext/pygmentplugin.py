# ext/pygmentplugin.py
# Copyright 2006-2025 the Mako authors and contributors <see AUTHORS file>
#
# This module is part of Mako and is released under
# the MIT License: http://www.opensource.org/licenses/mit-license.php

from pygments import highlight
from pygments.formatters.html import HtmlFormatter
from pygments.lexer import bygroups
from pygments.lexer import DelegatingLexer
from pygments.lexer import include
from pygments.lexer import RegexLexer
from pygments.lexer import using
from pygments.lexers.agile import Python3Lexer
from pygments.lexers.agile import PythonLexer
from pygments.lexers.web import CssLexer
from pygments.lexers.web import HtmlLexer
from pygments.lexers.web import JavascriptLexer
from pygments.lexers.web import XmlLexer
from pygments.token import Comment
from pygments.token import Keyword
from pygments.token import Name
from pygments.token import Operator
from pygments.token import Other
from pygments.token import String
from pygments.token import Text


class MakoLexer(RegexLexer):
    name = "Mako"
    aliases = ["mako"]
    filenames = ["*.mao"]

    tokens = {
        "root": [
            (
                r"(\s*)(\%)(\s*end(?:\w+))(\n|\Z)",
                bygroups(Text, Comment.Preproc, Keyword, Other),
            ),
            (
                r"(\s*)(\%(?!%))([^\n]*)(\n|\Z)",
                bygroups(Text, Comment.Preproc, using(PythonLexer), Other),
            ),
            (
                r"(\s*)(##[^\n]*)(\n|\Z)",
                bygroups(Text, Comment.Preproc, Other),
            ),
            (r"""(?s)<%doc>.*?</%doc>""", Comment.Preproc),
            (
                r"(<%)([\w\.\:]+)",
                bygroups(Comment.Preproc, Name.Builtin),
                "tag",
            ),
            (
                r"(</%)([\w\.\:]+)(>)",
                bygroups(Comment.Preproc, Name.Builtin, Comment.Preproc),
            ),
            (r"<%(?=([\w\.\:]+))", Comment.Preproc, "ondeftags"),
            (
                r"(?s)(<%(?:!?))(.*?)(%>)",
                bygroups(Comment.Preproc, using(PythonLexer), Comment.Preproc),
            ),
            (
                r"(\$\{)(.*?)(\})",
                bygroups(Comment.Preproc, using(PythonLexer), Comment.Preproc),
            ),
            (
                r"""(?sx)
                (.+?)               # anything, followed by:
                (?:
                 (?<=\n)(?=%(?!%)|\#\#) |  # an eval or comment line
                 (?=\#\*) |          # multiline comment
                 (?=</?%) |         # a python block
                                    # call start or end
                 (?=\$\{) |         # a substitution
                 (?<=\n)(?=\s*%) |
                                    # - don't consume
                 (\\\n) |           # an escaped newline
                 \Z                 # end of string
                )
            """,
                bygroups(Other, Operator),
            ),
            (r"\s+", Text),
        ],
        "ondeftags": [
            (r"<%", Comment.Preproc),
            (r"(?<=<%)(include|inherit|namespace|page)", Name.Builtin),
            include("tag"),
        ],
        "tag": [
            (r'((?:\w+)\s*=)\s*(".*?")', bygroups(Name.Attribute, String)),
            (r"/?\s*>", Comment.Preproc, "#pop"),
            (r"\s+", Text),
        ],
        "attr": [
            ('".*?"', String, "#pop"),
            ("'.*?'", String, "#pop"),
            (r"[^\s>]+", String, "#pop"),
        ],
    }


class MakoHtmlLexer(DelegatingLexer):
    name = "HTML+Mako"
    aliases = ["html+mako"]

    def __init__(self, **options):
        super().__init__(HtmlLexer, MakoLexer, **options)


class MakoXmlLexer(DelegatingLexer):
    name = "XML+Mako"
    aliases = ["xml+mako"]

    def __init__(self, **options):
        super().__init__(XmlLexer, MakoLexer, **options)


class MakoJavascriptLexer(DelegatingLexer):
    name = "JavaScript+Mako"
    aliases = ["js+mako", "javascript+mako"]

    def __init__(self, **options):
        super().__init__(JavascriptLexer, MakoLexer, **options)


class MakoCssLexer(DelegatingLexer):
    name = "CSS+Mako"
    aliases = ["css+mako"]

    def __init__(self, **options):
        super().__init__(CssLexer, MakoLexer, **options)


pygments_html_formatter = HtmlFormatter(
    cssclass="syntax-highlighted", linenos=True
)


def syntax_highlight(filename="", language=None):
    mako_lexer = MakoLexer()
    python_lexer = Python3Lexer()
    if filename.startswith("memory:") or language == "mako":
        return lambda string: highlight(
            string, mako_lexer, pygments_html_formatter
        )
    return lambda string: highlight(
        string, python_lexer, pygments_html_formatter
    )
