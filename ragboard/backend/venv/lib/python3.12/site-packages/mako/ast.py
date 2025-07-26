# mako/ast.py
# Copyright 2006-2025 the Mako authors and contributors <see AUTHORS file>
#
# This module is part of Mako and is released under
# the MIT License: http://www.opensource.org/licenses/mit-license.php

"""utilities for analyzing expressions and blocks of Python
code, as well as generating Python from AST nodes"""

import re

from mako import exceptions
from mako import pyparser


class PythonCode:

    """represents information about a string containing Python code"""

    def __init__(self, code, **exception_kwargs):
        self.code = code

        # represents all identifiers which are assigned to at some point in
        # the code
        self.declared_identifiers = set()

        # represents all identifiers which are referenced before their
        # assignment, if any
        self.undeclared_identifiers = set()

        # note that an identifier can be in both the undeclared and declared
        # lists.

        # using AST to parse instead of using code.co_varnames,
        # code.co_names has several advantages:
        # - we can locate an identifier as "undeclared" even if
        # its declared later in the same block of code
        # - AST is less likely to break with version changes
        # (for example, the behavior of co_names changed a little bit
        # in python version 2.5)
        if isinstance(code, str):
            expr = pyparser.parse(code.lstrip(), "exec", **exception_kwargs)
        else:
            expr = code

        f = pyparser.FindIdentifiers(self, **exception_kwargs)
        f.visit(expr)


class ArgumentList:

    """parses a fragment of code as a comma-separated list of expressions"""

    def __init__(self, code, **exception_kwargs):
        self.codeargs = []
        self.args = []
        self.declared_identifiers = set()
        self.undeclared_identifiers = set()
        if isinstance(code, str):
            if re.match(r"\S", code) and not re.match(r",\s*$", code):
                # if theres text and no trailing comma, insure its parsed
                # as a tuple by adding a trailing comma
                code += ","
            expr = pyparser.parse(code, "exec", **exception_kwargs)
        else:
            expr = code

        f = pyparser.FindTuple(self, PythonCode, **exception_kwargs)
        f.visit(expr)


class PythonFragment(PythonCode):

    """extends PythonCode to provide identifier lookups in partial control
    statements

    e.g.::

        for x in 5:
        elif y==9:
        except (MyException, e):

    """

    def __init__(self, code, **exception_kwargs):
        m = re.match(r"^(\w+)(?:\s+(.*?))?:\s*(#|$)", code.strip(), re.S)
        if not m:
            raise exceptions.CompileException(
                "Fragment '%s' is not a partial control statement" % code,
                **exception_kwargs,
            )
        if m.group(3):
            code = code[: m.start(3)]
        (keyword, expr) = m.group(1, 2)
        if keyword in ["for", "if", "while"]:
            code = code + "pass"
        elif keyword == "try":
            code = code + "pass\nexcept:pass"
        elif keyword in ["elif", "else"]:
            code = "if False:pass\n" + code + "pass"
        elif keyword == "except":
            code = "try:pass\n" + code + "pass"
        elif keyword == "with":
            code = code + "pass"
        else:
            raise exceptions.CompileException(
                "Unsupported control keyword: '%s'" % keyword,
                **exception_kwargs,
            )
        super().__init__(code, **exception_kwargs)


class FunctionDecl:

    """function declaration"""

    def __init__(self, code, allow_kwargs=True, **exception_kwargs):
        self.code = code
        expr = pyparser.parse(code, "exec", **exception_kwargs)

        f = pyparser.ParseFunc(self, **exception_kwargs)
        f.visit(expr)
        if not hasattr(self, "funcname"):
            raise exceptions.CompileException(
                "Code '%s' is not a function declaration" % code,
                **exception_kwargs,
            )
        if not allow_kwargs and self.kwargs:
            raise exceptions.CompileException(
                "'**%s' keyword argument not allowed here"
                % self.kwargnames[-1],
                **exception_kwargs,
            )

    def get_argument_expressions(self, as_call=False):
        """Return the argument declarations of this FunctionDecl as a printable
        list.

        By default the return value is appropriate for writing in a ``def``;
        set `as_call` to true to build arguments to be passed to the function
        instead (assuming locals with the same names as the arguments exist).
        """

        namedecls = []

        # Build in reverse order, since defaults and slurpy args come last
        argnames = self.argnames[::-1]
        kwargnames = self.kwargnames[::-1]
        defaults = self.defaults[::-1]
        kwdefaults = self.kwdefaults[::-1]

        # Named arguments
        if self.kwargs:
            namedecls.append("**" + kwargnames.pop(0))

        for name in kwargnames:
            # Keyword-only arguments must always be used by name, so even if
            # this is a call, print out `foo=foo`
            if as_call:
                namedecls.append("%s=%s" % (name, name))
            elif kwdefaults:
                default = kwdefaults.pop(0)
                if default is None:
                    # The AST always gives kwargs a default, since you can do
                    # `def foo(*, a=1, b, c=3)`
                    namedecls.append(name)
                else:
                    namedecls.append(
                        "%s=%s"
                        % (name, pyparser.ExpressionGenerator(default).value())
                    )
            else:
                namedecls.append(name)

        # Positional arguments
        if self.varargs:
            namedecls.append("*" + argnames.pop(0))

        for name in argnames:
            if as_call or not defaults:
                namedecls.append(name)
            else:
                default = defaults.pop(0)
                namedecls.append(
                    "%s=%s"
                    % (name, pyparser.ExpressionGenerator(default).value())
                )

        namedecls.reverse()
        return namedecls

    @property
    def allargnames(self):
        return tuple(self.argnames) + tuple(self.kwargnames)


class FunctionArgs(FunctionDecl):

    """the argument portion of a function declaration"""

    def __init__(self, code, **kwargs):
        super().__init__("def ANON(%s):pass" % code, **kwargs)
