"""
Tests which scan for certain occurrences in the code, they may not find
all of these occurrences but should catch almost all. This file was adapted
from NumPy.
"""


import os
from pathlib import Path
import ast
import tokenize

import scipy

import pytest


class ParseCall(ast.NodeVisitor):
    def __init__(self):
        self.ls = []

    def visit_Attribute(self, node):
        ast.NodeVisitor.generic_visit(self, node)
        self.ls.append(node.attr)

    def visit_Name(self, node):
        self.ls.append(node.id)


class FindFuncs(ast.NodeVisitor):
    def __init__(self, filename):
        super().__init__()
        self.__filename = filename
        self.bad_filters = []
        self.bad_stacklevels = []

    def visit_Call(self, node):
        p = ParseCall()
        p.visit(node.func)
        ast.NodeVisitor.generic_visit(self, node)

        if p.ls[-1] == 'simplefilter' or p.ls[-1] == 'filterwarnings':
            # get first argument of the `args` node of the filter call
            match node.args[0]:
                case ast.Constant() as c:
                    argtext = c.value
                case ast.JoinedStr() as js:
                    # if we get an f-string, discard the templated pieces, which
                    # are likely the type or specific message; we're interested
                    # in the action, which is less likely to use a template
                    argtext = "".join(
                        x.value for x in js.values if isinstance(x, ast.Constant)
                    )
                case _:
                    raise ValueError("unknown ast node type")
            # check if filter is set to ignore
            if argtext == "ignore":
                self.bad_filters.append(
                    f"{self.__filename}:{node.lineno}")

        if p.ls[-1] == 'warn' and (
                len(p.ls) == 1 or p.ls[-2] == 'warnings'):

            if self.__filename == "_lib/tests/test_warnings.py":
                # This file
                return

            # See if stacklevel exists:
            if len(node.args) == 3:
                return
            args = {kw.arg for kw in node.keywords}
            if "stacklevel" not in args:
                self.bad_stacklevels.append(
                    f"{self.__filename}:{node.lineno}")


@pytest.fixture(scope="session")
def warning_calls():
    # combined "ignore" and stacklevel error
    base = Path(scipy.__file__).parent

    bad_filters = []
    bad_stacklevels = []

    for path in base.rglob("*.py"):
        # use tokenize to auto-detect encoding on systems where no
        # default encoding is defined (e.g., LANG='C')
        with tokenize.open(str(path)) as file:
            tree = ast.parse(file.read(), filename=str(path))
            finder = FindFuncs(path.relative_to(base))
            finder.visit(tree)
            bad_filters.extend(finder.bad_filters)
            bad_stacklevels.extend(finder.bad_stacklevels)

    return bad_filters, bad_stacklevels


@pytest.mark.fail_slow(40)
@pytest.mark.slow
def test_warning_calls_filters(warning_calls):
    bad_filters, bad_stacklevels = warning_calls

    # We try not to add filters in the code base, because those filters aren't
    # thread-safe. We aim to only filter in tests with
    # np.testing.suppress_warnings. However, in some cases it may prove
    # necessary to filter out warnings, because we can't (easily) fix the root
    # cause for them and we don't want users to see some warnings when they use
    # SciPy correctly. So we list exceptions here.  Add new entries only if
    # there's a good reason.
    allowed_filters = (
        os.path.join('datasets', '_fetchers.py'),
        os.path.join('datasets', '__init__.py'),
        os.path.join('optimize', '_optimize.py'),
        os.path.join('optimize', '_constraints.py'),
        os.path.join('optimize', '_nnls.py'),
        os.path.join('signal', '_ltisys.py'),
        os.path.join('sparse', '__init__.py'),  # np.matrix pending-deprecation
        os.path.join('special', '_basic.py'),  # gh-21801
        os.path.join('stats', '_discrete_distns.py'),  # gh-14901
        os.path.join('stats', '_continuous_distns.py'),
        os.path.join('stats', '_binned_statistic.py'),  # gh-19345
        os.path.join('stats', '_stats_py.py'),  # gh-20743
        os.path.join('stats', 'tests', 'test_axis_nan_policy.py'),  # gh-20694
        os.path.join('_lib', '_util.py'),  # gh-19341
        os.path.join('sparse', 'linalg', '_dsolve', 'linsolve.py'),  # gh-17924
        "conftest.py",
    )
    bad_filters = [item for item in bad_filters if item.split(':')[0] not in
                   allowed_filters]

    if bad_filters:
        raise AssertionError(
            "warning ignore filter should not be used, instead, use\n"
            "numpy.testing.suppress_warnings (in tests only);\n"
            "found in:\n    {}".format(
                "\n    ".join(bad_filters)))

