import io
import os

from . import context
from . import popen_fork
from . import reduction
from . import spawn

from .compat import spawnv_passfds

__all__ = ['Popen']


#
# Wrapper for an fd used while launching a process
#

class _DupFd:

    def __init__(self, fd):
        self.fd = fd

    def detach(self):
        return self.fd

#
# Start child process using a fresh interpreter
#


class Popen(popen_fork.Popen):
    method = 'spawn'
    DupFd = _DupFd

    def __init__(self, process_obj):
        self._fds = []
        super().__init__(process_obj)

    def duplicate_for_child(self, fd):
        self._fds.append(fd)
        return fd

    def _launch(self, process_obj):
        os.environ["MULTIPROCESSING_FORKING_DISABLE"] = "1"
        spawn._Django_old_layout_hack__save()
        from . import semaphore_tracker
        tracker_fd = semaphore_tracker.getfd()
        self._fds.append(tracker_fd)
        prep_data = spawn.get_preparation_data(process_obj._name)
        fp = io.BytesIO()
        context.set_spawning_popen(self)
        try:
            reduction.dump(prep_data, fp)
            reduction.dump(process_obj, fp)
        finally:
            context.set_spawning_popen(None)

        parent_r = child_w = child_r = parent_w = None
        try:
            parent_r, child_w = os.pipe()
            child_r, parent_w = os.pipe()
            cmd = spawn.get_command_line(tracker_fd=tracker_fd,
                                         pipe_handle=child_r)
            self._fds.extend([child_r, child_w])
            self.pid = spawnv_passfds(
                spawn.get_executable(), cmd, self._fds,
            )
            self.sentinel = parent_r
            with io.open(parent_w, 'wb', closefd=False) as f:
                f.write(fp.getvalue())
        finally:
            for fd in (child_r, child_w, parent_w):
                if fd is not None:
                    os.close(fd)
