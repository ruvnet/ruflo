"""Implementation of the Observer pattern."""
import sys
import threading
import warnings
import weakref
from weakref import WeakMethod

from kombu.utils.functional import retry_over_time

from celery.exceptions import CDeprecationWarning
from celery.local import PromiseProxy, Proxy
from celery.utils.functional import fun_accepts_kwargs
from celery.utils.log import get_logger
from celery.utils.time import humanize_seconds

__all__ = ('Signal',)

logger = get_logger(__name__)


def _make_id(target):  # pragma: no cover
    if isinstance(target, Proxy):
        target = target._get_current_object()
    if isinstance(target, (bytes, str)):
        # see Issue #2475
        return target
    if hasattr(target, '__func__'):
        return id(target.__func__)
    return id(target)


def _boundmethod_safe_weakref(obj):
    """Get weakref constructor appropriate for `obj`.  `obj` may be a bound method.

    Bound method objects must be special-cased because they're usually garbage
    collected immediately, even if the instance they're bound to persists.

    Returns:
        a (weakref constructor, main object) tuple. `weakref constructor` is
        either :class:`weakref.ref` or :class:`weakref.WeakMethod`.  `main
        object` is the instance that `obj` is bound to if it is a bound method;
        otherwise `main object` is simply `obj.
    """
    try:
        obj.__func__
        obj.__self__
        # Bound method
        return WeakMethod, obj.__self__
    except AttributeError:
        # Not a bound method
        return weakref.ref, obj


def _make_lookup_key(receiver, sender, dispatch_uid):
    if dispatch_uid:
        return (dispatch_uid, _make_id(sender))
    else:
        return (_make_id(receiver), _make_id(sender))


NONE_ID = _make_id(None)

NO_RECEIVERS = object()

RECEIVER_RETRY_ERROR = """\
Could not process signal receiver %(receiver)s. Retrying %(when)s...\
"""


class Signal:  # pragma: no cover
    """Create new signal.

    Keyword Arguments:
        providing_args (List): A list of the arguments this signal can pass
            along in a :meth:`send` call.
        use_caching (bool): Enable receiver cache.
        name (str): Name of signal, used for debugging purposes.
    """

    #: Holds a dictionary of
    #: ``{receiverkey (id): weakref(receiver)}`` mappings.
    receivers = None

    def __init__(self, providing_args=None, use_caching=False, name=None):
        self.receivers = []
        self.providing_args = set(
            providing_args if providing_args is not None else [])
        self.lock = threading.Lock()
        self.use_caching = use_caching
        self.name = name
        # For convenience we create empty caches even if they are not used.
        # A note about caching: if use_caching is defined, then for each
        # distinct sender we cache the receivers that sender has in
        # 'sender_receivers_cache'.  The cache is cleaned when .connect() or
        # .disconnect() is called and populated on .send().
        self.sender_receivers_cache = (
            weakref.WeakKeyDictionary() if use_caching else {}
        )
        self._dead_receivers = False

    def _connect_proxy(self, fun, sender, weak, dispatch_uid):
        return self.connect(
            fun, sender=sender._get_current_object(),
            weak=weak, dispatch_uid=dispatch_uid,
        )

    def connect(self, *args, **kwargs):
        """Connect receiver to sender for signal.

        Arguments:
            receiver (Callable): A function or an instance method which is to
                receive signals.  Receivers must be hashable objects.

                if weak is :const:`True`, then receiver must be
                weak-referenceable.

                Receivers must be able to accept keyword arguments.

                If receivers have a `dispatch_uid` attribute, the receiver will
                not be added if another receiver already exists with that
                `dispatch_uid`.

            sender (Any): The sender to which the receiver should respond.
                Must either be a Python object, or :const:`None` to
                receive events from any sender.

            weak (bool): Whether to use weak references to the receiver.
                By default, the module will attempt to use weak references to
                the receiver objects.  If this parameter is false, then strong
                references will be used.

            dispatch_uid (Hashable): An identifier used to uniquely identify a
                particular instance of a receiver.  This will usually be a
                string, though it may be anything hashable.

            retry (bool): If the signal receiver raises an exception
                (e.g. ConnectionError), the receiver will be retried until it
                runs successfully. A strong ref to the receiver will be stored
                and the `weak` option will be ignored.
        """
        def _handle_options(sender=None, weak=True, dispatch_uid=None,
                            retry=False):

            def _connect_signal(fun):

                options = {'dispatch_uid': dispatch_uid,
                           'weak': weak}

                def _retry_receiver(retry_fun):

                    def _try_receiver_over_time(*args, **kwargs):
                        def on_error(exc, intervals, retries):
                            interval = next(intervals)
                            err_msg = RECEIVER_RETRY_ERROR % \
                                {'receiver': retry_fun,
                                 'when': humanize_seconds(interval, 'in', ' ')}
                            logger.error(err_msg)
                            return interval

                        return retry_over_time(retry_fun, Exception, args,
                                               kwargs, on_error)

                    return _try_receiver_over_time

                if retry:
                    options['weak'] = False
                    if not dispatch_uid:
                        # if there's no dispatch_uid then we need to set the
                        # dispatch uid to the original func id so we can look
                        # it up later with the original func id
                        options['dispatch_uid'] = _make_id(fun)
                    fun = _retry_receiver(fun)

                self._connect_signal(fun, sender, options['weak'],
                                     options['dispatch_uid'])
                return fun

            return _connect_signal

        if args and callable(args[0]):
            return _handle_options(*args[1:], **kwargs)(args[0])
        return _handle_options(*args, **kwargs)

    def _connect_signal(self, receiver, sender, weak, dispatch_uid):
        assert callable(receiver), 'Signal receivers must be callable'
        if not fun_accepts_kwargs(receiver):
            raise ValueError(
                'Signal receiver must accept keyword arguments.')

        if isinstance(sender, PromiseProxy):
            sender.__then__(
                self._connect_proxy, receiver, sender, weak, dispatch_uid,
            )
            return receiver

        lookup_key = _make_lookup_key(receiver, sender, dispatch_uid)

        if weak:
            ref, receiver_object = _boundmethod_safe_weakref(receiver)
            receiver = ref(receiver)
            weakref.finalize(receiver_object, self._remove_receiver)

        with self.lock:
            self._clear_dead_receivers()
            for r_key, _ in self.receivers:
                if r_key == lookup_key:
                    break
            else:
                self.receivers.append((lookup_key, receiver))
            self.sender_receivers_cache.clear()

        return receiver

    def disconnect(self, receiver=None, sender=None, weak=None,
                   dispatch_uid=None):
        """Disconnect receiver from sender for signal.

        If weak references are used, disconnect needn't be called.
        The receiver will be removed from dispatch automatically.

        Arguments:
            receiver (Callable): The registered receiver to disconnect.
                May be none if `dispatch_uid` is specified.

            sender (Any): The registered sender to disconnect.

            weak (bool): The weakref state to disconnect.

            dispatch_uid (Hashable): The unique identifier of the receiver
                to disconnect.
        """
        if weak is not None:
            warnings.warn(
                'Passing `weak` to disconnect has no effect.',
                CDeprecationWarning, stacklevel=2)

        lookup_key = _make_lookup_key(receiver, sender, dispatch_uid)

        disconnected = False
        with self.lock:
            self._clear_dead_receivers()
            for index in range(len(self.receivers)):
                (r_key, _) = self.receivers[index]
                if r_key == lookup_key:
                    disconnected = True
                    del self.receivers[index]
                    break
            self.sender_receivers_cache.clear()
        return disconnected

    def has_listeners(self, sender=None):
        return bool(self._live_receivers(sender))

    def send(self, sender, **named):
        """Send signal from sender to all connected receivers.

        If any receiver raises an error, the exception is returned as the
        corresponding response. (This is different from the "send" in
        Django signals. In Celery "send" and "send_robust" do the same thing.)

        Arguments:
            sender (Any): The sender of the signal.
                Either a specific object or :const:`None`.
            **named (Any): Named arguments which will be passed to receivers.

        Returns:
            List: of tuple pairs: `[(receiver, response), … ]`.
        """
        responses = []
        if not self.receivers or \
                self.sender_receivers_cache.get(sender) is NO_RECEIVERS:
            return responses

        for receiver in self._live_receivers(sender):
            try:
                response = receiver(signal=self, sender=sender, **named)
            except Exception as exc:  # pylint: disable=broad-except
                if not hasattr(exc, '__traceback__'):
                    exc.__traceback__ = sys.exc_info()[2]
                logger.exception(
                    'Signal handler %r raised: %r', receiver, exc)
                responses.append((receiver, exc))
            else:
                responses.append((receiver, response))
        return responses
    send_robust = send  # Compat with Django interface.

    def _clear_dead_receivers(self):
        # Warning: caller is assumed to hold self.lock
        if self._dead_receivers:
            self._dead_receivers = False
            new_receivers = []
            for r in self.receivers:
                if isinstance(r[1], weakref.ReferenceType) and r[1]() is None:
                    continue
                new_receivers.append(r)
            self.receivers = new_receivers

    def _live_receivers(self, sender):
        """Filter sequence of receivers to get resolved, live receivers.

        This checks for weak references and resolves them, then returning only
        live receivers.
        """
        receivers = None
        if self.use_caching and not self._dead_receivers:
            receivers = self.sender_receivers_cache.get(sender)
            # We could end up here with NO_RECEIVERS even if we do check this
            # case in .send() prior to calling _Live_receivers()  due to
            # concurrent .send() call.
            if receivers is NO_RECEIVERS:
                return []
        if receivers is None:
            with self.lock:
                self._clear_dead_receivers()
                senderkey = _make_id(sender)
                receivers = []
                for (receiverkey, r_senderkey), receiver in self.receivers:
                    if r_senderkey == NONE_ID or r_senderkey == senderkey:
                        receivers.append(receiver)
                if self.use_caching:
                    if not receivers:
                        self.sender_receivers_cache[sender] = NO_RECEIVERS
                    else:
                        # Note: we must cache the weakref versions.
                        self.sender_receivers_cache[sender] = receivers
        non_weak_receivers = []
        for receiver in receivers:
            if isinstance(receiver, weakref.ReferenceType):
                # Dereference the weak reference.
                receiver = receiver()
                if receiver is not None:
                    non_weak_receivers.append(receiver)
            else:
                non_weak_receivers.append(receiver)
        return non_weak_receivers

    def _remove_receiver(self, receiver=None):
        """Remove dead receivers from connections."""
        # Mark that the self..receivers first has dead weakrefs. If so,
        # we will clean those up in connect, disconnect and _live_receivers
        # while holding self.lock.  Note that doing the cleanup here isn't a
        # good idea, _remove_receiver() will be called as a side effect of
        # garbage collection, and so the call can happen wh ile we are already
        # holding self.lock.
        self._dead_receivers = True

    def __repr__(self):
        """``repr(signal)``."""
        return f'<{type(self).__name__}: {self.name} providing_args={self.providing_args!r}>'

    def __str__(self):
        """``str(signal)``."""
        return repr(self)
