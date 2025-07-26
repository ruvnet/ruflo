"""Div. Utilities."""

from __future__ import annotations

import os
import sys

from .encoding import default_encode


def emergency_dump_state(state, open_file=open, dump=None, stderr=None):
    """Dump message state to stdout or file."""
    from pprint import pformat
    from tempfile import mkstemp
    stderr = sys.stderr if stderr is None else stderr

    if dump is None:
        import pickle
        dump = pickle.dump
    fd, persist = mkstemp()
    os.close(fd)
    print(f'EMERGENCY DUMP STATE TO FILE -> {persist} <-',
          file=stderr)
    fh = open_file(persist, 'w')
    try:
        try:
            dump(state, fh, protocol=0)
        except Exception as exc:
            print(
                f'Cannot pickle state: {exc!r}. Fallback to pformat.',
                file=stderr,
            )
            fh.write(default_encode(pformat(state)))
    finally:
        fh.flush()
        fh.close()
    return persist
