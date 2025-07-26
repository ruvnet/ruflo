# Copyright 2017 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Tools for using the Google `Cloud Identity and Access Management (IAM)
API`_'s auth-related functionality.

.. _Cloud Identity and Access Management (IAM) API:
    https://cloud.google.com/iam/docs/
"""

import base64
import http.client as http_client
import json

from google.auth import _exponential_backoff
from google.auth import _helpers
from google.auth import credentials
from google.auth import crypt
from google.auth import exceptions

IAM_RETRY_CODES = {
    http_client.INTERNAL_SERVER_ERROR,
    http_client.BAD_GATEWAY,
    http_client.SERVICE_UNAVAILABLE,
    http_client.GATEWAY_TIMEOUT,
}

_IAM_SCOPE = ["https://www.googleapis.com/auth/iam"]

_IAM_ENDPOINT = (
    "https://iamcredentials.googleapis.com/v1/projects/-"
    + "/serviceAccounts/{}:generateAccessToken"
)

_IAM_SIGN_ENDPOINT = (
    "https://iamcredentials.googleapis.com/v1/projects/-"
    + "/serviceAccounts/{}:signBlob"
)

_IAM_SIGNJWT_ENDPOINT = (
    "https://iamcredentials.googleapis.com/v1/projects/-"
    + "/serviceAccounts/{}:signJwt"
)

_IAM_IDTOKEN_ENDPOINT = (
    "https://iamcredentials.googleapis.com/v1/"
    + "projects/-/serviceAccounts/{}:generateIdToken"
)


class Signer(crypt.Signer):
    """Signs messages using the IAM `signBlob API`_.

    This is useful when you need to sign bytes but do not have access to the
    credential's private key file.

    .. _signBlob API:
        https://cloud.google.com/iam/reference/rest/v1/projects.serviceAccounts
        /signBlob
    """

    def __init__(self, request, credentials, service_account_email):
        """
        Args:
            request (google.auth.transport.Request): The object used to make
                HTTP requests.
            credentials (google.auth.credentials.Credentials): The credentials
                that will be used to authenticate the request to the IAM API.
                The credentials must have of one the following scopes:

                - https://www.googleapis.com/auth/iam
                - https://www.googleapis.com/auth/cloud-platform
            service_account_email (str): The service account email identifying
                which service account to use to sign bytes. Often, this can
                be the same as the service account email in the given
                credentials.
        """
        self._request = request
        self._credentials = credentials
        self._service_account_email = service_account_email

    def _make_signing_request(self, message):
        """Makes a request to the API signBlob API."""
        message = _helpers.to_bytes(message)

        method = "POST"
        url = _IAM_SIGN_ENDPOINT.replace(
            credentials.DEFAULT_UNIVERSE_DOMAIN, self._credentials.universe_domain
        ).format(self._service_account_email)
        headers = {"Content-Type": "application/json"}
        body = json.dumps(
            {"payload": base64.b64encode(message).decode("utf-8")}
        ).encode("utf-8")

        retries = _exponential_backoff.ExponentialBackoff()
        for _ in retries:
            self._credentials.before_request(self._request, method, url, headers)

            response = self._request(url=url, method=method, body=body, headers=headers)

            if response.status in IAM_RETRY_CODES:
                continue

            if response.status != http_client.OK:
                raise exceptions.TransportError(
                    "Error calling the IAM signBlob API: {}".format(response.data)
                )

            return json.loads(response.data.decode("utf-8"))
        raise exceptions.TransportError("exhausted signBlob endpoint retries")

    @property
    def key_id(self):
        """Optional[str]: The key ID used to identify this private key.

        .. warning::
           This is always ``None``. The key ID used by IAM can not
           be reliably determined ahead of time.
        """
        return None

    @_helpers.copy_docstring(crypt.Signer)
    def sign(self, message):
        response = self._make_signing_request(message)
        return base64.b64decode(response["signedBlob"])
