import errno
import os
import selectors
import signal
import socket
import struct
import sys
import threading

from . import connection
from . import process
from . import reduction
from . import semaphore_tracker
from . import spawn
from . import util

from .compat import spawnv_passfds

__all__ = ['ensure_running', 'get_inherited_fds', 'connect_to_new_process',
           'set_forkserver_preload']

#
#
#

MAXFDS_TO_SEND = 256
UNSIGNED_STRUCT = struct.Struct('Q')     # large enough for pid_t

#
# Forkserver class
#


class ForkServer:

    def __init__(self):
        self._forkserver_address = None
        self._forkserver_alive_fd = None
        self._inherited_fds = None
        self._lock = threading.Lock()
        self._preload_modules = ['__main__']

    def set_forkserver_preload(self, modules_names):
        '''Set list of module names to try to load in forkserver process.'''
        if not all(type(mod) is str for mod in self._preload_modules):
            raise TypeError('module_names must be a list of strings')
        self._preload_modules = modules_names

    def get_inherited_fds(self):
        '''Return list of fds inherited from parent process.

        This returns None if the current process was not started by fork
        server.
        '''
        return self._inherited_fds

    def connect_to_new_process(self, fds):
        '''Request forkserver to create a child process.

        Returns a pair of fds (status_r, data_w).  The calling process can read
        the child process's pid and (eventually) its returncode from status_r.
        The calling process should write to data_w the pickled preparation and
        process data.
        '''
        self.ensure_running()
        if len(fds) + 4 >= MAXFDS_TO_SEND:
            raise ValueError('too many fds')
        with socket.socket(socket.AF_UNIX) as client:
            client.connect(self._forkserver_address)
            parent_r, child_w = os.pipe()
            child_r, parent_w = os.pipe()
            allfds = [child_r, child_w, self._forkserver_alive_fd,
                      semaphore_tracker.getfd()]
            allfds += fds
            try:
                reduction.sendfds(client, allfds)
                return parent_r, parent_w
            except:
                os.close(parent_r)
                os.close(parent_w)
                raise
            finally:
                os.close(child_r)
                os.close(child_w)

    def ensure_running(self):
        '''Make sure that a fork server is running.

        This can be called from any process.  Note that usually a child
        process will just reuse the forkserver started by its parent, so
        ensure_running() will do nothing.
        '''
        with self._lock:
            semaphore_tracker.ensure_running()
            if self._forkserver_alive_fd is not None:
                return

            cmd = ('from billiard.forkserver import main; ' +
                   'main(%d, %d, %r, **%r)')

            if self._preload_modules:
                desired_keys = {'main_path', 'sys_path'}
                data = spawn.get_preparation_data('ignore')
                data = {
                    x: y for (x, y) in data.items() if x in desired_keys
                }
            else:
                data = {}

            with socket.socket(socket.AF_UNIX) as listener:
                address = connection.arbitrary_address('AF_UNIX')
                listener.bind(address)
                os.chmod(address, 0o600)
                listener.listen()

                # all client processes own the write end of the "alive" pipe;
                # when they all terminate the read end becomes ready.
                alive_r, alive_w = os.pipe()
                try:
                    fds_to_pass = [listener.fileno(), alive_r]
                    cmd %= (listener.fileno(), alive_r, self._preload_modules,
                            data)
                    exe = spawn.get_executable()
                    args = [exe] + util._args_from_interpreter_flags()
                    args += ['-c', cmd]
                    spawnv_passfds(exe, args, fds_to_pass)
                except:
                    os.close(alive_w)
                    raise
                finally:
                    os.close(alive_r)
                self._forkserver_address = address
                self._forkserver_alive_fd = alive_w

#
#
#


def main(listener_fd, alive_r, preload, main_path=None, sys_path=None):
    '''Run forkserver.'''
    if preload:
        if '__main__' in preload and main_path is not None:
            process.current_process()._inheriting = True
            try:
                spawn.import_main_path(main_path)
            finally:
                del process.current_process()._inheriting
        for modname in preload:
            try:
                __import__(modname)
            except ImportError:
                pass

    # close sys.stdin
    if sys.stdin is not None:
        try:
            sys.stdin.close()
            sys.stdin = open(os.devnull)
        except (OSError, ValueError):
            pass

    # ignoring SIGCHLD means no need to reap zombie processes
    handler = signal.signal(signal.SIGCHLD, signal.SIG_IGN)
    with socket.socket(socket.AF_UNIX, fileno=listener_fd) as listener, \
            selectors.DefaultSelector() as selector:
        _forkserver._forkserver_address = listener.getsockname()
        selector.register(listener, selectors.EVENT_READ)
        selector.register(alive_r, selectors.EVENT_READ)

        while True:
            try:
                while True:
                    rfds = [key.fileobj for (key, events) in selector.select()]
                    if rfds:
                        break

                if alive_r in rfds:
                    # EOF because no more client processes left
                    assert os.read(alive_r, 1) == b''
                    raise SystemExit

                assert listener in rfds
                with listener.accept()[0] as s:
                    code = 1
                    if os.fork() == 0:
                        try:
                            _serve_one(s, listener, alive_r, handler)
                        except Exception:
                            sys.excepthook(*sys.exc_info())
                            sys.stderr.flush()
                        finally:
                            os._exit(code)
            except OSError as e:
                if e.errno != errno.ECONNABORTED:
                    raise


def __unpack_fds(child_r, child_w, alive, stfd, *inherited):
    return child_r, child_w, alive, stfd, inherited


def _serve_one(s, listener, alive_r, handler):
    # close unnecessary stuff and reset SIGCHLD handler
    listener.close()
    os.close(alive_r)
    signal.signal(signal.SIGCHLD, handler)

    # receive fds from parent process
    fds = reduction.recvfds(s, MAXFDS_TO_SEND + 1)
    s.close()
    assert len(fds) <= MAXFDS_TO_SEND

    (child_r, child_w, _forkserver._forkserver_alive_fd,
     stfd, _forkserver._inherited_fds) = __unpack_fds(*fds)
    semaphore_tracker._semaphore_tracker._fd = stfd

    # send pid to client processes
    write_unsigned(child_w, os.getpid())

    # reseed random number generator
    if 'random' in sys.modules:
        import random
        random.seed()

    # run process object received over pipe
    code = spawn._main(child_r)

    # write the exit code to the pipe
    write_unsigned(child_w, code)

#
# Read and write unsigned numbers
#


def read_unsigned(fd):
    data = b''
    length = UNSIGNED_STRUCT.size
    while len(data) < length:
        s = os.read(fd, length - len(data))
        if not s:
            raise EOFError('unexpected EOF')
        data += s
    return UNSIGNED_STRUCT.unpack(data)[0]


def write_unsigned(fd, n):
    msg = UNSIGNED_STRUCT.pack(n)
    while msg:
        nbytes = os.write(fd, msg)
        if nbytes == 0:
            raise RuntimeError('should not get here')
        msg = msg[nbytes:]

#
#
#

_forkserver = ForkServer()
ensure_running = _forkserver.ensure_running
get_inherited_fds = _forkserver.get_inherited_fds
connect_to_new_process = _forkserver.connect_to_new_process
set_forkserver_preload = _forkserver.set_forkserver_preload
