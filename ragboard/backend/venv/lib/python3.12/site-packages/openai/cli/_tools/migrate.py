from __future__ import annotations

import os
import sys
import json
import shutil
import tarfile
import platform
import subprocess
from typing import TYPE_CHECKING, List
from pathlib import Path
from argparse import ArgumentParser

import httpx

from .._errors import CLIError, SilentCLIError
from .._models import BaseModel

if TYPE_CHECKING:
    from argparse import _SubParsersAction


def register(subparser: _SubParsersAction[ArgumentParser]) -> None:
    sub = subparser.add_parser("migrate")
    sub.set_defaults(func=migrate, args_model=MigrateArgs, allow_unknown_args=True)

    sub = subparser.add_parser("grit")
    sub.set_defaults(func=grit, args_model=GritArgs, allow_unknown_args=True)


class GritArgs(BaseModel):
    # internal
    unknown_args: List[str] = []


def grit(args: GritArgs) -> None:
    grit_path = install()

    try:
        subprocess.check_call([grit_path, *args.unknown_args])
    except subprocess.CalledProcessError:
        # stdout and stderr are forwarded by subprocess so an error will already
        # have been displayed
        raise SilentCLIError() from None


class MigrateArgs(BaseModel):
    # internal
    unknown_args: List[str] = []


def migrate(args: MigrateArgs) -> None:
    grit_path = install()

    try:
        subprocess.check_call([grit_path, "apply", "openai", *args.unknown_args])
    except subprocess.CalledProcessError:
        # stdout and stderr are forwarded by subprocess so an error will already
        # have been displayed
        raise SilentCLIError() from None


# handles downloading the Grit CLI until they provide their own PyPi package

KEYGEN_ACCOUNT = "custodian-dev"


def _cache_dir() -> Path:
    xdg = os.environ.get("XDG_CACHE_HOME")
    if xdg is not None:
        return Path(xdg)

    return Path.home() / ".cache"


def _debug(message: str) -> None:
    if not os.environ.get("DEBUG"):
        return

    sys.stdout.write(f"[DEBUG]: {message}\n")


def install() -> Path:
    """Installs the Grit CLI and returns the location of the binary"""
    if sys.platform == "win32":
        raise CLIError("Windows is not supported yet in the migration CLI")

    platform = "macos" if sys.platform == "darwin" else "linux"

    dir_name = _cache_dir() / "openai-python"
    install_dir = dir_name / ".install"
    target_dir = install_dir / "bin"

    target_path = target_dir / "marzano"
    temp_file = target_dir / "marzano.tmp"

    if target_path.exists():
        _debug(f"{target_path} already exists")
        sys.stdout.flush()
        return target_path

    _debug(f"Using Grit CLI path: {target_path}")

    target_dir.mkdir(parents=True, exist_ok=True)

    if temp_file.exists():
        temp_file.unlink()

    arch = _get_arch()
    _debug(f"Using architecture {arch}")

    file_name = f"marzano-{platform}-{arch}"
    meta_url = f"https://api.keygen.sh/v1/accounts/{KEYGEN_ACCOUNT}/artifacts/{file_name}"

    sys.stdout.write(f"Retrieving Grit CLI metadata from {meta_url}\n")
    with httpx.Client() as client:
        response = client.get(meta_url)  # pyright: ignore[reportUnknownMemberType]

        data = response.json()
        errors = data.get("errors")
        if errors:
            for error in errors:
                sys.stdout.write(f"{error}\n")

            raise CLIError("Could not locate Grit CLI binary - see above errors")

        write_manifest(install_dir, data["data"]["relationships"]["release"]["data"]["id"])

        link = data["data"]["links"]["redirect"]
        _debug(f"Redirect URL {link}")

        download_response = client.get(link)  # pyright: ignore[reportUnknownMemberType]
        with open(temp_file, "wb") as file:
            for chunk in download_response.iter_bytes():
                file.write(chunk)

    unpacked_dir = target_dir / "cli-bin"
    unpacked_dir.mkdir(parents=True, exist_ok=True)

    with tarfile.open(temp_file, "r:gz") as archive:
        archive.extractall(unpacked_dir)

    for item in unpacked_dir.iterdir():
        item.rename(target_dir / item.name)

    shutil.rmtree(unpacked_dir)
    os.remove(temp_file)
    os.chmod(target_path, 0o755)

    sys.stdout.flush()

    return target_path


def _get_arch() -> str:
    architecture = platform.machine().lower()

    # Map the architecture names to Node.js equivalents
    arch_map = {
        "x86_64": "x64",
        "amd64": "x64",
        "armv7l": "arm",
        "aarch64": "arm64",
    }

    return arch_map.get(architecture, architecture)


def write_manifest(install_path: Path, release: str) -> None:
    manifest = {
        "installPath": str(install_path),
        "binaries": {
            "marzano": {
                "name": "marzano",
                "release": release,
            },
        },
    }
    manifest_path = Path(install_path) / "manifests.json"
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)
