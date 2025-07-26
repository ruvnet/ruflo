# Copyright 2023 Google LLC
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

""" We use x-goog-api-client header to report metrics. This module provides
the constants and helper methods to construct x-goog-api-client header.
"""

import platform

from google.auth import version


API_CLIENT_HEADER = "x-goog-api-client"

# BYOID Specific consts
BYOID_HEADER_SECTION = "google-byoid-sdk"

# Auth request type
REQUEST_TYPE_ACCESS_TOKEN = "auth-request-type/at"
REQUEST_TYPE_ID_TOKEN = "auth-request-type/it"
REQUEST_TYPE_MDS_PING = "auth-request-type/mds"
REQUEST_TYPE_REAUTH_START = "auth-request-type/re-start"
REQUEST_TYPE_REAUTH_CONTINUE = "auth-request-type/re-cont"

# Credential type
CRED_TYPE_USER = "cred-type/u"
CRED_TYPE_SA_ASSERTION = "cred-type/sa"
CRED_TYPE_SA_JWT = "cred-type/jwt"
CRED_TYPE_SA_MDS = "cred-type/mds"
CRED_TYPE_SA_IMPERSONATE = "cred-type/imp"


# Versions
def python_and_auth_lib_version():
    return "gl-python/{} auth/{}".format(platform.python_version(), version.__version__)


# Token request metric header values

# x-goog-api-client header value for access token request via metadata server.
# Example: "gl-python/3.7 auth/1.1 auth-request-type/at cred-type/mds"
def token_request_access_token_mds():
    return "{} {} {}".format(
        python_and_auth_lib_version(), REQUEST_TYPE_ACCESS_TOKEN, CRED_TYPE_SA_MDS
    )


# x-goog-api-client header value for ID token request via metadata server.
# Example: "gl-python/3.7 auth/1.1 auth-request-type/it cred-type/mds"
def token_request_id_token_mds():
    return "{} {} {}".format(
        python_and_auth_lib_version(), REQUEST_TYPE_ID_TOKEN, CRED_TYPE_SA_MDS
    )


# x-goog-api-client header value for impersonated credentials access token request.
# Example: "gl-python/3.7 auth/1.1 auth-request-type/at cred-type/imp"
def token_request_access_token_impersonate():
    return "{} {} {}".format(
        python_and_auth_lib_version(),
        REQUEST_TYPE_ACCESS_TOKEN,
        CRED_TYPE_SA_IMPERSONATE,
    )


# x-goog-api-client header value for impersonated credentials ID token request.
# Example: "gl-python/3.7 auth/1.1 auth-request-type/it cred-type/imp"
def token_request_id_token_impersonate():
    return "{} {} {}".format(
        python_and_auth_lib_version(), REQUEST_TYPE_ID_TOKEN, CRED_TYPE_SA_IMPERSONATE
    )


# x-goog-api-client header value for service account credentials access token
# request (assertion flow).
# Example: "gl-python/3.7 auth/1.1 auth-request-type/at cred-type/sa"
def token_request_access_token_sa_assertion():
    return "{} {} {}".format(
        python_and_auth_lib_version(), REQUEST_TYPE_ACCESS_TOKEN, CRED_TYPE_SA_ASSERTION
    )


# x-goog-api-client header value for service account credentials ID token
# request (assertion flow).
# Example: "gl-python/3.7 auth/1.1 auth-request-type/it cred-type/sa"
def token_request_id_token_sa_assertion():
    return "{} {} {}".format(
        python_and_auth_lib_version(), REQUEST_TYPE_ID_TOKEN, CRED_TYPE_SA_ASSERTION
    )


# x-goog-api-client header value for user credentials token request.
# Example: "gl-python/3.7 auth/1.1 cred-type/u"
def token_request_user():
    return "{} {}".format(python_and_auth_lib_version(), CRED_TYPE_USER)


# Miscellenous metrics

# x-goog-api-client header value for metadata server ping.
# Example: "gl-python/3.7 auth/1.1 auth-request-type/mds"
def mds_ping():
    return "{} {}".format(python_and_auth_lib_version(), REQUEST_TYPE_MDS_PING)


# x-goog-api-client header value for reauth start endpoint calls.
# Example: "gl-python/3.7 auth/1.1 auth-request-type/re-start"
def reauth_start():
    return "{} {}".format(python_and_auth_lib_version(), REQUEST_TYPE_REAUTH_START)


# x-goog-api-client header value for reauth continue endpoint calls.
# Example: "gl-python/3.7 auth/1.1 cred-type/re-cont"
def reauth_continue():
    return "{} {}".format(python_and_auth_lib_version(), REQUEST_TYPE_REAUTH_CONTINUE)


# x-goog-api-client header value for BYOID calls to the Security Token Service exchange token endpoint.
# Example: "gl-python/3.7 auth/1.1 google-byoid-sdk source/aws sa-impersonation/true sa-impersonation/true"
def byoid_metrics_header(metrics_options):
    header = "{} {}".format(python_and_auth_lib_version(), BYOID_HEADER_SECTION)
    for key, value in metrics_options.items():
        header = "{} {}/{}".format(header, key, value)
    return header


def add_metric_header(headers, metric_header_value):
    """Add x-goog-api-client header with the given value.

    Args:
        headers (Mapping[str, str]): The headers to which we will add the
            metric header.
        metric_header_value (Optional[str]): If value is None, do nothing;
            if headers already has a x-goog-api-client header, append the value
            to the existing header; otherwise add a new x-goog-api-client
            header with the given value.
    """
    if not metric_header_value:
        return
    if API_CLIENT_HEADER not in headers:
        headers[API_CLIENT_HEADER] = metric_header_value
    else:
        headers[API_CLIENT_HEADER] += " " + metric_header_value
