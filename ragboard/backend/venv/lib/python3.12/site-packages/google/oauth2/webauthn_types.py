from dataclasses import dataclass
import json
from typing import Any, Dict, List, Optional

from google.auth import exceptions


@dataclass(frozen=True)
class PublicKeyCredentialDescriptor:
    """Descriptor for a security key based credential.

    https://www.w3.org/TR/webauthn-3/#dictionary-credential-descriptor

    Args:
        id: <url-safe base64-encoded> credential id (key handle).
        transports: <'usb'|'nfc'|'ble'|'internal'> List of supported transports.
    """

    id: str
    transports: Optional[List[str]] = None

    def to_dict(self):
        cred = {"type": "public-key", "id": self.id}
        if self.transports:
            cred["transports"] = self.transports
        return cred


@dataclass
class AuthenticationExtensionsClientInputs:
    """Client extensions inputs for WebAuthn extensions.

    Args:
        appid: app id that can be asserted with in addition to rpid.
            https://www.w3.org/TR/webauthn-3/#sctn-appid-extension
    """

    appid: Optional[str] = None

    def to_dict(self):
        extensions = {}
        if self.appid:
            extensions["appid"] = self.appid
        return extensions


@dataclass
class GetRequest:
    """WebAuthn get request

    Args:
        origin: Origin where the WebAuthn get assertion takes place.
        rpid: Relying Party ID.
        challenge: <url-safe base64-encoded> raw challenge.
        timeout_ms: Timeout number in millisecond.
        allow_credentials: List of allowed credentials.
        user_verification: <'required'|'preferred'|'discouraged'> User verification requirement.
        extensions: WebAuthn authentication extensions inputs.
    """

    origin: str
    rpid: str
    challenge: str
    timeout_ms: Optional[int] = None
    allow_credentials: Optional[List[PublicKeyCredentialDescriptor]] = None
    user_verification: Optional[str] = None
    extensions: Optional[AuthenticationExtensionsClientInputs] = None

    def to_json(self) -> str:
        req_options: Dict[str, Any] = {"rpId": self.rpid, "challenge": self.challenge}
        if self.timeout_ms:
            req_options["timeout"] = self.timeout_ms
        if self.allow_credentials:
            req_options["allowCredentials"] = [
                c.to_dict() for c in self.allow_credentials
            ]
        if self.user_verification:
            req_options["userVerification"] = self.user_verification
        if self.extensions:
            req_options["extensions"] = self.extensions.to_dict()
        return json.dumps(
            {"type": "get", "origin": self.origin, "requestData": req_options}
        )


@dataclass(frozen=True)
class AuthenticatorAssertionResponse:
    """Authenticator response to a WebAuthn get (assertion) request.

    https://www.w3.org/TR/webauthn-3/#authenticatorassertionresponse

    Args:
        client_data_json: <url-safe base64-encoded> client data JSON.
        authenticator_data: <url-safe base64-encoded> authenticator data.
        signature: <url-safe base64-encoded> signature.
        user_handle: <url-safe base64-encoded> user handle.
    """

    client_data_json: str
    authenticator_data: str
    signature: str
    user_handle: Optional[str]


@dataclass(frozen=True)
class GetResponse:
    """WebAuthn get (assertion) response.

    Args:
        id: <url-safe base64-encoded> credential id (key handle).
        response: The authenticator assertion response.
        authenticator_attachment: <'cross-platform'|'platform'> The attachment status of the authenticator.
        client_extension_results: WebAuthn authentication extensions output results in a dictionary.
    """

    id: str
    response: AuthenticatorAssertionResponse
    authenticator_attachment: Optional[str]
    client_extension_results: Optional[Dict]

    @staticmethod
    def from_json(json_str: str):
        """Verify and construct GetResponse from a JSON string."""
        try:
            resp_json = json.loads(json_str)
        except ValueError:
            raise exceptions.MalformedError("Invalid Get JSON response")
        if resp_json.get("type") != "getResponse":
            raise exceptions.MalformedError(
                "Invalid Get response type: {}".format(resp_json.get("type"))
            )
        pk_cred = resp_json.get("responseData")
        if pk_cred is None:
            if resp_json.get("error"):
                raise exceptions.ReauthFailError(
                    "WebAuthn.get failure: {}".format(resp_json["error"])
                )
            else:
                raise exceptions.MalformedError("Get response is empty")
        if pk_cred.get("type") != "public-key":
            raise exceptions.MalformedError(
                "Invalid credential type: {}".format(pk_cred.get("type"))
            )
        assertion_json = pk_cred["response"]
        assertion_resp = AuthenticatorAssertionResponse(
            client_data_json=assertion_json["clientDataJSON"],
            authenticator_data=assertion_json["authenticatorData"],
            signature=assertion_json["signature"],
            user_handle=assertion_json.get("userHandle"),
        )
        return GetResponse(
            id=pk_cred["id"],
            response=assertion_resp,
            authenticator_attachment=pk_cred.get("authenticatorAttachment"),
            client_extension_results=pk_cred.get("clientExtensionResults"),
        )
