# Copyright 2019 The Kubernetes Authors.
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

import json
import sys
import traceback

from kubernetes.client.rest import ApiException


def api_exception(e):
    """
    Returns the proper Exception class for the given kubernetes.client.rest.ApiException object
    https://github.com/kubernetes/community/blob/master/contributors/devel/api-conventions.md#success-codes
    """
    _, _, exc_traceback = sys.exc_info()
    tb = '\n'.join(traceback.format_tb(exc_traceback))
    return {
        400: BadRequestError,
        401: UnauthorizedError,
        403: ForbiddenError,
        404: NotFoundError,
        405: MethodNotAllowedError,
        409: ConflictError,
        410: GoneError,
        422: UnprocessibleEntityError,
        429: TooManyRequestsError,
        500: InternalServerError,
        503: ServiceUnavailableError,
        504: ServerTimeoutError,
    }.get(e.status, DynamicApiError)(e, tb)


class DynamicApiError(ApiException):
    """ Generic API Error for the dynamic client """
    def __init__(self, e, tb=None):
        self.status = e.status
        self.reason = e.reason
        self.body = e.body
        self.headers = e.headers
        self.original_traceback = tb

    def __str__(self):
        error_message = [str(self.status), "Reason: {}".format(self.reason)]
        if self.headers:
            error_message.append("HTTP response headers: {}".format(self.headers))

        if self.body:
            error_message.append("HTTP response body: {}".format(self.body))

        if self.original_traceback:
            error_message.append("Original traceback: \n{}".format(self.original_traceback))

        return '\n'.join(error_message)

    def summary(self):
        if self.body:
            if self.headers and self.headers.get('Content-Type') == 'application/json':
                message = json.loads(self.body).get('message')
                if message:
                    return message

            return self.body
        else:
            return "{} Reason: {}".format(self.status, self.reason)

class ResourceNotFoundError(Exception):
    """ Resource was not found in available APIs """
class ResourceNotUniqueError(Exception):
    """ Parameters given matched multiple API resources """

class KubernetesValidateMissing(Exception):
    """ kubernetes-validate is not installed """

# HTTP Errors
class BadRequestError(DynamicApiError):
    """ 400: StatusBadRequest """
class UnauthorizedError(DynamicApiError):
    """ 401: StatusUnauthorized """
class ForbiddenError(DynamicApiError):
    """ 403: StatusForbidden """
class NotFoundError(DynamicApiError):
    """ 404: StatusNotFound """
class MethodNotAllowedError(DynamicApiError):
    """ 405: StatusMethodNotAllowed """
class ConflictError(DynamicApiError):
    """ 409: StatusConflict """
class GoneError(DynamicApiError):
    """ 410: StatusGone """
class UnprocessibleEntityError(DynamicApiError):
    """ 422: StatusUnprocessibleEntity """
class TooManyRequestsError(DynamicApiError):
    """ 429: StatusTooManyRequests """
class InternalServerError(DynamicApiError):
    """ 500: StatusInternalServer """
class ServiceUnavailableError(DynamicApiError):
    """ 503: StatusServiceUnavailable """
class ServerTimeoutError(DynamicApiError):
    """ 504: StatusServerTimeout """
