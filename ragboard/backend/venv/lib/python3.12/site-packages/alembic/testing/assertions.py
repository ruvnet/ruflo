from __future__ import annotations

import contextlib
import re
import sys
from typing import Any
from typing import Dict

from sqlalchemy import exc as sa_exc
from sqlalchemy.engine import default
from sqlalchemy.testing.assertions import _expect_warnings
from sqlalchemy.testing.assertions import eq_  # noqa
from sqlalchemy.testing.assertions import is_  # noqa
from sqlalchemy.testing.assertions import is_false  # noqa
from sqlalchemy.testing.assertions import is_not_  # noqa
from sqlalchemy.testing.assertions import is_true  # noqa
from sqlalchemy.testing.assertions import ne_  # noqa
from sqlalchemy.util import decorator

from ..util import sqla_compat


def _assert_proper_exception_context(exception):
    """assert that any exception we're catching does not have a __context__
    without a __cause__, and that __suppress_context__ is never set.

    Python 3 will report nested as exceptions as "during the handling of
    error X, error Y occurred". That's not what we want to do.  we want
    these exceptions in a cause chain.

    """

    if (
        exception.__context__ is not exception.__cause__
        and not exception.__suppress_context__
    ):
        assert False, (
            "Exception %r was correctly raised but did not set a cause, "
            "within context %r as its cause."
            % (exception, exception.__context__)
        )


def assert_raises(except_cls, callable_, *args, **kw):
    return _assert_raises(except_cls, callable_, args, kw, check_context=True)


def assert_raises_context_ok(except_cls, callable_, *args, **kw):
    return _assert_raises(except_cls, callable_, args, kw)


def assert_raises_message(except_cls, msg, callable_, *args, **kwargs):
    return _assert_raises(
        except_cls, callable_, args, kwargs, msg=msg, check_context=True
    )


def assert_raises_message_context_ok(
    except_cls, msg, callable_, *args, **kwargs
):
    return _assert_raises(except_cls, callable_, args, kwargs, msg=msg)


def _assert_raises(
    except_cls, callable_, args, kwargs, msg=None, check_context=False
):
    with _expect_raises(except_cls, msg, check_context) as ec:
        callable_(*args, **kwargs)
    return ec.error


class _ErrorContainer:
    error: Any = None


@contextlib.contextmanager
def _expect_raises(except_cls, msg=None, check_context=False):
    ec = _ErrorContainer()
    if check_context:
        are_we_already_in_a_traceback = sys.exc_info()[0]
    try:
        yield ec
        success = False
    except except_cls as err:
        ec.error = err
        success = True
        if msg is not None:
            assert re.search(msg, str(err), re.UNICODE), f"{msg} !~ {err}"
        if check_context and not are_we_already_in_a_traceback:
            _assert_proper_exception_context(err)
        print(str(err).encode("utf-8"))

    # assert outside the block so it works for AssertionError too !
    assert success, "Callable did not raise an exception"


def expect_raises(except_cls, check_context=True):
    return _expect_raises(except_cls, check_context=check_context)


def expect_raises_message(except_cls, msg, check_context=True):
    return _expect_raises(except_cls, msg=msg, check_context=check_context)


def eq_ignore_whitespace(a, b, msg=None):
    a = re.sub(r"^\s+?|\n", "", a)
    a = re.sub(r" {2,}", " ", a)
    b = re.sub(r"^\s+?|\n", "", b)
    b = re.sub(r" {2,}", " ", b)

    assert a == b, msg or "%r != %r" % (a, b)


_dialect_mods: Dict[Any, Any] = {}


def _get_dialect(name):
    if name is None or name == "default":
        return default.DefaultDialect()
    else:
        d = sqla_compat._create_url(name).get_dialect()()

        if name == "postgresql":
            d.implicit_returning = True
        elif name == "mssql":
            d.legacy_schema_aliasing = False
        return d


def expect_warnings(*messages, **kw):
    """Context manager which expects one or more warnings.

    With no arguments, squelches all SAWarnings emitted via
    sqlalchemy.util.warn and sqlalchemy.util.warn_limited.   Otherwise
    pass string expressions that will match selected warnings via regex;
    all non-matching warnings are sent through.

    The expect version **asserts** that the warnings were in fact seen.

    Note that the test suite sets SAWarning warnings to raise exceptions.

    """
    return _expect_warnings(Warning, messages, **kw)


def emits_python_deprecation_warning(*messages):
    """Decorator form of expect_warnings().

    Note that emits_warning does **not** assert that the warnings
    were in fact seen.

    """

    @decorator
    def decorate(fn, *args, **kw):
        with _expect_warnings(DeprecationWarning, assert_=False, *messages):
            return fn(*args, **kw)

    return decorate


def expect_sqlalchemy_deprecated(*messages, **kw):
    return _expect_warnings(sa_exc.SADeprecationWarning, messages, **kw)


def expect_sqlalchemy_deprecated_20(*messages, **kw):
    return _expect_warnings(sa_exc.RemovedIn20Warning, messages, **kw)
