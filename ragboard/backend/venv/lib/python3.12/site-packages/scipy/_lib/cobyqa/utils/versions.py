import os
import platform
import sys
from importlib.metadata import PackageNotFoundError, version


def _get_sys_info():
    """
    Get useful system information.

    Returns
    -------
    dict
        Useful system information.
    """
    return {
        "python": sys.version.replace(os.linesep, " "),
        "executable": sys.executable,
        "machine": platform.platform(),
    }


def _get_deps_info():
    """
    Get the versions of the dependencies.

    Returns
    -------
    dict
        Versions of the dependencies.
    """
    deps = ["cobyqa", "numpy", "scipy", "setuptools", "pip"]
    deps_info = {}
    for module in deps:
        try:
            deps_info[module] = version(module)
        except PackageNotFoundError:
            deps_info[module] = None
    return deps_info


def show_versions():
    """
    Display useful system and dependencies information.

    When reporting issues, please include this information.
    """
    print("System settings")
    print("---------------")
    sys_info = _get_sys_info()
    print(
        "\n".join(
            f"{k:>{max(map(len, sys_info.keys())) + 1}}: {v}"
            for k, v in sys_info.items()
        )
    )

    print()
    print("Python dependencies")
    print("-------------------")
    deps_info = _get_deps_info()
    print(
        "\n".join(
            f"{k:>{max(map(len, deps_info.keys())) + 1}}: {v}"
            for k, v in deps_info.items()
        )
    )
