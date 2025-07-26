from grpc._channel import _MultiThreadedRendezvous
from pinecone.exceptions import PineconeException


class PineconeGrpcFuture:
    def __init__(self, delegate):
        self._delegate = delegate

    def cancel(self):
        return self._delegate.cancel()

    def cancelled(self):
        return self._delegate.cancelled()

    def running(self):
        return self._delegate.running()

    def done(self):
        return self._delegate.done()

    def add_done_callback(self, fun):
        return self._delegate.add_done_callback(fun)

    def result(self, timeout=None):
        try:
            return self._delegate.result(timeout=timeout)
        except _MultiThreadedRendezvous as e:
            raise PineconeException(e._state.debug_error_string) from e

    def exception(self, timeout=None):
        return self._delegate.exception(timeout=timeout)

    def traceback(self, timeout=None):
        return self._delegate.traceback(timeout=timeout)
