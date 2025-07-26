import logging
import random
import re
import string
import time
import traceback
from enum import Enum
from typing import cast, Dict, List, Optional, TypedDict, TypeVar


from overrides import override
from pydantic import SecretStr
import yaml

from chromadb.auth import (
    ServerAuthenticationProvider,
    ClientAuthProvider,
    ClientAuthHeaders,
    UserIdentity,
    AuthError,
)
from chromadb.config import System
from chromadb.errors import ChromaAuthError
from chromadb.telemetry.opentelemetry import (
    OpenTelemetryGranularity,
    trace_method,
)

T = TypeVar("T")

logger = logging.getLogger(__name__)

__all__ = [
    "TokenAuthenticationServerProvider",
    "TokenAuthClientProvider",
    "TokenTransportHeader",
]


class TokenTransportHeader(str, Enum):
    """
    Accceptable token transport headers.
    """

    # I don't love having this enum here -- it's weird to have an enum
    # for just two values and it's weird to have users pass X_CHROMA_TOKEN
    # to configure "x-chroma-token". But I also like having a single source
    # of truth, so 🤷🏻‍♂️
    AUTHORIZATION = "Authorization"
    X_CHROMA_TOKEN = "X-Chroma-Token"


valid_token_chars = set(string.digits + string.ascii_letters + string.punctuation)


def _check_token(token: str) -> None:
    token_str = str(token)
    if not all(c in valid_token_chars for c in token_str):
        raise ValueError(
            "Invalid token. Must contain only ASCII letters, digits, and punctuation."
        )


allowed_token_headers = [
    TokenTransportHeader.AUTHORIZATION.value,
    TokenTransportHeader.X_CHROMA_TOKEN.value,
]


def _check_allowed_token_headers(token_header: str) -> None:
    if token_header not in allowed_token_headers:
        raise ValueError(
            f"Invalid token transport header: {token_header}. "
            f"Must be one of {allowed_token_headers}"
        )


class TokenAuthClientProvider(ClientAuthProvider):
    """
    Client auth provider for token-based auth. Header key will be either
    "Authorization" or "X-Chroma-Token" depending on
    `chroma_auth_token_transport_header`. If the header is "Authorization",
    the token is passed as a bearer token.
    """

    def __init__(self, system: System) -> None:
        super().__init__(system)
        self._settings = system.settings

        system.settings.require("chroma_client_auth_credentials")
        self._token = SecretStr(str(system.settings.chroma_client_auth_credentials))
        _check_token(self._token.get_secret_value())

        if system.settings.chroma_auth_token_transport_header:
            _check_allowed_token_headers(
                system.settings.chroma_auth_token_transport_header
            )
            self._token_transport_header = TokenTransportHeader(
                system.settings.chroma_auth_token_transport_header
            )
        else:
            self._token_transport_header = TokenTransportHeader.AUTHORIZATION

    @override
    def authenticate(self) -> ClientAuthHeaders:
        val = self._token.get_secret_value()
        if self._token_transport_header == TokenTransportHeader.AUTHORIZATION:
            val = f"Bearer {val}"
        return {
            self._token_transport_header.value: SecretStr(val),
        }


class User(TypedDict):
    """
    A simple User class for use in this module only. If you need a generic
    way to represent a User, please use UserIdentity as this class keeps
    track of sensitive tokens.
    """

    id: str
    role: str
    tenant: Optional[str]
    databases: Optional[List[str]]
    tokens: List[str]


class TokenAuthenticationServerProvider(ServerAuthenticationProvider):
    """
    Server authentication provider for token-based auth. The provider will
    - On initialization, read the users from the file specified in
        `chroma_server_authn_credentials_file`. This file must be a well-formed
        YAML file with a top-level array called `users`. Each user must have
        an `id` field and a `tokens` (string array) field.
    - On each request, check the token in the header specified by
        `chroma_auth_token_transport_header`. If the configured header is
        "Authorization", the token is expected to be a bearer token.
    - If the token is valid, the server will return the user identity
        associated with the token.
    """

    def __init__(self, system: System) -> None:
        super().__init__(system)
        self._settings = system.settings
        if system.settings.chroma_auth_token_transport_header:
            _check_allowed_token_headers(
                system.settings.chroma_auth_token_transport_header
            )
            self._token_transport_header = TokenTransportHeader(
                system.settings.chroma_auth_token_transport_header
            )
        else:
            self._token_transport_header = TokenTransportHeader.AUTHORIZATION

        self._token_user_mapping: Dict[str, User] = {}
        creds = self.read_creds_or_creds_file()

        # If we only get one cred, assume it's just a valid token.
        if len(creds) == 1:
            self._token_user_mapping[creds[0]] = User(
                id="anonymous",
                tenant="*",
                databases=["*"],
                role="anonymous",
                tokens=[creds[0]],
            )
            return

        self._users = cast(List[User], yaml.safe_load("\n".join(creds))["users"])
        for user in self._users:
            if "tokens" not in user:
                raise ValueError("User missing tokens")
            if "tenant" not in user:
                user["tenant"] = "*"
            if "databases" not in user:
                user["databases"] = ["*"]
            for token in user["tokens"]:
                _check_token(token)
                if (
                    token in self._token_user_mapping
                    and self._token_user_mapping[token] != user
                ):
                    raise ValueError(
                        f"Token {token} already in use: wanted to use it for "
                        f"user {user['id']} but it's already in use by "
                        f"user {self._token_user_mapping[token]}"
                    )
                self._token_user_mapping[token] = user

    @trace_method(
        "TokenAuthenticationServerProvider.authenticate", OpenTelemetryGranularity.ALL
    )
    @override
    def authenticate_or_raise(self, headers: Dict[str, str]) -> UserIdentity:
        try:
            if self._token_transport_header.value.lower() not in headers.keys():
                raise AuthError(
                    f"Authorization header '{self._token_transport_header.value}' not found"
                )
            token = headers[self._token_transport_header.value.lower()]
            if self._token_transport_header == TokenTransportHeader.AUTHORIZATION:
                if not token.startswith("Bearer "):
                    raise AuthError("Bearer not found in Authorization header")
                token = re.sub(r"^Bearer ", "", token)

            token = token.strip()
            _check_token(token)

            if token not in self._token_user_mapping:
                raise AuthError("Invalid credentials: Token not found}")

            user_identity = UserIdentity(
                user_id=self._token_user_mapping[token]["id"],
                tenant=self._token_user_mapping[token]["tenant"],
                databases=self._token_user_mapping[token]["databases"],
            )
            return user_identity
        except AuthError as e:
            logger.debug(
                f"TokenAuthenticationServerProvider.authenticate failed: {repr(e)}"
            )
        except Exception as e:
            tb = traceback.extract_tb(e.__traceback__)
            # Get the last call stack
            last_call_stack = tb[-1]
            line_number = last_call_stack.lineno
            filename = last_call_stack.filename
            logger.debug(
                "TokenAuthenticationServerProvider.authenticate failed: "
                f"Failed to authenticate {type(e).__name__} at {filename}:{line_number}"
            )
        time.sleep(
            random.uniform(0.001, 0.005)
        )  # add some jitter to avoid timing attacks
        raise ChromaAuthError()
