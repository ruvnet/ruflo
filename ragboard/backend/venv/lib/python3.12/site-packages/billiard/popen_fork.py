import os
import sys
import errno

from .common import TERM_SIGNAL

__all__ = ['Popen']

#
# Start child process using fork
#


class Popen:
    method = 'fork'
    sentinel = None

    def __init__(self, process_obj):
        sys.stdout.flush()
        sys.stderr.flush()
        self.returncode = None
        self._launch(process_obj)

    def duplicate_for_child(self, fd):
        return fd

    def poll(self, flag=os.WNOHANG):
        if self.returncode is None:
            while True:
                try:
                    pid, sts = os.waitpid(self.pid, flag)
                except OSError as e:
                    if e.errno == errno.EINTR:
                        continue
                    # Child process not yet created. See #1731717
                    # e.errno == errno.ECHILD == 10
                    return None
                else:
                    break
            if pid == self.pid:
                if os.WIFSIGNALED(sts):
                    self.returncode = -os.WTERMSIG(sts)
                else:
                    assert os.WIFEXITED(sts)
                    self.returncode = os.WEXITSTATUS(sts)
        return self.returncode

    def wait(self, timeout=None):
        if self.returncode is None:
            if timeout is not None:
                from .connection import wait
                if not wait([self.sentinel], timeout):
                    return None
            # This shouldn't block if wait() returned successfully.
            return self.poll(os.WNOHANG if timeout == 0.0 else 0)
        return self.returncode

    def terminate(self):
        if self.returncode is None:
            try:
                os.kill(self.pid, TERM_SIGNAL)
            except OSError as exc:
                if getattr(exc, 'errno', None) != errno.ESRCH:
                    if self.wait(timeout=0.1) is None:
                        raise

    def _launch(self, process_obj):
        code = 1
        parent_r, child_w = os.pipe()
        self.pid = os.fork()
        if self.pid == 0:
            try:
                os.close(parent_r)
                if 'random' in sys.modules:
                    import random
                    random.seed()
                code = process_obj._bootstrap()
            finally:
                os._exit(code)
        else:
            os.close(child_w)
            self.sentinel = parent_r

    def close(self):
        if self.sentinel is not None:
            try:
                os.close(self.sentinel)
            finally:
                self.sentinel = None
