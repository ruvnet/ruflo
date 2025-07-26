"""
This module contains utilities added by billiard, to keep
"non-core" functionality out of ``.util``."""

import os
import signal
import sys

import pickle

from .exceptions import RestartFreqExceeded
from time import monotonic

pickle_load = pickle.load
pickle_loads = pickle.loads

# cPickle.loads does not support buffer() objects,
# but we can just create a StringIO and use load.
from io import BytesIO


SIGMAP = dict(
    (getattr(signal, n), n) for n in dir(signal) if n.startswith('SIG')
)
for _alias_sig in ('SIGHUP', 'SIGABRT'):
    try:
        # Alias for deprecated signal overwrites the name we want
        SIGMAP[getattr(signal, _alias_sig)] = _alias_sig
    except AttributeError:
        pass


TERM_SIGNAL, TERM_SIGNAME = signal.SIGTERM, 'SIGTERM'
REMAP_SIGTERM = os.environ.get('REMAP_SIGTERM')
if REMAP_SIGTERM:
    TERM_SIGNAL, TERM_SIGNAME = (
        getattr(signal, REMAP_SIGTERM), REMAP_SIGTERM)


TERMSIGS_IGNORE = {'SIGTERM'} if REMAP_SIGTERM else set()
TERMSIGS_FORCE = {'SIGQUIT'} if REMAP_SIGTERM else set()

EX_SOFTWARE = 70

TERMSIGS_DEFAULT = {
    'SIGHUP',
    'SIGQUIT',
    TERM_SIGNAME,
    'SIGUSR1',
}

TERMSIGS_FULL = {
    'SIGHUP',
    'SIGQUIT',
    'SIGTRAP',
    'SIGABRT',
    'SIGEMT',
    'SIGSYS',
    'SIGPIPE',
    'SIGALRM',
    TERM_SIGNAME,
    'SIGXCPU',
    'SIGXFSZ',
    'SIGVTALRM',
    'SIGPROF',
    'SIGUSR1',
    'SIGUSR2',
}

#: set by signal handlers just before calling exit.
#: if this is true after the sighandler returns it means that something
#: went wrong while terminating the process, and :func:`os._exit`
#: must be called ASAP.
_should_have_exited = [False]


def human_status(status):
    if (status or 0) < 0:
        try:
            return 'signal {0} ({1})'.format(-status, SIGMAP[-status])
        except KeyError:
            return 'signal {0}'.format(-status)
    return 'exitcode {0}'.format(status)


def pickle_loads(s, load=pickle_load):
    # used to support buffer objects
    return load(BytesIO(s))


def maybe_setsignal(signum, handler):
    try:
        signal.signal(signum, handler)
    except (OSError, AttributeError, ValueError, RuntimeError):
        pass


def _shutdown_cleanup(signum, frame):
    # we will exit here so if the signal is received a second time
    # we can be sure that something is very wrong and we may be in
    # a crashing loop.
    if _should_have_exited[0]:
        os._exit(EX_SOFTWARE)
    maybe_setsignal(signum, signal.SIG_DFL)
    _should_have_exited[0] = True
    sys.exit(-(256 - signum))


def signum(sig):
    return getattr(signal, sig, None)


def _should_override_term_signal(sig, current):
    return (
        sig in TERMSIGS_FORCE or
        (current is not None and current != signal.SIG_IGN)
    )


def reset_signals(handler=_shutdown_cleanup, full=False):
    for sig in TERMSIGS_FULL if full else TERMSIGS_DEFAULT:
        num = signum(sig)
        if num:
            if _should_override_term_signal(sig, signal.getsignal(num)):
                maybe_setsignal(num, handler)
    for sig in TERMSIGS_IGNORE:
        num = signum(sig)
        if num:
            maybe_setsignal(num, signal.SIG_IGN)


class restart_state:
    RestartFreqExceeded = RestartFreqExceeded

    def __init__(self, maxR, maxT):
        self.maxR, self.maxT = maxR, maxT
        self.R, self.T = 0, None

    def step(self, now=None):
        now = monotonic() if now is None else now
        R = self.R
        if self.T and now - self.T >= self.maxT:
            # maxT passed, reset counter and time passed.
            self.T, self.R = now, 0
        elif self.maxR and self.R >= self.maxR:
            # verify that R has a value as the result handler
            # resets this when a job is accepted. If a job is accepted
            # the startup probably went fine (startup restart burst
            # protection)
            if self.R:  # pragma: no cover
                self.R = 0  # reset in case someone catches the error
                raise self.RestartFreqExceeded("%r in %rs" % (R, self.maxT))
        # first run sets T
        if self.T is None:
            self.T = now
        self.R += 1
