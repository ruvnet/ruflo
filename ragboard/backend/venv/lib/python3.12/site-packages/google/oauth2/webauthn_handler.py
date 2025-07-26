import abc
import os
import struct
import subprocess

from google.auth import exceptions
from google.oauth2.webauthn_types import GetRequest, GetResponse


class WebAuthnHandler(abc.ABC):
    @abc.abstractmethod
    def is_available(self) -> bool:
        """Check whether this WebAuthn handler is available"""
        raise NotImplementedError("is_available method must be implemented")

    @abc.abstractmethod
    def get(self, get_request: GetRequest) -> GetResponse:
        """WebAuthn get (assertion)"""
        raise NotImplementedError("get method must be implemented")


class PluginHandler(WebAuthnHandler):
    """Offloads WebAuthn get reqeust to a pluggable command-line tool.

    Offloads WebAuthn get to a plugin which takes the form of a
    command-line tool. The command-line tool is configurable via the
    PluginHandler._ENV_VAR environment variable.

    The WebAuthn plugin should implement the following interface:

    Communication occurs over stdin/stdout, and messages are both sent and
    received in the form:

    [4 bytes - payload size (little-endian)][variable bytes - json payload]
    """

    _ENV_VAR = "GOOGLE_AUTH_WEBAUTHN_PLUGIN"

    def is_available(self) -> bool:
        try:
            self._find_plugin()
        except Exception:
            return False
        else:
            return True

    def get(self, get_request: GetRequest) -> GetResponse:
        request_json = get_request.to_json()
        cmd = self._find_plugin()
        response_json = self._call_plugin(cmd, request_json)
        return GetResponse.from_json(response_json)

    def _call_plugin(self, cmd: str, input_json: str) -> str:
        # Calculate length of input
        input_length = len(input_json)
        length_bytes_le = struct.pack("<I", input_length)
        request = length_bytes_le + input_json.encode()

        # Call plugin
        process_result = subprocess.run(
            [cmd], input=request, capture_output=True, check=True
        )

        # Check length of response
        response_len_le = process_result.stdout[:4]
        response_len = struct.unpack("<I", response_len_le)[0]
        response = process_result.stdout[4:]
        if response_len != len(response):
            raise exceptions.MalformedError(
                "Plugin response length {} does not match data {}".format(
                    response_len, len(response)
                )
            )
        return response.decode()

    def _find_plugin(self) -> str:
        plugin_cmd = os.environ.get(PluginHandler._ENV_VAR)
        if plugin_cmd is None:
            raise exceptions.InvalidResource(
                "{} env var is not set".format(PluginHandler._ENV_VAR)
            )
        return plugin_cmd
