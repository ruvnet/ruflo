import os
import re

from .._core import SHELL_NAMES, ShellDetectionFailure
from . import proc, ps

# Based on QEMU docs: https://www.qemu.org/docs/master/user/main.html
QEMU_BIN_REGEX = re.compile(
    r"""qemu-
        (alpha
        |armeb
        |arm
        |m68k
        |cris
        |i386
        |x86_64
        |microblaze
        |mips
        |mipsel
        |mips64
        |mips64el
        |mipsn32
        |mipsn32el
        |nios2
        |ppc64
        |ppc
        |sh4eb
        |sh4
        |sparc
        |sparc32plus
        |sparc64
    )""",
    re.VERBOSE,
)


def _iter_process_parents(pid, max_depth=10):
    """Select a way to obtain process information from the system.

    * `/proc` is used if supported.
    * The system `ps` utility is used as a fallback option.
    """
    for impl in (proc, ps):
        try:
            iterator = impl.iter_process_parents(pid, max_depth)
        except EnvironmentError:
            continue
        return iterator
    raise ShellDetectionFailure("compatible proc fs or ps utility is required")


def _get_login_shell(proc_cmd):
    """Form shell information from SHELL environ if possible."""
    login_shell = os.environ.get("SHELL", "")
    if login_shell:
        proc_cmd = login_shell
    else:
        proc_cmd = proc_cmd[1:]
    return (os.path.basename(proc_cmd).lower(), proc_cmd)


_INTERPRETER_SHELL_NAMES = [
    (re.compile(r"^python(\d+(\.\d+)?)?$"), {"xonsh"}),
]


def _get_interpreter_shell(proc_name, proc_args):
    """Get shell invoked via an interpreter.

    Some shells are implemented on, and invoked with an interpreter, e.g. xonsh
    is commonly executed with an executable Python script. This detects what
    script the interpreter is actually running, and check whether that looks
    like a shell.

    See sarugaku/shellingham#26 for rational.
    """
    for pattern, shell_names in _INTERPRETER_SHELL_NAMES:
        if not pattern.match(proc_name):
            continue
        for arg in proc_args:
            name = os.path.basename(arg).lower()
            if os.path.isfile(arg) and name in shell_names:
                return (name, arg)
    return None


def _get_shell(cmd, *args):
    if cmd.startswith("-"):  # Login shell! Let's use this.
        return _get_login_shell(cmd)
    name = os.path.basename(cmd).lower()
    if name == "rosetta" or QEMU_BIN_REGEX.fullmatch(name):
        # If the current process is Rosetta or QEMU, this likely is a
        # containerized process. Parse out the actual command instead.
        cmd = args[0]
        args = args[1:]
        name = os.path.basename(cmd).lower()
    if name in SHELL_NAMES:  # Command looks like a shell.
        return (name, cmd)
    shell = _get_interpreter_shell(name, args)
    if shell:
        return shell
    return None


def get_shell(pid=None, max_depth=10):
    """Get the shell that the supplied pid or os.getpid() is running in."""
    pid = str(pid or os.getpid())
    for proc_args, _, _ in _iter_process_parents(pid, max_depth):
        shell = _get_shell(*proc_args)
        if shell:
            return shell
    return None
