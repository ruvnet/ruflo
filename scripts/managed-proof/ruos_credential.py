"""Future opt-in OpenRouter placement reader. Never registered as a model tool.

Current frozen transfer runs do NOT import this helper. No shell sourcing,
credential enumeration, network requests, printing or arbitrary key selector.
"""
import os
import pathlib
import re
import shlex
import stat

NAME = 'OPENROUTER_API_KEY'
VALUE = re.compile(r'[A-Za-z0-9._-]{8,8192}')
MAX_BYTES = 262144


def _valid(value):
    if not isinstance(value, str) or not VALUE.fullmatch(value):
        raise RuntimeError('Invalid OpenRouter executor credential')
    return value


def _read_named_export(path):
    path = pathlib.Path(path)
    try:
        parent = path.parent.lstat()
        if not stat.S_ISDIR(parent.st_mode) or parent.st_uid != os.getuid() or parent.st_mode & 0o077:
            raise RuntimeError('Unsafe credential placement directory')
        fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0))
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077 or info.st_size > MAX_BYTES:
                raise RuntimeError('Unsafe credential placement file')
            data = os.read(fd, MAX_BYTES + 1)
            if len(data) > MAX_BYTES:
                raise RuntimeError('Credential placement size exceeded')
        finally:
            os.close(fd)
    except FileNotFoundError:
        return None
    except OSError:
        raise RuntimeError('OpenRouter placement unavailable') from None
    selected = []
    try:
        for line in data.decode('utf8').splitlines():
            # Inspect ONLY the exact named export. Other lines are never sourced.
            if not re.match(r'^\s*export\s+OPENROUTER_API_KEY=', line):
                continue
            tokens = shlex.split(line, comments=True, posix=True)
            if len(tokens) != 2 or tokens[0] != 'export' or not tokens[1].startswith(NAME+'='):
                raise RuntimeError('Invalid named credential export')
            selected.append(_valid(tokens[1][len(NAME)+1:]))
    except (ValueError, UnicodeError):
        raise RuntimeError('Invalid named credential placement') from None
    if len(selected) > 1:
        raise RuntimeError('Ambiguous OpenRouter placement; host reconciliation required')
    return selected[0] if selected else None


def openrouter_credential(*, allow_ruos_placement=False):
    """Env first; explicit trusted-host opt-in enables only two canonical files."""
    existing = os.environ.get(NAME)
    if existing:
        return _valid(existing)
    if not allow_ruos_placement:
        raise RuntimeError('OpenRouter executor credential unavailable')
    home = pathlib.Path.home()
    runtime = pathlib.Path(os.environ['XDG_RUNTIME_DIR']) if os.environ.get('XDG_RUNTIME_DIR') else home/'.ruos'
    candidates = [home/'.ruos'/'env', runtime/'ruos-env']
    for path in dict.fromkeys(candidates):
        value = _read_named_export(path)
        if value:
            return value
    raise RuntimeError('OpenRouter executor placement unavailable')
