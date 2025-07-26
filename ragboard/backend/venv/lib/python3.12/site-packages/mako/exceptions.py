# mako/exceptions.py
# Copyright 2006-2025 the Mako authors and contributors <see AUTHORS file>
#
# This module is part of Mako and is released under
# the MIT License: http://www.opensource.org/licenses/mit-license.php

"""exception classes"""

import sys
import traceback

from mako import compat
from mako import util


class MakoException(Exception):
    pass


class RuntimeException(MakoException):
    pass


def _format_filepos(lineno, pos, filename):
    if filename is None:
        return " at line: %d char: %d" % (lineno, pos)
    else:
        return " in file '%s' at line: %d char: %d" % (filename, lineno, pos)


class CompileException(MakoException):
    def __init__(self, message, source, lineno, pos, filename):
        MakoException.__init__(
            self, message + _format_filepos(lineno, pos, filename)
        )
        self.lineno = lineno
        self.pos = pos
        self.filename = filename
        self.source = source


class SyntaxException(MakoException):
    def __init__(self, message, source, lineno, pos, filename):
        MakoException.__init__(
            self, message + _format_filepos(lineno, pos, filename)
        )
        self.lineno = lineno
        self.pos = pos
        self.filename = filename
        self.source = source


class UnsupportedError(MakoException):

    """raised when a retired feature is used."""


class NameConflictError(MakoException):

    """raised when a reserved word is used inappropriately"""


class TemplateLookupException(MakoException):
    pass


class TopLevelLookupException(TemplateLookupException):
    pass


class RichTraceback:

    """Pull the current exception from the ``sys`` traceback and extracts
    Mako-specific template information.

    See the usage examples in :ref:`handling_exceptions`.

    """

    def __init__(self, error=None, traceback=None):
        self.source, self.lineno = "", 0

        if error is None or traceback is None:
            t, value, tback = sys.exc_info()

        if error is None:
            error = value or t

        if traceback is None:
            traceback = tback

        self.error = error
        self.records = self._init(traceback)

        if isinstance(self.error, (CompileException, SyntaxException)):
            self.source = self.error.source
            self.lineno = self.error.lineno
            self._has_source = True

        self._init_message()

    @property
    def errorname(self):
        return compat.exception_name(self.error)

    def _init_message(self):
        """Find a unicode representation of self.error"""
        try:
            self.message = str(self.error)
        except UnicodeError:
            try:
                self.message = str(self.error)
            except UnicodeEncodeError:
                # Fallback to args as neither unicode nor
                # str(Exception(u'\xe6')) work in Python < 2.6
                self.message = self.error.args[0]
        if not isinstance(self.message, str):
            self.message = str(self.message, "ascii", "replace")

    def _get_reformatted_records(self, records):
        for rec in records:
            if rec[6] is not None:
                yield (rec[4], rec[5], rec[2], rec[6])
            else:
                yield tuple(rec[0:4])

    @property
    def traceback(self):
        """Return a list of 4-tuple traceback records (i.e. normal python
        format) with template-corresponding lines remapped to the originating
        template.

        """
        return list(self._get_reformatted_records(self.records))

    @property
    def reverse_records(self):
        return reversed(self.records)

    @property
    def reverse_traceback(self):
        """Return the same data as traceback, except in reverse order."""

        return list(self._get_reformatted_records(self.reverse_records))

    def _init(self, trcback):
        """format a traceback from sys.exc_info() into 7-item tuples,
        containing the regular four traceback tuple items, plus the original
        template filename, the line number adjusted relative to the template
        source, and code line from that line number of the template."""

        import mako.template

        mods = {}
        rawrecords = traceback.extract_tb(trcback)
        new_trcback = []
        for filename, lineno, function, line in rawrecords:
            if not line:
                line = ""
            try:
                (line_map, template_lines, template_filename) = mods[filename]
            except KeyError:
                try:
                    info = mako.template._get_module_info(filename)
                    module_source = info.code
                    template_source = info.source
                    template_filename = (
                        info.template_filename or info.template_uri or filename
                    )
                except KeyError:
                    # A normal .py file (not a Template)
                    new_trcback.append(
                        (
                            filename,
                            lineno,
                            function,
                            line,
                            None,
                            None,
                            None,
                            None,
                        )
                    )
                    continue

                template_ln = 1

                mtm = mako.template.ModuleInfo
                source_map = mtm.get_module_source_metadata(
                    module_source, full_line_map=True
                )
                line_map = source_map["full_line_map"]

                template_lines = [
                    line_ for line_ in template_source.split("\n")
                ]
                mods[filename] = (line_map, template_lines, template_filename)

            template_ln = line_map[lineno - 1]

            if template_ln <= len(template_lines):
                template_line = template_lines[template_ln - 1]
            else:
                template_line = None
            new_trcback.append(
                (
                    filename,
                    lineno,
                    function,
                    line,
                    template_filename,
                    template_ln,
                    template_line,
                    template_source,
                )
            )
        if not self.source:
            for l in range(len(new_trcback) - 1, 0, -1):
                if new_trcback[l][5]:
                    self.source = new_trcback[l][7]
                    self.lineno = new_trcback[l][5]
                    break
            else:
                if new_trcback:
                    try:
                        # A normal .py file (not a Template)
                        with open(new_trcback[-1][0], "rb") as fp:
                            encoding = util.parse_encoding(fp)
                            if not encoding:
                                encoding = "utf-8"
                            fp.seek(0)
                            self.source = fp.read()
                        if encoding:
                            self.source = self.source.decode(encoding)
                    except IOError:
                        self.source = ""
                    self.lineno = new_trcback[-1][1]
        return new_trcback


def text_error_template(lookup=None):
    """Provides a template that renders a stack trace in a similar format to
    the Python interpreter, substituting source template filenames, line
    numbers and code for that of the originating source template, as
    applicable.

    """
    import mako.template

    return mako.template.Template(
        r"""
<%page args="error=None, traceback=None"/>
<%!
    from mako.exceptions import RichTraceback
%>\
<%
    tback = RichTraceback(error=error, traceback=traceback)
%>\
Traceback (most recent call last):
% for (filename, lineno, function, line) in tback.traceback:
  File "${filename}", line ${lineno}, in ${function or '?'}
    ${line | trim}
% endfor
${tback.errorname}: ${tback.message}
"""
    )


def _install_pygments():
    global syntax_highlight, pygments_html_formatter
    from mako.ext.pygmentplugin import syntax_highlight  # noqa
    from mako.ext.pygmentplugin import pygments_html_formatter  # noqa


def _install_fallback():
    global syntax_highlight, pygments_html_formatter
    from mako.filters import html_escape

    pygments_html_formatter = None

    def syntax_highlight(filename="", language=None):
        return html_escape


def _install_highlighting():
    try:
        _install_pygments()
    except ImportError:
        _install_fallback()


_install_highlighting()


def html_error_template():
    """Provides a template that renders a stack trace in an HTML format,
    providing an excerpt of code as well as substituting source template
    filenames, line numbers and code for that of the originating source
    template, as applicable.

    The template's default ``encoding_errors`` value is
    ``'htmlentityreplace'``. The template has two options. With the
    ``full`` option disabled, only a section of an HTML document is
    returned. With the ``css`` option disabled, the default stylesheet
    won't be included.

    """
    import mako.template

    return mako.template.Template(
        r"""
<%!
    from mako.exceptions import RichTraceback, syntax_highlight,\
            pygments_html_formatter
%>
<%page args="full=True, css=True, error=None, traceback=None"/>
% if full:
<html>
<head>
    <title>Mako Runtime Error</title>
% endif
% if css:
    <style>
        body { font-family:verdana; margin:10px 30px 10px 30px;}
        .stacktrace { margin:5px 5px 5px 5px; }
        .highlight { padding:0px 10px 0px 10px; background-color:#9F9FDF; }
        .nonhighlight { padding:0px; background-color:#DFDFDF; }
        .sample { padding:10px; margin:10px 10px 10px 10px;
                  font-family:monospace; }
        .sampleline { padding:0px 10px 0px 10px; }
        .sourceline { margin:5px 5px 10px 5px; font-family:monospace;}
        .location { font-size:80%; }
        .highlight { white-space:pre; }
        .sampleline { white-space:pre; }

    % if pygments_html_formatter:
        ${pygments_html_formatter.get_style_defs()}
        .linenos { min-width: 2.5em; text-align: right; }
        pre { margin: 0; }
        .syntax-highlighted { padding: 0 10px; }
        .syntax-highlightedtable { border-spacing: 1px; }
        .nonhighlight { border-top: 1px solid #DFDFDF;
                        border-bottom: 1px solid #DFDFDF; }
        .stacktrace .nonhighlight { margin: 5px 15px 10px; }
        .sourceline { margin: 0 0; font-family:monospace; }
        .code { background-color: #F8F8F8; width: 100%; }
        .error .code { background-color: #FFBDBD; }
        .error .syntax-highlighted { background-color: #FFBDBD; }
    % endif

    </style>
% endif
% if full:
</head>
<body>
% endif

<h2>Error !</h2>
<%
    tback = RichTraceback(error=error, traceback=traceback)
    src = tback.source
    line = tback.lineno
    if src:
        lines = src.split('\n')
    else:
        lines = None
%>
<h3>${tback.errorname}: ${tback.message|h}</h3>

% if lines:
    <div class="sample">
    <div class="nonhighlight">
% for index in range(max(0, line-4),min(len(lines), line+5)):
    <%
       if pygments_html_formatter:
           pygments_html_formatter.linenostart = index + 1
    %>
    % if index + 1 == line:
    <%
       if pygments_html_formatter:
           old_cssclass = pygments_html_formatter.cssclass
           pygments_html_formatter.cssclass = 'error ' + old_cssclass
    %>
        ${lines[index] | syntax_highlight(language='mako')}
    <%
       if pygments_html_formatter:
           pygments_html_formatter.cssclass = old_cssclass
    %>
    % else:
        ${lines[index] | syntax_highlight(language='mako')}
    % endif
% endfor
    </div>
    </div>
% endif

<div class="stacktrace">
% for (filename, lineno, function, line) in tback.reverse_traceback:
    <div class="location">${filename}, line ${lineno}:</div>
    <div class="nonhighlight">
    <%
       if pygments_html_formatter:
           pygments_html_formatter.linenostart = lineno
    %>
      <div class="sourceline">${line | syntax_highlight(filename)}</div>
    </div>
% endfor
</div>

% if full:
</body>
</html>
% endif
""",
        output_encoding=sys.getdefaultencoding(),
        encoding_errors="htmlentityreplace",
    )
