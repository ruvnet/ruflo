import sys
import traceback

__all__ = ['ExceptionInfo', 'Traceback']

DEFAULT_MAX_FRAMES = sys.getrecursionlimit() // 8


class _Code:

    def __init__(self, code):
        self.co_filename = code.co_filename
        self.co_name = code.co_name
        self.co_argcount = code.co_argcount
        self.co_cellvars = ()
        self.co_firstlineno = code.co_firstlineno
        self.co_flags = code.co_flags
        self.co_freevars = ()
        self.co_code = b''
        self.co_lnotab = b''
        self.co_names = code.co_names
        self.co_nlocals = code.co_nlocals
        self.co_stacksize = code.co_stacksize
        self.co_varnames = ()
        if sys.version_info >= (3, 11):
            self._co_positions = list(code.co_positions())

    if sys.version_info >= (3, 11):
        @property
        def co_positions(self):
            return self._co_positions.__iter__


class _Frame:
    Code = _Code

    def __init__(self, frame):
        self.f_builtins = {}
        self.f_globals = {
            "__file__": frame.f_globals.get("__file__", "__main__"),
            "__name__": frame.f_globals.get("__name__"),
            "__loader__": None,
        }
        self.f_locals = fl = {}
        try:
            fl["__traceback_hide__"] = frame.f_locals["__traceback_hide__"]
        except KeyError:
            pass
        self.f_back = None
        self.f_trace = None
        self.f_exc_traceback = None
        self.f_exc_type = None
        self.f_exc_value = None
        self.f_code = self.Code(frame.f_code)
        self.f_lineno = frame.f_lineno
        self.f_lasti = frame.f_lasti
        # don't want to hit https://bugs.python.org/issue21967
        self.f_restricted = False

    if sys.version_info >= (3, 11):
        @property
        def co_positions(self):
            return self.f_code.co_positions


class _Object:

    def __init__(self, **kw):
        [setattr(self, k, v) for k, v in kw.items()]

    if sys.version_info >= (3, 11):
        __default_co_positions__ = ((None, None, None, None),)

        @property
        def co_positions(self):
            return getattr(
                self,
                "_co_positions",
                self.__default_co_positions__
            ).__iter__

        @co_positions.setter
        def co_positions(self, value):
            self._co_positions = value  # noqa


class _Truncated:

    def __init__(self):
        self.tb_lineno = -1
        self.tb_frame = _Object(
            f_globals={"__file__": "",
                       "__name__": "",
                       "__loader__": None},
            f_fileno=None,
            f_code=_Object(co_filename="...",
                           co_name="[rest of traceback truncated]"),
        )
        self.tb_next = None
        self.tb_lasti = 0

    if sys.version_info >= (3, 11):
        @property
        def co_positions(self):
            return self.tb_frame.co_positions


class Traceback:
    Frame = _Frame

    def __init__(self, tb, max_frames=DEFAULT_MAX_FRAMES, depth=0):
        self.tb_frame = self.Frame(tb.tb_frame)
        self.tb_lineno = tb.tb_lineno
        self.tb_lasti = tb.tb_lasti
        self.tb_next = None
        if tb.tb_next is not None:
            if depth <= max_frames:
                self.tb_next = Traceback(tb.tb_next, max_frames, depth + 1)
            else:
                self.tb_next = _Truncated()


class RemoteTraceback(Exception):
    def __init__(self, tb):
        self.tb = tb

    def __str__(self):
        return self.tb


class ExceptionWithTraceback(Exception):
    def __init__(self, exc, tb):
        self.exc = exc
        self.tb = '\n"""\n%s"""' % tb
        super().__init__()

    def __str__(self):
        return self.tb

    def __reduce__(self):
        return rebuild_exc, (self.exc, self.tb)


def rebuild_exc(exc, tb):
    exc.__cause__ = RemoteTraceback(tb)
    return exc


class ExceptionInfo:
    """Exception wrapping an exception and its traceback.

    :param exc_info: The exception info tuple as returned by
        :func:`sys.exc_info`.

    """

    #: Exception type.
    type = None

    #: Exception instance.
    exception = None

    #: Pickleable traceback instance for use with :mod:`traceback`
    tb = None

    #: String representation of the traceback.
    traceback = None

    #: Set to true if this is an internal error.
    internal = False

    def __init__(self, exc_info=None, internal=False):
        self.type, exception, tb = exc_info or sys.exc_info()
        try:
            self.tb = Traceback(tb)
            self.traceback = ''.join(
                traceback.format_exception(self.type, exception, tb),
            )
            self.internal = internal
        finally:
            del tb
        self.exception = ExceptionWithTraceback(exception, self.traceback)

    def __str__(self):
        return self.traceback

    def __repr__(self):
        return "<%s: %r>" % (self.__class__.__name__, self.exception, )

    @property
    def exc_info(self):
        return self.type, self.exception, self.tb
