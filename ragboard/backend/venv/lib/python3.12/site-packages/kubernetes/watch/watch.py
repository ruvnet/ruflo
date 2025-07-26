# Copyright 2016 The Kubernetes Authors.
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
import pydoc
import sys

from kubernetes import client

PYDOC_RETURN_LABEL = ":return:"
PYDOC_FOLLOW_PARAM = ":param bool follow:"

# Removing this suffix from return type name should give us event's object
# type. e.g., if list_namespaces() returns "NamespaceList" type,
# then list_namespaces(watch=true) returns a stream of events with objects
# of type "Namespace". In case this assumption is not true, user should
# provide return_type to Watch class's __init__.
TYPE_LIST_SUFFIX = "List"


PY2 = sys.version_info[0] == 2
if PY2:
    import httplib
    HTTP_STATUS_GONE = httplib.GONE
else:
    import http
    HTTP_STATUS_GONE = http.HTTPStatus.GONE


class SimpleNamespace:

    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)


def _find_return_type(func):
    for line in pydoc.getdoc(func).splitlines():
        if line.startswith(PYDOC_RETURN_LABEL):
            return line[len(PYDOC_RETURN_LABEL):].strip()
    return ""


def iter_resp_lines(resp):
    buffer = bytearray()
    for segment in resp.stream(amt=None, decode_content=False):

        # Append the segment (chunk) to the buffer
        #
        # Performance note: depending on contents of buffer and the type+value of segment,
        # encoding segment into the buffer could be a wasteful step. The approach used here
        # simplifies the logic farther down, but in the future it may be reasonable to
        # sacrifice readability for performance.
        if isinstance(segment, bytes):
            buffer.extend(segment)
        elif isinstance(segment, str):
            buffer.extend(segment.encode("utf-8"))
        else:
            raise TypeError(
                f"Received invalid segment type, {type(segment)}, from stream. Accepts only 'str' or 'bytes'.")

        # Split by newline (safe for utf-8 because multi-byte sequences cannot contain the newline byte)
        next_newline = buffer.find(b'\n')
        while next_newline != -1:
            # Convert bytes to a valid utf-8 string, replacing any invalid utf-8 with the '�' character
            line = buffer[:next_newline].decode(
                "utf-8", errors="replace")
            buffer = buffer[next_newline+1:]
            if line:
                yield line
            else:
                yield ''  # Only print one empty line
            next_newline = buffer.find(b'\n')


class Watch(object):

    def __init__(self, return_type=None):
        self._raw_return_type = return_type
        self._stop = False
        self._api_client = client.ApiClient()
        self.resource_version = None

    def stop(self):
        self._stop = True

    def get_return_type(self, func):
        if self._raw_return_type:
            return self._raw_return_type
        return_type = _find_return_type(func)
        if return_type.endswith(TYPE_LIST_SUFFIX):
            return return_type[:-len(TYPE_LIST_SUFFIX)]
        return return_type

    def get_watch_argument_name(self, func):
        if PYDOC_FOLLOW_PARAM in pydoc.getdoc(func):
            return 'follow'
        else:
            return 'watch'

    def unmarshal_event(self, data, return_type):
        if not data or data.isspace():
            return None
        try:
            js = json.loads(data)
            js['raw_object'] = js['object']
            # BOOKMARK event is treated the same as ERROR for a quick fix of
            # decoding exception
            # TODO: make use of the resource_version in BOOKMARK event for more
            # efficient WATCH
            if return_type and js['type'] != 'ERROR' and js['type'] != 'BOOKMARK':
                obj = SimpleNamespace(data=json.dumps(js['raw_object']))
                js['object'] = self._api_client.deserialize(obj, return_type)
                if hasattr(js['object'], 'metadata'):
                    self.resource_version = js['object'].metadata.resource_version
                # For custom objects that we don't have model defined, json
                # deserialization results in dictionary
                elif (isinstance(js['object'], dict) and 'metadata' in js['object']
                      and 'resourceVersion' in js['object']['metadata']):
                    self.resource_version = js['object']['metadata'][
                        'resourceVersion']
            return js
        except json.JSONDecodeError:
            return None

    def stream(self, func, *args, **kwargs):
        """Watch an API resource and stream the result back via a generator.

        Note that watching an API resource can expire. The method tries to
        resume automatically once from the last result, but if that last result
        is too old as well, an `ApiException` exception will be thrown with
        ``code`` 410. In that case you have to recover yourself, probably
        by listing the API resource to obtain the latest state and then
        watching from that state on by setting ``resource_version`` to
        one returned from listing.

        :param func: The API function pointer. Any parameter to the function
                     can be passed after this parameter.

        :return: Event object with these keys:
                   'type': The type of event such as "ADDED", "DELETED", etc.
                   'raw_object': a dict representing the watched object.
                   'object': A model representation of raw_object. The name of
                             model will be determined based on
                             the func's doc string. If it cannot be determined,
                             'object' value will be the same as 'raw_object'.

        Example:
            v1 = kubernetes.client.CoreV1Api()
            watch = kubernetes.watch.Watch()
            for e in watch.stream(v1.list_namespace, resource_version=1127):
                type_ = e['type']
                object_ = e['object']  # object is one of type return_type
                raw_object = e['raw_object']  # raw_object is a dict
                ...
                if should_stop:
                    watch.stop()
        """

        self._stop = False
        return_type = self.get_return_type(func)
        watch_arg = self.get_watch_argument_name(func)
        kwargs[watch_arg] = True
        kwargs['_preload_content'] = False
        if 'resource_version' in kwargs:
            self.resource_version = kwargs['resource_version']

        # Do not attempt retries if user specifies a timeout.
        # We want to ensure we are returning within that timeout.
        disable_retries = ('timeout_seconds' in kwargs)
        retry_after_410 = False
        while True:
            resp = func(*args, **kwargs)
            try:
                for line in iter_resp_lines(resp):
                    # unmarshal when we are receiving events from watch,
                    # return raw string when we are streaming log
                    if watch_arg == "watch":
                        event = self.unmarshal_event(line, return_type)
                        if isinstance(event, dict) \
                                and event['type'] == 'ERROR':
                            obj = event['raw_object']
                            # Current request expired, let's retry, (if enabled)
                            # but only if we have not already retried.
                            if not disable_retries and not retry_after_410 and \
                                    obj['code'] == HTTP_STATUS_GONE:
                                retry_after_410 = True
                                break
                            else:
                                reason = "%s: %s" % (
                                    obj['reason'], obj['message'])
                                raise client.rest.ApiException(
                                    status=obj['code'], reason=reason)
                        else:
                            retry_after_410 = False
                            yield event
                    else:
                        if line:  
                            yield line  # Normal non-empty line
                        else:  
                            yield ''  # Only yield one empty line  
                    if self._stop:
                        break
            finally:
                resp.close()
                resp.release_conn()
                if self.resource_version is not None:
                    kwargs['resource_version'] = self.resource_version
                else:
                    self._stop = True

            if self._stop or disable_retries:
                break
