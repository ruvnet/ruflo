# Copyright 2025 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

from typing import ClassVar as _ClassVar

from google.protobuf import descriptor as _descriptor
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper

DESCRIPTOR: _descriptor.FileDescriptor

class ErrorReason(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    ERROR_REASON_UNSPECIFIED: _ClassVar[ErrorReason]
    SERVICE_DISABLED: _ClassVar[ErrorReason]
    BILLING_DISABLED: _ClassVar[ErrorReason]
    API_KEY_INVALID: _ClassVar[ErrorReason]
    API_KEY_SERVICE_BLOCKED: _ClassVar[ErrorReason]
    API_KEY_HTTP_REFERRER_BLOCKED: _ClassVar[ErrorReason]
    API_KEY_IP_ADDRESS_BLOCKED: _ClassVar[ErrorReason]
    API_KEY_ANDROID_APP_BLOCKED: _ClassVar[ErrorReason]
    API_KEY_IOS_APP_BLOCKED: _ClassVar[ErrorReason]
    RATE_LIMIT_EXCEEDED: _ClassVar[ErrorReason]
    RESOURCE_QUOTA_EXCEEDED: _ClassVar[ErrorReason]
    LOCATION_TAX_POLICY_VIOLATED: _ClassVar[ErrorReason]
    USER_PROJECT_DENIED: _ClassVar[ErrorReason]
    CONSUMER_SUSPENDED: _ClassVar[ErrorReason]
    CONSUMER_INVALID: _ClassVar[ErrorReason]
    SECURITY_POLICY_VIOLATED: _ClassVar[ErrorReason]
    ACCESS_TOKEN_EXPIRED: _ClassVar[ErrorReason]
    ACCESS_TOKEN_SCOPE_INSUFFICIENT: _ClassVar[ErrorReason]
    ACCOUNT_STATE_INVALID: _ClassVar[ErrorReason]
    ACCESS_TOKEN_TYPE_UNSUPPORTED: _ClassVar[ErrorReason]
    CREDENTIALS_MISSING: _ClassVar[ErrorReason]
    RESOURCE_PROJECT_INVALID: _ClassVar[ErrorReason]
    SESSION_COOKIE_INVALID: _ClassVar[ErrorReason]
    USER_BLOCKED_BY_ADMIN: _ClassVar[ErrorReason]
    RESOURCE_USAGE_RESTRICTION_VIOLATED: _ClassVar[ErrorReason]
    SYSTEM_PARAMETER_UNSUPPORTED: _ClassVar[ErrorReason]
    ORG_RESTRICTION_VIOLATION: _ClassVar[ErrorReason]
    ORG_RESTRICTION_HEADER_INVALID: _ClassVar[ErrorReason]
    SERVICE_NOT_VISIBLE: _ClassVar[ErrorReason]
    GCP_SUSPENDED: _ClassVar[ErrorReason]
    LOCATION_POLICY_VIOLATED: _ClassVar[ErrorReason]
    MISSING_ORIGIN: _ClassVar[ErrorReason]
    OVERLOADED_CREDENTIALS: _ClassVar[ErrorReason]

ERROR_REASON_UNSPECIFIED: ErrorReason
SERVICE_DISABLED: ErrorReason
BILLING_DISABLED: ErrorReason
API_KEY_INVALID: ErrorReason
API_KEY_SERVICE_BLOCKED: ErrorReason
API_KEY_HTTP_REFERRER_BLOCKED: ErrorReason
API_KEY_IP_ADDRESS_BLOCKED: ErrorReason
API_KEY_ANDROID_APP_BLOCKED: ErrorReason
API_KEY_IOS_APP_BLOCKED: ErrorReason
RATE_LIMIT_EXCEEDED: ErrorReason
RESOURCE_QUOTA_EXCEEDED: ErrorReason
LOCATION_TAX_POLICY_VIOLATED: ErrorReason
USER_PROJECT_DENIED: ErrorReason
CONSUMER_SUSPENDED: ErrorReason
CONSUMER_INVALID: ErrorReason
SECURITY_POLICY_VIOLATED: ErrorReason
ACCESS_TOKEN_EXPIRED: ErrorReason
ACCESS_TOKEN_SCOPE_INSUFFICIENT: ErrorReason
ACCOUNT_STATE_INVALID: ErrorReason
ACCESS_TOKEN_TYPE_UNSUPPORTED: ErrorReason
CREDENTIALS_MISSING: ErrorReason
RESOURCE_PROJECT_INVALID: ErrorReason
SESSION_COOKIE_INVALID: ErrorReason
USER_BLOCKED_BY_ADMIN: ErrorReason
RESOURCE_USAGE_RESTRICTION_VIOLATED: ErrorReason
SYSTEM_PARAMETER_UNSUPPORTED: ErrorReason
ORG_RESTRICTION_VIOLATION: ErrorReason
ORG_RESTRICTION_HEADER_INVALID: ErrorReason
SERVICE_NOT_VISIBLE: ErrorReason
GCP_SUSPENDED: ErrorReason
LOCATION_POLICY_VIOLATED: ErrorReason
MISSING_ORIGIN: ErrorReason
OVERLOADED_CREDENTIALS: ErrorReason
