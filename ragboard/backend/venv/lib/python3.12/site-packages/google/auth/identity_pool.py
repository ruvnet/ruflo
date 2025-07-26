# Copyright 2020 Google LLC
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

"""Identity Pool Credentials.

This module provides credentials to access Google Cloud resources from on-prem
or non-Google Cloud platforms which support external credentials (e.g. OIDC ID
tokens) retrieved from local file locations or local servers. This includes
Microsoft Azure and OIDC identity providers (e.g. K8s workloads registered with
Hub with Hub workload identity enabled).

These credentials are recommended over the use of service account credentials
in on-prem/non-Google Cloud platforms as they do not involve the management of
long-live service account private keys.

Identity Pool Credentials are initialized using external_account
arguments which are typically loaded from an external credentials file or
an external credentials URL.

This module also provides a definition for an abstract subject token supplier.
This supplier can be implemented to return a valid OIDC or SAML2.0 subject token
and used to create Identity Pool credentials. The credentials will then call the
supplier instead of using pre-defined methods such as reading a local file or
calling a URL.
"""

try:
    from collections.abc import Mapping
# Python 2.7 compatibility
except ImportError:  # pragma: NO COVER
    from collections import Mapping  # type: ignore
import abc
import base64
import json
import os
from typing import NamedTuple

from google.auth import _helpers
from google.auth import exceptions
from google.auth import external_account
from google.auth.transport import _mtls_helper


class SubjectTokenSupplier(metaclass=abc.ABCMeta):
    """Base class for subject token suppliers. This can be implemented with custom logic to retrieve
    a subject token to exchange for a Google Cloud access token when using Workload or
    Workforce Identity Federation. The identity pool credential does not cache the subject token,
    so caching logic should be added in the implementation.
    """

    @abc.abstractmethod
    def get_subject_token(self, context, request):
        """Returns the requested subject token. The subject token must be valid.

        .. warning: This is not cached by the calling Google credential, so caching logic should be implemented in the supplier.

        Args:
            context (google.auth.externalaccount.SupplierContext): The context object
                containing information about the requested audience and subject token type.
            request (google.auth.transport.Request): The object used to make
                HTTP requests.

        Raises:
            google.auth.exceptions.RefreshError: If an error is encountered during
                subject token retrieval logic.

        Returns:
            str: The requested subject token string.
        """
        raise NotImplementedError("")


class _TokenContent(NamedTuple):
    """Models the token content response from file and url internal suppliers.
        Attributes:
            content (str): The string content of the file or URL response.
            location (str): The location the content was retrieved from. This will either be a file location or a URL.
    """

    content: str
    location: str


class _FileSupplier(SubjectTokenSupplier):
    """ Internal implementation of subject token supplier which supports reading a subject token from a file."""

    def __init__(self, path, format_type, subject_token_field_name):
        self._path = path
        self._format_type = format_type
        self._subject_token_field_name = subject_token_field_name

    @_helpers.copy_docstring(SubjectTokenSupplier)
    def get_subject_token(self, context, request):
        if not os.path.exists(self._path):
            raise exceptions.RefreshError("File '{}' was not found.".format(self._path))

        with open(self._path, "r", encoding="utf-8") as file_obj:
            token_content = _TokenContent(file_obj.read(), self._path)

        return _parse_token_data(
            token_content, self._format_type, self._subject_token_field_name
        )


class _UrlSupplier(SubjectTokenSupplier):
    """ Internal implementation of subject token supplier which supports retrieving a subject token by calling a URL endpoint."""

    def __init__(self, url, format_type, subject_token_field_name, headers):
        self._url = url
        self._format_type = format_type
        self._subject_token_field_name = subject_token_field_name
        self._headers = headers

    @_helpers.copy_docstring(SubjectTokenSupplier)
    def get_subject_token(self, context, request):
        response = request(url=self._url, method="GET", headers=self._headers)

        # support both string and bytes type response.data
        response_body = (
            response.data.decode("utf-8")
            if hasattr(response.data, "decode")
            else response.data
        )

        if response.status != 200:
            raise exceptions.RefreshError(
                "Unable to retrieve Identity Pool subject token", response_body
            )
        token_content = _TokenContent(response_body, self._url)
        return _parse_token_data(
            token_content, self._format_type, self._subject_token_field_name
        )


class _X509Supplier(SubjectTokenSupplier):
    """Internal supplier for X509 workload credentials. This class is used internally and always returns an empty string as the subject token."""

    def __init__(self, trust_chain_path, leaf_cert_callback):
        self._trust_chain_path = trust_chain_path
        self._leaf_cert_callback = leaf_cert_callback

    @_helpers.copy_docstring(SubjectTokenSupplier)
    def get_subject_token(self, context, request):
        # Import OpennSSL inline because it is an extra import only required by customers
        # using mTLS.
        from OpenSSL import crypto

        leaf_cert = crypto.load_certificate(
            crypto.FILETYPE_PEM, self._leaf_cert_callback()
        )
        trust_chain = self._read_trust_chain()
        cert_chain = []

        cert_chain.append(_X509Supplier._encode_cert(leaf_cert))

        if trust_chain is None or len(trust_chain) == 0:
            return json.dumps(cert_chain)

        # Append the first cert if it is not the leaf cert.
        first_cert = _X509Supplier._encode_cert(trust_chain[0])
        if first_cert != cert_chain[0]:
            cert_chain.append(first_cert)

        for i in range(1, len(trust_chain)):
            encoded = _X509Supplier._encode_cert(trust_chain[i])
            # Check if the current cert is the leaf cert and raise an exception if it is.
            if encoded == cert_chain[0]:
                raise exceptions.RefreshError(
                    "The leaf certificate must be at the top of the trust chain file"
                )
            else:
                cert_chain.append(encoded)
        return json.dumps(cert_chain)

    def _read_trust_chain(self):
        # Import OpennSSL inline because it is an extra import only required by customers
        # using mTLS.
        from OpenSSL import crypto

        certificate_trust_chain = []
        # If no trust chain path was provided, return an empty list.
        if self._trust_chain_path is None or self._trust_chain_path == "":
            return certificate_trust_chain
        try:
            # Open the trust chain file.
            with open(self._trust_chain_path, "rb") as f:
                trust_chain_data = f.read()
                # Split PEM data into individual certificates.
                cert_blocks = trust_chain_data.split(b"-----BEGIN CERTIFICATE-----")
                for cert_block in cert_blocks:
                    # Skip empty blocks.
                    if cert_block.strip():
                        cert_data = b"-----BEGIN CERTIFICATE-----" + cert_block
                        try:
                            # Load each certificate and add it to the trust chain.
                            cert = crypto.load_certificate(
                                crypto.FILETYPE_PEM, cert_data
                            )
                            certificate_trust_chain.append(cert)
                        except Exception as e:
                            raise exceptions.RefreshError(
                                "Error loading PEM certificates from the trust chain file '{}'".format(
                                    self._trust_chain_path
                                )
                            ) from e
                return certificate_trust_chain
        except FileNotFoundError:
            raise exceptions.RefreshError(
                "Trust chain file '{}' was not found.".format(self._trust_chain_path)
            )

    def _encode_cert(cert):
        # Import OpennSSL inline because it is an extra import only required by customers
        # using mTLS.
        from OpenSSL import crypto

        return base64.b64encode(
            crypto.dump_certificate(crypto.FILETYPE_ASN1, cert)
        ).decode("utf-8")


def _parse_token_data(token_content, format_type="text", subject_token_field_name=None):
    if format_type == "text":
        token = token_content.content
    else:
        try:
            # Parse file content as JSON.
            response_data = json.loads(token_content.content)
            # Get the subject_token.
            token = response_data[subject_token_field_name]
        except (KeyError, ValueError):
            raise exceptions.RefreshError(
                "Unable to parse subject_token from JSON file '{}' using key '{}'".format(
                    token_content.location, subject_token_field_name
                )
            )
    if not token:
        raise exceptions.RefreshError(
            "Missing subject_token in the credential_source file"
        )
    return token


class Credentials(external_account.Credentials):
    """External account credentials sourced from files and URLs."""

    def __init__(
        self,
        audience,
        subject_token_type,
        token_url=external_account._DEFAULT_TOKEN_URL,
        credential_source=None,
        subject_token_supplier=None,
        *args,
        **kwargs
    ):
        """Instantiates an external account credentials object from a file/URL.

        Args:
            audience (str): The STS audience field.
            subject_token_type (str): The subject token type based on the Oauth2.0 token exchange spec.
                Expected values include::

                    “urn:ietf:params:oauth:token-type:jwt”
                    “urn:ietf:params:oauth:token-type:id-token”
                    “urn:ietf:params:oauth:token-type:saml2”

            token_url (Optional [str]): The STS endpoint URL. If not provided, will default to "https://sts.googleapis.com/v1/token".
            credential_source (Optional [Mapping]): The credential source dictionary used to
                provide instructions on how to retrieve external credential to be
                exchanged for Google access tokens. Either a credential source or
                a subject token supplier must be provided.

                Example credential_source for url-sourced credential::

                    {
                        "url": "http://www.example.com",
                        "format": {
                            "type": "json",
                            "subject_token_field_name": "access_token",
                        },
                        "headers": {"foo": "bar"},
                    }

                Example credential_source for file-sourced credential::

                    {
                        "file": "/path/to/token/file.txt"
                    }
            subject_token_supplier (Optional [SubjectTokenSupplier]): Optional subject token supplier.
                This will be called to supply a valid subject token which will then
                be exchanged for Google access tokens. Either a subject token  supplier
                or a credential source must be provided.
            args (List): Optional positional arguments passed into the underlying :meth:`~external_account.Credentials.__init__` method.
            kwargs (Mapping): Optional keyword arguments passed into the underlying :meth:`~external_account.Credentials.__init__` method.

        Raises:
            google.auth.exceptions.RefreshError: If an error is encountered during
                access token retrieval logic.
            ValueError: For invalid parameters.

        .. note:: Typically one of the helper constructors
            :meth:`from_file` or
            :meth:`from_info` are used instead of calling the constructor directly.
        """

        super(Credentials, self).__init__(
            audience=audience,
            subject_token_type=subject_token_type,
            token_url=token_url,
            credential_source=credential_source,
            *args,
            **kwargs
        )
        if credential_source is None and subject_token_supplier is None:
            raise exceptions.InvalidValue(
                "A valid credential source or a subject token supplier must be provided."
            )
        if credential_source is not None and subject_token_supplier is not None:
            raise exceptions.InvalidValue(
                "Identity pool credential cannot have both a credential source and a subject token supplier."
            )

        if subject_token_supplier is not None:
            self._subject_token_supplier = subject_token_supplier
            self._credential_source_file = None
            self._credential_source_url = None
            self._credential_source_certificate = None
        else:
            if not isinstance(credential_source, Mapping):
                self._credential_source_executable = None
                raise exceptions.MalformedError(
                    "Invalid credential_source. The credential_source is not a dict."
                )
            self._credential_source_file = credential_source.get("file")
            self._credential_source_url = credential_source.get("url")
            self._credential_source_certificate = credential_source.get("certificate")

            # environment_id is only supported in AWS or dedicated future external
            # account credentials.
            if "environment_id" in credential_source:
                raise exceptions.MalformedError(
                    "Invalid Identity Pool credential_source field 'environment_id'"
                )

            # check that only one of file, url, or certificate are provided.
            self._validate_single_source()

            if self._credential_source_certificate:
                self._validate_certificate_config()
            else:
                self._validate_file_or_url_config(credential_source)

            if self._credential_source_file:
                self._subject_token_supplier = _FileSupplier(
                    self._credential_source_file,
                    self._credential_source_format_type,
                    self._credential_source_field_name,
                )
            elif self._credential_source_url:
                self._subject_token_supplier = _UrlSupplier(
                    self._credential_source_url,
                    self._credential_source_format_type,
                    self._credential_source_field_name,
                    self._credential_source_headers,
                )
            else:  # self._credential_source_certificate
                self._subject_token_supplier = _X509Supplier(
                    self._trust_chain_path, self._get_cert_bytes
                )

    @_helpers.copy_docstring(external_account.Credentials)
    def retrieve_subject_token(self, request):
        return self._subject_token_supplier.get_subject_token(
            self._supplier_context, request
        )

    def _get_mtls_cert_and_key_paths(self):
        if self._credential_source_certificate is None:
            raise exceptions.RefreshError(
                'The credential is not configured to use mtls requests. The credential should include a "certificate" section in the credential source.'
            )
        else:
            return _mtls_helper._get_workload_cert_and_key_paths(
                self._certificate_config_location
            )

    def _get_cert_bytes(self):
        cert_path, _ = self._get_mtls_cert_and_key_paths()
        return _mtls_helper._read_cert_file(cert_path)

    def _mtls_required(self):
        return self._credential_source_certificate is not None

    def _create_default_metrics_options(self):
        metrics_options = super(Credentials, self)._create_default_metrics_options()
        # Check that credential source is a dict before checking for credential type. This check needs to be done
        # here because the external_account credential constructor needs to pass the metrics options to the
        # impersonated credential object before the identity_pool credentials are validated.
        if isinstance(self._credential_source, Mapping):
            if self._credential_source.get("file"):
                metrics_options["source"] = "file"
            elif self._credential_source.get("url"):
                metrics_options["source"] = "url"
            else:
                metrics_options["source"] = "x509"
        else:
            metrics_options["source"] = "programmatic"
        return metrics_options

    def _has_custom_supplier(self):
        return self._credential_source is None

    def _constructor_args(self):
        args = super(Credentials, self)._constructor_args()
        # If a custom supplier was used, append it to the args dict.
        if self._has_custom_supplier():
            args.update({"subject_token_supplier": self._subject_token_supplier})
        return args

    def _validate_certificate_config(self):
        self._certificate_config_location = self._credential_source_certificate.get(
            "certificate_config_location"
        )
        use_default = self._credential_source_certificate.get(
            "use_default_certificate_config"
        )
        self._trust_chain_path = self._credential_source_certificate.get(
            "trust_chain_path"
        )
        if self._certificate_config_location and use_default:
            raise exceptions.MalformedError(
                "Invalid certificate configuration, certificate_config_location cannot be specified when use_default_certificate_config = true."
            )
        if not self._certificate_config_location and not use_default:
            raise exceptions.MalformedError(
                "Invalid certificate configuration, use_default_certificate_config should be true if no certificate_config_location is provided."
            )

    def _validate_file_or_url_config(self, credential_source):
        self._credential_source_headers = credential_source.get("headers")
        credential_source_format = credential_source.get("format", {})
        # Get credential_source format type. When not provided, this
        # defaults to text.
        self._credential_source_format_type = (
            credential_source_format.get("type") or "text"
        )
        if self._credential_source_format_type not in ["text", "json"]:
            raise exceptions.MalformedError(
                "Invalid credential_source format '{}'".format(
                    self._credential_source_format_type
                )
            )
        # For JSON types, get the required subject_token field name.
        if self._credential_source_format_type == "json":
            self._credential_source_field_name = credential_source_format.get(
                "subject_token_field_name"
            )
            if self._credential_source_field_name is None:
                raise exceptions.MalformedError(
                    "Missing subject_token_field_name for JSON credential_source format"
                )
        else:
            self._credential_source_field_name = None

    def _validate_single_source(self):
        credential_sources = [
            self._credential_source_file,
            self._credential_source_url,
            self._credential_source_certificate,
        ]
        valid_credential_sources = list(
            filter(lambda source: source is not None, credential_sources)
        )

        if len(valid_credential_sources) > 1:
            raise exceptions.MalformedError(
                "Ambiguous credential_source. 'file', 'url', and 'certificate' are mutually exclusive.."
            )
        if len(valid_credential_sources) != 1:
            raise exceptions.MalformedError(
                "Missing credential_source. A 'file', 'url', or 'certificate' must be provided."
            )

    @classmethod
    def from_info(cls, info, **kwargs):
        """Creates an Identity Pool Credentials instance from parsed external account info.

        Args:
            info (Mapping[str, str]): The Identity Pool external account info in Google
                format.
            kwargs: Additional arguments to pass to the constructor.

        Returns:
            google.auth.identity_pool.Credentials: The constructed
                credentials.

        Raises:
            ValueError: For invalid parameters.
        """
        subject_token_supplier = info.get("subject_token_supplier")
        kwargs.update({"subject_token_supplier": subject_token_supplier})
        return super(Credentials, cls).from_info(info, **kwargs)

    @classmethod
    def from_file(cls, filename, **kwargs):
        """Creates an IdentityPool Credentials instance from an external account json file.

        Args:
            filename (str): The path to the IdentityPool external account json file.
            kwargs: Additional arguments to pass to the constructor.

        Returns:
            google.auth.identity_pool.Credentials: The constructed
                credentials.
        """
        return super(Credentials, cls).from_file(filename, **kwargs)
