import io
import os
import msvcrt
import signal
import sys

from . import context
from . import spawn
from . import reduction

from .compat import _winapi

__all__ = ['Popen']

#
#
#

TERMINATE = 0x10000
WINEXE = (sys.platform == 'win32' and getattr(sys, 'frozen', False))
WINSERVICE = sys.executable.lower().endswith("pythonservice.exe")

#
# We define a Popen class similar to the one from subprocess, but
# whose constructor takes a process object as its argument.
#


if sys.platform == 'win32':
    try:
        from _winapi import CreateProcess, GetExitCodeProcess
        close_thread_handle = _winapi.CloseHandle
    except ImportError:  # Py2.7
        from _subprocess import CreateProcess, GetExitCodeProcess

        def close_thread_handle(handle):
            handle.Close()


class Popen:
    '''
    Start a subprocess to run the code of a process object
    '''
    method = 'spawn'
    sentinel = None

    def __init__(self, process_obj):
        os.environ["MULTIPROCESSING_FORKING_DISABLE"] = "1"
        spawn._Django_old_layout_hack__save()
        prep_data = spawn.get_preparation_data(process_obj._name)

        # read end of pipe will be "stolen" by the child process
        # -- see spawn_main() in spawn.py.
        rhandle, whandle = _winapi.CreatePipe(None, 0)
        wfd = msvcrt.open_osfhandle(whandle, 0)
        cmd = spawn.get_command_line(parent_pid=os.getpid(),
                                     pipe_handle=rhandle)
        cmd = ' '.join('"%s"' % x for x in cmd)

        with io.open(wfd, 'wb', closefd=True) as to_child:
            # start process
            try:
                hp, ht, pid, tid = CreateProcess(
                    spawn.get_executable(), cmd,
                    None, None, False, 0, None, None, None)
                close_thread_handle(ht)
            except:
                _winapi.CloseHandle(rhandle)
                raise

            # set attributes of self
            self.pid = pid
            self.returncode = None
            self._handle = hp
            self.sentinel = int(hp)

            # send information to child
            context.set_spawning_popen(self)
            try:
                reduction.dump(prep_data, to_child)
                reduction.dump(process_obj, to_child)
            finally:
                context.set_spawning_popen(None)

    def close(self):
        if self.sentinel is not None:
            try:
                _winapi.CloseHandle(self.sentinel)
            finally:
                self.sentinel = None

    def duplicate_for_child(self, handle):
        assert self is context.get_spawning_popen()
        return reduction.duplicate(handle, self.sentinel)

    def wait(self, timeout=None):
        if self.returncode is None:
            if timeout is None:
                msecs = _winapi.INFINITE
            else:
                msecs = max(0, int(timeout * 1000 + 0.5))

            res = _winapi.WaitForSingleObject(int(self._handle), msecs)
            if res == _winapi.WAIT_OBJECT_0:
                code = GetExitCodeProcess(self._handle)
                if code == TERMINATE:
                    code = -signal.SIGTERM
                self.returncode = code

        return self.returncode

    def poll(self):
        return self.wait(timeout=0)

    def terminate(self):
        if self.returncode is None:
            try:
                _winapi.TerminateProcess(int(self._handle), TERMINATE)
            except OSError:
                if self.wait(timeout=1.0) is None:
                    raise
