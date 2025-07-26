# mako/pygen.py
# Copyright 2006-2025 the Mako authors and contributors <see AUTHORS file>
#
# This module is part of Mako and is released under
# the MIT License: http://www.opensource.org/licenses/mit-license.php

"""utilities for generating and formatting literal Python code."""

import re

from mako import exceptions


class PythonPrinter:
    def __init__(self, stream):
        # indentation counter
        self.indent = 0

        # a stack storing information about why we incremented
        # the indentation counter, to help us determine if we
        # should decrement it
        self.indent_detail = []

        # the string of whitespace multiplied by the indent
        # counter to produce a line
        self.indentstring = "    "

        # the stream we are writing to
        self.stream = stream

        # current line number
        self.lineno = 1

        # a list of lines that represents a buffered "block" of code,
        # which can be later printed relative to an indent level
        self.line_buffer = []

        self.in_indent_lines = False

        self._reset_multi_line_flags()

        # mapping of generated python lines to template
        # source lines
        self.source_map = {}

        self._re_space_comment = re.compile(r"^\s*#")
        self._re_space = re.compile(r"^\s*$")
        self._re_indent = re.compile(r":[ \t]*(?:#.*)?$")
        self._re_compound = re.compile(r"^\s*(if|try|elif|while|for|with)")
        self._re_indent_keyword = re.compile(
            r"^\s*(def|class|else|elif|except|finally)"
        )
        self._re_unindentor = re.compile(r"^\s*(else|elif|except|finally).*\:")

    def _update_lineno(self, num):
        self.lineno += num

    def start_source(self, lineno):
        if self.lineno not in self.source_map:
            self.source_map[self.lineno] = lineno

    def write_blanks(self, num):
        self.stream.write("\n" * num)
        self._update_lineno(num)

    def write_indented_block(self, block, starting_lineno=None):
        """print a line or lines of python which already contain indentation.

        The indentation of the total block of lines will be adjusted to that of
        the current indent level."""
        self.in_indent_lines = False
        for i, l in enumerate(re.split(r"\r?\n", block)):
            self.line_buffer.append(l)
            if starting_lineno is not None:
                self.start_source(starting_lineno + i)
            self._update_lineno(1)

    def writelines(self, *lines):
        """print a series of lines of python."""
        for line in lines:
            self.writeline(line)

    def writeline(self, line):
        """print a line of python, indenting it according to the current
        indent level.

        this also adjusts the indentation counter according to the
        content of the line.

        """

        if not self.in_indent_lines:
            self._flush_adjusted_lines()
            self.in_indent_lines = True

        if (
            line is None
            or self._re_space_comment.match(line)
            or self._re_space.match(line)
        ):
            hastext = False
        else:
            hastext = True

        is_comment = line and len(line) and line[0] == "#"

        # see if this line should decrease the indentation level
        if (
            not is_comment
            and (not hastext or self._is_unindentor(line))
            and self.indent > 0
        ):
            self.indent -= 1
            # if the indent_detail stack is empty, the user
            # probably put extra closures - the resulting
            # module wont compile.
            if len(self.indent_detail) == 0:
                # TODO: no coverage here
                raise exceptions.MakoException("Too many whitespace closures")
            self.indent_detail.pop()

        if line is None:
            return

        # write the line
        self.stream.write(self._indent_line(line) + "\n")
        self._update_lineno(len(line.split("\n")))

        # see if this line should increase the indentation level.
        # note that a line can both decrase (before printing) and
        # then increase (after printing) the indentation level.

        if self._re_indent.search(line):
            # increment indentation count, and also
            # keep track of what the keyword was that indented us,
            # if it is a python compound statement keyword
            # where we might have to look for an "unindent" keyword
            match = self._re_compound.match(line)
            if match:
                # its a "compound" keyword, so we will check for "unindentors"
                indentor = match.group(1)
                self.indent += 1
                self.indent_detail.append(indentor)
            else:
                indentor = None
                # its not a "compound" keyword.  but lets also
                # test for valid Python keywords that might be indenting us,
                # else assume its a non-indenting line
                m2 = self._re_indent_keyword.match(line)
                if m2:
                    self.indent += 1
                    self.indent_detail.append(indentor)

    def close(self):
        """close this printer, flushing any remaining lines."""
        self._flush_adjusted_lines()

    def _is_unindentor(self, line):
        """return true if the given line is an 'unindentor',
        relative to the last 'indent' event received.

        """

        # no indentation detail has been pushed on; return False
        if len(self.indent_detail) == 0:
            return False

        indentor = self.indent_detail[-1]

        # the last indent keyword we grabbed is not a
        # compound statement keyword; return False
        if indentor is None:
            return False

        # if the current line doesnt have one of the "unindentor" keywords,
        # return False
        match = self._re_unindentor.match(line)
        # if True, whitespace matches up, we have a compound indentor,
        # and this line has an unindentor, this
        # is probably good enough
        return bool(match)

        # should we decide that its not good enough, heres
        # more stuff to check.
        # keyword = match.group(1)

        # match the original indent keyword
        # for crit in [
        #   (r'if|elif', r'else|elif'),
        #   (r'try', r'except|finally|else'),
        #   (r'while|for', r'else'),
        # ]:
        #   if re.match(crit[0], indentor) and re.match(crit[1], keyword):
        #        return True

        # return False

    def _indent_line(self, line, stripspace=""):
        """indent the given line according to the current indent level.

        stripspace is a string of space that will be truncated from the
        start of the line before indenting."""
        if stripspace == "":
            # Fast path optimization.
            return self.indentstring * self.indent + line

        return re.sub(
            r"^%s" % stripspace, self.indentstring * self.indent, line
        )

    def _reset_multi_line_flags(self):
        """reset the flags which would indicate we are in a backslashed
        or triple-quoted section."""

        self.backslashed, self.triplequoted = False, False

    def _in_multi_line(self, line):
        """return true if the given line is part of a multi-line block,
        via backslash or triple-quote."""

        # we are only looking for explicitly joined lines here, not
        # implicit ones (i.e. brackets, braces etc.).  this is just to
        # guard against the possibility of modifying the space inside of
        # a literal multiline string with unfortunately placed
        # whitespace

        current_state = self.backslashed or self.triplequoted

        self.backslashed = bool(re.search(r"\\$", line))
        triples = len(re.findall(r"\"\"\"|\'\'\'", line))
        if triples == 1 or triples % 2 != 0:
            self.triplequoted = not self.triplequoted

        return current_state

    def _flush_adjusted_lines(self):
        stripspace = None
        self._reset_multi_line_flags()

        for entry in self.line_buffer:
            if self._in_multi_line(entry):
                self.stream.write(entry + "\n")
            else:
                entry = entry.expandtabs()
                if stripspace is None and re.search(r"^[ \t]*[^# \t]", entry):
                    stripspace = re.match(r"^([ \t]*)", entry).group(1)
                self.stream.write(self._indent_line(entry, stripspace) + "\n")

        self.line_buffer = []
        self._reset_multi_line_flags()


def adjust_whitespace(text):
    """remove the left-whitespace margin of a block of Python code."""

    state = [False, False]
    (backslashed, triplequoted) = (0, 1)

    def in_multi_line(line):
        start_state = state[backslashed] or state[triplequoted]

        if re.search(r"\\$", line):
            state[backslashed] = True
        else:
            state[backslashed] = False

        def match(reg, t):
            m = re.match(reg, t)
            if m:
                return m, t[len(m.group(0)) :]
            else:
                return None, t

        while line:
            if state[triplequoted]:
                m, line = match(r"%s" % state[triplequoted], line)
                if m:
                    state[triplequoted] = False
                else:
                    m, line = match(r".*?(?=%s|$)" % state[triplequoted], line)
            else:
                m, line = match(r"#", line)
                if m:
                    return start_state

                m, line = match(r"\"\"\"|\'\'\'", line)
                if m:
                    state[triplequoted] = m.group(0)
                    continue

                m, line = match(r".*?(?=\"\"\"|\'\'\'|#|$)", line)

        return start_state

    def _indent_line(line, stripspace=""):
        return re.sub(r"^%s" % stripspace, "", line)

    lines = []
    stripspace = None

    for line in re.split(r"\r?\n", text):
        if in_multi_line(line):
            lines.append(line)
        else:
            line = line.expandtabs()
            if stripspace is None and re.search(r"^[ \t]*[^# \t]", line):
                stripspace = re.match(r"^([ \t]*)", line).group(1)
            lines.append(_indent_line(line, stripspace))
    return "\n".join(lines)
