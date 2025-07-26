# This file is dual licensed under the terms of the Apache License, Version
# 2.0, and the BSD License. See the LICENSE file in the root of this repository
# for complete details.

from __future__ import annotations

import os
import sys
import threading
import types
import typing
import warnings
from collections.abc import Callable

import cryptography
from cryptography.exceptions import InternalError
from cryptography.hazmat.bindings._rust import _openssl, openssl
from cryptography.hazmat.bindings.openssl._conditional import CONDITIONAL_NAMES


def _openssl_assert(ok: bool) -> None:
    if not ok:
        errors = openssl.capture_error_stack()

        raise InternalError(
            "Unknown OpenSSL error. This error is commonly encountered when "
            "another library is not cleaning up the OpenSSL error stack. If "
            "you are using cryptography with another library that uses "
            "OpenSSL try disabling it before reporting a bug. Otherwise "
            "please file an issue at https://github.com/pyca/cryptography/"
            "issues with information on how to reproduce "
            f"this. ({errors!r})",
            errors,
        )


def build_conditional_library(
    lib: typing.Any,
    conditional_names: dict[str, Callable[[], list[str]]],
) -> typing.Any:
    conditional_lib = types.ModuleType("lib")
    conditional_lib._original_lib = lib  # type: ignore[attr-defined]
    excluded_names = set()
    for condition, names_cb in conditional_names.items():
        if not getattr(lib, condition):
            excluded_names.update(names_cb())

    for attr in dir(lib):
        if attr not in excluded_names:
            setattr(conditional_lib, attr, getattr(lib, attr))

    return conditional_lib


class Binding:
    """
    OpenSSL API wrapper.
    """

    lib: typing.ClassVar = None
    ffi = _openssl.ffi
    _lib_loaded = False
    _init_lock = threading.Lock()

    def __init__(self) -> None:
        self._ensure_ffi_initialized()

    @classmethod
    def _ensure_ffi_initialized(cls) -> None:
        with cls._init_lock:
            if not cls._lib_loaded:
                cls.lib = build_conditional_library(
                    _openssl.lib, CONDITIONAL_NAMES
                )
                cls._lib_loaded = True

    @classmethod
    def init_static_locks(cls) -> None:
        cls._ensure_ffi_initialized()


def _verify_package_version(version: str) -> None:
    # Occasionally we run into situations where the version of the Python
    # package does not match the version of the shared object that is loaded.
    # This may occur in environments where multiple versions of cryptography
    # are installed and available in the python path. To avoid errors cropping
    # up later this code checks that the currently imported package and the
    # shared object that were loaded have the same version and raise an
    # ImportError if they do not
    so_package_version = _openssl.ffi.string(
        _openssl.lib.CRYPTOGRAPHY_PACKAGE_VERSION
    )
    if version.encode("ascii") != so_package_version:
        raise ImportError(
            "The version of cryptography does not match the loaded "
            "shared object. This can happen if you have multiple copies of "
            "cryptography installed in your Python path. Please try creating "
            "a new virtual environment to resolve this issue. "
            f"Loaded python version: {version}, "
            f"shared object version: {so_package_version}"
        )

    _openssl_assert(
        _openssl.lib.OpenSSL_version_num() == openssl.openssl_version(),
    )


_verify_package_version(cryptography.__version__)

Binding.init_static_locks()

if (
    sys.platform == "win32"
    and os.environ.get("PROCESSOR_ARCHITEW6432") is not None
):
    warnings.warn(
        "You are using cryptography on a 32-bit Python on a 64-bit Windows "
        "Operating System. Cryptography will be significantly faster if you "
        "switch to using a 64-bit Python.",
        UserWarning,
        stacklevel=2,
    )
