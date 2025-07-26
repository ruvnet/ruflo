import io
import os

from . import reduction
from . import context
from . import forkserver
from . import popen_fork
from . import spawn

__all__ = ['Popen']

#
# Wrapper for an fd used while launching a process
#


class _DupFd:

    def __init__(self, ind):
        self.ind = ind

    def detach(self):
        return forkserver.get_inherited_fds()[self.ind]

#
# Start child process using a server process
#


class Popen(popen_fork.Popen):
    method = 'forkserver'
    DupFd = _DupFd

    def __init__(self, process_obj):
        self._fds = []
        super().__init__(process_obj)

    def duplicate_for_child(self, fd):
        self._fds.append(fd)
        return len(self._fds) - 1

    def _launch(self, process_obj):
        prep_data = spawn.get_preparation_data(process_obj._name)
        buf = io.BytesIO()
        context.set_spawning_popen(self)
        try:
            reduction.dump(prep_data, buf)
            reduction.dump(process_obj, buf)
        finally:
            context.set_spawning_popen(None)

        self.sentinel, w = forkserver.connect_to_new_process(self._fds)
        with io.open(w, 'wb', closefd=True) as f:
            f.write(buf.getbuffer())
        self.pid = forkserver.read_unsigned(self.sentinel)

    def poll(self, flag=os.WNOHANG):
        if self.returncode is None:
            from .connection import wait
            timeout = 0 if flag == os.WNOHANG else None
            if not wait([self.sentinel], timeout):
                return None
            try:
                self.returncode = forkserver.read_unsigned(self.sentinel)
            except (OSError, EOFError):
                # The process ended abnormally perhaps because of a signal
                self.returncode = 255
        return self.returncode
