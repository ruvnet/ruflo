import contextlib
import re
import sys


def eq_(a, b, msg=None):
    """Assert a == b, with repr messaging on failure."""
    assert a == b, msg or "%r != %r" % (a, b)


def ne_(a, b, msg=None):
    """Assert a != b, with repr messaging on failure."""
    assert a != b, msg or "%r == %r" % (a, b)


def in_(a, b, msg=None):
    """Assert a in b, with repr messaging on failure."""
    assert a in b, msg or "%r not in %r" % (a, b)


def not_in(a, b, msg=None):
    """Assert a in not b, with repr messaging on failure."""
    assert a not in b, msg or "%r is in %r" % (a, b)


def _assert_proper_exception_context(exception):
    """assert that any exception we're catching does not have a __context__
    without a __cause__, and that __suppress_context__ is never set.

    Python 3 will report nested as exceptions as "during the handling of
    error X, error Y occurred". That's not what we want to do. We want
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


def _assert_proper_cause_cls(exception, cause_cls):
    """assert that any exception we're catching does not have a __context__
    without a __cause__, and that __suppress_context__ is never set.

    Python 3 will report nested as exceptions as "during the handling of
    error X, error Y occurred". That's not what we want to do. We want
    these exceptions in a cause chain.

    """
    assert isinstance(exception.__cause__, cause_cls), (
        "Exception %r was correctly raised but has cause %r, which does not "
        "have the expected cause type %r."
        % (exception, exception.__cause__, cause_cls)
    )


def assert_raises(except_cls, callable_, *args, **kw):
    return _assert_raises(except_cls, callable_, args, kw)


def assert_raises_with_proper_context(except_cls, callable_, *args, **kw):
    return _assert_raises(except_cls, callable_, args, kw, check_context=True)


def assert_raises_with_given_cause(
    except_cls, cause_cls, callable_, *args, **kw
):
    return _assert_raises(except_cls, callable_, args, kw, cause_cls=cause_cls)


def assert_raises_message(except_cls, msg, callable_, *args, **kwargs):
    return _assert_raises(except_cls, callable_, args, kwargs, msg=msg)


def assert_raises_message_with_proper_context(
    except_cls, msg, callable_, *args, **kwargs
):
    return _assert_raises(
        except_cls, callable_, args, kwargs, msg=msg, check_context=True
    )


def assert_raises_message_with_given_cause(
    except_cls, msg, cause_cls, callable_, *args, **kwargs
):
    return _assert_raises(
        except_cls, callable_, args, kwargs, msg=msg, cause_cls=cause_cls
    )


def _assert_raises(
    except_cls,
    callable_,
    args,
    kwargs,
    msg=None,
    check_context=False,
    cause_cls=None,
):
    with _expect_raises(except_cls, msg, check_context, cause_cls) as ec:
        callable_(*args, **kwargs)
    return ec.error


class _ErrorContainer:
    error = None


@contextlib.contextmanager
def _expect_raises(except_cls, msg=None, check_context=False, cause_cls=None):
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
            # I'm often pdbing here, and "err" above isn't
            # in scope, so assign the string explicitly
            error_as_string = str(err)
            assert re.search(msg, error_as_string, re.UNICODE), "%r !~ %s" % (
                msg,
                error_as_string,
            )
        if cause_cls is not None:
            _assert_proper_cause_cls(err, cause_cls)
        if check_context and not are_we_already_in_a_traceback:
            _assert_proper_exception_context(err)
        print(str(err).encode("utf-8"))

    # it's generally a good idea to not carry traceback objects outside
    # of the except: block, but in this case especially we seem to have
    # hit some bug in either python 3.10.0b2 or greenlet or both which
    # this seems to fix:
    # https://github.com/python-greenlet/greenlet/issues/242
    del ec

    # assert outside the block so it works for AssertionError too !
    assert success, "Callable did not raise an exception"


def expect_raises(except_cls, check_context=False):
    return _expect_raises(except_cls, check_context=check_context)


def expect_raises_message(except_cls, msg, check_context=False):
    return _expect_raises(except_cls, msg=msg, check_context=check_context)


def expect_raises_with_proper_context(except_cls, check_context=True):
    return _expect_raises(except_cls, check_context=check_context)


def expect_raises_message_with_proper_context(
    except_cls, msg, check_context=True
):
    return _expect_raises(except_cls, msg=msg, check_context=check_context)
