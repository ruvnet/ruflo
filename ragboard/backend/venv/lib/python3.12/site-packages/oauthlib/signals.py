"""
    Implements signals based on blinker if available, otherwise
    falls silently back to a noop. Shamelessly stolen from flask.signals:
    https://github.com/mitsuhiko/flask/blob/master/flask/signals.py
"""
signals_available = False
try:
    from blinker import Namespace
    signals_available = True
except ImportError:
    class Namespace:
        def signal(self, name, doc=None):
            return _FakeSignal(name, doc)

    class _FakeSignal:
        """If blinker is unavailable, create a fake class with the same
        interface that allows sending of signals but will fail with an
        error on anything else.  Instead of doing anything on send, it
        will just ignore the arguments and do nothing instead.
        """

        def __init__(self, name, doc=None):
            self.name = name
            self.__doc__ = doc
        def _fail(self, *args, **kwargs):
            raise RuntimeError('signalling support is unavailable '
                               'because the blinker library is '
                               'not installed.')
        def send(*a, **kw):
            return None
        connect = disconnect = has_receivers_for = receivers_for = \
            temporarily_connected_to = connected_to = _fail
        del _fail

# The namespace for code signals.  If you are not oauthlib code, do
# not put signals in here.  Create your own namespace instead.
_signals = Namespace()


# Core signals.
scope_changed = _signals.signal('scope-changed')
