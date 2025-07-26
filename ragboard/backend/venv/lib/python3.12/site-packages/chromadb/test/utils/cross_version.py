import sys
import subprocess
import os
import tempfile
from types import ModuleType
from typing import Dict, List

base_install_dir = (
    tempfile.gettempdir()
    + f"/worker-{os.environ.get('PYTEST_XDIST_WORKER', 'unknown')}"
    + "/persistence_test_chromadb_versions"
)


def get_path_to_version_install(version: str) -> str:
    return base_install_dir + "/" + version


def switch_to_version(version: str, versioned_modules: List[str]) -> ModuleType:
    module_name = "chromadb"
    # Remove old version from sys.modules, except test modules
    old_modules = {
        n: m
        for n, m in sys.modules.items()
        if n == module_name
        or (n.startswith(module_name + "."))
        or n in versioned_modules
        or (any(n.startswith(m + ".") for m in versioned_modules))
    }
    for n in old_modules:
        del sys.modules[n]
    # Load the target version and override the path to the installed version
    # https://docs.python.org/3/library/importlib.html#importing-a-source-file-directly
    sys.path.insert(0, get_path_to_version_install(version))
    import chromadb

    assert chromadb.__version__ == version
    return chromadb


def get_path_to_version_library(version: str) -> str:
    return get_path_to_version_install(version) + "/chromadb/__init__.py"


def install_version(version: str, dep_overrides: Dict[str, str]) -> None:
    # Check if already installed
    version_library = get_path_to_version_library(version)
    if os.path.exists(version_library):
        return
    path = get_path_to_version_install(version)
    install(f"chromadb=={version}", path, dep_overrides)


def install(pkg: str, path: str, dep_overrides: Dict[str, str]) -> int:
    os.makedirs(path, exist_ok=True)

    # -q -q to suppress pip output to ERROR level
    # https://pip.pypa.io/en/stable/cli/pip/#quiet
    command = [sys.executable, "-m", "pip", "-q", "-q", "install", pkg]

    for dep, operator_version in dep_overrides.items():
        command.append(f"{dep}{operator_version}")

    # Only add --no-binary=chroma-hnswlib if it's in the dependencies
    if "chroma-hnswlib" in pkg or any("chroma-hnswlib" in dep for dep in dep_overrides):
        command.append("--no-binary=chroma-hnswlib")

    command.append(f"--target={path}")

    print(f"Installing chromadb version {pkg} to {path}")
    return subprocess.check_call(command)
