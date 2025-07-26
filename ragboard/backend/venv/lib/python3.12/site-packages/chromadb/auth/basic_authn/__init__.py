import base64
import random
import re
import time
import traceback

import bcrypt
import logging

from overrides import override
from pydantic import SecretStr

from chromadb.auth import (
    UserIdentity,
    ServerAuthenticationProvider,
    ClientAuthProvider,
    ClientAuthHeaders,
    AuthError,
)
from chromadb.config import System
from chromadb.errors import ChromaAuthError
from chromadb.telemetry.opentelemetry import (
    OpenTelemetryGranularity,
    trace_method,
)


from typing import Dict


logger = logging.getLogger(__name__)

__all__ = ["BasicAuthenticationServerProvider", "BasicAuthClientProvider"]

AUTHORIZATION_HEADER = "Authorization"


class BasicAuthClientProvider(ClientAuthProvider):
    """
    Client auth provider for basic auth. The credentials are passed as a
    base64-encoded string in the Authorization header prepended with "Basic ".
    """

    def __init__(self, system: System) -> None:
        super().__init__(system)
        self._settings = system.settings
        system.settings.require("chroma_client_auth_credentials")
        self._creds = SecretStr(str(system.settings.chroma_client_auth_credentials))

    @override
    def authenticate(self) -> ClientAuthHeaders:
        encoded = base64.b64encode(
            f"{self._creds.get_secret_value()}".encode("utf-8")
        ).decode("utf-8")
        return {
            AUTHORIZATION_HEADER: SecretStr(f"Basic {encoded}"),
        }


class BasicAuthenticationServerProvider(ServerAuthenticationProvider):
    """
    Server auth provider for basic auth. The credentials are read from
    `chroma_server_authn_credentials_file` and each line must be in the format
    <username>:<bcrypt passwd>.

    Expects tokens to be passed as a base64-encoded string in the Authorization
    header prepended with "Basic".
    """

    def __init__(self, system: System) -> None:
        super().__init__(system)
        self._settings = system.settings

        self._creds: Dict[str, SecretStr] = {}
        creds = self.read_creds_or_creds_file()

        for line in creds:
            if not line.strip():
                continue
            _raw_creds = [v for v in line.strip().split(":")]
            if (
                _raw_creds
                and _raw_creds[0]
                and len(_raw_creds) != 2
                or not all(_raw_creds)
            ):
                raise ValueError(
                    f"Invalid htpasswd credentials found: {_raw_creds}. "
                    "Lines must be exactly <username>:<bcrypt passwd>."
                )
            username = _raw_creds[0]
            password = _raw_creds[1]
            if username in self._creds:
                raise ValueError(
                    "Duplicate username found in "
                    "[chroma_server_authn_credentials]. "
                    "Usernames must be unique."
                )
            self._creds[username] = SecretStr(password)

    @trace_method(
        "BasicAuthenticationServerProvider.authenticate", OpenTelemetryGranularity.ALL
    )
    @override
    def authenticate_or_raise(self, headers: Dict[str, str]) -> UserIdentity:
        try:
            if AUTHORIZATION_HEADER.lower() not in headers.keys():
                raise AuthError(AUTHORIZATION_HEADER + " header not found")
            _auth_header = headers[AUTHORIZATION_HEADER.lower()]
            _auth_header = re.sub(r"^Basic ", "", _auth_header)
            _auth_header = _auth_header.strip()

            base64_decoded = base64.b64decode(_auth_header).decode("utf-8")
            if ":" not in base64_decoded:
                raise AuthError("Invalid Authorization header format")
            username, password = base64_decoded.split(":", 1)
            username = str(username)  # convert to string to prevent header injection
            password = str(password)  # convert to string to prevent header injection
            if username not in self._creds:
                raise AuthError("Invalid username or password")

            _pwd_check = bcrypt.checkpw(
                password.encode("utf-8"),
                self._creds[username].get_secret_value().encode("utf-8"),
            )
            if not _pwd_check:
                raise AuthError("Invalid username or password")
            return UserIdentity(user_id=username)
        except AuthError as e:
            logger.error(
                f"BasicAuthenticationServerProvider.authenticate failed: {repr(e)}"
            )
        except Exception as e:
            tb = traceback.extract_tb(e.__traceback__)
            # Get the last call stack
            last_call_stack = tb[-1]
            line_number = last_call_stack.lineno
            filename = last_call_stack.filename
            logger.error(
                "BasicAuthenticationServerProvider.authenticate failed: "
                f"Failed to authenticate {type(e).__name__} at {filename}:{line_number}"
            )
        time.sleep(
            random.uniform(0.001, 0.005)
        )  # add some jitter to avoid timing attacks
        raise ChromaAuthError()
